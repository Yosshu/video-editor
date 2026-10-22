import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  addAssetObjects,
  addObject,
  clampLayer,
  copySelection,
  deleteSelection,
  duplicateSelection,
  moveObjects,
  paste,
  resizeObject,
  splitAtPlayhead,
  updateLayer,
} from '../../app/actions';
import { moveMidpointOf } from '../../app/animationActions';
import {
  closeGapAt,
  deleteLayerAt,
  inheritFromPrevious,
  insertLayerAt,
  packLayerAt,
  rippleDeleteSelection,
  setLayerFold,
  toggleLayerCollapsed,
} from '../../app/timelineActions';
import { referableScenes } from '../../app/sceneActions';
import { sceneObjectLength } from '../../engine/compose';
import { collectDroppedFiles, importMediaFiles } from '../../app/assets';
import { importSubtitles } from '../../app/subtitleActions';
import { isSubtitleFileName, SUBTITLE_ACCEPT } from '../../core/subtitles/subtitles';
import { objectKeyTimes } from '../../core/animation/keys';
import { openProjectFile } from '../../app/projectFile';
import { framesToSeconds, secondsToFrames } from '../../core/model/time';
import type { Asset, ObjectType, Rational, Scene, TimelineObject } from '../../core/model/types';
import { getEffectDef } from '../../core/effects/definitions';
import { getObjectDef } from '../../core/objects/definitions';
import {
  collectSnapPoints,
  findSnapOffset,
  MAX_LAYERS,
  objectEnd,
  resolveMove,
  resolveResize,
  sceneDuration,
} from '../../core/timeline/ops';
import { foldHeaderOf, gapAt, visibleLayerRows } from '../../core/timeline/structure';
import { isProjectFileName, MEDIA_ACCEPT } from '../../engine/media/detect';
import { pickFilesWithInput } from '../../storage/filePicker';
import { playback } from '../../engine/playback/Playback';
import { currentScene, getState, setPlayhead, setSelection, useEditor } from '../../state/store';
import { openContextMenu, openDialog, useUi } from '../../state/ui';
import { usePeaks, useThumbnail } from '../common/mediaHooks';
import { ASSET_DRAG_TYPE } from '../media-bin/MediaBin';
import { addMarker, addMarkerAtPlayhead } from '../../app/markerActions';
import { addObjectFromPreset, canAddFromPreset } from '../../app/presetActions';
import { usePresets } from '../../state/presets';
import { markerSnapPoints } from '../../core/timeline/markers';
import { BeatGridLines, MarkerLines, RulerMarkers } from './Markers';
import { SceneTabs } from './SceneTabs';
import { Waveform } from './Waveform';
import {
  chooseTickInterval,
  formatRulerLabel,
  HEADER_W,
  LAYER_H,
  MAX_PX_PER_FRAME,
  MIN_PX_PER_FRAME,
  RULER_H,
} from './geometry';
import { t } from '../../i18n';

const EDGE_PX = 6;
const SNAP_PX = 8;

type Ghost = Map<string, { layer: number; start: number; length: number }>;

interface Viewport {
  scrollLeft: number;
  scrollTop: number;
  width: number;
  height: number;
}

function objectLabel(obj: TimelineObject, assets: Asset[], scenes: Scene[]): string {
  if (obj.type === 'scene') {
    const name = scenes.find((s) => s.id === obj.params.sceneRef)?.name;
    return name ? t('シーン：{0}', name) : t('シーン（未選択）');
  }
  if (obj.type === 'filter') {
    const names = obj.effects.map((e) => t(getEffectDef(e.type)?.label ?? e.type));
    return names.length > 0 ? t('フィルタ：{0}', names.join(t('・'))) : t('フィルタ');
  }
  if (obj.type === 'audioWave')
    return t('音声波形（レイヤー {0} の音）', Number(obj.params.targetLayer ?? 1));
  if (obj.type === 'text')
    return String(obj.params.text ?? t('テキスト')).split('\n')[0] || t('テキスト');
  if (obj.assetId)
    return assets.find((a) => a.id === obj.assetId)?.name ?? t(getObjectDef(obj.type).label);
  return t(getObjectDef(obj.type).label);
}

/** 再生位置を移動する（再生中なら移動先から再生し直す） */
function seek(frame: number): void {
  const wasPlaying = getState().playing;
  if (wasPlaying) playback.pause();
  setPlayhead(frame);
  if (wasPlaying) void playback.play();
}

const ObjectItem = memo(function ObjectItem({
  obj,
  label,
  selected,
  locked,
  ppf,
  fps,
  assetDuration,
  ghost,
  row,
}: {
  obj: TimelineObject;
  label: string;
  selected: boolean;
  locked: boolean;
  ppf: number;
  fps: Rational;
  assetDuration: number;
  ghost?: { layer: number; start: number; length: number };
  /** 表示する行（折りたたみを考えたレイヤーの位置） */
  row: number;
}) {
  const def = getObjectDef(obj.type);
  const start = ghost?.start ?? obj.start;
  const length = ghost?.length ?? obj.length;
  const width = Math.max(2, length * ppf);
  const thumb = useThumbnail(
    obj.type === 'video' || obj.type === 'image' ? obj.assetId : undefined,
  );
  const showWave =
    (obj.type === 'audio' || (obj.type === 'video' && obj.params.mute !== true)) && !ghost;
  const peaks = usePeaks(obj.assetId, showWave);
  return (
    <div
      className={`tl-object ${selected ? 'selected' : ''} ${locked ? 'locked' : ''} ${ghost ? 'dragging' : ''}`}
      data-object-id={obj.id}
      style={{
        left: start * ppf,
        top: row * LAYER_H + 2,
        width,
        height: LAYER_H - 4,
        backgroundColor: def.color,
        backgroundImage: thumb ? `url(${thumb})` : undefined,
        backgroundPosition: thumb ? '3px center' : undefined,
      }}
      title={`${t(def.label)}：${label}`}
    >
      {peaks && (
        <Waveform
          peaks={peaks}
          offset={typeof obj.params.offset === 'number' ? obj.params.offset : 0}
          duration={framesToSeconds(obj.length, fps)}
          speed={(typeof obj.params.speed === 'number' ? obj.params.speed : 100) / 100}
          loop={obj.params.loop === true}
          assetDuration={assetDuration}
          width={width}
          height={LAYER_H - 6}
        />
      )}
      <span className="tl-object-label">{label}</span>
      {!ghost &&
        width > 24 &&
        objectKeyTimes(obj)
          .filter((k) => k > 0)
          .map((k) => (
            <span
              key={k}
              className="tl-key"
              data-key-time={k}
              data-object-id={obj.id}
              style={{ left: k * ppf }}
              title={t('中間点（{0} フレーム目）：ドラッグで移動、クリックでその時刻へ', k)}
            />
          ))}
    </div>
  );
});

function Ruler({
  ppf,
  viewport,
  contentWidth,
}: {
  ppf: number;
  viewport: Viewport;
  contentWidth: number;
}) {
  const fps = useEditor((s) => s.project.settings.fps);
  const markers = useEditor((s) => currentScene(s).markers);
  const { major, minor } = chooseTickInterval(ppf, fps);
  const from = Math.max(0, Math.floor((viewport.scrollLeft - 100) / ppf / minor) * minor);
  const to = (viewport.scrollLeft + viewport.width + 100) / ppf;
  const ticks: React.ReactNode[] = [];
  for (let f = from; f <= to; f += minor) {
    const isMajor = f % major === 0;
    ticks.push(
      <div key={f} className={`tick ${isMajor ? 'major' : ''}`} style={{ left: f * ppf }}>
        {isMajor && <span>{formatRulerLabel(f, fps, major)}</span>}
      </div>,
    );
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const frameAt = (clientX: number) =>
      Math.max(0, Math.round((clientX - el.getBoundingClientRect().left) / ppf));
    playback.pause();
    setPlayhead(frameAt(e.clientX));
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setPlayhead(frameAt(ev.clientX));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <div
      className="tl-ruler"
      style={{ width: contentWidth }}
      onPointerDown={onPointerDown}
      onContextMenu={(e) => {
        e.preventDefault();
        const frame = Math.max(
          0,
          Math.round((e.clientX - e.currentTarget.getBoundingClientRect().left) / ppf),
        );
        openContextMenu(e.clientX, e.clientY, [
          { label: t('ここにマーカーを追加'), action: () => addMarker(frame) },
          { label: t('BPM グリッドの設定…'), action: () => openDialog({ type: 'beatGrid' }) },
        ]);
      }}
      data-testid="timeline-ruler"
    >
      {ticks}
      {markers && <RulerMarkers markers={markers} ppf={ppf} fps={fps} />}
    </div>
  );
}

function LayerHeaders({ scene, rows }: { scene: Scene; rows: number[] }) {
  return (
    <div className="tl-headers">
      {rows.map((i) => {
        const st = scene.layers.find((l) => l.index === i);
        const header = foldHeaderOf(scene.layers, i);
        const rename = () => {
          const name = window.prompt(t('レイヤー {0} の名前', i), st?.name ?? '');
          if (name !== null) updateLayer(i, { name: name.trim() });
        };
        const makeFold = () => {
          const input = window.prompt(
            t(
              'レイヤー {0} の下の何レイヤーをまとめますか？（まとめるとタイムラインで折りたためます）',
              i,
            ),
            String(st?.fold ?? 3),
          );
          if (input === null) return;
          const count = Math.floor(Number(input));
          if (Number.isFinite(count) && count >= 0)
            setLayerFold(i, Math.min(count, MAX_LAYERS - i));
        };
        return (
          <div
            key={i}
            className={`tl-layer-header ${st?.hidden ? 'hidden-layer' : ''} ${st?.locked ? 'locked-layer' : ''} ${header ? 'in-fold' : ''} ${st?.fold ? 'fold-header' : ''}`}
            style={{ height: LAYER_H }}
            data-layer={i}
            onDoubleClick={rename}
            onContextMenu={(e) => {
              e.preventDefault();
              openContextMenu(e.clientX, e.clientY, [
                { label: t('名前を変更…'), action: rename },
                {
                  label: st?.hidden ? t('表示する') : t('非表示にする'),
                  action: () => updateLayer(i, { hidden: !st?.hidden }),
                },
                {
                  label: st?.locked ? t('ロックを解除') : t('ロックする'),
                  action: () => updateLayer(i, { locked: !st?.locked }),
                },
                'separator',
                { label: t('この位置にレイヤーを挿入'), action: () => insertLayerAt(i) },
                { label: t('このレイヤーを削除（中身ごと）'), action: () => deleteLayerAt(i) },
                { label: t('レイヤーの空白をすべて詰める'), action: () => packLayerAt(i) },
                'separator',
                {
                  label: st?.fold ? t('まとめるレイヤー数を変更…') : t('下のレイヤーとまとめる…'),
                  action: makeFold,
                },
                ...(st?.fold
                  ? [
                      {
                        label: st.collapsed ? t('まとまりを開く') : t('まとまりを折りたたむ'),
                        action: () => toggleLayerCollapsed(i),
                      },
                      { label: t('まとまりを解除'), action: () => setLayerFold(i, 0) },
                    ]
                  : []),
              ]);
            }}
          >
            {st?.fold ? (
              <button
                type="button"
                className="layer-fold"
                title={st.collapsed ? t('まとまりを開く') : t('まとまりを折りたたむ')}
                aria-label={t(
                  'レイヤー {0} のまとまりを{1}',
                  i,
                  st.collapsed ? t('開く') : t('折りたたむ'),
                )}
                aria-expanded={!st.collapsed}
                onClick={() => toggleLayerCollapsed(i)}
              >
                {st.collapsed ? '▸' : '▾'}
              </button>
            ) : null}
            <button
              type="button"
              className={`layer-toggle ${st?.hidden ? 'off' : ''}`}
              title={st?.hidden ? t('表示する') : t('非表示にする')}
              aria-label={t('レイヤー {0} の表示切り替え', i)}
              onClick={() => updateLayer(i, { hidden: !st?.hidden })}
            >
              {st?.hidden ? '○' : '●'}
            </button>
            <span className="layer-name" title={st?.name ?? `Layer ${i}`}>
              {st?.name || `Layer ${i}`}
            </span>
            {st?.fold && st.collapsed ? (
              <span className="fold-count" title={t('{0} レイヤーを折りたたみ中', st.fold)}>
                +{st.fold}
              </span>
            ) : null}
            <button
              type="button"
              className={`layer-toggle ${st?.locked ? 'on' : 'off'}`}
              title={st?.locked ? t('ロックを解除') : t('ロックする')}
              aria-label={t('レイヤー {0} のロック切り替え', i)}
              onClick={() => updateLayer(i, { locked: !st?.locked })}
            >
              {st?.locked ? '🔒' : '🔓'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function PlayheadLine({ ppf, height }: { ppf: number; height: number }) {
  const playhead = useEditor((s) => s.playhead);
  return (
    <div className="tl-playhead" style={{ left: playhead * ppf, height }} data-testid="playhead" />
  );
}

export function Timeline() {
  const scene = useEditor((s) => currentScene(s));
  const assets = useEditor((s) => s.project.assets);
  const projectScenes = useEditor((s) => s.project.scenes);
  const fps = useEditor((s) => s.project.settings.fps);
  const selection = useEditor((s) => s.selection);
  const ppf = useEditor((s) => s.pxPerFrame);
  const snapEnabled = useUi((s) => s.snap);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>({
    scrollLeft: 0,
    scrollTop: 0,
    width: 800,
    height: 300,
  });
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ layer: number; frame: number } | null>(null);
  const pendingZoom = useRef<{ frame: number; offset: number } | null>(null);

  const duration = sceneDuration(scene);
  const contentFrames = Math.max(
    duration + secondsToFrames(30, fps),
    Math.ceil(viewport.width / ppf) + 1,
  );
  const contentWidth = Math.ceil(contentFrames * ppf);
  // 折りたたみを考えた、表示するレイヤーの並び
  const rows = useMemo(() => visibleLayerRows(scene.layers), [scene.layers]);
  const rowIndex = useMemo(() => new Map(rows.map((l, i) => [l, i])), [rows]);
  /** レイヤーを表示する行（折りたたまれていれば、まとまりの先頭の行） */
  const rowOf = (layer: number) =>
    rowIndex.get(layer) ?? rowIndex.get(foldHeaderOf(scene.layers, layer)?.index ?? 1) ?? 0;
  const layerAtRow = (row: number) => rows[Math.max(0, Math.min(rows.length - 1, row))];
  const tracksHeight = rows.length * LAYER_H;
  const selectedSet = new Set(selection);
  const lockedLayers = new Set(scene.layers.filter((l) => l.locked).map((l) => l.index));
  const hiddenLayers = new Set(scene.layers.filter((l) => l.hidden).map((l) => l.index));

  const updateViewport = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewport({
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      width: el.clientWidth - HEADER_W,
      height: el.clientHeight - RULER_H,
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        updateViewport();
      });
    };
    el.addEventListener('scroll', onScroll);
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [updateViewport]);

  // 拡大縮小後、カーソル位置のフレームが同じ場所に来るようにスクロールする
  useLayoutEffect(() => {
    const z = pendingZoom.current;
    const el = scrollRef.current;
    if (!z || !el) return;
    pendingZoom.current = null;
    el.scrollLeft = Math.max(0, z.frame * ppf - z.offset);
  }, [ppf]);

  // 再生中は再生位置が見えるように自動でスクロールする
  useEffect(
    () =>
      useEditor.subscribe((s, prev) => {
        if (!s.playing || s.playhead === prev.playhead) return;
        const el = scrollRef.current;
        if (!el) return;
        const x = s.playhead * s.pxPerFrame;
        const visibleW = el.clientWidth - HEADER_W;
        if (x < el.scrollLeft || x > el.scrollLeft + visibleW - 20)
          el.scrollLeft = Math.max(0, x - visibleW * 0.1);
      }),
    [],
  );

  // Ctrl + ホイールで拡大縮小（passive: false が必要なので直接登録する）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const s = getState();
      const rect = el.getBoundingClientRect();
      const offset = e.clientX - rect.left - HEADER_W;
      const frame = (el.scrollLeft + offset) / s.pxPerFrame;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const next = Math.min(MAX_PX_PER_FRAME, Math.max(MIN_PX_PER_FRAME, s.pxPerFrame * factor));
      pendingZoom.current = { frame, offset };
      useEditor.setState({ pxPerFrame: next });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /** トラック領域内のポインター位置 → フレーム・レイヤー */
  const locate = (clientX: number, clientY: number) => {
    const rect = tracksRef.current!.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return {
      x,
      y,
      frame: Math.max(0, Math.round(x / ppf)),
      layer: clampLayer(layerAtRow(Math.floor(y / LAYER_H))),
    };
  };

  const startObjectDrag = (e: React.PointerEvent, obj: TimelineObject, el: HTMLElement) => {
    const state = getState();
    const multi = e.shiftKey || e.ctrlKey || e.metaKey;
    const wasSelected = state.selection.includes(obj.id);
    if (!wasSelected) setSelection(multi ? [...state.selection, obj.id] : [obj.id]);
    const ids = wasSelected || multi ? [...new Set([...state.selection, obj.id])] : [obj.id];
    if (lockedLayers.has(obj.layer)) return;

    const rect = el.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const mode: 'move' | 'start' | 'end' =
      rect.width > EDGE_PX * 3 && localX < EDGE_PX
        ? 'start'
        : rect.width > EDGE_PX * 3 && localX > rect.width - EDGE_PX
          ? 'end'
          : 'move';
    const origin = locate(e.clientX, e.clientY);
    const sc = currentScene(state);
    const movingIds =
      mode === 'move'
        ? ids.filter((id) => !lockedLayers.has(sc.objects.find((o) => o.id === id)?.layer ?? 0))
        : [obj.id];
    const moving = sc.objects.filter((o) => movingIds.includes(o.id));
    const snapPoints = [
      ...collectSnapPoints(sc, new Set(movingIds), state.playhead),
      ...markerSnapPoints(sc, fps, 0, contentFrames),
    ];
    let dragged = false;
    let last: { df: number; dl: number; edge: number } = { df: 0, dl: 0, edge: 0 };

    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const p = locate(ev.clientX, ev.clientY);
      if (!dragged && Math.abs(p.x - origin.x) < 3 && Math.abs(p.y - origin.y) < 3) return;
      dragged = true;
      const threshold = SNAP_PX / ppf;
      const snap = snapEnabled && !ev.altKey;
      if (mode === 'move') {
        let df = Math.round((p.x - origin.x) / ppf);
        const dl = p.layer - origin.layer;
        if (snap) {
          const edges = moving.flatMap((o) => [o.start + df, objectEnd(o) + df]);
          const off = findSnapOffset(edges, snapPoints, threshold);
          if (off !== null) df += off;
        }
        const placements = resolveMove(sc, movingIds, df, dl);
        if (placements) {
          last = {
            df: placements[0].start - moving.find((o) => o.id === placements[0].id)!.start,
            dl: placements[0].layer - moving.find((o) => o.id === placements[0].id)!.layer,
            edge: 0,
          };
          setGhost(
            new Map(
              placements.map((pl) => [
                pl.id,
                {
                  layer: pl.layer,
                  start: pl.start,
                  length: moving.find((o) => o.id === pl.id)!.length,
                },
              ]),
            ),
          );
        }
      } else {
        let edgeFrame =
          (mode === 'start' ? obj.start : objectEnd(obj)) + Math.round((p.x - origin.x) / ppf);
        if (snap) {
          const off = findSnapOffset([edgeFrame], snapPoints, threshold);
          if (off !== null) edgeFrame += off;
        }
        const r = resolveResize(sc, obj.id, mode, edgeFrame);
        if (r) {
          last = { df: 0, dl: 0, edge: mode === 'start' ? r.start : r.start + r.length };
          setGhost(new Map([[obj.id, { layer: obj.layer, start: r.start, length: r.length }]]));
        }
      }
    };
    const up = (ev: PointerEvent) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setGhost(null);
      if (!dragged) {
        // クリックだけなら選択を切り替え、再生位置も移動する
        if (multi && wasSelected) setSelection(getState().selection.filter((id) => id !== obj.id));
        else if (!multi) setSelection([obj.id]);
        seek(locate(ev.clientX, ev.clientY).frame);
        return;
      }
      if (mode === 'move') moveObjects(movingIds, last.df, last.dl);
      else resizeObject(obj.id, mode, last.edge);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  /** 中間点（キーの時刻）のドラッグ */
  const startKeyDrag = (e: React.PointerEvent, keyEl: HTMLElement) => {
    const obj = scene.objects.find((o) => o.id === keyEl.dataset.objectId);
    if (!obj) return;
    const from = Number(keyEl.dataset.keyTime);
    const origin = locate(e.clientX, e.clientY);
    let to = from;
    let dragged = false;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const p = locate(ev.clientX, ev.clientY);
      if (!dragged && Math.abs(p.x - origin.x) < 3) return;
      dragged = true;
      to = Math.min(obj.length - 1, Math.max(1, from + Math.round((p.x - origin.x) / ppf)));
      keyEl.style.left = `${to * ppf}px`;
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      if (dragged && !lockedLayers.has(obj.layer)) moveMidpointOf(obj.id, from, to);
      else keyEl.style.left = `${from * ppf}px`;
      setSelection([obj.id]);
      seek(obj.start + to);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  const onTracksPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const keyEl = (e.target as HTMLElement).closest<HTMLElement>('[data-key-time]');
    if (keyEl) {
      startKeyDrag(e, keyEl);
      return;
    }
    const objEl = (e.target as HTMLElement).closest<HTMLElement>('[data-object-id]');
    if (objEl) {
      const obj = scene.objects.find((o) => o.id === objEl.dataset.objectId);
      if (obj) startObjectDrag(e, obj, objEl);
      return;
    }
    // 空いている場所：クリックで再生位置を移動、ドラッグで範囲選択
    const origin = locate(e.clientX, e.clientY);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const base = additive ? getState().selection : [];
    let dragged = false;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const p = locate(ev.clientX, ev.clientY);
      if (!dragged && Math.abs(p.x - origin.x) < 4 && Math.abs(p.y - origin.y) < 4) return;
      dragged = true;
      setBand({ x0: origin.x, y0: origin.y, x1: p.x, y1: p.y });
      const f0 = Math.min(origin.x, p.x) / ppf;
      const f1 = Math.max(origin.x, p.x) / ppf;
      const r0 = Math.floor(Math.min(origin.y, p.y) / LAYER_H);
      const r1 = Math.floor(Math.max(origin.y, p.y) / LAYER_H);
      const hits = scene.objects
        .filter((o) => {
          const r = rowIndex.get(o.layer);
          return r !== undefined && r >= r0 && r <= r1 && o.start < f1 && objectEnd(o) > f0;
        })
        .map((o) => o.id);
      setSelection([...new Set([...base, ...hits])]);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      setBand(null);
      if (!dragged) {
        if (!additive) setSelection([]);
        seek(origin.frame);
      }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const { frame, layer } = locate(e.clientX, e.clientY);
    const objEl = (e.target as HTMLElement).closest<HTMLElement>('[data-object-id]');
    if (objEl) {
      const id = objEl.dataset.objectId!;
      if (!getState().selection.includes(id)) setSelection([id]);
      openContextMenu(e.clientX, e.clientY, [
        {
          label: t('この位置で分割'),
          shortcut: 'S',
          action: () => {
            playback.pause();
            setPlayhead(frame);
            splitAtPlayhead();
          },
        },
        { label: t('複製'), shortcut: 'Ctrl+D', action: duplicateSelection },
        { label: t('コピー'), shortcut: 'Ctrl+C', action: copySelection },
        {
          label: t('前のオブジェクトの終了時の値を引き継ぐ'),
          action: () => inheritFromPrevious(id),
        },
        'separator',
        { label: t('削除'), shortcut: 'Delete', action: deleteSelection },
        {
          label: t('削除して後ろを詰める'),
          shortcut: 'Shift+Delete',
          action: rippleDeleteSelection,
        },
      ]);
      return;
    }
    const add = (type: ObjectType) => () =>
      // 英語表示のときは、テキストの最初の文字も英語にする
      addObject(
        type,
        layer,
        frame,
        type === 'text' && t('テキスト') !== 'テキスト' ? { params: { text: t('テキスト') } } : {},
      );
    const state = getState();
    const otherScenes = referableScenes(state.project, state.sceneId);
    openContextMenu(e.clientX, e.clientY, [
      { label: t('テキストを追加'), action: add('text') },
      { label: t('図形を追加'), action: add('shape') },
      { label: t('単色を追加'), action: add('solid') },
      { label: t('パーティクルを追加'), action: add('particles') },
      {
        label: t('シーンを追加（別のシーンを素材にする）'),
        disabled: otherScenes.length === 0,
        action: () =>
          addObject('scene', layer, frame, {
            params: { sceneRef: otherScenes[0].id },
            length: sceneObjectLength(state.project, otherScenes[0].id),
          }),
      },
      {
        label: t('フレームバッファを追加（上までの画面を素材にする）'),
        action: add('framebuffer'),
      },
      {
        label: t('音声波形を追加（音声・動画の音を表示する）'),
        action: () => {
          // 音のあるオブジェクトのレイヤーを対象にする（なければ 1 つ下のレイヤー）
          const withSound = currentScene()
            .objects.filter((o) => o.type === 'audio' || o.type === 'video')
            .sort((a, b) => Math.abs(a.start - frame) - Math.abs(b.start - frame))[0];
          addObject('audioWave', layer, frame, {
            params: { targetLayer: withSound?.layer ?? clampLayer(layer + 1) },
          });
        },
      },
      'separator',
      { label: t('フィルタを追加（上のレイヤー全体にエフェクト）'), action: add('filter') },
      { label: t('部分フィルタを追加（範囲の中だけエフェクト）'), action: add('partialFilter') },
      { label: t('グループ制御を追加（下のレイヤーをまとめて動かす）'), action: add('group') },
      { label: t('時間制御を追加（下のレイヤーの時間を変える）'), action: add('timeControl') },
      { label: t('カメラ制御を追加（下のレイヤーを 3D で撮影）'), action: add('camera') },
      ...usePresets
        .getState()
        .objects.filter(canAddFromPreset)
        .map((p) => ({
          label: t('プリセットから追加：{0}', p.name),
          action: () => addObjectFromPreset(p.id, layer, frame),
        })),
      {
        label: t('動画・画像・音声ファイルを追加…'),
        action: async () => {
          const files = await pickFilesWithInput({ accept: MEDIA_ACCEPT, multiple: true });
          const imported = await importMediaFiles(files.map((file) => ({ file })));
          addAssetObjects(imported, layer, frame);
        },
      },
      {
        label: t('字幕ファイル（SRT・WebVTT）を読み込む…'),
        action: async () => {
          const [file] = await pickFilesWithInput({ accept: SUBTITLE_ACCEPT });
          if (file) await importSubtitles(file, layer, frame);
        },
      },
      'separator',
      {
        label: t('空白を詰める（このレイヤー）'),
        disabled: !gapAt(scene, frame, layer),
        action: () => closeGapAt(frame, layer),
      },
      {
        label: t('空白を詰める（すべてのレイヤー）'),
        disabled: !gapAt(scene, frame),
        action: () => closeGapAt(frame),
      },
      'separator',
      {
        label: t('ここに貼り付け'),
        shortcut: 'Ctrl+V',
        action: () => {
          setPlayhead(frame);
          paste();
        },
      },
    ]);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    const types = e.dataTransfer.types;
    if (!types.includes('Files') && !types.includes(ASSET_DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    const { frame, layer } = locate(e.clientX, e.clientY);
    if (!dropTarget || dropTarget.frame !== frame || dropTarget.layer !== layer)
      setDropTarget({ frame, layer });
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const { frame, layer } = locate(e.clientX, e.clientY);
    setDropTarget(null);
    const assetId = e.dataTransfer.getData(ASSET_DRAG_TYPE);
    if (assetId) {
      e.preventDefault();
      e.stopPropagation();
      const asset = getState().project.assets.find((a) => a.id === assetId);
      if (asset) addAssetObjects([asset], layer, frame);
      return;
    }
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    void collectDroppedFiles(e.dataTransfer).then(async (files) => {
      const project = files.find((f) => isProjectFileName(f.file.name));
      if (project) {
        await openProjectFile(project.file, project.handle);
        return;
      }
      for (const f of files.filter((f) => isSubtitleFileName(f.file.name))) {
        await importSubtitles(f.file, layer, frame);
      }
      const media = files.filter((f) => !isSubtitleFileName(f.file.name));
      if (media.length === 0) return;
      const imported = await importMediaFiles(media);
      addAssetObjects(imported, layer, frame);
    });
  };

  // 見えている範囲のオブジェクトだけ描く
  const visibleFrom = viewport.scrollLeft / ppf - 10;
  const visibleTo = (viewport.scrollLeft + viewport.width) / ppf + 10;
  const visibleRowFrom = Math.floor(viewport.scrollTop / LAYER_H) - 1;
  const visibleRowTo = Math.ceil((viewport.scrollTop + viewport.height) / LAYER_H) + 1;
  const visibleObjects = scene.objects.filter((o) => {
    const g = ghost?.get(o.id);
    const start = g?.start ?? o.start;
    const layer = g?.layer ?? o.layer;
    const len = g?.length ?? o.length;
    // 折りたたまれたレイヤーのオブジェクトは描かない（ドラッグ中は表示する）
    if (!g && !rowIndex.has(layer)) return false;
    const row = rowOf(layer);
    return (
      start + len >= visibleFrom &&
      start <= visibleTo &&
      row >= visibleRowFrom &&
      row <= visibleRowTo
    );
  });

  return (
    <section className="panel timeline" aria-label={t('タイムライン')}>
      <div className="timeline-toolbar">
        <h2>{t('タイムライン')}</h2>
        <SceneTabs />
        <label className="toolbar-item" title={t('Ctrl + ホイールでも拡大縮小できます')}>
          {t('拡大')}
          <input
            type="range"
            min={Math.log(MIN_PX_PER_FRAME)}
            max={Math.log(MAX_PX_PER_FRAME)}
            step={0.01}
            value={Math.log(ppf)}
            onChange={(e) => {
              const el = scrollRef.current;
              const s = getState();
              if (el)
                pendingZoom.current = {
                  frame: s.playhead,
                  offset: s.playhead * s.pxPerFrame - el.scrollLeft,
                };
              useEditor.setState({ pxPerFrame: Math.exp(Number(e.target.value)) });
            }}
          />
        </label>
        <label className="toolbar-item">
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={(e) => useUi.setState({ snap: e.target.checked })}
          />
          {t('吸着')}
        </label>
        <button
          type="button"
          className="toolbar-item"
          onClick={addMarkerAtPlayhead}
          title={t('再生位置にマーカーを追加（M）')}
        >
          {t('＋マーカー')}
        </button>
        <button
          type="button"
          className={`toolbar-item ${scene.beatGrid?.visible ? 'active' : ''}`}
          onClick={() => openDialog({ type: 'beatGrid' })}
          title={t('曲のテンポに合わせた目盛り')}
        >
          BPM{scene.beatGrid ? ` ${Math.round(scene.beatGrid.bpm * 100) / 100}` : ''}
        </button>
        <span className="toolbar-hint">
          {t('右クリックでオブジェクトを追加 ・ 素材をドロップして配置')}
        </span>
      </div>
      <div className="timeline-scroll" ref={scrollRef}>
        <div
          className="timeline-grid"
          style={{
            width: HEADER_W + contentWidth,
            height: RULER_H + tracksHeight,
            gridTemplateColumns: `${HEADER_W}px ${contentWidth}px`,
            gridTemplateRows: `${RULER_H}px ${tracksHeight}px`,
          }}
        >
          <div className="tl-corner" />
          <Ruler ppf={ppf} viewport={viewport} contentWidth={contentWidth} />
          <LayerHeaders scene={scene} rows={rows} />
          <div
            className="tl-tracks"
            ref={tracksRef}
            style={{ backgroundSize: `100% ${LAYER_H * 2}px` }}
            onPointerDown={onTracksPointerDown}
            onContextMenu={onContextMenu}
            onDragOver={onDragOver}
            onDragLeave={() => setDropTarget(null)}
            onDrop={onDrop}
            data-testid="timeline-tracks"
          >
            {scene.beatGrid?.visible && (
              <BeatGridLines
                grid={scene.beatGrid}
                fps={fps}
                ppf={ppf}
                from={visibleFrom}
                to={visibleTo}
                height={tracksHeight}
              />
            )}
            {[...hiddenLayers]
              .filter((l) => rowIndex.has(l))
              .map((l) => (
                <div
                  key={`h${l}`}
                  className="tl-hidden-row"
                  style={{ top: rowOf(l) * LAYER_H, height: LAYER_H }}
                />
              ))}
            {visibleObjects.map((o) => (
              <ObjectItem
                key={o.id}
                obj={o}
                label={objectLabel(o, assets, projectScenes)}
                selected={selectedSet.has(o.id)}
                locked={lockedLayers.has(o.layer)}
                ppf={ppf}
                fps={fps}
                assetDuration={assets.find((a) => a.id === o.assetId)?.durationSec ?? 0}
                ghost={ghost?.get(o.id)}
                row={rowOf(ghost?.get(o.id)?.layer ?? o.layer)}
              />
            ))}
            {dropTarget && (
              <div
                className="tl-drop-marker"
                style={{
                  left: dropTarget.frame * ppf,
                  top: rowOf(dropTarget.layer) * LAYER_H,
                  height: LAYER_H,
                }}
              />
            )}
            {band && (
              <div
                className="tl-band"
                style={{
                  left: Math.min(band.x0, band.x1),
                  top: Math.min(band.y0, band.y1),
                  width: Math.abs(band.x1 - band.x0),
                  height: Math.abs(band.y1 - band.y0),
                }}
              />
            )}
            {scene.markers && (
              <MarkerLines markers={scene.markers} ppf={ppf} height={tracksHeight} />
            )}
            <PlayheadLine ppf={ppf} height={tracksHeight} />
          </div>
        </div>
      </div>
    </section>
  );
}
