import { fpsValue } from '../model/time';
import type { BeatGrid, Marker, Rational, Scene } from '../model/types';

/** 1 拍の長さ（フレーム、小数） */
export function framesPerBeat(grid: BeatGrid, fps: Rational): number {
  return (60 / Math.max(1, grid.bpm)) * fpsValue(fps);
}

/** [from, to] の範囲にある拍の位置（フレーム、小数）と、小節の頭かどうか */
export function beatsInRange(
  grid: BeatGrid,
  fps: Rational,
  from: number,
  to: number,
): { frame: number; bar: boolean; index: number }[] {
  const step = framesPerBeat(grid, fps);
  if (!(step > 0)) return [];
  const out: { frame: number; bar: boolean; index: number }[] = [];
  const first = Math.ceil((from - grid.offset) / step);
  const last = Math.floor((to - grid.offset) / step);
  // 拍が細かすぎるときは描かない（ブラウザが固まらないよう上限を設ける）
  if (last - first > 20_000) return out;
  for (let i = first; i <= last; i++) {
    const per = Math.max(1, grid.beatsPerBar);
    out.push({ frame: grid.offset + i * step, bar: ((i % per) + per) % per === 0, index: i });
  }
  return out;
}

/** 吸着先にするフレーム（マーカーと、表示中の BPM グリッドの拍） */
export function markerSnapPoints(scene: Scene, fps: Rational, from: number, to: number): number[] {
  const points = (scene.markers ?? []).map((m) => m.frame);
  if (scene.beatGrid?.visible) {
    for (const b of beatsInRange(scene.beatGrid, fps, Math.max(0, from), to))
      points.push(Math.round(b.frame));
  }
  return points;
}

/** frame より前（direction=-1）／後（1）で最も近いマーカー */
export function neighborMarker(
  markers: Marker[] | undefined,
  frame: number,
  direction: -1 | 1,
): Marker | undefined {
  let best: Marker | undefined;
  for (const m of markers ?? []) {
    if (direction < 0 ? m.frame >= frame : m.frame <= frame) continue;
    if (!best || (direction < 0 ? m.frame > best.frame : m.frame < best.frame)) best = m;
  }
  return best;
}

export const MARKER_COLORS = [
  { value: '#f5b544', label: '黄' },
  { value: '#ff5c5c', label: '赤' },
  { value: '#4fd18b', label: '緑' },
  { value: '#4f8cff', label: '青' },
  { value: '#c77dff', label: '紫' },
];

export const DEFAULT_BEAT_GRID: BeatGrid = { bpm: 120, offset: 0, beatsPerBar: 4, visible: true };
