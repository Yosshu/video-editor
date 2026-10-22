import { describe, expect, it } from 'vitest';
import { createObject, createProject } from '../../core/project/factory';
import { AudioEffectChain, createAudioFx, type ChainEffect } from './effects';
import { mixScene, type MixSources } from './mixer';
import type { PcmReader, PcmSpan } from './reader';

const SR = 48000;

function run(type: string, input: number[], params: Record<string, number | boolean>, sr = SR) {
  const fx = createAudioFx(type, sr)!;
  const l = Float32Array.from(input);
  const r = Float32Array.from(input);
  fx.process(l, r, 0, l.length, params);
  return [l, r];
}

describe('音声エフェクト', () => {
  it('イコライザー：低音を +6dB すると直流（0Hz）は約 2 倍になる', () => {
    const [l] = run('equalizer', new Array(SR).fill(0.25), { lowGain: 6, lowFreq: 200 });
    expect(l[SR - 1]).toBeCloseTo(0.25 * 10 ** (6 / 20), 2);
  });

  it('イコライザー：ローカットで直流が消える', () => {
    const [l] = run('equalizer', new Array(SR).fill(0.5), { lowCut: 100 });
    expect(Math.abs(l[SR - 1])).toBeLessThan(1e-3);
  });

  it('イコライザー：すべて 0 なら何もしない', () => {
    const input = Array.from({ length: 100 }, (_, i) => Math.sin(i));
    const [l] = run('equalizer', input, {});
    for (let i = 0; i < 100; i++) expect(l[i]).toBeCloseTo(input[i], 6);
  });

  it('コンプレッサー：0dB の音をしきい値 -20dB・圧縮比 4 で 15dB 下げる', () => {
    const [l] = run('compressor', new Array(SR).fill(1), {
      threshold: -20,
      ratio: 4,
      knee: 0,
      attack: 1,
      release: 100,
      makeup: 0,
    });
    expect(l[SR - 1]).toBeCloseTo(10 ** (-15 / 20), 3);
  });

  it('ディレイ：指定した時間だけ遅れて、繰り返すたびに小さくなる', () => {
    const input = new Array(1000).fill(0);
    input[0] = 1;
    const [l] = run('delay', input, { time: 100, feedback: 50, mix: 80 }, 1000);
    expect(l[0]).toBe(1);
    expect(l[100]).toBeCloseTo(0.8, 5);
    expect(l[200]).toBeCloseTo(0.4, 5);
    expect(l[150]).toBe(0);
  });

  it('リバーブ：一瞬の音のあとに残響が続く', () => {
    const input = new Array(SR).fill(0);
    input[0] = 1;
    const [l, r] = run('reverb', input, { roomSize: 70, damping: 50, mix: 50, preDelay: 0 });
    const tail = (a: Float32Array) => a.slice(SR / 2).reduce((s, v) => s + v * v, 0);
    expect(tail(l)).toBeGreaterThan(0);
    expect(tail(r)).toBeGreaterThan(0);
    expect(l.every(Number.isFinite)).toBe(true);
  });
});

describe('エフェクトの並び', () => {
  it('区切って処理しても、まとめて処理したのと同じになる', () => {
    const input = Array.from(
      { length: 4000 },
      (_, i) => Math.sin(i * 0.05) * (i % 700 < 50 ? 1 : 0),
    );
    const effects: ChainEffect[] = [
      { id: 'a', type: 'delay', params: { time: 70, feedback: 60, mix: 50 } },
      { id: 'b', type: 'reverb', params: { roomSize: 50, damping: 50, mix: 30, preDelay: 5 } },
    ];
    const whole = new AudioEffectChain(1000);
    whole.sync(effects);
    const wl = Float32Array.from(input);
    const wr = Float32Array.from(input);
    whole.process(wl, wr, 0, input.length, 0, () => effects);

    const parts = new AudioEffectChain(1000);
    parts.sync(effects);
    const pl = Float32Array.from(input);
    const pr = Float32Array.from(input);
    for (let from = 0; from < input.length; from += 333) {
      const to = Math.min(input.length, from + 333);
      expect(parts.position(from)).toBe(from === 0 ? 'reset' : 'continue');
      parts.process(pl, pr, from, to, from, () => effects);
    }
    for (let i = 0; i < input.length; i++) expect(pl[i]).toBeCloseTo(wl[i], 6);
  });

  it('少し前から読み直したときは、処理済みの値を返す', () => {
    const chain = new AudioEffectChain(1000);
    chain.sync([{ id: 'a', type: 'delay' }]);
    expect(chain.position(0)).toBe('reset');
    const l = new Float32Array(100).fill(1);
    const r = new Float32Array(100).fill(1);
    chain.process(l, r, 0, 100, 0, () => [{ id: 'a', type: 'delay', params: { time: 10 } }]);
    expect(chain.position(100)).toBe('continue');
    expect(chain.position(96)).toBe(4);
    expect(chain.position(100_000)).toBe('reset');
  });
});

/** 一定間隔のパルス（1 秒に 1 回、長さ 10 サンプル） */
class PulseReader implements PcmReader {
  async read(start: number, end: number): Promise<PcmSpan> {
    const sr = 1000;
    const n = Math.round((end - start) * sr);
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = Math.round((start + i / sr) * sr);
      ch[i] = s % 1000 < 10 ? 1 : 0;
    }
    return { start, sampleRate: sr, channels: [ch] };
  }
  dispose(): void {}
}

describe('ミキサーの音声エフェクト', () => {
  function setup() {
    const project = createProject({ sampleRate: 1000, fps: { num: 10, den: 1 } });
    const obj = createObject('audio', 1, 0, 50, { assetId: 'a' });
    obj.effects.push({
      id: 'fx',
      type: 'delay',
      enabled: true,
      params: { time: 300, feedback: 50, mix: 100 },
    });
    project.scenes[0].objects = [obj];
    return { project, scene: project.scenes[0] };
  }

  it('区切ってミックスしても、シークし直しても同じ音になる', async () => {
    const { project, scene } = setup();
    const chains = new Map<string, AudioEffectChain>();
    const sources: MixSources = {
      reader: () => new PulseReader(),
      assetDuration: () => 10,
      effectChain: (key, sr) => {
        if (!chains.has(key)) chains.set(key, new AudioEffectChain(sr));
        return chains.get(key)!;
      },
    };
    const [whole] = await mixScene(project, scene, 0, 4000, sources);
    // 続けて 250 サンプルずつ
    chains.clear();
    const parts: number[] = [];
    for (let s = 0; s < 4000; s += 250) {
      const [l] = await mixScene(project, scene, s / 1000, 250, sources);
      parts.push(...l);
    }
    for (let i = 0; i < 4000; i++) expect(parts[i]).toBeCloseTo(whole[i], 5);
    // 途中から（状態を引き継がない）：少し前から処理し直すので残響も含めて同じになる
    const [seek] = await mixScene(project, scene, 2.1, 500, {
      reader: () => new PulseReader(),
      assetDuration: () => 10,
    });
    for (let i = 0; i < 500; i++) expect(seek[i]).toBeCloseTo(whole[2100 + i], 2);
    // 残響（1.3 秒目 = 1 秒目のパルスの 300ms 後）
    expect(whole[1305]).toBeCloseTo(1, 5);
    expect(whole[1605]).toBeCloseTo(0.5, 5);
  });

  it('無効にしたエフェクトはかからない', async () => {
    const { project, scene } = setup();
    scene.objects[0].effects[0].enabled = false;
    const [l] = await mixScene(project, scene, 0, 2000, {
      reader: () => new PulseReader(),
      assetDuration: () => 10,
    });
    expect(l[1305]).toBe(0);
    expect(l[1005]).toBe(1);
  });
});
