import { AudioBufferSink } from 'mediabunny';
import { assetRegistry } from '../media/registry';

/** 1 秒あたりの区間数 */
export const PEAK_RATE = 100;

export interface Peaks {
  /** 各区間の振幅の最大値（0〜1） */
  data: Float32Array;
  rate: number;
}

const cache = new Map<string, { promise: Promise<Peaks | null>; value?: Peaks | null }>();
const listeners = new Set<() => void>();

export function onPeaksChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function compute(assetId: string): Promise<Peaks | null> {
  const media = assetRegistry.getMedia(assetId);
  if (!media?.audioTrack) return null;
  const data = new Float32Array(Math.ceil(media.duration * PEAK_RATE) + 1);
  const sink = new AudioBufferSink(media.audioTrack);
  for await (const { buffer, timestamp } of sink.buffers()) {
    const sr = buffer.sampleRate;
    const chs = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) =>
      buffer.getChannelData(i),
    );
    const samplesPerBucket = sr / PEAK_RATE;
    for (let i = 0; i < buffer.length; i++) {
      let v = 0;
      for (const ch of chs) v = Math.max(v, Math.abs(ch[i]));
      const bucket = Math.floor((timestamp * sr + i) / samplesPerBucket);
      if (bucket >= 0 && bucket < data.length && v > data[bucket]) data[bucket] = v;
    }
  }
  return { data, rate: PEAK_RATE };
}

/** 素材の波形データを計算し終わるまで待つ（書き出し用） */
export async function loadPeaks(assetId: string): Promise<Peaks | null> {
  peekPeaks(assetId);
  return (await cache.get(assetId)?.promise) ?? null;
}

/** 素材の波形データ。まだなければ計算を始めて undefined を返す */
export function peekPeaks(assetId: string): Peaks | null | undefined {
  let entry = cache.get(assetId);
  if (!entry) {
    if (!assetRegistry.has(assetId)) return undefined;
    const e: { promise: Promise<Peaks | null>; value?: Peaks | null } = {
      promise: compute(assetId).catch(() => null),
    };
    cache.set(assetId, e);
    void e.promise.then((v) => {
      e.value = v;
      for (const l of listeners) l();
    });
    entry = e;
  }
  return entry.value;
}

assetRegistry.onChange((assetId) => {
  if (cache.delete(assetId)) for (const l of listeners) l();
});
