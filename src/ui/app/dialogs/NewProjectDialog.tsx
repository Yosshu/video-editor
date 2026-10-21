import { useState } from 'react';
import { FPS_PRESETS } from '../../../core/model/time';
import { DEFAULT_SETTINGS, RESOLUTION_PRESETS } from '../../../core/project/factory';
import { newProject } from '../../../app/projectFile';
import { getState } from '../../../state/store';
import { closeDialog } from '../../../state/ui';
import { Dialog } from '../../common/Dialog';

export function NewProjectDialog() {
  const [width, setWidth] = useState(DEFAULT_SETTINGS.width);
  const [height, setHeight] = useState(DEFAULT_SETTINGS.height);
  const [fpsLabel, setFpsLabel] = useState('30');
  const [sampleRate, setSampleRate] = useState(DEFAULT_SETTINGS.sampleRate);
  const [background, setBackground] = useState(DEFAULT_SETTINGS.backgroundColor);

  const create = () => {
    if (
      getState().dirty &&
      !window.confirm('保存していない変更は失われます。新しいプロジェクトを作成しますか？')
    )
      return;
    const fps = FPS_PRESETS.find((p) => p.label === fpsLabel)?.fps ?? DEFAULT_SETTINGS.fps;
    newProject({
      width: Math.max(16, Math.round(width)),
      height: Math.max(16, Math.round(height)),
      fps,
      sampleRate,
      backgroundColor: background,
    });
    closeDialog();
  };

  return (
    <Dialog
      title="新しいプロジェクト"
      onClose={closeDialog}
      footer={
        <>
          <button type="button" onClick={closeDialog}>
            キャンセル
          </button>
          <button type="button" className="primary" onClick={create}>
            作成
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label htmlFor="np-preset">プリセット</label>
        <select
          id="np-preset"
          value={`${width}x${height}`}
          onChange={(e) => {
            const [w, h] = e.target.value.split('x').map(Number);
            if (w && h) {
              setWidth(w);
              setHeight(h);
            }
          }}
        >
          {RESOLUTION_PRESETS.map((p) => (
            <option key={p.label} value={`${p.width}x${p.height}`}>
              {p.label}
            </option>
          ))}
          {!RESOLUTION_PRESETS.some((p) => p.width === width && p.height === height) && (
            <option value={`${width}x${height}`}>カスタム</option>
          )}
        </select>
        <label htmlFor="np-width">幅 × 高さ</label>
        <div className="inline">
          <input
            id="np-width"
            type="number"
            min={16}
            max={8192}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
          <span>×</span>
          <input
            aria-label="高さ"
            type="number"
            min={16}
            max={8192}
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
          />
          <span>px</span>
        </div>
        <label htmlFor="np-fps">フレームレート</label>
        <select id="np-fps" value={fpsLabel} onChange={(e) => setFpsLabel(e.target.value)}>
          {FPS_PRESETS.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label} fps
            </option>
          ))}
        </select>
        <label htmlFor="np-rate">音声サンプリングレート</label>
        <select
          id="np-rate"
          value={sampleRate}
          onChange={(e) => setSampleRate(Number(e.target.value))}
        >
          <option value={44100}>44100 Hz</option>
          <option value={48000}>48000 Hz</option>
        </select>
        <label htmlFor="np-bg">背景色</label>
        <input
          id="np-bg"
          type="color"
          value={background}
          onChange={(e) => setBackground(e.target.value)}
        />
      </div>
    </Dialog>
  );
}
