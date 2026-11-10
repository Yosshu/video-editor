import { beginGesture, endGesture } from '../../state/store';

/**
 * ポインターを押してから離すまでの変更を、1 つの履歴にまとめる（pointerdown の中で呼ぶ）。
 * 押した要素の外で離しても終わるよう、window で離したことを受け取る
 */
export function groupUntilPointerUp(): void {
  beginGesture();
  const end = () => {
    endGesture();
    window.removeEventListener('pointerup', end, true);
    window.removeEventListener('pointercancel', end, true);
  };
  window.addEventListener('pointerup', end, true);
  window.addEventListener('pointercancel', end, true);
}
