import { fpsValue } from '../../core/model/time';
import type { Rational } from '../../core/model/types';

export const LAYER_H = 30;
export const HEADER_W = 132;
export const RULER_H = 26;
export const MIN_PX_PER_FRAME = 0.02;
export const MAX_PX_PER_FRAME = 40;

/** 目盛りの間隔（フレーム）を、画面上でおよそ minPx 以上空くように選ぶ */
export function chooseTickInterval(
  pxPerFrame: number,
  fps: Rational,
  minPx = 90,
): { major: number; minor: number } {
  const rate = fpsValue(fps);
  const r = Math.round(rate);
  const candidates: number[] = [1, 2, 5, 10];
  for (const sec of [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600])
    candidates.push(Math.round(sec * rate));
  const major =
    candidates.find((c) => c * pxPerFrame >= minPx) ?? candidates[candidates.length - 1];
  let minor: number;
  if (major < r) minor = Math.max(1, Math.round(major / 5));
  else if (major === r) minor = Math.max(1, Math.round(r / 5));
  else
    minor =
      Math.round(major / (major % (5 * r) === 0 ? 5 : major % (2 * r) === 0 ? 2 : 4)) || major;
  return { major, minor };
}

export function formatRulerLabel(frame: number, fps: Rational, major: number): string {
  const rate = fpsValue(fps);
  const totalSeconds = frame / rate;
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (major < Math.round(rate)) {
    const f = Math.round(frame - Math.floor(totalSeconds) * rate);
    return `${m}:${pad(s)}.${pad(f)}`;
  }
  return `${m}:${pad(s)}`;
}
