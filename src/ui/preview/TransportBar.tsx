import { jumpToEnd, jumpToStart, stepFrames } from '../../app/actions';
import { formatTimecode } from '../../core/model/time';
import { sceneDuration } from '../../core/timeline/ops';
import { playback } from '../../engine/playback/Playback';
import { currentScene, useEditor, type PreviewQuality } from '../../state/store';

interface Props {
  quality: PreviewQuality;
  onQuality: (q: PreviewQuality) => void;
}

export function TransportBar({ quality, onQuality }: Props) {
  const playing = useEditor((s) => s.playing);
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
        aria-label="先頭へ"
        title="先頭へ（Home）"
      >
        ⏮
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={step(() => stepFrames(-1))}
        aria-label="1フレーム戻る"
        title="1フレーム戻る（←）"
      >
        ◀︎
      </button>
      <button
        type="button"
        className="icon-button play-button"
        onClick={() => playback.toggle()}
        aria-label={playing ? '停止' : '再生'}
        title="再生 / 停止（Space）"
      >
        {playing ? '⏸' : '▶︎'}
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={step(() => stepFrames(1))}
        aria-label="1フレーム進む"
        title="1フレーム進む（→）"
      >
        ▶︎|
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={step(jumpToEnd)}
        aria-label="末尾へ"
        title="末尾へ（End）"
      >
        ⏭
      </button>
      <span className="timecode" data-testid="timecode">
        {timecode} / {total}
      </span>
      <label className="quality">
        画質
        <select
          value={quality}
          onChange={(e) => onQuality(Number(e.target.value) as PreviewQuality)}
        >
          <option value={1}>等倍</option>
          <option value={0.5}>1/2</option>
          <option value={0.25}>1/4</option>
        </select>
      </label>
    </div>
  );
}
