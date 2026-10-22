import type { Asset, AssetKind } from '../../core/model/types';
import { newId } from '../../core/model/ids';
import { detectAssetKind } from './detect';
import { computeFingerprint } from './fingerprint';
import { describeMedia, openMediaSource, type MediaSourceHandle } from './mediaSource';
import { t } from '../../i18n';

export class AssetImportError extends Error {}

interface Runtime {
  file: File;
  image?: ImageBitmap;
  media?: MediaSourceHandle;
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

  getImage(assetId: string): ImageBitmap | undefined {
    return this.runtimes.get(assetId)?.image;
  }

  getMedia(assetId: string): MediaSourceHandle | undefined {
    return this.runtimes.get(assetId)?.media;
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
    if (kind === 'image') {
      let image: ImageBitmap;
      try {
        image = await decodeImage(file);
      } catch {
        throw new AssetImportError(t('画像「{0}」を読み込めませんでした。', file.name));
      }
      const asset: Asset = { ...base, kind: 'image', width: image.width, height: image.height };
      this.runtimes.set(asset.id, { file, image });
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
      this.runtimes.set(asset.id, { file, image });
    } else if (asset.kind === 'video' || asset.kind === 'audio') {
      const media = await openMediaSource(file);
      this.runtimes.set(asset.id, { file, media });
    } else {
      this.runtimes.set(asset.id, { file });
    }
    this.emit(asset.id);
  }

  release(assetId: string): void {
    const rt = this.runtimes.get(assetId);
    if (!rt) return;
    rt.image?.close();
    rt.media?.dispose();
    this.runtimes.delete(assetId);
    this.emit(assetId);
  }

  clear(): void {
    for (const id of [...this.runtimes.keys()]) this.release(id);
  }
}

export const assetRegistry = new AssetRegistry();
