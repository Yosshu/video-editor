import { setBeatGrid } from '../../../app/markerActions';
import { framesToSeconds, secondsToFrames } from '../../../core/model/time';
import { DEFAULT_BEAT_GRID } from '../../../core/timeline/markers';
import { currentScene, useEditor } from '../../../state/store';
import { closeDialog } from '../../../state/ui';
import { Dialog } from '../../common/Dialog';
import { t } from '../../../i18n';

/** BPM グリッドの設定（変更はすぐにタイムラインへ反映する） */
export function BeatGridDialog() {
  const grid = useEditor((s) => currentScene(s).beatGrid);
  const fps = useEditor((s) => s.project.settings.fps);
  const playhead = useEditor((s) => s.playhead);
  const current = grid ?? { ...DEFAULT_BEAT_GRID, visible: false };
  const update = (patch: Partial<typeof current>) => setBeatGrid({ ...current, ...patch });

  return (
    <Dialog
      title={t('BPM グリッド')}
      onClose={closeDialog}
      width={420}
      footer={
        <>
          {grid && (
            <button type="button" onClick={() => setBeatGrid(null)}>
              {t('グリッドを削除')}
            </button>
          )}
          <button type="button" onClick={closeDialog}>
            {t('閉じる')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label htmlFor="bg-visible">{t('表示')}</label>
        <label className="inline">
          <input
            id="bg-visible"
            type="checkbox"
            checked={current.visible}
            onChange={(e) => update({ visible: e.target.checked })}
          />
          {t('タイムラインに拍の線を表示し、拍に吸着する')}
        </label>
        <label htmlFor="bg-bpm">BPM</label>
        <input
          id="bg-bpm"
          type="number"
          min={1}
          max={1000}
          step={0.01}
          value={current.bpm}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v >= 1 && v <= 1000) update({ bpm: v });
          }}
        />
        <label htmlFor="bg-beats">{t('1 小節の拍数')}</label>
        <input
          id="bg-beats"
          type="number"
          min={1}
          max={64}
          step={1}
          value={current.beatsPerBar}
          onChange={(e) => {
            const v = Math.round(Number(e.target.value));
            if (v >= 1 && v <= 64) update({ beatsPerBar: v });
          }}
        />
        <label htmlFor="bg-offset">{t('1 拍目の位置')}</label>
        <span className="inline">
          <input
            id="bg-offset"
            type="number"
            step={0.01}
            value={Math.round(framesToSeconds(current.offset, fps) * 1000) / 1000}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) update({ offset: secondsToFrames(v, fps) });
            }}
          />
          {t('秒')}
          <button type="button" onClick={() => update({ offset: playhead })}>
            {t('再生位置にする')}
          </button>
        </span>
      </div>
      <p className="hint">
        {t(
          '曲の BPM を入れると、拍と小節の頭に線が引かれます。オブジェクトを動かすと拍に吸着します。',
        )}
      </p>
    </Dialog>
  );
}
