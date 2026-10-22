import { describe, expect, it } from 'vitest';
import type { PcmReader } from './reader';
import { readLooped, stretch, StretchCache } from './timeStretch';

const SR = 48000;

/** 1 秒ごとに 440Hz → 880Hz → 440Hz … と変わる音（位相は連続） */
function source(seconds: number): Float32Array {
  const out = new Float32Array(seconds * SR);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const f = Math.floor(i / SR) % 2 === 0 ? 440 : 880;
    phase += (2 * Math.PI * f) / SR;
    out[i] = Math.sin(phase) * 0.5;
  }
  return out;
}

const SOURCE = source(8);
const read = async (from: number, to: number) => {
  const a = Math.max(0, Math.floor(from * SR));
  const b = Math.min(SOURCE.length, Math.ceil(to * SR));
  const data = SOURCE.slice(a, Math.max(a, b));
  return { start: a / SR, sampleRate: SR, channels: [data] };
};

/** ゼロ交差の数から周波数を見積もる */
function frequency(data: Float32Array): number {
  let crossings = 0;
  for (let i = 1; i < data.length; i++) if (data[i - 1] < 0 !== data[i] < 0) crossings++;
  return crossings / 2 / (data.length / SR);
}

describe('音程を保った速度変更', () => {
  it('2 倍速でも音の高さは変わらず、素材の位置は 2 倍で進む', async () => {
    // 出力 0.25 秒 → 素材 0.5 秒（440Hz）、出力 0.75 秒 → 素材 1.5 秒（880Hz）
    const [l] = await stretch(read, (t) => t * 2, 0, SR, SR);
    expect(frequency(l.subarray(0.15 * SR, 0.35 * SR))).toBeCloseTo(440, -1);
    expect(frequency(l.subarray(0.6 * SR, 0.9 * SR))).toBeCloseTo(880, -1);
  });

  it('半分の速さでも音の高さは変わらない', async () => {
    const [l] = await stretch(read, (t) => t * 0.5, 0, 3 * SR, SR);
    expect(frequency(l.subarray(0.5 * SR, 1.5 * SR))).toBeCloseTo(440, -1);
    expect(frequency(l.subarray(2.2 * SR, 2.8 * SR))).toBeCloseTo(880, -1);
    // 粒のつなぎ目でも音量（振幅）が落ちない（5ms ごとの最大値を見る）
    for (let s = 0.5 * SR; s < 1.5 * SR; s += 240) {
      const peak = l.subarray(s, s + 240).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      expect(peak).toBeGreaterThan(0.4);
      expect(peak).toBeLessThan(0.6);
    }
  });

  it('続けて作るときは、区間を分けてもまとめて作った結果と同じになる', async () => {
    const nominal = (t: number) => 0.3 + t * 1.5;
    const [whole] = await stretch(read, nominal, 0.1, 9600, SR, new StretchCache().use('a'));
    const cache = new StretchCache();
    const [a] = await stretch(read, nominal, 0.1, 4000, SR, cache.use('a'));
    const [b] = await stretch(read, nominal, 0.1 + 4000 / SR, 5600, SR, cache.use('a'));
    const joined = new Float32Array(9600);
    joined.set(a);
    joined.set(b, 4000);
    for (let i = 0; i < 9600; i++) expect(joined[i]).toBeCloseTo(whole[i], 5);
  });

  it('ループする素材をつなげて読む', async () => {
    const data = Float32Array.from({ length: 100 }, (_, i) => i);
    const reader: PcmReader = {
      read: async (s, e) => {
        const a = Math.floor(s * 100);
        return { start: a / 100, sampleRate: 100, channels: [data.slice(a, Math.ceil(e * 100))] };
      },
      dispose: () => undefined,
    };
    const span = await readLooped(reader, 1, 0.9, 1.2);
    expect([...span.channels[0]].map(Math.round)).toEqual([
      90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
      16, 17, 18, 19,
    ]);
    expect(span.start).toBe(0.9);
    const before = await readLooped(reader, 1, -0.05, 0.05);
    expect([...before.channels[0]].map(Math.round)).toEqual([95, 96, 97, 98, 99, 0, 1, 2, 3, 4]);
  });
});
