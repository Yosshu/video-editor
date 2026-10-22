import { describe, expect, it } from 'vitest';
import type { LayerState, Scene, TimelineObject } from '../model/types';
import {
  closeGap,
  deleteLayer,
  foldHeaderOf,
  gapAt,
  insertLayer,
  packLayer,
  previousOnLayer,
  relayoutCollides,
  rippleDelete,
  visibleLayerRows,
} from './structure';

function obj(id: string, layer: number, start: number, length: number): TimelineObject {
  return { id, type: 'text', layer, start, length, params: {}, effects: [] };
}

function scene(objects: TimelineObject[], layers: LayerState[] = []): Scene {
  return { id: 'sc', name: 's', width: 1920, height: 1080, layers, objects };
}

describe('rippleDelete', () => {
  it('削除した長さだけ、同じレイヤーの後ろを詰める', () => {
    const s = scene([
      obj('a', 1, 0, 10),
      obj('b', 1, 10, 20),
      obj('c', 1, 40, 5),
      obj('d', 2, 50, 5),
    ]);
    const { remove, moves } = rippleDelete(s, ['b']);
    expect([...remove]).toEqual(['b']);
    expect(moves.get('c')).toEqual({ start: 20 });
    expect(moves.has('a')).toBe(false);
    expect(moves.has('d')).toBe(false);
  });

  it('複数を削除すると、前にある分の合計だけ詰める', () => {
    const s = scene([
      obj('a', 1, 0, 10),
      obj('b', 1, 10, 10),
      obj('c', 1, 20, 10),
      obj('d', 1, 30, 10),
    ]);
    const { moves } = rippleDelete(s, ['a', 'c']);
    expect(moves.get('b')).toEqual({ start: 0 });
    expect(moves.get('d')).toEqual({ start: 10 });
  });

  it('ロックされたレイヤーは削除しない', () => {
    const s = scene([obj('a', 1, 0, 10), obj('b', 1, 10, 10)], [{ index: 1, locked: true }]);
    const { remove, moves } = rippleDelete(s, ['a']);
    expect(remove.size).toBe(0);
    expect(moves.size).toBe(0);
  });
});

describe('空白を詰める', () => {
  it('空白の区間を求める', () => {
    const s = scene([obj('a', 1, 0, 10), obj('b', 1, 30, 10), obj('c', 2, 15, 5)]);
    expect(gapAt(s, 20, 1)).toEqual({ from: 10, to: 30 });
    expect(gapAt(s, 5, 1)).toBeNull();
    expect(gapAt(s, 50, 1)).toBeNull();
    // すべてのレイヤーで空いているのは 20〜30
    expect(gapAt(s, 25)).toEqual({ from: 20, to: 30 });
    expect(gapAt(s, 12)).toEqual({ from: 10, to: 15 });
  });

  it('レイヤーの空白を詰める', () => {
    const s = scene([obj('a', 1, 0, 10), obj('b', 1, 30, 10), obj('c', 1, 50, 10)]);
    const moves = closeGap(s, 20, 1)!;
    expect(moves.get('b')).toEqual({ start: 10 });
    expect(moves.get('c')).toEqual({ start: 30 });
  });

  it('すべてのレイヤーの空白を詰める', () => {
    const s = scene([obj('a', 1, 0, 10), obj('b', 1, 30, 10), obj('c', 2, 35, 10)]);
    const moves = closeGap(s, 20)!;
    expect(moves.get('b')).toEqual({ start: 10 });
    expect(moves.get('c')).toEqual({ start: 15 });
  });

  it('レイヤーの空白をすべて詰める', () => {
    const s = scene([obj('a', 1, 5, 10), obj('b', 1, 30, 10), obj('c', 1, 50, 10)]);
    const moves = packLayer(s, 1)!;
    expect(moves.has('a')).toBe(false);
    expect(moves.get('b')).toEqual({ start: 15 });
    expect(moves.get('c')).toEqual({ start: 25 });
  });
});

describe('レイヤーの挿入・削除', () => {
  it('挿入すると、その位置から下を中身ごとずらす', () => {
    const s = scene(
      [obj('a', 1, 0, 10), obj('b', 2, 0, 10), obj('c', 3, 0, 10)],
      [
        { index: 2, name: '字幕' },
        { index: 1, fold: 2 },
      ],
    );
    const r = insertLayer(s, 2)!;
    expect(r.moves.get('b')).toEqual({ layer: 3 });
    expect(r.moves.get('c')).toEqual({ layer: 4 });
    expect(r.moves.has('a')).toBe(false);
    expect(r.layers).toEqual([
      { index: 1, fold: 3 },
      { index: 3, name: '字幕' },
    ]);
  });

  it('最後のレイヤーにオブジェクトがあると挿入できない', () => {
    expect(insertLayer(scene([obj('a', 100, 0, 10)]), 50)).toBeNull();
  });

  it('削除すると、中身を消して下を詰める', () => {
    const s = scene(
      [obj('a', 1, 0, 10), obj('b', 2, 0, 10), obj('c', 3, 0, 10)],
      [
        { index: 1, fold: 2, collapsed: true },
        { index: 3, name: '字幕' },
      ],
    );
    const r = deleteLayer(s, 2)!;
    expect([...r.remove]).toEqual(['b']);
    expect(r.moves.get('c')).toEqual({ layer: 2 });
    expect(r.layers).toEqual([
      { index: 1, fold: 1, collapsed: true },
      { index: 2, name: '字幕' },
    ]);
  });

  it('ロックされたレイヤーは削除できない', () => {
    expect(deleteLayer(scene([], [{ index: 2, locked: true }]), 2)).toBeNull();
  });
});

describe('その他', () => {
  it('重なりを検出する', () => {
    const s = scene([obj('a', 1, 0, 10), obj('b', 1, 20, 10)]);
    expect(relayoutCollides(s, new Map([['b', { start: 5 }]]))).toBe(true);
    expect(relayoutCollides(s, new Map([['b', { start: 10 }]]))).toBe(false);
  });

  it('同じレイヤーの直前のオブジェクト', () => {
    const s = scene([
      obj('a', 1, 0, 10),
      obj('b', 1, 20, 10),
      obj('c', 1, 40, 10),
      obj('d', 2, 30, 5),
    ]);
    expect(previousOnLayer(s, s.objects[2])?.id).toBe('b');
    expect(previousOnLayer(s, s.objects[0])).toBeUndefined();
  });

  it('折りたたんだレイヤーは表示しない', () => {
    const layers: LayerState[] = [
      { index: 2, fold: 3, collapsed: true },
      { index: 7, fold: 1 },
    ];
    expect(visibleLayerRows(layers, 9)).toEqual([1, 2, 6, 7, 8, 9]);
    expect(foldHeaderOf(layers, 4)?.index).toBe(2);
    expect(foldHeaderOf(layers, 2)).toBeUndefined();
    expect(foldHeaderOf(layers, 8)?.index).toBe(7);
  });
});
