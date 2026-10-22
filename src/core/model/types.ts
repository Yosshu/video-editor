/**
 * プロジェクト（編集データ）の型定義。
 * 編集ファイル（.vedproj）にはこの構造がそのまま JSON として保存される。
 */

/** 有理数（29.97fps を 30000/1001 のように誤差なく表すため） */
export interface Rational {
  num: number;
  den: number;
}

export interface ProjectSettings {
  width: number;
  height: number;
  fps: Rational;
  sampleRate: number;
  audioChannels: number;
  backgroundColor: string;
}

export type AssetKind = 'video' | 'image' | 'audio' | 'font' | 'lut';

/** 読み込んだ素材ファイルの情報（ファイルの中身は含まない） */
export interface Asset {
  id: string;
  kind: AssetKind;
  /** 元のファイル名 */
  name: string;
  mimeType: string;
  /** バイト数 */
  size: number;
  lastModified: number;
  /** 素材を照合するための指紋（サイズと先頭・末尾のハッシュ） */
  fingerprint: string;
  durationSec?: number;
  /** 映像・画像の表示サイズ */
  width?: number;
  height?: number;
  video?: { codec?: string; frameRate?: number };
  audio?: { sampleRate: number; channels: number; codec?: string };
}

/** イージングのプリセット名 */
export type EasePreset =
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutQuad'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeInQuart'
  | 'easeOutQuart'
  | 'easeInOutQuart'
  | 'easeInSine'
  | 'easeOutSine'
  | 'easeInOutSine'
  | 'easeInExpo'
  | 'easeOutExpo'
  | 'easeInOutExpo'
  | 'easeInBack'
  | 'easeOutBack'
  | 'easeInOutBack'
  | 'easeOutBounce'
  | 'easeOutElastic';

/**
 * 特殊な変化。キーフレームの 2 つの値の間で、
 * random：一定間隔でランダムな値になる / repeat：往復する / shake：直線で変化しながら細かく揺れる
 */
export interface SpecialEase {
  special: 'random' | 'repeat' | 'shake';
  /** 値が変わる間隔・往復の周期（フレーム） */
  period: number;
  /** 揺れの大きさ（shake のみ） */
  amount?: number;
  /** なめらかにつなぐか */
  smooth?: boolean;
  /** 乱数の種（同じ値なら同じ動きになる） */
  seed?: number;
}

/** キーフレームから次のキーフレームまでの変化の仕方 */
export type Ease =
  'hold' | 'linear' | EasePreset | { bezier: [number, number, number, number] } | SpecialEase;

export interface Keyframe {
  /** オブジェクトの開始からの相対フレーム */
  t: number;
  v: number;
  ease?: Ease;
}

/** 時間とともに変化する数値パラメータ */
export interface Animated {
  keys: Keyframe[];
}

/** 式で計算する値（src/core/expr/expr.ts） */
export interface Expression {
  expr: string;
}

export type ParamValue = number | string | boolean | Animated | Expression;

export type ParamMap = Record<string, ParamValue>;

export interface EffectInstance {
  id: string;
  type: string;
  enabled: boolean;
  params: ParamMap;
}

export type ObjectType =
  | 'video'
  | 'image'
  | 'audio'
  | 'text'
  | 'shape'
  | 'solid'
  | 'filter'
  | 'scene'
  | 'framebuffer'
  | 'group'
  | 'timeControl'
  | 'partialFilter'
  | 'camera'
  | 'audioWave';

/** タイムライン上のオブジェクト */
export interface TimelineObject {
  id: string;
  type: ObjectType;
  /** 1 始まりのレイヤー番号 */
  layer: number;
  /** 開始フレーム */
  start: number;
  /** 長さ（フレーム） */
  length: number;
  /** 動画・画像・音声オブジェクトが参照する素材 */
  assetId?: string;
  /** 既定値から変更したパラメータだけを持つ */
  params: ParamMap;
  effects: EffectInstance[];
}

export interface LayerState {
  index: number;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  /** このレイヤーの下に続く何レイヤーを 1 つのまとまりにするか（タイムラインで折りたためる） */
  fold?: number;
  /** まとまりを折りたたんでいるか */
  collapsed?: boolean;
}

/** タイムライン上の目印 */
export interface Marker {
  id: string;
  /** フレーム */
  frame: number;
  label?: string;
  /** 表示色（#rrggbb） */
  color?: string;
}

/** 曲のテンポに合わせた目盛り（BPM グリッド） */
export interface BeatGrid {
  /** 1 分あたりの拍数 */
  bpm: number;
  /** 1 拍目のフレーム */
  offset: number;
  /** 1 小節の拍数 */
  beatsPerBar: number;
  /** タイムラインに表示するか（表示中は拍に吸着する） */
  visible: boolean;
}

export interface Scene {
  id: string;
  name: string;
  width: number;
  height: number;
  /** 既定値から変更のあるレイヤーだけを持つ */
  layers: LayerState[];
  objects: TimelineObject[];
  markers?: Marker[];
  beatGrid?: BeatGrid;
}

export interface Project {
  format: 'vedproj';
  formatVersion: number;
  generator: { name: string; version: string };
  createdAt: string;
  updatedAt: string;
  settings: ProjectSettings;
  assets: Asset[];
  rootSceneId: string;
  scenes: Scene[];
}
