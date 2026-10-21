import { evaluateFrame, type VisualItem } from '../core/evaluate/evaluate';
import type { Project, Scene } from '../core/model/types';
import type { BlendMode } from '../core/objects/definitions';
import type { Mat3 } from './render/gl';
import type { DrawItem, RenderOp } from './render/Renderer';
import {
  RasterCache,
  rasterizeShape,
  rasterizeSolid,
  rasterizeText,
  textFont,
} from './objects/raster';

/** 動画の 1 フレーム */
export interface VideoFrameRef {
  frame: VideoFrame;
  /** 素材の回転メタデータ（時計回り） */
  rotation: 0 | 90 | 180 | 270;
  /** 回転を適用した後の表示サイズ */
  width: number;
  height: number;
  /** フレームが変わったことを表す値（タイムスタンプなど） */
  version: number;
}

/** 素材の中身（画像・動画フレーム）を提供する */
export interface MediaProvider {
  getImage(assetId: string): ImageBitmap | undefined;
  getVideoFrame(objectId: string, assetId: string, sourceTime: number): VideoFrameRef | undefined;
  assetDuration(assetId: string): number | undefined;
}

export interface ComposedItem {
  objectId: string;
  layer: number;
  draw: DrawItem;
}

/** 1 フレーム分の描画手順と、画面に見えているオブジェクト */
export interface ComposedFrame {
  ops: RenderOp[];
  items: ComposedItem[];
  /** 使用中のテクスチャのキー（使われなくなったものを解放するため） */
  textureKeys: Set<string>;
}

const UV_ROTATION: Record<0 | 90 | 180 | 270, Mat3> = {
  0: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
  90: new Float32Array([0, -1, 0, 1, 0, 0, 0, 1, 1]),
  180: new Float32Array([-1, 0, 0, 0, -1, 0, 1, 1, 1]),
  270: new Float32Array([0, 1, 0, -1, 0, 0, 1, 0, 1]),
};

/** 拡大表示でぼやけないよう、拡大率に応じて高い解像度で描画する倍率 */
function rasterUpscale(scalePercent: number): number {
  const s = Math.abs(scalePercent) / 100;
  if (s <= 1) return 1;
  return Math.min(8, 2 ** Math.ceil(Math.log2(s)));
}

/**
 * タイムラインの状態から、1 フレーム分の描画指示を組み立てる。
 * プレビューと書き出しで共通に使う。
 */
export class Compositor {
  private rasters = new RasterCache();
  private pendingFonts = new Set<string>();

  /** フォントの読み込みが終わったときに呼ばれる（再描画のため） */
  onFontLoaded: (() => void) | null = null;

  /** 書き出し前など、必要なフォントを先に読み込む */
  async loadFonts(scene: Scene): Promise<void> {
    if (typeof document === 'undefined' || !document.fonts) return;
    const fonts = new Set<string>();
    for (const o of scene.objects) {
      if (o.type !== 'text') continue;
      fonts.add(
        textFont(
          {
            size: 32,
            font: String(o.params.font ?? 'sans-serif'),
            bold: o.params.bold === true,
            italic: o.params.italic === true,
          },
          1,
        ),
      );
    }
    await Promise.all([...fonts].map((f) => document.fonts.load(f).catch(() => [])));
  }

  private ensureFont(font: string): void {
    if (typeof document === 'undefined' || !document.fonts) return;
    if (document.fonts.check(font) || this.pendingFonts.has(font)) return;
    this.pendingFonts.add(font);
    document.fonts
      .load(font)
      .then((faces) => {
        if (faces.length > 0) {
          this.rasters.clear();
          this.onFontLoaded?.();
        }
      })
      .catch(() => undefined);
  }

  private drawItemFor(
    item: VisualItem,
    project: Project,
    scene: Scene,
    media: MediaProvider,
    pixelScale: number,
  ): DrawItem | null {
    const p = item.params;
    const obj = item.object;
    const m = item.motion;
    const scale = (Number(p.scale) / 100) * m.scale;
    const base = {
      key: obj.id,
      x: Number(p.x) + m.dx,
      y: Number(p.y) + m.dy,
      scaleX: scale * (p.flipH ? -1 : 1),
      scaleY: scale * (p.flipV ? -1 : 1),
      rotation: Number(p.rotation),
      opacity: item.opacity,
      blend: String(p.blend) as BlendMode,
      effects: item.effects,
      effectScale: pixelScale * rasterUpscale(Number(p.scale)),
      ...(m.wipe ? { wipe: m.wipe } : {}),
    };
    switch (obj.type) {
      case 'image': {
        const bitmap = obj.assetId ? media.getImage(obj.assetId) : undefined;
        if (!bitmap) return null;
        return {
          ...base,
          key: `asset:${obj.assetId}`,
          source: bitmap,
          version: bitmap,
          mipmap: true,
          width: bitmap.width,
          height: bitmap.height,
        };
      }
      case 'video': {
        if (!obj.assetId || item.sourceTime === undefined) return null;
        const ref = media.getVideoFrame(obj.id, obj.assetId, item.sourceTime);
        if (!ref) return null;
        return {
          ...base,
          source: ref.frame,
          version: ref.version,
          mipmap: false,
          width: ref.width,
          height: ref.height,
          uvMatrix: UV_ROTATION[ref.rotation],
        };
      }
      case 'text': {
        const scale = pixelScale * rasterUpscale(Number(p.scale));
        this.ensureFont(textFont(p, 1));
        const key = JSON.stringify([
          p.text,
          p.font,
          p.size,
          p.color,
          p.bold,
          p.italic,
          p.align,
          p.lineHeight,
          p.letterSpacing,
          p.outlineWidth,
          p.outlineColor,
          p.shadow,
          p.shadowColor,
          p.shadowX,
          p.shadowY,
          p.shadowBlur,
          scale,
        ]);
        const raster = this.rasters.get(obj.id, key, () => rasterizeText(p, scale));
        return {
          ...base,
          source: raster.canvas,
          version: raster,
          mipmap: true,
          width: raster.width,
          height: raster.height,
        };
      }
      case 'shape': {
        const scale = pixelScale * rasterUpscale(Number(p.scale));
        const key = JSON.stringify([
          p.shape,
          p.width,
          p.height,
          p.color,
          p.strokeWidth,
          p.cornerRadius,
          p.starInner,
          scale,
        ]);
        const raster = this.rasters.get(obj.id, key, () => rasterizeShape(p, scale));
        return {
          ...base,
          source: raster.canvas,
          version: raster,
          mipmap: true,
          width: raster.width,
          height: raster.height,
        };
      }
      case 'solid': {
        const key = String(p.color);
        const raster = this.rasters.get(obj.id, key, () => ({
          canvas: rasterizeSolid(p),
          width: 1,
          height: 1,
        }));
        return {
          ...base,
          source: raster.canvas,
          version: raster,
          mipmap: false,
          width: scene.width || project.settings.width,
          height: scene.height || project.settings.height,
        };
      }
      default:
        return null;
    }
  }

  compose(
    project: Project,
    scene: Scene,
    frame: number,
    media: MediaProvider,
    pixelScale: number,
  ): ComposedFrame {
    const visual = evaluateFrame(scene, frame, {
      fps: project.settings.fps,
      assetDuration: (id) => media.assetDuration(id),
    });
    const ops: RenderOp[] = [];
    const items: ComposedItem[] = [];
    const keys = new Set<string>();
    // 直前に描いたオブジェクト（上のオブジェクトでクリッピングの対象）
    let previous: { layer: number; draw: DrawItem; opIndex: number; itemIndex: number } | null =
      null;
    for (const item of visual) {
      if (item.object.type === 'filter') {
        ops.push({ kind: 'filter', effects: item.effects });
        previous = null;
        continue;
      }
      const draw = this.drawItemFor(item, project, scene, media, pixelScale);
      if (!draw) {
        previous = null;
        continue;
      }
      keys.add(draw.key);
      const layer = item.object.layer;
      if (item.params.clipUpper === true) {
        // 直上のレイヤーのオブジェクトの形で切り抜く（上のオブジェクト自体は描かない）
        if (previous && previous.layer === layer - 1) {
          ops.splice(previous.opIndex, 1);
          items.splice(previous.itemIndex, 1);
          ops.push({ kind: 'draw', item: draw, mask: previous.draw });
          items.push({ objectId: item.object.id, layer, draw });
        }
        previous = null;
        continue;
      }
      ops.push({ kind: 'draw', item: draw });
      items.push({ objectId: item.object.id, layer, draw });
      previous = { layer, draw, opIndex: ops.length - 1, itemIndex: items.length - 1 };
    }
    this.rasters.prune(new Set(scene.objects.map((o) => o.id)));
    return { ops, items, textureKeys: keys };
  }
}
