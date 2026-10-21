import { framesToSeconds } from '../../core/model/time';
import type { Project, Scene } from '../../core/model/types';
import { mixScene } from '../audio/mixer';
import { AudioReaderPool } from '../audio/sources';
import { assetRegistry } from '../media/registry';
import { ExportCanceledError, type ExportProgress } from './exporter';

const CHUNK_SEC = 1;

/** 16bit ステレオの WAV ヘッダー */
export function wavHeader(numSamples: number, sampleRate: number): Uint8Array {
  const channels = 2;
  const bytesPerSample = 2;
  const dataSize = numSamples * channels * bytesPerSample;
  const buf = new ArrayBuffer(44);
  const v = new DataView(buf);
  const str = (o: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * bytesPerSample, true);
  v.setUint16(32, channels * bytesPerSample, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataSize, true);
  return new Uint8Array(buf);
}

/** 左右の Float32 を 16bit のインターリーブに変換する（はみ出しは切り詰める） */
export function toInt16Interleaved(l: Float32Array, r: Float32Array): Uint8Array {
  const out = new Int16Array(l.length * 2);
  for (let i = 0; i < l.length; i++) {
    out[i * 2] = Math.max(-32768, Math.min(32767, Math.round(l[i] * 32767)));
    out[i * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(r[i] * 32767)));
  }
  return new Uint8Array(out.buffer);
}

/**
 * シーンの音声を WAV（16bit ステレオ）にする。write には先頭から順にデータが渡される。
 */
export async function exportWav(
  project: Project,
  scene: Scene,
  startFrame: number,
  endFrame: number,
  write: (data: Uint8Array) => Promise<void>,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
): Promise<void> {
  const fps = project.settings.fps;
  const sr = project.settings.sampleRate;
  const start = framesToSeconds(startFrame, fps);
  const duration = framesToSeconds(endFrame - startFrame, fps);
  const totalSamples = Math.round(duration * sr);
  const pool = new AudioReaderPool(
    (id) => assetRegistry.getMedia(id),
    (id) => project.assets.find((a) => a.id === id)?.durationSec,
  );
  const started = performance.now();
  try {
    await write(wavHeader(totalSamples, sr));
    let done = 0;
    while (done < totalSamples) {
      if (signal.aborted) throw new ExportCanceledError('書き出しを中止しました。');
      const n = Math.min(Math.round(CHUNK_SEC * sr), totalSamples - done);
      const [l, r] = await mixScene(project, scene, start + done / sr, n, pool);
      await write(toInt16Interleaved(l, r));
      done += n;
      onProgress({ done, total: totalSamples, elapsedMs: performance.now() - started });
    }
  } finally {
    pool.clear();
  }
}
