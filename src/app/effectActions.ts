import { newId } from '../core/model/ids';
import { commit, getState } from '../state/store';
import { t } from '../i18n';

function edit(
  objectId: string,
  label: string,
  fn: (effects: { id: string; type: string; enabled: boolean }[]) => void,
) {
  const { sceneId } = getState();
  commit(label, (draft) => {
    const o = draft.scenes.find((s) => s.id === sceneId)?.objects.find((x) => x.id === objectId);
    if (o) fn(o.effects);
  });
}

/** エフェクトを追加する（既定値のパラメータは保存しない） */
export function addEffect(objectId: string, type: string): void {
  const { sceneId } = getState();
  commit(t('エフェクトの追加'), (draft) => {
    const o = draft.scenes.find((s) => s.id === sceneId)?.objects.find((x) => x.id === objectId);
    o?.effects.push({ id: newId('fx'), type, enabled: true, params: {} });
  });
}

export function removeEffect(objectId: string, effectId: string): void {
  edit(objectId, t('エフェクトの削除'), (effects) => {
    const i = effects.findIndex((e) => e.id === effectId);
    if (i >= 0) effects.splice(i, 1);
  });
}

export function moveEffect(objectId: string, effectId: string, direction: -1 | 1): void {
  edit(objectId, t('エフェクトの並べ替え'), (effects) => {
    const i = effects.findIndex((e) => e.id === effectId);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= effects.length) return;
    const [e] = effects.splice(i, 1);
    effects.splice(j, 0, e);
  });
}

export function setEffectEnabled(objectId: string, effectId: string, enabled: boolean): void {
  edit(objectId, enabled ? t('エフェクトを有効化') : t('エフェクトを無効化'), (effects) => {
    const e = effects.find((x) => x.id === effectId);
    if (e) e.enabled = enabled;
  });
}
