import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FOCAL,
  mat4LookAt,
  mat4Multiply,
  mat4Perspective,
  mat4RotateY,
  mat4Translate,
  type Mat4,
} from './gl';

function apply(m: Mat4, [x, y, z]: [number, number, number]): [number, number] {
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [cx / cw, cy / cw];
}

describe('3D の変換', () => {
  const W = 1920;
  const H = 1080;
  const f = DEFAULT_FOCAL;
  const defaultView = mat4LookAt([0, 0, -f], [0, 0, 0]);
  const viewProj = mat4Multiply(mat4Perspective(W, H, f), defaultView);

  it('既定のカメラでは z = 0 の点が 2D と同じ位置になる', () => {
    const [x, y] = apply(viewProj, [480, -270, 0]);
    expect(x).toBeCloseTo((2 * 480) / W);
    expect(y).toBeCloseTo((2 * -270) / H);
  });

  it('奥にあるものは小さく見える', () => {
    const [x] = apply(viewProj, [480, 0, f]);
    expect(x).toBeCloseTo((2 * 480) / W / 2);
  });

  it('Y 軸回転で横幅が縮む', () => {
    const m = mat4Multiply(viewProj, mat4Multiply(mat4Translate(0, 0, 0), mat4RotateY(60)));
    const [x] = apply(m, [100, 0, 0]);
    expect(Math.abs(x)).toBeLessThan((2 * 100) / W);
  });
});
