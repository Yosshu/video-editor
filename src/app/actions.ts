import { secondsToFrames } from '../core/model/time';
import { newId } from '../core/model/ids';
import type {
  Asset,
  EffectInstance,
  ObjectType,
  ParamValue,
  Rational,
  TimelineObject,
} from '../core/model/types';
import { convertFrameRate, frameConverter } from '../core/project/convert';
import { createObject } from '../core/project/factory';
import {
  findFreeStart,
  MAX_LAYERS,
  objectEnd,
  paramsAfterStartChange,
  resolveMove,
  resolveResize,
  sceneDuration,
  splitObject,
} from '../core/timeline/ops';
import { commit, currentScene, getState, notify, setPlayhead, setSelection } from '../state/store';
import { t } from '../i18n';

/** 既定のオブジェクトの長さ（秒） */
const DEFAULT_SECONDS = 5;

function isLayerLocked(layer: number): boolean {
  return currentScene().layers.some((l) => l.index === layer && l.locked);
}

/** 新しいオブジェクトを追加して選択する */
export function addObject(
  type: ObjectType,
  layer: number,
  frame: number,
  init: {
    assetId?: string;
    params?: Record<string, ParamValue>;
    effects?: EffectInstance[];
    length?: number;
  } = {},
): TimelineObject | null {
  const state = getState();
  const scene = currentScene(state);
  const fps = state.project.settings.fps;
  const length = Math.max(1, init.length ?? secondsToFrames(DEFAULT_SECONDS, fps));
  if (isLayerLocked(layer)) {
    notify(t('レイヤー {0} はロックされています。', layer), 'error');
    return null;
  }
  const start = findFreeStart(scene, layer, frame, length);
  const obj = createObject(type, layer, start, length, {
    assetId: init.assetId,
    params: init.params,
  });
  if (init.effects) obj.effects = init.effects;
  commit(t('オブジェクトの追加'), (draft) => {
    draft.scenes.find((s) => s.id === state.sceneId)?.objects.push(obj);
  });
  setSelection([obj.id]);
  return obj;
}

/** 素材からオブジェクトを作る（複数なら同じレイヤーに順に並べる） */
export function addAssetObjects(assets: Asset[], layer: number, frame: number): void {
  const fps = getState().project.settings.fps;
  let at = frame;
  const ids: string[] = [];
  for (const asset of assets) {
    const type: ObjectType =
      asset.kind === 'video' ? 'video' : asset.kind === 'audio' ? 'audio' : 'image';
    if (asset.kind === 'font') continue;
    const length =
      asset.durationSec && (type === 'video' || type === 'audio')
        ? Math.max(1, secondsToFrames(asset.durationSec, fps))
        : undefined;
    const obj = addObject(type, layer, at, { assetId: asset.id, length });
    if (obj) {
      ids.push(obj.id);
      at = objectEnd(obj);
    }
  }
  if (ids.length > 0) setSelection(ids);
}

export function moveObjects(ids: string[], deltaFrames: number, deltaLayers: number): boolean {
  const state = getState();
  const scene = currentScene(state);
  const placements = resolveMove(scene, ids, deltaFrames, deltaLayers);
  if (!placements) return false;
  if (placements.some((p) => isLayerLocked(p.layer))) {
    notify(t('ロックされたレイヤーには移動できません。'), 'error');
    return false;
  }
  commit(t('オブジェクトの移動'), (draft) => {
    const s = draft.scenes.find((x) => x.id === state.sceneId);
    if (!s) return;
    for (const p of placements) {
      const o = s.objects.find((x) => x.id === p.id);
      if (o) {
        o.layer = p.layer;
        o.start = p.start;
      }
    }
  });
  return true;
}

export function resizeObject(id: string, edge: 'start' | 'end', targetFrame: number): void {
  const state = getState();
  const scene = currentScene(state);
  const obj = scene.objects.find((o) => o.id === id);
  const next = resolveResize(scene, id, edge, targetFrame);
  if (!obj || !next) return;
  if (next.start === obj.start && next.length === obj.length) return;
  const params =
    edge === 'start'
      ? paramsAfterStartChange(obj, next.start, state.project.settings.fps)
      : obj.params;
  commit(t('長さの変更'), (draft) => {
    const o = draft.scenes.find((x) => x.id === state.sceneId)?.objects.find((x) => x.id === id);
    if (!o) return;
    o.start = next.start;
    o.length = next.length;
    o.params = params;
  });
}

/** 開始フレームと長さを数値で指定する（設定パネルから） */
export function setObjectTiming(id: string, start: number, length: number): void {
  const state = getState();
  const scene = currentScene(state);
  const obj = scene.objects.find((o) => o.id === id);
  if (!obj) return;
  const placements = resolveMove(scene, [id], Math.max(0, start) - obj.start, 0);
  if (!placements) {
    notify(t('他のオブジェクトと重なるため移動できません。'), 'error');
    return;
  }
  const newStart = placements[0].start;
  const moved = { ...obj, start: newStart };
  const others = { ...scene, objects: scene.objects.map((o) => (o.id === id ? moved : o)) };
  const resized = resolveResize(others, id, 'end', newStart + Math.max(1, Math.round(length)));
  commit(t('時間の変更'), (draft) => {
    const o = draft.scenes.find((x) => x.id === state.sceneId)?.objects.find((x) => x.id === id);
    if (!o) return;
    o.start = newStart;
    o.length = resized?.length ?? o.length;
  });
}

export function deleteSelection(): void {
  const { selection, sceneId } = getState();
  if (selection.length === 0) return;
  const locked = currentScene().objects.filter(
    (o) => selection.includes(o.id) && isLayerLocked(o.layer),
  );
  const ids = new Set(selection.filter((id) => !locked.some((o) => o.id === id)));
  commit(t('削除'), (draft) => {
    const s = draft.scenes.find((x) => x.id === sceneId);
    if (s) s.objects = s.objects.filter((o) => !ids.has(o.id));
  });
  setSelection([]);
}

/** 再生位置で分割する（選択中があればそれだけ、なければ再生位置にあるもの全部） */
export function splitAtPlayhead(): void {
  const state = getState();
  const scene = currentScene(state);
  const frame = state.playhead;
  const candidates = scene.objects.filter(
    (o) => frame > o.start && frame < objectEnd(o) && !isLayerLocked(o.layer),
  );
  const targets =
    state.selection.length > 0
      ? candidates.filter((o) => state.selection.includes(o.id))
      : candidates;
  if (targets.length === 0) return;
  const newIds: string[] = [];
  commit(t('分割'), (draft) => {
    const s = draft.scenes.find((x) => x.id === state.sceneId);
    if (!s) return;
    for (const t of targets) {
      const result = splitObject(t, frame, state.project.settings.fps, newId('ob'));
      if (!result) continue;
      const index = s.objects.findIndex((o) => o.id === t.id);
      s.objects.splice(index, 1, result[0], result[1]);
      newIds.push(result[1].id);
    }
  });
  if (state.selection.length > 0) setSelection(newIds);
}

let clipboard: { objects: TimelineObject[]; baseFrame: number; baseLayer: number } | null = null;

export function copySelection(): void {
  const { selection } = getState();
  const objects = currentScene().objects.filter((o) => selection.includes(o.id));
  if (objects.length === 0) return;
  clipboard = {
    objects: structuredClone(objects),
    baseFrame: Math.min(...objects.map((o) => o.start)),
    baseLayer: Math.min(...objects.map((o) => o.layer)),
  };
}

export function cutSelection(): void {
  copySelection();
  deleteSelection();
}

/** 貼り付け。再生位置を先頭にし、元のレイヤーに置く（重なる場合は後ろへずらす） */
export function paste(): void {
  if (!clipboard) return;
  const state = getState();
  const delta = state.playhead - clipboard.baseFrame;
  const pasted: TimelineObject[] = clipboard.objects.map((o) => ({
    ...structuredClone(o),
    id: newId('ob'),
    start: o.start + delta,
  }));
  commit(t('貼り付け'), (draft) => {
    const s = draft.scenes.find((x) => x.id === state.sceneId);
    if (!s) return;
    for (const o of pasted) {
      o.start = findFreeStart(s, o.layer, o.start, o.length);
      s.objects.push(o);
    }
  });
  setSelection(pasted.map((o) => o.id));
}

export function duplicateSelection(): void {
  const { selection } = getState();
  const objects = currentScene().objects.filter((o) => selection.includes(o.id));
  if (objects.length === 0) return;
  // 選択範囲の直後に複製する
  copySelection();
  const saved = getState().playhead;
  setPlayhead(Math.max(...objects.map(objectEnd)));
  paste();
  setPlayhead(saved);
}

export function selectAll(): void {
  setSelection(currentScene().objects.map((o) => o.id));
}

/** パラメータを変更する（連続した変更は 1 つの履歴にまとめる） */
export function setParam(objectId: string, paramId: string, value: ParamValue): void {
  const { sceneId } = getState();
  commit(
    t('パラメータの変更'),
    (draft) => {
      const o = draft.scenes.find((s) => s.id === sceneId)?.objects.find((x) => x.id === objectId);
      if (o) o.params[paramId] = value;
    },
    { mergeKey: `param:${objectId}:${paramId}` },
  );
}

export function updateLayer(
  index: number,
  patch: { name?: string; hidden?: boolean; locked?: boolean },
): void {
  const { sceneId } = getState();
  commit(t('レイヤーの変更'), (draft) => {
    const s = draft.scenes.find((x) => x.id === sceneId);
    if (!s) return;
    let layer = s.layers.find((l) => l.index === index);
    if (!layer) {
      layer = { index };
      s.layers.push(layer);
    }
    Object.assign(layer, patch);
    if (layer.name === '') delete layer.name;
    if (layer.hidden === false) delete layer.hidden;
    if (layer.locked === false) delete layer.locked;
    if (Object.keys(layer).length === 1) s.layers = s.layers.filter((l) => l !== layer);
  });
}

export function stepFrames(delta: number): void {
  const { playhead } = getState();
  setPlayhead(Math.max(0, playhead + delta));
}

export function jumpToStart(): void {
  setPlayhead(0);
}

export function jumpToEnd(): void {
  setPlayhead(Math.max(0, sceneDuration(currentScene()) - 1));
}

export function clampLayer(layer: number): number {
  return Math.max(1, Math.min(MAX_LAYERS, layer));
}

export function updateProjectSettings(patch: {
  backgroundColor?: string;
  width?: number;
  height?: number;
  fps?: Rational;
  sampleRate?: number;
}): void {
  const state = getState();
  const old = state.project.settings;
  const fpsChanged =
    patch.fps !== undefined && (patch.fps.num !== old.fps.num || patch.fps.den !== old.fps.den);
  commit(t('プロジェクト設定の変更'), (draft) => {
    // フレームレートを変えるときは、すべての時間を換算する
    if (fpsChanged) convertFrameRate(draft, patch.fps!);
    const { fps: _fps, ...rest } = patch;
    Object.assign(draft.settings, rest);
    if (patch.width || patch.height) {
      for (const s of draft.scenes) {
        s.width = draft.settings.width;
        s.height = draft.settings.height;
      }
    }
  });
  if (fpsChanged) setPlayhead(frameConverter(old.fps, patch.fps!)(state.playhead));
}
