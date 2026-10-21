import { currentScene, getState } from '../../state/store';
import type { PlaybackAudio } from '../playback/Playback';
import { mixScene, type MixSources, type StereoPcm } from './mixer';

/** 一度にミックスする長さ（秒） */
const CHUNK_SEC = 0.25;
/** どれだけ先までミックスして予約しておくか（秒） */
const LOOKAHEAD_SEC = 1.0;
/** 再生開始までの余裕（秒） */
const START_DELAY = 0.1;

/**
 * プレビュー再生の音声。シーンを少しずつミックスして AudioContext に予約していく。
 * AudioContext の時刻を再生の基準時計にする。
 */
export class AudioPlayer implements PlaybackAudio {
  private ctx: AudioContext | null = null;
  private session = 0;
  private scheduled = new Set<AudioBufferSourceNode>();
  private gain: GainNode | null = null;

  constructor(private sources: MixSources & { prune?: () => void }) {}

  private context(): AudioContext {
    const sampleRate = getState().project.settings.sampleRate;
    if (!this.ctx || this.ctx.sampleRate !== sampleRate || this.ctx.state === 'closed') {
      void this.ctx?.close();
      this.ctx = new AudioContext({ sampleRate, latencyHint: 'interactive' });
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  now(): number {
    const ctx = this.ctx;
    if (!ctx) return performance.now() / 1000;
    // 実際に耳に届いている時刻（出力の遅延を差し引く）
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  }

  async start(fromSeconds: number): Promise<number> {
    this.stop();
    const ctx = this.context();
    if (ctx.state !== 'running') await ctx.resume();
    const session = ++this.session;
    const startAt = ctx.currentTime + START_DELAY;
    void this.scheduleLoop(session, startAt, fromSeconds);
    // now() と同じ基準（出力遅延を引いた時刻）で返す
    return startAt - (ctx.outputLatency || ctx.baseLatency || 0);
  }

  private async scheduleLoop(session: number, startAt: number, fromSeconds: number): Promise<void> {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const chunkSamples = Math.round(CHUNK_SEC * sr);
    let index = 0;
    while (session === this.session) {
      const chunkStart = startAt + index * CHUNK_SEC;
      // 先読みしすぎないよう待つ
      const ahead = chunkStart - ctx.currentTime;
      if (ahead > LOOKAHEAD_SEC) {
        await new Promise((r) => setTimeout(r, (ahead - LOOKAHEAD_SEC) * 1000));
        continue;
      }
      const state = getState();
      const scene = currentScene(state);
      let mix: StereoPcm;
      try {
        mix = await mixScene(
          state.project,
          scene,
          fromSeconds + index * CHUNK_SEC,
          chunkSamples,
          this.sources,
        );
      } catch (e) {
        console.warn('音声のミックスに失敗しました', e);
        mix = [new Float32Array(chunkSamples), new Float32Array(chunkSamples)];
      }
      if (session !== this.session) return;
      const buffer = ctx.createBuffer(2, chunkSamples, sr);
      buffer.copyToChannel(mix[0], 0);
      buffer.copyToChannel(mix[1], 1);
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(this.gain!);
      const when = Math.max(chunkStart, ctx.currentTime);
      // 間に合わなかった分は先頭を飛ばして時刻を合わせる
      node.start(when, when - chunkStart);
      node.onended = () => this.scheduled.delete(node);
      this.scheduled.add(node);
      index++;
      if (index % 8 === 0) this.sources.prune?.();
    }
  }

  stop(): void {
    this.session++;
    for (const node of this.scheduled) {
      try {
        node.stop();
      } catch {
        // すでに止まっている
      }
      node.disconnect();
    }
    this.scheduled.clear();
  }
}
