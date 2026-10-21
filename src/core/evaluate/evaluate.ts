import { EASE_PRESETS } from '../animation/ease';
import { valueAt } from '../animation/interpolate';
import { getEffectDef } from '../effects/definitions';
import { framesToSeconds } from '../model/time';
import type { EffectInstance, Rational, Scene, TimelineObject } from '../model/types';
import { getObjectDef, type ObjectTypeDef, type TransitionType } from '../objects/definitions';
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

export interface ResolvedEffect {
  id: string;
  type: string;
  params: ResolvedParams;
}

/** 有効で、種類を知っているエフェクトだけを評価する（新しいバージョンのエフェクトは無視して残す） */
export function resolveEffects(effects: EffectInstance[], t: number): ResolvedEffect[] {
  const out: ResolvedEffect[] = [];
  for (const e of effects) {
    const def = getEffectDef(e.type);
    if (!e.enabled || !def) continue;
    const params: ResolvedParams = {};
    for (const p of def.params) params[p.id] = valueAt(e.params[p.id], t, p.default as never);
    out.push({ id: e.id, type: e.type, params });
  }
  return out;
}

/** 登場・退場による動き */
export interface Motion {
  dx: number;
  dy: number;
  scale: number;
  opacity: number;
  /** ワイプ（progress=1 で全体が見える） */
  wipe?: { kind: TransitionType; progress: number };
}

const WIPES: TransitionType[] = ['wipeLeft', 'wipeRight', 'wipeUp', 'wipeDown', 'circle'];

function applyTransition(
  m: Motion,
  type: TransitionType,
  visible: number,
  entering: boolean,
  sceneW: number,
  sceneH: number,
): void {
  // visible: 0（見えない）〜1（通常の状態）
  const e = entering
    ? EASE_PRESETS.easeOutCubic(visible)
    : 1 - EASE_PRESETS.easeInCubic(1 - visible);
  const away = 1 - e;
  switch (type) {
    case 'fade':
      m.opacity *= visible;
      break;
    case 'slideLeft':
      m.dx -= away * sceneW;
      break;
    case 'slideRight':
      m.dx += away * sceneW;
      break;
    case 'slideUp':
      m.dy -= away * sceneH;
      break;
    case 'slideDown':
      m.dy += away * sceneH;
      break;
    case 'zoom':
      m.scale *= e;
      break;
    default:
      if (WIPES.includes(type)) {
        if (!m.wipe || visible < m.wipe.progress) m.wipe = { kind: type, progress: visible };
      }
  }
}

/** 登場・退場の演出を、オブジェクト内の時刻（秒）から計算する */
export function transitionMotion(
  params: ResolvedParams,
  localSeconds: number,
  durationSeconds: number,
  sceneW: number,
  sceneH: number,
): Motion {
  const m: Motion = { dx: 0, dy: 0, scale: 1, opacity: 1 };
  const enter = String(params.enterType ?? 'none') as TransitionType;
  const exit = String(params.exitType ?? 'none') as TransitionType;
  if (enter !== 'none') {
    const d = Math.max(0.001, Number(params.enterDuration));
    if (localSeconds < d)
      applyTransition(m, enter, Math.max(0, localSeconds / d), true, sceneW, sceneH);
  }
  if (exit !== 'none') {
    const d = Math.max(0.001, Number(params.exitDuration));
    const remain = durationSeconds - localSeconds;
    if (remain < d) applyTransition(m, exit, Math.max(0, remain / d), false, sceneW, sceneH);
  }
  return m;
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
  /** 有効なエフェクト（上から順に適用） */
  effects: ResolvedEffect[];
  /** 登場・退場による動き */
  motion: Motion;
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
    const effects = resolveEffects(object.effects, localFrame);
    const localSeconds = framesToSeconds(localFrame, ctx.fps);
    const duration = framesToSeconds(object.length, ctx.fps);
    if (object.type === 'filter') {
      items.push({
        object,
        def,
        localFrame,
        params,
        opacity: 1,
        effects,
        motion: { dx: 0, dy: 0, scale: 1, opacity: 1 },
      });
      continue;
    }
    const fade = fadeFactor(localSeconds, duration, Number(params.fadeIn), Number(params.fadeOut));
    // 終わりのフレームでちょうど消えるよう、退場は 1 フレーム後の時刻で計算する
    const motion = transitionMotion(
      params,
      localSeconds,
      duration - framesToSeconds(1, ctx.fps),
      scene.width,
      scene.height,
    );
    const opacity = Math.max(
      0,
      Math.min(1, (Number(params.opacity) / 100) * fade * motion.opacity),
    );
    const item: VisualItem = { object, def, localFrame, params, opacity, effects, motion };
    if (object.type === 'video') {
      const assetDuration = object.assetId ? ctx.assetDuration?.(object.assetId) : undefined;
      item.sourceTime = sourceTimeAt(params, localSeconds, assetDuration);
    }
    items.push(item);
  }
  return items;
}
