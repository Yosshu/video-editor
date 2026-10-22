import {
  createProject,
  PACKAGE_EXTENSION,
  PACKAGE_MIMETYPE,
  PROJECT_EXTENSION,
} from '../core/project/factory';
import { parseProject, ProjectFileError, serializeProject } from '../core/project/serialize';
import type { Project, ProjectSettings } from '../core/model/types';
import { extensionOf, isPackageFileName } from '../engine/media/detect';
import { assetRegistry } from '../engine/media/registry';
import { downloadBlob, isAbortError } from '../storage/download';
import { pickFilesWithInput } from '../storage/filePicker';
import { idbDelete, idbGet, idbSet } from '../storage/idb';
import {
  readZipEntries,
  ZipFormatError,
  ZipWriter,
  zipEntryBlob,
  type ZipSink,
} from '../storage/zip';
import { getState, notify, replaceProject, setAssetStatus, useEditor } from '../state/store';
import { openDialog, useUi } from '../state/ui';
import { missingAssets, rememberPackageSlice, restoreAssets } from './assets';

const AUTOSAVE_KEY = 'autosave';
const PROJECT_HANDLE_KEY = 'projectHandle';
const AUTOSAVE_DELAY_MS = 1500;

/** 上書き保存先（File System Access API が使える場合） */
let currentHandle: FileSystemFileHandle | null = null;

const FILE_TYPES: FilePickerAcceptType[] = [
  { description: '編集ファイル', accept: { 'application/json': [PROJECT_EXTENSION] } },
];

const OPEN_TYPES: FilePickerAcceptType[] = [
  {
    description: '編集ファイル・素材同梱パッケージ',
    accept: { 'application/json': [PROJECT_EXTENSION], 'application/zip': [PACKAGE_EXTENSION] },
  },
];

function suggestedName(): string {
  return getState().fileName ?? `project${PROJECT_EXTENSION}`;
}

/** 編集ファイルを保存する。成功したら true */
export async function saveProject(options: { saveAs?: boolean } = {}): Promise<boolean> {
  const { project } = getState();
  const json = serializeProject(project);
  try {
    if (window.showSaveFilePicker) {
      if (!currentHandle || options.saveAs) {
        currentHandle = await window.showSaveFilePicker({
          suggestedName: suggestedName(),
          types: FILE_TYPES,
          id: 'project',
        });
      }
      if ((await currentHandle.queryPermission?.({ mode: 'readwrite' })) === 'prompt') {
        await currentHandle.requestPermission?.({ mode: 'readwrite' });
      }
      const writable = await currentHandle.createWritable();
      await writable.write(json);
      await writable.close();
      useEditor.setState({ dirty: false, fileName: currentHandle.name });
      idbSet('kv', PROJECT_HANDLE_KEY, currentHandle).catch(() => undefined);
    } else {
      let name = suggestedName();
      if (options.saveAs || !getState().fileName) {
        const input = window.prompt('保存するファイル名', name);
        if (!input) return false;
        name = input.endsWith(PROJECT_EXTENSION) ? input : `${input}${PROJECT_EXTENSION}`;
      }
      downloadBlob(new Blob([json], { type: 'application/json' }), name);
      useEditor.setState({ dirty: false, fileName: name });
    }
    notify('保存しました。');
    return true;
  } catch (e) {
    if (isAbortError(e)) return false;
    console.error(e);
    notify('保存できませんでした。', 'error');
    return false;
  }
}

async function loadProject(
  project: Project,
  fileName: string | null,
  warnings: string[],
): Promise<void> {
  assetRegistry.clear();
  replaceProject(project, fileName);
  for (const w of warnings) notify(w);
  const missing = await restoreAssets(project);
  if (missing.length > 0) openDialog({ type: 'missingAssets' });
}

/** 編集ファイル（または素材同梱パッケージ）を開く */
export async function openProjectFile(file: File, handle?: FileSystemFileHandle): Promise<void> {
  if (isPackageFileName(file.name)) {
    await openPackageFile(file, handle);
    return;
  }
  try {
    const { project, warnings } = parseProject(await file.text());
    currentHandle = handle ?? null;
    if (handle) idbSet('kv', PROJECT_HANDLE_KEY, handle).catch(() => undefined);
    await loadProject(project, file.name, warnings);
    notify(`「${file.name}」を開きました。`);
  } catch (e) {
    const message = e instanceof ProjectFileError ? e.message : '編集ファイルを開けませんでした。';
    notify(message, 'error');
    console.error(e);
  }
}

export async function pickAndOpenProject(): Promise<void> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: OPEN_TYPES, id: 'project' });
      await openProjectFile(await handle.getFile(), handle);
    } catch (e) {
      if (!isAbortError(e)) notify('編集ファイルを開けませんでした。', 'error');
    }
    return;
  }
  const [file] = await pickFilesWithInput({
    accept: `${PROJECT_EXTENSION},${PACKAGE_EXTENSION},application/json`,
  });
  if (file) await openProjectFile(file);
}

export function newProject(settings: Partial<ProjectSettings>): void {
  currentHandle = null;
  assetRegistry.clear();
  replaceProject(createProject(settings), null);
}

interface AutosaveRecord {
  json: string;
  fileName: string | null;
  savedAt: string;
}

/** 変更があるたびに少し待ってからブラウザ内に自動保存する */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = useEditor.subscribe((state, prev) => {
    if (state.project === prev.project && state.fileName === prev.fileName) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const s = getState();
      const record: AutosaveRecord = {
        json: serializeProject(s.project),
        fileName: s.fileName,
        savedAt: new Date().toISOString(),
      };
      idbSet('kv', AUTOSAVE_KEY, record).catch((e) => console.warn('自動保存に失敗しました', e));
    }, AUTOSAVE_DELAY_MS);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}

/** 自動保存されたデータがあれば、復元するかを尋ねるダイアログを出す */
export async function checkAutosave(): Promise<void> {
  try {
    const record = await idbGet<AutosaveRecord>('kv', AUTOSAVE_KEY);
    if (!record) return;
    const { project } = parseProject(record.json);
    const empty =
      project.scenes.every((s) => s.objects.length === 0) && project.assets.length === 0;
    if (empty) return;
    openDialog({ type: 'restore', savedAt: record.savedAt, fileName: record.fileName });
  } catch (e) {
    console.warn('自動保存データを読み込めませんでした', e);
  }
}

export async function restoreAutosave(): Promise<void> {
  const record = await idbGet<AutosaveRecord>('kv', AUTOSAVE_KEY);
  if (!record) return;
  try {
    const { project, warnings } = parseProject(record.json);
    const handle = await idbGet<FileSystemFileHandle>('kv', PROJECT_HANDLE_KEY).catch(
      () => undefined,
    );
    currentHandle = handle && handle.name === record.fileName ? handle : null;
    await loadProject(project, record.fileName, warnings);
    useEditor.setState({ dirty: true });
  } catch (e) {
    notify('自動保存データを復元できませんでした。', 'error');
    console.error(e);
  }
}

export async function discardAutosave(): Promise<void> {
  await idbDelete('kv', AUTOSAVE_KEY).catch(() => undefined);
}

/** パッケージの中の素材のファイル名（拡張子は元のファイルに合わせる） */
function packagedMediaName(assetId: string, fileName: string): string {
  const ext = extensionOf(fileName);
  return `media/${assetId}${ext ? `.${ext}` : ''}`;
}

/**
 * 素材ごと 1 つのファイル（.vedpack、中身は無圧縮の ZIP）に保存する。
 * 別の PC やブラウザへ持っていくとき用。素材は書き込みながら読むので、大きな素材もメモリにためない。
 */
export async function savePackage(): Promise<boolean> {
  const { project } = getState();
  const missing = missingAssets().filter((a) => !assetRegistry.getFile(a.id));
  const unloaded = project.assets.filter((a) => !assetRegistry.getFile(a.id));
  if (missing.length > 0 || unloaded.length > 0) {
    notify(
      `見つからない素材があるため、素材ごと保存できません（${[...missing, ...unloaded][0].name} など）。先に素材を指定し直してください。`,
      'error',
    );
    return false;
  }
  const base = (getState().fileName ?? 'project').replace(/\.(vedproj|vedpack)$/, '');
  let sink: ZipSink;
  let finish: () => Promise<void>;
  try {
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${base}${PACKAGE_EXTENSION}`,
        types: [
          { description: '素材同梱パッケージ', accept: { 'application/zip': [PACKAGE_EXTENSION] } },
        ],
        id: 'package',
      });
      const writable = await handle.createWritable();
      sink = { write: (d) => writable.write(d as BufferSource) };
      finish = () => writable.close();
    } else {
      const chunks: Uint8Array[] = [];
      sink = {
        write: async (d) => {
          chunks.push(d);
        },
      };
      finish = async () =>
        downloadBlob(
          new Blob(chunks as BlobPart[], { type: 'application/zip' }),
          `${base}${PACKAGE_EXTENSION}`,
        );
    }
  } catch (e) {
    if (!isAbortError(e)) notify('保存できませんでした。', 'error');
    return false;
  }

  const total = project.assets.reduce(
    (sum, a) => sum + (assetRegistry.getFile(a.id)?.size ?? 0),
    0,
  );
  let done = 0;
  useUi.setState({ busy: { label: '素材ごと保存しています…', progress: 0 } });
  try {
    const zip = new ZipWriter(sink);
    const encoder = new TextEncoder();
    // 先頭に無圧縮の mimetype を置き、ファイルの種類を判別しやすくする
    await zip.add('mimetype', encoder.encode(PACKAGE_MIMETYPE));
    await zip.add('project.vedproj', encoder.encode(serializeProject(project)));
    for (const asset of project.assets) {
      const file = assetRegistry.getFile(asset.id)!;
      const before = done;
      await zip.add(packagedMediaName(asset.id, file.name), file, {
        mtime: new Date(file.lastModified || Date.now()),
        onProgress: (written) => {
          done = before + written;
          useUi.setState({
            busy: { label: '素材ごと保存しています…', progress: done / Math.max(1, total) },
          });
        },
      });
      done = before + file.size;
    }
    await zip.finish();
    await finish();
    notify('素材ごと保存しました。');
    return true;
  } catch (e) {
    console.error(e);
    notify('素材ごと保存できませんでした。', 'error');
    return false;
  } finally {
    useUi.setState({ busy: null });
  }
}

/** 素材同梱パッケージを開く。素材はパッケージのファイルの一部としてそのまま使う（コピーしない） */
export async function openPackageFile(file: File, handle?: FileSystemFileHandle): Promise<void> {
  try {
    const entries = await readZipEntries(file);
    const projectEntry = entries.find((e) => e.name === 'project.vedproj');
    if (!projectEntry)
      throw new ProjectFileError('素材同梱パッケージの中に編集ファイルがありません。');
    const { project, warnings } = parseProject(
      await (await zipEntryBlob(file, projectEntry)).text(),
    );
    currentHandle = null;
    assetRegistry.clear();
    replaceProject(project, file.name.replace(/\.vedpack$/i, PROJECT_EXTENSION));
    for (const w of warnings) notify(w);
    for (const asset of project.assets) {
      const entry = entries.find(
        (e) => e.name === `media/${asset.id}` || e.name.startsWith(`media/${asset.id}.`),
      );
      if (!entry) continue;
      setAssetStatus(asset.id, 'loading');
      try {
        const blob = await zipEntryBlob(file, entry);
        await assetRegistry.attach(
          asset,
          new File([blob], asset.name, { type: asset.mimeType, lastModified: asset.lastModified }),
        );
        setAssetStatus(asset.id, 'ready');
        // 次回ページを開いたときも、同じパッケージから復元できるようにする
        if (handle && entry.method === 0)
          await rememberPackageSlice(asset.fingerprint, {
            handle,
            start: entry.dataOffset,
            size: entry.size,
          });
      } catch (e) {
        console.error(e);
        setAssetStatus(asset.id, 'error');
      }
    }
    // パッケージに入っていなかった素材は、いつもの方法で探す
    const missing = await restoreAssets(getState().project);
    if (missing.length > 0) openDialog({ type: 'missingAssets' });
    // 保存すると編集ファイル（.vedproj）になるので、変更ありとして扱う
    useEditor.setState({ dirty: true });
    notify(`「${file.name}」を開きました。`);
  } catch (e) {
    const message =
      e instanceof ProjectFileError || e instanceof ZipFormatError
        ? e.message
        : '素材同梱パッケージを開けませんでした。';
    notify(message, 'error');
    console.error(e);
  }
}
