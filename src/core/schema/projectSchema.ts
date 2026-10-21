import { z } from 'zod';

/**
 * 編集ファイルの検証用スキーマ。
 * 知らない項目は削除せずに残す（新しいバージョンで追加された項目を、古いバージョンで保存しても失わないため）。
 */

const finite = z.number().refine(Number.isFinite, '数値が不正です');

const easeSchema = z.union([
  z.string().max(64),
  z.object({ bezier: z.tuple([finite, finite, finite, finite]) }).loose(),
]);

const keyframeSchema = z
  .object({
    t: finite,
    v: finite,
    ease: easeSchema.optional(),
  })
  .loose();

const paramValueSchema = z.union([
  finite,
  z.string().max(100_000),
  z.boolean(),
  z.object({ keys: z.array(keyframeSchema).max(10_000) }).loose(),
]);

const paramMapSchema = z.record(z.string().max(128), paramValueSchema);

const effectSchema = z
  .object({
    id: z.string().max(128),
    type: z.string().max(128),
    enabled: z.boolean(),
    params: paramMapSchema,
  })
  .loose();

const objectSchema = z
  .object({
    id: z.string().max(128),
    type: z.enum(['video', 'image', 'audio', 'text', 'shape', 'solid', 'filter']),
    layer: z.number().int().min(1).max(10_000),
    start: z.number().int().min(0),
    length: z.number().int().min(1),
    assetId: z.string().max(128).optional(),
    params: paramMapSchema,
    effects: z.array(effectSchema).max(1_000),
  })
  .loose();

const layerSchema = z
  .object({
    index: z.number().int().min(1),
    name: z.string().max(1_000).optional(),
    hidden: z.boolean().optional(),
    locked: z.boolean().optional(),
  })
  .loose();

const sceneSchema = z
  .object({
    id: z.string().max(128),
    name: z.string().max(1_000),
    width: z.number().int().min(1).max(16_384),
    height: z.number().int().min(1).max(16_384),
    layers: z.array(layerSchema).max(10_000),
    objects: z.array(objectSchema).max(100_000),
  })
  .loose();

const assetSchema = z
  .object({
    id: z.string().max(128),
    kind: z.enum(['video', 'image', 'audio', 'font']),
    name: z.string().max(4_096),
    mimeType: z.string().max(256),
    size: z.number().min(0),
    lastModified: z.number(),
    fingerprint: z.string().max(256),
    durationSec: finite.optional(),
    width: finite.optional(),
    height: finite.optional(),
    video: z
      .object({ codec: z.string().optional(), frameRate: finite.optional() })
      .loose()
      .optional(),
    audio: z
      .object({ sampleRate: finite, channels: finite, codec: z.string().optional() })
      .loose()
      .optional(),
  })
  .loose();

export const projectSchema = z
  .object({
    format: z.literal('vedproj'),
    formatVersion: z.number().int().min(1),
    generator: z.object({ name: z.string(), version: z.string() }).loose(),
    createdAt: z.string(),
    updatedAt: z.string(),
    settings: z
      .object({
        width: z.number().int().min(16).max(16_384),
        height: z.number().int().min(16).max(16_384),
        fps: z.object({ num: z.number().int().min(1), den: z.number().int().min(1) }),
        sampleRate: z.number().int().min(8_000).max(192_000),
        audioChannels: z.number().int().min(1).max(2),
        backgroundColor: z.string().max(32),
      })
      .loose(),
    assets: z.array(assetSchema).max(10_000),
    rootSceneId: z.string(),
    scenes: z.array(sceneSchema).min(1).max(1_000),
  })
  .loose();
