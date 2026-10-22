import { describe, expect, it } from 'vitest';
import { applyEase, cubicBezier } from './ease';
import { keysValueAt, normalizeKeys, splitAnimated, valueAt } from './interpolate';

describe('valueAt', () => {
  it('固定値と既定値', () => {
    expect(valueAt(5, 10, 0)).toBe(5);
    expect(valueAt(undefined, 10, 7)).toBe(7);
    expect(valueAt('abc', 0, 'x')).toBe('abc');
  });

  it('キーフレームを直線で補間する', () => {
    const v = {
      keys: [
        { t: 0, v: 0 },
        { t: 10, v: 100 },
      ],
    };
    expect(valueAt(v, -5, 0)).toBe(0);
    expect(valueAt(v, 5, 0)).toBe(50);
    expect(valueAt(v, 20, 0)).toBe(100);
  });

  it('瞬間切り替えは次のキーまで値を保つ', () => {
    const keys = [
      { t: 0, v: 0, ease: 'hold' as const },
      { t: 10, v: 100 },
    ];
    expect(keysValueAt(keys, 9)).toBe(0);
    expect(keysValueAt(keys, 10)).toBe(100);
  });

  it('イージングを適用する', () => {
    const keys = [
      { t: 0, v: 0, ease: 'easeInQuad' as const },
      { t: 10, v: 100 },
    ];
    expect(keysValueAt(keys, 5)).toBeCloseTo(25);
  });
});

describe('ease', () => {
  it('cubic-bezier(0,0,1,1) は直線', () => {
    const f = cubicBezier(0, 0, 1, 1);
    for (const x of [0, 0.25, 0.5, 0.9, 1]) expect(f(x)).toBeCloseTo(x, 4);
  });
  it('プリセットは 0 と 1 で端点を通る', () => {
    for (const e of ['easeOutCubic', 'easeInOutBack', 'easeOutBounce', 'easeOutElastic'] as const) {
      expect(applyEase(e, 0)).toBeCloseTo(0, 5);
      expect(applyEase(e, 1)).toBeCloseTo(1, 5);
    }
  });
});

describe('normalizeKeys / splitAnimated', () => {
  it('時刻順に並べ、同じ時刻は後勝ち', () => {
    expect(
      normalizeKeys([
        { t: 10, v: 1 },
        { t: 0, v: 2 },
        { t: 10, v: 3 },
      ]),
    ).toEqual([
      { t: 0, v: 2 },
      { t: 10, v: 3 },
    ]);
  });

  it('分割しても各時刻の値が変わらない', () => {
    const anim = {
      keys: [
        { t: 0, v: 0, ease: 'easeOutCubic' as const },
        { t: 20, v: 100, ease: 'linear' as const },
        { t: 40, v: 50 },
      ],
    };
    for (const at of [5, 20, 33, 50]) {
      const [l, r] = splitAnimated(anim, at);
      for (let t = 0; t < at; t++)
        expect(keysValueAt(l.keys, t)).toBeCloseTo(keysValueAt(anim.keys, t));
      for (let t = at; t < 60; t++) {
        expect(keysValueAt(r.keys, t - at)).toBeCloseTo(keysValueAt(anim.keys, t));
      }
    }
  });
});

describe('特殊な変化', () => {
  const keys = (ease: import('../model/types').Ease) => [
    { t: 0, v: 0, ease },
    { t: 100, v: 10 },
  ];

  it('ランダム：間隔ごとに 2 つの値の間のランダムな値になり、同じ種なら同じ値', () => {
    const k = keys({ special: 'random', period: 5, seed: 42 });
    const values = Array.from({ length: 100 }, (_, t) => keysValueAt(k, t));
    expect(values.every((v) => v >= 0 && v <= 10)).toBe(true);
    // 5 フレームの間は同じ値
    expect(values[0]).toBe(values[4]);
    expect(new Set(values).size).toBeGreaterThan(5);
    expect(keysValueAt(keys({ special: 'random', period: 5, seed: 42 }), 37)).toBe(values[37]);
    expect(keysValueAt(keys({ special: 'random', period: 5, seed: 7 }), 37)).not.toBe(values[37]);
  });

  it('反復：周期ごとに 2 つの値を往復する', () => {
    const k = keys({ special: 'repeat', period: 20 });
    expect(keysValueAt(k, 0)).toBeCloseTo(0);
    expect(keysValueAt(k, 10)).toBeCloseTo(10);
    expect(keysValueAt(k, 20)).toBeCloseTo(0);
    expect(keysValueAt(k, 5)).toBeCloseTo(5);
    const smooth = keys({ special: 'repeat', period: 20, smooth: true });
    expect(keysValueAt(smooth, 5)).toBeCloseTo(5);
    expect(keysValueAt(smooth, 2)).toBeLessThan(2);
  });

  it('振動：直線の変化に揺れ幅以内の揺れが加わる', () => {
    const k = keys({ special: 'shake', period: 1, amount: 2, seed: 3 });
    for (let t = 0; t < 100; t++) {
      expect(Math.abs(keysValueAt(k, t) - t / 10)).toBeLessThanOrEqual(2);
    }
    // 最後のキー以降は最後の値
    expect(keysValueAt(k, 150)).toBe(10);
  });
});
