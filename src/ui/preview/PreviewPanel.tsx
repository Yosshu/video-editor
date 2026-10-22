import { useEffect, useRef, useState } from 'react';
import { localFrameOf, setParamAtPlayhead } from '../../app/animationActions';
import { valueAt } from '../../core/animation/interpolate';
import type { ComposedItem } from '../../engine/compose';
import { PreviewEngine } from '../../engine/preview/PreviewEngine';
import { getPreviewMedia } from '../../engine/preview/previewMediaInstance';
import { playback } from '../../engine/playback/Playback';
import {
  currentScene,
  getState,
  setSelection,
  useEditor,
  type PreviewQuality,
} from '../../state/store';
import { useUi } from '../../state/ui';
import { FULLSCREEN_ATTR } from './fullscreen';
import { TransportBar } from './TransportBar';

interface Size {
  width: number;
  height: number;
}

/** 描画済みのオブジェクトの四隅（シーン座標） */
function corners(item: ComposedItem): [number, number][] {
  const d = item.draw;
  const w = (d.width * Math.abs(d.scaleX)) / 2;
  const h = (d.height * Math.abs(d.scaleY)) / 2;
  const r = (d.rotation * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [
    [-w, -h],
    [w, -h],
    [w, h],
    [-w, h],
  ].map(([x, y]) => [d.x + x * c - y * s, d.y + x * s + y * c]);
}

function hitTest(items: ComposedItem[], x: number, y: number): ComposedItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const d = items[i].draw;
    if (d.opacity <= 0) continue;
    const r = (-d.rotation * Math.PI) / 180;
    const dx = x - d.x;
    const dy = y - d.y;
    const lx = dx * Math.cos(r) - dy * Math.sin(r);
    const ly = dx * Math.sin(r) + dy * Math.cos(r);
    if (
      Math.abs(lx) <= (d.width * Math.abs(d.scaleX)) / 2 &&
      Math.abs(ly) <= (d.height * Math.abs(d.scaleY)) / 2
    ) {
      return items[i];
    }
  }
  return null;
}

export function PreviewPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PreviewEngine | null>(null);
  const [box, setBox] = useState<Size>({ width: 0, height: 0 });
  const [items, setItems] = useState<ComposedItem[]>([]);
  const sceneW = useEditor((s) => currentScene(s).width);
  const sceneH = useEditor((s) => currentScene(s).height);
  const selection = useEditor((s) => s.selection);
  const quality = useEditor((s) => s.previewQuality);
  const [error, setError] = useState<string | null>(null);
  const guides = useUi((s) => s.previewGuides);
  const lockedLayers = useEditor((s) =>
    currentScene(s)
      .layers.filter((l) => l.locked)
      .map((l) => l.index)
      .join(','),
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: PreviewEngine;
    try {
      engine = new PreviewEngine(canvas, getPreviewMedia());
    } catch (e) {
      // 描画を初期化できない環境では、理由を画面に出す
      queueMicrotask(() => setError(e instanceof Error ? e.message : String(e)));
      return;
    }
    engineRef.current = engine;
    const off = engine.onRendered(setItems);
    return () => {
      off();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const aspect = sceneW / sceneH;
  const displayW = Math.max(1, Math.floor(Math.min(box.width, box.height * aspect)));
  const displayH = Math.max(1, Math.floor(displayW / aspect));
  const toScreen = (x: number, y: number) => [
    (x / sceneW + 0.5) * displayW,
    (y / sceneH + 0.5) * displayH,
  ];

  /** ドラッグ操作の共通処理 */
  const track = (target: Element, pointerId: number, onMove: (ev: PointerEvent) => void) => {
    target.setPointerCapture(pointerId);
    const up = () => {
      target.removeEventListener('pointermove', onMove as EventListener);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', onMove as EventListener);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const toScene = (cx: number, cy: number) => [
      ((cx - rect.left) / rect.width - 0.5) * sceneW,
      ((cy - rect.top) / rect.height - 0.5) * sceneH,
    ];
    const [sx, sy] = toScene(e.clientX, e.clientY);
    const state = getState();
    const scene = currentScene(state);

    // 拡大・回転のハンドル
    const handle = (e.target as Element).closest<SVGElement>('[data-handle]');
    if (handle) {
      const item = items.find((i) => i.objectId === handle.dataset.objectId);
      const obj = scene.objects.find((o) => o.id === handle.dataset.objectId);
      if (!item || !obj) return;
      playback.pause();
      const local = localFrameOf(obj, state.playhead);
      const cx = item.draw.x;
      const cy = item.draw.y;
      if (handle.dataset.handle === 'rotate') {
        const startAngle = Math.atan2(sy - cy, sx - cx);
        const startRot = valueAt(obj.params.rotation, local, 0);
        track(e.currentTarget, e.pointerId, (ev) => {
          const [mx, my] = toScene(ev.clientX, ev.clientY);
          let rot = startRot + ((Math.atan2(my - cy, mx - cx) - startAngle) * 180) / Math.PI;
          if (ev.shiftKey) rot = Math.round(rot / 15) * 15;
          setParamAtPlayhead(obj.id, 'rotation', Math.round(rot * 10) / 10);
        });
      } else {
        const startDist = Math.max(1, Math.hypot(sx - cx, sy - cy));
        const startScale = valueAt(obj.params.scale, local, 100);
        track(e.currentTarget, e.pointerId, (ev) => {
          const [mx, my] = toScene(ev.clientX, ev.clientY);
          let scale = (startScale * Math.hypot(mx - cx, my - cy)) / startDist;
          if (ev.shiftKey) scale = Math.round(scale / 10) * 10;
          setParamAtPlayhead(obj.id, 'scale', Math.max(0, Math.round(scale * 10) / 10));
        });
      }
      return;
    }

    const hit = hitTest(engineRef.current?.lastItems ?? items, sx, sy);
    if (!hit) {
      setSelection([]);
      return;
    }
    const multi = e.shiftKey || e.ctrlKey || e.metaKey;
    if (multi) {
      setSelection(
        state.selection.includes(hit.objectId)
          ? state.selection.filter((id) => id !== hit.objectId)
          : [...state.selection, hit.objectId],
      );
      return;
    }
    if (!state.selection.includes(hit.objectId)) setSelection([hit.objectId]);
    const obj = scene.objects.find((o) => o.id === hit.objectId);
    if (!obj || scene.layers.some((l) => l.index === obj.layer && l.locked)) return;
    playback.pause();
    const local = localFrameOf(obj, state.playhead);
    const startX = valueAt(obj.params.x, local, 0);
    const startY = valueAt(obj.params.y, local, 0);
    track(e.currentTarget, e.pointerId, (ev) => {
      const [mx, my] = toScene(ev.clientX, ev.clientY);
      let dx = mx - sx;
      let dy = my - sy;
      if (ev.shiftKey) {
        // Shift で水平・垂直方向に限定
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      setParamAtPlayhead(obj.id, 'x', Math.round(startX + dx));
      setParamAtPlayhead(obj.id, 'y', Math.round(startY + dy));
    });
  };

  const selectedItems = items.filter((i) => selection.includes(i.objectId));
  const single = selection.length === 1 ? selectedItems[0] : undefined;
  const singleLocked =
    single !== undefined && lockedLayers.split(',').includes(String(single.layer));
  const singleCorners = single ? corners(single).map(([x, y]) => toScreen(x, y)) : [];

  /** 回転ハンドルの位置（上辺の中央から外側へ少し離す） */
  const rotateKnob = (item: ComposedItem, pts: number[][]): [number, number] => {
    const [cx, cy] = toScreen(item.draw.x, item.draw.y);
    const mx = (pts[0][0] + pts[1][0]) / 2;
    const my = (pts[0][1] + pts[1][1]) / 2;
    const len = Math.hypot(mx - cx, my - cy) || 1;
    const sign = item.draw.scaleY < 0 ? -1 : 1;
    return [mx + ((mx - cx) / len) * 22 * sign, my + ((my - cy) / len) * 22 * sign];
  };

  return (
    <section className="panel preview-panel" aria-label="プレビュー" {...{ [FULLSCREEN_ATTR]: '' }}>
      <div className="preview-area" ref={containerRef}>
        {error ? (
          <p className="error-text">プレビューを表示できません：{error}</p>
        ) : (
          <div className="preview-stage" style={{ width: displayW, height: displayH }}>
            <canvas
              ref={canvasRef}
              className="preview-canvas"
              style={{ width: displayW, height: displayH }}
              data-testid="preview-canvas"
            />
            <div className="preview-overlay" onPointerDown={onPointerDown}>
              <svg width={displayW} height={displayH}>
                {guides.grid && (
                  <g className="guide-grid">
                    {[1, 2].map((i) => (
                      <g key={i}>
                        <line
                          x1={(displayW * i) / 3}
                          y1={0}
                          x2={(displayW * i) / 3}
                          y2={displayH}
                        />
                        <line
                          x1={0}
                          y1={(displayH * i) / 3}
                          x2={displayW}
                          y2={(displayH * i) / 3}
                        />
                      </g>
                    ))}
                    <line
                      x1={displayW / 2 - 8}
                      y1={displayH / 2}
                      x2={displayW / 2 + 8}
                      y2={displayH / 2}
                    />
                    <line
                      x1={displayW / 2}
                      y1={displayH / 2 - 8}
                      x2={displayW / 2}
                      y2={displayH / 2 + 8}
                    />
                  </g>
                )}
                {guides.safeArea && (
                  <g className="guide-safe">
                    <rect
                      x={displayW * 0.035}
                      y={displayH * 0.035}
                      width={displayW * 0.93}
                      height={displayH * 0.93}
                    />
                    <rect
                      x={displayW * 0.05}
                      y={displayH * 0.05}
                      width={displayW * 0.9}
                      height={displayH * 0.9}
                    />
                  </g>
                )}
                {selectedItems.map((i) => (
                  <polygon
                    key={i.objectId}
                    className="selection-outline"
                    points={corners(i)
                      .map(([x, y]) => toScreen(x, y).join(','))
                      .join(' ')}
                  />
                ))}
                {single && !singleLocked && (
                  <g className="handles">
                    <line
                      className="rotate-arm"
                      x1={(singleCorners[0][0] + singleCorners[1][0]) / 2}
                      y1={(singleCorners[0][1] + singleCorners[1][1]) / 2}
                      x2={rotateKnob(single, singleCorners)[0]}
                      y2={rotateKnob(single, singleCorners)[1]}
                    />
                    {singleCorners.map(([px, py], i) => {
                      return (
                        <rect
                          key={i}
                          className="handle scale-handle"
                          data-handle="scale"
                          data-object-id={single.objectId}
                          x={px - 5}
                          y={py - 5}
                          width={10}
                          height={10}
                        />
                      );
                    })}
                    <circle
                      className="handle rotate-handle"
                      data-handle="rotate"
                      data-object-id={single.objectId}
                      cx={rotateKnob(single, singleCorners)[0]}
                      cy={rotateKnob(single, singleCorners)[1]}
                      r={6}
                    />
                  </g>
                )}
              </svg>
            </div>
          </div>
        )}
      </div>
      <TransportBar
        quality={quality}
        onQuality={(q: PreviewQuality) => useEditor.setState({ previewQuality: q })}
      />
    </section>
  );
}
