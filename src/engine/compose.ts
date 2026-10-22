import { evaluateFrame, inRange, type VisualItem } from '../core/evaluate/evaluate';
import { fpsValue, framesToSeconds } from '../core/model/time';
import type { Project, Scene } from '../core/model/types';
import { PARTICLE_PARAM_IDS, type BlendMode } from '../core/objects/definitions';
import { simulateParticles } from '../core/particles/particles';
import { sceneDuration } from '../core/timeline/ops';
import { DEFAULT_FOCAL, type Mat3 } from './render/gl';
import type { CameraView, DrawItem, Region, RenderOp } from './render/Renderer';
import {
  RasterCache,
  rasterizeParticles,
  rasterizeShape,
  rasterizeSolid,
  rasterizeText,
  rasterizeWave,
  textFont,
  type WavePeaks,
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
  /** 画像。アニメーション画像なら素材内の時刻 time（秒）のコマ */
  getImage(assetId: string, time?: number): ImageBitmap | undefined;
  /** instanceKey はオブジェクトの識別子（入れ子のシーンでは親のオブジェクト ID を前につける） */
  getVideoFrame(
    instanceKey: string,
    assetId: string,
    sourceTime: number,
  ): VideoFrameRef | undefined;
  assetDuration(assetId: string): number | undefined;
  /** 素材の音声の振幅データ（音声波形オブジェクト用。まだなければ undefined） */
  getPeaks?(assetId: string): WavePeaks | undefined;
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

/** 入れ子のシーンの深さの上限 */
const MAX_DEPTH = 8;

/** 拡大表示でぼやけないよう、拡大率に応じて高い解像度で描画する倍率 */
function rasterUpscale(scalePercent: number): number {
  const s = Math.abs(scalePercent) / 100;
  if (s <= 1) return 1;
  return Math.min(8, 2 ** Math.ceil(Math.log2(s)));
}

interface ComposeContext {
  project: Project;
  media: MediaProvider;
  pixelScale: number;
  keys: Set<string>;
  rasterIds: Set<string>;
  /** 入れ子のシーンでのオブジェクトの識別子の接頭辞 */
  prefix: string;
  /** 表示中のシーンの経路（循環参照を防ぐ） */
  path: string[];
}

/** グループ制御（作用中のもの） */
interface ActiveGroup {
  layer: number;
  range: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

interface ActiveCamera {
  layer: number;
  range: number;
  view: CameraView;
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
  async loadFonts(project: Project): Promise<void> {
    if (typeof document === 'undefined' || !document.fonts) return;
    const fonts = new Set<string>();
    for (const scene of project.scenes) {
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

  private drawItemFor(ctx: ComposeContext, item: VisualItem, scene: Scene): DrawItem | null {
    const { project, media, pixelScale } = ctx;
    const p = item.params;
    const obj = item.object;
    const id = ctx.prefix + obj.id;
    const m = item.motion;
    const scale = (Number(p.scale) / 100) * m.scale;
    const base = {
      key: id,
      x: Number(p.x) + m.dx,
      y: Number(p.y) + m.dy,
      z: Number(p.z) || 0,
      scaleX: scale * (p.flipH ? -1 : 1),
      scaleY: scale * (p.flipV ? -1 : 1),
      rotation: Number(p.rotation),
      rotX: Number(p.rotX) || 0,
      rotY: Number(p.rotY) || 0,
      opacity: item.opacity,
      blend: String(p.blend) as BlendMode,
      effects: item.effects,
      effectScale: pixelScale * rasterUpscale(Number(p.scale)),
      ...(m.wipe ? { wipe: m.wipe } : {}),
    };
    switch (obj.type) {
      case 'image': {
        const bitmap = obj.assetId ? media.getImage(obj.assetId, item.sourceTime) : undefined;
        if (!bitmap) return null;
        return {
          ...base,
          // アニメーション画像はオブジェクトごとに違うコマを表示するので、テクスチャを分ける
          key: item.sourceTime === undefined ? `asset:${obj.assetId}` : id,
          source: bitmap,
          version: bitmap,
          mipmap: true,
          width: bitmap.width,
          height: bitmap.height,
        };
      }
      case 'video': {
        if (!obj.assetId || item.sourceTime === undefined) return null;
        const ref = media.getVideoFrame(id, obj.assetId, item.sourceTime);
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
        const rs = pixelScale * rasterUpscale(Number(p.scale));
        this.ensureFont(textFont(p, 1));
        const speed = Number(p.typeSpeed) || 0;
        const visible =
          speed > 0
            ? Math.floor(framesToSeconds(item.localFrame, project.settings.fps) * speed + 1e-6)
            : Infinity;
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
          rs,
          visible === Infinity ? -1 : visible,
        ]);
        ctx.rasterIds.add(id);
        const raster = this.rasters.get(id, key, () => rasterizeText(p, rs, visible));
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
        const rs = pixelScale * rasterUpscale(Number(p.scale));
        const key = JSON.stringify([
          p.shape,
          p.width,
          p.height,
          p.color,
          p.strokeWidth,
          p.cornerRadius,
          p.starInner,
          rs,
        ]);
        ctx.rasterIds.add(id);
        const raster = this.rasters.get(id, key, () => rasterizeShape(p, rs));
        return {
          ...base,
          source: raster.canvas,
          version: raster,
          mipmap: true,
          width: raster.width,
          height: raster.height,
        };
      }
      case 'audioWave': {
        const rs = pixelScale * rasterUpscale(Number(p.scale));
        const src = item.waveSource;
        const peaks = src ? media.getPeaks?.(src.assetId) : undefined;
        const key = JSON.stringify([
          p.style,
          p.width,
          p.height,
          p.bars,
          p.window,
          p.align,
          p.sensitivity,
          p.color,
          rs,
          src?.assetId,
          src?.time,
          src?.speed,
          peaks ? 1 : 0,
        ]);
        ctx.rasterIds.add(id);
        const raster = this.rasters.get(id, key, () =>
          rasterizeWave(p, rs, peaks, src?.time ?? 0, src?.speed ?? 1),
        );
        return {
          ...base,
          source: raster.canvas,
          version: raster,
          mipmap: true,
          width: raster.width,
          height: raster.height,
        };
      }
      case 'particles': {
        const rs = pixelScale * rasterUpscale(Number(p.scale));
        const time = framesToSeconds(item.localFrame, project.settings.fps);
        // 粒子の位置は毎フレーム変わるので、時刻も鍵に含める
        const key = JSON.stringify([time, rs, ...PARTICLE_PARAM_IDS.map((k) => p[k])]);
        ctx.rasterIds.add(id);
        const raster = this.rasters.get(id, key, () =>
          rasterizeParticles(simulateParticles(p, time), p, rs),
        );
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
        ctx.rasterIds.add(id);
        const raster = this.rasters.get(id, String(p.color), () => ({
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
      case 'scene': {
        const sceneId = String(p.sceneRef);
        const nested = project.scenes.find((s) => s.id === sceneId);
        if (!nested || ctx.path.includes(sceneId) || ctx.path.length >= MAX_DEPTH) return null;
        const inner = this.composeScene(
          { ...ctx, prefix: `${id}/`, path: [...ctx.path, sceneId] },
          nested,
          item.sceneFrame ?? 0,
        );
        return {
          ...base,
          width: nested.width,
          height: nested.height,
          nested: { ops: inner.ops, sceneWidth: nested.width, sceneHeight: nested.height },
        };
      }
      case 'framebuffer':
        return {
          ...base,
          width: scene.width,
          height: scene.height,
          framebuffer: { clear: p.clear === true, background: project.settings.backgroundColor },
        };
      default:
        return null;
    }
  }

  /** シーン 1 つ分の描画手順を作る（シーンオブジェクトでは入れ子で呼ばれる） */
  private composeScene(
    ctx: ComposeContext,
    scene: Scene,
    frame: number,
  ): { ops: RenderOp[]; items: ComposedItem[] } {
    const { project } = ctx;
    const visual = evaluateFrame(scene, frame, {
      fps: project.settings.fps,
      assetDuration: (id) => ctx.media.assetDuration(id),
      sceneLength: (id) => {
        const s = project.scenes.find((x) => x.id === id);
        return s ? sceneDuration(s) : 0;
      },
    });
    const ops: RenderOp[] = [];
    const items: ComposedItem[] = [];
    const groups: ActiveGroup[] = [];
    const cameras: ActiveCamera[] = [];
    // 直前に描いたオブジェクト（上のオブジェクトでクリッピングの対象）
    let previous: { layer: number; draw: DrawItem; opIndex: number; itemIndex: number } | null =
      null;
    for (const item of visual) {
      const p = item.params;
      const layer = item.object.layer;
      switch (item.object.type) {
        case 'filter':
          ops.push({ kind: 'filter', effects: item.effects });
          previous = null;
          continue;
        case 'partialFilter': {
          const region: Region = {
            shape: p.shape === 'ellipse' ? 'ellipse' : 'rectangle',
            x: Number(p.x),
            y: Number(p.y),
            width: Number(p.width),
            height: Number(p.height),
            feather: Number(p.feather),
            invert: p.invert === true,
          };
          ops.push({ kind: 'filter', effects: item.effects, region });
          previous = null;
          continue;
        }
        case 'group':
          groups.push({
            layer,
            range: Number(p.range),
            x: Number(p.x),
            y: Number(p.y),
            scale: Number(p.scale) / 100,
            rotation: Number(p.rotation),
            opacity: Number(p.opacity) / 100,
          });
          continue;
        case 'camera': {
          const zoom = Math.max(0.01, Number(p.zoom) / 100);
          cameras.push({
            layer,
            range: Number(p.range),
            view: {
              eye: [Number(p.eyeX), Number(p.eyeY), Number(p.eyeZ)],
              target: [Number(p.targetX), Number(p.targetY), Number(p.targetZ)],
              focal: DEFAULT_FOCAL * zoom,
            },
          });
          continue;
        }
      }
      const draw = this.drawItemFor(ctx, item, scene);
      if (!draw) {
        previous = null;
        continue;
      }
      // グループ制御：内側（レイヤー番号の大きい方）から順に変換をかける
      for (let i = groups.length - 1; i >= 0; i--) {
        const g = groups[i];
        if (!inRange(g, layer)) continue;
        const r = (g.rotation * Math.PI) / 180;
        const x = draw.x * g.scale;
        const y = draw.y * g.scale;
        draw.x = g.x + x * Math.cos(r) - y * Math.sin(r);
        draw.y = g.y + x * Math.sin(r) + y * Math.cos(r);
        draw.rotation += g.rotation;
        draw.scaleX *= g.scale;
        draw.scaleY *= g.scale;
        draw.opacity *= g.opacity;
      }
      // カメラ制御：対象範囲のうち最も内側のカメラ
      for (let i = cameras.length - 1; i >= 0; i--) {
        if (inRange(cameras[i], layer)) {
          draw.camera = cameras[i].view;
          break;
        }
      }
      ctx.keys.add(draw.key);
      if (p.clipUpper === true) {
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
    return { ops, items };
  }

  compose(
    project: Project,
    scene: Scene,
    frame: number,
    media: MediaProvider,
    pixelScale: number,
  ): ComposedFrame {
    const ctx: ComposeContext = {
      project,
      media,
      pixelScale,
      keys: new Set(),
      rasterIds: new Set(),
      prefix: '',
      path: [scene.id],
    };
    const { ops, items } = this.composeScene(ctx, scene, frame);
    this.rasters.prune(ctx.rasterIds);
    return { ops, items, textureKeys: ctx.keys };
  }
}

/** シーンオブジェクトの既定の長さ（表示するシーンの長さ。空なら 5 秒） */
export function sceneObjectLength(project: Project, sceneId: string): number {
  const s = project.scenes.find((x) => x.id === sceneId);
  const len = s ? sceneDuration(s) : 0;
  return len > 0 ? len : Math.round(5 * fpsValue(project.settings.fps));
}
