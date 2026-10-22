import { create } from 'zustand';

/**
 * PWA（インストールして使えるアプリ）の対応。
 * - Service Worker を登録してオフラインでも開けるようにする
 * - 新しいバージョンが届いたら知らせ、利用者の操作で切り替える
 * - ブラウザが出すインストールの案内を、ボタンから出せるようにとっておく
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaState {
  /** 新しいバージョンが待機中 */
  updateReady: boolean;
  /** インストールの案内を出せる */
  canInstall: boolean;
}

export const usePwa = create<PwaState>(() => ({ updateReady: false, canInstall: false }));

let waiting: ServiceWorker | null = null;
let installPrompt: BeforeInstallPromptEvent | null = null;

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e as BeforeInstallPromptEvent;
    usePwa.setState({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => usePwa.setState({ canInstall: false }));
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then((reg) => {
      const check = (worker: ServiceWorker | null) => {
        // 最初のインストールでは知らせない（既に動いているページがあるときだけ）
        if (worker && hadController) {
          waiting = worker;
          usePwa.setState({ updateReady: true });
        }
      };
      if (reg.waiting) check(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') check(worker);
        });
      });
    })
    .catch((e) => console.warn('Service Worker を登録できませんでした', e));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
}

/** 待機中の新しいバージョンに切り替えて読み込み直す */
export function applyUpdate(): void {
  waiting?.postMessage({ type: 'SKIP_WAITING' });
}

/** ブラウザのインストールの案内を出す */
export async function promptInstall(): Promise<void> {
  if (!installPrompt) return;
  await installPrompt.prompt();
  await installPrompt.userChoice.catch(() => undefined);
  installPrompt = null;
  usePwa.setState({ canInstall: false });
}
