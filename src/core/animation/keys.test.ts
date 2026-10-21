import { describe, expect, it } from 'vitest';
import { keysValueAt } from './interpolate';
import {
  addKeyAt,
  addMidpoint,
  easeAt,
  keyTimes,
  moveMidpoint,
  neighborKey,
  removeKeyAt,
  removeMidpoint,
  setEaseAt,
  setValueAt,
} from './keys';

describe('キーフレームの操作', () => {
  it('固定値はそのまま置き換え、アニメーション中はキーを打つ', () => {
    expect(setValueAt(5, 10, 7)).toBe(7);
    const anim = {
      keys: [
        { t: 0, v: 0, ease: 'easeOutCubic' as const },
        { t: 20, v: 100 },
      ],
    };
    const next = setValueAt(anim, 10, 30);
    expect(next).toEqual({
      keys: [
        { t: 0, v: 0, ease: 'easeOutCubic' },
        { t: 10, v: 30, ease: 'easeOutCubic' },
        { t: 20, v: 100 },
      ],
    });
    expect(setValueAt(next, 10, 40)).toMatchObject({
      keys: [{ v: 0 }, { t: 10, v: 40 }, { v: 100 }],
    });
  });

  it('キーの追加・削除で固定値とアニメーションを切り替える', () => {
    const a = addKeyAt(25, 5, 0);
    expect(a).toEqual({ keys: [{ t: 5, v: 25 }] });
    const b = addKeyAt(setValueAt(a, 15, 75), 10, 0);
    expect(b.keys.map((k) => [k.t, k.v])).toEqual([
      [5, 25],
      [10, 50],
      [15, 75],
    ]);
    expect(removeKeyAt({ keys: [{ t: 5, v: 25 }] }, 5)).toBe(25);
    expect(removeKeyAt(b, 10)).toEqual({
      keys: [
        { t: 5, v: 25 },
        { t: 15, v: 75 },
      ],
    });
  });

  it('区間の変化の仕方を取得・変更する', () => {
    const anim = {
      keys: [
        { t: 0, v: 0 },
        { t: 10, v: 1 },
        { t: 20, v: 2 },
      ],
    };
    const eased = setEaseAt(anim, 12, 'hold');
    expect(easeAt(eased, 15)).toBe('hold');
    expect(easeAt(eased, 5)).toBeUndefined();
    expect(keysValueAt(eased.keys, 19)).toBe(1);
    // 最後のキーの時刻では、最後の区間を対象にする
    expect(easeAt(eased, 20)).toBe('hold');
    expect(easeAt(setEaseAt(anim, 20, 'easeInQuad'), 15)).toBe('easeInQuad');
  });

  it('前後のキーを探す', () => {
    const anim = {
      keys: [
        { t: 0, v: 0 },
        { t: 10, v: 1 },
        { t: 20, v: 2 },
      ],
    };
    expect(neighborKey(anim, 10, -1)).toBe(0);
    expect(neighborKey(anim, 10, 1)).toBe(20);
    expect(neighborKey(anim, 25, 1)).toBeNull();
  });
});

describe('中間点', () => {
  const defaults = { x: 0, y: 0, scale: 100 };
  const ids = ['x', 'y', 'scale'];

  it('何も動いていないときは、開始と中間点にキーを打つ', () => {
    const p = addMidpoint({ x: 10 }, 30, defaults, ids);
    expect(p.x).toEqual({
      keys: [
        { t: 0, v: 10 },
        { t: 30, v: 10 },
      ],
    });
    expect(p.scale).toEqual({
      keys: [
        { t: 0, v: 100 },
        { t: 30, v: 100 },
      ],
    });
    expect(keyTimes(p, 60)).toEqual([0, 30]);
  });

  it('動いているパラメータだけにキーを追加し、移動・削除できる', () => {
    const params = {
      x: {
        keys: [
          { t: 0, v: 0 },
          { t: 60, v: 60 },
        ],
      },
      y: 5,
    };
    const p = addMidpoint(params, 30, defaults, ids);
    expect(p.y).toBe(5);
    expect(keyTimes(p, 100)).toEqual([0, 30, 60]);
    const moved = moveMidpoint(p, 30, 40);
    expect(keyTimes(moved, 100)).toEqual([0, 40, 60]);
    const removed = removeMidpoint(moved, 40);
    expect(keyTimes(removed, 100)).toEqual([0, 60]);
  });
});
