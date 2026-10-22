import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';
import { create } from 'zustand';
import { createProject } from '../core/project/factory';
import type { Project, Scene } from '../core/model/types';

enablePatches();

/** 元に戻す／やり直しの 1 単位 */
interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  /** 同じキーの連続した変更は 1 つにまとめる（スライダー操作など） */
  mergeKey?: string;
  time: number;
}

export type AssetStatus = 'loading' | 'ready' | 'missing' | 'error';

export interface Notice {
  id: number;
  kind: 'info' | 'error';
  message: string;
}

/** プレビューの解像度の倍率。auto は再生中の描画の速さに合わせて自動で決める */
export type PreviewQuality = 'auto' | 1 | 0.5 | 0.25;

export interface EditorState {
  project: Project;
  sceneId: string;
  selection: string[];
  /** 再生位置（フレーム） */
  playhead: number;
  playing: boolean;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** 最後に保存してから変更があるか */
  dirty: boolean;
  fileName: string | null;
  previewQuality: PreviewQuality;
  /** タイムラインの 1 フレームあたりのピクセル数 */
  pxPerFrame: number;
  assetStatus: Record<string, AssetStatus>;
  notices: Notice[];
}

const HISTORY_LIMIT = 200;
const MERGE_WINDOW_MS = 1500;

function initialState(project: Project = createProject()): EditorState {
  return {
    project,
    sceneId: project.rootSceneId,
    selection: [],
    playhead: 0,
    playing: false,
    past: [],
    future: [],
    dirty: false,
    fileName: null,
    previewQuality: 'auto',
    pxPerFrame: 4,
    assetStatus: {},
    notices: [],
  };
}

export const useEditor = create<EditorState>(() => initialState());

export function getState(): EditorState {
  return useEditor.getState();
}

export function currentScene(state: EditorState = getState()): Scene {
  return state.project.scenes.find((s) => s.id === state.sceneId) ?? state.project.scenes[0];
}

/** プロジェクトを置き換える（新規作成・読み込み） */
export function replaceProject(project: Project, fileName: string | null): void {
  const prev = getState();
  useEditor.setState({
    ...initialState(project),
    fileName,
    previewQuality: prev.previewQuality,
    pxPerFrame: prev.pxPerFrame,
  });
}

/**
 * プロジェクトを変更する。すべての編集はこの関数を通す（元に戻せるようにするため）。
 */
export function commit(
  label: string,
  recipe: (draft: Draft<Project>) => void,
  options: { mergeKey?: string } = {},
): void {
  const state = getState();
  const [next, patches, inverse] = produceWithPatches(state.project, recipe);
  if (patches.length === 0) return;
  const now = Date.now();
  const past = [...state.past];
  const last = past[past.length - 1];
  if (
    options.mergeKey &&
    last &&
    last.mergeKey === options.mergeKey &&
    now - last.time < MERGE_WINDOW_MS
  ) {
    past[past.length - 1] = {
      ...last,
      patches: [...last.patches, ...patches],
      inverse: [...inverse, ...last.inverse],
      time: now,
    };
  } else {
    past.push({ label, patches, inverse, mergeKey: options.mergeKey, time: now });
    if (past.length > HISTORY_LIMIT) past.shift();
  }
  useEditor.setState({ project: next, past, future: [], dirty: true });
}

function validSelection(project: Project, sceneId: string, selection: string[]): string[] {
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) return [];
  const ids = new Set(scene.objects.map((o) => o.id));
  return selection.filter((id) => ids.has(id));
}

export function undo(): void {
  const state = getState();
  const entry = state.past[state.past.length - 1];
  if (!entry) return;
  const project = applyPatches(state.project, entry.inverse);
  useEditor.setState({
    project,
    past: state.past.slice(0, -1),
    future: [...state.future, { ...entry, mergeKey: undefined }],
    selection: validSelection(project, state.sceneId, state.selection),
    dirty: true,
  });
}

export function redo(): void {
  const state = getState();
  const entry = state.future[state.future.length - 1];
  if (!entry) return;
  const project = applyPatches(state.project, entry.patches);
  useEditor.setState({
    project,
    past: [...state.past, entry],
    future: state.future.slice(0, -1),
    selection: validSelection(project, state.sceneId, state.selection),
    dirty: true,
  });
}

export function setSelection(selection: string[]): void {
  useEditor.setState({ selection });
}

export function setPlayhead(frame: number): void {
  useEditor.setState({ playhead: Math.max(0, Math.round(frame)) });
}

export function setAssetStatus(assetId: string, status: AssetStatus): void {
  useEditor.setState((s) => ({ assetStatus: { ...s.assetStatus, [assetId]: status } }));
}

let noticeSeq = 0;

export function notify(message: string, kind: Notice['kind'] = 'info'): void {
  const id = ++noticeSeq;
  useEditor.setState((s) => ({ notices: [...s.notices, { id, kind, message }] }));
  setTimeout(() => dismissNotice(id), kind === 'error' ? 8000 : 4000);
}

export function dismissNotice(id: number): void {
  useEditor.setState((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
}
