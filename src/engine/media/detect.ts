import type { AssetKind } from '../../core/model/types';

const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'ts', 'mts', 'm2ts'];
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac', 'weba'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif'];
const FONT_EXT = ['ttf', 'otf', 'woff', 'woff2'];

export function extensionOf(name: string): string {
  const m = /\.([^./\\]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

/** ファイルの種類を推定する（MIME タイプ優先、なければ拡張子） */
export function detectAssetKind(file: { name: string; type: string }): AssetKind | null {
  const type = file.type.toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('font/')) return 'font';
  const ext = extensionOf(file.name);
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (FONT_EXT.includes(ext)) return 'font';
  return null;
}

export function isProjectFileName(name: string): boolean {
  return extensionOf(name) === 'vedproj';
}

export const MEDIA_ACCEPT = [...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT]
  .map((e) => `.${e}`)
  .join(',');
