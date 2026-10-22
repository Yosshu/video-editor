import { create } from 'zustand';
import { fpsValue } from '../../core/model/time';
import { Compositor, type ComposedItem, type MediaProvider } from '../compose';
import { Renderer } from '../render/Renderer';
import { currentScene, getState, useEditor } from '../../state/store';
import { assetRegistry } from '../media/registry';
import { useCustomShaders } from '../effects/customShader';
import { onPreviewFrameReady } from './previewMediaInstance';

/** 実際に使っている解像度の倍率と、直近の描画にかかった時間（ミリ秒） */
export const usePreviewStats = create<{ scale: number; renderMs: number }>(() => ({
  scale: 1,
  renderMs: 0,
}));

const SCALES = [1, 0.5, 0.25] as const;
/** 「自動」で止まっているときに描く画素数の上限（フル HD） */
const MAX_STILL_PIXELS = 1920 * 1080;
/** 何フレーム分の様子を見て解像度を変えるか */
const WINDOW = 20;

/**
 * プレビュー画面の描画。状態が変わったら次のアニメーションフレームでまとめて描き直す。
 * 画質が「自動」のときは、止まっている間は等倍で描き、再生中は描画が間に合わなければ解像度を下げる
 * （間に合っている状態が続けば上げる）。
 */
export class PreviewEngine {
  private renderer: Renderer;
  private compositor = new Compositor();
  private raf = 0;
  private disposers: (() => void)[] = [];
  private listeners = new Set<(items: ComposedItem[]) => void>();
  /** 直近に描画したオブジェクト（プレビュー上の選択・ドラッグ用） */
  lastItems: ComposedItem[] = [];
  /** 再生中に自動で選んだ倍率（SCALES の番号） */
  private autoLevel = 1;
  /** 再生中の描画の記録（前回の描画の時刻、描画の間隔と処理時間） */
  private lastRenderAt = 0;
  private intervals: number[] = [];
  private costs: number[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    private media: MediaProvider,
  ) {
    this.renderer = new Renderer(canvas);
    this.compositor.onFontLoaded = () => this.requestRender();
    this.disposers.push(
      useEditor.subscribe((state, prev) => {
        if (
          state.project !== prev.project ||
          state.playhead !== prev.playhead ||
          state.sceneId !== prev.sceneId ||
          state.previewQuality !== prev.previewQuality ||
          state.playing !== prev.playing ||
          state.assetStatus !== prev.assetStatus
        ) {
          this.requestRender();
        }
      }),
      assetRegistry.onChange(() => this.requestRender()),
      onPreviewFrameReady(() => this.requestRender()),
      // ユーザー定義シェーダーの実行を許可したとき
      useCustomShaders.subscribe((state, prev) => {
        if (state.allowed !== prev.allowed) this.requestRender();
      }),
    );
    this.requestRender();
  }

  onRendered(listener: (items: ComposedItem[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  requestRender(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.renderNow();
    });
  }

  /** 今使う解像度の倍率 */
  private scaleFor(state: ReturnType<typeof getState>): number {
    if (state.previewQuality !== 'auto') return state.previewQuality;
    if (state.playing) return SCALES[this.autoLevel];
    // 止まっているときは等倍。ただしフル HD より大きなシーンはフル HD 程度に抑える
    const scene = currentScene(state);
    const limit = Math.sqrt(MAX_STILL_PIXELS / Math.max(1, scene.width * scene.height));
    return SCALES.find((s) => s <= limit + 1e-9) ?? SCALES[SCALES.length - 1];
  }

  /** 再生中の描画の間隔と処理時間から、自動の倍率を見直す */
  private adapt(state: ReturnType<typeof getState>, started: number, cost: number): void {
    if (!state.playing || state.previewQuality !== 'auto') {
      this.lastRenderAt = 0;
      this.intervals = [];
      this.costs = [];
      return;
    }
    if (this.lastRenderAt > 0) this.intervals.push(started - this.lastRenderAt);
    this.lastRenderAt = started;
    this.costs.push(cost);
    if (this.intervals.length < WINDOW) return;
    const budget = 1000 / fpsValue(state.project.settings.fps);
    const avg = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;
    const interval = avg(this.intervals);
    const work = avg(this.costs);
    if ((interval > budget * 1.3 || work > budget * 0.7) && this.autoLevel < SCALES.length - 1) {
      // 描画が間に合っていない
      this.autoLevel++;
    } else if (interval < budget * 1.1 && work < budget * 0.2 && this.autoLevel > 0) {
      // 十分に余裕がある
      this.autoLevel--;
    }
    this.intervals = [];
    this.costs = [];
  }

  renderNow(): void {
    const state = getState();
    const scene = currentScene(state);
    const started = performance.now();
    const scale = this.scaleFor(state);
    this.renderer.setSize(scene.width, scene.height, scale);
    const frame = this.compositor.compose(state.project, scene, state.playhead, this.media, scale);
    this.renderer.render(frame.ops, state.project.settings.backgroundColor);
    this.renderer.pruneTextures(frame.textureKeys);
    const cost = performance.now() - started;
    this.adapt(state, started, cost);
    usePreviewStats.setState({ scale, renderMs: cost });
    this.lastItems = frame.items;
    for (const l of this.listeners) l(frame.items);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    for (const d of this.disposers) d();
    this.renderer.dispose();
  }
}
