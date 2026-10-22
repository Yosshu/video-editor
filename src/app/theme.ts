import { create } from 'zustand';

/** 画面の配色（暗い・明るい）。ブラウザに保存する */
export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'video-editor:theme';

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // 読めなければ OS の設定に合わせる
  }
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches)
    return 'light';
  return 'dark';
}

export const useTheme = create<{ theme: Theme }>(() => ({ theme: initialTheme() }));

export function applyTheme(theme: Theme = useTheme.getState().theme): void {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme): void {
  useTheme.setState({ theme });
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // 保存できない環境ではこのページを開いている間だけ有効
  }
  applyTheme(theme);
}
