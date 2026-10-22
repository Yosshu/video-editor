import type { LayerState, Scene, TimelineObject } from '../model/types';
import { MAX_LAYERS, objectEnd, rangesOverlap } from './ops';

/**
 * タイムラインの構造を変える編集（詰める・レイヤーの挿入と削除など）。
 * どれも新しい配置を返すだけで、シーンは変更しない。
 */

/** オブジェクトの新しい開始位置・レイヤー（変わるものだけ） */
export type Relayout = Map<string, { start?: number; layer?: number }>;

function lockedSet(scene: Scene): Set<number> {
  return new Set(scene.layers.filter((l) => l.locked).map((l) => l.index));
}

/**
 * リップル削除：ids を削除し、同じレイヤーの後ろのオブジェクトを削除した長さだけ前に詰める。
 * ロックされたレイヤーのオブジェクトは削除も移動もしない。
 */
export function rippleDelete(
  scene: Scene,
  ids: readonly string[],
): { remove: Set<string>; moves: Relayout } {
  const locked = lockedSet(scene);
  const remove = new Set(
    scene.objects.filter((o) => ids.includes(o.id) && !locked.has(o.layer)).map((o) => o.id),
  );
  const moves: Relayout = new Map();
  const removed = scene.objects.filter((o) => remove.has(o.id));
  for (const o of scene.objects) {
    if (remove.has(o.id)) continue;
    const shift = removed
      .filter((d) => d.layer === o.layer && objectEnd(d) <= o.start)
      .reduce((sum, d) => sum + d.length, 0);
    if (shift > 0) moves.set(o.id, { start: o.start - shift });
  }
  return { remove, moves };
}

/** frame を含む空白の区間 [from, to)。layer を省略するとすべてのレイヤーで空いている区間 */
export function gapAt(
  scene: Scene,
  frame: number,
  layer?: number,
): { from: number; to: number } | null {
  const objs = scene.objects.filter((o) => layer === undefined || o.layer === layer);
  if (objs.some((o) => frame >= o.start && frame < objectEnd(o))) return null;
  const from = Math.max(0, ...objs.filter((o) => objectEnd(o) <= frame).map(objectEnd));
  const after = objs.filter((o) => o.start > frame).map((o) => o.start);
  if (after.length === 0) return null;
  return { from, to: Math.min(...after) };
}

/**
 * 空白を詰める：frame を含む空白の後ろにあるオブジェクトを、空白の長さだけ前に動かす。
 * layer を省略するとすべてのレイヤーをまとめて動かす。詰められなければ null。
 */
export function closeGap(scene: Scene, frame: number, layer?: number): Relayout | null {
  const gap = gapAt(scene, frame, layer);
  if (!gap) return null;
  const shift = gap.to - gap.from;
  const locked = lockedSet(scene);
  const moving = scene.objects.filter(
    (o) => (layer === undefined || o.layer === layer) && o.start >= gap.to,
  );
  if (moving.some((o) => locked.has(o.layer))) return null;
  const moves: Relayout = new Map();
  for (const o of moving) moves.set(o.id, { start: o.start - shift });
  return moves;
}

/** レイヤーの空白をすべて詰める（最初のオブジェクトの位置はそのまま） */
export function packLayer(scene: Scene, layer: number): Relayout | null {
  if (lockedSet(scene).has(layer)) return null;
  const objs = scene.objects.filter((o) => o.layer === layer).sort((a, b) => a.start - b.start);
  const moves: Relayout = new Map();
  let at = objs[0]?.start ?? 0;
  for (const o of objs) {
    if (o.start !== at) moves.set(o.id, { start: at });
    at += o.length;
  }
  return moves;
}

/** レイヤー番号を付け替えたレイヤー設定 */
function remapLayers(layers: LayerState[], map: (index: number) => number | null): LayerState[] {
  const out: LayerState[] = [];
  for (const l of layers) {
    const index = map(l.index);
    if (index !== null) out.push({ ...l, index });
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * レイヤーの挿入：at 以降のレイヤーを中身ごと 1 つ下へずらし、at を空ける。
 * 最後のレイヤーにオブジェクトがあってずらせなければ null。
 */
export function insertLayer(
  scene: Scene,
  at: number,
): { moves: Relayout; layers: LayerState[] } | null {
  if (scene.objects.some((o) => o.layer >= MAX_LAYERS && o.layer >= at)) return null;
  const moves: Relayout = new Map();
  for (const o of scene.objects) if (o.layer >= at) moves.set(o.id, { layer: o.layer + 1 });
  const layers = remapLayers(scene.layers, (i) =>
    i >= at ? (i + 1 > MAX_LAYERS ? null : i + 1) : i,
  ).map((l) =>
    // まとまりの中に挿入したら、まとまりを 1 つ広げる
    l.fold && l.index < at && at <= l.index + l.fold ? { ...l, fold: l.fold + 1 } : l,
  );
  return { moves, layers };
}

/**
 * レイヤーの削除：at のオブジェクトを削除し、後ろのレイヤーを中身ごと 1 つ上へ詰める。
 * ロックされたレイヤーは削除できない（null）。
 */
export function deleteLayer(
  scene: Scene,
  at: number,
): { remove: Set<string>; moves: Relayout; layers: LayerState[] } | null {
  if (lockedSet(scene).has(at)) return null;
  const remove = new Set(scene.objects.filter((o) => o.layer === at).map((o) => o.id));
  const moves: Relayout = new Map();
  for (const o of scene.objects) if (o.layer > at) moves.set(o.id, { layer: o.layer - 1 });
  const layers = remapLayers(scene.layers, (i) => (i === at ? null : i > at ? i - 1 : i)).map(
    (l) => {
      // まとまりの中のレイヤーを消したら、まとまりを 1 つ狭める
      if (!l.fold || !(l.index < at && at <= l.index + l.fold)) return l;
      const { fold, collapsed, ...rest } = l;
      return fold > 1 ? { ...rest, fold: fold - 1, ...(collapsed ? { collapsed } : {}) } : rest;
    },
  );
  return { remove, moves, layers };
}

/** 配置を変えた結果、同じレイヤーで重なるオブジェクトがあるか */
export function relayoutCollides(
  scene: Scene,
  moves: Relayout,
  remove = new Set<string>(),
): boolean {
  const placed = scene.objects
    .filter((o) => !remove.has(o.id))
    .map((o) => ({ ...o, ...moves.get(o.id) }));
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (a.layer === b.layer && rangesOverlap(a.start, a.length, b.start, b.length)) return true;
    }
  }
  return false;
}

/** 同じレイヤーで、obj の直前にあるオブジェクト */
export function previousOnLayer(scene: Scene, obj: TimelineObject): TimelineObject | undefined {
  let best: TimelineObject | undefined;
  for (const o of scene.objects) {
    if (o.id === obj.id || o.layer !== obj.layer || objectEnd(o) > obj.start) continue;
    if (!best || objectEnd(o) > objectEnd(best)) best = o;
  }
  return best;
}

/**
 * 折りたたみ：レイヤー設定の fold（下に続く何レイヤーをまとめるか）と collapsed から、
 * タイムラインに表示するレイヤーの並びを求める。
 */
export function visibleLayerRows(layers: LayerState[], maxLayers = MAX_LAYERS): number[] {
  const rows: number[] = [];
  let hiddenUntil = 0;
  for (let i = 1; i <= maxLayers; i++) {
    if (i <= hiddenUntil) continue;
    rows.push(i);
    const st = layers.find((l) => l.index === i);
    if (st?.collapsed && st.fold) hiddenUntil = i + st.fold;
  }
  return rows;
}

/** レイヤー i を含むまとまりの先頭レイヤー（まとまりに入っていなければ undefined） */
export function foldHeaderOf(layers: LayerState[], i: number): LayerState | undefined {
  return layers.find((l) => l.fold && l.index < i && i <= l.index + l.fold);
}
