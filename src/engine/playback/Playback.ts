import { framesToSeconds, secondsToFrames } from '../../core/model/time';
import { sceneDuration } from '../../core/timeline/ops';
import { currentScene, getState, useEditor } from '../../state/store';

/** 再生中の音声（Phase 2 で実装）。再生の基準時計にもなる */
export interface PlaybackAudio {
  /** 指定位置（秒）から再生を始め、開始時刻（AudioContext の時刻）を返す */
  start(fromSeconds: number): Promise<number>;
  stop(): void;
  /** 基準時計の現在時刻（秒） */
  now(): number;
}

/**
 * 再生の制御。基準時計から現在のフレームを計算し、再生位置を更新する。
 */
export class Playback {
  private raf = 0;
  private startClock = 0;
  private startFrame = 0;
  private session = 0;
  private audio: PlaybackAudio | null = null;

  setAudio(audio: PlaybackAudio | null): void {
    this.audio = audio;
  }

  private clockNow(): number {
    return this.audio ? this.audio.now() : performance.now() / 1000;
  }

  async play(): Promise<void> {
    const state = getState();
    if (state.playing) return;
    const duration = sceneDuration(currentScene(state));
    if (duration <= 0) return;
    let from = state.playhead;
    if (from >= duration - 1) from = 0;
    const session = ++this.session;
    useEditor.setState({ playing: true, playhead: from });
    const fps = state.project.settings.fps;
    this.startFrame = from;
    try {
      this.startClock = this.audio
        ? await this.audio.start(framesToSeconds(from, fps))
        : this.clockNow();
    } catch (e) {
      console.error(e);
      this.startClock = this.clockNow();
    }
    if (session !== this.session) return;
    const tick = () => {
      if (session !== this.session) return;
      const s = getState();
      const elapsed = Math.max(0, this.clockNow() - this.startClock);
      const frame = this.startFrame + secondsToFrames(elapsed, s.project.settings.fps);
      const end = sceneDuration(currentScene(s));
      if (frame >= end) {
        this.pause();
        useEditor.setState({ playhead: Math.max(0, end - 1) });
        return;
      }
      if (frame !== s.playhead) useEditor.setState({ playhead: frame });
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause(): void {
    this.session++;
    cancelAnimationFrame(this.raf);
    this.audio?.stop();
    if (getState().playing) useEditor.setState({ playing: false });
  }

  toggle(): void {
    if (getState().playing) this.pause();
    else void this.play();
  }
}

export const playback = new Playback();
