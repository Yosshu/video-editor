import type { Ease, EasePreset, SpecialEase } from '../model/types';

type EaseFn = (t: number) => number;

const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;

function bounceOut(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

export const EASE_PRESETS: Record<EasePreset, EaseFn> = {
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  easeInCubic: (t) => t ** 3,
  easeOutCubic: (t) => 1 - (1 - t) ** 3,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  easeInQuart: (t) => t ** 4,
  easeOutQuart: (t) => 1 - (1 - t) ** 4,
  easeInOutQuart: (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
  easeInSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  easeOutSine: (t) => Math.sin((t * Math.PI) / 2),
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  easeInExpo: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  easeOutExpo: (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  easeInOutExpo: (t) =>
    t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2,
  easeInBack: (t) => c3 * t ** 3 - c1 * t * t,
  easeOutBack: (t) => 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2,
  easeInOutBack: (t) =>
    t < 0.5
      ? ((2 * t) ** 2 * ((c2 + 1) * 2 * t - c2)) / 2
      : ((2 * t - 2) ** 2 * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2,
  easeOutBounce: bounceOut,
  easeOutElastic: (t) => {
    if (t === 0 || t === 1) return t;
    return 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1;
  },
};

/** CSS の cubic-bezier と同じ定義のイージング */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // ニュートン法で x に対応する媒介変数 t を求め、収束しなければ二分法
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) return sampleY(t);
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

/** 0〜1 の進み具合を、イージングを適用した値に変換する */
export function applyEase(ease: Ease | undefined, t: number): number {
  if (ease === undefined || ease === 'linear') return t;
  if (ease === 'hold') return 0;
  if (typeof ease === 'object') return 'bezier' in ease ? cubicBezier(...ease.bezier)(t) : t;
  const fn = EASE_PRESETS[ease];
  return fn ? fn(t) : t;
}

export const EASE_OPTIONS: { value: string; label: string }[] = [
  { value: 'linear', label: '直線' },
  { value: 'hold', label: '瞬間切り替え' },
  { value: 'easeInQuad', label: '加速（弱）' },
  { value: 'easeOutQuad', label: '減速（弱）' },
  { value: 'easeInOutQuad', label: '加速→減速（弱）' },
  { value: 'easeInCubic', label: '加速' },
  { value: 'easeOutCubic', label: '減速' },
  { value: 'easeInOutCubic', label: '加速→減速' },
  { value: 'easeInQuart', label: '加速（強）' },
  { value: 'easeOutQuart', label: '減速（強）' },
  { value: 'easeInOutQuart', label: '加速→減速（強）' },
  { value: 'easeInSine', label: '加速（なめらか）' },
  { value: 'easeOutSine', label: '減速（なめらか）' },
  { value: 'easeInOutSine', label: '加速→減速（なめらか）' },
  { value: 'easeInExpo', label: '急加速' },
  { value: 'easeOutExpo', label: '急減速' },
  { value: 'easeInOutExpo', label: '急加速→急減速' },
  { value: 'easeInBack', label: '溜めてから' },
  { value: 'easeOutBack', label: '行き過ぎて戻る' },
  { value: 'easeInOutBack', label: '溜めて行き過ぎる' },
  { value: 'easeOutBounce', label: 'バウンド' },
  { value: 'easeOutElastic', label: '弾む' },
];

export function isSpecialEase(ease: Ease | undefined): ease is SpecialEase {
  return typeof ease === 'object' && 'special' in ease;
}

/** 整数から 0 以上 1 未満の値を作る（同じ入力なら同じ値） */
export function hash01(seed: number, n: number): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(n | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

const smoothstep = (x: number) => x * x * (3 - 2 * x);

/** 間隔ごとに変わる乱数（smooth なら間をなめらかにつなぐ）。0〜1 */
function steppedRandom(seed: number, local: number, period: number, smooth: boolean): number {
  const x = local / period;
  const n = Math.floor(x);
  const a = hash01(seed, n);
  if (!smooth) return a;
  return a + (hash01(seed, n + 1) - a) * smoothstep(x - n);
}

/**
 * 特殊な変化の値。from・to は区間の両端のキーの値、local は区間の先頭からのフレーム、span は区間の長さ
 */
export function specialValue(
  ease: SpecialEase,
  from: number,
  to: number,
  local: number,
  span: number,
): number {
  const period = Math.max(1, ease.period);
  const seed = ease.seed ?? 1;
  const smooth = ease.smooth === true;
  switch (ease.special) {
    case 'random':
      return from + (to - from) * steppedRandom(seed, local, period, smooth);
    case 'repeat': {
      // from → to → from を 1 周期とする
      const phase = (local / period) % 1;
      const p = smooth ? (1 - Math.cos(phase * 2 * Math.PI)) / 2 : 1 - Math.abs(phase * 2 - 1);
      return from + (to - from) * p;
    }
    case 'shake': {
      const base = from + (to - from) * (span > 0 ? local / span : 0);
      const amount = ease.amount ?? 10;
      return base + amount * (steppedRandom(seed, local, period, smooth) * 2 - 1);
    }
  }
}
