const CHUNK = 1024 * 1024;

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 素材を照合するための指紋。ファイルサイズと、先頭・末尾 1MiB の SHA-256。
 * 数 GB のファイルでも一瞬で計算できる。
 */
export async function computeFingerprint(file: Blob): Promise<string> {
  const head = file.slice(0, CHUNK);
  const tail = file.size > CHUNK ? file.slice(Math.max(CHUNK, file.size - CHUNK)) : new Blob();
  const data = await new Blob([head, tail, `:${file.size}`]).arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', data);
  return `ht1:${toHex(hash)}`;
}
