import { isAnimated } from '../core/animation/interpolate';
import {
  addKeyAt,
  addMidpoint,
  clearAnimation,
  hasKeyAt,
  moveMidpoint,
  neighborKey,
  removeKeyAt,
  removeMidpoint,
  setEaseAt,
  setValueAt,
} from '../core/animation/keys';
import type { Ease, ParamMap, ParamValue, TimelineObject } from '../core/model/types';
import { getObjectDef } from '../core/objects/definitions';
import type { NumberParamDef } from '../core/params/defs';
import { commit, currentScene, getState, setPlayhead } from '../state/store';

function findObject(objectId: string): TimelineObject | undefined {
  return currentScene().objects.find((o) => o.id === objectId);
}

/** 再生位置のオブジェクト内での相対フレーム（オブジェクトの範囲内に収める） */
export function localFrameOf(obj: TimelineObject, playhead = getState().playhead): number {
  return Math.min(Math.max(0, playhead - obj.start), obj.length - 1);
}

function updateParams(
  objectId: string,
  label: string,
  fn: (params: ParamMap, obj: TimelineObject) => ParamMap,
  mergeKey?: string,
) {
  const { sceneId } = getState();
  commit(
    label,
    (draft) => {
      const o = draft.scenes.find((s) => s.id === sceneId)?.objects.find((x) => x.id === objectId);
      if (o) o.params = fn(o.params as ParamMap, o as TimelineObject);
    },
    mergeKey ? { mergeKey } : {},
  );
}

function numberDefaults(obj: TimelineObject): {
  defaults: Record<string, number>;
  animatable: string[];
} {
  const defs = getObjectDef(obj.type).params.filter(
    (p): p is NumberParamDef => p.kind === 'number',
  );
  return {
    defaults: Object.fromEntries(defs.map((d) => [d.id, d.default])),
    animatable: defs.filter((d) => d.animatable).map((d) => d.id),
  };
}

/**
 * 再生位置でパラメータを変更する。アニメーション中の数値はその時刻にキーを打つ。
 */
export function setParamAtPlayhead(objectId: string, paramId: string, value: ParamValue): void {
  const obj = findObject(objectId);
  if (!obj) return;
  const t = localFrameOf(obj);
  updateParams(
    objectId,
    'パラメータの変更',
    (params) => {
      const current = params[paramId];
      const next =
        typeof value === 'number' && isAnimated(current) ? setValueAt(current, t, value) : value;
      return { ...params, [paramId]: next };
    },
    `param:${objectId}:${paramId}:${t}`,
  );
}

/** 再生位置のキーを追加・削除する */
export function toggleKeyAtPlayhead(objectId: string, paramId: string, fallback: number): void {
  const obj = findObject(objectId);
  if (!obj) return;
  const t = localFrameOf(obj);
  const value = obj.params[paramId];
  if (hasKeyAt(value, t) && isAnimated(value)) {
    updateParams(objectId, 'キーフレームの削除', (p) => ({
      ...p,
      [paramId]: removeKeyAt(value, t),
    }));
  } else {
    updateParams(objectId, 'キーフレームの追加', (p) => ({
      ...p,
      [paramId]: addKeyAt(value, t, fallback),
    }));
  }
}

export function clearParamAnimation(objectId: string, paramId: string, fallback: number): void {
  const obj = findObject(objectId);
  if (!obj) return;
  const t = localFrameOf(obj);
  updateParams(objectId, 'アニメーションの解除', (p) => ({
    ...p,
    [paramId]: clearAnimation(p[paramId], t, fallback),
  }));
}

export function setEaseAtPlayhead(objectId: string, paramId: string, ease: Ease): void {
  const obj = findObject(objectId);
  const value = obj?.params[paramId];
  if (!obj || !isAnimated(value)) return;
  const t = localFrameOf(obj);
  updateParams(
    objectId,
    '変化の仕方の変更',
    (p) => ({ ...p, [paramId]: setEaseAt(value, t, ease) }),
    `ease:${objectId}:${paramId}:${t}`,
  );
}

/** 前後のキーへ再生位置を移動する */
export function jumpToKey(objectId: string, paramId: string, direction: -1 | 1): void {
  const obj = findObject(objectId);
  const value = obj?.params[paramId];
  if (!obj || !isAnimated(value)) return;
  const t = neighborKey(value, localFrameOf(obj), direction);
  if (t !== null) setPlayhead(obj.start + Math.min(Math.max(0, t), obj.length - 1));
}

export function addMidpointAtPlayhead(objectId: string): void {
  const obj = findObject(objectId);
  if (!obj) return;
  const t = localFrameOf(obj);
  const { defaults, animatable } = numberDefaults(obj);
  updateParams(objectId, '中間点の追加', (p) => addMidpoint(p, t, defaults, animatable));
}

export function removeMidpointAtPlayhead(objectId: string): void {
  const obj = findObject(objectId);
  if (!obj) return;
  updateParams(objectId, '中間点の削除', (p) => removeMidpoint(p, localFrameOf(obj)));
}

export function moveMidpointOf(objectId: string, from: number, to: number): void {
  const obj = findObject(objectId);
  if (!obj) return;
  const clamped = Math.min(Math.max(0, to), obj.length - 1);
  updateParams(objectId, '中間点の移動', (p) => moveMidpoint(p, from, clamped));
}
