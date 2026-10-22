import type { Draft } from 'immer';
import { newId } from '../core/model/ids';
import type { BeatGrid, Scene } from '../core/model/types';
import { neighborMarker } from '../core/timeline/markers';
import { commit, currentScene, getState, setPlayhead } from '../state/store';
import { t } from '../i18n';

function editScene(label: string, fn: (scene: Draft<Scene>) => void, mergeKey?: string): void {
  const { sceneId } = getState();
  commit(
    label,
    (draft) => {
      const s = draft.scenes.find((x) => x.id === sceneId);
      if (s) fn(s);
    },
    { mergeKey },
  );
}

/** マーカーを追加する（同じ位置にあれば何もしない） */
export function addMarker(frame: number, label?: string): void {
  const f = Math.max(0, Math.round(frame));
  if (currentScene().markers?.some((m) => m.frame === f)) return;
  editScene(t('マーカーの追加'), (s) => {
    s.markers ??= [];
    s.markers.push({ id: newId('mk'), frame: f, ...(label ? { label } : {}) });
    s.markers.sort((a, b) => a.frame - b.frame);
  });
}

export function addMarkerAtPlayhead(): void {
  addMarker(getState().playhead);
}

export function moveMarker(id: string, frame: number): void {
  editScene(t('マーカーの移動'), (s) => {
    const m = s.markers?.find((x) => x.id === id);
    if (!m) return;
    m.frame = Math.max(0, Math.round(frame));
    s.markers!.sort((a, b) => a.frame - b.frame);
  });
}

export function updateMarker(id: string, patch: { label?: string; color?: string }): void {
  editScene(t('マーカーの変更'), (s) => {
    const m = s.markers?.find((x) => x.id === id);
    if (!m) return;
    if (patch.label !== undefined) {
      if (patch.label) m.label = patch.label;
      else delete m.label;
    }
    if (patch.color !== undefined) m.color = patch.color;
  });
}

export function removeMarker(id: string): void {
  editScene(t('マーカーの削除'), (s) => {
    s.markers = s.markers?.filter((m) => m.id !== id);
    if (s.markers?.length === 0) delete s.markers;
  });
}

/** 前後のマーカーへ移動する */
export function jumpToMarker(direction: -1 | 1): void {
  const m = neighborMarker(currentScene().markers, getState().playhead, direction);
  if (m) setPlayhead(m.frame);
}

/** BPM グリッドを変更する（null で削除） */
export function setBeatGrid(grid: BeatGrid | null): void {
  editScene(
    t('BPM グリッドの変更'),
    (s) => {
      if (grid) s.beatGrid = grid;
      else delete s.beatGrid;
    },
    'beatGrid',
  );
}
