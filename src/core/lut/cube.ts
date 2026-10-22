import { t } from '../../i18n';

/** 3D LUT（色の変換表） */
export interface Lut3D {
  /** 1 辺の格子の数 */
  size: number;
  /** RGB を size^3 個。赤が一番速く変わる順（.cube の並びのまま） */
  data: Float32Array;
  title?: string;
}

export class LutParseError extends Error {}

/** 格子の数の上限（大きすぎるファイルで固まらないように） */
const MAX_SIZE = 128;

/**
 * .cube 形式の 3D LUT を読む。
 * DOMAIN_MIN / DOMAIN_MAX は 0〜1 に正規化する。1D の LUT には対応しない。
 */
export function parseCube(text: string): Lut3D {
  let size = 0;
  let title: string | undefined;
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'TITLE') {
      title = line.slice(5).trim().replace(/^"|"$/g, '');
    } else if (key === 'LUT_3D_SIZE') {
      size = Number(parts[1]);
      if (!Number.isInteger(size) || size < 2 || size > MAX_SIZE)
        throw new LutParseError(t('LUT の大きさ（{0}）に対応していません。', parts[1]));
    } else if (key === 'LUT_1D_SIZE') {
      throw new LutParseError(t('1D の LUT には対応していません（3D の LUT を使ってください）。'));
    } else if (key === 'DOMAIN_MIN') {
      min = parts.slice(1, 4).map(Number);
    } else if (key === 'DOMAIN_MAX') {
      max = parts.slice(1, 4).map(Number);
    } else if (/^[-+.\d]/.test(parts[0])) {
      if (parts.length < 3) throw new LutParseError(t('LUT の数値の行が正しくありません。'));
      for (let i = 0; i < 3; i++) values.push(Number(parts[i]));
    }
    // ほかのキーワード（LUT_3D_INPUT_RANGE など）は無視する
  }
  if (size === 0) throw new LutParseError(t('LUT_3D_SIZE が見つかりません。'));
  if (values.length !== size ** 3 * 3)
    throw new LutParseError(t('LUT の数値の個数が合いません（{0} 行必要です）。', size ** 3));
  const data = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const c = i % 3;
    const v = (values[i] - min[c]) / (max[c] - min[c] || 1);
    if (!Number.isFinite(v)) throw new LutParseError(t('LUT に数値でない値があります。'));
    data[i] = v;
  }
  return { size, data, title };
}

/** LUT で色を変換する（確認用。描画は GPU で行う）。最も近い格子点の値を返す */
export function applyLutNearest(
  lut: Lut3D,
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const n = lut.size - 1;
  const idx = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * n);
  const i = (idx(r) + idx(g) * lut.size + idx(b) * lut.size * lut.size) * 3;
  return [lut.data[i], lut.data[i + 1], lut.data[i + 2]];
}
