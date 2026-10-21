import { valueAt } from '../../core/animation/interpolate';
import { fadeFactor } from '../../core/evaluate/evaluate';
import { framesToSeconds, secondsToFrames } from '../../core/model/time';
import type { Project, Scene, TimelineObject } from '../../core/model/types';
import { getObjectDef } from '../../core/objects/definitions';
import type { PcmReader } from './reader';

export interface MixSources {
  /** オブジェクトの音声を読む（音声がなければ null） */
  reader(object: TimelineObject): PcmReader | null;
  assetDuration(assetId: string): number | undefined;
}

export type StereoPcm = [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>];

/** 音量・パンの計算をまとめて行う単位（サンプル数） */
const BLOCK = 128;

function hasAudio(obj: TimelineObject): boolean {
  if (!getObjectDef(obj.type).audio) return false;
  if (obj.type === 'video' && obj.params.mute === true) return false;
  return true;
}

/** 左右バランス（-100〜100）から左右の倍率 */
export function panGains(pan: number): [number, number] {
  const p = Math.max(-1, Math.min(1, pan / 100));
  return [p > 0 ? 1 - p : 1, p < 0 ? 1 + p : 1];
}

/**
 * シーンの音声をミックスする。startSec から numSamples サンプル分（プロジェクトのサンプリングレート、ステレオ）。
 * プレビュー再生と書き出しで共通に使う。
 */
export async function mixScene(
  project: Project,
  scene: Scene,
  startSec: number,
  numSamples: number,
  sources: MixSources,
): Promise<StereoPcm> {
  const sr = project.settings.sampleRate;
  const fps = project.settings.fps;
  const out: StereoPcm = [new Float32Array(numSamples), new Float32Array(numSamples)];
  const t0 = startSec;
  const t1 = startSec + numSamples / sr;
  const hidden = new Set(scene.layers.filter((l) => l.hidden).map((l) => l.index));

  const jobs = scene.objects.map(async (obj) => {
    if (hidden.has(obj.layer) || !hasAudio(obj)) return;
    const objStart = framesToSeconds(obj.start, fps);
    const objEnd = framesToSeconds(obj.start + obj.length, fps);
    const ov0 = Math.max(t0, objStart);
    const ov1 = Math.min(t1, objEnd);
    if (ov1 <= ov0) return;
    const reader = sources.reader(obj);
    if (!reader) return;

    const i0 = Math.max(0, Math.ceil((ov0 - t0) * sr - 1e-9));
    const i1 = Math.min(numSamples, Math.ceil((ov1 - t0) * sr - 1e-9));
    if (i1 <= i0) return;
    const p = obj.params;
    const speed = (typeof p.speed === 'number' ? p.speed : 100) / 100;
    const offset = typeof p.offset === 'number' ? p.offset : 0;
    const loop = p.loop === true;
    const duration = obj.assetId ? sources.assetDuration(obj.assetId) : undefined;
    const fadeIn = typeof p.fadeIn === 'number' ? p.fadeIn : 0;
    const fadeOut = typeof p.fadeOut === 'number' ? p.fadeOut : 0;
    const objDuration = objEnd - objStart;
    const unwrapped = (i: number) => offset + (t0 + i / sr - objStart) * speed;

    // ループで素材の終わりをまたぐ場合は区間を分ける
    const segments: [number, number, number][] = [];
    if (loop && duration && duration > 0) {
      let i = i0;
      while (i < i1) {
        const st = unwrapped(i);
        const local = ((st % duration) + duration) % duration;
        const untilWrap = Math.max(1, Math.ceil(((duration - local) / speed) * sr - 1e-9));
        const end = Math.min(i1, i + untilWrap);
        segments.push([i, end, local]);
        i = end;
      }
    } else {
      segments.push([i0, i1, unwrapped(i0)]);
    }

    for (const [a, b, srcStart] of segments) {
      const srcEnd = srcStart + ((b - a) / sr) * speed;
      const span = await reader.read(Math.max(0, srcStart - 2 / sr), srcEnd + 2 / sr);
      const L = span.channels[0];
      const R = span.channels[1] ?? span.channels[0];
      const srcRate = span.sampleRate;
      for (let block = a; block < b; block += BLOCK) {
        const blockEnd = Math.min(b, block + BLOCK);
        // 音量・パン・フェードはブロック単位で評価する
        const tl = t0 + block / sr;
        const localFrame = secondsToFrames(tl - objStart, fps);
        const volume = valueAt(p.volume, localFrame, 100) / 100;
        const [gl, gr] = panGains(valueAt(p.pan, localFrame, 0));
        const fade = fadeFactor(tl - objStart, objDuration, fadeIn, fadeOut);
        const gain = volume * fade;
        if (gain === 0) continue;
        for (let i = block; i < blockEnd; i++) {
          const pos = (srcStart + ((i - a) / sr) * speed - span.start) * srcRate;
          const idx = Math.floor(pos);
          if (idx < 0 || idx >= L.length) continue;
          const frac = pos - idx;
          const next = Math.min(idx + 1, L.length - 1);
          const sl = L[idx] + (L[next] - L[idx]) * frac;
          const sr2 = R[idx] + (R[next] - R[idx]) * frac;
          out[0][i] += sl * gain * gl;
          out[1][i] += sr2 * gain * gr;
        }
      }
    }
  });
  await Promise.all(jobs);
  return out;
}
