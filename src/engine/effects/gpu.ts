import type { ResolvedParams } from '../../core/evaluate/evaluate';
import { createProgram, parseColor, type Program, type RenderTarget } from '../render/gl';
import type { RenderTargetPool } from '../render/targetPool';

/**
 * エフェクトの GPU 実装。
 * すべての描画先は「メモリの 0 行目 = 画像の上端」の向きにそろえてあり、シェーダーの uv も下向きが +y。
 */

/** エフェクトの入出力。width/height はシーン座標での大きさ */
export interface Surface {
  target: RenderTarget;
  width: number;
  height: number;
}

type UniformValue =
  number | [number, number] | [number, number, number] | [number, number, number, number];

const PASS_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  gl_Position = vec4(aPos * 2.0, 0.0, 1.0);
  vUv = aPos + 0.5;
}`;

/** 全エフェクト共通の関数 */
const PRELUDE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uInSize;
uniform vec2 uOutSize;
uniform vec2 uPad;
vec2 outPx() { return vUv * uOutSize; }
vec4 srcPx(vec2 inPx) {
  vec2 uv = inPx / uInSize;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return texture(uTex, uv);
}
vec4 srcAt(vec2 offset) { return srcPx(outPx() - uPad + offset); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 unpremul(vec4 c) { return c.a > 0.0 ? c.rgb / c.a : vec3(0.0); }
`;

/** シェーダーの本体（PRELUDE の後に続く） */
const SHADERS: Record<string, string> = {
  copy: `void main() { outColor = srcAt(vec2(0.0)); }`,

  colorAdjust: `
uniform float uBrightness; uniform float uContrast; uniform float uHue; uniform float uSaturation; uniform float uGamma;
vec3 hueRotate(vec3 c, float a) {
  float cosA = cos(a); float sinA = sin(a);
  mat3 m = mat3(
    0.213 + cosA * 0.787 - sinA * 0.213, 0.213 - cosA * 0.213 + sinA * 0.143, 0.213 - cosA * 0.213 - sinA * 0.787,
    0.715 - cosA * 0.715 - sinA * 0.715, 0.715 + cosA * 0.285 + sinA * 0.140, 0.715 - cosA * 0.715 + sinA * 0.715,
    0.072 - cosA * 0.072 + sinA * 0.928, 0.072 - cosA * 0.072 - sinA * 0.283, 0.072 + cosA * 0.928 + sinA * 0.072);
  return m * c;
}
void main() {
  vec4 c = srcAt(vec2(0.0));
  if (c.a <= 0.0) { outColor = vec4(0.0); return; }
  vec3 rgb = unpremul(c) * uBrightness;
  rgb = (rgb - 0.5) * uContrast + 0.5;
  float l = luma(rgb);
  rgb = mix(vec3(l), rgb, uSaturation);
  rgb = hueRotate(rgb, uHue);
  rgb = pow(clamp(rgb, 0.0, 1.0), vec3(1.0 / uGamma));
  outColor = vec4(rgb * c.a, c.a);
}`,

  monochrome: `
uniform vec3 uColor; uniform float uStrength; uniform float uKeep;
void main() {
  vec4 c = srcAt(vec2(0.0));
  vec3 rgb = unpremul(c);
  float l = luma(rgb);
  vec3 mono = uKeep > 0.5 ? uColor * l / max(luma(uColor), 0.05) : uColor;
  outColor = vec4(mix(rgb, clamp(mono, 0.0, 1.0), uStrength) * c.a, c.a);
}`,

  // 1 方向のガウスぼかし（uDir で方向を指定）
  blur: `
uniform vec2 uDir; uniform float uRadius;
void main() {
  if (uRadius < 0.5) { outColor = srcAt(vec2(0.0)); return; }
  float sigma = max(uRadius / 2.0, 0.5);
  float stepPx = max(1.0, uRadius / 48.0);
  int n = int(ceil(uRadius / stepPx));
  vec4 sum = vec4(0.0); float wsum = 0.0;
  for (int i = -96; i <= 96; i++) {
    if (i < -n || i > n) continue;
    float x = float(i) * stepPx;
    float w = exp(-(x * x) / (2.0 * sigma * sigma));
    sum += srcAt(uDir * x) * w;
    wsum += w;
  }
  outColor = sum / wsum;
}`,

  edgeBlurCombine: `
uniform sampler2D uOrig;
void main() {
  vec4 b = texture(uTex, vUv);
  vec4 o = texture(uOrig, vUv);
  float f = clamp((b.a - 0.5) * 2.0, 0.0, 1.0);
  outColor = o * f;
}`,

  mosaic: `
uniform float uSize;
void main() {
  vec2 p = outPx() - uPad;
  vec2 cell = (floor(p / uSize) + 0.5) * uSize;
  cell = clamp(cell, vec2(0.5), uInSize - 0.5);
  outColor = srcPx(cell);
}`,

  sharpen: `
uniform float uStrength; uniform float uRadius;
void main() {
  vec4 c = srcAt(vec2(0.0));
  vec4 b = (srcAt(vec2(uRadius, 0.0)) + srcAt(vec2(-uRadius, 0.0)) + srcAt(vec2(0.0, uRadius)) + srcAt(vec2(0.0, -uRadius))) * 0.25;
  vec4 r = c + (c - b) * uStrength;
  r.a = c.a;
  outColor = vec4(clamp(r.rgb, 0.0, r.a), r.a);
}`,

  glowExtract: `
uniform float uThreshold; uniform vec3 uColor; uniform float uUseColor;
void main() {
  vec4 c = srcAt(vec2(0.0));
  vec3 rgb = unpremul(c);
  float l = luma(rgb);
  float k = clamp((l - uThreshold) / max(1.0 - uThreshold, 0.001), 0.0, 1.0) * c.a;
  vec3 col = uUseColor > 0.5 ? uColor * l : rgb;
  outColor = vec4(col * k, k);
}`,

  glowCombine: `
uniform sampler2D uOrig; uniform float uStrength;
void main() {
  vec4 o = texture(uOrig, vUv);
  vec4 g = texture(uTex, vUv) * uStrength;
  vec3 rgb = o.rgb + g.rgb * (1.0 - o.rgb);
  float a = max(o.a, clamp(max(max(rgb.r, rgb.g), rgb.b), 0.0, 1.0));
  outColor = vec4(min(rgb, vec3(a)), a);
}`,

  // アルファを膨らませて縁の形を作る
  dilate: `
uniform float uSize; uniform vec3 uColor;
void main() {
  float a = srcAt(vec2(0.0)).a;
  if (uSize > 0.0) {
    for (int ring = 1; ring <= 3; ring++) {
      float r = uSize * float(ring) / 3.0;
      for (int i = 0; i < 24; i++) {
        float t = float(i) * 6.2831853 / 24.0;
        a = max(a, srcAt(vec2(cos(t), sin(t)) * r).a);
      }
    }
  }
  outColor = vec4(uColor * a, a);
}`,

  // 影：アルファをずらして色を付ける
  shadowShape: `
uniform vec2 uOffset; uniform vec3 uColor; uniform float uOpacity;
void main() {
  float a = srcAt(-uOffset).a * uOpacity;
  outColor = vec4(uColor * a, a);
}`,

  // uOrig（元の画像）を uTex（縁取り・影）の上に重ねる
  over: `
uniform sampler2D uOrig;
void main() {
  vec4 o = texture(uOrig, vUv);
  vec4 u = texture(uTex, vUv);
  outColor = o + u * (1.0 - o.a);
}`,

  crop: `
uniform vec4 uCrop;
void main() {
  vec2 p = outPx() - uPad;
  if (p.x < uCrop.z || p.x > uInSize.x - uCrop.w || p.y < uCrop.x || p.y > uInSize.y - uCrop.y) { outColor = vec4(0.0); return; }
  outColor = srcAt(vec2(0.0));
}`,

  mask: `
uniform vec2 uCenter; uniform vec2 uHalf; uniform float uFeather; uniform float uEllipse; uniform float uInvert;
void main() {
  vec2 p = outPx() - uPad - (uInSize * 0.5 + uCenter);
  float d;
  if (uEllipse > 0.5) {
    vec2 q = p / max(uHalf, vec2(0.001));
    d = (length(q) - 1.0) * min(uHalf.x, uHalf.y);
  } else {
    vec2 q = abs(p) - uHalf;
    d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  }
  float f = uFeather > 0.0 ? clamp(0.5 - d / uFeather, 0.0, 1.0) : (d <= 0.0 ? 1.0 : 0.0);
  if (uInvert > 0.5) f = 1.0 - f;
  outColor = srcAt(vec2(0.0)) * f;
}`,

  chromaKey: `
uniform vec3 uKey; uniform float uTolerance; uniform float uSoftness; uniform float uSpill;
vec2 chroma(vec3 c) { return vec2(-0.1687 * c.r - 0.3313 * c.g + 0.5 * c.b, 0.5 * c.r - 0.4187 * c.g - 0.0813 * c.b); }
void main() {
  vec4 c = srcAt(vec2(0.0));
  vec3 rgb = unpremul(c);
  float d = distance(chroma(rgb), chroma(uKey)) * 1.6;
  float f = smoothstep(uTolerance, uTolerance + uSoftness + 0.0001, d);
  float l = luma(rgb);
  float spill = uSpill * (1.0 - smoothstep(uTolerance, uTolerance + uSoftness + 0.3, d));
  rgb = mix(rgb, vec3(l), spill);
  float a = c.a * f;
  outColor = vec4(rgb * a, a);
}`,

  colorKey: `
uniform vec3 uKey; uniform float uTolerance; uniform float uSoftness;
void main() {
  vec4 c = srcAt(vec2(0.0));
  vec3 rgb = unpremul(c);
  float d = distance(rgb, uKey) / 1.7320508;
  float a = c.a * smoothstep(uTolerance, uTolerance + uSoftness + 0.0001, d);
  outColor = vec4(rgb * a, a);
}`,

  lumaKey: `
uniform float uThreshold; uniform float uSoftness; uniform float uBright;
void main() {
  vec4 c = srcAt(vec2(0.0));
  vec3 rgb = unpremul(c);
  float l = luma(rgb);
  float f = uBright > 0.5
    ? 1.0 - smoothstep(1.0 - uThreshold - uSoftness, 1.0 - uThreshold + 0.0001, l)
    : smoothstep(uThreshold, uThreshold + uSoftness + 0.0001, l);
  float a = c.a * f;
  outColor = vec4(rgb * a, a);
}`,

  // 登場・退場のワイプ。uKind: 0=左から 1=右から 2=上から 3=下から 4=円。uProgress=1 で全体が見える
  wipe: `
uniform float uKind; uniform float uProgress;
void main() {
  vec2 uv = (outPx() - uPad) / uInSize;
  float soft = 0.02;
  float e = uProgress * (1.0 + soft);
  float f;
  if (uKind < 3.5) {
    float x = uKind < 0.5 ? uv.x : uKind < 1.5 ? 1.0 - uv.x : uKind < 2.5 ? uv.y : 1.0 - uv.y;
    f = 1.0 - smoothstep(e - soft, e, x);
  } else {
    vec2 p = (uv - 0.5) * uInSize;
    float maxR = length(uInSize) * 0.5;
    float r = e * maxR;
    f = 1.0 - smoothstep(r - soft * maxR, r, length(p));
  }
  outColor = srcAt(vec2(0.0)) * clamp(f, 0.0, 1.0);
}`,
};

export const WIPE_KINDS: Record<string, number> = {
  wipeLeft: 0,
  wipeRight: 1,
  wipeUp: 2,
  wipeDown: 3,
  circle: 4,
};

/**
 * エフェクトを実行する環境。プログラムは使うときにコンパイルして保持する。
 */
export class EffectRunner {
  private programs = new Map<string, Program>();

  constructor(
    private gl: WebGL2RenderingContext,
    private pool: RenderTargetPool,
    private vao: WebGLVertexArrayObject,
  ) {}

  private program(name: string): Program {
    let p = this.programs.get(name);
    if (!p) {
      const fs = PRELUDE + SHADERS[name];
      const uniformNames = [
        ...new Set([...fs.matchAll(/uniform\s+\w+\s+(u\w+)/g)].map((m) => m[1])),
      ];
      p = createProgram(this.gl, PASS_VS, fs, uniformNames);
      this.programs.set(name, p);
    }
    return p;
  }

  /**
   * 1 回の描画パス。input を読み、outW×outH の新しい描画先に書く。
   * pad は出力の周囲に足す余白（px）。
   */
  pass(
    name: string,
    input: RenderTarget,
    outW: number,
    outH: number,
    uniforms: Record<string, UniformValue> = {},
    pad: [number, number] = [0, 0],
    extra: Record<string, RenderTarget> = {},
  ): RenderTarget {
    const gl = this.gl;
    const prog = this.program(name);
    const out = this.pool.acquire(outW, outH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.framebuffer);
    gl.viewport(0, 0, out.width, out.height);
    gl.disable(gl.BLEND);
    gl.useProgram(prog.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input.texture);
    gl.uniform1i(prog.uniforms.uTex, 0);
    let unit = 1;
    for (const [uname, t] of Object.entries(extra)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
      gl.uniform1i(prog.uniforms[uname], unit);
      unit++;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(prog.uniforms.uInSize, input.width, input.height);
    gl.uniform2f(prog.uniforms.uOutSize, out.width, out.height);
    gl.uniform2f(prog.uniforms.uPad, pad[0], pad[1]);
    for (const [uname, v] of Object.entries(uniforms)) {
      const loc = prog.uniforms[uname];
      if (!loc) continue;
      if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
      else gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    // 後で描画先として使い回されても読み込みと衝突しないよう、補助テクスチャを外す
    for (let i = 1; i < unit; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.activeTexture(gl.TEXTURE0);
    return out;
  }

  release(t: RenderTarget): void {
    this.pool.release(t);
  }

  /** 2 方向のガウスぼかし。pad > 0 なら周囲を広げてからぼかす */
  blur(input: RenderTarget, radiusPx: number, pad: number): RenderTarget {
    const w = input.width + pad * 2;
    const h = input.height + pad * 2;
    const horizontal = this.pass('blur', input, w, h, { uDir: [1, 0], uRadius: radiusPx }, [
      pad,
      pad,
    ]);
    const vertical = this.pass('blur', horizontal, w, h, { uDir: [0, 1], uRadius: radiusPx });
    this.release(horizontal);
    return vertical;
  }

  dispose(): void {
    for (const p of this.programs.values()) this.gl.deleteProgram(p.program);
    this.programs.clear();
  }
}

/** エフェクトの適用。res はシーン 1px あたりの描画先ピクセル数、expand が false なら大きさを変えない */
export type EffectApply = (
  runner: EffectRunner,
  input: Surface,
  p: ResolvedParams,
  res: number,
  expand: boolean,
) => Surface;

function same(
  runner: EffectRunner,
  input: Surface,
  name: string,
  uniforms: Record<string, UniformValue>,
): Surface {
  const out = runner.pass(name, input.target, input.target.width, input.target.height, uniforms);
  return { target: out, width: input.width, height: input.height };
}

function grown(input: Surface, target: RenderTarget, padPx: number, res: number): Surface {
  return {
    target,
    width: input.width + (padPx * 2) / res,
    height: input.height + (padPx * 2) / res,
  };
}

const n = (v: unknown) => Number(v) || 0;

export const EFFECT_IMPLS: Record<string, EffectApply> = {
  colorAdjust: (r, input, p) =>
    same(r, input, 'colorAdjust', {
      uBrightness: n(p.brightness) / 100,
      uContrast: n(p.contrast) / 100,
      uHue: (n(p.hue) * Math.PI) / 180,
      uSaturation: n(p.saturation) / 100,
      uGamma: Math.max(0.01, n(p.gamma) / 100),
    }),

  monochrome: (r, input, p) =>
    same(r, input, 'monochrome', {
      uColor: parseColor(String(p.color)),
      uStrength: n(p.strength) / 100,
      uKeep: p.keepLuminance ? 1 : 0,
    }),

  blur: (r, input, p, res, expand) => {
    const radius = n(p.radius) * res;
    const pad = expand && p.expand !== false ? Math.ceil(radius) : 0;
    const out = r.blur(input.target, radius, pad);
    return grown(input, out, pad, res);
  },

  edgeBlur: (r, input, p, res) => {
    const radius = n(p.radius) * res;
    if (radius < 0.5) return same(r, input, 'copy', {});
    const blurred = r.blur(input.target, radius, 0);
    const out = r.pass(
      'edgeBlurCombine',
      blurred,
      input.target.width,
      input.target.height,
      {},
      [0, 0],
      {
        uOrig: input.target,
      },
    );
    r.release(blurred);
    return { target: out, width: input.width, height: input.height };
  },

  mosaic: (r, input, p, res) => same(r, input, 'mosaic', { uSize: Math.max(1, n(p.size) * res) }),

  sharpen: (r, input, p, res) =>
    same(r, input, 'sharpen', {
      uStrength: n(p.strength) / 100,
      uRadius: Math.max(0.5, n(p.radius) * res),
    }),

  glow: (r, input, p, res, expand) => {
    const radius = n(p.radius) * res;
    const pad = expand ? Math.ceil(radius) : 0;
    const w = input.target.width + pad * 2;
    const h = input.target.height + pad * 2;
    const bright = r.pass(
      'glowExtract',
      input.target,
      w,
      h,
      {
        uThreshold: n(p.threshold) / 100,
        uColor: parseColor(String(p.color)),
        uUseColor: p.useColor ? 1 : 0,
      },
      [pad, pad],
    );
    const blurred = r.blur(bright, radius, 0);
    r.release(bright);
    const orig = r.pass('copy', input.target, w, h, {}, [pad, pad]);
    const out = r.pass('glowCombine', blurred, w, h, { uStrength: n(p.strength) / 100 }, [0, 0], {
      uOrig: orig,
    });
    r.release(blurred);
    r.release(orig);
    return grown(input, out, pad, res);
  },

  outline: (r, input, p, res, expand) => {
    const size = n(p.size) * res;
    const blur = n(p.blur) * res;
    const pad = expand ? Math.ceil(size + blur) + 1 : 0;
    const w = input.target.width + pad * 2;
    const h = input.target.height + pad * 2;
    let shape = r.pass(
      'dilate',
      input.target,
      w,
      h,
      { uSize: size, uColor: parseColor(String(p.color)) },
      [pad, pad],
    );
    if (blur >= 0.5) {
      const b = r.blur(shape, blur, 0);
      r.release(shape);
      shape = b;
    }
    const orig = r.pass('copy', input.target, w, h, {}, [pad, pad]);
    const out = r.pass('over', shape, w, h, {}, [0, 0], { uOrig: orig });
    r.release(shape);
    r.release(orig);
    return grown(input, out, pad, res);
  },

  dropShadow: (r, input, p, res, expand) => {
    const dx = n(p.x) * res;
    const dy = n(p.y) * res;
    const blur = n(p.blur) * res;
    const pad = expand ? Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) + blur) + 1 : 0;
    const w = input.target.width + pad * 2;
    const h = input.target.height + pad * 2;
    let shadow = r.pass(
      'shadowShape',
      input.target,
      w,
      h,
      { uOffset: [dx, dy], uColor: parseColor(String(p.color)), uOpacity: n(p.opacity) / 100 },
      [pad, pad],
    );
    if (blur >= 0.5) {
      const b = r.blur(shadow, blur, 0);
      r.release(shadow);
      shadow = b;
    }
    const orig = r.pass('copy', input.target, w, h, {}, [pad, pad]);
    const out = r.pass('over', shadow, w, h, {}, [0, 0], { uOrig: orig });
    r.release(shadow);
    r.release(orig);
    return grown(input, out, pad, res);
  },

  crop: (r, input, p, res) =>
    same(r, input, 'crop', {
      uCrop: [n(p.top) * res, n(p.bottom) * res, n(p.left) * res, n(p.right) * res],
    }),

  mask: (r, input, p, res) =>
    same(r, input, 'mask', {
      uCenter: [n(p.x) * res, n(p.y) * res],
      uHalf: [(n(p.width) * res) / 2, (n(p.height) * res) / 2],
      uFeather: n(p.feather) * res,
      uEllipse: p.shape === 'rectangle' ? 0 : 1,
      uInvert: p.invert ? 1 : 0,
    }),

  chromaKey: (r, input, p) =>
    same(r, input, 'chromaKey', {
      uKey: parseColor(String(p.color)),
      uTolerance: n(p.tolerance) / 100,
      uSoftness: n(p.softness) / 100,
      uSpill: n(p.spill) / 100,
    }),

  colorKey: (r, input, p) =>
    same(r, input, 'colorKey', {
      uKey: parseColor(String(p.color)),
      uTolerance: n(p.tolerance) / 100,
      uSoftness: n(p.softness) / 100,
    }),

  lumaKey: (r, input, p) =>
    same(r, input, 'lumaKey', {
      uThreshold: n(p.threshold) / 100,
      uSoftness: n(p.softness) / 100,
      uBright: p.mode === 'bright' ? 1 : 0,
    }),

  // 登場・退場のワイプ（内部用）
  wipe: (r, input, p) =>
    same(r, input, 'wipe', {
      uKind: n(p.kind),
      uProgress: Math.max(0, Math.min(1, n(p.progress))),
    }),
};
