import { valueAt } from '../animation/interpolate';
import { framesToSeconds } from '../model/time';
import type { Rational, Scene, TimelineObject } from '../model/types';
import { getObjectDef, type ObjectTypeDef } from '../objects/definitions';
import type { ResolvedValue } from '../params/defs';

export type ResolvedParams = Record<string, ResolvedValue>;

/** オブジェクトのパラメータを相対フレーム t で評価する（既定値で補完） */
export function resolveParams(obj: TimelineObject, t: number): ResolvedParams {
  const def = getObjectDef(obj.type);
  const out: ResolvedParams = {};
  for (const p of def.params) {
    const raw = obj.params[p.id];
    out[p.id] = valueAt(raw, t, p.default as never);
  }
  return out;
}

/** フェードによる不透明度・音量の倍率（0〜1） */
export function fadeFactor(
  localSeconds: number,
  durationSeconds: number,
  fadeIn: number,
  fadeOut: number,
): number {
  let f = 1;
  if (fadeIn > 0 && localSeconds < fadeIn) f = Math.min(f, Math.max(0, localSeconds / fadeIn));
  const remain = durationSeconds - localSeconds;
  if (fadeOut > 0 && remain < fadeOut) f = Math.min(f, Math.max(0, remain / fadeOut));
  return f;
}

/** 素材内の再生時刻（秒）。ループ時は素材の長さで折り返す */
export function sourceTimeAt(
  params: ResolvedParams,
  localSeconds: number,
  assetDuration: number | undefined,
): number {
  const offset = Number(params.offset ?? 0);
  const speed = Number(params.speed ?? 100) / 100;
  let t = offset + localSeconds * speed;
  if (params.loop === true && assetDuration && assetDuration > 0) {
    t %= assetDuration;
  }
  return t;
}

export interface VisualItem {
  object: TimelineObject;
  def: ObjectTypeDef;
  /** オブジェクト開始からの相対フレーム */
  localFrame: number;
  params: ResolvedParams;
  /** フェードを含めた最終的な不透明度（0〜1） */
  opacity: number;
  /** 動画の場合、表示する素材内の時刻（秒） */
  sourceTime?: number;
}

export interface EvaluateContext {
  fps: Rational;
  /** 素材の長さ（秒）。ループ計算に使う */
  assetDuration?: (assetId: string) => number | undefined;
  /** 非表示レイヤー */
  hiddenLayers?: ReadonlySet<number>;
}

/** 指定フレームで描画するオブジェクトを、描画順（レイヤー番号の小さい順）に並べて返す */
export function evaluateFrame(scene: Scene, frame: number, ctx: EvaluateContext): VisualItem[] {
  const hidden =
    ctx.hiddenLayers ?? new Set(scene.layers.filter((l) => l.hidden).map((l) => l.index));
  const items: VisualItem[] = [];
  const active = scene.objects
    .filter((o) => frame >= o.start && frame < o.start + o.length && !hidden.has(o.layer))
    .sort((a, b) => a.layer - b.layer);
  for (const object of active) {
    const def = getObjectDef(object.type);
    if (!def.visual) continue;
    const localFrame = frame - object.start;
    const params = resolveParams(object, localFrame);
    const localSeconds = framesToSeconds(localFrame, ctx.fps);
    const duration = framesToSeconds(object.length, ctx.fps);
    const fade = fadeFactor(localSeconds, duration, Number(params.fadeIn), Number(params.fadeOut));
    const opacity = Math.max(0, Math.min(1, (Number(params.opacity) / 100) * fade));
    const item: VisualItem = { object, def, localFrame, params, opacity };
    if (object.type === 'video') {
      const assetDuration = object.assetId ? ctx.assetDuration?.(object.assetId) : undefined;
      item.sourceTime = sourceTimeAt(params, localSeconds, assetDuration);
    }
    items.push(item);
  }
  return items;
}
