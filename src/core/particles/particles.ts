import { hash01 } from '../animation/ease';
import type { ResolvedParams } from '../evaluate/evaluate';

/**
 * パーティクル（粒子）の計算。
 * 粒子 i は「i / 発生量」秒に生まれ、その後の動きは i と乱数の種だけで決まる。
 * 前のフレームの結果を使わないので、どの時刻からでも同じ絵になる（シーク・書き出しで結果が変わらない）
 */

export interface Particle {
  /** 発生位置（オブジェクトの中心）からの位置（px） */
  x: number;
  y: number;
  /** 直径（px） */
  size: number;
  /** 0〜1 */
  opacity: number;
  /** 回転（度） */
  rotation: number;
  /** 色 1 と色 2 の混ぜ具合（0〜1） */
  mix: number;
}

/** 一度に計算する粒子の数の上限（重くなりすぎないように） */
export const MAX_PARTICLES = 5000;

const num = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** 時刻 time（オブジェクト開始からの秒）に生きている粒子 */
export function simulateParticles(p: ResolvedParams, time: number): Particle[] {
  const rate = Math.max(0, num(p.rate, 30));
  const life = Math.max(0.01, num(p.life, 2));
  if (rate <= 0) return [];
  // 「最初から満たす」なら、寿命の分だけ前から出していたことにする
  const t = time + (p.prewarm === true ? life : 0);
  const seed = Math.round(num(p.seed, 1));
  const speed = num(p.speed, 300);
  const speedRandom = Math.min(1, Math.max(0, num(p.speedRandom, 50) / 100));
  // 方向は 0° が上、時計回り
  const direction = (num(p.direction, 0) * Math.PI) / 180;
  const spread = (num(p.spread, 60) * Math.PI) / 180;
  const gravity = num(p.gravity, 0);
  const emitW = num(p.emitterWidth, 0);
  const emitH = num(p.emitterHeight, 0);
  const size = Math.max(0, num(p.particleSize, 16));
  const sizeRandom = Math.min(1, Math.max(0, num(p.sizeRandom, 50) / 100));
  const sizeEnd = Math.max(0, num(p.sizeEnd, 100) / 100);
  const spin = num(p.spin, 0);
  const fade = p.fadeOut !== false;

  const last = Math.floor(t * rate + 1e-9);
  const first = Math.max(0, Math.ceil((t - life) * rate - 1e-9), last - MAX_PARTICLES + 1);
  const result: Particle[] = [];
  for (let i = first; i <= last; i++) {
    const age = t - i / rate;
    if (age < 0 || age >= life) continue;
    const r = (k: number) => hash01(seed * 16 + k, i);
    const angle = direction + (r(1) - 0.5) * spread;
    const v = speed * (1 - speedRandom * r(2));
    const progress = age / life;
    result.push({
      x: (r(3) - 0.5) * emitW + Math.sin(angle) * v * age,
      y: (r(4) - 0.5) * emitH - Math.cos(angle) * v * age + 0.5 * gravity * age * age,
      size: size * (1 - sizeRandom * r(5)) * (1 + (sizeEnd - 1) * progress),
      opacity: fade ? 1 - progress : 1,
      rotation: r(6) * 360 + spin * (r(7) < 0.5 ? -1 : 1) * age,
      mix: r(8),
    });
  }
  return result;
}
