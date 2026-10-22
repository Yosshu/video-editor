import { setValueAt } from '../core/animation/keys';
import { resolveParams } from '../core/evaluate/evaluate';
import type { Draft } from 'immer';
import type { Scene } from '../core/model/types';
import { getObjectDef } from '../core/objects/definitions';
import {
  closeGap,
  deleteLayer,
  insertLayer,
  packLayer,
  previousOnLayer,
  relayoutCollides,
  rippleDelete,
  type Relayout,
} from '../core/timeline/structure';
import { commit, currentScene, getState, notify, setSelection } from '../state/store';
import { t } from '../i18n';

function editScene(label: string, fn: (scene: Draft<Scene>) => void): void {
  const { sceneId } = getState();
  commit(label, (draft) => {
    const s = draft.scenes.find((x) => x.id === sceneId);
    if (s) fn(s);
  });
}

function applyRelayout(scene: Draft<Scene>, moves: Relayout, remove?: Set<string>): void {
  if (remove) scene.objects = scene.objects.filter((o) => !remove.has(o.id));
  for (const o of scene.objects) {
    const m = moves.get(o.id);
    if (m?.start !== undefined) o.start = m.start;
    if (m?.layer !== undefined) o.layer = m.layer;
  }
}

/** 選択したオブジェクトを削除し、同じレイヤーの後ろを詰める */
export function rippleDeleteSelection(): void {
  const { selection } = getState();
  if (selection.length === 0) return;
  const { remove, moves } = rippleDelete(currentScene(), selection);
  if (remove.size === 0) {
    notify(t('ロックされたレイヤーのオブジェクトは削除できません。'), 'error');
    return;
  }
  editScene(t('削除して詰める'), (s) => applyRelayout(s, moves, remove));
  setSelection([]);
}

/** frame を含む空白を詰める（layer を省略するとすべてのレイヤー） */
export function closeGapAt(frame: number, layer?: number): void {
  const scene = currentScene();
  const moves = closeGap(scene, frame, layer);
  if (!moves || moves.size === 0) {
    notify(t('詰められる空白がありません（ロックされたレイヤーは動かせません）。'), 'error');
    return;
  }
  if (relayoutCollides(scene, moves)) {
    notify(t('詰めると他のオブジェクトと重なるため、詰められません。'), 'error');
    return;
  }
  editScene(t('空白を詰める'), (s) => applyRelayout(s, moves));
}

/** レイヤーの空白をすべて詰める */
export function packLayerAt(layer: number): void {
  const moves = packLayer(currentScene(), layer);
  if (!moves) {
    notify(t('レイヤー {0} はロックされています。', layer), 'error');
    return;
  }
  if (moves.size === 0) return;
  editScene(t('レイヤーの空白をすべて詰める'), (s) => applyRelayout(s, moves));
}

/** at の位置に空のレイヤーを挿入する（下のレイヤーは中身ごとずれる） */
export function insertLayerAt(at: number): void {
  const result = insertLayer(currentScene(), at);
  if (!result) {
    notify(t('最後のレイヤーにオブジェクトがあるため、挿入できません。'), 'error');
    return;
  }
  editScene(t('レイヤーの挿入'), (s) => {
    applyRelayout(s, result.moves);
    s.layers = result.layers;
  });
}

/** レイヤーを中身ごと削除する（下のレイヤーは上に詰める） */
export function deleteLayerAt(at: number): void {
  const result = deleteLayer(currentScene(), at);
  if (!result) {
    notify(t('レイヤー {0} はロックされているため、削除できません。', at), 'error');
    return;
  }
  editScene(t('レイヤーの削除'), (s) => {
    applyRelayout(s, result.moves, result.remove);
    s.layers = result.layers;
  });
  setSelection(getState().selection.filter((id) => !result.remove.has(id)));
}

/** レイヤー index から下 count レイヤーをまとまりにする（0 で解除） */
export function setLayerFold(index: number, count: number): void {
  editScene(count > 0 ? t('レイヤーをまとめる') : t('まとまりを解除'), (s) => {
    let layer = s.layers.find((l) => l.index === index);
    if (!layer) {
      layer = { index };
      s.layers.push(layer);
      s.layers.sort((a, b) => a.index - b.index);
    }
    if (count > 0) layer.fold = count;
    else {
      delete layer.fold;
      delete layer.collapsed;
    }
    // 中に入ったレイヤーのまとまりは外す（入れ子にはしない）
    for (const l of s.layers) {
      if (l.index > index && l.index <= index + count && l.fold) {
        delete l.fold;
        delete l.collapsed;
      }
    }
    s.layers = s.layers.filter((l) => Object.keys(l).length > 1);
  });
}

/** まとまりを折りたたむ／開く（表示の切り替えだが、保存されるので履歴にも残す） */
export function toggleLayerCollapsed(index: number): void {
  editScene(t('まとまりの折りたたみ'), (s) => {
    const layer = s.layers.find((l) => l.index === index);
    if (!layer?.fold) return;
    if (layer.collapsed) delete layer.collapsed;
    else layer.collapsed = true;
  });
}

/**
 * 同じレイヤーの直前のオブジェクトの、終了時の値を開始値として引き継ぐ。
 * 両方にある、キーフレームで動かせる数値パラメータが対象。
 */
export function inheritFromPrevious(objectId: string): void {
  const scene = currentScene();
  const obj = scene.objects.find((o) => o.id === objectId);
  if (!obj) return;
  const prev = previousOnLayer(scene, obj);
  if (!prev) {
    notify(t('同じレイヤーの前にオブジェクトがありません。'), 'error');
    return;
  }
  const prevValues = resolveParams(prev, prev.length - 1);
  const prevDefs = new Set(getObjectDef(prev.type).params.map((p) => p.id));
  const targets = getObjectDef(obj.type).params.filter(
    (p) => p.kind === 'number' && p.animatable && prevDefs.has(p.id),
  );
  const current = resolveParams(obj, 0);
  const changes = targets.filter((p) => prevValues[p.id] !== current[p.id]);
  if (changes.length === 0) {
    notify(t('引き継ぐ値はありません（すでに同じ値です）。'));
    return;
  }
  editScene(t('前のオブジェクトの値を引き継ぐ'), (s) => {
    const o = s.objects.find((x) => x.id === objectId);
    if (!o) return;
    for (const p of changes)
      o.params[p.id] = setValueAt(o.params[p.id], 0, Number(prevValues[p.id]));
  });
}
