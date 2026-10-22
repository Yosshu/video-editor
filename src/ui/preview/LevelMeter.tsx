import { useEffect, useRef } from 'react';
import { getPreviewAudioLevels } from '../../engine/preview/previewMediaInstance';
import { useEditor } from '../../state/store';
import { t } from '../../i18n';

/** 表示する範囲（dB） */
const MIN_DB = -60;
/** ピークの表示を保つ時間（ミリ秒） */
const HOLD_MS = 1000;

function toPercent(amplitude: number): number {
  if (amplitude <= 0) return 0;
  const db = 20 * Math.log10(amplitude);
  return Math.max(0, Math.min(100, ((db - MIN_DB) / -MIN_DB) * 100));
}

/**
 * 再生中の音量メーター（左右）。バーは実効値、細い線は直近のピーク、0dB を超えると赤く点灯する。
 * 毎フレーム描き換えるので、React の再描画を通さず直接スタイルを変える。
 */
export function LevelMeter() {
  const playing = useEditor((s) => s.playing);
  const bars = useRef<(HTMLDivElement | null)[]>([]);
  const peaks = useRef<(HTMLDivElement | null)[]>([]);
  const clips = useRef<(HTMLSpanElement | null)[]>([]);
  const clipped = useRef([false, false]);

  useEffect(() => {
    const hold = [
      { value: 0, at: 0 },
      { value: 0, at: 0 },
    ];
    let raf = 0;
    const draw = () => {
      const levels = getPreviewAudioLevels();
      const now = performance.now();
      for (let ch = 0; ch < 2; ch++) {
        const peak = playing && levels ? levels.peak[ch] : 0;
        const rms = playing && levels ? levels.rms[ch] : 0;
        if (peak >= hold[ch].value || now - hold[ch].at > HOLD_MS)
          hold[ch] = { value: peak, at: now };
        if (peak >= 1) clipped.current[ch] = true;
        const bar = bars.current[ch];
        const mark = peaks.current[ch];
        const clip = clips.current[ch];
        if (bar) bar.style.width = `${toPercent(rms * Math.SQRT2)}%`;
        if (mark) mark.style.left = `${toPercent(hold[ch].value)}%`;
        if (clip) clip.classList.toggle('on', clipped.current[ch]);
      }
      if (playing) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return (
    <div
      className="level-meter"
      title={t('音量（左・右）。赤いランプは音割れ（0dB 超え）、クリックで消灯')}
      onClick={() => {
        clipped.current = [false, false];
        clips.current.forEach((c) => c?.classList.remove('on'));
      }}
      data-testid="level-meter"
    >
      {['L', 'R'].map((label, ch) => (
        <div key={label} className="level-row">
          <span className="level-label">{label}</span>
          <div className="level-track">
            <div className="level-bar" ref={(el) => void (bars.current[ch] = el)} />
            <div className="level-peak" ref={(el) => void (peaks.current[ch] = el)} />
          </div>
          <span className="level-clip" ref={(el) => void (clips.current[ch] = el)} />
        </div>
      ))}
    </div>
  );
}
