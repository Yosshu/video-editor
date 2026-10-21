import { describe, expect, it } from 'vitest';
import { createObject } from '../project/factory';
import type { Scene } from '../model/types';
import { evaluateFrame, fadeFactor, sourceTimeAt } from './evaluate';

const fps = { num: 30, den: 1 };

describe('evaluateFrame', () => {
  it('その時刻のオブジェクトをレイヤー順に返し、非表示レイヤーと音声を除く', () => {
    const scene: Scene = {
      id: 's',
      name: 's',
      width: 100,
      height: 100,
      layers: [{ index: 3, hidden: true }],
      objects: [
        createObject('text', 2, 0, 30),
        createObject('shape', 1, 10, 30),
        createObject('solid', 3, 0, 30),
        createObject('audio', 4, 0, 30),
      ],
    };
    const items = evaluateFrame(scene, 15, { fps });
    expect(items.map((i) => i.object.type)).toEqual(['shape', 'text']);
    expect(items[0].localFrame).toBe(5);
  });

  it('フェードで不透明度が下がる', () => {
    const o = createObject('solid', 1, 0, 60, { params: { fadeIn: 1, opacity: 50 } });
    const scene: Scene = { id: 's', name: 's', width: 1, height: 1, layers: [], objects: [o] };
    expect(evaluateFrame(scene, 15, { fps })[0].opacity).toBeCloseTo(0.25);
  });

  it('動画の素材内時刻を計算する', () => {
    const o = createObject('video', 1, 30, 300, {
      assetId: 'a',
      params: { offset: 2, speed: 50, loop: true },
    });
    const scene: Scene = { id: 's', name: 's', width: 1, height: 1, layers: [], objects: [o] };
    const items = evaluateFrame(scene, 30 + 90, { fps, assetDuration: () => 3 });
    // 2 + 3秒×0.5 = 3.5 → 長さ 3 秒でループして 0.5
    expect(items[0].sourceTime).toBeCloseTo(0.5);
  });
});

describe('fadeFactor / sourceTimeAt', () => {
  it('フェードイン・アウトの倍率', () => {
    expect(fadeFactor(0, 10, 2, 2)).toBe(0);
    expect(fadeFactor(1, 10, 2, 2)).toBe(0.5);
    expect(fadeFactor(5, 10, 2, 2)).toBe(1);
    expect(fadeFactor(9.5, 10, 2, 2)).toBe(0.25);
  });
  it('ループしない場合は素材の長さを超えても折り返さない', () => {
    expect(sourceTimeAt({ offset: 1, speed: 100, loop: false }, 5, 3)).toBe(6);
  });
});
