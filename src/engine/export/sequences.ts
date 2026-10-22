import { fpsValue } from '../../core/model/time';
import type { Project, Scene } from '../../core/model/types';
import { ZipWriter, type ZipSink } from '../../storage/zip';
import { ExportCanceledError, type ExportProgress } from './exporter';
import { GifEncoder, gifDelays } from './gif';
import { OfflineRenderer } from './offlineRenderer';
import { t } from '../../i18n';

export interface ImageSequenceOptions {
  width: number;
  height: number;
  /** 書き出す範囲（フレーム、終わりは含まない） */
  startFrame: number;
  endFrame: number;
  /** 背景を透明にする */
  transparent: boolean;
}

/** 描画結果の画素を読むための 2D キャンバス */
function pixelReader(width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return (source: OffscreenCanvas) => {
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0);
    return ctx.getImageData(0, 0, width, height).data;
  };
}

/**
 * アニメーション GIF を書き出す。fps は GIF のコマの速さ（プロジェクトより遅くするとコマを間引く）
 */
export async function exportGif(
  project: Project,
  scene: Scene,
  options: ImageSequenceOptions & { fps: number },
  write: (data: Uint8Array) => Promise<void>,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
): Promise<void> {
  const projectFps = fpsValue(project.settings.fps);
  const seconds = (options.endFrame - options.startFrame) / projectFps;
  const total = Math.max(1, Math.round(seconds * options.fps));
  const delays = gifDelays(total, options.fps);
  const renderer = new OfflineRenderer(
    project,
    scene,
    options.width,
    options.height,
    options.transparent,
  );
  const read = pixelReader(options.width, options.height);
  const encoder = new GifEncoder({
    width: options.width,
    height: options.height,
    transparent: options.transparent,
  });
  const started = performance.now();
  try {
    await renderer.init();
    await write(encoder.header());
    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw new ExportCanceledError(t('書き出しを中止しました。'));
      const frame = Math.min(
        options.endFrame - 1,
        options.startFrame + Math.floor((i * projectFps) / options.fps + 1e-6),
      );
      await renderer.render(frame);
      await write(encoder.frame(read(renderer.canvas), delays[i]));
      onProgress({ done: i + 1, total, elapsedMs: performance.now() - started });
      // 画面の更新や中止の操作を受け付けられるよう、ときどき処理を譲る
      await new Promise((r) => setTimeout(r, 0));
    }
    await write(encoder.trailer());
  } finally {
    renderer.dispose();
  }
}

/** 連番 PNG を ZIP にまとめて書き出す（name_00001.png のような名前にする） */
export async function exportPngSequence(
  project: Project,
  scene: Scene,
  options: ImageSequenceOptions & { baseName: string },
  sink: ZipSink,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
): Promise<void> {
  const total = Math.max(0, options.endFrame - options.startFrame);
  const digits = Math.max(5, String(options.endFrame).length);
  const renderer = new OfflineRenderer(
    project,
    scene,
    options.width,
    options.height,
    options.transparent,
  );
  const zip = new ZipWriter(sink);
  const started = performance.now();
  try {
    await renderer.init();
    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw new ExportCanceledError(t('書き出しを中止しました。'));
      const frame = options.startFrame + i;
      await renderer.render(frame);
      const png = await renderer.canvas.convertToBlob({ type: 'image/png' });
      await zip.add(`${options.baseName}_${String(frame).padStart(digits, '0')}.png`, png);
      onProgress({ done: i + 1, total, elapsedMs: performance.now() - started });
    }
    await zip.finish();
  } finally {
    renderer.dispose();
  }
}
