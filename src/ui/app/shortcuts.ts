import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  jumpToEnd,
  jumpToStart,
  paste,
  selectAll,
  splitAtPlayhead,
  stepFrames,
} from '../../app/actions';
import { pickAndOpenProject, saveProject } from '../../app/projectFile';
import { fpsValue } from '../../core/model/time';
import { playback } from '../../engine/playback/Playback';
import { getState, redo, setSelection, undo } from '../../state/store';
import { openDialog, useUi } from '../../state/ui';

export const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'Space', label: '再生 / 停止' },
  { keys: '← / →', label: '1 フレーム戻る / 進む（Shift で 1 秒）' },
  { keys: 'Home / End', label: '先頭 / 末尾へ移動' },
  { keys: 'S', label: '再生位置で分割' },
  { keys: 'Delete', label: '選択したオブジェクトを削除' },
  { keys: 'Ctrl + Z / Ctrl + Y', label: '元に戻す / やり直し' },
  { keys: 'Ctrl + C / X / V', label: 'コピー / 切り取り / 貼り付け' },
  { keys: 'Ctrl + D', label: '複製' },
  { keys: 'Ctrl + A', label: 'すべて選択' },
  { keys: 'Ctrl + S', label: '上書き保存（Shift で名前を付けて保存）' },
  { keys: 'Ctrl + O', label: '編集ファイルを開く' },
  { keys: 'Ctrl + E', label: '書き出し' },
  { keys: 'Alt + ドラッグ', label: 'タイムラインで吸着せずに移動' },
  { keys: 'Ctrl + ホイール', label: 'タイムラインの拡大縮小' },
];

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'button', 'range', 'color'].includes(target.type);
  }
  return false;
}

export function handleShortcut(e: KeyboardEvent): void {
  if (useUi.getState().dialog || useUi.getState().contextMenu) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const code = e.code;

  // 入力中でも有効なもの
  if (ctrl && code === 'KeyS') {
    e.preventDefault();
    void saveProject({ saveAs: e.shiftKey });
    return;
  }
  if (ctrl && code === 'KeyO') {
    e.preventDefault();
    void pickAndOpenProject();
    return;
  }
  if (ctrl && code === 'KeyE') {
    e.preventDefault();
    openDialog({ type: 'export' });
    return;
  }
  if (isTyping(e.target)) return;

  const fps = fpsValue(getState().project.settings.fps);
  const handled = (() => {
    if (ctrl) {
      switch (code) {
        case 'KeyZ':
          if (e.shiftKey) redo();
          else undo();
          return true;
        case 'KeyY':
          redo();
          return true;
        case 'KeyC':
          copySelection();
          return true;
        case 'KeyX':
          cutSelection();
          return true;
        case 'KeyV':
          paste();
          return true;
        case 'KeyD':
          duplicateSelection();
          return true;
        case 'KeyA':
          selectAll();
          return true;
      }
      return false;
    }
    switch (code) {
      case 'Space':
        playback.toggle();
        return true;
      case 'ArrowLeft':
        playback.pause();
        stepFrames(e.shiftKey ? -Math.round(fps) : -1);
        return true;
      case 'ArrowRight':
        playback.pause();
        stepFrames(e.shiftKey ? Math.round(fps) : 1);
        return true;
      case 'Home':
        playback.pause();
        jumpToStart();
        return true;
      case 'End':
        playback.pause();
        jumpToEnd();
        return true;
      case 'KeyS':
        splitAtPlayhead();
        return true;
      case 'Delete':
      case 'Backspace':
        deleteSelection();
        return true;
      case 'Escape':
        setSelection([]);
        return true;
    }
    return false;
  })();
  if (handled) e.preventDefault();
}
