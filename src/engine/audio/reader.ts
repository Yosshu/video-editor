import { AudioBufferSink, type InputAudioTrack, type WrappedAudioBuffer } from 'mediabunny';

/** 素材内の区間の PCM（素材のサンプリングレートのまま） */
export interface PcmSpan {
  /** 先頭サンプルの素材内時刻（秒） */
  start: number;
  sampleRate: number;
  /** 1ch または 2ch */
  channels: Float32Array[];
}

/** ミキサーが音声を読むためのインターフェース */
export interface PcmReader {
  read(start: number, end: number): Promise<PcmSpan>;
  dispose(): void;
}

/** 手前に戻ったときのために残しておく範囲（秒） */
const KEEP_BEHIND = 1;
/** これ以上離れた位置を読むときは、順番に読むのをやめてシークし直す（秒） */
const RESTART_GAP = 3;

/**
 * 音声トラックを区間ごとに読み出す。連続した区間を読むときは前回の続きからデコードする。
 */
export class AudioTrackReader implements PcmReader {
  private sink: AudioBufferSink;
  private iter: AsyncGenerator<WrappedAudioBuffer, void, unknown> | null = null;
  private buffers: WrappedAudioBuffer[] = [];
  private iterFrom = 0;
  private fetchedUntil = 0;
  private ended = false;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(
    track: InputAudioTrack,
    readonly sampleRate: number,
    readonly channelCount: number,
  ) {
    this.sink = new AudioBufferSink(track);
  }

  private restart(t: number): void {
    void this.iter?.return();
    this.buffers = [];
    this.iterFrom = Math.max(0, t - 0.05);
    this.fetchedUntil = this.iterFrom;
    this.ended = false;
    this.iter = this.sink.buffers(this.iterFrom);
  }

  read(start: number, end: number): Promise<PcmSpan> {
    // 同時に呼ばれても順番に処理する
    const task = this.lock.then(() => this.readNow(start, end));
    this.lock = task.catch(() => undefined);
    return task;
  }

  private async readNow(start: number, end: number): Promise<PcmSpan> {
    const sr = this.sampleRate;
    const length = Math.max(0, Math.round((end - start) * sr));
    const channels = Array.from(
      { length: Math.max(1, this.channelCount) },
      () => new Float32Array(length),
    );
    if (length === 0) return { start, sampleRate: sr, channels };

    const firstKept = this.buffers[0]?.timestamp ?? this.iterFrom;
    if (
      !this.iter ||
      start < Math.max(this.iterFrom, firstKept) - 1e-6 ||
      start > this.fetchedUntil + RESTART_GAP
    ) {
      this.restart(start);
    }
    while (!this.ended && this.fetchedUntil < end) {
      const r = await this.iter!.next();
      if (r.done) {
        this.ended = true;
        break;
      }
      this.buffers.push(r.value);
      this.fetchedUntil = r.value.timestamp + r.value.duration;
    }

    for (const b of this.buffers) {
      const bEnd = b.timestamp + b.duration;
      if (bEnd <= start || b.timestamp >= end) continue;
      const buf = b.buffer;
      const srcOffset = Math.round((start - b.timestamp) * buf.sampleRate);
      for (let ch = 0; ch < channels.length; ch++) {
        const src = buf.getChannelData(Math.min(ch, buf.numberOfChannels - 1));
        const dst = channels[ch];
        const from = Math.max(0, -srcOffset);
        const to = Math.min(length, src.length - srcOffset);
        for (let i = from; i < to; i++) dst[i] = src[i + srcOffset];
      }
    }
    // 古いバッファを捨てる
    while (
      this.buffers.length > 1 &&
      this.buffers[0].timestamp + this.buffers[0].duration < start - KEEP_BEHIND
    ) {
      this.buffers.shift();
    }
    return { start, sampleRate: sr, channels };
  }

  dispose(): void {
    void this.iter?.return();
    this.iter = null;
    this.buffers = [];
  }
}
