import { describe, expect, it } from 'vitest';
import { crc32, readZipEntries, ZipWriter, zipEntryBlob } from './zip';

async function build(files: [string, Uint8Array | Blob][]): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  const zip = new ZipWriter({
    write: async (d) => {
      chunks.push(d.slice());
    },
  });
  for (const [name, data] of files)
    await zip.add(name, data, { mtime: new Date(2026, 0, 2, 3, 4, 6) });
  await zip.finish();
  return new Blob(chunks as BlobPart[]);
}

describe('crc32', () => {
  it('既知の値と一致し、続きから計算できる', () => {
    const data = new TextEncoder().encode('123456789');
    expect(crc32(data)).toBe(0xcbf43926);
    expect(crc32(data.subarray(4), crc32(data.subarray(0, 4)))).toBe(0xcbf43926);
  });
});

describe('ZIP の読み書き', () => {
  it('書いた ZIP を読み戻すと同じ中身になる（無圧縮なので元の位置を指す）', async () => {
    const big = new Uint8Array(300_000).map((_, i) => (i * 7) & 0xff);
    const zip = await build([
      ['mimetype', new TextEncoder().encode('application/x-vedpack')],
      ['project.vedproj', new TextEncoder().encode('{"a":1}')],
      ['media/日本語.bin', new Blob([big])],
    ]);
    // mimetype は先頭のヘッダーの直後（30 + 8 バイト目）に置かれる
    const head = new TextDecoder().decode(new Uint8Array(await zip.slice(38, 59).arrayBuffer()));
    expect(head).toBe('application/x-vedpack');

    const entries = await readZipEntries(zip);
    expect(entries.map((e) => e.name)).toEqual(['mimetype', 'project.vedproj', 'media/日本語.bin']);
    expect(entries[2].size).toBe(300_000);
    const media = new Uint8Array(await (await zipEntryBlob(zip, entries[2])).arrayBuffer());
    expect(media).toEqual(big);
    const json = await (await zipEntryBlob(zip, entries[1])).text();
    expect(json).toBe('{"a":1}');
  });

  it('ZIP でないものはエラーにする', async () => {
    await expect(readZipEntries(new Blob(['not a zip']))).rejects.toThrow('ZIP');
  });
});
