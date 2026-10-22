import { describe, expect, it } from 'vitest';
import { GifEncoder, gifDelays, lzwEncode, quantize } from './gif';

/** 試験用の GIF の LZW 展開 */
function lzwDecode(data: Uint8Array, count: number): Uint8Array {
  const minCodeSize = data[0];
  const bytes: number[] = [];
  for (let p = 1; data[p] !== 0; p += data[p] + 1)
    bytes.push(...data.subarray(p + 1, p + 1 + data[p]));
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let size = minCodeSize + 1;
  let table: number[][] = [];
  const reset = () => {
    table = Array.from({ length: clear + 2 }, (_, i) => [i]);
    size = minCodeSize + 1;
  };
  reset();
  const out: number[] = [];
  let prev: number[] | null = null;
  let bit = 0;
  for (;;) {
    let code = 0;
    for (let i = 0; i < size; i++, bit++) code |= ((bytes[bit >> 3] >> (bit & 7)) & 1) << i;
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === end) break;
    let entry: number[];
    if (code < table.length) entry = table[code];
    else entry = [...prev!, prev![0]];
    out.push(...entry);
    if (prev) table.push([...prev, entry[0]]);
    prev = entry;
    if (table.length === 1 << size && size < 12) size++;
  }
  expect(out.length).toBe(count);
  return Uint8Array.from(out);
}

describe('GIF', () => {
  it('LZW で圧縮したものを元に戻せる（表の作り直しを含む）', () => {
    const random = Uint8Array.from({ length: 50_000 }, (_, i) => (i * 7919 + (i >> 5)) % 251);
    expect(lzwDecode(lzwEncode(random, 8), random.length)).toEqual(random);
    const flat = new Uint8Array(10_000).fill(3);
    const packed = lzwEncode(flat, 2);
    expect(packed.length).toBeLessThan(500);
    expect(lzwDecode(packed, flat.length)).toEqual(flat);
    expect(lzwDecode(lzwEncode(Uint8Array.of(1), 2), 1)).toEqual(Uint8Array.of(1));
  });

  it('少ない色の画像はそのままの色で表せる', () => {
    const colors = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 255],
    ];
    const rgba = new Uint8ClampedArray(64 * 4);
    for (let i = 0; i < 64; i++) rgba.set([...colors[i % 4], 255], i * 4);
    const q = quantize(rgba, 256);
    expect(q.size).toBe(4);
    for (const [r, g, b] of colors) {
      const index = q.lookup[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
      const got = [...q.palette.subarray(index * 3, index * 3 + 3)];
      got.forEach((v, c) => expect(Math.abs(v - [r, g, b][c])).toBeLessThanOrEqual(4));
    }
  });

  it('多い色は指定した数に減らす', () => {
    const rgba = new Uint8ClampedArray(256 * 256 * 4);
    for (let i = 0; i < 256 * 256; i++) rgba.set([i & 255, i >> 8, (i * 3) & 255, 255], i * 4);
    const q = quantize(rgba, 16);
    expect(q.size).toBe(16);
    for (let k = 0; k < 32768; k++) expect(q.lookup[k]).toBeLessThan(16);
  });

  it('GIF の形式で書き、フレームの時間の端数をためる', () => {
    const enc = new GifEncoder({ width: 2, height: 2, transparent: true });
    const header = enc.header();
    expect(new TextDecoder().decode(header.subarray(0, 6))).toBe('GIF89a');
    expect(header[6] | (header[7] << 8)).toBe(2);
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0]);
    const frame = enc.frame(rgba, 7);
    // 表示の制御：背景に戻す・透明あり・7/100 秒
    expect([...frame.subarray(0, 4)]).toEqual([0x21, 0xf9, 0x04, (2 << 2) | 1]);
    expect(frame[4]).toBe(7);
    expect(enc.trailer()).toEqual(Uint8Array.of(0x3b));
    expect(gifDelays(3, 30)).toEqual([3, 4, 3]);
    expect(gifDelays(30, 30).reduce((a, b) => a + b)).toBe(100);
  });
});
