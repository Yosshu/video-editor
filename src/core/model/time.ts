import type { Rational } from './types';

export function fpsValue(fps: Rational): number {
  return fps.num / fps.den;
}

export function framesToSeconds(frames: number, fps: Rational): number {
  return (frames * fps.den) / fps.num;
}

export function secondsToFrames(seconds: number, fps: Rational): number {
  return Math.round((seconds * fps.num) / fps.den);
}

/** フレーム番号を「時:分:秒.フレーム」形式にする */
export function formatTimecode(frame: number, fps: Rational): string {
  const rate = Math.round(fpsValue(fps));
  const totalSeconds = Math.floor(framesToSeconds(frame, fps));
  const f = Math.max(0, frame - secondsToFrames(totalSeconds, fps));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const fw = String(Math.max(rate - 1, 1)).length;
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(f, fw)}`;
}

/** よく使うフレームレート */
export const FPS_PRESETS: { label: string; fps: Rational }[] = [
  { label: '24', fps: { num: 24, den: 1 } },
  { label: '23.976', fps: { num: 24000, den: 1001 } },
  { label: '25', fps: { num: 25, den: 1 } },
  { label: '29.97', fps: { num: 30000, den: 1001 } },
  { label: '30', fps: { num: 30, den: 1 } },
  { label: '50', fps: { num: 50, den: 1 } },
  { label: '59.94', fps: { num: 60000, den: 1001 } },
  { label: '60', fps: { num: 60, den: 1 } },
];
