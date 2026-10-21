import { VideoSampleSink, type VideoSample } from 'mediabunny';
import type { VideoFrameRef } from '../compose';
import type { MediaSourceHandle } from './mediaSource';

/** 先読みしておくフレーム数 */
const QUEUE_SIZE = 6;
/** これ以上先へ飛んだら、順番に読むのをやめてシークし直す（秒） */
const RESTART_GAP = 1.5;
/** 使われなくなった読み込み口を閉じるまでの時間（ミリ秒） */
const IDLE_MS = 5000;

let versionSeq = 0;

interface CurrentFrame {
  frame: VideoFrame;
  timestamp: number;
  duration: number;
  version: number;
}

/**
 * 1 つの動画オブジェクト用のフレーム読み込み。
 * 再生中は順番にデコードして先読みし、停止中は指定時刻のフレームを正確に取り出す。
 */
class ObjectVideoReader {
  private sink: VideoSampleSink;
  current: CurrentFrame | null = null;
  lastUsed = performance.now();
  // 停止中のシーク
  private seeking = false;
  private pendingSeek: number | null = null;
  private resolvedFor: number | null = null;
  // 再生中の順次読み込み
  private iter: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private iterStart = 0;
  private queue: VideoSample[] = [];
  private pumping = false;
  private ended = false;
  private generation = 0;
  private disposed = false;

  constructor(
    readonly handle: MediaSourceHandle,
    private onReady: () => void,
  ) {
    this.sink = new VideoSampleSink(handle.videoTrack!);
  }

  private setCurrent(sample: VideoSample): void {
    const frame = sample.toVideoFrame();
    const next: CurrentFrame = {
      frame,
      timestamp: sample.timestamp,
      duration: sample.duration,
      version: ++versionSeq,
    };
    sample.close();
    this.current?.frame.close();
    this.current = next;
  }

  private covers(t: number): boolean {
    const c = this.current;
    if (!c) return false;
    const dur = c.duration > 0 ? c.duration : 1 / 60;
    return t >= c.timestamp - 1e-4 && t < c.timestamp + dur - 1e-4;
  }

  /** 停止中：正確なフレームを取り出す（連続した要求は最後のものだけ処理する） */
  requestExact(t: number): void {
    if (this.covers(t) || this.resolvedFor === t) return;
    if (this.seeking) {
      this.pendingSeek = t;
      return;
    }
    this.stopIteration();
    this.seeking = true;
    void (async () => {
      try {
        const sample = await this.sink.getSample(Math.max(0, t));
        if (this.disposed) {
          sample?.close();
          return;
        }
        if (sample) this.setCurrent(sample);
        this.resolvedFor = t;
      } catch (e) {
        console.warn('動画フレームを取得できませんでした', e);
        this.resolvedFor = t;
      } finally {
        this.seeking = false;
        const next = this.pendingSeek;
        this.pendingSeek = null;
        if (next !== null && next !== t && !this.disposed) this.requestExact(next);
        else if (!this.disposed) this.onReady();
      }
    })();
  }

  /** 再生中：先読みしたフレームから t に当たるものを選ぶ */
  advance(t: number): void {
    this.resolvedFor = null;
    const c = this.current;
    const needRestart =
      !this.iter ||
      t < this.iterStart - 1e-3 ||
      (this.queue.length > 0 && t > this.queue[this.queue.length - 1].timestamp + RESTART_GAP) ||
      (this.queue.length === 0 && c !== null && t > c.timestamp + RESTART_GAP && !this.ended);
    if (needRestart) this.restart(t);
    while (this.queue.length > 0 && this.queue[0].timestamp <= t + 1e-4) {
      this.setCurrent(this.queue.shift()!);
    }
    this.pump();
  }

  private stopIteration(): void {
    this.generation++;
    for (const s of this.queue) s.close();
    this.queue = [];
    void this.iter?.return();
    this.iter = null;
    this.pumping = false;
    this.ended = false;
  }

  private restart(t: number): void {
    this.stopIteration();
    // 開始位置を少し手前にして、t を含むフレームから受け取る
    this.iterStart = Math.max(0, t - 0.1);
    this.iter = this.sink.samples(this.iterStart);
  }

  private pump(): void {
    if (this.pumping || this.ended || !this.iter) return;
    this.pumping = true;
    const gen = this.generation;
    const iter = this.iter;
    void (async () => {
      try {
        while (gen === this.generation && this.queue.length < QUEUE_SIZE) {
          const r = await iter.next();
          if (gen !== this.generation) {
            if (!r.done) r.value.close();
            return;
          }
          if (r.done) {
            this.ended = true;
            break;
          }
          this.queue.push(r.value);
          if (!this.current) this.onReady();
        }
      } catch (e) {
        if (gen === this.generation) {
          console.warn('動画のデコードに失敗しました', e);
          this.ended = true;
        }
      } finally {
        if (gen === this.generation) this.pumping = false;
      }
    })();
  }

  dispose(): void {
    this.disposed = true;
    this.stopIteration();
    this.current?.frame.close();
    this.current = null;
  }
}

/**
 * プレビュー用に、動画オブジェクトごとのフレームを管理する。
 */
export class VideoFramePool {
  private readers = new Map<string, ObjectVideoReader>();
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private getHandle: (assetId: string) => MediaSourceHandle | undefined,
    private isPlaying: () => boolean,
    /** 新しいフレームが用意できたとき（再描画のため） */
    private onFrameReady: () => void,
  ) {}

  getFrame(objectId: string, assetId: string, sourceTime: number): VideoFrameRef | undefined {
    const handle = this.getHandle(assetId);
    if (!handle?.videoTrack) return undefined;
    let reader = this.readers.get(objectId);
    if (reader && reader.handle !== handle) {
      reader.dispose();
      reader = undefined;
    }
    if (!reader) {
      reader = new ObjectVideoReader(handle, this.onFrameReady);
      this.readers.set(objectId, reader);
      this.ensurePruneTimer();
    }
    reader.lastUsed = performance.now();
    // 素材の長さを超えた位置は最後のフレームを表示する
    const t = Math.min(sourceTime, Math.max(0, handle.duration - 1e-3));
    if (this.isPlaying()) reader.advance(t);
    else reader.requestExact(t);
    const c = reader.current;
    if (!c) return undefined;
    return {
      frame: c.frame,
      rotation: handle.rotation,
      width: handle.displayWidth,
      height: handle.displayHeight,
      version: c.version,
    };
  }

  private ensurePruneTimer(): void {
    if (this.pruneTimer) return;
    this.pruneTimer = setInterval(() => {
      const now = performance.now();
      for (const [id, r] of this.readers) {
        if (now - r.lastUsed > IDLE_MS) {
          r.dispose();
          this.readers.delete(id);
        }
      }
      if (this.readers.size === 0 && this.pruneTimer) {
        clearInterval(this.pruneTimer);
        this.pruneTimer = null;
      }
    }, 1000);
  }

  clear(): void {
    for (const r of this.readers.values()) r.dispose();
    this.readers.clear();
  }
}
