/** ブラウザがアプリの動作に必要な機能を備えているかを調べる */

export interface SupportReport {
  /** 編集に必須の機能がすべてそろっているか */
  ok: boolean;
  /** 不足している必須機能 */
  missing: string[];
  /** 動作はするが制限がある点 */
  warnings: string[];
}

function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!canvas.getContext('webgl2');
  } catch {
    return false;
  }
}

export function checkSupport(): SupportReport {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!hasWebGL2()) missing.push('WebGL2（映像の合成）');
  if (typeof VideoDecoder === 'undefined') missing.push('WebCodecs VideoDecoder（動画の読み込み）');
  if (typeof AudioDecoder === 'undefined') missing.push('WebCodecs AudioDecoder（音声の読み込み）');
  if (typeof OffscreenCanvas === 'undefined') missing.push('OffscreenCanvas');
  if (typeof AudioContext === 'undefined') missing.push('Web Audio API（音声の再生）');
  if (typeof indexedDB === 'undefined') missing.push('IndexedDB（自動保存）');
  if (!globalThis.crypto?.subtle) missing.push('Web Crypto（素材の照合）');

  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') {
    warnings.push('このブラウザでは動画の書き出しができません。');
  }
  if (!('showSaveFilePicker' in window)) {
    warnings.push('上書き保存ができないため、保存のたびにファイルをダウンロードします。');
  }
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  if (coarse && window.innerWidth < 900) {
    warnings.push(
      'スマートフォン・タブレットでの編集には対応していません。PC での利用をおすすめします。',
    );
  }

  return { ok: missing.length === 0, missing, warnings };
}
