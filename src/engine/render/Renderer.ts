import type { BlendMode } from '../../core/objects/definitions';
import {
  createProgram,
  createRenderTarget,
  deleteRenderTarget,
  mat3Multiply,
  mat3Rotate,
  mat3Scale,
  mat3Translate,
  parseColor,
  type Mat3,
  type Program,
  type RenderTarget,
} from './gl';

/** 1 つのオブジェクトの描画指示 */
export interface DrawItem {
  /** テクスチャを使い回すためのキー（オブジェクト ID など） */
  key: string;
  source: TexImageSource;
  /** 変わったときだけテクスチャを再転送する */
  version: unknown;
  /** 静止素材はミップマップを作って縮小時の画質を上げる */
  mipmap: boolean;
  /** シーン座標での大きさ（拡大率をかける前） */
  width: number;
  height: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** 度、時計回り */
  rotation: number;
  /** 0〜1 */
  opacity: number;
  blend: BlendMode;
  /** 素材のテクスチャ座標の変換（動画の回転メタデータなど）。省略時は等倍 */
  uvMatrix?: Mat3;
}

const QUAD_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform mat3 uMatrix;
uniform mat3 uUvMatrix;
out vec2 vUv;
void main() {
  vec3 p = uMatrix * vec3(aPos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  vUv = (uUvMatrix * vec3(aPos + 0.5, 1.0)).xy;
}`;

const QUAD_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uOpacity;
uniform int uMode;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUv) * uOpacity;
  if (uMode == 1) {
    // 比較（暗）: 透明部分が影響しないよう白の上に合成してから MIN をとる
    outColor = vec4(c.rgb + (1.0 - c.a), c.a);
  } else {
    outColor = c;
  }
}`;

const PRESENT_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  gl_Position = vec4(aPos * 2.0, 0.0, 1.0);
  vUv = aPos + 0.5;
}`;

const PRESENT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  outColor = texture(uTex, vUv);
}`;

const IDENTITY: Mat3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

interface CachedTexture {
  texture: WebGLTexture;
  version: unknown;
  width: number;
  height: number;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private quadProgram: Program;
  private presentProgram: Program;
  private vao: WebGLVertexArrayObject;
  private textures = new Map<string, CachedTexture>();
  private sceneTarget: RenderTarget | null = null;
  private sceneWidth = 1;
  private sceneHeight = 1;
  private pixelScale = 1;
  private lost = false;

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 を初期化できませんでした');
    this.gl = gl;
    this.quadProgram = createProgram(gl, QUAD_VS, QUAD_FS, [
      'uMatrix',
      'uUvMatrix',
      'uTex',
      'uOpacity',
      'uMode',
    ]);
    this.presentProgram = createProgram(gl, PRESENT_VS, PRESENT_FS, ['uTex']);
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (!vao || !buffer) throw new Error('頂点バッファを作成できません');
    this.vao = vao;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    // -0.5〜0.5 の正方形（三角形 2 枚）。y は画面下向き
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    if ('addEventListener' in canvas) {
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.lost = true;
      });
    }
  }

  get isContextLost(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  /** シーンの大きさと、シーン 1px あたりの出力ピクセル数を設定する */
  setSize(sceneWidth: number, sceneHeight: number, pixelScale: number): void {
    const w = Math.max(1, Math.round(sceneWidth * pixelScale));
    const h = Math.max(1, Math.round(sceneHeight * pixelScale));
    this.sceneWidth = sceneWidth;
    this.sceneHeight = sceneHeight;
    this.pixelScale = pixelScale;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (!this.sceneTarget || this.sceneTarget.width !== w || this.sceneTarget.height !== h) {
      if (this.sceneTarget) deleteRenderTarget(this.gl, this.sceneTarget);
      this.sceneTarget = createRenderTarget(this.gl, w, h);
    }
  }

  get outputWidth(): number {
    return this.canvas.width;
  }

  get outputHeight(): number {
    return this.canvas.height;
  }

  private uploadTexture(item: DrawItem): CachedTexture {
    const gl = this.gl;
    let cached = this.textures.get(item.key);
    if (cached && cached.version === item.version) return cached;
    if (!cached) {
      const texture = gl.createTexture();
      if (!texture) throw new Error('テクスチャを作成できません');
      cached = { texture, version: undefined, width: 0, height: 0 };
      this.textures.set(item.key, cached);
    }
    gl.bindTexture(gl.TEXTURE_2D, cached.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, item.source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (item.mipmap) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    cached.version = item.version;
    return cached;
  }

  private applyBlend(mode: BlendMode): number {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    switch (mode) {
      case 'add':
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
        return 0;
      case 'subtract':
        gl.blendEquationSeparate(gl.FUNC_REVERSE_SUBTRACT, gl.FUNC_ADD);
        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
        return 0;
      case 'multiply':
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        return 0;
      case 'screen':
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        return 0;
      case 'lighten':
        gl.blendEquation(gl.MAX);
        gl.blendFunc(gl.ONE, gl.ONE);
        return 0;
      case 'darken':
        gl.blendEquationSeparate(gl.MIN, gl.MAX);
        gl.blendFunc(gl.ONE, gl.ONE);
        return 1;
      default:
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        return 0;
    }
  }

  /** シーン座標（中央原点・下向き +Y）からクリップ座標への変換 */
  private projection(): Mat3 {
    return mat3Scale(2 / this.sceneWidth, -2 / this.sceneHeight);
  }

  render(items: DrawItem[], background: string): void {
    if (this.isContextLost || !this.sceneTarget) return;
    const gl = this.gl;
    const target = this.sceneTarget;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    const [r, g, b] = parseColor(background);
    gl.disable(gl.BLEND);
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const prog = this.quadProgram;
    gl.useProgram(prog.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(prog.uniforms.uTex, 0);
    const proj = this.projection();

    for (const item of items) {
      if (item.opacity <= 0 || item.width <= 0 || item.height <= 0) continue;
      const tex = this.uploadTexture(item);
      const model = mat3Multiply(
        mat3Translate(item.x, item.y),
        mat3Multiply(
          mat3Rotate(item.rotation),
          mat3Scale(item.width * item.scaleX, item.height * item.scaleY),
        ),
      );
      const matrix = mat3Multiply(proj, model);
      gl.bindTexture(gl.TEXTURE_2D, tex.texture);
      gl.uniformMatrix3fv(prog.uniforms.uMatrix, false, matrix);
      gl.uniformMatrix3fv(prog.uniforms.uUvMatrix, false, item.uvMatrix ?? IDENTITY);
      gl.uniform1f(prog.uniforms.uOpacity, item.opacity);
      gl.uniform1i(prog.uniforms.uMode, this.applyBlend(item.blend));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // 画面（canvas）へ転送
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.presentProgram.program);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.uniform1i(this.presentProgram.uniforms.uTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  /** 使われなくなったテクスチャを解放する */
  pruneTextures(activeKeys: ReadonlySet<string>): void {
    for (const [key, cached] of this.textures) {
      if (!activeKeys.has(key)) {
        this.gl.deleteTexture(cached.texture);
        this.textures.delete(key);
      }
    }
  }

  get scale(): number {
    return this.pixelScale;
  }

  dispose(): void {
    for (const cached of this.textures.values()) this.gl.deleteTexture(cached.texture);
    this.textures.clear();
    if (this.sceneTarget) deleteRenderTarget(this.gl, this.sceneTarget);
    this.sceneTarget = null;
  }
}
