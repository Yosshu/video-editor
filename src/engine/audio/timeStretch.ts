import type { PcmReader, PcmSpan } from './reader';

/**
 * 音程を保ったまま速度を変える（WSOLA：波形の似た位置を探して重ね合わせる方法）。
 *
 * 出力を「粒」に分け、粒 k をオブジェクト内の時刻 k × hop に置く。粒の中身は、素材の対応する位置
 * （速度に合わせた位置）から等速で読むので、音の高さは変わらない。粒は半分ずつ重ねて窓をかけて足す。
 * 粒をつなぐときの位相のずれを減らすため、前の粒の続きと波形が最も似る位置へ少しずらす。
 * ずらす量は前の粒から順に決まるので、続けて作るときは StretchCache で前の粒の値を引き継ぐ。
 * 続きでないとき（シークした直後など）は、CHAIN 粒前をずらさない粒として、そこから順に決める。
 */

/** 粒の長さ（秒）。半分ずつ重ねる */
const GRAIN_SEC = 0.05;
/** 位置をずらして探す幅（前後それぞれ、秒） */
const SEARCH_SEC = 0.012;
/** ずらす量を何粒前から計算し直すか */
const CHAIN = 4;
/** 波形の似かたを調べるときのおおよそのサンプリングレート（間引いて速くする） */
const ANALYSIS_RATE = 8000;

/** 粒ごとのずらす量を覚えておく（続けて作るときに、前の粒とつながるように） */
export class StretchCache {
  private signature = '';
  private offsets = new Map<number, number>();

  /** 設定（速度・再生位置など）が変わったら、覚えた値を捨てる */
  use(signature: string): Map<number, number> {
    if (signature !== this.signature) {
      this.signature = signature;
      this.offsets.clear();
    }
    return this.offsets;
  }
}

/** 素材の [from, to) 秒を読む（範囲外は 0 として扱う） */
export type SpanReader = (from: number, to: number) => Promise<PcmSpan>;

/**
 * 出力の n サンプル分を作る。
 * nominal はオブジェクト内の時刻（秒）→ 素材内の位置（秒、ループ前の値）、
 * localStart は出力の先頭サンプルのオブジェクト内の時刻（秒）、sr は出力のサンプリングレート。
 * offsets は粒ごとのずらす量（StretchCache.use で得たもの。省略するとこの区間だけで決める）
 */
export async function stretch(
  read: SpanReader,
  nominal: (local: number) => number,
  localStart: number,
  n: number,
  sr: number,
  offsets = new Map<number, number>(),
): Promise<[Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>]> {
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  if (n <= 0) return [outL, outR];
  const N = Math.max(64, Math.round((GRAIN_SEC * sr) / 2) * 2);
  const H = N / 2;
  const x0 = localStart * sr;
  const kFirst = Math.floor(x0 / H) - 1;
  const kLast = Math.floor((x0 + n - 1) / H);
  const posOf = (k: number) => nominal((k * H) / sr);

  const span = await read(
    posOf(kFirst - CHAIN) - SEARCH_SEC - 0.01,
    posOf(kLast) + (N + H) / sr + SEARCH_SEC + 0.01,
  );
  const rate = span.sampleRate;
  const L = span.channels[0];
  const R = span.channels[1] ?? L;
  const at = (pos: number) => (pos - span.start) * rate;

  // 位置合わせ用のモノラル信号
  const mono = R === L ? L : L.map((v, i) => (v + R[i]) / 2);
  const overlap = Math.round((H * rate) / sr);
  const search = Math.round(SEARCH_SEC * rate);
  const stride = Math.max(1, Math.round(rate / ANALYSIS_RATE));
  /** refPos から始まる波形と最も似る、粒 k の位置のずれ（秒） */
  const align = (k: number, refPos: number): number => {
    const base = Math.round(at(posOf(k)));
    const ref = Math.round(at(refPos));
    let best = 0;
    let bestScore = -Infinity;
    for (let d = -search; d <= search; d += stride) {
      let dot = 0;
      let energy = 0;
      for (let j = 0; j < overlap; j += stride) {
        const a = mono[ref + j] ?? 0;
        const b = mono[base + d + j] ?? 0;
        dot += a * b;
        energy += b * b;
      }
      const score = energy > 0 ? dot / Math.sqrt(energy) : 0;
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    return best / rate;
  };
  /** 粒 k のずれ（前の粒の値があればその続き、なければ CHAIN 粒前をずれ 0 として順に決める） */
  const offsetOf = (k: number): number => {
    const known = offsets.get(k);
    if (known !== undefined) return known;
    const prev = offsets.get(k - 1);
    if (prev !== undefined) {
      const d = align(k, posOf(k - 1) + prev + H / sr);
      offsets.set(k, d);
      return d;
    }
    // 続きではないので、以前の値は捨てて新しく始める
    offsets.clear();
    let pos = posOf(k - CHAIN);
    let d = 0;
    for (let j = k - CHAIN + 1; j <= k; j++) {
      d = align(j, pos + H / sr);
      offsets.set(j, d);
      pos = posOf(j) + d;
    }
    return d;
  };

  for (let k = kFirst; k <= kLast; k++) {
    const start = posOf(k) + offsetOf(k);
    const g = k * H;
    const iFrom = Math.max(0, Math.ceil(g - x0));
    const iTo = Math.min(n, Math.ceil(g + N - x0));
    for (let i = iFrom; i < iTo; i++) {
      const local = x0 + i - g;
      // 半分ずつ重ねると合計がちょうど 1 になる窓
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * local) / N);
      const p = at(start + local / sr);
      const q = Math.floor(p);
      if (q < 0 || q + 1 >= L.length) continue;
      const f = p - q;
      outL[i] += (L[q] + (L[q + 1] - L[q]) * f) * w;
      outR[i] += (R[q] + (R[q + 1] - R[q]) * f) * w;
    }
  }
  // 古い粒の値は使わないので捨てる
  for (const k of offsets.keys()) if (k < kFirst - CHAIN) offsets.delete(k);
  return [outL, outR];
}

/**
 * ループする素材を、ループ前の位置 [from, to) でつなげて読む（負の位置は素材の終わりのほう）
 */
export async function readLooped(
  reader: PcmReader,
  duration: number,
  from: number,
  to: number,
): Promise<PcmSpan> {
  const pieces: Float32Array[][] = [];
  let rate = 0;
  let pos = from;
  while (pos < to) {
    const cycle = Math.floor(pos / duration);
    const local = pos - cycle * duration;
    const len = Math.min(to - pos, duration - local);
    if (len <= 1e-9) {
      pos = (cycle + 1) * duration;
      continue;
    }
    const span = await reader.read(local, local + len);
    rate = span.sampleRate;
    const skip = Math.max(0, Math.round((local - span.start) * rate));
    const count = Math.round(len * rate);
    pieces.push(
      [span.channels[0], span.channels[1] ?? span.channels[0]].map((ch) => {
        const out = new Float32Array(count);
        out.set(ch.subarray(skip, skip + count));
        return out;
      }),
    );
    pos += len;
  }
  const total = pieces.reduce((s, p) => s + p[0].length, 0);
  const channels = [0, 1].map((c) => {
    const out = new Float32Array(total);
    let o = 0;
    for (const p of pieces) {
      out.set(p[c], o);
      o += p[c].length;
    }
    return out;
  });
  return { start: from, sampleRate: rate || 48000, channels };
}
