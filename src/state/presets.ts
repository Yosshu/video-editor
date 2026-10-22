import { z } from 'zod';
import { create } from 'zustand';
import type { EffectInstance, ObjectType, ParamMap } from '../core/model/types';
import { effectSchema, paramMapSchema } from '../core/schema/projectSchema';

/**
 * オブジェクト・エフェクトの設定のプリセット。プロジェクトをまたいで使うので、ブラウザに保存する。
 * ファイル（.json）への書き出し・読み込みもできる。
 */
export interface ObjectPreset {
  id: string;
  name: string;
  type: ObjectType;
  params: ParamMap;
  effects: EffectInstance[];
}

export interface EffectPreset {
  id: string;
  name: string;
  type: string;
  params: ParamMap;
}

export interface PresetCollection {
  objects: ObjectPreset[];
  effects: EffectPreset[];
}

const STORAGE_KEY = 'video-editor:presets';
export const PRESET_FORMAT = 'vedpreset';

const collectionSchema = z.object({
  objects: z
    .array(
      z
        .object({
          id: z.string().max(128),
          name: z.string().max(200),
          type: z.string().max(64),
          params: paramMapSchema,
          effects: z.array(effectSchema).max(1_000),
        })
        .loose(),
    )
    .max(10_000),
  effects: z
    .array(
      z
        .object({
          id: z.string().max(128),
          name: z.string().max(200),
          type: z.string().max(128),
          params: paramMapSchema,
        })
        .loose(),
    )
    .max(10_000),
});

/** 保存・読み込みしたデータを検証する（不正なら null） */
export function parsePresets(data: unknown): PresetCollection | null {
  const r = collectionSchema.safeParse(data);
  return r.success ? (r.data as PresetCollection) : null;
}

function load(): PresetCollection {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return parsePresets(JSON.parse(raw)) ?? { objects: [], effects: [] };
  } catch {
    // 読めなければ空から始める
  }
  return { objects: [], effects: [] };
}

export const usePresets = create<PresetCollection>(() => load());

/** プリセットを変更して保存する */
export function updatePresets(fn: (current: PresetCollection) => PresetCollection): void {
  const next = fn(usePresets.getState());
  usePresets.setState(next, true);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 保存できない環境では、このページを開いている間だけ有効
  }
}
