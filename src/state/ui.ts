import { create } from 'zustand';

/** 画面に表示中のダイアログ */
export type DialogState =
  | null
  | { type: 'newProject' }
  | { type: 'projectSettings' }
  | { type: 'missingAssets' }
  | { type: 'restore'; savedAt: string; fileName: string | null }
  | { type: 'export' }
  | { type: 'beatGrid' }
  | { type: 'shortcuts' }
  | { type: 'presets' }
  | { type: 'imageSequence'; files: File[] }
  | { type: 'about' };

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  action: () => void;
}

export interface UiState {
  dialog: DialogState;
  /** 時間のかかる処理の表示（素材同梱パッケージの保存など） */
  busy: { label: string; progress?: number } | null;
  contextMenu: { x: number; y: number; items: (ContextMenuItem | 'separator')[] } | null;
  /** タイムラインの吸着 */
  snap: boolean;
  /** プレビューの補助表示 */
  previewGuides: { grid: boolean; safeArea: boolean };
}

export const useUi = create<UiState>(() => ({
  dialog: null,
  busy: null,
  contextMenu: null,
  snap: true,
  previewGuides: { grid: false, safeArea: false },
}));

export function openDialog(dialog: DialogState): void {
  useUi.setState({ dialog });
}

export function closeDialog(): void {
  useUi.setState({ dialog: null });
}

export function openContextMenu(
  x: number,
  y: number,
  items: (ContextMenuItem | 'separator')[],
): void {
  useUi.setState({ contextMenu: { x, y, items } });
}

export function closeContextMenu(): void {
  useUi.setState({ contextMenu: null });
}
