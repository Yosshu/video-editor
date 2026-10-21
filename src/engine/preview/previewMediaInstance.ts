import { getState } from '../../state/store';
import { AudioPlayer } from '../audio/AudioPlayer';
import { AudioReaderPool } from '../audio/sources';
import type { MediaProvider } from '../compose';
import { assetRegistry } from '../media/registry';
import { VideoFramePool } from '../media/videoFrames';
import { playback } from '../playback/Playback';
import { createPreviewMedia } from './previewMedia';

const frameListeners = new Set<() => void>();

/** 動画フレームが届いたときに呼ばれる（プレビューの再描画用） */
export function onPreviewFrameReady(listener: () => void): () => void {
  frameListeners.add(listener);
  return () => frameListeners.delete(listener);
}

const assetDuration = (id: string) =>
  getState().project.assets.find((a) => a.id === id)?.durationSec;

let instance: { media: MediaProvider; video: VideoFramePool; audio: AudioPlayer } | null = null;

function init() {
  if (instance) return instance;
  const video = new VideoFramePool(
    (id) => assetRegistry.getMedia(id),
    () => getState().playing,
    () => frameListeners.forEach((l) => l()),
  );
  const media = createPreviewMedia((objectId, assetId, t) => video.getFrame(objectId, assetId, t));
  const audio = new AudioPlayer(
    new AudioReaderPool((id) => assetRegistry.getMedia(id), assetDuration),
  );
  playback.setAudio(audio);
  instance = { media, video, audio };
  return instance;
}

/** プレビューで使う素材提供（アプリ全体で 1 つ） */
export function getPreviewMedia(): MediaProvider {
  return init().media;
}

/** 再生の音声を準備する（アプリ起動時に呼ぶ） */
export function setupPreviewAudio(): void {
  init();
}
