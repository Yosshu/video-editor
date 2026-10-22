import { setBeatGrid } from '../../../app/markerActions';
import { framesToSeconds, secondsToFrames } from '../../../core/model/time';
import { DEFAULT_BEAT_GRID } from '../../../core/timeline/markers';
import { currentScene, useEditor } from '../../../state/store';
import { closeDialog } from '../../../state/ui';
import { Dialog } from '../../common/Dialog';

/** BPM グリッドの設定（変更はすぐにタイムラインへ反映する） */
export function BeatGridDialog() {
  const grid = useEditor((s) => currentScene(s).beatGrid);
  const fps = useEditor((s) => s.project.settings.fps);
  const playhead = useEditor((s) => s.playhead);
  const current = grid ?? { ...DEFAULT_BEAT_GRID, visible: false };
  const update = (patch: Partial<typeof current>) => setBeatGrid({ ...current, ...patch });

  return (
    <Dialog
      title="BPM グリッド"
      onClose={closeDialog}
      width={420}
      footer={
        <>
          {grid && (
            <button type="button" onClick={() => setBeatGrid(null)}>
              グリッドを削除
            </button>
          )}
          <button type="button" onClick={closeDialog}>
            閉じる
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label htmlFor="bg-visible">表示</label>
        <label className="inline">
          <input
            id="bg-visible"
            type="checkbox"
            checked={current.visible}
            onChange={(e) => update({ visible: e.target.checked })}
          />
          タイムラインに拍の線を表示し、拍に吸着する
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
        <label htmlFor="bg-beats">1 小節の拍数</label>
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
        <label htmlFor="bg-offset">1 拍目の位置</label>
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
          秒
          <button type="button" onClick={() => update({ offset: playhead })}>
            再生位置にする
          </button>
        </span>
      </div>
      <p className="hint">
        曲の BPM を入れると、拍と小節の頭に線が引かれます。オブジェクトを動かすと拍に吸着します。
      </p>
    </Dialog>
  );
}
