import { createProject, PROJECT_EXTENSION } from '../core/project/factory';
import { parseProject, ProjectFileError, serializeProject } from '../core/project/serialize';
import type { Project, ProjectSettings } from '../core/model/types';
import { assetRegistry } from '../engine/media/registry';
import { downloadBlob, isAbortError } from '../storage/download';
import { pickFilesWithInput } from '../storage/filePicker';
import { idbDelete, idbGet, idbSet } from '../storage/idb';
import { getState, notify, replaceProject, useEditor } from '../state/store';
import { openDialog } from '../state/ui';
import { restoreAssets } from './assets';

const AUTOSAVE_KEY = 'autosave';
const PROJECT_HANDLE_KEY = 'projectHandle';
const AUTOSAVE_DELAY_MS = 1500;

/** 上書き保存先（File System Access API が使える場合） */
let currentHandle: FileSystemFileHandle | null = null;

const FILE_TYPES: FilePickerAcceptType[] = [
  { description: '編集ファイル', accept: { 'application/json': [PROJECT_EXTENSION] } },
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

/** 編集ファイルを開く */
export async function openProjectFile(file: File, handle?: FileSystemFileHandle): Promise<void> {
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
      const [handle] = await window.showOpenFilePicker({ types: FILE_TYPES, id: 'project' });
      await openProjectFile(await handle.getFile(), handle);
    } catch (e) {
      if (!isAbortError(e)) notify('編集ファイルを開けませんでした。', 'error');
    }
    return;
  }
  const [file] = await pickFilesWithInput({ accept: `${PROJECT_EXTENSION},application/json` });
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
