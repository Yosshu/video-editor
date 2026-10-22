import type { Asset, AssetKind } from '../../core/model/types';
import { newId } from '../../core/model/ids';
import { parseCube, type Lut3D } from '../../core/lut/cube';
import { detectAssetKind } from './detect';
import { computeFingerprint } from './fingerprint';
import { describeMedia, openMediaSource, type MediaSourceHandle } from './mediaSource';
import { t } from '../../i18n';

export class AssetImportError extends Error {}

/** アニメーション画像（GIF・APNG・WebP）のコマ */
interface Animation {
  frames: ImageBitmap[];
  /** 各コマの開始時刻（秒） */
  starts: number[];
  /** 1 回分の長さ（秒） */
  duration: number;
}

interface Runtime {
  file: File;
  /** 静止画、またはアニメーションの最初のコマ */
  image?: ImageBitmap;
  animation?: Animation;
  media?: MediaSourceHandle;
  lut?: Lut3D;
}

/** 読み込むコマ数の上限（メモリを使いすぎないように） */
const MAX_ANIMATION_FRAMES = 1000;

/**
 * アニメーション画像なら全部のコマを読む（ImageDecoder が使えない環境や静止画なら null）。
 * コマの長さが書かれていなければ 0.1 秒とする
 */
async function decodeAnimation(file: File): Promise<Animation | null> {
  if (typeof ImageDecoder === 'undefined') return null;
  const type = file.type || imageMimeType(file.name);
  if (!type || !(await ImageDecoder.isTypeSupported(type).catch(() => false))) return null;
  const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type });
  try {
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (!track?.animated) return null;
    await decoder.completed;
    const count = Math.min(track.frameCount, MAX_ANIMATION_FRAMES);
    if (count <= 1) return null;
    const frames: ImageBitmap[] = [];
    const starts: number[] = [];
    let at = 0;
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      try {
        frames.push(await createImageBitmap(image));
        starts.push(at);
        at += (image.duration ?? 100_000) / 1_000_000 || 0.1;
      } finally {
        image.close();
      }
    }
    return { frames, starts, duration: at };
  } finally {
    decoder.close();
  }
}

function imageMimeType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext === 'gif'
    ? 'image/gif'
    : ext === 'png' || ext === 'apng'
      ? 'image/png'
      : ext === 'webp'
        ? 'image/webp'
        : ext === 'avif'
          ? 'image/avif'
          : '';
}

/** アニメーションの時刻 time（秒、ループ済み）のコマ */
function frameAt(anim: Animation, time: number): ImageBitmap {
  let lo = 0;
  let hi = anim.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (anim.starts[mid] <= time) lo = mid;
    else hi = mid - 1;
  }
  return anim.frames[lo];
}

async function readLut(file: File): Promise<Lut3D> {
  try {
    return parseCube(await file.text());
  } catch (e) {
    throw new AssetImportError(
      t(
        'LUT「{0}」を読み込めませんでした：{1}',
        file.name,
        e instanceof Error ? e.message : String(e),
      ),
    );
  }
}

async function decodeImage(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    // SVG などは一度 img 要素で読み込む
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * 素材ファイルの実体（File、デコード済み画像、動画・音声の読み込み口）を保持する。
 * 編集データ（Asset）とは別に管理し、保存はしない。
 */
export class AssetRegistry {
  private runtimes = new Map<string, Runtime>();
  private listeners = new Set<(assetId: string) => void>();

  onChange(listener: (assetId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(assetId: string): void {
    for (const l of this.listeners) l(assetId);
  }

  has(assetId: string): boolean {
    return this.runtimes.has(assetId);
  }

  getFile(assetId: string): File | undefined {
    return this.runtimes.get(assetId)?.file;
  }

  /** 画像。アニメーション画像なら時刻 time（秒、素材内）のコマ（time を省略すると最初のコマ） */
  getImage(assetId: string, time?: number): ImageBitmap | undefined {
    const rt = this.runtimes.get(assetId);
    if (rt?.animation && time !== undefined) return frameAt(rt.animation, time);
    return rt?.image;
  }

  /** アニメーション画像の 1 回分の長さ（秒）。静止画なら undefined */
  getAnimationDuration(assetId: string): number | undefined {
    return this.runtimes.get(assetId)?.animation?.duration;
  }

  getMedia(assetId: string): MediaSourceHandle | undefined {
    return this.runtimes.get(assetId)?.media;
  }

  getLut(assetId: string): Lut3D | undefined {
    return this.runtimes.get(assetId)?.lut;
  }

  /** ファイルを解析して素材情報を作り、そのまま使える状態にする */
  async importFile(file: File, kindHint?: AssetKind): Promise<Asset> {
    const kind = kindHint ?? detectAssetKind(file);
    if (!kind || kind === 'font') {
      throw new AssetImportError(t('「{0}」は対応していない種類のファイルです。', file.name));
    }
    const fingerprint = await computeFingerprint(file);
    const base = {
      id: newId('as'),
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      lastModified: file.lastModified,
      fingerprint,
    };
    if (kind === 'lut') {
      const lut = await readLut(file);
      const asset: Asset = { ...base, kind: 'lut', mimeType: 'text/plain' };
      this.runtimes.set(asset.id, { file, lut });
      this.emit(asset.id);
      return asset;
    }
    if (kind === 'image') {
      let image: ImageBitmap;
      try {
        image = await decodeImage(file);
      } catch {
        throw new AssetImportError(t('画像「{0}」を読み込めませんでした。', file.name));
      }
      const animation = await decodeAnimation(file).catch(() => null);
      const asset: Asset = {
        ...base,
        kind: 'image',
        width: image.width,
        height: image.height,
        ...(animation ? { durationSec: animation.duration } : {}),
      };
      this.runtimes.set(asset.id, { file, image, ...(animation ? { animation } : {}) });
      this.emit(asset.id);
      return asset;
    }
    let media: MediaSourceHandle;
    try {
      media = await openMediaSource(file);
    } catch (e) {
      throw new AssetImportError(`「${file.name}」：${e instanceof Error ? e.message : String(e)}`);
    }
    const info = await describeMedia(media);
    const asset: Asset = { ...base, ...info };
    this.runtimes.set(asset.id, { file, media });
    this.emit(asset.id);
    return asset;
  }

  /** 保存済みの素材情報に、ファイルの実体を結び付ける（再リンク・復元） */
  async attach(asset: Asset, file: File): Promise<void> {
    this.release(asset.id);
    if (asset.kind === 'image') {
      const image = await decodeImage(file);
      const animation = await decodeAnimation(file).catch(() => null);
      this.runtimes.set(asset.id, { file, image, ...(animation ? { animation } : {}) });
    } else if (asset.kind === 'video' || asset.kind === 'audio') {
      const media = await openMediaSource(file);
      this.runtimes.set(asset.id, { file, media });
    } else if (asset.kind === 'lut') {
      this.runtimes.set(asset.id, { file, lut: await readLut(file) });
    } else {
      this.runtimes.set(asset.id, { file });
    }
    this.emit(asset.id);
  }

  release(assetId: string): void {
    const rt = this.runtimes.get(assetId);
    if (!rt) return;
    rt.image?.close();
    for (const f of rt.animation?.frames ?? []) f.close();
    rt.media?.dispose();
    this.runtimes.delete(assetId);
    this.emit(assetId);
  }

  clear(): void {
    for (const id of [...this.runtimes.keys()]) this.release(id);
  }
}

export const assetRegistry = new AssetRegistry();
