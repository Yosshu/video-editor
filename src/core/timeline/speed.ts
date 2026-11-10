import type { Scene, TimelineObject } from '../model/types';

/** オブジェクトの再生速度（%） */
export function speedOf(obj: TimelineObject): number {
  const v = obj.params.speed;
  return typeof v === 'number' && v > 0 ? v : 100;
}

/**
 * 再生速度を変えたときに長さも変えるか。
 * 素材を時間どおりに再生するもの（動画・音声・シーン・アニメーション画像）で、ループ再生でないもの。
 * ループ再生は繰り返して長さを埋める使い方なので、長さはそのままにする
 */
export function lengthFollowsSpeed(obj: TimelineObject, animatedImage = false): boolean {
  if (obj.params.loop === true) return false;
  if (obj.type === 'image') return animatedImage && obj.params.loop === false;
  return obj.type === 'video' || obj.type === 'audio' || obj.type === 'scene';
}

/**
 * 速度を base.speed から speed に変えたときの長さ（素材の同じ範囲を再生する長さ）。
 * 伸びるときは、同じレイヤーの次のオブジェクトの手前までにする（clamped が true）
 */
export function lengthForSpeed(
  scene: Scene,
  obj: TimelineObject,
  base: { length: number; speed: number },
  speed: number,
): { length: number; clamped: boolean } {
  const wanted = Math.max(1, Math.round((base.length * base.speed) / speed));
  const next = scene.objects
    .filter((o) => o.layer === obj.layer && o.id !== obj.id && o.start > obj.start)
    .reduce((min, o) => Math.min(min, o.start), Infinity);
  const limit = Math.max(1, next - obj.start);
  return wanted > limit ? { length: limit, clamped: true } : { length: wanted, clamped: false };
}
