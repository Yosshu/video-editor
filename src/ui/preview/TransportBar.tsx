import { jumpToEnd, jumpToStart, stepFrames } from '../../app/actions';
import { formatTimecode } from '../../core/model/time';
import { sceneDuration } from '../../core/timeline/ops';
import { playback } from '../../engine/playback/Playback';
import { currentScene, useEditor, type PreviewQuality } from '../../state/store';
import { useUi } from '../../state/ui';
import { togglePreviewFullscreen } from './fullscreen';
import { LevelMeter } from './LevelMeter';
import { t } from '../../i18n';

interface Props {
  quality: PreviewQuality;
  onQuality: (q: PreviewQuality) => void;
}

export function TransportBar({ quality, onQuality }: Props) {
  const playing = useEditor((s) => s.playing);
  const guides = useUi((s) => s.previewGuides);
  const timecode = useEditor((s) => formatTimecode(s.playhead, s.project.settings.fps));
  const total = useEditor((s) =>
    formatTimecode(sceneDuration(currentScene(s)), s.project.settings.fps),
  );

  const step = (fn: () => void) => () => {
    playback.pause();
    fn();
  };

  return (
    <div className="transport">
      <button
        type="button"
        className="icon-button"
        onClick={step(jumpToStart)}
        aria-label={t('先頭へ')}
        title={t('先頭へ（Home）')}
      >
        ⏮
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={step(() => stepFrames(-1))}
        aria-label={t('1フレーム戻る')}
        title={t('1フレーム戻る（←）')}
      >
        ◀︎
      </button>
      <button
        type="button"
        className="icon-button play-button"
        onClick={() => playback.toggle()}
        aria-label={playing ? t('停止') : t('再生')}
        title={t('再生 / 停止（Space）')}
      >
        {playing ? '⏸' : '▶︎'}
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={step(() => stepFrames(1))}
        aria-label={t('1フレーム進む')}
        title={t('1フレーム進む（→）')}
      >
        ▶︎|
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={step(jumpToEnd)}
        aria-label={t('末尾へ')}
        title={t('末尾へ（End）')}
      >
        ⏭
      </button>
      <span className="timecode" data-testid="timecode">
        {timecode} / {total}
      </span>
      <LevelMeter />
      <span className="guide-toggles">
        <label title={t('三分割線と中心を表示')}>
          <input
            type="checkbox"
            checked={guides.grid}
            onChange={(e) =>
              useUi.setState({ previewGuides: { ...guides, grid: e.target.checked } })
            }
          />
          {t('グリッド')}
        </label>
        <label title={t('テロップを収める目安の枠を表示')}>
          <input
            type="checkbox"
            checked={guides.safeArea}
            onChange={(e) =>
              useUi.setState({ previewGuides: { ...guides, safeArea: e.target.checked } })
            }
          />
          {t('セーフエリア')}
        </label>
      </span>
      <label className="quality">
        {t('画質')}
        <select
          value={quality}
          onChange={(e) => onQuality(Number(e.target.value) as PreviewQuality)}
        >
          <option value={1}>{t('等倍')}</option>
          <option value={0.5}>1/2</option>
          <option value={0.25}>1/4</option>
        </select>
      </label>
      <button
        type="button"
        className="icon-button"
        onClick={() => void togglePreviewFullscreen()}
        aria-label={t('全画面表示')}
        title={t('全画面表示の切り替え（F）')}
      >
        ⛶
      </button>
    </div>
  );
}
