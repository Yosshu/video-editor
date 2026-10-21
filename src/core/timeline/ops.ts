import { isAnimated, splitAnimated } from '../animation/interpolate';
import { framesToSeconds } from '../model/time';
import type { ParamMap, Rational, Scene, TimelineObject } from '../model/types';

export const MAX_LAYERS = 100;

export function objectEnd(o: TimelineObject): number {
  return o.start + o.length;
}

export function rangesOverlap(aStart: number, aLen: number, bStart: number, bLen: number): boolean {
  return aStart < bStart + bLen && bStart < aStart + aLen;
}

/** シーンの長さ（最後のオブジェクトの終了フレーム） */
export function sceneDuration(scene: Scene): number {
  let end = 0;
  for (const o of scene.objects) end = Math.max(end, objectEnd(o));
  return end;
}

/** 指定時刻にあるオブジェクト（レイヤー順） */
export function objectsAtFrame(scene: Scene, frame: number): TimelineObject[] {
  return scene.objects
    .filter((o) => frame >= o.start && frame < objectEnd(o))
    .sort((a, b) => a.layer - b.layer);
}

/** 同じレイヤーで区間が重なるオブジェクトがあるか */
export function hasCollision(
  objects: readonly TimelineObject[],
  layer: number,
  start: number,
  length: number,
  excludeIds: ReadonlySet<string>,
): boolean {
  return objects.some(
    (o) =>
      o.layer === layer && !excludeIds.has(o.id) && rangesOverlap(start, length, o.start, o.length),
  );
}

export interface Placement {
  id: string;
  layer: number;
  start: number;
}

/**
 * 複数オブジェクトをまとめて移動したときの配置を求める。
 * 重なりが出る場合は、希望の移動量に最も近い「重ならない移動量」を探す。見つからなければ null。
 */
export function resolveMove(
  scene: Scene,
  ids: readonly string[],
  deltaFrames: number,
  deltaLayers: number,
): Placement[] | null {
  const moving = scene.objects.filter((o) => ids.includes(o.id));
  if (moving.length === 0) return null;
  const others = scene.objects.filter((o) => !ids.includes(o.id));
  const minStart = Math.min(...moving.map((o) => o.start));
  const minLayer = Math.min(...moving.map((o) => o.layer));
  const maxLayer = Math.max(...moving.map((o) => o.layer));
  const dLayer = Math.max(1 - minLayer, Math.min(MAX_LAYERS - maxLayer, deltaLayers));
  const lowestDelta = -minStart;

  const placementsFor = (delta: number): Placement[] =>
    moving.map((o) => ({ id: o.id, layer: o.layer + dLayer, start: o.start + delta }));
  const isValid = (delta: number): boolean => {
    if (delta < lowestDelta) return false;
    const empty = new Set<string>();
    return moving.every(
      (o) => !hasCollision(others, o.layer + dLayer, o.start + delta, o.length, empty),
    );
  };

  const wanted = Math.max(lowestDelta, deltaFrames);
  if (isValid(wanted)) return placementsFor(wanted);

  // 衝突相手の前後にぴったり付く移動量を候補にする
  const candidates = new Set<number>();
  for (const m of moving) {
    for (const o of others) {
      if (o.layer !== m.layer + dLayer) continue;
      candidates.add(objectEnd(o) - m.start);
      candidates.add(o.start - m.length - m.start);
    }
  }
  const sorted = [...candidates]
    .filter((d) => d >= lowestDelta)
    .sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted));
  for (const d of sorted) {
    if (isValid(d)) return placementsFor(d);
  }
  return null;
}

/**
 * オブジェクトの端をドラッグして長さを変える。隣のオブジェクトにぶつかる位置で止める。
 * 戻り値は新しい start と length。
 */
export function resolveResize(
  scene: Scene,
  id: string,
  edge: 'start' | 'end',
  targetFrame: number,
): { start: number; length: number } | null {
  const obj = scene.objects.find((o) => o.id === id);
  if (!obj) return null;
  const sameLayer = scene.objects.filter((o) => o.layer === obj.layer && o.id !== obj.id);
  if (edge === 'end') {
    const limit = Math.min(
      Infinity,
      ...sameLayer.filter((o) => o.start >= objectEnd(obj)).map((o) => o.start),
    );
    const end = Math.max(obj.start + 1, Math.min(limit, targetFrame));
    return { start: obj.start, length: end - obj.start };
  }
  const limit = Math.max(0, ...sameLayer.filter((o) => objectEnd(o) <= obj.start).map(objectEnd));
  const start = Math.min(objectEnd(obj) - 1, Math.max(limit, targetFrame));
  return { start, length: objectEnd(obj) - start };
}

/** 吸着先の候補（オブジェクトの端と再生位置） */
export function collectSnapPoints(
  scene: Scene,
  excludeIds: ReadonlySet<string>,
  playhead: number,
): number[] {
  const points = new Set<number>([0, playhead]);
  for (const o of scene.objects) {
    if (excludeIds.has(o.id)) continue;
    points.add(o.start);
    points.add(objectEnd(o));
  }
  return [...points];
}

/** frames の各点のうち、吸着先に最も近いものとの差を返す（しきい値を超えれば null） */
export function findSnapOffset(
  frames: number[],
  points: number[],
  threshold: number,
): number | null {
  let best: number | null = null;
  for (const f of frames) {
    for (const p of points) {
      const d = p - f;
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  return best;
}

/** 素材の再生位置（秒）を持つオブジェクトで、開始をずらしたときの再生位置の補正量 */
export function offsetShiftSeconds(
  obj: TimelineObject,
  deltaFrames: number,
  fps: Rational,
): number {
  const speed = typeof obj.params.speed === 'number' ? obj.params.speed : 100;
  return framesToSeconds(deltaFrames, fps) * (speed / 100);
}

function hasSourceOffset(obj: TimelineObject): boolean {
  return obj.type === 'video' || obj.type === 'audio';
}

/** 開始位置を変えたとき、素材の再生位置とキーフレームを合わせて補正したパラメータ */
export function paramsAfterStartChange(
  obj: TimelineObject,
  newStart: number,
  fps: Rational,
): ParamMap {
  const delta = newStart - obj.start;
  if (delta === 0) return obj.params;
  const params: ParamMap = {};
  for (const [key, value] of Object.entries(obj.params)) {
    params[key] = isAnimated(value)
      ? { keys: value.keys.map((k) => ({ ...k, t: k.t - delta })) }
      : value;
  }
  if (hasSourceOffset(obj)) {
    const offset = typeof obj.params.offset === 'number' ? obj.params.offset : 0;
    params.offset = Math.max(0, offset + offsetShiftSeconds(obj, delta, fps));
  }
  return params;
}

/**
 * オブジェクトを frame の位置で 2 つに分ける。分割できない位置なら null。
 * 後半の ID は newId で受け取る。
 */
export function splitObject(
  obj: TimelineObject,
  frame: number,
  fps: Rational,
  newId: string,
): [TimelineObject, TimelineObject] | null {
  if (frame <= obj.start || frame >= objectEnd(obj)) return null;
  const at = frame - obj.start;
  const leftParams: ParamMap = {};
  const rightParams: ParamMap = {};
  for (const [key, value] of Object.entries(obj.params)) {
    if (isAnimated(value)) {
      const [l, r] = splitAnimated(value, at);
      leftParams[key] = l;
      rightParams[key] = r;
    } else {
      leftParams[key] = value;
      rightParams[key] = value;
    }
  }
  // フェードは外側の端だけに残す
  if (leftParams.fadeOut !== undefined) delete leftParams.fadeOut;
  if (rightParams.fadeIn !== undefined) delete rightParams.fadeIn;
  if (hasSourceOffset(obj)) {
    const offset = typeof obj.params.offset === 'number' ? obj.params.offset : 0;
    rightParams.offset = offset + offsetShiftSeconds(obj, at, fps);
  }
  const left: TimelineObject = {
    ...obj,
    length: at,
    params: leftParams,
    effects: structuredClone(obj.effects),
  };
  const right: TimelineObject = {
    ...obj,
    id: newId,
    start: frame,
    length: obj.length - at,
    params: rightParams,
    effects: structuredClone(obj.effects),
  };
  return [left, right];
}

/** レイヤー上で指定区間が空いている最初の位置（start 以降）を探す */
export function findFreeStart(scene: Scene, layer: number, start: number, length: number): number {
  const sameLayer = scene.objects
    .filter((o) => o.layer === layer)
    .sort((a, b) => a.start - b.start);
  let s = Math.max(0, start);
  for (const o of sameLayer) {
    if (rangesOverlap(s, length, o.start, o.length)) s = objectEnd(o);
  }
  return s;
}
