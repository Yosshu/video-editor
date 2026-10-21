import { useEffect, useRef } from 'react';
import type { Peaks } from '../../engine/audio/waveform';

interface Props {
  peaks: Peaks;
  /** 表示する素材内の区間（秒） */
  offset: number;
  duration: number;
  speed: number;
  loop: boolean;
  assetDuration: number;
  width: number;
  height: number;
}

const MAX_CANVAS = 4096;

/** オブジェクトの中に音声波形を描く */
export function Waveform({
  peaks,
  offset,
  duration,
  speed,
  loop,
  assetDuration,
  width,
  height,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = Math.max(1, Math.min(MAX_CANVAS, Math.round(width)));

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = w;
    canvas.height = height;
    ctx.clearRect(0, 0, w, height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    const mid = height / 2;
    const span = duration * speed;
    for (let x = 0; x < w; x++) {
      let a = offset + (x / w) * span;
      let b = offset + ((x + 1) / w) * span;
      if (loop && assetDuration > 0) {
        a %= assetDuration;
        b = a + span / w;
      }
      const i0 = Math.floor(a * peaks.rate);
      const i1 = Math.max(i0 + 1, Math.ceil(b * peaks.rate));
      let v = 0;
      for (let i = i0; i < i1 && i < peaks.data.length; i++) v = Math.max(v, peaks.data[i]);
      const h = Math.min(1, v) * mid;
      if (h > 0.2) ctx.fillRect(x, mid - h, 1, h * 2);
    }
  }, [peaks, offset, duration, speed, loop, assetDuration, w, height]);

  return <canvas ref={ref} className="tl-waveform" style={{ width: '100%', height }} />;
}
