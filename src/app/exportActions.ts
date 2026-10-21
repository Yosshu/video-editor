import { PROJECT_EXTENSION } from '../core/project/factory';
import { downloadBlob, isAbortError } from '../storage/download';
import { getState } from '../state/store';

export type SaveTarget =
  | { kind: 'file'; writable: FileSystemWritableFileStream; name: string }
  | { kind: 'memory'; name: string };

/** 書き出すファイルの名前の候補（編集ファイル名をもとにする） */
export function baseName(): string {
  const name = getState().fileName;
  return name ? name.replace(new RegExp(`\\${PROJECT_EXTENSION}$`), '') : 'video';
}

/**
 * 保存先を決める。ファイルへ直接書ける環境では保存ダイアログを出す（ユーザー操作の中で呼ぶこと）。
 * キャンセルされたら null。
 */
export async function chooseSaveTarget(
  suggestedName: string,
  description: string,
  mime: string,
  extension: string,
): Promise<SaveTarget | null> {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description, accept: { [mime]: [extension] } }],
        id: 'export',
      });
      return { kind: 'file', writable: await handle.createWritable(), name: handle.name };
    } catch (e) {
      if (isAbortError(e)) return null;
      throw e;
    }
  }
  return { kind: 'memory', name: suggestedName };
}

/** メモリ上に作ったファイルをダウンロードさせる */
export function deliver(blob: Blob, name: string): void {
  downloadBlob(blob, name);
}
