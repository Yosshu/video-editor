import { useEffect, useRef, useState } from 'react';
import { setParam } from '../../app/actions';
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

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const toScene = (cx: number, cy: number) => [
      ((cx - rect.left) / rect.width - 0.5) * sceneW,
      ((cy - rect.top) / rect.height - 0.5) * sceneH,
    ];
    const [sx, sy] = toScene(e.clientX, e.clientY);
    const hit = hitTest(engineRef.current?.lastItems ?? items, sx, sy);
    if (!hit) {
      setSelection([]);
      return;
    }
    const state = getState();
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
    const scene = currentScene(state);
    const obj = scene.objects.find((o) => o.id === hit.objectId);
    if (!obj || scene.layers.some((l) => l.index === obj.layer && l.locked)) return;
    playback.pause();
    const local = state.playhead - obj.start;
    const startX = valueAt(obj.params.x, local, 0);
    const startY = valueAt(obj.params.y, local, 0);
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const [mx, my] = toScene(ev.clientX, ev.clientY);
      let dx = mx - sx;
      let dy = my - sy;
      if (ev.shiftKey) {
        // Shift で水平・垂直方向に限定
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      setParam(obj.id, 'x', Math.round(startX + dx));
      setParam(obj.id, 'y', Math.round(startY + dy));
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  return (
    <section className="panel preview-panel" aria-label="プレビュー">
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
                {items
                  .filter((i) => selection.includes(i.objectId))
                  .map((i) => (
                    <polygon
                      key={i.objectId}
                      className="selection-outline"
                      points={corners(i)
                        .map(([x, y]) => toScreen(x, y).join(','))
                        .join(' ')}
                    />
                  ))}
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
