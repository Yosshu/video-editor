import { describe, expect, it } from 'vitest';
import { applyLutNearest, parseCube } from './cube';

/** 色を反転する 2×2×2 の LUT */
const INVERT = `# comment
TITLE "invert"
LUT_3D_SIZE 2
1 1 1
0 1 1
1 0 1
0 0 1
1 1 0
0 1 0
1 0 0
0 0 0
`;

describe('parseCube', () => {
  it('3D LUT を読み、赤が一番速く変わる順に並べる', () => {
    const lut = parseCube(INVERT);
    expect(lut.size).toBe(2);
    expect(lut.title).toBe('invert');
    expect(applyLutNearest(lut, 0, 0, 0)).toEqual([1, 1, 1]);
    expect(applyLutNearest(lut, 1, 0, 0)).toEqual([0, 1, 1]);
    expect(applyLutNearest(lut, 0, 0, 1)).toEqual([1, 1, 0]);
  });

  it('DOMAIN を 0〜1 に正規化する', () => {
    const lut = parseCube(
      `LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n${'2 2 2\n'.repeat(8)}`,
    );
    expect(lut.data[0]).toBe(1);
  });

  it('不正なファイルはエラーにする', () => {
    expect(() => parseCube('LUT_1D_SIZE 4')).toThrow('1D');
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0')).toThrow('8');
    expect(() => parseCube('hello')).toThrow('LUT_3D_SIZE');
    expect(() => parseCube('LUT_3D_SIZE 1000')).toThrow();
  });
});
