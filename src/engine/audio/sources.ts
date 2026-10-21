import type { TimelineObject } from '../../core/model/types';
import type { MediaSourceHandle } from '../media/mediaSource';
import type { MixSources } from './mixer';
import { AudioTrackReader, type PcmReader } from './reader';

const IDLE_MS = 10_000;

/**
 * オブジェクトごとの音声読み込み口を管理する（同じ素材を複数の場所で使っても、それぞれ順番に読めるように）。
 */
export class AudioReaderPool implements MixSources {
  private readers = new Map<
    string,
    { reader: AudioTrackReader; handle: MediaSourceHandle; lastUsed: number }
  >();

  constructor(
    private getHandle: (assetId: string) => MediaSourceHandle | undefined,
    private getDuration: (assetId: string) => number | undefined,
  ) {}

  reader(object: TimelineObject, instanceKey: string): PcmReader | null {
    if (!object.assetId) return null;
    const handle = this.getHandle(object.assetId);
    if (!handle?.audioTrack) return null;
    let entry = this.readers.get(instanceKey);
    if (entry && entry.handle !== handle) {
      entry.reader.dispose();
      entry = undefined;
    }
    if (!entry) {
      const reader = new AudioTrackReader(
        handle.audioTrack,
        handle.audioSampleRate,
        Math.min(2, handle.audioChannels),
      );
      entry = { reader, handle, lastUsed: 0 };
      this.readers.set(instanceKey, entry);
    }
    entry.lastUsed = performance.now();
    return entry.reader;
  }

  assetDuration(assetId: string): number | undefined {
    return this.getDuration(assetId);
  }

  prune(): void {
    const now = performance.now();
    for (const [id, e] of this.readers) {
      if (now - e.lastUsed > IDLE_MS) {
        e.reader.dispose();
        this.readers.delete(id);
      }
    }
  }

  clear(): void {
    for (const e of this.readers.values()) e.reader.dispose();
    this.readers.clear();
  }
}
