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
import { addMarkerAtPlayhead, jumpToMarker } from '../../app/markerActions';
import { pickAndOpenProject, saveProject } from '../../app/projectFile';
import { rippleDeleteSelection } from '../../app/timelineActions';
import { fpsValue } from '../../core/model/time';
import { playback } from '../../engine/playback/Playback';
import { useKeymap } from '../../state/keymap';
import { getState, redo, setSelection, undo } from '../../state/store';
import { openDialog, useUi } from '../../state/ui';
import { togglePreviewFullscreen } from '../preview/fullscreen';
import { zoomTimeline } from '../timeline/zoom';
import { t } from '../../i18n';

/**
 * キーボードで実行できるコマンド。キーは「Ctrl+Shift+KeyS」のように、修飾キー（Ctrl・Alt・Shift の順）と
 * KeyboardEvent.code を + でつないだ文字列で表す（Mac の Command は Ctrl と同じに扱う）。
 */
export interface Command {
  id: string;
  label: string;
  group: string;
  defaultKeys: string[];
  run: () => void;
  /** 文字の入力中でも実行する */
  whileTyping?: boolean;
}

const pausing = (fn: () => void) => () => {
  playback.pause();
  fn();
};

const second = () => Math.round(fpsValue(getState().project.settings.fps));

export const COMMANDS: Command[] = [
  {
    id: 'play',
    label: '再生 / 停止',
    group: '再生',
    defaultKeys: ['Space'],
    run: () => playback.toggle(),
  },
  {
    id: 'stepBack',
    label: '1 フレーム戻る',
    group: '再生',
    defaultKeys: ['ArrowLeft'],
    run: pausing(() => stepFrames(-1)),
  },
  {
    id: 'stepForward',
    label: '1 フレーム進む',
    group: '再生',
    defaultKeys: ['ArrowRight'],
    run: pausing(() => stepFrames(1)),
  },
  {
    id: 'stepBackSecond',
    label: '1 秒戻る',
    group: '再生',
    defaultKeys: ['Shift+ArrowLeft'],
    run: pausing(() => stepFrames(-second())),
  },
  {
    id: 'stepForwardSecond',
    label: '1 秒進む',
    group: '再生',
    defaultKeys: ['Shift+ArrowRight'],
    run: pausing(() => stepFrames(second())),
  },
  {
    id: 'jumpStart',
    label: '先頭へ移動',
    group: '再生',
    defaultKeys: ['Home'],
    run: pausing(jumpToStart),
  },
  {
    id: 'jumpEnd',
    label: '末尾へ移動',
    group: '再生',
    defaultKeys: ['End'],
    run: pausing(jumpToEnd),
  },
  {
    id: 'prevMarker',
    label: '前のマーカーへ移動',
    group: '再生',
    defaultKeys: ['Ctrl+ArrowLeft'],
    run: pausing(() => jumpToMarker(-1)),
  },
  {
    id: 'nextMarker',
    label: '次のマーカーへ移動',
    group: '再生',
    defaultKeys: ['Ctrl+ArrowRight'],
    run: pausing(() => jumpToMarker(1)),
  },
  {
    id: 'fullscreen',
    label: 'プレビューの全画面表示',
    group: '再生',
    defaultKeys: ['KeyF'],
    run: () => void togglePreviewFullscreen(),
  },

  {
    id: 'split',
    label: '再生位置で分割',
    group: '編集',
    defaultKeys: ['KeyS'],
    run: splitAtPlayhead,
  },
  {
    id: 'addMarker',
    label: '再生位置にマーカーを追加',
    group: '編集',
    defaultKeys: ['KeyM'],
    run: addMarkerAtPlayhead,
  },
  {
    id: 'delete',
    label: '選択したオブジェクトを削除',
    group: '編集',
    defaultKeys: ['Delete', 'Backspace'],
    run: deleteSelection,
  },
  {
    id: 'rippleDelete',
    label: '削除して後ろを詰める',
    group: '編集',
    defaultKeys: ['Shift+Delete', 'Shift+Backspace'],
    run: rippleDeleteSelection,
  },
  { id: 'undo', label: '元に戻す', group: '編集', defaultKeys: ['Ctrl+KeyZ'], run: undo },
  {
    id: 'redo',
    label: 'やり直し',
    group: '編集',
    defaultKeys: ['Ctrl+KeyY', 'Ctrl+Shift+KeyZ'],
    run: redo,
  },
  { id: 'copy', label: 'コピー', group: '編集', defaultKeys: ['Ctrl+KeyC'], run: copySelection },
  { id: 'cut', label: '切り取り', group: '編集', defaultKeys: ['Ctrl+KeyX'], run: cutSelection },
  { id: 'paste', label: '貼り付け', group: '編集', defaultKeys: ['Ctrl+KeyV'], run: paste },
  {
    id: 'duplicate',
    label: '複製',
    group: '編集',
    defaultKeys: ['Ctrl+KeyD'],
    run: duplicateSelection,
  },
  {
    id: 'selectAll',
    label: 'すべて選択',
    group: '編集',
    defaultKeys: ['Ctrl+KeyA'],
    run: selectAll,
  },
  {
    id: 'deselect',
    label: '選択を解除',
    group: '編集',
    defaultKeys: ['Escape'],
    run: () => setSelection([]),
  },
  {
    id: 'zoomIn',
    label: 'タイムラインを拡大',
    group: '編集',
    defaultKeys: ['Equal', 'NumpadAdd'],
    run: () => zoomTimeline(1.25),
  },
  {
    id: 'zoomOut',
    label: 'タイムラインを縮小',
    group: '編集',
    defaultKeys: ['Minus', 'NumpadSubtract'],
    run: () => zoomTimeline(0.8),
  },

  {
    id: 'save',
    label: '上書き保存',
    group: 'ファイル',
    defaultKeys: ['Ctrl+KeyS'],
    run: () => void saveProject(),
    whileTyping: true,
  },
  {
    id: 'saveAs',
    label: '名前を付けて保存',
    group: 'ファイル',
    defaultKeys: ['Ctrl+Shift+KeyS'],
    run: () => void saveProject({ saveAs: true }),
    whileTyping: true,
  },
  {
    id: 'open',
    label: '編集ファイルを開く',
    group: 'ファイル',
    defaultKeys: ['Ctrl+KeyO'],
    run: () => void pickAndOpenProject(),
    whileTyping: true,
  },
  {
    id: 'export',
    label: '書き出し',
    group: 'ファイル',
    defaultKeys: ['Ctrl+KeyE'],
    run: () => openDialog({ type: 'export' }),
    whileTyping: true,
  },
];

/** マウス操作の説明（変更できない） */
export const MOUSE_HINTS: { keys: string; label: string }[] = [
  { keys: 'Alt + ドラッグ', label: 'タイムラインで吸着せずに移動' },
  { keys: 'Ctrl + ホイール', label: 'タイムラインの拡大縮小' },
  {
    keys: 'Shift + ドラッグ（プレビュー）',
    label: '移動を水平・垂直に限定／回転は 15° 刻み、拡大率は 10% 刻み',
  },
];

/** 修飾キーだけの入力（割り当てには使えない） */
const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

/** キー入力を「Ctrl+Shift+KeyS」の形にする（修飾キーだけなら null） */
export function keyString(
  e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
): string | null {
  if (!e.code || MODIFIER_CODES.has(e.code)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.code);
  return parts.join('+');
}

const KEY_NAMES: Record<string, string> = {
  Space: 'Space',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Equal: '=',
  Minus: '-',
  NumpadAdd: 'テンキー +',
  NumpadSubtract: 'テンキー -',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Backquote: '`',
  Escape: 'Esc',
};

/** 表示用のキー名（例：Ctrl + Shift + S） */
export function formatKey(key: string): string {
  return key
    .split('+')
    .map(
      (p) =>
        (KEY_NAMES[p] !== undefined ? t(KEY_NAMES[p]) : undefined) ??
        p
          .replace(/^Key/, '')
          .replace(/^Digit/, '')
          .replace(/^Numpad/, t('テンキー ')),
    )
    .join(' + ');
}

/** コマンドに今割り当てられているキー */
export function keysOf(command: Command, custom = useKeymap.getState().custom): string[] {
  return custom[command.id] ?? command.defaultKeys;
}

/** キーに割り当てられているコマンド（except は除く） */
export function commandForKey(key: string, except?: string): Command | undefined {
  const custom = useKeymap.getState().custom;
  return COMMANDS.find((c) => c.id !== except && keysOf(c, custom).includes(key));
}

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
  const key = keyString(e);
  if (!key) return;
  const command = commandForKey(key);
  if (!command) return;
  if (!command.whileTyping && isTyping(e.target)) return;
  e.preventDefault();
  command.run();
}
