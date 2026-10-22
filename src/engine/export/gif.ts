/**
 * アニメーション GIF の書き込み。
 * フレームごとに 256 色（透明を使うときは 255 色＋透明）へ減色し、LZW で圧縮する。
 * 減色はメディアンカット法（色を 15 ビットに丸めた度数分布を、色の幅が最も広い箱から順に分ける）
 */

/** 15 ビット（RGB 各 5 ビット）の色番号 */
function key15(r: number, g: number, b: number): number {
  return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
}

interface Box {
  /** 色番号の配列（keys の範囲 [start, end)） */
  start: number;
  end: number;
  /** 画素数 */
  count: number;
  /** 最も幅の広い色の成分（0: R, 1: G, 2: B）とその幅 */
  channel: number;
  range: number;
}

/** 減色の結果 */
export interface Quantized {
  /** RGB を並べた色の表 */
  palette: Uint8Array;
  /** 色の数 */
  size: number;
  /** 15 ビットの色番号 → 色の表の番号 */
  lookup: Int16Array;
}

/**
 * 画素（RGBA）を maxColors 色に減らす。alphaThreshold 未満の画素は数えない（透明として扱う）
 */
export function quantize(
  rgba: Uint8ClampedArray,
  maxColors: number,
  alphaThreshold = 128,
): Quantized {
  const hist = new Uint32Array(32768);
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < alphaThreshold) continue;
    hist[key15(rgba[i], rgba[i + 1], rgba[i + 2])]++;
  }
  const keys: number[] = [];
  for (let k = 0; k < 32768; k++) if (hist[k] > 0) keys.push(k);
  const channel = (k: number, c: number) => (k >> (10 - c * 5)) & 31;

  const makeBox = (start: number, end: number): Box => {
    const lo = [31, 31, 31];
    const hi = [0, 0, 0];
    let count = 0;
    for (let i = start; i < end; i++) {
      count += hist[keys[i]];
      for (let c = 0; c < 3; c++) {
        const v = channel(keys[i], c);
        if (v < lo[c]) lo[c] = v;
        if (v > hi[c]) hi[c] = v;
      }
    }
    const ranges = hi.map((h, c) => h - lo[c]);
    const widest = ranges.indexOf(Math.max(...ranges));
    return { start, end, count, channel: widest, range: ranges[widest] };
  };
  const boxes: Box[] = keys.length > 0 ? [makeBox(0, keys.length)] : [];
  while (boxes.length < maxColors) {
    // 分けられる箱のうち、色の幅 × 画素数の平方根が最も大きいものを分ける
    let best = -1;
    let bestScore = 0;
    for (let b = 0; b < boxes.length; b++) {
      const box = boxes[b];
      if (box.end - box.start < 2) continue;
      const score = (box.range + 1) * Math.sqrt(box.count);
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }
    if (best < 0) break;
    const box = boxes[best];
    const c = box.channel;
    const slice = keys.slice(box.start, box.end).sort((a, b) => channel(a, c) - channel(b, c));
    for (let i = 0; i < slice.length; i++) keys[box.start + i] = slice[i];
    // 画素数で半分になる位置で分ける
    let acc = 0;
    let mid = box.start + 1;
    for (let i = box.start; i < box.end - 1; i++) {
      acc += hist[keys[i]];
      mid = i + 1;
      if (acc * 2 >= box.count) break;
    }
    boxes.splice(best, 1, makeBox(box.start, mid), makeBox(mid, box.end));
  }

  const size = Math.max(1, boxes.length);
  const palette = new Uint8Array(size * 3);
  const lookup = new Int16Array(32768).fill(-1);
  boxes.forEach((box, index) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = box.start; i < box.end; i++) {
      const k = keys[i];
      const w = hist[k];
      r += ((channel(k, 0) << 3) | 4) * w;
      g += ((channel(k, 1) << 3) | 4) * w;
      b += ((channel(k, 2) << 3) | 4) * w;
      n += w;
      lookup[k] = index;
    }
    palette[index * 3] = Math.round(r / n);
    palette[index * 3 + 1] = Math.round(g / n);
    palette[index * 3 + 2] = Math.round(b / n);
  });
  // 箱の平均色より近い色があれば、そちらに割り当てる
  for (const k of keys) {
    const r = (channel(k, 0) << 3) | 4;
    const g = (channel(k, 1) << 3) | 4;
    const b = (channel(k, 2) << 3) | 4;
    let best = lookup[k];
    let bestD = Infinity;
    for (let i = 0; i < size; i++) {
      const dr = palette[i * 3] - r;
      const dg = palette[i * 3 + 1] - g;
      const db = palette[i * 3 + 2] - b;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    lookup[k] = best;
  }
  return { palette, size, lookup };
}

/** バイト列を少しずつためる */
class ByteBuffer {
  private buf = new Uint8Array(4096);
  length = 0;

  push(byte: number): void {
    if (this.length === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.length++] = byte;
  }

  pushAll(bytes: ArrayLike<number>): void {
    for (let i = 0; i < bytes.length; i++) this.push(bytes[i]);
  }

  u16(v: number): void {
    this.push(v & 255);
    this.push((v >> 8) & 255);
  }

  bytes(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

/**
 * GIF の LZW 圧縮。indices は色の表の番号、minCodeSize は 2〜8。
 * 結果は 255 バイト以下の小さな塊に分け、最後に長さ 0 の塊を置いた形
 */
export function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const out = new ByteBuffer();
  out.push(minCodeSize);
  const block: number[] = [];
  const flushBlock = () => {
    if (block.length === 0) return;
    out.push(block.length);
    out.pushAll(block);
    block.length = 0;
  };
  let bitBuf = 0;
  let bitCount = 0;
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  // (前の符号 << 8 | 次の番号) → 符号
  let dict = new Map<number, number>();
  const write = (code: number) => {
    bitBuf |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      block.push(bitBuf & 255);
      if (block.length === 255) flushBlock();
      bitBuf >>>= 8;
      bitCount -= 8;
    }
  };
  write(clearCode);
  if (indices.length > 0) {
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const id = (prefix << 8) | k;
      const found = dict.get(id);
      if (found !== undefined) {
        prefix = found;
        continue;
      }
      write(prefix);
      if (nextCode < 4096) {
        dict.set(id, nextCode);
        // 次に書く符号が今のビット数に収まらなくなったら 1 ビット増やす
        if (nextCode === 1 << codeSize && codeSize < 12) codeSize++;
        nextCode++;
      } else {
        // 表がいっぱいになったら作り直す
        write(clearCode);
        dict = new Map();
        codeSize = minCodeSize + 1;
        nextCode = endCode + 1;
      }
      prefix = k;
    }
    write(prefix);
  }
  write(endCode);
  if (bitCount > 0) {
    block.push(bitBuf & 255);
    if (block.length === 255) flushBlock();
  }
  flushBlock();
  out.push(0);
  return out.bytes();
}

export interface GifOptions {
  width: number;
  height: number;
  /** 透明な画素（アルファが 128 未満）を透明色にする */
  transparent?: boolean;
}

/** アニメーション GIF を 1 フレームずつ作る。戻り値のバイト列を順につなげると GIF になる */
export class GifEncoder {
  constructor(private options: GifOptions) {}

  /** ファイルの先頭（ヘッダー・画面の大きさ・繰り返しの指定） */
  header(): Uint8Array {
    const out = new ByteBuffer();
    out.pushAll([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
    out.u16(this.options.width);
    out.u16(this.options.height);
    out.push(0); // 全体の色の表は使わない（フレームごとに持つ）
    out.push(0);
    out.push(0);
    // 無限に繰り返す（NETSCAPE2.0 拡張）
    out.pushAll([0x21, 0xff, 0x0b]);
    out.pushAll([...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)));
    out.pushAll([0x03, 0x01, 0x00, 0x00, 0x00]);
    return out.bytes();
  }

  /** フレームを 1 枚加える。delay は表示する時間（1/100 秒） */
  frame(rgba: Uint8ClampedArray, delay: number): Uint8Array {
    const { width, height, transparent = false } = this.options;
    const q = quantize(rgba, transparent ? 255 : 256);
    const transparentIndex = transparent ? q.size : -1;
    const colors = q.size + (transparent ? 1 : 0);
    // 色の表の大きさは 2 のべき乗（2〜256）
    let bits = 1;
    while (1 << bits < colors) bits++;
    const indices = new Uint8Array(width * height);
    for (let p = 0, i = 0; p < indices.length; p++, i += 4) {
      indices[p] =
        transparent && rgba[i + 3] < 128
          ? transparentIndex
          : q.lookup[key15(rgba[i], rgba[i + 1], rgba[i + 2])];
    }
    const out = new ByteBuffer();
    // 表示の制御：透明を使うときは、次のフレームの前に背景（透明）へ戻す
    out.pushAll([0x21, 0xf9, 0x04]);
    out.push((transparent ? 2 << 2 : 1 << 2) | (transparent ? 1 : 0));
    out.u16(Math.max(0, Math.min(65535, Math.round(delay))));
    out.push(transparent ? transparentIndex : 0);
    out.push(0);
    // 画像の位置と大きさ、フレームごとの色の表
    out.push(0x2c);
    out.u16(0);
    out.u16(0);
    out.u16(width);
    out.u16(height);
    out.push(0x80 | (bits - 1));
    const table = new Uint8Array((1 << bits) * 3);
    table.set(q.palette.subarray(0, q.size * 3));
    out.pushAll(table);
    out.pushAll(lzwEncode(indices, Math.max(2, bits)));
    return out.bytes();
  }

  /** ファイルの終わり */
  trailer(): Uint8Array {
    return new Uint8Array([0x3b]);
  }
}

/** fps のフレームを 1/100 秒単位の表示時間にする（端数をためて全体の長さを合わせる） */
export function gifDelays(count: number, fps: number): number[] {
  return Array.from(
    { length: count },
    (_, i) => Math.round(((i + 1) * 100) / fps) - Math.round((i * 100) / fps),
  );
}
