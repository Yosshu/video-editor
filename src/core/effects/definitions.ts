import type { ParamDef } from '../params/defs';

/**
 * エフェクトの定義（パラメータと表示名）。
 * 映像の実装は src/engine/effects、音声の実装は src/engine/audio/effects.ts にある
 */
export interface EffectDef {
  type: string;
  label: string;
  category: string;
  /** 映像にかけるか音声にかけるか（省略時は映像） */
  domain?: EffectDomain;
  params: ParamDef[];
}

export type EffectDomain = 'video' | 'audio';

/** 数値パラメータ（キーフレームで変化させられる） */
const numberParam = (
  id: string,
  label: string,
  def: number,
  opts: {
    min?: number;
    max?: number;
    sliderMin?: number;
    sliderMax?: number;
    step?: number;
    unit?: string;
  },
): ParamDef => ({ id, label, kind: 'number', default: def, animatable: true, step: 1, ...opts });

const color = (id: string, label: string, def: string): ParamDef => ({
  id,
  label,
  kind: 'color',
  default: def,
});

/** 映像エフェクト */
const VIDEO_EFFECTS: EffectDef[] = [
  {
    type: 'colorAdjust',
    label: '色調補正',
    category: '色',
    params: [
      {
        id: 'brightness',
        label: '明るさ',
        kind: 'number',
        default: 100,
        min: 0,
        max: 400,
        sliderMax: 200,
        step: 0.1,
        unit: '%',
        animatable: true,
      },
      {
        id: 'contrast',
        label: 'コントラスト',
        kind: 'number',
        default: 100,
        min: 0,
        max: 400,
        sliderMax: 200,
        step: 0.1,
        unit: '%',
        animatable: true,
      },
      {
        id: 'hue',
        label: '色相',
        kind: 'number',
        default: 0,
        sliderMin: -180,
        sliderMax: 180,
        step: 0.1,
        unit: '°',
        animatable: true,
      },
      {
        id: 'saturation',
        label: '彩度',
        kind: 'number',
        default: 100,
        min: 0,
        max: 400,
        sliderMax: 200,
        step: 0.1,
        unit: '%',
        animatable: true,
      },
      {
        id: 'gamma',
        label: 'ガンマ',
        kind: 'number',
        default: 100,
        min: 1,
        max: 500,
        sliderMax: 300,
        step: 0.1,
        unit: '%',
        animatable: true,
      },
    ],
  },
  {
    type: 'monochrome',
    label: '単色化',
    category: '色',
    params: [
      color('color', '色', '#ffffff'),
      {
        id: 'strength',
        label: '強さ',
        kind: 'number',
        default: 100,
        min: 0,
        max: 100,
        step: 0.1,
        unit: '%',
        animatable: true,
      },
      { id: 'keepLuminance', label: '明るさを保つ', kind: 'boolean', default: true },
    ],
  },
  {
    type: 'blur',
    label: 'ぼかし',
    category: 'ぼかし',
    params: [
      {
        id: 'radius',
        label: '範囲',
        kind: 'number',
        default: 8,
        min: 0,
        max: 500,
        sliderMax: 100,
        step: 0.1,
        unit: 'px',
        animatable: true,
      },
      { id: 'expand', label: 'はみ出してぼかす', kind: 'boolean', default: true },
    ],
  },
  {
    type: 'edgeBlur',
    label: '境界ぼかし',
    category: 'ぼかし',
    params: [
      {
        id: 'radius',
        label: '範囲',
        kind: 'number',
        default: 10,
        min: 0,
        max: 500,
        sliderMax: 100,
        step: 0.1,
        unit: 'px',
        animatable: true,
      },
    ],
  },
  {
    type: 'mosaic',
    label: 'モザイク',
    category: 'ぼかし',
    params: [
      {
        id: 'size',
        label: 'サイズ',
        kind: 'number',
        default: 16,
        min: 1,
        max: 1000,
        sliderMax: 100,
        step: 1,
        unit: 'px',
        animatable: true,
      },
    ],
  },
  {
    type: 'sharpen',
    label: 'シャープ',
    category: 'ぼかし',
    params: [
      {
        id: 'strength',
        label: '強さ',
        kind: 'number',
        default: 50,
        min: 0,
        max: 500,
        sliderMax: 200,
        step: 0.1,
        unit: '%',
        animatable: true,
      },
      {
        id: 'radius',
        label: '範囲',
        kind: 'number',
        default: 1.5,
        min: 0.5,
        max: 20,
        step: 0.1,
        unit: 'px',
        animatable: true,
      },
    ],
  },
  {
    type: 'glow',
    label: '発光',
    category: '光',
    params: [
      {
        id: 'strength',
        label: '強さ',
        kind: 'number',
        default: 100,
        min: 0,
        max: 1000,
        sliderMax: 300,
        step: 0.1,
        unit: '%',
        animatable: true,
      },
      {
        id: 'radius',
        label: '拡散',
        kind: 'number',
        default: 20,
        min: 0,
        max: 500,
        sliderMax: 150,
        step: 0.1,
        unit: 'px',
        animatable: true,
      },
      {
        id: 'threshold',
        label: 'しきい値',
        kind: 'number',
        default: 50,
        min: 0,
        max: 100,
        step: 0.1,
        unit: '%',
        animatable: true,
      },
      color('color', '光の色', '#ffffff'),
      { id: 'useColor', label: '光の色を指定する', kind: 'boolean', default: false },
    ],
  },
  {
    type: 'outline',
    label: '縁取り',
    category: '装飾',
    params: [
      {
        id: 'size',
        label: 'サイズ',
        kind: 'number',
        default: 6,
        min: 0,
        max: 200,
        sliderMax: 50,
        step: 0.1,
        unit: 'px',
        animatable: true,
      },
      {
        id: 'blur',
        label: 'ぼかし',
        kind: 'number',
        default: 0,
        min: 0,
        max: 100,
        sliderMax: 30,
        step: 0.1,
        unit: 'px',
        animatable: true,
      },
      color('color', '色', '#000000'),
    ],
  },
  {
    type: 'dropShadow',
    label: 'ドロップシャドウ',
    category: '装飾',
    params: [
      {
        id: 'x',
        label: '位置 X',
        kind: 'number',
        default: 10,
        sliderMin: -100,
        sliderMax: 100,
        step: 0.1,
        unit: 'px',
        animatable: true,
      },
      {
        id: 'y',
        label: '位置 Y',
        kind: 'number',
        default: 10,
        sliderMin: -100,
        sliderMax: 100,
        step: 0.1,
        unit: 'px',
        animatable: true,
      },
      {
        id: 'blur',
        label: 'ぼかし',
        kind: 'number',
        default: 8,
        min: 0,
        max: 200,
        sliderMax: 60,
        step: 0.1,
        unit: 'px',
        animatable: true,
      },
      {
        id: 'opacity',
        label: '濃さ',
        kind: 'number',
        default: 60,
        min: 0,
        max: 100,
        step: 0.1,
        unit: '%',
        animatable: true,
      },
      color('color', '色', '#000000'),
    ],
  },
  {
    type: 'crop',
    label: 'クリッピング',
    category: '切り抜き',
    params: [
      {
        id: 'top',
        label: '上',
        kind: 'number',
        default: 0,
        min: 0,
        sliderMax: 1000,
        step: 1,
        unit: 'px',
        animatable: true,
      },
      {
        id: 'bottom',
        label: '下',
        kind: 'number',
        default: 0,
        min: 0,
        sliderMax: 1000,
        step: 1,
        unit: 'px',
        animatable: true,
      },
      {
        id: 'left',
        label: '左',
        kind: 'number',
        default: 0,
        min: 0,
        sliderMax: 1000,
        step: 1,
        unit: 'px',
        animatable: true,
      },
      {
        id: 'right',
        label: '右',
        kind: 'number',
        default: 0,
        min: 0,
        sliderMax: 1000,
        step: 1,
        unit: 'px',
        animatable: true,
      },
    ],
  },
  {
    type: 'mask',
    label: 'マスク（図形）',
    category: '切り抜き',
    params: [
      {
        id: 'shape',
        label: '形',
        kind: 'select',
        default: 'ellipse',
        options: [
          { value: 'ellipse', label: '円' },
          { value: 'rectangle', label: '四角形' },
        ],
      },
      {
        id: 'x',
        label: 'X',
        kind: 'number',
        default: 0,
        sliderMin: -1000,
        sliderMax: 1000,
        step: 1,
        unit: 'px',
        animatable: true,
      },
      {
        id: 'y',
        label: 'Y',
        kind: 'number',
        default: 0,
        sliderMin: -1000,
        sliderMax: 1000,
        step: 1,
        unit: 'px',
        animatable: true,
      },
      {
        id: 'width',
        label: '幅',
        kind: 'number',
        default: 300,
        min: 0,
        sliderMax: 2000,
        step: 1,
        unit: 'px',
        animatable: true,
      },
      {
        id: 'height',
        label: '高さ',
        kind: 'number',
        default: 300,
        min: 0,
        sliderMax: 2000,
        step: 1,
        unit: 'px',
        animatable: true,
      },
      {
        id: 'feather',
        label: 'ぼかし',
        kind: 'number',
        default: 0,
        min: 0,
        sliderMax: 200,
        step: 0.1,
        unit: 'px',
        animatable: true,
      },
      { id: 'invert', label: '反転', kind: 'boolean', default: false },
    ],
  },
  {
    type: 'chromaKey',
    label: 'クロマキー',
    category: '抽出',
    params: [
      color('color', 'キーの色', '#00ff00'),
      {
        id: 'tolerance',
        label: '色の範囲',
        kind: 'number',
        default: 30,
        min: 0,
        max: 100,
        step: 0.1,
        unit: '%',
        animatable: true,
      },
      {
        id: 'softness',
        label: '境界のなめらかさ',
        kind: 'number',
        default: 10,
        min: 0,
        max: 100,
        step: 0.1,
        unit: '%',
        animatable: true,
      },
      {
        id: 'spill',
        label: '色かぶりの除去',
        kind: 'number',
        default: 50,
        min: 0,
        max: 100,
        step: 0.1,
        unit: '%',
        animatable: true,
      },
    ],
  },
  {
    type: 'colorKey',
    label: 'カラーキー',
    category: '抽出',
    params: [
      color('color', 'キーの色', '#ffffff'),
      {
        id: 'tolerance',
        label: '色の範囲',
        kind: 'number',
        default: 10,
        min: 0,
        max: 100,
        step: 0.1,
        unit: '%',
        animatable: true,
      },
      {
        id: 'softness',
        label: '境界のなめらかさ',
        kind: 'number',
        default: 5,
        min: 0,
        max: 100,
        step: 0.1,
        unit: '%',
        animatable: true,
      },
    ],
  },
  {
    type: 'lumaKey',
    label: 'ルミナンスキー',
    category: '抽出',
    params: [
      {
        id: 'threshold',
        label: 'しきい値',
        kind: 'number',
        default: 20,
        min: 0,
        max: 100,
        step: 0.1,
        unit: '%',
        animatable: true,
      },
      {
        id: 'softness',
        label: '境界のなめらかさ',
        kind: 'number',
        default: 10,
        min: 0,
        max: 100,
        step: 0.1,
        unit: '%',
        animatable: true,
      },
      {
        id: 'mode',
        label: '透明にする部分',
        kind: 'select',
        default: 'dark',
        options: [
          { value: 'dark', label: '暗い部分' },
          { value: 'bright', label: '明るい部分' },
        ],
      },
    ],
  },
];

/** 変形・光・加工などの映像エフェクト（Phase 7 で追加） */
const MORE_VIDEO_EFFECTS: EffectDef[] = [
  {
    type: 'lut',
    label: 'LUT（色の変換表）',
    category: '色',
    params: [
      { id: 'lut', label: 'LUT ファイル（.cube）', kind: 'asset', assetKind: 'lut', default: '' },
      numberParam('strength', '強さ', 100, { min: 0, max: 100, step: 0.1, unit: '%' }),
    ],
  },
  {
    type: 'mirror',
    label: 'ミラー',
    category: '変形',
    params: [
      {
        id: 'direction',
        label: '反転して並べる向き',
        kind: 'select',
        default: 'right',
        options: [
          { value: 'right', label: '右' },
          { value: 'left', label: '左' },
          { value: 'bottom', label: '下' },
          { value: 'top', label: '上' },
        ],
      },
    ],
  },
  {
    type: 'vibrate',
    label: '振動',
    category: '変形',
    params: [
      numberParam('amountX', '横の揺れ幅', 10, { min: 0, max: 1000, sliderMax: 100, unit: 'px' }),
      numberParam('amountY', '縦の揺れ幅', 10, { min: 0, max: 1000, sliderMax: 100, unit: 'px' }),
      numberParam('interval', '揺れる間隔', 1, {
        min: 1,
        max: 300,
        sliderMax: 30,
        unit: 'フレーム',
      }),
    ],
  },
  {
    type: 'wave',
    label: '波打ち',
    category: '変形',
    params: [
      numberParam('amplitude', '振れ幅', 20, { min: 0, max: 1000, sliderMax: 200, unit: 'px' }),
      numberParam('wavelength', '波の長さ', 200, {
        min: 1,
        max: 5000,
        sliderMax: 1000,
        unit: 'px',
      }),
      numberParam('speed', '速さ', 1, {
        min: -50,
        max: 50,
        sliderMin: -5,
        sliderMax: 5,
        step: 0.01,
        unit: '回/秒',
      }),
      {
        id: 'direction',
        label: '揺れる向き',
        kind: 'select',
        default: 'horizontal',
        options: [
          { value: 'horizontal', label: '横' },
          { value: 'vertical', label: '縦' },
        ],
      },
    ],
  },
  {
    type: 'polar',
    label: '極座標変換',
    category: '変形',
    params: [
      {
        id: 'center',
        label: '円の中心にする辺',
        kind: 'select',
        default: 'top',
        options: [
          { value: 'top', label: '上の辺' },
          { value: 'bottom', label: '下の辺' },
        ],
      },
      numberParam('rotation', '回転', 0, { sliderMin: -360, sliderMax: 360, step: 0.1, unit: '°' }),
    ],
  },
  {
    type: 'displace',
    label: 'ゆがみ（膨らみ・へこみ・渦巻き）',
    category: '変形',
    params: [
      {
        id: 'kind',
        label: '種類',
        kind: 'select',
        default: 'bulge',
        options: [
          { value: 'bulge', label: '膨らみ' },
          { value: 'pinch', label: 'へこみ' },
          { value: 'twirl', label: '渦巻き' },
        ],
      },
      numberParam('x', 'X', 0, { sliderMin: -1000, sliderMax: 1000, unit: 'px' }),
      numberParam('y', 'Y', 0, { sliderMin: -1000, sliderMax: 1000, unit: 'px' }),
      numberParam('radius', '範囲', 200, { min: 1, max: 5000, sliderMax: 1000, unit: 'px' }),
      numberParam('strength', '強さ', 50, { min: -100, max: 100, step: 0.1, unit: '%' }),
    ],
  },
  {
    type: 'tile',
    label: '画像ループ（並べる）',
    category: '変形',
    params: [
      numberParam('countX', '横の数', 2, { min: 1, max: 50, sliderMax: 10 }),
      numberParam('countY', '縦の数', 2, { min: 1, max: 50, sliderMax: 10 }),
      numberParam('offsetX', '横のずらし', 0, { sliderMin: -1000, sliderMax: 1000, unit: 'px' }),
      numberParam('offsetY', '縦のずらし', 0, { sliderMin: -1000, sliderMax: 1000, unit: 'px' }),
    ],
  },
  {
    type: 'light',
    label: 'ライト',
    category: '光',
    params: [
      numberParam('x', 'X', 0, { sliderMin: -1000, sliderMax: 1000, unit: 'px' }),
      numberParam('y', 'Y', 0, { sliderMin: -1000, sliderMax: 1000, unit: 'px' }),
      numberParam('radius', '範囲', 300, { min: 1, max: 5000, sliderMax: 1500, unit: 'px' }),
      numberParam('intensity', '強さ', 60, {
        min: 0,
        max: 400,
        sliderMax: 200,
        step: 0.1,
        unit: '%',
      }),
      color('color', '光の色', '#ffffff'),
    ],
  },
  {
    type: 'directionalBlur',
    label: '方向ブラー',
    category: 'ぼかし',
    params: [
      numberParam('length', '長さ', 30, { min: 0, max: 1000, sliderMax: 200, unit: 'px' }),
      numberParam('angle', '角度', 0, { sliderMin: -180, sliderMax: 180, step: 0.1, unit: '°' }),
    ],
  },
  {
    type: 'radialBlur',
    label: '放射ブラー',
    category: 'ぼかし',
    params: [
      numberParam('strength', '強さ', 20, { min: 0, max: 100, step: 0.1, unit: '%' }),
      numberParam('x', '中心 X', 0, { sliderMin: -1000, sliderMax: 1000, unit: 'px' }),
      numberParam('y', '中心 Y', 0, { sliderMin: -1000, sliderMax: 1000, unit: 'px' }),
    ],
  },
  {
    type: 'noise',
    label: 'ノイズ',
    category: '加工',
    params: [
      numberParam('amount', '強さ', 30, { min: 0, max: 100, step: 0.1, unit: '%' }),
      numberParam('size', '粒の大きさ', 1, { min: 1, max: 100, sliderMax: 20, unit: 'px' }),
      { id: 'colored', label: '色つきのノイズ', kind: 'boolean', default: false },
      { id: 'animated', label: 'フレームごとに変える', kind: 'boolean', default: true },
    ],
  },
  {
    type: 'chromaticShift',
    label: '色ずれ',
    category: '加工',
    params: [
      numberParam('offset', 'ずれ幅', 6, {
        min: 0,
        max: 500,
        sliderMax: 50,
        step: 0.1,
        unit: 'px',
      }),
      numberParam('angle', '角度', 0, { sliderMin: -180, sliderMax: 180, step: 0.1, unit: '°' }),
    ],
  },
  {
    type: 'diagonalClip',
    label: '斜めクリッピング',
    category: '切り抜き',
    params: [
      numberParam('x', '中心 X', 0, { sliderMin: -1000, sliderMax: 1000, unit: 'px' }),
      numberParam('y', '中心 Y', 0, { sliderMin: -1000, sliderMax: 1000, unit: 'px' }),
      numberParam('angle', '角度', 0, { sliderMin: -180, sliderMax: 180, step: 0.1, unit: '°' }),
      numberParam('width', '残す幅（0 で片側を消す）', 0, {
        min: 0,
        max: 10000,
        sliderMax: 1000,
        unit: 'px',
      }),
      numberParam('feather', 'ぼかし', 0, {
        min: 0,
        max: 1000,
        sliderMax: 200,
        step: 0.1,
        unit: 'px',
      }),
    ],
  },
];

/** ユーザー定義シェーダーの最初のコード（例） */
export const DEFAULT_SHADER_CODE = `// 例：画像を横に波打たせる
// uv は 0〜1 の座標、src(uv) で元の画像の色を読む
// uTime は秒、uParam1〜uParam4 は下のパラメータ
vec4 effect(vec2 uv) {
  uv.x += sin(uv.y * 20.0 + uTime * 3.0) * 0.01 * uParam1;
  return src(uv);
}
`;

/** ユーザー定義シェーダー */
const CUSTOM_EFFECTS: EffectDef[] = [
  {
    type: 'customShader',
    label: 'シェーダー（自作）',
    category: '加工',
    params: [
      {
        id: 'code',
        label: 'コード（GLSL）',
        kind: 'text',
        default: DEFAULT_SHADER_CODE,
        multiline: true,
        code: true,
      },
      numberParam('param1', 'パラメータ 1', 1, { sliderMin: -10, sliderMax: 10, step: 0.01 }),
      numberParam('param2', 'パラメータ 2', 0, { sliderMin: -10, sliderMax: 10, step: 0.01 }),
      numberParam('param3', 'パラメータ 3', 0, { sliderMin: -10, sliderMax: 10, step: 0.01 }),
      numberParam('param4', 'パラメータ 4', 0, { sliderMin: -10, sliderMax: 10, step: 0.01 }),
      numberParam('padding', '描画範囲の余白', 0, {
        min: 0,
        max: 2000,
        sliderMax: 500,
        unit: 'px',
      }),
    ],
  },
];

/** 音声エフェクト */
const AUDIO_EFFECTS: EffectDef[] = [
  {
    type: 'equalizer',
    label: 'イコライザー',
    category: '音声',
    domain: 'audio',
    params: [
      numberParam('lowGain', '低音', 0, { min: -24, max: 24, step: 0.1, unit: 'dB' }),
      numberParam('lowFreq', '低音の周波数', 120, { min: 20, max: 1000, step: 1, unit: 'Hz' }),
      numberParam('midGain', '中音', 0, { min: -24, max: 24, step: 0.1, unit: 'dB' }),
      numberParam('midFreq', '中音の周波数', 1000, {
        min: 100,
        max: 10000,
        sliderMax: 5000,
        step: 1,
        unit: 'Hz',
      }),
      numberParam('midQ', '中音の幅（Q）', 1, { min: 0.1, max: 10, step: 0.01 }),
      numberParam('highGain', '高音', 0, { min: -24, max: 24, step: 0.1, unit: 'dB' }),
      numberParam('highFreq', '高音の周波数', 8000, {
        min: 1000,
        max: 20000,
        step: 1,
        unit: 'Hz',
      }),
      numberParam('lowCut', 'ローカット（0 で無効）', 0, {
        min: 0,
        max: 1000,
        sliderMax: 500,
        unit: 'Hz',
      }),
      numberParam('highCut', 'ハイカット（0 で無効）', 0, { min: 0, max: 20000, unit: 'Hz' }),
    ],
  },
  {
    type: 'compressor',
    label: 'コンプレッサー',
    category: '音声',
    domain: 'audio',
    params: [
      numberParam('threshold', 'しきい値', -18, { min: -60, max: 0, step: 0.1, unit: 'dB' }),
      numberParam('ratio', '圧縮比', 4, { min: 1, max: 20, step: 0.1, unit: ': 1' }),
      numberParam('attack', 'アタック', 10, {
        min: 0.1,
        max: 200,
        sliderMax: 100,
        step: 0.1,
        unit: 'ms',
      }),
      numberParam('release', 'リリース', 150, { min: 10, max: 2000, sliderMax: 1000, unit: 'ms' }),
      numberParam('knee', 'ニー', 6, { min: 0, max: 24, step: 0.1, unit: 'dB' }),
      numberParam('makeup', '音量の補正', 0, { min: 0, max: 24, step: 0.1, unit: 'dB' }),
    ],
  },
  {
    type: 'delay',
    label: 'ディレイ・エコー',
    category: '音声',
    domain: 'audio',
    params: [
      numberParam('time', '遅れ', 300, { min: 1, max: 2000, sliderMax: 1000, unit: 'ms' }),
      numberParam('feedback', '繰り返し', 35, { min: 0, max: 95, step: 0.1, unit: '%' }),
      numberParam('mix', 'エコーの大きさ', 35, { min: 0, max: 100, step: 0.1, unit: '%' }),
      { id: 'pingPong', label: '左右に跳ね返す', kind: 'boolean', default: false },
    ],
  },
  {
    type: 'reverb',
    label: 'リバーブ',
    category: '音声',
    domain: 'audio',
    params: [
      numberParam('roomSize', '部屋の大きさ', 60, { min: 0, max: 100, step: 0.1, unit: '%' }),
      numberParam('damping', '高音の吸収', 50, { min: 0, max: 100, step: 0.1, unit: '%' }),
      numberParam('mix', '残響の大きさ', 25, { min: 0, max: 100, step: 0.1, unit: '%' }),
      numberParam('preDelay', '残響の遅れ', 10, { min: 0, max: 200, unit: 'ms' }),
      numberParam('width', '広がり', 100, { min: 0, max: 100, step: 0.1, unit: '%' }),
    ],
  },
];

export const EFFECTS: EffectDef[] = [
  ...VIDEO_EFFECTS,
  ...MORE_VIDEO_EFFECTS,
  ...CUSTOM_EFFECTS,
  ...AUDIO_EFFECTS,
];

export const EFFECT_MAP: Record<string, EffectDef> = Object.fromEntries(
  EFFECTS.map((e) => [e.type, e]),
);

export function getEffectDef(type: string): EffectDef | undefined {
  return EFFECT_MAP[type];
}

export function effectDomain(def: EffectDef): EffectDomain {
  return def.domain ?? 'video';
}

export const EFFECT_CATEGORIES = [...new Set(EFFECTS.map((e) => e.category))];
