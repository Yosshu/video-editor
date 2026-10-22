import { BufferTarget, CanvasSource, Output, Quality, WebMOutputFormat } from 'mediabunny';
import { t } from '../../i18n';

/** ファイル名の数字を数として比べて並べる（frame2 < frame10） */
export function sortSequenceFiles<T extends { name: string }>(files: T[]): T[] {
  return [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

/** 連番画像から作る動画のファイル名（frame_0001.png 〜 frame_0120.png → frame_0001-0120.webm） */
export function sequenceFileName(first: string, last: string): string {
  const stem = (name: string) => name.replace(/\.[^.]+$/, '');
  const a = stem(first);
  const b = stem(last);
  const digits = /(\d+)(?!.*\d)/;
  const ma = digits.exec(a);
  const mb = digits.exec(b);
  if (ma && mb && a.slice(0, ma.index) === b.slice(0, mb.index)) {
    return `${a}-${mb[1]}${b.slice(mb.index + mb[1].length)}.webm`;
  }
  return `${a}.webm`;
}

/** 画像に透明な部分があるか（全体を縮小して調べる） */
function hasTransparency(image: ImageBitmap): boolean {
  const w = Math.min(256, image.width);
  const h = Math.min(256, image.height);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

export interface SequenceOptions {
  /** 1 秒あたりのコマ数 */
  fps: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * 連番画像を 1 本の動画（WebM・VP9）にまとめる。
 * 透明な部分のある画像なら透明度も残す。大きさは最初の画像に合わせる（偶数に切り上げ）
 */
export async function encodeImageSequence(files: File[], options: SequenceOptions): Promise<File> {
  if (files.length < 2) throw new Error(t('連番画像は 2 枚以上選んでください。'));
  const sorted = sortSequenceFiles(files);
  const first = await createImageBitmap(sorted[0]);
  const width = first.width + (first.width % 2);
  const height = first.height + (first.height % 2);
  const alpha = hasTransparency(first);
  first.close();

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });
  const source = new CanvasSource(canvas, {
    codec: 'vp9',
    quality: new Quality('very-high'),
    keyFrameInterval: 1,
    alpha: alpha ? 'keep' : 'discard',
  });
  output.addVideoTrack(source, { frameRate: options.fps });
  try {
    await output.start();
    for (let i = 0; i < sorted.length; i++) {
      if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      let image: ImageBitmap;
      try {
        image = await createImageBitmap(sorted[i]);
      } catch {
        throw new Error(t('画像「{0}」を読み込めませんでした。', sorted[i].name));
      }
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0);
      image.close();
      await source.add(i / options.fps, 1 / options.fps);
      options.onProgress?.(i + 1, sorted.length);
    }
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => undefined);
    throw e;
  }
  const name = sequenceFileName(sorted[0].name, sorted[sorted.length - 1].name);
  return new File([target.buffer!], name, { type: 'video/webm', lastModified: Date.now() });
}
