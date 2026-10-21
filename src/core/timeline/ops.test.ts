import { describe, expect, it } from 'vitest';
import type { Scene, TimelineObject } from '../model/types';
import {
  collectSnapPoints,
  findFreeStart,
  findSnapOffset,
  paramsAfterStartChange,
  resolveMove,
  resolveResize,
  sceneDuration,
  splitObject,
} from './ops';

const fps30 = { num: 30, den: 1 };

function obj(
  id: string,
  layer: number,
  start: number,
  length: number,
  extra: Partial<TimelineObject> = {},
): TimelineObject {
  return { id, type: 'text', layer, start, length, params: {}, effects: [], ...extra };
}

function scene(objects: TimelineObject[]): Scene {
  return { id: 'sc', name: 's', width: 1920, height: 1080, layers: [], objects };
}

describe('resolveMove', () => {
  it('重ならなければ希望どおりに移動する', () => {
    const s = scene([obj('a', 1, 0, 10), obj('b', 1, 30, 10)]);
    expect(resolveMove(s, ['a'], 5, 0)).toEqual([{ id: 'a', layer: 1, start: 5 }]);
  });

  it('重なる場合は最も近い隙間に寄せる', () => {
    const s = scene([obj('a', 1, 0, 10), obj('b', 1, 30, 10)]);
    // 25 に移動すると b と重なる → b の直前（20）に寄せる
    expect(resolveMove(s, ['a'], 25, 0)).toEqual([{ id: 'a', layer: 1, start: 20 }]);
    // 35 に移動すると b と重なる → b の直後（40）の方が近い
    expect(resolveMove(s, ['a'], 36, 0)).toEqual([{ id: 'a', layer: 1, start: 40 }]);
  });

  it('レイヤーをまたいで移動できる', () => {
    const s = scene([obj('a', 1, 0, 10), obj('b', 2, 0, 10)]);
    expect(resolveMove(s, ['a'], 20, 1)).toEqual([{ id: 'a', layer: 2, start: 20 }]);
  });

  it('0 より前には移動しない', () => {
    const s = scene([obj('a', 1, 5, 10)]);
    expect(resolveMove(s, ['a'], -20, 0)).toEqual([{ id: 'a', layer: 1, start: 0 }]);
  });

  it('複数選択はまとめて移動し、レイヤー 1 より上には行かない', () => {
    const s = scene([obj('a', 1, 0, 10), obj('b', 2, 10, 10)]);
    expect(resolveMove(s, ['a', 'b'], 3, -1)).toEqual([
      { id: 'a', layer: 1, start: 3 },
      { id: 'b', layer: 2, start: 13 },
    ]);
  });
});

describe('resolveResize', () => {
  it('右端は次のオブジェクトの手前で止まる', () => {
    const s = scene([obj('a', 1, 0, 10), obj('b', 1, 20, 10)]);
    expect(resolveResize(s, 'a', 'end', 50)).toEqual({ start: 0, length: 20 });
  });
  it('左端は前のオブジェクトの直後で止まり、長さは 1 以上', () => {
    const s = scene([obj('a', 1, 0, 10), obj('b', 1, 20, 10)]);
    expect(resolveResize(s, 'b', 'start', 5)).toEqual({ start: 10, length: 20 });
    expect(resolveResize(s, 'b', 'start', 40)).toEqual({ start: 29, length: 1 });
  });
});

describe('snap', () => {
  it('しきい値内で最も近い吸着先との差を返す', () => {
    const s = scene([obj('a', 1, 0, 10), obj('b', 2, 50, 10)]);
    const points = collectSnapPoints(s, new Set(['a']), 100);
    expect(points.sort((x, y) => x - y)).toEqual([0, 50, 60, 100]);
    expect(findSnapOffset([47, 57], points, 4)).toBe(3);
    expect(findSnapOffset([30, 40], points, 4)).toBeNull();
  });
});

describe('splitObject', () => {
  it('位置で 2 つに分け、動画の再生位置とフェードを調整する', () => {
    const o = obj('a', 1, 10, 60, {
      type: 'video',
      params: { offset: 1, speed: 200, fadeIn: 0.5, fadeOut: 0.5 },
    });
    const result = splitObject(o, 40, fps30, 'b');
    expect(result).not.toBeNull();
    const [left, right] = result!;
    expect(left).toMatchObject({ id: 'a', start: 10, length: 30 });
    expect(right).toMatchObject({ id: 'b', start: 40, length: 30 });
    expect(left.params).toEqual({ offset: 1, speed: 200, fadeIn: 0.5 });
    // 30 フレーム = 1 秒、速度 200% なので素材上は 2 秒進む
    expect(right.params).toEqual({ offset: 3, speed: 200, fadeOut: 0.5 });
  });

  it('アニメーションの値は分割前と同じになる', () => {
    const o = obj('a', 1, 0, 100, {
      params: {
        x: {
          keys: [
            { t: 0, v: 0 },
            { t: 100, v: 100 },
          ],
        },
      },
    });
    const [, right] = splitObject(o, 25, fps30, 'b')!;
    const x = right.params.x as { keys: { t: number; v: number }[] };
    expect(x.keys).toEqual([
      { t: -25, v: 0 },
      { t: 75, v: 100 },
    ]);
  });

  it('端では分割しない', () => {
    const o = obj('a', 1, 10, 20);
    expect(splitObject(o, 10, fps30, 'b')).toBeNull();
    expect(splitObject(o, 30, fps30, 'b')).toBeNull();
  });
});

describe('その他', () => {
  it('開始位置の変更で再生位置とキーフレームをずらす', () => {
    const o = obj('a', 1, 30, 60, {
      type: 'audio',
      params: {
        offset: 2,
        volume: {
          keys: [
            { t: 0, v: 100 },
            { t: 30, v: 0 },
          ],
        },
      },
    });
    const p = paramsAfterStartChange(o, 60, fps30);
    expect(p.offset).toBe(3);
    expect(p.volume).toEqual({
      keys: [
        { t: -30, v: 100 },
        { t: 0, v: 0 },
      ],
    });
  });

  it('空いている位置を探す', () => {
    const s = scene([obj('a', 1, 0, 10), obj('b', 1, 12, 10)]);
    expect(findFreeStart(s, 1, 0, 5)).toBe(22);
    expect(findFreeStart(s, 1, 0, 2)).toBe(10);
    expect(findFreeStart(s, 2, 3, 5)).toBe(3);
  });

  it('シーンの長さは最後のオブジェクトの終わり', () => {
    expect(sceneDuration(scene([obj('a', 1, 0, 10), obj('b', 3, 40, 5)]))).toBe(45);
  });
});
