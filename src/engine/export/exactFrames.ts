import { VideoSampleSink, type VideoSample } from 'mediabunny';
import type { VideoFrameRef } from '../compose';
import type { MediaSourceHandle } from '../media/mediaSource';

/** これ以上先へ飛ぶときは順番に読まずにシークする（秒） */
const SEEK_GAP = 2;

/**
 * 書き出し用：時刻の小さい順に要求されるフレームを、取りこぼしなく正確に取り出す。
 */
class ExactReader {
  private sink: VideoSampleSink;
  private iter: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private next: VideoSample | null = null;
  private current: { frame: VideoFrame; timestamp: number; version: number } | null = null;
  private ended = false;
  private version = 0;

  constructor(readonly handle: MediaSourceHandle) {
    this.sink = new VideoSampleSink(handle.videoTrack!);
  }

  private setCurrent(sample: VideoSample): void {
    const frame = sample.toVideoFrame();
    const timestamp = sample.timestamp;
    sample.close();
    this.current?.frame.close();
    this.current = { frame, timestamp, version: ++this.version };
  }

  private restart(t: number): void {
    void this.iter?.return();
    this.next?.close();
    this.next = null;
    this.ended = false;
    this.iter = this.sink.samples(Math.max(0, t - 0.1));
  }

  async prepare(t: number): Promise<void> {
    const ahead = this.next?.timestamp ?? this.current?.timestamp ?? -Infinity;
    if (!this.iter || (this.current && t < this.current.timestamp - 1e-4) || t > ahead + SEEK_GAP) {
      this.restart(t);
    }
    for (;;) {
      if (!this.next && !this.ended) {
        const r = await this.iter!.next();
        if (r.done) this.ended = true;
        else this.next = r.value;
      }
      if (this.next && this.next.timestamp <= t + 1e-4) {
        this.setCurrent(this.next);
        this.next = null;
        continue;
      }
      break;
    }
  }

  frameRef(): VideoFrameRef | undefined {
    if (!this.current) return undefined;
    return {
      frame: this.current.frame,
      rotation: this.handle.rotation,
      width: this.handle.displayWidth,
      height: this.handle.displayHeight,
      version: this.current.version,
    };
  }

  dispose(): void {
    void this.iter?.return();
    this.next?.close();
    this.current?.frame.close();
    this.next = null;
    this.current = null;
  }
}

export class ExactFramePool {
  private readers = new Map<string, ExactReader>();

  constructor(private getHandle: (assetId: string) => MediaSourceHandle | undefined) {}

  private reader(objectId: string, assetId: string): ExactReader | undefined {
    const handle = this.getHandle(assetId);
    if (!handle?.videoTrack) return undefined;
    let r = this.readers.get(objectId);
    if (!r || r.handle !== handle) {
      r?.dispose();
      r = new ExactReader(handle);
      this.readers.set(objectId, r);
    }
    return r;
  }

  /** 描画の前に、必要なフレームをデコードしておく */
  async prepare(objectId: string, assetId: string, sourceTime: number): Promise<void> {
    const r = this.reader(objectId, assetId);
    if (!r) return;
    const t = Math.min(sourceTime, Math.max(0, r.handle.duration - 1e-3));
    await r.prepare(t);
  }

  get(objectId: string): VideoFrameRef | undefined {
    return this.readers.get(objectId)?.frameRef();
  }

  dispose(): void {
    for (const r of this.readers.values()) r.dispose();
    this.readers.clear();
  }
}
