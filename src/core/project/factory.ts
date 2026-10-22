import { newId } from '../model/ids';
import type { ObjectType, Project, ProjectSettings, Scene, TimelineObject } from '../model/types';
import { t } from '../../i18n';

export const FORMAT_ID = 'vedproj';
export const FORMAT_VERSION = 1;
export const PROJECT_EXTENSION = '.vedproj';
/** 素材同梱パッケージ（ZIP）の拡張子と、先頭の mimetype に書く値 */
export const PACKAGE_EXTENSION = '.vedpack';
export const PACKAGE_MIMETYPE = 'application/x-vedpack';

export const DEFAULT_SETTINGS: ProjectSettings = {
  width: 1920,
  height: 1080,
  fps: { num: 30, den: 1 },
  sampleRate: 48000,
  audioChannels: 2,
  backgroundColor: '#000000',
};

export const RESOLUTION_PRESETS: { label: string; width: number; height: number }[] = [
  { label: '1920×1080（横長 フルHD）', width: 1920, height: 1080 },
  { label: '1280×720（横長 HD）', width: 1280, height: 720 },
  { label: '3840×2160（横長 4K）', width: 3840, height: 2160 },
  { label: '1080×1920（縦型）', width: 1080, height: 1920 },
  { label: '1080×1080（正方形）', width: 1080, height: 1080 },
];

export function createScene(name: string, width: number, height: number): Scene {
  return { id: newId('sc'), name, width, height, layers: [], objects: [] };
}

export function createProject(settings: Partial<ProjectSettings> = {}): Project {
  const s: ProjectSettings = { ...DEFAULT_SETTINGS, ...settings };
  const scene = createScene(t('メイン'), s.width, s.height);
  const now = new Date().toISOString();
  return {
    format: FORMAT_ID,
    formatVersion: FORMAT_VERSION,
    generator: {
      name: 'video-editor',
      version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
    },
    createdAt: now,
    updatedAt: now,
    settings: s,
    assets: [],
    rootSceneId: scene.id,
    scenes: [scene],
  };
}

export function createObject(
  type: ObjectType,
  layer: number,
  start: number,
  length: number,
  init: Partial<Pick<TimelineObject, 'assetId' | 'params'>> = {},
): TimelineObject {
  return {
    id: newId('ob'),
    type,
    layer,
    start,
    length,
    ...(init.assetId ? { assetId: init.assetId } : {}),
    params: init.params ?? {},
    effects: [],
  };
}

export function findScene(project: Project, sceneId: string): Scene | undefined {
  return project.scenes.find((s) => s.id === sceneId);
}
