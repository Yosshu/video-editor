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
import { lengthFollowsSpeed, lengthForSpeed, speedOf } from '../core/timeline/speed';
import { commit, currentScene, getState, notify, setPlayhead } from '../state/store';
import { t } from '../i18n';

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
 * 速度を続けて変えている間の、変え始める前の長さと速度。
 * スライダーで遅くして次のオブジェクトの手前で止まった後に戻しても、元の長さに戻るようにする。
 * 最後に設定した長さ・速度から変わっていたら（ほかの操作で変えられたら）、そこから数え直す
 */
const speedBases = new Map<
  string,
  { length: number; speed: number; lastLength: number; lastSpeed: number; notified: boolean }
>();

/** 再生速度を変え、素材の同じ範囲を再生するよう長さも変える（遅くするときは次のオブジェクトの手前まで） */
function setSpeed(obj: TimelineObject, speed: number): void {
  const { sceneId, project } = getState();
  const animated =
    obj.type === 'image' && !!project.assets.find((a) => a.id === obj.assetId)?.durationSec;
  let base = speedBases.get(obj.id);
  if (!base || base.lastLength !== obj.length || base.lastSpeed !== speedOf(obj)) {
    base = {
      length: obj.length,
      speed: speedOf(obj),
      lastLength: obj.length,
      lastSpeed: speedOf(obj),
      notified: false,
    };
    speedBases.set(obj.id, base);
  }
  const follows = lengthFollowsSpeed(obj, animated);
  const { length, clamped } = follows
    ? lengthForSpeed(currentScene(), obj, base, speed)
    : { length: obj.length, clamped: false };
  commit(
    t('パラメータの変更'),
    (draft) => {
      const o = draft.scenes.find((s) => s.id === sceneId)?.objects.find((x) => x.id === obj.id);
      if (!o) return;
      o.params.speed = speed;
      o.length = length;
    },
    { mergeKey: `speed:${obj.id}` },
  );
  base.lastLength = length;
  base.lastSpeed = speed;
  if (clamped && !base.notified) {
    base.notified = true;
    notify(t('同じレイヤーの次のオブジェクトの手前までの長さにしました。'));
  }
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
  // 素材の再生速度（パーティクルの「速さ」や時間制御の速度は別のもの）
  const playback = ['video', 'audio', 'scene', 'image'].includes(obj.type);
  if (paramId === 'speed' && playback && !effectId && typeof value === 'number' && value > 0) {
    setSpeed(obj, value);
    return;
  }
  const at = localFrameOf(obj);
  updateParams(
    objectId,
    t('パラメータの変更'),
    (params) => {
      const current = params[paramId];
      const next =
        typeof value === 'number' && isAnimated(current) ? setValueAt(current, at, value) : value;
      return { ...params, [paramId]: next };
    },
    { mergeKey: `param:${objectId}:${effectId ?? ''}:${paramId}:${at}`, effectId },
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
  const at = localFrameOf(obj);
  const value = params[paramId];
  if (hasKeyAt(value, at) && isAnimated(value)) {
    updateParams(
      objectId,
      t('キーフレームの削除'),
      (p) => ({ ...p, [paramId]: removeKeyAt(value, at) }),
      {
        effectId,
      },
    );
  } else {
    updateParams(
      objectId,
      t('キーフレームの追加'),
      (p) => ({ ...p, [paramId]: addKeyAt(value, at, fallback) }),
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
  const at = localFrameOf(obj);
  updateParams(
    objectId,
    t('アニメーションの解除'),
    (p) => ({ ...p, [paramId]: clearAnimation(p[paramId], at, fallback) }),
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
  const at = localFrameOf(obj);
  updateParams(
    objectId,
    t('変化の仕方の変更'),
    (p) => ({ ...p, [paramId]: setEaseAt(value, at, ease) }),
    {
      mergeKey: `ease:${objectId}:${effectId ?? ''}:${paramId}:${at}`,
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
  const at = neighborKey(value, localFrameOf(obj), direction);
  if (at !== null) setPlayhead(obj.start + Math.min(Math.max(0, at), obj.length - 1));
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
  const at = localFrameOf(obj);
  const { defaults, animatable } = numberInfo(getObjectDef(obj.type).params);
  updateAllParams(
    objectId,
    t('中間点の追加'),
    (p) => addMidpoint(p, at, defaults, animatable),
    (p, type) => {
      // エフェクトは、すでに動いているパラメータにだけキーを打つ
      const info = numberInfo(getEffectDef(type)?.params ?? []);
      const moving = info.animatable.filter((id) => isAnimated(p[id]));
      return moving.length > 0 ? addMidpoint(p, at, info.defaults, moving) : p;
    },
  );
}

export function removeMidpointAtPlayhead(objectId: string): void {
  const obj = findObject(objectId);
  if (!obj) return;
  const at = localFrameOf(obj);
  updateAllParams(
    objectId,
    t('中間点の削除'),
    (p) => removeMidpoint(p, at),
    (p) => removeMidpoint(p, at),
  );
}

export function moveMidpointOf(objectId: string, from: number, to: number): void {
  const obj = findObject(objectId);
  if (!obj) return;
  const clamped = Math.min(Math.max(0, to), obj.length - 1);
  updateAllParams(
    objectId,
    t('中間点の移動'),
    (p) => moveMidpoint(p, from, clamped),
    (p) => moveMidpoint(p, from, clamped),
  );
}
