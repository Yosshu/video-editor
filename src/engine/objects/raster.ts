import type { ResolvedParams } from '../../core/evaluate/evaluate';

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
export function rasterizeText(p: ResolvedParams, scale: number): Raster {
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

  const drawPass = (fn: (line: string, x: number, y: number) => void) => {
    lines.forEach((line, i) => fn(line, xFor(widths[i]), pad + lineHeight * (i + 0.5)));
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
