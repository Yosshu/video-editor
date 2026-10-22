/**
 * 無圧縮の ZIP を読み書きする（素材同梱パッケージ用）。
 * - 書き込みは先頭から順に出力するだけなので、大きなファイルもメモリにためずに書ける
 * - 4GB を超えるファイル・アーカイブは ZIP64 で表す
 * - 読み込みは末尾の中央ディレクトリから一覧を作り、無圧縮のファイルは元の Blob の一部（slice）として返す
 */

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_DESCRIPTOR = 0x08074b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const MAX32 = 0xffffffff;
/** 一般目的フラグ：ファイル名が UTF-8 */
const FLAG_UTF8 = 0x0800;
/** 一般目的フラグ：サイズと CRC をデータの後ろに書く */
const FLAG_DESCRIPTOR = 0x0008;

let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

/** CRC-32 を続きから計算する（最初は crc = 0） */
export function crc32(data: Uint8Array, crc = 0): number {
  const t = table();
  let c = ~crc >>> 0;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/** DOS 形式の日時 */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

class Bytes {
  private buf: Uint8Array;
  private view: DataView;
  private pos = 0;
  constructor(size: number) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
  }
  u16(v: number) {
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
    return this;
  }
  u32(v: number) {
    this.view.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
    return this;
  }
  u64(v: number) {
    this.view.setBigUint64(this.pos, BigInt(v), true);
    this.pos += 8;
    return this;
  }
  bytes(b: Uint8Array) {
    this.buf.set(b, this.pos);
    this.pos += b.length;
    return this;
  }
  done(): Uint8Array {
    return this.buf;
  }
}

export interface ZipSink {
  write(data: Uint8Array): Promise<void>;
}

interface WrittenEntry {
  name: Uint8Array;
  flags: number;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

const encoder = new TextEncoder();

/** 無圧縮 ZIP の書き込み */
export class ZipWriter {
  private offset = 0;
  private entries: WrittenEntry[] = [];

  /** forceZip64 は試験用（小さなファイルでも ZIP64 の形式で書く） */
  constructor(
    private sink: ZipSink,
    private options: { forceZip64?: boolean } = {},
  ) {}

  private async out(data: Uint8Array): Promise<void> {
    await this.sink.write(data);
    this.offset += data.length;
  }

  /**
   * ファイルを追加する。
   * 小さなデータ（Uint8Array）は CRC を先に計算してヘッダーに書く（先頭の mimetype を固定位置に置くため）。
   * Blob は読みながら CRC を計算し、データの後ろにサイズと CRC を書く。
   */
  async add(
    name: string,
    data: Uint8Array | Blob,
    options: { mtime?: Date; onProgress?: (written: number) => void } = {},
  ): Promise<void> {
    const nameBytes = encoder.encode(name);
    const { time, date } = dosDateTime(options.mtime ?? new Date());
    const offset = this.offset;
    const size = data instanceof Uint8Array ? data.length : data.size;
    const zip64 = this.options.forceZip64 === true || size >= MAX32 || offset >= MAX32;
    if (data instanceof Uint8Array) {
      const crc = crc32(data);
      const extra = zip64 ? 20 : 0;
      const h = new Bytes(30 + nameBytes.length + extra)
        .u32(SIG_LOCAL)
        .u16(zip64 ? 45 : 20)
        .u16(FLAG_UTF8)
        .u16(0)
        .u16(time)
        .u16(date)
        .u32(crc)
        .u32(zip64 ? MAX32 : size)
        .u32(zip64 ? MAX32 : size)
        .u16(nameBytes.length)
        .u16(extra)
        .bytes(nameBytes);
      if (zip64) h.u16(1).u16(16).u64(size).u64(size);
      await this.out(h.done());
      await this.out(data);
      this.entries.push({ name: nameBytes, flags: FLAG_UTF8, crc, size, offset, time, date });
      return;
    }
    const flags = FLAG_UTF8 | FLAG_DESCRIPTOR;
    const header = new Bytes(30 + nameBytes.length)
      .u32(SIG_LOCAL)
      .u16(zip64 ? 45 : 20)
      .u16(flags)
      .u16(0)
      .u16(time)
      .u16(date)
      .u32(0)
      .u32(0)
      .u32(0)
      .u16(nameBytes.length)
      .u16(0)
      .bytes(nameBytes);
    await this.out(header.done());
    let crc = 0;
    let written = 0;
    const reader = data.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      crc = crc32(value, crc);
      await this.out(value);
      written += value.length;
      options.onProgress?.(written);
    }
    const d = zip64
      ? new Bytes(24).u32(SIG_DESCRIPTOR).u32(crc).u64(written).u64(written)
      : new Bytes(16).u32(SIG_DESCRIPTOR).u32(crc).u32(written).u32(written);
    await this.out(d.done());
    this.entries.push({ name: nameBytes, flags, crc, size: written, offset, time, date });
  }

  /** 中央ディレクトリと終端を書いて完成させる */
  async finish(): Promise<void> {
    const cdStart = this.offset;
    for (const e of this.entries) {
      const big = this.options.forceZip64 === true || e.size >= MAX32 || e.offset >= MAX32;
      const extra = big ? 28 : 0;
      const h = new Bytes(46 + e.name.length + extra)
        .u32(SIG_CENTRAL)
        .u16(45)
        .u16(big ? 45 : 20)
        .u16(e.flags)
        .u16(0)
        .u16(e.time)
        .u16(e.date)
        .u32(e.crc)
        .u32(big ? MAX32 : e.size)
        .u32(big ? MAX32 : e.size)
        .u16(e.name.length)
        .u16(extra)
        .u16(0)
        .u16(0)
        .u16(0)
        .u32(0)
        .u32(big ? MAX32 : e.offset)
        .bytes(e.name);
      if (big) h.u16(1).u16(24).u64(e.size).u64(e.size).u64(e.offset);
      await this.out(h.done());
    }
    const cdSize = this.offset - cdStart;
    const count = this.entries.length;
    const needs64 =
      this.options.forceZip64 === true ||
      cdStart >= MAX32 ||
      count >= 0xffff ||
      this.offset >= MAX32;
    if (needs64) {
      const z64 = this.offset;
      await this.out(
        new Bytes(56)
          .u32(SIG_ZIP64_EOCD)
          .u64(44)
          .u16(45)
          .u16(45)
          .u32(0)
          .u32(0)
          .u64(count)
          .u64(count)
          .u64(cdSize)
          .u64(cdStart)
          .done(),
      );
      await this.out(new Bytes(20).u32(SIG_ZIP64_LOCATOR).u32(0).u64(z64).u32(1).done());
    }
    await this.out(
      new Bytes(22)
        .u32(SIG_EOCD)
        .u16(0)
        .u16(0)
        .u16(needs64 ? 0xffff : count)
        .u16(needs64 ? 0xffff : count)
        .u32(needs64 ? MAX32 : cdSize)
        .u32(needs64 ? MAX32 : cdStart)
        .u16(0)
        .done(),
    );
  }
}

export class ZipFormatError extends Error {}

export interface ZipEntry {
  name: string;
  /** 0 = 無圧縮、8 = deflate */
  method: number;
  compressedSize: number;
  size: number;
  /** データの先頭（ローカルヘッダーの後ろ）の位置 */
  dataOffset: number;
}

async function readBytes(blob: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

const decoder = new TextDecoder();

/** ZIP の中のファイル一覧を読む */
export async function readZipEntries(blob: Blob): Promise<ZipEntry[]> {
  // 終端レコードを末尾から探す（コメントの分も含めて最大 64KB）
  const tailStart = Math.max(0, blob.size - 22 - 0xffff);
  const tail = await readBytes(blob, tailStart, blob.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipFormatError('ZIP ファイルではありません。');
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);
  if (cdOffset === MAX32 || count === 0xffff || cdSize === MAX32) {
    const loc = eocd - 20;
    if (loc < 0 || tail.getUint32(loc, true) !== SIG_ZIP64_LOCATOR)
      throw new ZipFormatError('ZIP64 の情報が見つかりません。');
    const z64Offset = Number(tail.getBigUint64(loc + 8, true));
    const z = await readBytes(blob, z64Offset, z64Offset + 56);
    if (z.getUint32(0, true) !== SIG_ZIP64_EOCD)
      throw new ZipFormatError('ZIP64 の情報が不正です。');
    count = Number(z.getBigUint64(32, true));
    cdSize = Number(z.getBigUint64(40, true));
    cdOffset = Number(z.getBigUint64(48, true));
  }
  const cd = await readBytes(blob, cdOffset, cdOffset + cdSize);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (cd.getUint32(p, true) !== SIG_CENTRAL) throw new ZipFormatError('ZIP の一覧が不正です。');
    const method = cd.getUint16(p + 10, true);
    let compressedSize = cd.getUint32(p + 20, true);
    let size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let localOffset = cd.getUint32(p + 42, true);
    const name = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    // ZIP64 の拡張フィールド（0xFFFFFFFF の項目だけ、この順で入っている）
    let x = p + 46 + nameLen;
    const xEnd = x + extraLen;
    while (x + 4 <= xEnd) {
      const id = cd.getUint16(x, true);
      const len = cd.getUint16(x + 2, true);
      if (id === 1) {
        let q = x + 4;
        if (size === MAX32) {
          size = Number(cd.getBigUint64(q, true));
          q += 8;
        }
        if (compressedSize === MAX32) {
          compressedSize = Number(cd.getBigUint64(q, true));
          q += 8;
        }
        if (localOffset === MAX32) localOffset = Number(cd.getBigUint64(q, true));
      }
      x += 4 + len;
    }
    const local = await readBytes(blob, localOffset, localOffset + 30);
    if (local.getUint32(0, true) !== SIG_LOCAL)
      throw new ZipFormatError('ZIP のデータが不正です。');
    const dataOffset = localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    entries.push({ name, method, compressedSize, size, dataOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** ZIP の中のファイルの中身。無圧縮なら元の Blob の一部をそのまま返す */
export async function zipEntryBlob(blob: Blob, entry: ZipEntry): Promise<Blob> {
  const raw = blob.slice(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) {
    const stream = raw.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).blob();
  }
  throw new ZipFormatError(`対応していない圧縮方式です（${entry.method}）。`);
}
