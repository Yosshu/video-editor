import { secondsToFrames } from '../core/model/time';
import type { TimelineObject } from '../core/model/types';
import { createObject } from '../core/project/factory';
import { parseSubtitles, type SubtitleCue } from '../core/subtitles/subtitles';
import { hasCollision, MAX_LAYERS } from '../core/timeline/ops';
import { commit, currentScene, getState, notify, setSelection } from '../state/store';
import { t } from '../i18n';

/**
 * 字幕ファイルを読み、字幕 1 つごとにテキストオブジェクトを作る。
 * frame の位置を字幕の 0 秒とし、layer から順に空いているレイヤーへ置く（重なる字幕は下のレイヤーへ）。
 * 戻り値は作ったオブジェクトの数
 */
export async function importSubtitles(file: File, layer: number, frame: number): Promise<number> {
  let cues: SubtitleCue[];
  try {
    cues = parseSubtitles(await file.text());
  } catch {
    cues = [];
  }
  if (cues.length === 0) {
    notify(t('「{0}」から字幕を読み取れませんでした。', file.name), 'error');
    return 0;
  }
  const state = getState();
  const scene = currentScene(state);
  const fps = state.project.settings.fps;
  const locked = new Set(scene.layers.filter((l) => l.locked).map((l) => l.index));
  // 画面の下のほうに、縁取り付きの文字で置く
  const size = Math.max(12, Math.round(scene.height * 0.05));
  const style = {
    size,
    y: Math.round(scene.height / 2 - scene.height * 0.1),
    outlineWidth: Math.max(1, Math.round(size / 12)),
  };
  const placed: TimelineObject[] = [];
  let skipped = 0;
  for (const cue of cues) {
    const start = frame + secondsToFrames(cue.start, fps);
    const length = Math.max(1, frame + secondsToFrames(cue.end, fps) - start);
    const all = [...scene.objects, ...placed];
    let target = 0;
    for (let l = layer; l <= MAX_LAYERS; l++) {
      if (!locked.has(l) && !hasCollision(all, l, start, length, new Set())) {
        target = l;
        break;
      }
    }
    if (!target) {
      skipped++;
      continue;
    }
    placed.push(
      createObject('text', target, start, length, { params: { ...style, text: cue.text } }),
    );
  }
  if (placed.length > 0) {
    commit(t('字幕の読み込み'), (draft) => {
      draft.scenes.find((s) => s.id === state.sceneId)?.objects.push(...placed);
    });
    setSelection(placed.map((o) => o.id));
  }
  if (skipped > 0) {
    notify(t('空いているレイヤーがないため、{0} 個の字幕を置けませんでした。', skipped), 'error');
  } else {
    notify(t('{0} 個の字幕を読み込みました。', placed.length));
  }
  return placed.length;
}
