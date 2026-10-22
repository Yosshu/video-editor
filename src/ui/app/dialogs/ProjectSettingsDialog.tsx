import { useState } from 'react';
import { updateProjectSettings } from '../../../app/actions';
import { FPS_PRESETS, fpsValue } from '../../../core/model/time';
import { RESOLUTION_PRESETS } from '../../../core/project/factory';
import { useEditor } from '../../../state/store';
import { closeDialog } from '../../../state/ui';
import { Dialog } from '../../common/Dialog';

/** プロジェクトの設定。解像度・フレームレート・サンプリングレートは「適用」で反映する */
export function ProjectSettingsDialog() {
  const settings = useEditor((s) => s.project.settings);
  const [width, setWidth] = useState(settings.width);
  const [height, setHeight] = useState(settings.height);
  const currentFps =
    FPS_PRESETS.find((p) => p.fps.num === settings.fps.num && p.fps.den === settings.fps.den)
      ?.label ?? 'current';
  const [fpsLabel, setFpsLabel] = useState(currentFps);
  const [sampleRate, setSampleRate] = useState(settings.sampleRate);

  const fps = FPS_PRESETS.find((p) => p.label === fpsLabel)?.fps ?? settings.fps;
  const fpsChanged = fps.num !== settings.fps.num || fps.den !== settings.fps.den;
  const changed =
    width !== settings.width ||
    height !== settings.height ||
    fpsChanged ||
    sampleRate !== settings.sampleRate;
  const valid = width >= 16 && width <= 8192 && height >= 16 && height <= 8192;

  const apply = () => {
    if (
      fpsChanged &&
      !window.confirm(
        'フレームレートを変えると、すべてのオブジェクトの位置と長さ・キーフレーム・マーカーを新しいフレームレートに換算します（元に戻すこともできます）。変更しますか？',
      )
    )
      return;
    updateProjectSettings({
      width: Math.round(width),
      height: Math.round(height),
      fps,
      sampleRate,
    });
    closeDialog();
  };

  return (
    <Dialog
      title="プロジェクトの設定"
      onClose={closeDialog}
      footer={
        <>
          <button type="button" onClick={closeDialog}>
            {changed ? 'キャンセル' : '閉じる'}
          </button>
          <button type="button" className="primary" disabled={!changed || !valid} onClick={apply}>
            適用
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label htmlFor="ps-preset">解像度</label>
        <select
          id="ps-preset"
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
        <label htmlFor="ps-width">幅 × 高さ</label>
        <div className="inline">
          <input
            id="ps-width"
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
        <label htmlFor="ps-fps">フレームレート</label>
        <select id="ps-fps" value={fpsLabel} onChange={(e) => setFpsLabel(e.target.value)}>
          {currentFps === 'current' && (
            <option value="current">
              {Math.round(fpsValue(settings.fps) * 1000) / 1000} fps（現在）
            </option>
          )}
          {FPS_PRESETS.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label} fps
            </option>
          ))}
        </select>
        <label htmlFor="ps-rate">音声サンプリングレート</label>
        <select
          id="ps-rate"
          value={sampleRate}
          onChange={(e) => setSampleRate(Number(e.target.value))}
        >
          <option value={44100}>44100 Hz</option>
          <option value={48000}>48000 Hz</option>
        </select>
        <label htmlFor="ps-bg">背景色</label>
        <input
          id="ps-bg"
          type="color"
          value={settings.backgroundColor}
          onChange={(e) => updateProjectSettings({ backgroundColor: e.target.value })}
        />
      </div>
      <p className="hint">
        解像度を変えても、オブジェクトの位置（画面の中央が原点）と大きさはそのままです。背景色はすぐに反映されます。
      </p>
    </Dialog>
  );
}
