import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  WebMOutputFormat,
  type AudioCodec,
  type QualityLevel,
  type StreamTargetChunk,
  type VideoCodec,
} from 'mediabunny';
import { fpsValue, framesToSeconds } from '../../core/model/time';
import type { Project, Scene } from '../../core/model/types';
import { mixScene } from '../audio/mixer';
import { AudioReaderPool } from '../audio/sources';
import { assetRegistry } from '../media/registry';
import type { ContainerFormat } from './codecs';
import { OfflineRenderer } from './offlineRenderer';
import { t } from '../../i18n';

export interface ExportOptions {
  format: ContainerFormat;
  videoCodec: VideoCodec;
  /** null なら音声なし */
  audioCodec: AudioCodec | null;
  width: number;
  height: number;
  quality: QualityLevel;
  /** 書き出す範囲（フレーム、終わりは含まない） */
  startFrame: number;
  endFrame: number;
}

export interface ExportProgress {
  done: number;
  total: number;
  elapsedMs: number;
}

/** 書き込み先：ファイルへ直接書く（File System Access API）か、メモリに作る */
export type ExportTarget =
  { kind: 'file'; writable: FileSystemWritableFileStream } | { kind: 'memory' };

/**
 * ファイルへの書き込み口。中止したときはファイルを確定させず（abort）、元のファイルを残す。
 */
function fileStream(
  file: FileSystemWritableFileStream,
  isCanceled: () => boolean,
): WritableStream<StreamTargetChunk> {
  return new WritableStream<StreamTargetChunk>({
    write: (chunk) => file.write({ type: 'write', data: chunk.data, position: chunk.position }),
    close: () => (isCanceled() ? file.abort() : file.close()),
    abort: (reason) => file.abort(reason),
  });
}

export class ExportCanceledError extends Error {}

/** 音声を何秒ずつミックスしてエンコーダーに渡すか */
const AUDIO_CHUNK_SEC = 1;

/**
 * シーンを動画ファイルに書き出す。memory の場合は Blob を返す。
 */
export async function exportVideo(
  project: Project,
  scene: Scene,
  options: ExportOptions,
  target: ExportTarget,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
): Promise<Blob | null> {
  const fps = project.settings.fps;
  const rate = fpsValue(fps);
  const total = Math.max(0, options.endFrame - options.startFrame);
  if (total === 0) throw new Error(t('書き出す範囲がありません。'));

  const format =
    options.format === 'mp4'
      ? new Mp4OutputFormat(
          target.kind === 'memory' ? { fastStart: 'in-memory' } : { fastStart: false },
        )
      : new WebMOutputFormat();
  let canceled = false;
  const bufferTarget = target.kind === 'memory' ? new BufferTarget() : null;
  const output = new Output({
    format,
    target:
      bufferTarget ??
      new StreamTarget(
        fileStream((target as { writable: FileSystemWritableFileStream }).writable, () => canceled),
        {
          chunked: true,
        },
      ),
  });

  const renderer = new OfflineRenderer(project, scene, options.width, options.height);
  const quality = new Quality(options.quality);
  const videoSource = new CanvasSource(renderer.canvas, {
    codec: options.videoCodec,
    quality,
    keyFrameInterval: 2,
  });
  output.addVideoTrack(videoSource, { frameRate: rate });

  let audioSource: AudioBufferSource | null = null;
  const audioPool = new AudioReaderPool(
    (id) => assetRegistry.getMedia(id),
    (id) => project.assets.find((a) => a.id === id)?.durationSec,
  );
  if (options.audioCodec) {
    audioSource = new AudioBufferSource({ codec: options.audioCodec, quality });
    output.addAudioTrack(audioSource);
  }

  const startSec = framesToSeconds(options.startFrame, fps);
  const durationSec = framesToSeconds(total, fps);
  const sampleRate = project.settings.sampleRate;
  let audioWritten = 0;
  const writeAudioUntil = async (untilSec: number) => {
    if (!audioSource) return;
    while (audioWritten < Math.min(untilSec, durationSec) - 1e-9) {
      const chunk = Math.min(AUDIO_CHUNK_SEC, durationSec - audioWritten);
      const samples = Math.max(1, Math.round(chunk * sampleRate));
      const [l, r] = await mixScene(project, scene, startSec + audioWritten, samples, audioPool);
      const buffer = new AudioBuffer({ length: samples, numberOfChannels: 2, sampleRate });
      buffer.copyToChannel(l, 0);
      buffer.copyToChannel(r, 1);
      await audioSource.add(buffer);
      audioWritten += samples / sampleRate;
    }
  };

  const started = performance.now();
  try {
    await renderer.init();
    await output.start();
    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw new ExportCanceledError(t('書き出しを中止しました。'));
      await renderer.render(options.startFrame + i);
      await videoSource.add(i / rate, 1 / rate);
      // 映像と音声を交互に書き込み、メモリにためすぎないようにする
      await writeAudioUntil((i + 1) / rate + AUDIO_CHUNK_SEC);
      onProgress({ done: i + 1, total, elapsedMs: performance.now() - started });
    }
    await writeAudioUntil(durationSec);
    await output.finalize();
    if (bufferTarget?.buffer) {
      return new Blob([bufferTarget.buffer], {
        type: options.format === 'mp4' ? 'video/mp4' : 'video/webm',
      });
    }
    return null;
  } catch (e) {
    canceled = true;
    await output.cancel().catch(() => undefined);
    throw e;
  } finally {
    renderer.dispose();
    audioPool.clear();
  }
}

/** 現在のフレームを PNG にする */
export async function renderStill(project: Project, scene: Scene, frame: number): Promise<Blob> {
  const renderer = new OfflineRenderer(project, scene, scene.width, scene.height);
  try {
    await renderer.init();
    await renderer.render(frame);
    return await renderer.canvas.convertToBlob({ type: 'image/png' });
  } finally {
    renderer.dispose();
  }
}
