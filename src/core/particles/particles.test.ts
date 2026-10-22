import { describe, expect, it } from 'vitest';
import { MAX_PARTICLES, simulateParticles } from './particles';

const base = {
  rate: 10,
  life: 1,
  speed: 100,
  speedRandom: 0,
  direction: 0,
  spread: 0,
  gravity: 0,
  emitterWidth: 0,
  emitterHeight: 0,
  particleSize: 10,
  sizeRandom: 0,
  sizeEnd: 100,
  spin: 0,
  fadeOut: true,
  prewarm: false,
  seed: 1,
};

describe('パーティクル', () => {
  it('発生量と寿命から、生きている粒子の数が決まる', () => {
    expect(simulateParticles(base, 0)).toHaveLength(1);
    expect(simulateParticles(base, 0.55)).toHaveLength(6);
    // 寿命 1 秒・毎秒 10 個 → 10 個前後で一定
    expect(simulateParticles(base, 5.05)).toHaveLength(10);
    expect(simulateParticles({ ...base, rate: 0 }, 1)).toHaveLength(0);
    // 最初から満たす
    expect(simulateParticles({ ...base, prewarm: true }, 0.05)).toHaveLength(10);
  });

  it('方向・速さ・重力で位置が決まる（0° は上）', () => {
    const [oldest] = simulateParticles(base, 0.5);
    expect(oldest.x).toBeCloseTo(0);
    expect(oldest.y).toBeCloseTo(-50);
    const right = simulateParticles({ ...base, direction: 90 }, 0.5)[0];
    expect(right.x).toBeCloseTo(50);
    const fall = simulateParticles({ ...base, speed: 0, gravity: 200 }, 0.5)[0];
    expect(fall.y).toBeCloseTo(25);
    expect(oldest.opacity).toBeCloseTo(0.5);
  });

  it('同じ時刻なら毎回同じ結果になり、種を変えると変わる', () => {
    const p = { ...base, spread: 360, speedRandom: 100, sizeRandom: 50 };
    expect(simulateParticles(p, 3.3)).toEqual(simulateParticles(p, 3.3));
    expect(simulateParticles({ ...p, seed: 2 }, 3.3)).not.toEqual(simulateParticles(p, 3.3));
  });

  it('粒子の数には上限がある', () => {
    expect(simulateParticles({ ...base, rate: 100_000, life: 10 }, 9)).toHaveLength(MAX_PARTICLES);
  });
});
