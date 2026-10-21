import type { Project } from '../core/model/types';
import { createScene } from '../core/project/factory';
import { commit, getState, notify, useEditor } from '../state/store';

/** シーン target が、シーン from を（入れ子のどこかで）含んでいるか */
export function sceneContains(
  project: Project,
  target: string,
  from: string,
  seen = new Set<string>(),
): boolean {
  if (target === from) return true;
  if (seen.has(target)) return false;
  seen.add(target);
  const scene = project.scenes.find((s) => s.id === target);
  if (!scene) return false;
  return scene.objects.some(
    (o) =>
      o.type === 'scene' &&
      typeof o.params.sceneRef === 'string' &&
      sceneContains(project, o.params.sceneRef, from, seen),
  );
}

/** シーン from の中に置けるシーン（自分自身や、自分を含むシーンは循環になるので除く） */
export function referableScenes(project: Project, from: string): { id: string; name: string }[] {
  return project.scenes
    .filter((s) => !sceneContains(project, s.id, from))
    .map((s) => ({ id: s.id, name: s.name }));
}

export function switchScene(sceneId: string): void {
  if (getState().sceneId === sceneId) return;
  useEditor.setState({ sceneId, selection: [] });
}

export function addScene(): void {
  const { project } = getState();
  const scene = createScene(
    `シーン ${project.scenes.length}`,
    project.settings.width,
    project.settings.height,
  );
  commit('シーンの追加', (draft) => {
    draft.scenes.push(scene);
  });
  switchScene(scene.id);
}

export function renameScene(sceneId: string, name: string): void {
  if (!name.trim()) return;
  commit('シーン名の変更', (draft) => {
    const s = draft.scenes.find((x) => x.id === sceneId);
    if (s) s.name = name.trim();
  });
}

export function deleteScene(sceneId: string): void {
  const { project } = getState();
  if (sceneId === project.rootSceneId) {
    notify('メインのシーンは削除できません。', 'error');
    return;
  }
  const used = project.scenes.some((s) =>
    s.objects.some((o) => o.type === 'scene' && o.params.sceneRef === sceneId),
  );
  if (
    used &&
    !window.confirm('このシーンを表示しているシーンオブジェクトがあります。削除しますか？')
  )
    return;
  commit('シーンの削除', (draft) => {
    draft.scenes = draft.scenes.filter((s) => s.id !== sceneId);
  });
  useEditor.setState({ sceneId: getState().project.rootSceneId, selection: [] });
}
