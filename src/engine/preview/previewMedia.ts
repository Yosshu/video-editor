import type { MediaProvider } from '../compose';
import { peekPeaks } from '../audio/waveform';
import { assetRegistry } from '../media/registry';
import { getState } from '../../state/store';

/** プレビュー用の素材提供（動画フレームは Phase 2 で VideoFramePool に置き換える） */
export function createPreviewMedia(
  getVideoFrame: MediaProvider['getVideoFrame'] = () => undefined,
): MediaProvider {
  return {
    getImage: (id) => assetRegistry.getImage(id),
    getVideoFrame,
    assetDuration: (id) => getState().project.assets.find((a) => a.id === id)?.durationSec,
    getPeaks: (id) => peekPeaks(id) ?? undefined,
  };
}
