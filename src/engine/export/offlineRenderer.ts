import type { Project, Scene } from '../../core/model/types';
import { Compositor, type MediaProvider } from '../compose';
import { loadPeaks, type Peaks } from '../audio/waveform';
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
  /** 描画の前に、必要な動画フレームを集めるときの記録先 */
  private requests: { key: string; assetId: string; time: number }[] | null = null;
  private peaks = new Map<string, Peaks | null>();

  constructor(
    private project: Project,
    private scene: Scene,
    readonly width: number,
    readonly height: number,
    /** 背景を透明にする */
    private transparent = false,
  ) {
    this.canvas = new OffscreenCanvas(width, height);
    this.renderer = new Renderer(this.canvas, { alpha: transparent });
    this.renderer.setSize(scene.width, scene.height, width / scene.width, { width, height });
    const durations = new Map(project.assets.map((a) => [a.id, a.durationSec]));
    this.media = {
      getImage: (id, time) => assetRegistry.getImage(id, time),
      getVideoFrame: (key, assetId, time) => {
        this.requests?.push({ key, assetId, time });
        return this.frames.get(key);
      },
      assetDuration: (id) => durations.get(id),
      getPeaks: (id) => this.peaks.get(id) ?? undefined,
    };
  }

  async init(): Promise<void> {
    await this.compositor.loadFonts(this.project);
    // 音声波形オブジェクトがあれば、音声・動画素材の波形データを先に計算しておく
    const hasWave = this.project.scenes.some((s) => s.objects.some((o) => o.type === 'audioWave'));
    if (!hasWave) return;
    const ids = new Set(
      this.project.scenes.flatMap((s) =>
        s.objects.filter((o) => o.type === 'audio' || o.type === 'video').map((o) => o.assetId),
      ),
    );
    for (const id of ids) if (id) this.peaks.set(id, await loadPeaks(id));
  }

  async render(frame: number): Promise<void> {
    const { project, scene } = this;
    const scale = this.width / scene.width;
    // 1 回目は必要な動画フレームを集めるだけ（入れ子のシーンの中も含む）
    this.requests = [];
    this.compositor.compose(project, scene, frame, this.media, scale);
    const requests = this.requests;
    this.requests = null;
    for (const r of requests) await this.frames.prepare(r.key, r.assetId, r.time);
    const composed = this.compositor.compose(project, scene, frame, this.media, scale);
    this.renderer.render(composed.ops, this.transparent ? null : project.settings.backgroundColor);
    this.renderer.pruneTextures(composed.textureKeys);
  }

  dispose(): void {
    this.frames.dispose();
    this.renderer.dispose();
  }
}
