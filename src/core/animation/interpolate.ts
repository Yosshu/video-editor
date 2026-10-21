import type { Animated, Keyframe, ParamValue } from '../model/types';
import { applyEase } from './ease';

export function isAnimated(value: ParamValue | undefined): value is Animated {
  return typeof value === 'object' && value !== null && Array.isArray((value as Animated).keys);
}

/** キーフレームを時刻順に並べ、同じ時刻の重複を後勝ちで取り除く */
export function normalizeKeys(keys: Keyframe[]): Keyframe[] {
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  const result: Keyframe[] = [];
  for (const k of sorted) {
    if (result.length > 0 && result[result.length - 1].t === k.t) result[result.length - 1] = k;
    else result.push(k);
  }
  return result;
}

/** キーフレームの時刻 t（相対フレーム）における値 */
export function keysValueAt(keys: Keyframe[], t: number): number {
  if (keys.length === 0) return 0;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  // 二分探索で t を挟む 2 点を見つける
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = keys[lo];
  const b = keys[hi];
  const span = b.t - a.t;
  if (span <= 0) return b.v;
  const p = applyEase(a.ease, (t - a.t) / span);
  return a.v + (b.v - a.v) * p;
}

/** パラメータの値を時刻 t（オブジェクト開始からの相対フレーム）で評価する */
export function valueAt(value: ParamValue | undefined, t: number, fallback: number): number;
export function valueAt<T extends string | boolean>(
  value: ParamValue | undefined,
  t: number,
  fallback: T,
): T;
export function valueAt(
  value: ParamValue | undefined,
  t: number,
  fallback: number | string | boolean,
): number | string | boolean {
  if (value === undefined) return fallback;
  if (isAnimated(value)) return keysValueAt(value.keys, t);
  if (typeof fallback === 'number' && typeof value !== 'number') return fallback;
  return value;
}

/**
 * アニメーションの値を、オブジェクトを分割した位置 at で 2 つに分ける。
 * 分割前と同じ値になるよう、分割点をまたぐ区間のキーは両側に残す（範囲外のキーになる）。
 */
export function splitAnimated(value: Animated, at: number): [Animated, Animated] {
  const keys = normalizeKeys(value.keys);
  const firstAfter = keys.findIndex((k) => k.t >= at);
  const left = firstAfter === -1 ? keys : keys.slice(0, firstAfter + 1);
  const lastBefore =
    firstAfter === -1 ? keys.length - 1 : keys[firstAfter].t === at ? firstAfter : firstAfter - 1;
  const right = keys.slice(Math.max(0, lastBefore)).map((k) => ({ ...k, t: k.t - at }));
  return [{ keys: left }, { keys: right }];
}
