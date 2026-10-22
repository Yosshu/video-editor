import { describe, expect, it } from 'vitest';
import { createObject } from '../project/factory';
import type { Scene } from '../model/types';
import {
  evaluateFrame,
  fadeFactor,
  resolveEffects,
  sourceTimeAt,
  transitionMotion,
} from './evaluate';

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

  it('音声波形オブジェクトは、対象のレイヤーの音声の素材内時刻を持つ', () => {
    const audio = createObject('audio', 3, 30, 300, {
      assetId: 'bgm',
      params: { offset: 1, speed: 200 },
    });
    const wave = createObject('audioWave', 1, 0, 600, { params: { targetLayer: 3 } });
    const scene: Scene = {
      id: 's',
      name: 's',
      width: 1,
      height: 1,
      layers: [],
      objects: [audio, wave],
    };
    const [item] = evaluateFrame(scene, 30 + 60, { fps, assetDuration: () => 100 });
    // 1 + 2 秒 × 2 倍速 = 5 秒
    expect(item.waveSource).toEqual({ assetId: 'bgm', time: 5, speed: 2 });
    // 音声がない時刻では持たない
    expect(evaluateFrame(scene, 10, { fps })[0].waveSource).toBeUndefined();
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

describe('エフェクトと登場・退場', () => {
  it('有効で知っている種類のエフェクトだけを評価し、既定値で補う', () => {
    const effects = resolveEffects(
      [
        {
          id: 'a',
          type: 'blur',
          enabled: true,
          params: {
            radius: {
              keys: [
                { t: 0, v: 0 },
                { t: 10, v: 20 },
              ],
            },
          },
        },
        { id: 'b', type: 'monochrome', enabled: false, params: {} },
        { id: 'c', type: 'futureEffect', enabled: true, params: {} },
      ],
      5,
    );
    expect(effects).toHaveLength(1);
    expect(effects[0].params.radius).toBe(10);
    expect(effects[0].params.expand).toBe(true);
  });

  it('スライドとズームの登場・退場', () => {
    const p = { enterType: 'slideLeft', enterDuration: 1, exitType: 'zoom', exitDuration: 1 };
    expect(transitionMotion(p, 0, 10, 1920, 1080).dx).toBe(-1920);
    expect(transitionMotion(p, 1, 10, 1920, 1080).dx).toBe(0);
    expect(transitionMotion(p, 5, 10, 1920, 1080)).toEqual({ dx: 0, dy: 0, scale: 1, opacity: 1 });
    expect(transitionMotion(p, 10, 10, 1920, 1080).scale).toBe(0);
    expect(transitionMotion(p, 9.5, 10, 1920, 1080).scale).toBeGreaterThan(0);
  });

  it('ワイプは見えている割合を返し、フェードは不透明度を下げる', () => {
    const wipe = transitionMotion(
      { enterType: 'wipeLeft', enterDuration: 2, exitType: 'none' },
      0.5,
      10,
      100,
      100,
    );
    expect(wipe.wipe).toEqual({ kind: 'wipeLeft', progress: 0.25 });
    const fade = transitionMotion(
      { enterType: 'none', exitType: 'fade', exitDuration: 1 },
      9.5,
      10,
      100,
      100,
    );
    expect(fade.opacity).toBeCloseTo(0.5);
  });

  it('フィルタオブジェクトはエフェクトだけを持つ描画対象になる', () => {
    const f = createObject('filter', 2, 0, 30);
    f.effects.push({ id: 'x', type: 'monochrome', enabled: true, params: {} });
    const scene: Scene = {
      id: 's',
      name: 's',
      width: 1,
      height: 1,
      layers: [],
      objects: [createObject('solid', 1, 0, 30), f],
    };
    const items = evaluateFrame(scene, 0, { fps });
    expect(items.map((i) => i.object.type)).toEqual(['solid', 'filter']);
    expect(items[1].effects.map((e) => e.type)).toEqual(['monochrome']);
  });
});
