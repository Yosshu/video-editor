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
