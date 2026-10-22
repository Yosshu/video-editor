import { effectDomain, getEffectDef } from '../../core/effects/definitions';
import {
  fadeFactor,
  resolveEffects,
  resolveParams,
  type ResolvedEffect,
  type ResolvedParams,
} from '../../core/evaluate/evaluate';
import { framesToSeconds, secondsToFrames } from '../../core/model/time';
import type { Project, Rational, Scene, TimelineObject } from '../../core/model/types';
import { getObjectDef } from '../../core/objects/definitions';
import { sceneDuration } from '../../core/timeline/ops';
import { AudioEffectChain } from './effects';
import type { PcmReader } from './reader';
import { readLooped, stretch, StretchCache } from './timeStretch';

export interface MixSources {
  /**
   * オブジェクトの音声を読む（音声がなければ null）。
   * instanceKey はオブジェクトの識別子（入れ子のシーンでは親のオブジェクト ID を前につける）
   */
  reader(object: TimelineObject, instanceKey: string): PcmReader | null;
  assetDuration(assetId: string): number | undefined;
  /**
   * オブジェクトの音声エフェクトの状態（続きの区間に引き継ぐ）。
   * 用意しない場合は毎回作り直す（毎回、少し前から処理し直すので遅いが結果は同じ）
   */
  effectChain?(instanceKey: string, sampleRate: number): AudioEffectChain;
  /** 音程を保った速度変更の状態（続きの区間に引き継ぐ）。用意しない場合は区間ごとに決める */
  stretchCache?(instanceKey: string): StretchCache;
}

/** 入れ子のシーンの深さの上限 */
const MAX_DEPTH = 8;

export type StereoPcm = [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>];

/** 音量・パンの計算をまとめて行う単位（サンプル数） */
const BLOCK = 128;

function hasAudio(obj: TimelineObject): boolean {
  if (!getObjectDef(obj.type).audio) return false;
  if ((obj.type === 'video' || obj.type === 'scene') && obj.params.mute === true) return false;
  return true;
}

/** シーンオブジェクトの音声：表示するシーンをミックスしたものを素材として読む */
function sceneReader(
  project: Project,
  nested: Scene,
  sources: MixSources,
  prefix: string,
  path: string[],
): PcmReader {
  const sr = project.settings.sampleRate;
  return {
    read: async (start, end) => {
      const n = Math.max(0, Math.round((end - start) * sr));
      const [l, r] = await mixScene(project, nested, start, n, sources, prefix, path);
      return { start, sampleRate: sr, channels: [l, r] };
    },
    dispose: () => undefined,
  };
}

/** 左右バランス（-100〜100）から左右の倍率 */
export function panGains(pan: number): [number, number] {
  const p = Math.max(-1, Math.min(1, pan / 100));
  return [p > 0 ? 1 - p : 1, p < 0 ? 1 + p : 1];
}

/** ミックスする 1 つのオブジェクトの音源 */
interface ObjectSource {
  obj: TimelineObject;
  reader: PcmReader;
  /** 素材の長さ（秒、ループの折り返しに使う） */
  duration: number | undefined;
  /** シーン内での開始・終了時刻（秒） */
  start: number;
  end: number;
  stretch?: StretchCache;
}

/**
 * オブジェクトの音（音量・パン・フェード込み）を、時刻 t0 から n サンプル分作る。
 * オブジェクトがある区間 [i0, i1) だけに値が入る。
 */
async function renderObject(
  src: ObjectSource,
  t0: number,
  n: number,
  sr: number,
  fps: Rational,
): Promise<{ l: Float32Array<ArrayBuffer>; r: Float32Array<ArrayBuffer>; i0: number; i1: number }> {
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const ov0 = Math.max(t0, src.start);
  const ov1 = Math.min(t0 + n / sr, src.end);
  const i0 = Math.max(0, Math.ceil((ov0 - t0) * sr - 1e-9));
  const i1 = Math.min(n, Math.ceil((ov1 - t0) * sr - 1e-9));
  if (ov1 <= ov0 || i1 <= i0) return { l, r, i0: 0, i1: 0 };

  const { obj, reader, duration } = src;
  const p = obj.params;
  const speed = (typeof p.speed === 'number' ? p.speed : 100) / 100;
  const offset = typeof p.offset === 'number' ? p.offset : 0;
  const loop = p.loop === true;
  const fadeIn = typeof p.fadeIn === 'number' ? p.fadeIn : 0;
  const fadeOut = typeof p.fadeOut === 'number' ? p.fadeOut : 0;
  const objDuration = src.end - src.start;
  // 音量・パンはキーフレームや式で変わるので、フレームごとに評価して使い回す
  let cachedFrame = Number.NaN;
  let cachedVals: ResolvedParams = {};
  const paramsAt = (frame: number) => {
    if (frame !== cachedFrame) {
      cachedFrame = frame;
      cachedVals = resolveParams(obj, frame, { fps });
    }
    return cachedVals;
  };
  const unwrapped = (i: number) => offset + (t0 + i / sr - src.start) * speed;

  // まず素材の音（速度を変えたもの）を作り、そのあと音量・パン・フェードをかける
  if (p.keepPitch === true && Math.abs(speed - 1) > 1e-6) {
    // 音程を保ったまま速度を変える
    const read = (from: number, to: number) =>
      loop && duration && duration > 0
        ? readLooped(reader, duration, from, to)
        : reader.read(Math.max(0, from), Math.max(0, to));
    const signature = [speed, offset, loop, duration, sr, src.start].join('|');
    const [sl, sr2] = await stretch(
      read,
      (local) => offset + local * speed,
      t0 + i0 / sr - src.start,
      i1 - i0,
      sr,
      src.stretch?.use(signature),
    );
    l.set(sl, i0);
    r.set(sr2, i0);
  } else {
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
      for (let i = a; i < b; i++) {
        const pos = (srcStart + ((i - a) / sr) * speed - span.start) * srcRate;
        const idx = Math.floor(pos);
        if (idx < 0 || idx >= L.length) continue;
        const frac = pos - idx;
        const next = Math.min(idx + 1, L.length - 1);
        l[i] = L[idx] + (L[next] - L[idx]) * frac;
        r[i] = R[idx] + (R[next] - R[idx]) * frac;
      }
    }
  }

  for (let block = i0; block < i1; block += BLOCK) {
    const blockEnd = Math.min(i1, block + BLOCK);
    // 音量・パン・フェードはブロック単位で評価する
    const tl = t0 + block / sr;
    const localFrame = secondsToFrames(tl - src.start, fps);
    const vals = paramsAt(localFrame);
    const volume = Number(vals.volume ?? 100) / 100;
    const [gl, gr] = panGains(Number(vals.pan ?? 0));
    const fade = fadeFactor(tl - src.start, objDuration, fadeIn, fadeOut);
    const gain = volume * fade;
    for (let i = block; i < blockEnd; i++) {
      l[i] *= gain * gl;
      r[i] *= gain * gr;
    }
  }
  return { l, r, i0, i1 };
}

function hasAudioEffects(obj: TimelineObject): boolean {
  return obj.effects.some((e) => {
    const def = getEffectDef(e.type);
    return e.enabled && def !== undefined && effectDomain(def) === 'audio';
  });
}

/**
 * オブジェクトの音を作り、音声エフェクトをかける。
 * エフェクトの状態は続きの区間に引き継ぎ、続きでない（シーク直後など）ときは少し前から処理して残響を作る。
 */
async function renderWithEffects(
  src: ObjectSource,
  chain: AudioEffectChain,
  t0: number,
  n: number,
  sr: number,
  fps: Rational,
): Promise<{ l: Float32Array<ArrayBuffer>; r: Float32Array<ArrayBuffer>; i0: number; i1: number }> {
  const { obj } = src;
  chain.sync(
    obj.effects.filter((e) => {
      const def = getEffectDef(e.type);
      return e.enabled && def && effectDomain(def) === 'audio';
    }),
  );
  // サンプル番号 g（シーン内の通し番号）での、エフェクトのパラメータ
  const g0 = Math.round(t0 * sr);
  let cachedFrame = Number.NaN;
  let cached: ResolvedEffect[] = [];
  const paramsAt = (g: number) => {
    const frame = secondsToFrames(t0 + (g - g0) / sr - src.start, fps);
    if (frame !== cachedFrame) {
      cachedFrame = frame;
      cached = resolveEffects(obj.effects, frame, 'audio', { fps, length: obj.length });
    }
    return cached;
  };

  // 区間の先頭（オブジェクトの開始より前は使わない）
  const firstIndex = Math.max(0, Math.ceil((src.start - t0) * sr - 1e-9));
  const pos = chain.position(g0 + firstIndex);
  if (pos === 'reset') {
    chain.reset();
    const startT = t0 + firstIndex / sr;
    const warm = chain.warmupSeconds(paramsAt(g0 + firstIndex));
    const wn = Math.round((startT - Math.max(src.start, startT - warm)) * sr);
    if (wn > 0) {
      const pre = await renderObject(src, startT - wn / sr, wn, sr, fps);
      chain.process(pre.l, pre.r, 0, wn, g0 + firstIndex - wn, paramsAt);
    }
  }
  const out = await renderObject(src, t0, n, sr, fps);
  if (out.i1 <= out.i0) return out;
  let from = out.i0;
  if (typeof pos === 'number') {
    const k = Math.min(pos, out.i1 - out.i0);
    chain.fillFromHistory(out.l, out.r, from, k, g0 + from);
    from += k;
  }
  if (from < out.i1) chain.process(out.l, out.r, from, out.i1, g0 + from, paramsAt);
  return out;
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
  prefix = '',
  path: string[] = [scene.id],
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
    if (Math.min(t1, objEnd) <= Math.max(t0, objStart)) return;
    const key = prefix + obj.id;
    let reader: PcmReader | null;
    let duration: number | undefined;
    if (obj.type === 'scene') {
      const nestedId = String(obj.params.sceneRef ?? '');
      const nested = project.scenes.find((x) => x.id === nestedId);
      if (!nested || path.includes(nestedId) || path.length >= MAX_DEPTH) return;
      reader = sceneReader(project, nested, sources, `${key}/`, [...path, nestedId]);
      duration = framesToSeconds(sceneDuration(nested), fps);
    } else {
      reader = sources.reader(obj, key);
      duration = obj.assetId ? sources.assetDuration(obj.assetId) : undefined;
    }
    if (!reader) return;
    const src: ObjectSource = {
      obj,
      reader,
      duration,
      start: objStart,
      end: objEnd,
      stretch: sources.stretchCache?.(key),
    };
    const rendered = hasAudioEffects(obj)
      ? await renderWithEffects(
          src,
          sources.effectChain?.(key, sr) ?? new AudioEffectChain(sr),
          t0,
          numSamples,
          sr,
          fps,
        )
      : await renderObject(src, t0, numSamples, sr, fps);
    const [L, R] = out;
    for (let i = rendered.i0; i < rendered.i1; i++) {
      L[i] += rendered.l[i];
      R[i] += rendered.r[i];
    }
  });
  await Promise.all(jobs);
  return out;
}
