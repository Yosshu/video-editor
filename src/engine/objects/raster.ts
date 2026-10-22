import type { ResolvedParams } from '../../core/evaluate/evaluate';
import type { Particle } from '../../core/particles/particles';
import { parseColor } from '../render/gl';

/** テキスト・図形をビットマップにした結果 */
export interface Raster {
  canvas: OffscreenCanvas;
  /** シーン座標での大きさ */
  width: number;
  height: number;
}

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
]);

export function cssFontFamily(family: string): string {
  const names = family
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) =>
      GENERIC_FAMILIES.has(f) || /^["'].*["']$/.test(f) ? f : `"${f.replace(/"/g, '')}"`,
    );
  if (!names.some((n) => GENERIC_FAMILIES.has(n))) names.push('sans-serif');
  return names.join(', ');
}

export function textFont(p: ResolvedParams, scale: number): string {
  const size = Math.max(1, Number(p.size) * scale);
  return `${p.italic ? 'italic ' : ''}${p.bold ? 'bold ' : ''}${size}px ${cssFontFamily(String(p.font))}`;
}

function createCanvas(width: number, height: number): OffscreenCanvas {
  return new OffscreenCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
}

/** テキストを描画する。中心は文字のまとまりの中心 */
export function rasterizeText(
  p: ResolvedParams,
  scale: number,
  /** 先頭から何文字まで表示するか（1 文字ずつ表示。配置は全文で決める） */
  visibleChars = Infinity,
): Raster {
  const lines = String(p.text).split(/\r?\n/);
  const size = Number(p.size) * scale;
  const lineHeight = size * (Number(p.lineHeight) / 100);
  const letterSpacing = Number(p.letterSpacing) * scale;
  const outline = Number(p.outlineWidth) * scale;
  const shadow = p.shadow === true;
  const shadowX = shadow ? Number(p.shadowX) * scale : 0;
  const shadowY = shadow ? Number(p.shadowY) * scale : 0;
  const shadowBlur = shadow ? Number(p.shadowBlur) * scale : 0;

  const measure = createCanvas(1, 1).getContext('2d')!;
  measure.font = textFont(p, scale);
  measure.letterSpacing = `${letterSpacing}px`;
  const widths = lines.map((l) => measure.measureText(l).width);
  const blockWidth = Math.max(1, ...widths);
  const blockHeight = Math.max(lineHeight, 1) * lines.length;

  // 縁取りと影がはみ出す分の余白（中心を保つため上下左右で同じにする）
  const pad = Math.ceil(
    outline + Math.max(Math.abs(shadowX), Math.abs(shadowY)) + shadowBlur * 2 + size * 0.15 + 2,
  );
  const canvas = createCanvas(blockWidth + pad * 2, blockHeight + pad * 2);
  const ctx = canvas.getContext('2d')!;
  ctx.font = textFont(p, scale);
  ctx.letterSpacing = `${letterSpacing}px`;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  const align = String(p.align);
  const xFor = (w: number) => {
    if (align === 'left') return pad;
    if (align === 'right') return pad + blockWidth - w;
    return pad + (blockWidth - w) / 2;
  };

  // 表示する文字数を行ごとに割り振る
  let remaining = visibleChars;
  const visibleLines = lines.map((line) => {
    const chars = Array.from(line);
    const shown = chars.slice(0, Math.max(0, remaining)).join('');
    remaining -= chars.length;
    return shown;
  });
  const drawPass = (fn: (line: string, x: number, y: number) => void) => {
    visibleLines.forEach((line, i) => {
      if (line) fn(line, xFor(widths[i]), pad + lineHeight * (i + 0.5));
    });
  };

  if (shadow) {
    ctx.shadowColor = String(p.shadowColor);
    ctx.shadowOffsetX = shadowX;
    ctx.shadowOffsetY = shadowY;
    ctx.shadowBlur = shadowBlur;
  }
  if (outline > 0) {
    ctx.strokeStyle = String(p.outlineColor);
    ctx.lineWidth = outline * 2;
    drawPass((line, x, y) => ctx.strokeText(line, x, y));
    ctx.shadowColor = 'transparent';
  }
  ctx.fillStyle = String(p.color);
  drawPass((line, x, y) => ctx.fillText(line, x, y));

  return { canvas, width: canvas.width / scale, height: canvas.height / scale };
}

function polygonPoints(
  sides: number,
  w: number,
  h: number,
  cx: number,
  cy: number,
): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    pts.push([cx + (Math.cos(a) * w) / 2, cy + (Math.sin(a) * h) / 2]);
  }
  return pts;
}

function starPoints(
  w: number,
  h: number,
  cx: number,
  cy: number,
  inner: number,
): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 1 : inner;
    pts.push([cx + (Math.cos(a) * w * r) / 2, cy + (Math.sin(a) * h * r) / 2]);
  }
  return pts;
}

/** 図形を描画する。中心は図形の中心 */
export function rasterizeShape(p: ResolvedParams, scale: number): Raster {
  const w = Math.max(1, Number(p.width) * scale);
  const h = Math.max(1, Number(p.height) * scale);
  const stroke = Number(p.strokeWidth) * scale;
  const pad = 2;
  const canvas = createCanvas(w + pad * 2, h + pad * 2);
  const ctx = canvas.getContext('2d')!;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  // ライン幅は図形の内側に収める
  const inset = stroke > 0 ? stroke / 2 : 0;
  const iw = Math.max(0, w - inset * 2);
  const ih = Math.max(0, h - inset * 2);

  ctx.beginPath();
  switch (String(p.shape)) {
    case 'ellipse':
      ctx.ellipse(cx, cy, iw / 2, ih / 2, 0, 0, Math.PI * 2);
      break;
    case 'triangle':
    case 'pentagon':
    case 'hexagon':
    case 'star': {
      const pts =
        p.shape === 'star'
          ? starPoints(iw, ih, cx, cy, Number(p.starInner) / 100)
          : polygonPoints(
              { triangle: 3, pentagon: 5, hexagon: 6 }[String(p.shape) as 'triangle'],
              iw,
              ih,
              cx,
              cy,
            );
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      break;
    }
    default: {
      const r = Math.min(Number(p.cornerRadius) * scale, iw / 2, ih / 2);
      ctx.roundRect(cx - iw / 2, cy - ih / 2, iw, ih, Math.max(0, r));
    }
  }
  if (stroke > 0) {
    ctx.strokeStyle = String(p.color);
    ctx.lineWidth = stroke;
    ctx.lineJoin = 'round';
    ctx.stroke();
  } else {
    ctx.fillStyle = String(p.color);
    ctx.fill();
  }
  return { canvas, width: canvas.width / scale, height: canvas.height / scale };
}

/** 単色（シーン全体の大きさの四角形）。拡大しても色は変わらないので 1px で足りる */
export function rasterizeSolid(p: ResolvedParams): OffscreenCanvas {
  const canvas = createCanvas(1, 1);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = String(p.color);
  ctx.fillRect(0, 0, 1, 1);
  return canvas;
}

/** オブジェクトごとに直近の描画結果を覚えておき、内容が同じなら使い回す */
/** 波形の振幅データ（一定間隔ごとの最大値） */
export interface WavePeaks {
  data: Float32Array;
  /** 1 秒あたりの区間数 */
  rate: number;
}

/** 素材内の時刻 [from, to)（秒）の振幅の最大値 */
function peakBetween(peaks: WavePeaks, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from * peaks.rate));
  const b = Math.min(peaks.data.length, Math.max(a + 1, Math.ceil(to * peaks.rate)));
  let m = 0;
  for (let i = a; i < b; i++) if (peaks.data[i] > m) m = peaks.data[i];
  return m;
}

/**
 * 音声波形を描画する。time は素材内の今の時刻（秒）、speed はその素材の再生速度。
 * peaks がなければ（読み込み中など）枠の大きさだけの透明な画像にする
 */
export function rasterizeWave(
  p: ResolvedParams,
  scale: number,
  peaks: WavePeaks | undefined,
  time: number,
  speed: number,
): Raster {
  const w = Math.max(1, Number(p.width) * scale);
  const h = Math.max(1, Number(p.height) * scale);
  const canvas = createCanvas(w, h);
  const result = { canvas, width: Number(p.width), height: Number(p.height) };
  if (!peaks) return result;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = String(p.color);
  ctx.strokeStyle = String(p.color);
  const style = String(p.style);
  const count =
    style === 'line' ? Math.max(2, Math.round(w / 3)) : Math.max(2, Math.round(Number(p.bars)));
  // 表示する素材内の区間（再生速度の分だけ広がる）
  const span = Math.max(0.01, Number(p.window)) * Math.max(0.01, Math.abs(speed));
  const start = time - (p.align === 'end' ? span : span / 2);
  const gain = Number(p.sensitivity) / 100;
  const values = Array.from({ length: count }, (_, i) =>
    Math.min(
      1,
      peakBetween(peaks, start + (span * i) / count, start + (span * (i + 1)) / count) * gain,
    ),
  );
  const step = w / count;
  if (style === 'line') {
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    values.forEach((v, i) => ctx.lineTo((i + 0.5) * step, h / 2 - (v * h) / 2));
    ctx.lineTo(w, h / 2);
    for (let i = count - 1; i >= 0; i--) ctx.lineTo((i + 0.5) * step, h / 2 + (values[i] * h) / 2);
    ctx.closePath();
    ctx.fill();
    return result;
  }
  const barW = Math.max(1, step * 0.65);
  values.forEach((v, i) => {
    const x = i * step + (step - barW) / 2;
    const bh = Math.max(scale, v * h);
    if (style === 'mirror') ctx.fillRect(x, (h - bh) / 2, barW, bh);
    else ctx.fillRect(x, h - bh, barW, bh);
  });
  return result;
}

/** 粒子を描く範囲の上限（中心から上下左右それぞれ、px） */
const MAX_PARTICLE_EXTENT = 4096;

/**
 * パーティクルを描画する。画像の中心が発生位置になるよう、上下・左右に同じだけ広げた大きさにする
 */
export function rasterizeParticles(
  particles: Particle[],
  p: ResolvedParams,
  scale: number,
): Raster {
  let ex = 1;
  let ey = 1;
  for (const q of particles) {
    ex = Math.max(ex, Math.abs(q.x) + q.size);
    ey = Math.max(ey, Math.abs(q.y) + q.size);
  }
  ex = Math.min(ex, MAX_PARTICLE_EXTENT);
  ey = Math.min(ey, MAX_PARTICLE_EXTENT);
  const canvas = createCanvas(ex * 2 * scale, ey * 2 * scale);
  const result = { canvas, width: canvas.width / scale, height: canvas.height / scale };
  const ctx = canvas.getContext('2d')!;
  const c1 = parseColor(String(p.color)).map((v) => v * 255);
  const c2 = parseColor(String(p.color2)).map((v) => v * 255);
  const colorOf = (mix: number) =>
    `rgb(${c1.map((v, i) => Math.round(v + (c2[i] - v) * mix)).join(',')})`;
  const shape = String(p.shape);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  for (const q of particles) {
    const r = (q.size * scale) / 2;
    if (r <= 0 || q.opacity <= 0) continue;
    const x = cx + q.x * scale;
    const y = cy + q.y * scale;
    const color = colorOf(q.mix);
    ctx.globalAlpha = Math.min(1, q.opacity);
    if (shape === 'glow') {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      continue;
    }
    ctx.fillStyle = color;
    if (shape === 'circle') {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((q.rotation * Math.PI) / 180);
    if (shape === 'star') {
      ctx.beginPath();
      starPoints(r * 2, r * 2, 0, 0, 0.45).forEach(([px, py], i) =>
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py),
      );
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(-r, -r, r * 2, r * 2);
    }
    ctx.restore();
  }
  return result;
}

export class RasterCache {
  private entries = new Map<string, { key: string; raster: Raster }>();

  get(objectId: string, key: string, create: () => Raster): Raster {
    const hit = this.entries.get(objectId);
    if (hit && hit.key === key) return hit.raster;
    const raster = create();
    this.entries.set(objectId, { key, raster });
    return raster;
  }

  prune(activeIds: ReadonlySet<string>): void {
    for (const id of this.entries.keys()) if (!activeIds.has(id)) this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
  }
}
