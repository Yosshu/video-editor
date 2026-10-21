import type { ResolvedEffect } from '../../core/evaluate/evaluate';
import { SIMPLE_BLEND_MODES, type BlendMode } from '../../core/objects/definitions';
import { EFFECT_IMPLS, EffectRunner, WIPE_KINDS, type Surface } from '../effects/gpu';
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
import { RenderTargetPool } from './targetPool';

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
  /** オブジェクトに適用するエフェクト */
  effects?: ResolvedEffect[];
  /** エフェクトを処理する解像度（シーン 1px あたりのピクセル数） */
  effectScale?: number;
  /** 登場・退場のワイプ */
  wipe?: { kind: string; progress: number };
}

/** 描画の手順 */
export type RenderOp =
  /** オブジェクトを描く。mask があれば、その形で切り抜く（上のオブジェクトでクリッピング） */
  | { kind: 'draw'; item: DrawItem; mask?: DrawItem }
  /** それまでに描いた画面全体にエフェクトをかける（フィルタオブジェクト） */
  | { kind: 'filter'; effects: ResolvedEffect[] };

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
uniform int uBlend;
uniform sampler2D uDst;
uniform sampler2D uMask;
uniform int uUseMask;
uniform vec2 uTargetSize;
out vec4 outColor;

float blendChannel(float b, float s, int mode) {
  if (mode == 1) return b <= 0.5 ? 2.0 * b * s : 1.0 - 2.0 * (1.0 - b) * (1.0 - s); // overlay
  if (mode == 2) { // soft light
    if (s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b);
    float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
    return b + (2.0 * s - 1.0) * (d - b);
  }
  if (mode == 3) return s <= 0.5 ? 2.0 * b * s : 1.0 - 2.0 * (1.0 - b) * (1.0 - s); // hard light
  if (mode == 4) return b <= 0.0 ? 0.0 : (s >= 1.0 ? 1.0 : min(1.0, b / (1.0 - s))); // color dodge
  if (mode == 5) return b >= 1.0 ? 1.0 : (s <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - b) / s)); // color burn
  if (mode == 6) return abs(b - s); // difference
  if (mode == 7) return b + s - 2.0 * b * s; // exclusion
  return s;
}

void main() {
  vec4 c = texture(uTex, vUv) * uOpacity;
  if (uUseMask == 1) c *= texture(uMask, gl_FragCoord.xy / uTargetSize).a;
  if (uMode == 2) {
    vec4 d = texture(uDst, gl_FragCoord.xy / uTargetSize);
    vec3 cs = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
    vec3 cb = d.a > 0.0 ? d.rgb / d.a : vec3(0.0);
    vec3 b = vec3(blendChannel(cb.r, cs.r, uBlend), blendChannel(cb.g, cs.g, uBlend), blendChannel(cb.b, cs.b, uBlend));
    vec3 co = c.rgb * (1.0 - d.a) + d.rgb * (1.0 - c.a) + c.a * d.a * clamp(b, 0.0, 1.0);
    outColor = vec4(co, c.a + d.a * (1.0 - c.a));
  } else if (uMode == 1) {
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
  // 描画先は「0 行目 = 上端」なので、画面に出すときに上下を合わせる
  vUv = vec2(aPos.x + 0.5, 0.5 - aPos.y);
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

const ADVANCED_BLEND: Record<string, number> = {
  overlay: 1,
  softLight: 2,
  hardLight: 3,
  colorDodge: 4,
  colorBurn: 5,
  difference: 6,
  exclusion: 7,
};

interface CachedTexture {
  texture: WebGLTexture;
  version: unknown;
}

/** 合成に使うテクスチャ（エフェクト適用後なら一時的な描画先） */
interface Prepared {
  texture: WebGLTexture;
  width: number;
  height: number;
  uvMatrix: Mat3;
  release: () => void;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private quadProgram: Program;
  private presentProgram: Program;
  private vao: WebGLVertexArrayObject;
  private textures = new Map<string, CachedTexture>();
  private sceneTarget: RenderTarget | null = null;
  private sceneCopy: RenderTarget | null = null;
  private maskTarget: RenderTarget | null = null;
  private pool: RenderTargetPool;
  private effects: EffectRunner;
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
      'uBlend',
      'uDst',
      'uMask',
      'uUseMask',
      'uTargetSize',
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
    this.pool = new RenderTargetPool(gl);
    this.effects = new EffectRunner(gl, this.pool, vao);
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
  setSize(
    sceneWidth: number,
    sceneHeight: number,
    pixelScale: number,
    /** 出力サイズを直接指定する（書き出しで偶数にそろえるときなど） */
    output?: { width: number; height: number },
  ): void {
    const w = output?.width ?? Math.max(1, Math.round(sceneWidth * pixelScale));
    const h = output?.height ?? Math.max(1, Math.round(sceneHeight * pixelScale));
    this.sceneWidth = sceneWidth;
    this.sceneHeight = sceneHeight;
    this.pixelScale = pixelScale;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (!this.sceneTarget || this.sceneTarget.width !== w || this.sceneTarget.height !== h) {
      for (const t of [this.sceneTarget, this.sceneCopy, this.maskTarget])
        if (t) deleteRenderTarget(this.gl, t);
      this.sceneTarget = createRenderTarget(this.gl, w, h);
      this.sceneCopy = createRenderTarget(this.gl, w, h);
      this.maskTarget = createRenderTarget(this.gl, w, h);
    }
  }

  get outputWidth(): number {
    return this.canvas.width;
  }

  get outputHeight(): number {
    return this.canvas.height;
  }

  get scale(): number {
    return this.pixelScale;
  }

  private uploadTexture(item: DrawItem): CachedTexture {
    const gl = this.gl;
    let cached = this.textures.get(item.key);
    if (cached && cached.version === item.version) return cached;
    if (!cached) {
      const texture = gl.createTexture();
      if (!texture) throw new Error('テクスチャを作成できません');
      cached = { texture, version: undefined };
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

  /**
   * オブジェクトのテクスチャを用意する。エフェクトがあれば、オブジェクト専用の描画先で順に適用する。
   */
  private prepare(item: DrawItem): Prepared {
    const cached = this.uploadTexture(item);
    const effects = (item.effects ?? []).filter((e) => EFFECT_IMPLS[e.type]);
    if (effects.length === 0 && !item.wipe) {
      return {
        texture: cached.texture,
        width: item.width,
        height: item.height,
        uvMatrix: item.uvMatrix ?? IDENTITY,
        release: () => undefined,
      };
    }
    const gl = this.gl;
    const res = item.effectScale ?? this.pixelScale;
    // 素材をそのままの向きでオブジェクト用の描画先に写す
    const base = this.pool.acquire(item.width * res, item.height * res);
    gl.bindFramebuffer(gl.FRAMEBUFFER, base.framebuffer);
    gl.viewport(0, 0, base.width, base.height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const prog = this.quadProgram;
    gl.useProgram(prog.program);
    gl.bindVertexArray(this.vao);
    this.bindAux(null, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cached.texture);
    gl.uniform1i(prog.uniforms.uTex, 0);
    gl.uniformMatrix3fv(prog.uniforms.uMatrix, false, mat3Scale(2, 2));
    gl.uniformMatrix3fv(prog.uniforms.uUvMatrix, false, item.uvMatrix ?? IDENTITY);
    gl.uniform1f(prog.uniforms.uOpacity, 1);
    gl.uniform1i(prog.uniforms.uMode, 0);
    gl.uniform1i(prog.uniforms.uUseMask, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    let surface: Surface = { target: base, width: item.width, height: item.height };
    const apply = (type: string, params: Record<string, number | string | boolean>) => {
      const next = EFFECT_IMPLS[type](this.effects, surface, params, res, true);
      if (next.target !== surface.target) this.pool.release(surface.target);
      surface = next;
    };
    for (const e of effects) apply(e.type, e.params);
    if (item.wipe && WIPE_KINDS[item.wipe.kind] !== undefined) {
      apply('wipe', { kind: WIPE_KINDS[item.wipe.kind], progress: item.wipe.progress });
    }
    const final = surface;
    return {
      texture: final.target.texture,
      width: final.width,
      height: final.height,
      uvMatrix: IDENTITY,
      release: () => this.pool.release(final.target),
    };
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

  /** シーン座標（中央原点・下向き +Y）から、描画先（0 行目 = 上端）のクリップ座標への変換 */
  private projection(): Mat3 {
    return mat3Scale(2 / this.sceneWidth, 2 / this.sceneHeight);
  }

  private modelMatrix(item: DrawItem, prepared: Prepared): Mat3 {
    return mat3Multiply(
      this.projection(),
      mat3Multiply(
        mat3Translate(item.x, item.y),
        mat3Multiply(
          mat3Rotate(item.rotation),
          mat3Scale(prepared.width * item.scaleX, prepared.height * item.scaleY),
        ),
      ),
    );
  }

  /** 描画先へオブジェクトを 1 つ合成する */
  private composite(
    target: RenderTarget,
    item: DrawItem,
    prepared: Prepared,
    useMask: boolean,
  ): void {
    const gl = this.gl;
    const prog = this.quadProgram;
    const advanced =
      !SIMPLE_BLEND_MODES.includes(item.blend) && ADVANCED_BLEND[item.blend] !== undefined;
    if (advanced) {
      // シェーダーで合成するため、現在の画面をコピーしておく
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.sceneCopy!.framebuffer);
      gl.blitFramebuffer(
        0,
        0,
        target.width,
        target.height,
        0,
        0,
        target.width,
        target.height,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      );
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.useProgram(prog.program);
    gl.bindVertexArray(this.vao);
    // 描画先と同じテクスチャを読まないよう、使わないものは外しておく
    this.bindAux(
      advanced ? this.sceneCopy!.texture : null,
      useMask ? this.maskTarget!.texture : null,
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prepared.texture);
    gl.uniform1i(prog.uniforms.uTex, 0);
    gl.uniform2f(prog.uniforms.uTargetSize, target.width, target.height);
    gl.uniformMatrix3fv(prog.uniforms.uMatrix, false, this.modelMatrix(item, prepared));
    gl.uniformMatrix3fv(prog.uniforms.uUvMatrix, false, prepared.uvMatrix);
    gl.uniform1f(prog.uniforms.uOpacity, item.opacity);
    gl.uniform1i(prog.uniforms.uUseMask, useMask ? 1 : 0);
    if (advanced) {
      gl.disable(gl.BLEND);
      gl.uniform1i(prog.uniforms.uMode, 2);
      gl.uniform1i(prog.uniforms.uBlend, ADVANCED_BLEND[item.blend]);
    } else {
      gl.uniform1i(prog.uniforms.uMode, this.applyBlend(item.blend));
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** 合成シェーダーの補助テクスチャ（合成先のコピー・マスク）を設定する */
  private bindAux(dst: WebGLTexture | null, mask: WebGLTexture | null): void {
    const gl = this.gl;
    const prog = this.quadProgram;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, dst);
    gl.uniform1i(prog.uniforms.uDst, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, mask);
    gl.uniform1i(prog.uniforms.uMask, 2);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** クリッピング用のマスク（上のオブジェクトの形）を描く */
  private drawMask(mask: DrawItem): void {
    const gl = this.gl;
    const target = this.maskTarget!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const prepared = this.prepare(mask);
    this.composite(target, { ...mask, blend: 'normal' }, prepared, false);
    prepared.release();
  }

  /** 画面全体にエフェクトをかける（フィルタオブジェクト） */
  private applyFilter(effects: ResolvedEffect[]): void {
    const gl = this.gl;
    const scene = this.sceneTarget!;
    let surface: Surface = { target: scene, width: this.sceneWidth, height: this.sceneHeight };
    for (const e of effects) {
      const impl = EFFECT_IMPLS[e.type];
      if (!impl) continue;
      const next = impl(this.effects, surface, e.params, this.pixelScale, false);
      if (surface.target !== scene && next.target !== surface.target)
        this.pool.release(surface.target);
      surface = next;
    }
    if (surface.target === scene) return;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, surface.target.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, scene.framebuffer);
    gl.blitFramebuffer(
      0,
      0,
      scene.width,
      scene.height,
      0,
      0,
      scene.width,
      scene.height,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
    this.pool.release(surface.target);
  }

  render(ops: RenderOp[], background: string): void {
    if (this.isContextLost || !this.sceneTarget) return;
    const gl = this.gl;
    const target = this.sceneTarget;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    const [r, g, b] = parseColor(background);
    gl.disable(gl.BLEND);
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    for (const op of ops) {
      if (op.kind === 'filter') {
        if (op.effects.length > 0) this.applyFilter(op.effects);
        continue;
      }
      const item = op.item;
      if (item.opacity <= 0 || item.width <= 0 || item.height <= 0) continue;
      if (op.mask) this.drawMask(op.mask);
      const prepared = this.prepare(item);
      this.composite(target, item, prepared, !!op.mask);
      prepared.release();
    }

    // 画面（canvas）へ転送
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.presentProgram.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.uniform1i(this.presentProgram.uniforms.uTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    this.pool.trim();
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

  dispose(): void {
    for (const cached of this.textures.values()) this.gl.deleteTexture(cached.texture);
    this.textures.clear();
    for (const t of [this.sceneTarget, this.sceneCopy, this.maskTarget])
      if (t) deleteRenderTarget(this.gl, t);
    this.sceneTarget = null;
    this.sceneCopy = null;
    this.maskTarget = null;
    this.effects.dispose();
    this.pool.dispose();
  }
}
