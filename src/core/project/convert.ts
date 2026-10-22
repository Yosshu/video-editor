import { isSpecialEase } from '../animation/ease';
import { isAnimated } from '../animation/interpolate';
import { fpsValue } from '../model/time';
import type { Keyframe, ParamMap, Project, Rational } from '../model/types';

/** フレーム数を新しいフレームレートに換算する関数 */
export function frameConverter(from: Rational, to: Rational): (frame: number) => number {
  const ratio = fpsValue(to) / fpsValue(from);
  return (frame) => Math.round(frame * ratio);
}

function convertKeys(keys: Keyframe[], conv: (f: number) => number): Keyframe[] {
  const out: Keyframe[] = [];
  for (const k of keys) {
    const t = conv(k.t);
    let ease = k.ease;
    // 特殊な変化の周期（フレーム）も換算する
    if (isSpecialEase(ease)) ease = { ...ease, period: Math.max(1, conv(ease.period)) };
    const key: Keyframe = { ...k, t, ...(ease !== undefined ? { ease } : {}) };
    // 換算して同じ時刻になったキーは後のものを残す
    if (out.length > 0 && out[out.length - 1].t === t) out[out.length - 1] = key;
    else out.push(key);
  }
  return out;
}

function convertParams(params: ParamMap, conv: (f: number) => number): void {
  for (const [id, value] of Object.entries(params)) {
    if (isAnimated(value)) params[id] = { ...value, keys: convertKeys(value.keys, conv) };
  }
}

/**
 * フレームレートを変更し、フレームで表したすべての時間（オブジェクトの位置と長さ、キーフレーム、
 * マーカー、BPM グリッド）を換算する。project をその場で書き換える（Immer の下書きにも使える）。
 * 換算は単調なので、同じレイヤーのオブジェクトが重なることはない。
 */
export function convertFrameRate(project: Project, to: Rational): void {
  const conv = frameConverter(project.settings.fps, to);
  for (const scene of project.scenes) {
    for (const o of scene.objects) {
      const start = conv(o.start);
      const end = conv(o.start + o.length);
      o.start = start;
      o.length = Math.max(1, end - start);
      convertParams(o.params, conv);
      for (const e of o.effects) convertParams(e.params, conv);
    }
    for (const m of scene.markers ?? []) m.frame = conv(m.frame);
    if (scene.beatGrid) scene.beatGrid.offset = conv(scene.beatGrid.offset);
  }
  project.settings.fps = { ...to };
}
