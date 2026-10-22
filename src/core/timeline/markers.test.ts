import { describe, expect, it } from 'vitest';
import type { Scene } from '../model/types';
import { beatsInRange, framesPerBeat, markerSnapPoints, neighborMarker } from './markers';

const fps30 = { num: 30, den: 1 };
const grid = { bpm: 120, offset: 10, beatsPerBar: 4, visible: true };

describe('BPM グリッド', () => {
  it('1 拍の長さ', () => {
    expect(framesPerBeat(grid, fps30)).toBe(15);
    expect(framesPerBeat({ ...grid, bpm: 128 }, fps30)).toBeCloseTo(14.0625, 6);
  });

  it('範囲内の拍と小節の頭', () => {
    const beats = beatsInRange(grid, fps30, 0, 80);
    expect(beats.map((b) => b.frame)).toEqual([10, 25, 40, 55, 70]);
    expect(beats.map((b) => b.bar)).toEqual([true, false, false, false, true]);
    // 1 拍目より前も数える
    expect(beatsInRange(grid, fps30, -20, 10).map((b) => [b.frame, b.bar])).toEqual([
      [-20, false],
      [-5, false],
      [10, true],
    ]);
  });
});

describe('マーカー', () => {
  const markers = [
    { id: 'a', frame: 30 },
    { id: 'b', frame: 90 },
    { id: 'c', frame: 60 },
  ];

  it('前後のマーカー', () => {
    expect(neighborMarker(markers, 60, 1)?.id).toBe('b');
    expect(neighborMarker(markers, 60, -1)?.id).toBe('a');
    expect(neighborMarker(markers, 90, 1)).toBeUndefined();
    expect(neighborMarker(undefined, 0, 1)).toBeUndefined();
  });

  it('吸着先にはマーカーと、表示中のグリッドの拍が入る', () => {
    const scene: Scene = {
      id: 's',
      name: 's',
      width: 1,
      height: 1,
      layers: [],
      objects: [],
      markers,
      beatGrid: { ...grid, bpm: 128 },
    };
    const points = markerSnapPoints(scene, fps30, 0, 40);
    expect(points).toEqual(expect.arrayContaining([30, 90, 60, 10, 24, 38]));
    scene.beatGrid!.visible = false;
    expect(markerSnapPoints(scene, fps30, 0, 40)).toEqual([30, 90, 60]);
  });
});
