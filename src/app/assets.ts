import type { Asset, Project } from '../core/model/types';
import { computeFingerprint } from '../engine/media/fingerprint';
import { AssetImportError, assetRegistry } from '../engine/media/registry';
import { idbGet, idbSet } from '../storage/idb';
import { commit, getState, notify, setAssetStatus } from '../state/store';

export interface IncomingFile {
  file: File;
  handle?: FileSystemFileHandle;
}

/** ドロップされたアイテムから File と（あれば）ファイルハンドルを取り出す。drop イベント中に同期的に呼ぶこと */
export function collectDroppedFiles(dataTransfer: DataTransfer): Promise<IncomingFile[]> {
  const items = [...dataTransfer.items].filter((i) => i.kind === 'file');
  // getAsFile / getAsFileSystemHandle はイベント中に同期的に呼ぶ必要がある（最初の await より前で呼ばれる）
  const pending = items.map(async (item): Promise<IncomingFile | null> => {
    const file = item.getAsFile();
    let handle: FileSystemFileHandle | undefined;
    try {
      const h = await item.getAsFileSystemHandle?.();
      if (h && h.kind === 'file') handle = h as FileSystemFileHandle;
    } catch {
      handle = undefined;
    }
    return file ? (handle ? { file, handle } : { file }) : null;
  });
  return Promise.all(pending).then((list) => list.filter((x): x is IncomingFile => x !== null));
}

async function rememberHandle(
  fingerprint: string,
  handle: FileSystemFileHandle | undefined,
): Promise<void> {
  if (!handle) return;
  try {
    await idbSet('handles', fingerprint, handle);
  } catch {
    // ハンドルを保存できない環境では何もしない
  }
}

/**
 * 素材ファイルを取り込んでプロジェクトに追加する。
 * 同じファイル（指紋が同じ）が既にあればそれを使う。
 */
export async function importMediaFiles(files: IncomingFile[]): Promise<Asset[]> {
  const result: Asset[] = [];
  for (const { file, handle } of files) {
    try {
      const fingerprint = await computeFingerprint(file);
      const existing = getState().project.assets.find((a) => a.fingerprint === fingerprint);
      if (existing) {
        if (!assetRegistry.has(existing.id)) {
          await assetRegistry.attach(existing, file);
          setAssetStatus(existing.id, 'ready');
        }
        await rememberHandle(fingerprint, handle);
        result.push(existing);
        continue;
      }
      const asset = await assetRegistry.importFile(file);
      commit('素材の追加', (draft) => {
        draft.assets.push(asset);
      });
      setAssetStatus(asset.id, 'ready');
      await rememberHandle(asset.fingerprint, handle);
      result.push(asset);
    } catch (e) {
      const message =
        e instanceof AssetImportError ? e.message : `「${file.name}」を読み込めませんでした。`;
      notify(message, 'error');
      console.error(e);
    }
  }
  return result;
}

/** 読み込んだ編集ファイルの素材を、ブラウザに保存されたファイルハンドルから復元する。戻り値は見つからなかった素材 */
export async function restoreAssets(project: Project): Promise<Asset[]> {
  const missing: Asset[] = [];
  await Promise.all(
    project.assets.map(async (asset) => {
      if (assetRegistry.has(asset.id)) {
        setAssetStatus(asset.id, 'ready');
        return;
      }
      setAssetStatus(asset.id, 'loading');
      try {
        const handle = await idbGet<FileSystemFileHandle>('handles', asset.fingerprint);
        if (handle && (await handle.queryPermission?.({ mode: 'read' })) === 'granted') {
          const file = await handle.getFile();
          if (file.size === asset.size) {
            await assetRegistry.attach(asset, file);
            setAssetStatus(asset.id, 'ready');
            return;
          }
        }
      } catch {
        // 復元できなければ不足素材として扱う
      }
      setAssetStatus(asset.id, 'missing');
      missing.push(asset);
    }),
  );
  return missing;
}

export function missingAssets(): Asset[] {
  const { project, assetStatus } = getState();
  return project.assets.filter(
    (a) => assetStatus[a.id] === 'missing' || assetStatus[a.id] === 'error',
  );
}

/** ブラウザに保存済みのハンドルに、読み取りの許可を求めて復元する（ユーザー操作の中で呼ぶこと） */
export async function requestStoredHandles(): Promise<number> {
  let restored = 0;
  for (const asset of missingAssets()) {
    try {
      const handle = await idbGet<FileSystemFileHandle>('handles', asset.fingerprint);
      if (!handle) continue;
      const state = await handle.requestPermission?.({ mode: 'read' });
      if (state !== 'granted') continue;
      const file = await handle.getFile();
      await assetRegistry.attach(asset, file);
      setAssetStatus(asset.id, 'ready');
      restored++;
    } catch {
      // 失敗した素材はそのまま
    }
  }
  return restored;
}

/** 投下されたファイルを不足素材に照合して割り当てる。戻り値は割り当てた数 */
export async function relinkFiles(files: IncomingFile[]): Promise<number> {
  const targets = missingAssets();
  if (targets.length === 0) return 0;
  const remaining = new Set(targets.map((a) => a.id));
  const prints = await Promise.all(files.map((f) => computeFingerprint(f.file).catch(() => '')));
  const assign = async (asset: Asset, index: number) => {
    try {
      await attachAndUpdate(asset, files[index], prints[index]);
      remaining.delete(asset.id);
    } catch (e) {
      setAssetStatus(asset.id, 'error');
      notify(`「${asset.name}」を読み込めませんでした。`, 'error');
      console.error(e);
    }
  };

  // 1. 指紋が一致するもの
  for (const asset of targets) {
    const i = prints.indexOf(asset.fingerprint);
    if (i >= 0) await assign(asset, i);
  }
  // 2. ファイル名とサイズが一致するもの → 3. ファイル名だけ一致するもの
  for (const matcher of [
    (a: Asset, f: File) => a.name === f.name && a.size === f.size,
    (a: Asset, f: File) => a.name === f.name,
  ]) {
    for (const asset of targets) {
      if (!remaining.has(asset.id)) continue;
      const i = files.findIndex((f) => matcher(asset, f.file));
      if (i >= 0) await assign(asset, i);
    }
  }
  return targets.length - remaining.size;
}

/** 素材にファイルを結び付け、別のファイルなら素材情報（名前・サイズ・指紋）も更新する */
async function attachAndUpdate(
  asset: Asset,
  incoming: IncomingFile,
  fingerprint: string,
): Promise<void> {
  await assetRegistry.attach(asset, incoming.file);
  setAssetStatus(asset.id, 'ready');
  if (fingerprint && fingerprint !== asset.fingerprint) {
    commit('素材の差し替え', (draft) => {
      const a = draft.assets.find((x) => x.id === asset.id);
      if (!a) return;
      a.name = incoming.file.name;
      a.size = incoming.file.size;
      a.lastModified = incoming.file.lastModified;
      a.fingerprint = fingerprint;
    });
  }
  await rememberHandle(fingerprint || asset.fingerprint, incoming.handle);
}

/** 特定の素材に、選ばれたファイルを割り当てる（差し替え） */
export async function replaceAssetFile(asset: Asset, incoming: IncomingFile): Promise<void> {
  const fingerprint = await computeFingerprint(incoming.file);
  await attachAndUpdate(asset, incoming, fingerprint);
}
