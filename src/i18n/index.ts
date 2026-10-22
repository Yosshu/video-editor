import { create } from 'zustand';
import { EN } from './en';

/**
 * 画面の言語。文言は日本語をそのまま辞書のキーにし、英語の辞書（en.ts）で引く。
 * 辞書にない文言は日本語のまま表示する。
 */
export type Locale = 'ja' | 'en';

const STORAGE_KEY = 'video-editor:locale';

function initialLocale(): Locale {
  // ブラウザの外（単体テストなど）では日本語
  if (typeof window === 'undefined') return 'ja';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ja' || saved === 'en') return saved;
  } catch {
    // 読めなければブラウザの言語で決める
  }
  if (typeof navigator !== 'undefined' && !navigator.language.toLowerCase().startsWith('ja'))
    return 'en';
  return 'ja';
}

export const useLocale = create<{ locale: Locale }>(() => ({ locale: initialLocale() }));

export function setLocale(locale: Locale): void {
  useLocale.setState({ locale });
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // 保存できない環境ではこのページを開いている間だけ有効
  }
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

/**
 * 文言を今の言語にする。{0} {1} … は後ろの引数で置き換える。
 * 例：t('レイヤー {0} の名前', 3)
 */
export function t(text: string, ...args: (string | number)[]): string {
  let s = useLocale.getState().locale === 'en' ? (EN[text] ?? text) : text;
  args.forEach((a, i) => {
    s = s.split(`{${i}}`).join(String(a));
  });
  return s;
}
