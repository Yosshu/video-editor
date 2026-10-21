/** WebGL2 の小さな補助関数 */

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('シェーダーを作成できません');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`シェーダーのコンパイルに失敗しました: ${log}`);
  }
  return shader;
}

export interface Program {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  uniformNames: string[],
): Program {
  const program = gl.createProgram();
  if (!program) throw new Error('プログラムを作成できません');
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'aPos');
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`シェーダーのリンクに失敗しました: ${gl.getProgramInfoLog(program)}`);
  }
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  for (const name of uniformNames) uniforms[name] = gl.getUniformLocation(program, name);
  return { program, uniforms };
}

export interface RenderTarget {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

export function createRenderTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): RenderTarget {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer) throw new Error('描画先を作成できません');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer, width, height };
}

export function deleteRenderTarget(gl: WebGL2RenderingContext, target: RenderTarget): void {
  gl.deleteTexture(target.texture);
  gl.deleteFramebuffer(target.framebuffer);
}

/** "#rrggbb" / "#rgb" を 0〜1 の RGB にする */
export function parseColor(color: string): [number, number, number] {
  let hex = color.trim().replace(/^#/, '');
  if (hex.length === 3) hex = hex.replace(/(.)/g, '$1$1');
  const n = Number.parseInt(hex.slice(0, 6), 16);
  if (!Number.isFinite(n) || hex.length < 6) return [0, 0, 0];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** 3x3 行列（列優先） */
export type Mat3 = Float32Array;

export function mat3Multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Float32Array(9);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      out[col * 3 + row] =
        a[0 * 3 + row] * b[col * 3 + 0] +
        a[1 * 3 + row] * b[col * 3 + 1] +
        a[2 * 3 + row] * b[col * 3 + 2];
    }
  }
  return out;
}

export function mat3Translate(x: number, y: number): Mat3 {
  return new Float32Array([1, 0, 0, 0, 1, 0, x, y, 1]);
}

export function mat3Scale(x: number, y: number): Mat3 {
  return new Float32Array([x, 0, 0, 0, y, 0, 0, 0, 1]);
}

/** 時計回りを正とする回転（画面座標は下向きが +Y） */
export function mat3Rotate(degrees: number): Mat3 {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return new Float32Array([c, s, 0, -s, c, 0, 0, 0, 1]);
}
