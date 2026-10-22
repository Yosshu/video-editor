import { Compositor, type ComposedItem, type MediaProvider } from '../compose';
import { Renderer } from '../render/Renderer';
import { currentScene, getState, useEditor } from '../../state/store';
import { assetRegistry } from '../media/registry';
import { useCustomShaders } from '../effects/customShader';
import { onPreviewFrameReady } from './previewMediaInstance';

/**
 * プレビュー画面の描画。状態が変わったら次のアニメーションフレームでまとめて描き直す。
 */
export class PreviewEngine {
  private renderer: Renderer;
  private compositor = new Compositor();
  private raf = 0;
  private disposers: (() => void)[] = [];
  private listeners = new Set<(items: ComposedItem[]) => void>();
  /** 直近に描画したオブジェクト（プレビュー上の選択・ドラッグ用） */
  lastItems: ComposedItem[] = [];

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

  renderNow(): void {
    const state = getState();
    const scene = currentScene(state);
    this.renderer.setSize(scene.width, scene.height, state.previewQuality);
    const frame = this.compositor.compose(
      state.project,
      scene,
      state.playhead,
      this.media,
      state.previewQuality,
    );
    this.renderer.render(frame.ops, state.project.settings.backgroundColor);
    this.renderer.pruneTextures(frame.textureKeys);
    this.lastItems = frame.items;
    for (const l of this.listeners) l(frame.items);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    for (const d of this.disposers) d();
    this.renderer.dispose();
  }
}
