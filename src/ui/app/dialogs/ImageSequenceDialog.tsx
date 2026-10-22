import { useState } from 'react';
import { importImageSequence } from '../../../app/assets';
import { fpsValue } from '../../../core/model/time';
import { sortSequenceFiles } from '../../../engine/media/sequence';
import { useEditor } from '../../../state/store';
import { closeDialog } from '../../../state/ui';
import { Dialog } from '../../common/Dialog';
import { t } from '../../../i18n';

/** 連番画像を 1 本の動画として読み込む */
export function ImageSequenceDialog({ files }: { files: File[] }) {
  const projectFps = useEditor((s) => fpsValue(s.project.settings.fps));
  const [fps, setFps] = useState(Math.round(projectFps * 1000) / 1000);
  const sorted = sortSequenceFiles(files);
  const valid = fps >= 1 && fps <= 240;

  const start = () => {
    closeDialog();
    void importImageSequence(sorted, fps);
  };

  return (
    <Dialog
      title={t('連番画像の読み込み')}
      onClose={closeDialog}
      width={440}
      footer={
        <>
          <button type="button" onClick={closeDialog}>
            {t('キャンセル')}
          </button>
          <button type="button" className="primary" disabled={!valid} onClick={start}>
            {t('読み込む')}
          </button>
        </>
      }
    >
      <p>
        {t(
          '{0} 枚の画像を、名前の順に 1 本の動画（WebM）にまとめて素材に加えます。',
          sorted.length,
        )}
      </p>
      <p className="hint">
        {sorted[0]?.name} … {sorted[sorted.length - 1]?.name}
      </p>
      <div className="form-grid">
        <label htmlFor="seq-fps">{t('フレームレート')}</label>
        <span className="inline">
          <input
            id="seq-fps"
            type="number"
            min={1}
            max={240}
            step={0.001}
            value={fps}
            onChange={(e) => setFps(Number(e.target.value))}
          />
          fps
        </span>
      </div>
      <p className="hint">
        {t(
          '透明な部分のある画像は透明度も残します。まとめた動画はこのブラウザに保存され、次回も使えます（別の PC へ持っていくときは「素材ごと保存」を使ってください）。',
        )}
      </p>
    </Dialog>
  );
}
