import type { Project } from '../model/types';
import { projectSchema } from '../schema/projectSchema';
import { FORMAT_ID, FORMAT_VERSION } from './factory';

/** 編集ファイルとして読み込める最大サイズ（文字数） */
const MAX_FILE_CHARS = 64 * 1024 * 1024;

export class ProjectFileError extends Error {}

export interface ParseResult {
  project: Project;
  warnings: string[];
}

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * formatVersion を 1 段ずつ上げる移行関数。
 * キー n は「バージョン n のデータを n+1 にする」関数。形式を変えるときはここに追加する。
 */
const MIGRATIONS: Record<number, Migration> = {};

export function migrate(data: Record<string, unknown>): Record<string, unknown> {
  let current = data;
  let version = Number(current.formatVersion);
  while (version < FORMAT_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new ProjectFileError(`バージョン ${version} の編集ファイルを変換できません。`);
    current = { ...step(current), formatVersion: version + 1 };
    version += 1;
  }
  return current;
}

export function serializeProject(project: Project): string {
  return JSON.stringify({ ...project, updatedAt: new Date().toISOString() }, null, 2);
}

export function parseProject(text: string): ParseResult {
  if (text.length > MAX_FILE_CHARS) throw new ProjectFileError('編集ファイルが大きすぎます。');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProjectFileError(
      '編集ファイルを読み取れませんでした（JSON の形式が正しくありません）。',
    );
  }
  if (
    typeof data !== 'object' ||
    data === null ||
    (data as { format?: unknown }).format !== FORMAT_ID
  ) {
    throw new ProjectFileError('このアプリの編集ファイルではありません。');
  }
  const warnings: string[] = [];
  const version = Number((data as { formatVersion?: unknown }).formatVersion);
  if (!Number.isInteger(version) || version < 1) {
    throw new ProjectFileError('編集ファイルのバージョンが不正です。');
  }
  if (version > FORMAT_VERSION) {
    warnings.push(
      'このファイルは新しいバージョンのアプリで保存されています。一部の内容が正しく表示されない可能性があります。',
    );
  }
  const migrated = version < FORMAT_VERSION ? migrate(data as Record<string, unknown>) : data;
  const result = projectSchema.safeParse(migrated);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.join('.') || '(全体)';
    throw new ProjectFileError(
      `編集ファイルの内容が正しくありません：${where} ${first?.message ?? ''}`,
    );
  }
  const project = result.data as unknown as Project;
  if (!project.scenes.some((s) => s.id === project.rootSceneId)) {
    throw new ProjectFileError(
      '編集ファイルの内容が正しくありません：メインのシーンが見つかりません。',
    );
  }
  return { project, warnings };
}
