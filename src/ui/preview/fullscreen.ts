/** 全画面表示にする要素（プレビューのパネル）に付ける印 */
export const FULLSCREEN_ATTR = 'data-fullscreen-target';

/** プレビューの全画面表示を切り替える */
export async function togglePreviewFullscreen(): Promise<void> {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }
  const el = document.querySelector<HTMLElement>(`[${FULLSCREEN_ATTR}]`);
  if (!el?.requestFullscreen) return;
  try {
    await el.requestFullscreen();
  } catch {
    // 全画面表示が許可されていない環境では何もしない
  }
}
