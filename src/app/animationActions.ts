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
import { getEffectDef } from '../core/effects/definitions';
import type { Ease, ParamMap, ParamValue, TimelineObject } from '../core/model/types';
import { getObjectDef } from '../core/objects/definitions';
import type { NumberParamDef, ParamDef } from '../core/params/defs';
import { commit, currentScene, getState, setPlayhead } from '../state/store';

function findObject(objectId: string): TimelineObject | undefined {
  return currentScene().objects.find((o) => o.id === objectId);
}

/** 再生位置のオブジェクト内での相対フレーム（オブジェクトの範囲内に収める） */
export function localFrameOf(obj: TimelineObject, playhead = getState().playhead): number {
  return Math.min(Math.max(0, playhead - obj.start), obj.length - 1);
}

/** オブジェクト自身、またはそのエフェクトのパラメータ */
function paramsOf(obj: TimelineObject, effectId?: string): ParamMap | undefined {
  if (!effectId) return obj.params;
  return obj.effects.find((e) => e.id === effectId)?.params;
}

function updateParams(
  objectId: string,
  label: string,
  fn: (params: ParamMap) => ParamMap,
  options: { mergeKey?: string; effectId?: string } = {},
) {
  const { sceneId } = getState();
  commit(
    label,
    (draft) => {
      const o = draft.scenes.find((s) => s.id === sceneId)?.objects.find((x) => x.id === objectId);
      if (!o) return;
      if (options.effectId) {
        const e = o.effects.find((x) => x.id === options.effectId);
        if (e) e.params = fn(e.params as ParamMap);
      } else {
        o.params = fn(o.params as ParamMap);
      }
    },
    options.mergeKey ? { mergeKey: options.mergeKey } : {},
  );
}

function numberInfo(defs: ParamDef[]): { defaults: Record<string, number>; animatable: string[] } {
  const nums = defs.filter((p): p is NumberParamDef => p.kind === 'number');
  return {
    defaults: Object.fromEntries(nums.map((d) => [d.id, d.default])),
    animatable: nums.filter((d) => d.animatable).map((d) => d.id),
  };
}

/**
 * 再生位置でパラメータを変更する。アニメーション中の数値はその時刻にキーを打つ。
 */
export function setParamAtPlayhead(
  objectId: string,
  paramId: string,
  value: ParamValue,
  effectId?: string,
): void {
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
    { mergeKey: `param:${objectId}:${effectId ?? ''}:${paramId}:${t}`, effectId },
  );
}

/** 再生位置のキーを追加・削除する */
export function toggleKeyAtPlayhead(
  objectId: string,
  paramId: string,
  fallback: number,
  effectId?: string,
): void {
  const obj = findObject(objectId);
  const params = obj && paramsOf(obj, effectId);
  if (!obj || !params) return;
  const t = localFrameOf(obj);
  const value = params[paramId];
  if (hasKeyAt(value, t) && isAnimated(value)) {
    updateParams(
      objectId,
      'キーフレームの削除',
      (p) => ({ ...p, [paramId]: removeKeyAt(value, t) }),
      {
        effectId,
      },
    );
  } else {
    updateParams(
      objectId,
      'キーフレームの追加',
      (p) => ({ ...p, [paramId]: addKeyAt(value, t, fallback) }),
      { effectId },
    );
  }
}

export function clearParamAnimation(
  objectId: string,
  paramId: string,
  fallback: number,
  effectId?: string,
): void {
  const obj = findObject(objectId);
  if (!obj) return;
  const t = localFrameOf(obj);
  updateParams(
    objectId,
    'アニメーションの解除',
    (p) => ({ ...p, [paramId]: clearAnimation(p[paramId], t, fallback) }),
    { effectId },
  );
}

export function setEaseAtPlayhead(
  objectId: string,
  paramId: string,
  ease: Ease,
  effectId?: string,
): void {
  const obj = findObject(objectId);
  const value = obj && paramsOf(obj, effectId)?.[paramId];
  if (!obj || !isAnimated(value)) return;
  const t = localFrameOf(obj);
  updateParams(
    objectId,
    '変化の仕方の変更',
    (p) => ({ ...p, [paramId]: setEaseAt(value, t, ease) }),
    {
      mergeKey: `ease:${objectId}:${effectId ?? ''}:${paramId}:${t}`,
      effectId,
    },
  );
}

/** 前後のキーへ再生位置を移動する */
export function jumpToKey(
  objectId: string,
  paramId: string,
  direction: -1 | 1,
  effectId?: string,
): void {
  const obj = findObject(objectId);
  const value = obj && paramsOf(obj, effectId)?.[paramId];
  if (!obj || !isAnimated(value)) return;
  const t = neighborKey(value, localFrameOf(obj), direction);
  if (t !== null) setPlayhead(obj.start + Math.min(Math.max(0, t), obj.length - 1));
}

/** オブジェクトとエフェクトのパラメータすべてに同じ処理をする（中間点の操作） */
function updateAllParams(
  objectId: string,
  label: string,
  objectFn: (params: ParamMap) => ParamMap,
  effectFn: (params: ParamMap, type: string) => ParamMap,
): void {
  const { sceneId } = getState();
  commit(label, (draft) => {
    const o = draft.scenes.find((s) => s.id === sceneId)?.objects.find((x) => x.id === objectId);
    if (!o) return;
    o.params = objectFn(o.params as ParamMap);
    for (const e of o.effects) e.params = effectFn(e.params as ParamMap, e.type);
  });
}

export function addMidpointAtPlayhead(objectId: string): void {
  const obj = findObject(objectId);
  if (!obj) return;
  const t = localFrameOf(obj);
  const { defaults, animatable } = numberInfo(getObjectDef(obj.type).params);
  updateAllParams(
    objectId,
    '中間点の追加',
    (p) => addMidpoint(p, t, defaults, animatable),
    (p, type) => {
      // エフェクトは、すでに動いているパラメータにだけキーを打つ
      const info = numberInfo(getEffectDef(type)?.params ?? []);
      const moving = info.animatable.filter((id) => isAnimated(p[id]));
      return moving.length > 0 ? addMidpoint(p, t, info.defaults, moving) : p;
    },
  );
}

export function removeMidpointAtPlayhead(objectId: string): void {
  const obj = findObject(objectId);
  if (!obj) return;
  const t = localFrameOf(obj);
  updateAllParams(
    objectId,
    '中間点の削除',
    (p) => removeMidpoint(p, t),
    (p) => removeMidpoint(p, t),
  );
}

export function moveMidpointOf(objectId: string, from: number, to: number): void {
  const obj = findObject(objectId);
  if (!obj) return;
  const clamped = Math.min(Math.max(0, to), obj.length - 1);
  updateAllParams(
    objectId,
    '中間点の移動',
    (p) => moveMidpoint(p, from, clamped),
    (p) => moveMidpoint(p, from, clamped),
  );
}
