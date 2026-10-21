import { fpsValue } from '../../../core/model/time';
import { updateProjectSettings } from '../../../app/actions';
import { useEditor } from '../../../state/store';
import { closeDialog } from '../../../state/ui';
import { Dialog } from '../../common/Dialog';

export function ProjectSettingsDialog() {
  const settings = useEditor((s) => s.project.settings);
  return (
    <Dialog
      title="プロジェクトの設定"
      onClose={closeDialog}
      footer={
        <button type="button" onClick={closeDialog}>
          閉じる
        </button>
      }
    >
      <div className="form-grid">
        <span>解像度</span>
        <span>
          {settings.width} × {settings.height}
        </span>
        <span>フレームレート</span>
        <span>{Math.round(fpsValue(settings.fps) * 1000) / 1000} fps</span>
        <span>サンプリングレート</span>
        <span>{settings.sampleRate} Hz</span>
        <label htmlFor="ps-bg">背景色</label>
        <input
          id="ps-bg"
          type="color"
          value={settings.backgroundColor}
          onChange={(e) => updateProjectSettings({ backgroundColor: e.target.value })}
        />
      </div>
      <p className="hint">解像度とフレームレートは、新規作成時に設定します。</p>
    </Dialog>
  );
}
