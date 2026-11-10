import { describe, expect, it } from 'vitest';
import { createObject, createScene } from '../project/factory';
import { lengthFollowsSpeed, lengthForSpeed, speedOf } from './speed';

function setup() {
  const scene = createScene('s', 1920, 1080);
  const video = createObject('video', 1, 0, 60, { assetId: 'a' });
  const next = createObject('shape', 1, 100, 30);
  const other = createObject('shape', 2, 70, 30);
  scene.objects = [video, next, other];
  return { scene, video };
}

describe('速度に合わせた長さ', () => {
  it('速くすると縮み、遅くすると伸びる（素材の同じ範囲を再生する長さ）', () => {
    const { scene, video } = setup();
    expect(lengthForSpeed(scene, video, { length: 60, speed: 100 }, 200)).toEqual({
      length: 30,
      clamped: false,
    });
    expect(lengthForSpeed(scene, video, { length: 60, speed: 100 }, 80)).toEqual({
      length: 75,
      clamped: false,
    });
    expect(lengthForSpeed(scene, video, { length: 60, speed: 100 }, 1600).length).toBe(4);
  });

  it('伸ばすと同じレイヤーの次のオブジェクトにぶつかるときは、その手前まで', () => {
    const { scene, video } = setup();
    // 別のレイヤーのオブジェクト（70 フレーム目）は関係ない
    expect(lengthForSpeed(scene, video, { length: 60, speed: 100 }, 50)).toEqual({
      length: 100,
      clamped: true,
    });
    // 後ろに何もなければいくらでも伸びる
    scene.objects = [video];
    expect(lengthForSpeed(scene, video, { length: 60, speed: 100 }, 10).length).toBe(600);
  });

  it('長さを変える種類と、ループ再生のときは変えないこと', () => {
    const { video } = setup();
    expect(speedOf(video)).toBe(100);
    expect(lengthFollowsSpeed(video)).toBe(true);
    expect(lengthFollowsSpeed({ ...video, params: { loop: true } })).toBe(false);
    expect(lengthFollowsSpeed(createObject('audio', 1, 0, 10))).toBe(true);
    expect(lengthFollowsSpeed(createObject('text', 1, 0, 10))).toBe(false);
    // 画像はアニメーション画像で、ループ再生を切ったときだけ
    const image = createObject('image', 1, 0, 10, { params: { loop: false } });
    expect(lengthFollowsSpeed(image, true)).toBe(true);
    expect(lengthFollowsSpeed(image, false)).toBe(false);
    expect(lengthFollowsSpeed(createObject('image', 1, 0, 10), true)).toBe(false);
  });
});
