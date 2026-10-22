import type { ResolvedParams } from '../../core/evaluate/evaluate';

/**
 * 音声エフェクトの信号処理。
 * 処理はステレオの Float32Array をその場で書き換える。状態（フィルターの内部値・ディレイの残響）を持つので、
 * 連続した区間を順に渡すこと。
 */
export interface AudioFx {
  process(l: Float32Array, r: Float32Array, from: number, to: number, p: ResolvedParams): void;
  /** シークの直後に、正しい残響を作るために先に処理しておく長さ（秒） */
  warmup(p: ResolvedParams): number;
}

const num = (v: unknown, fallback = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};

const dbToGain = (db: number) => 10 ** (db / 20);

/** 2 次の IIR フィルター（左右で状態を別に持つ） */
class Biquad {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  private l1 = 0;
  private l2 = 0;
  private r1 = 0;
  private r2 = 0;

  private setNormalized(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number) {
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  /** 係数の計算は RBJ のクックブックによる */
  configure(
    kind: 'lowshelf' | 'highshelf' | 'peak' | 'highpass' | 'lowpass',
    f: number,
    sr: number,
    gainDb: number,
    q: number,
  ) {
    const w0 = (2 * Math.PI * Math.min(f, sr * 0.49)) / sr;
    const cos = Math.cos(w0);
    const sin = Math.sin(w0);
    const A = 10 ** (gainDb / 40);
    const alpha = sin / (2 * q);
    const sqA = 2 * Math.sqrt(A) * alpha;
    switch (kind) {
      case 'peak':
        this.setNormalized(
          1 + alpha * A,
          -2 * cos,
          1 - alpha * A,
          1 + alpha / A,
          -2 * cos,
          1 - alpha / A,
        );
        break;
      case 'lowshelf':
        this.setNormalized(
          A * (A + 1 - (A - 1) * cos + sqA),
          2 * A * (A - 1 - (A + 1) * cos),
          A * (A + 1 - (A - 1) * cos - sqA),
          A + 1 + (A - 1) * cos + sqA,
          -2 * (A - 1 + (A + 1) * cos),
          A + 1 + (A - 1) * cos - sqA,
        );
        break;
      case 'highshelf':
        this.setNormalized(
          A * (A + 1 + (A - 1) * cos + sqA),
          -2 * A * (A - 1 + (A + 1) * cos),
          A * (A + 1 + (A - 1) * cos - sqA),
          A + 1 - (A - 1) * cos + sqA,
          2 * (A - 1 - (A + 1) * cos),
          A + 1 - (A - 1) * cos - sqA,
        );
        break;
      case 'highpass':
        this.setNormalized(
          (1 + cos) / 2,
          -(1 + cos),
          (1 + cos) / 2,
          1 + alpha,
          -2 * cos,
          1 - alpha,
        );
        break;
      case 'lowpass':
        this.setNormalized((1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
        break;
    }
  }

  run(l: Float32Array, r: Float32Array, from: number, to: number): void {
    const { b0, b1, b2, a1, a2 } = this;
    let l1 = this.l1;
    let l2 = this.l2;
    let r1 = this.r1;
    let r2 = this.r2;
    for (let i = from; i < to; i++) {
      const xl = l[i];
      const yl = b0 * xl + l1;
      l1 = b1 * xl - a1 * yl + l2;
      l2 = b2 * xl - a2 * yl;
      l[i] = yl;
      const xr = r[i];
      const yr = b0 * xr + r1;
      r1 = b1 * xr - a1 * yr + r2;
      r2 = b2 * xr - a2 * yr;
      r[i] = yr;
    }
    // 極小値（非正規化数）が続くと遅くなるので 0 にする
    const tiny = (v: number) => (Math.abs(v) < 1e-25 ? 0 : v);
    this.l1 = tiny(l1);
    this.l2 = tiny(l2);
    this.r1 = tiny(r1);
    this.r2 = tiny(r2);
  }
}

/** イコライザー：ローカット・低音・中音・高音・ハイカット */
class Equalizer implements AudioFx {
  private bands = Array.from({ length: 5 }, () => new Biquad());
  private active = [false, false, false, false, false];
  private key = '';

  constructor(private sr: number) {}

  process(l: Float32Array, r: Float32Array, from: number, to: number, p: ResolvedParams): void {
    const lowCut = num(p.lowCut);
    const highCut = num(p.highCut);
    const lowGain = num(p.lowGain);
    const midGain = num(p.midGain);
    const highGain = num(p.highGain);
    const key = [
      lowCut,
      highCut,
      lowGain,
      midGain,
      highGain,
      p.lowFreq,
      p.midFreq,
      p.midQ,
      p.highFreq,
    ].join();
    if (key !== this.key) {
      this.key = key;
      const sr = this.sr;
      const [hp, low, mid, high, lp] = this.bands;
      this.active = [
        lowCut > 0,
        lowGain !== 0,
        midGain !== 0,
        highGain !== 0,
        highCut > 0 && highCut < sr / 2,
      ];
      if (this.active[0]) hp.configure('highpass', lowCut, sr, 0, Math.SQRT1_2);
      if (this.active[1]) low.configure('lowshelf', num(p.lowFreq, 120), sr, lowGain, Math.SQRT1_2);
      if (this.active[2])
        mid.configure('peak', num(p.midFreq, 1000), sr, midGain, Math.max(0.05, num(p.midQ, 1)));
      if (this.active[3])
        high.configure('highshelf', num(p.highFreq, 8000), sr, highGain, Math.SQRT1_2);
      if (this.active[4]) lp.configure('lowpass', highCut, sr, 0, Math.SQRT1_2);
    }
    for (let b = 0; b < 5; b++) if (this.active[b]) this.bands[b].run(l, r, from, to);
  }

  warmup(): number {
    return 0.1;
  }
}

/** コンプレッサー：左右共通の検出で、大きい音を抑える */
class Compressor implements AudioFx {
  /** 現在の減衰量（dB、0 以上） */
  private reduction = 0;

  constructor(private sr: number) {}

  process(l: Float32Array, r: Float32Array, from: number, to: number, p: ResolvedParams): void {
    const thr = num(p.threshold, -18);
    const ratio = Math.max(1, num(p.ratio, 4));
    const knee = Math.max(0, num(p.knee, 6));
    const attack = Math.exp(-1 / (Math.max(0.0001, num(p.attack, 10) / 1000) * this.sr));
    const release = Math.exp(-1 / (Math.max(0.001, num(p.release, 150) / 1000) * this.sr));
    const makeup = num(p.makeup);
    const slope = 1 / ratio - 1;
    let red = this.reduction;
    for (let i = from; i < to; i++) {
      const x = Math.max(Math.abs(l[i]), Math.abs(r[i]));
      const over = 20 * Math.log10(x + 1e-12) - thr;
      let target: number;
      if (2 * over < -knee) target = 0;
      else if (knee > 0 && 2 * Math.abs(over) <= knee)
        target = (-slope * (over + knee / 2) ** 2) / (2 * knee);
      else target = -slope * over;
      const coeff = target > red ? attack : release;
      red = target + coeff * (red - target);
      const g = dbToGain(makeup - red);
      l[i] *= g;
      r[i] *= g;
    }
    this.reduction = red;
  }

  warmup(p: ResolvedParams): number {
    return Math.min(2, (num(p.release, 150) / 1000) * 5);
  }
}

const MAX_DELAY_SEC = 2;

/** ディレイ・エコー：遅れた音を繰り返し重ねる */
class Delay implements AudioFx {
  private bufL: Float32Array;
  private bufR: Float32Array;
  private w = 0;

  constructor(private sr: number) {
    const size = Math.ceil(MAX_DELAY_SEC * sr) + 4;
    this.bufL = new Float32Array(size);
    this.bufR = new Float32Array(size);
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number, p: ResolvedParams): void {
    const size = this.bufL.length;
    const d = Math.min(size - 3, Math.max(1, (num(p.time, 300) / 1000) * this.sr));
    const fb = Math.min(0.95, Math.max(0, num(p.feedback, 35) / 100));
    const wet = Math.max(0, num(p.mix, 35) / 100);
    const pingPong = p.pingPong === true;
    const di = Math.floor(d);
    const frac = d - di;
    const { bufL, bufR } = this;
    let w = this.w;
    for (let i = from; i < to; i++) {
      // 読む位置は書く位置の d サンプル前（小数は直線補間）
      let a = w - di;
      if (a < 0) a += size;
      let b = a - 1;
      if (b < 0) b += size;
      const dl = bufL[a] + (bufL[b] - bufL[a]) * frac;
      const dr = bufR[a] + (bufR[b] - bufR[a]) * frac;
      const xl = l[i];
      const xr = r[i];
      if (pingPong) {
        bufL[w] = (xl + xr) * 0.5 + fb * dr;
        bufR[w] = fb * dl;
      } else {
        bufL[w] = xl + fb * dl;
        bufR[w] = xr + fb * dr;
      }
      l[i] = xl + wet * dl;
      r[i] = xr + wet * dr;
      w++;
      if (w >= size) w = 0;
    }
    this.w = w;
  }

  warmup(p: ResolvedParams): number {
    const time = num(p.time, 300) / 1000;
    const fb = Math.min(0.95, Math.max(0, num(p.feedback, 35) / 100));
    const repeats = fb <= 0.001 ? 1 : Math.ceil(Math.log(0.001) / Math.log(fb));
    return Math.min(6, time * (repeats + 1));
  }
}

/** 44.1kHz での遅延の長さ（よく知られた残響アルゴリズムの値） */
const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING = [556, 441, 341, 225];
const STEREO_SPREAD = 23;

class Comb {
  private buf: Float32Array;
  private i = 0;
  private store = 0;
  constructor(size: number) {
    this.buf = new Float32Array(Math.max(1, size));
  }
  get length(): number {
    return this.buf.length;
  }
  run(input: number, feedback: number, damp: number): number {
    const out = this.buf[this.i];
    this.store = out * (1 - damp) + this.store * damp;
    if (Math.abs(this.store) < 1e-25) this.store = 0;
    this.buf[this.i] = input + this.store * feedback;
    if (++this.i >= this.buf.length) this.i = 0;
    return out;
  }
}

class Allpass {
  private buf: Float32Array;
  private i = 0;
  constructor(size: number) {
    this.buf = new Float32Array(Math.max(1, size));
  }
  run(input: number): number {
    const b = this.buf[this.i];
    this.buf[this.i] = input + b * 0.5;
    if (++this.i >= this.buf.length) this.i = 0;
    return b - input;
  }
}

/** リバーブ：並列のコムフィルターと直列のオールパスフィルターで残響を作る */
class Reverb implements AudioFx {
  private combsL: Comb[];
  private combsR: Comb[];
  private allL: Allpass[];
  private allR: Allpass[];
  private pre: Float32Array;
  private preW = 0;

  constructor(private sr: number) {
    const k = sr / 44100;
    this.combsL = COMB_TUNING.map((n) => new Comb(Math.round(n * k)));
    this.combsR = COMB_TUNING.map((n) => new Comb(Math.round((n + STEREO_SPREAD) * k)));
    this.allL = ALLPASS_TUNING.map((n) => new Allpass(Math.round(n * k)));
    this.allR = ALLPASS_TUNING.map((n) => new Allpass(Math.round((n + STEREO_SPREAD) * k)));
    this.pre = new Float32Array(Math.ceil(0.2 * sr) + 2);
  }

  private feedback(p: ResolvedParams): number {
    return 0.7 + 0.28 * Math.min(1, Math.max(0, num(p.roomSize, 60) / 100));
  }

  process(l: Float32Array, r: Float32Array, from: number, to: number, p: ResolvedParams): void {
    const fb = this.feedback(p);
    const damp = 0.4 * Math.min(1, Math.max(0, num(p.damping, 50) / 100));
    const wet = Math.max(0, num(p.mix, 25) / 100) * 3;
    const width = Math.min(1, Math.max(0, num(p.width, 100) / 100));
    const wet1 = wet * (width / 2 + 0.5);
    const wet2 = wet * ((1 - width) / 2);
    const preLen = this.pre.length;
    const delay = Math.min(preLen - 1, Math.round((num(p.preDelay, 10) / 1000) * this.sr));
    for (let i = from; i < to; i++) {
      // 前置きの遅れ
      this.pre[this.preW] = (l[i] + r[i]) * 0.015;
      let ri = this.preW - delay;
      if (ri < 0) ri += preLen;
      const input = this.pre[ri];
      if (++this.preW >= preLen) this.preW = 0;
      let outL = 0;
      let outR = 0;
      for (let c = 0; c < 8; c++) {
        outL += this.combsL[c].run(input, fb, damp);
        outR += this.combsR[c].run(input, fb, damp);
      }
      for (let a = 0; a < 4; a++) {
        outL = this.allL[a].run(outL);
        outR = this.allR[a].run(outR);
      }
      l[i] += outL * wet1 + outR * wet2;
      r[i] += outR * wet1 + outL * wet2;
    }
  }

  warmup(p: ResolvedParams): number {
    // 一番長いコムフィルターが 60dB 減衰するまでの時間（上限 3 秒）
    const longest = this.combsR[this.combsR.length - 1].length / this.sr;
    const rt60 = (longest * Math.log(0.001)) / Math.log(this.feedback(p));
    return Math.min(3, Math.max(0.2, rt60 + num(p.preDelay, 10) / 1000));
  }
}

const FACTORIES: Record<string, (sampleRate: number) => AudioFx> = {
  equalizer: (sr) => new Equalizer(sr),
  compressor: (sr) => new Compressor(sr),
  delay: (sr) => new Delay(sr),
  reverb: (sr) => new Reverb(sr),
};

export function createAudioFx(type: string, sampleRate: number): AudioFx | null {
  return FACTORIES[type]?.(sampleRate) ?? null;
}

/** 処理済みの出力を覚えておく長さ（サンプル）。少し重なった区間を読み直されたときに使う */
const HISTORY = 4096;
/** 音量などのパラメータを評価し直す間隔（サンプル） */
const BLOCK = 128;

export interface ChainEffect {
  id: string;
  type: string;
  params: ResolvedParams;
}

/**
 * 1 つのオブジェクトにかけるエフェクトの並び。
 * サンプル番号（シーンの先頭からの通し番号）で処理の続きを管理し、
 * 続きから処理できないとき（シーク直後など）は呼び出し側に助走を求める。
 */
export class AudioEffectChain {
  private fx = new Map<string, { type: string; fx: AudioFx }>();
  /** 次に処理するサンプル番号（NaN なら未処理） */
  private next = Number.NaN;
  private histL = new Float32Array(HISTORY);
  private histR = new Float32Array(HISTORY);

  constructor(private sampleRate: number) {}

  /** エフェクトの並びを合わせる（新しいものは状態なしで作り、なくなったものは捨てる） */
  sync(effects: { id: string; type: string }[]): void {
    const ids = new Set(effects.map((e) => e.id));
    for (const id of this.fx.keys()) if (!ids.has(id)) this.fx.delete(id);
    for (const e of effects) {
      const cur = this.fx.get(e.id);
      if (cur && cur.type === e.type) continue;
      const fx = createAudioFx(e.type, this.sampleRate);
      if (fx) this.fx.set(e.id, { type: e.type, fx });
    }
  }

  /**
   * サンプル番号 g から処理を始められるか。
   * 'continue'：続きから処理できる / 数値：その数のサンプルは処理済み（履歴から埋められる） / 'reset'：助走が必要
   */
  position(g: number): 'continue' | number | 'reset' {
    if (Number.isNaN(this.next)) return 'reset';
    // 数サンプルの飛びは無視して続ける（秒単位の区切りの丸め誤差）
    if (g >= this.next && g <= this.next + 2) return 'continue';
    if (g < this.next && this.next - g <= HISTORY) return this.next - g;
    return 'reset';
  }

  /** 状態を捨てて最初からにする */
  reset(): void {
    const types = [...this.fx.entries()].map(([id, v]) => ({ id, type: v.type }));
    this.fx.clear();
    this.next = Number.NaN;
    this.sync(types);
  }

  /** 助走に必要な長さ（秒） */
  warmupSeconds(effects: ChainEffect[]): number {
    let sum = 0;
    for (const e of effects) sum += this.fx.get(e.id)?.fx.warmup(e.params) ?? 0;
    return Math.min(6, sum);
  }

  /** 処理済みの出力を l/r[from..from+count) に書き戻す（g はその先頭のサンプル番号） */
  fillFromHistory(l: Float32Array, r: Float32Array, from: number, count: number, g: number): void {
    for (let k = 0; k < count; k++) {
      const h = (((g + k) % HISTORY) + HISTORY) % HISTORY;
      l[from + k] = this.histL[h];
      r[from + k] = this.histR[h];
    }
  }

  /**
   * l/r[from..to) を処理する。g は from のサンプル番号。
   * paramsAt はサンプル番号でのエフェクトのパラメータ（ブロックごとに呼ぶ）
   */
  process(
    l: Float32Array,
    r: Float32Array,
    from: number,
    to: number,
    g: number,
    paramsAt: (g: number) => ChainEffect[],
  ): void {
    for (let block = from; block < to; block += BLOCK) {
      const end = Math.min(to, block + BLOCK);
      const list = paramsAt(g + (block - from));
      for (const e of list) this.fx.get(e.id)?.fx.process(l, r, block, end, e.params);
    }
    for (let i = from; i < to; i++) {
      const h = (((g + i - from) % HISTORY) + HISTORY) % HISTORY;
      this.histL[h] = l[i];
      this.histR[h] = r[i];
    }
    this.next = g + (to - from);
  }
}
