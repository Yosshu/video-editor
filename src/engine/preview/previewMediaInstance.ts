import type { MediaProvider } from '../compose';
import { createPreviewMedia } from './previewMedia';

let instance: MediaProvider | null = null;

/** プレビューで使う素材提供（アプリ全体で 1 つ） */
export function getPreviewMedia(): MediaProvider {
  if (!instance) instance = createPreviewMedia();
  return instance;
}
