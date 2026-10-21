import { describe, expect, it } from 'vitest';
import { createObject, createProject } from '../../core/project/factory';
import type { TimelineObject } from '../../core/model/types';
import { mixScene, panGains, type MixSources } from './mixer';
import type { PcmReader, PcmSpan } from './reader';

/** 素材内時刻 t（秒）の値が t そのものになる、確認用の音声（サンプリングレート 1000Hz） */
class RampReader implements PcmReader {
  constructor(private duration: number) {}
  async read(start: number, end: number): Promise<PcmSpan> {
    const sr = 1000;
    const n = Math.round((end - start) * sr);
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = start + i / sr;
      ch[i] = t >= 0 && t < this.duration ? t : 0;
    }
    return { start, sampleRate: sr, channels: [ch] };
  }
  dispose(): void {}
}

/** 常に 1.0 を返す音声 */
class ConstReader implements PcmReader {
  async read(start: number, end: number): Promise<PcmSpan> {
    const n = Math.round((end - start) * 1000);
    return { start, sampleRate: 1000, channels: [new Float32Array(n).fill(1)] };
  }
  dispose(): void {}
}

function setup(objects: TimelineObject[], reader: PcmReader) {
  const project = createProject({ sampleRate: 1000, fps: { num: 10, den: 1 } });
  project.scenes[0].objects = objects;
  const sources: MixSources = { reader: () => reader, assetDuration: () => 2 };
  return { project, scene: project.scenes[0], sources };
}

describe('mixScene', () => {
  it('オブジェクトの区間だけ音を出し、再生位置と速度を反映する', async () => {
    // 1 秒目から 1 秒間、素材の 0.5 秒目から 2 倍速
    const obj = createObject('audio', 1, 10, 10, {
      assetId: 'a',
      params: { offset: 0.5, speed: 200 },
    });
    const { project, scene, sources } = setup([obj], new RampReader(10));
    const [l, r] = await mixScene(project, scene, 0, 3000, sources);
    expect(l[500]).toBe(0);
    expect(l[1000]).toBeCloseTo(0.5, 3);
    expect(l[1250]).toBeCloseTo(1.0, 3);
    expect(r[1250]).toBeCloseTo(1.0, 3);
    expect(l[2500]).toBe(0);
  });

  it('音量・パン・フェードを適用する', async () => {
    const obj = createObject('audio', 1, 0, 20, {
      assetId: 'a',
      params: { volume: 50, pan: 100, fadeIn: 1 },
    });
    const { project, scene, sources } = setup([obj], new ConstReader());
    const [l, r] = await mixScene(project, scene, 0, 2000, sources);
    expect(l[1500]).toBe(0);
    expect(r[1500]).toBeCloseTo(0.5, 3);
    // フェードイン中（0.5 秒時点で 50%）。ブロック単位で計算するので誤差を許す
    expect(r[512]).toBeCloseTo(0.25, 1);
  });

  it('ループすると素材の長さで折り返す', async () => {
    const obj = createObject('audio', 1, 0, 50, { assetId: 'a', params: { loop: true } });
    const { project, scene, sources } = setup([obj], new RampReader(2));
    const [l] = await mixScene(project, scene, 0, 5000, sources);
    expect(l[1500]).toBeCloseTo(1.5, 3);
    expect(l[2500]).toBeCloseTo(0.5, 3);
    expect(l[4100]).toBeCloseTo(0.1, 3);
  });

  it('非表示レイヤーとミュートした動画は鳴らさない', async () => {
    const a = createObject('audio', 2, 0, 10, { assetId: 'a' });
    const v = createObject('video', 1, 0, 10, { assetId: 'v', params: { mute: true } });
    const { project, scene, sources } = setup([a, v], new ConstReader());
    scene.layers.push({ index: 2, hidden: true });
    const [l] = await mixScene(project, scene, 0, 500, sources);
    expect(Math.max(...l)).toBe(0);
  });
});

describe('panGains', () => {
  it('中央は左右とも等倍', () => {
    expect(panGains(0)).toEqual([1, 1]);
    expect(panGains(-100)).toEqual([1, 0]);
    expect(panGains(50)).toEqual([0.5, 1]);
  });
});
