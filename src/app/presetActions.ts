import { newId } from '../core/model/ids';
import type { ParamMap } from '../core/model/types';
import { getObjectDef } from '../core/objects/definitions';
import { downloadBlob } from '../storage/download';
import { pickFilesWithInput } from '../storage/filePicker';
import { commit, currentScene, getState, notify } from '../state/store';
import {
  parsePresets,
  PRESET_FORMAT,
  updatePresets,
  usePresets,
  type EffectPreset,
  type ObjectPreset,
} from '../state/presets';
import { addObject } from './actions';
import { t } from '../i18n';

/** 素材やシーンに結びついていて、プリセットに入れないパラメータ */
const NOT_SAVED = ['sceneRef', 'offset'];
/** 既存のオブジェクトに適用するときは変えないパラメータ（文字の内容など） */
const KEEP_ON_APPLY = ['text', 'sceneRef', 'offset'];

function withoutKeys(params: ParamMap, keys: string[]): ParamMap {
  return Object.fromEntries(Object.entries(params).filter(([k]) => !keys.includes(k)));
}

/** 選択中のオブジェクトの設定（パラメータとエフェクト）をプリセットにする */
export function saveObjectPreset(objectId: string, name: string): void {
  const obj = currentScene().objects.find((o) => o.id === objectId);
  if (!obj || !name.trim()) return;
  const preset: ObjectPreset = {
    id: newId('pr'),
    name: name.trim(),
    type: obj.type,
    params: structuredClone(withoutKeys(obj.params, NOT_SAVED)),
    effects: structuredClone(obj.effects),
  };
  updatePresets((c) => ({ ...c, objects: [...c.objects, preset] }));
  notify(t('プリセット「{0}」を保存しました。', preset.name));
}

/** オブジェクトにプリセットを適用する（時間・素材・文字の内容はそのまま） */
export function applyObjectPreset(objectId: string, presetId: string): void {
  const preset = usePresets.getState().objects.find((p) => p.id === presetId);
  const { sceneId } = getState();
  if (!preset) return;
  commit(t('プリセットの適用'), (draft) => {
    const o = draft.scenes.find((s) => s.id === sceneId)?.objects.find((x) => x.id === objectId);
    if (!o || o.type !== preset.type) return;
    const kept = Object.fromEntries(
      Object.entries(o.params).filter(([k]) => KEEP_ON_APPLY.includes(k)),
    );
    o.params = { ...structuredClone(withoutKeys(preset.params, KEEP_ON_APPLY)), ...kept };
    o.effects = preset.effects.map((e) => ({ ...structuredClone(e), id: newId('fx') }));
  });
}

/** 素材を使わないオブジェクトのプリセットは、タイムラインに直接追加できる */
export function canAddFromPreset(preset: ObjectPreset): boolean {
  const def = getObjectDef(preset.type);
  return !def.assetKind && preset.type !== 'scene';
}

export function addObjectFromPreset(presetId: string, layer: number, frame: number): void {
  const preset = usePresets.getState().objects.find((p) => p.id === presetId);
  if (!preset || !canAddFromPreset(preset)) return;
  addObject(preset.type, layer, frame, {
    params: structuredClone(preset.params),
    effects: preset.effects.map((e) => ({ ...structuredClone(e), id: newId('fx') })),
  });
}

export function saveEffectPreset(objectId: string, effectId: string, name: string): void {
  const effect = currentScene()
    .objects.find((o) => o.id === objectId)
    ?.effects.find((e) => e.id === effectId);
  if (!effect || !name.trim()) return;
  const preset: EffectPreset = {
    id: newId('pr'),
    name: name.trim(),
    type: effect.type,
    params: structuredClone(effect.params),
  };
  updatePresets((c) => ({ ...c, effects: [...c.effects, preset] }));
  notify(t('プリセット「{0}」を保存しました。', preset.name));
}

export function addEffectFromPreset(objectId: string, presetId: string): void {
  const preset = usePresets.getState().effects.find((p) => p.id === presetId);
  const { sceneId } = getState();
  if (!preset) return;
  commit(t('エフェクトの追加'), (draft) => {
    const o = draft.scenes.find((s) => s.id === sceneId)?.objects.find((x) => x.id === objectId);
    o?.effects.push({
      id: newId('fx'),
      type: preset.type,
      enabled: true,
      params: structuredClone(preset.params),
    });
  });
}

export function renamePreset(kind: 'objects' | 'effects', id: string, name: string): void {
  if (!name.trim()) return;
  updatePresets((c) => ({
    ...c,
    [kind]: c[kind].map((p) => (p.id === id ? { ...p, name: name.trim() } : p)),
  }));
}

export function deletePreset(kind: 'objects' | 'effects', id: string): void {
  updatePresets((c) => ({ ...c, [kind]: c[kind].filter((p) => p.id !== id) }));
}

/** プリセットをファイルに書き出す */
export function exportPresets(): void {
  const { objects, effects } = usePresets.getState();
  const json = JSON.stringify({ format: PRESET_FORMAT, version: 1, objects, effects }, null, 2);
  downloadBlob(new Blob([json], { type: 'application/json' }), 'presets.json');
}

/** ファイルからプリセットを読み込み、今あるものに追加する */
export async function importPresets(): Promise<void> {
  const [file] = await pickFilesWithInput({ accept: '.json,application/json', multiple: false });
  if (!file) return;
  try {
    const data: unknown = JSON.parse(await file.text());
    const parsed =
      data && typeof data === 'object' && (data as { format?: unknown }).format === PRESET_FORMAT
        ? parsePresets(data)
        : null;
    if (!parsed) throw new Error(t('形式が違います'));
    // 同じ ID があれば付け直して、すべて追加する
    const reId = <T extends { id: string }>(list: T[], existing: T[]) =>
      list.map((p) => (existing.some((e) => e.id === p.id) ? { ...p, id: newId('pr') } : p));
    updatePresets((c) => ({
      objects: [...c.objects, ...reId(parsed.objects, c.objects)],
      effects: [...c.effects, ...reId(parsed.effects, c.effects)],
    }));
    notify(
      t(
        'プリセットを読み込みました（オブジェクト {0} 件・エフェクト {1} 件）。',
        parsed.objects.length,
        parsed.effects.length,
      ),
    );
  } catch {
    notify(t('プリセットのファイルを読み込めませんでした。'), 'error');
  }
}
