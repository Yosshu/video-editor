import type { Animated, Ease, Keyframe, ParamMap, ParamValue } from '../model/types';
import { isAnimated, keysValueAt, normalizeKeys } from './interpolate';

/** 数値パラメータの現在値（固定値・アニメーションのどちらでも） */
function numberAt(value: ParamValue | undefined, t: number, fallback: number): number {
  if (isAnimated(value)) return keysValueAt(normalizeKeys(value.keys), t);
  return typeof value === 'number' ? value : fallback;
}

export function hasKeyAt(value: ParamValue | undefined, t: number): boolean {
  return isAnimated(value) && value.keys.some((k) => k.t === t);
}

/**
 * 時刻 t の値を v にする。アニメーション中ならその時刻にキーを打つ（既存のキーなら値だけ変える）。
 */
export function setValueAt(value: ParamValue | undefined, t: number, v: number): ParamValue {
  if (!isAnimated(value)) return v;
  const keys = normalizeKeys(value.keys);
  const i = keys.findIndex((k) => k.t === t);
  if (i >= 0) keys[i] = { ...keys[i], v };
  else {
    // 新しいキーは、その区間の変化の仕方を引き継ぐ
    const prev = [...keys].reverse().find((k) => k.t < t);
    keys.push({ t, v, ...(prev?.ease !== undefined ? { ease: prev.ease } : {}) });
  }
  return { keys: normalizeKeys(keys) };
}

/** 時刻 t にキーを追加する（固定値ならアニメーションに切り替える） */
export function addKeyAt(value: ParamValue | undefined, t: number, fallback: number): Animated {
  const v = numberAt(value, t, fallback);
  if (!isAnimated(value)) return { keys: [{ t, v }] };
  return setValueAt(value, t, v) as Animated;
}

/** 時刻 t のキーを削除する。キーがなくなったら、その時刻の値の固定値に戻す */
export function removeKeyAt(value: Animated, t: number): ParamValue {
  const current = keysValueAt(normalizeKeys(value.keys), t);
  const keys = value.keys.filter((k) => k.t !== t);
  if (keys.length === 0) return current;
  return { keys: normalizeKeys(keys) };
}

/** アニメーションをやめて、時刻 t の値の固定値にする */
export function clearAnimation(value: ParamValue | undefined, t: number, fallback: number): number {
  return numberAt(value, t, fallback);
}

/**
 * t を含む区間の始まりのキーの位置。区間は「あるキーから次のキーまで」で、
 * 最後のキー以降は最後の区間、最初のキーより前は最初の区間とみなす。
 */
function segmentIndex(keys: Keyframe[], t: number): number {
  let index = 0;
  for (let i = 0; i < keys.length; i++) if (keys[i].t <= t) index = i;
  return Math.max(0, Math.min(index, keys.length - 2));
}

/** t を含む区間の変化の仕方 */
export function easeAt(value: Animated, t: number): Ease | undefined {
  const keys = normalizeKeys(value.keys);
  return keys[segmentIndex(keys, t)]?.ease;
}

/** t を含む区間の変化の仕方を変える */
export function setEaseAt(value: Animated, t: number, ease: Ease): Animated {
  const keys = normalizeKeys(value.keys);
  if (keys.length === 0) return value;
  const index = segmentIndex(keys, t);
  keys[index] = { ...keys[index], ease };
  if (ease === 'linear') delete keys[index].ease;
  return { keys };
}

/** 前後のキーの時刻 */
export function neighborKey(value: Animated, t: number, direction: -1 | 1): number | null {
  const times = normalizeKeys(value.keys).map((k) => k.t);
  if (direction < 0) {
    const prev = times.filter((x) => x < t);
    return prev.length ? prev[prev.length - 1] : null;
  }
  return times.find((x) => x > t) ?? null;
}

/** オブジェクトのすべてのパラメータのキーの時刻（0 以上 length 未満） */
export function keyTimes(params: ParamMap, length: number): number[] {
  const set = new Set<number>();
  for (const v of Object.values(params)) {
    if (!isAnimated(v)) continue;
    for (const k of v.keys) if (k.t >= 0 && k.t < length) set.add(k.t);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * 中間点：アニメーション中のすべてのパラメータの同じ時刻にキーを打つ。
 * 固定値のパラメータは animatableIds に含まれていれば、その時点の値でアニメーションに切り替える。
 */
export function addMidpoint(
  params: ParamMap,
  t: number,
  defaults: Record<string, number>,
  animatableIds: string[],
): ParamMap {
  const out: ParamMap = { ...params };
  const anyAnimated = Object.values(params).some(isAnimated);
  for (const id of animatableIds) {
    const value = params[id];
    if (isAnimated(value)) out[id] = addKeyAt(value, t, defaults[id] ?? 0);
    else if (!anyAnimated) {
      // まだ何も動いていなければ、開始時点と中間点の 2 つのキーを持つアニメーションにする
      const v = numberAt(value, t, defaults[id] ?? 0);
      out[id] =
        t === 0
          ? { keys: [{ t: 0, v }] }
          : {
              keys: [
                { t: 0, v },
                { t, v },
              ],
            };
    }
  }
  return out;
}

/** 中間点の削除：すべてのパラメータの時刻 t のキーを削除する */
export function removeMidpoint(params: ParamMap, t: number): ParamMap {
  const out: ParamMap = {};
  for (const [id, value] of Object.entries(params)) {
    out[id] =
      isAnimated(value) && value.keys.some((k) => k.t === t) ? removeKeyAt(value, t) : value;
  }
  return out;
}

/** 中間点の移動：すべてのパラメータの時刻 from のキーを to へ動かす（to にあるキーは置き換える） */
export function moveMidpoint(params: ParamMap, from: number, to: number): ParamMap {
  if (from === to) return params;
  const out: ParamMap = {};
  for (const [id, value] of Object.entries(params)) {
    if (!isAnimated(value) || !value.keys.some((k) => k.t === from)) {
      out[id] = value;
      continue;
    }
    const moved: Keyframe[] = value.keys
      .filter((k) => k.t !== to)
      .map((k) => (k.t === from ? { ...k, t: to } : k));
    out[id] = { keys: normalizeKeys(moved) };
  }
  return out;
}
