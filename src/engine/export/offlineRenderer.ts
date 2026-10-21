import { evaluateFrame } from '../../core/evaluate/evaluate';
import type { Project, Scene } from '../../core/model/types';
import { Compositor, type MediaProvider } from '../compose';
import { assetRegistry } from '../media/registry';
import { Renderer } from '../render/Renderer';
import { ExactFramePool } from './exactFrames';

/**
 * 書き出し・静止画保存用の描画。動画フレームを正確にそろえてから 1 フレームずつ描く。
 */
export class OfflineRenderer {
  readonly canvas: OffscreenCanvas;
  private renderer: Renderer;
  private compositor = new Compositor();
  private frames = new ExactFramePool((id) => assetRegistry.getMedia(id));
  private media: MediaProvider;

  constructor(
    private project: Project,
    private scene: Scene,
    readonly width: number,
    readonly height: number,
  ) {
    this.canvas = new OffscreenCanvas(width, height);
    this.renderer = new Renderer(this.canvas);
    this.renderer.setSize(scene.width, scene.height, width / scene.width, { width, height });
    const durations = new Map(project.assets.map((a) => [a.id, a.durationSec]));
    this.media = {
      getImage: (id) => assetRegistry.getImage(id),
      getVideoFrame: (objectId) => this.frames.get(objectId),
      assetDuration: (id) => durations.get(id),
    };
  }

  async init(): Promise<void> {
    await this.compositor.loadFonts(this.scene);
  }

  async render(frame: number): Promise<void> {
    const { project, scene } = this;
    const items = evaluateFrame(scene, frame, {
      fps: project.settings.fps,
      assetDuration: (id) => this.media.assetDuration(id),
    });
    for (const item of items) {
      if (item.object.type === 'video' && item.object.assetId && item.sourceTime !== undefined) {
        await this.frames.prepare(item.object.id, item.object.assetId, item.sourceTime);
      }
    }
    const composed = this.compositor.compose(
      project,
      scene,
      frame,
      this.media,
      this.width / scene.width,
    );
    this.renderer.render(
      composed.map((c) => c.draw),
      project.settings.backgroundColor,
    );
    this.renderer.pruneTextures(new Set(composed.map((c) => c.draw.key)));
  }

  dispose(): void {
    this.frames.dispose();
    this.renderer.dispose();
  }
}
