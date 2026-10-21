import { describe, expect, it } from 'vitest';
import { createObject, createProject } from './factory';
import { parseProject, ProjectFileError, serializeProject } from './serialize';

describe('編集ファイル', () => {
  it('保存して読み込むと同じ内容に戻る', () => {
    const project = createProject({ width: 1280, height: 720 });
    const scene = project.scenes[0];
    scene.objects.push(
      createObject('text', 2, 30, 90, {
        params: {
          text: 'こんにちは',
          x: {
            keys: [
              { t: 0, v: -100, ease: 'easeOutCubic' },
              { t: 30, v: 0 },
            ],
          },
        },
      }),
    );
    scene.layers.push({ index: 2, name: '字幕', locked: true });
    const { project: loaded, warnings } = parseProject(serializeProject(project));
    expect(warnings).toEqual([]);
    expect({ ...loaded, updatedAt: '' }).toEqual({ ...project, updatedAt: '' });
  });

  it('知らない項目は残す', () => {
    const project = createProject();
    const data = JSON.parse(serializeProject(project));
    data.futureField = { a: 1 };
    data.scenes[0].futureSceneField = true;
    const { project: loaded } = parseProject(JSON.stringify(data));
    expect((loaded as unknown as Record<string, unknown>).futureField).toEqual({ a: 1 });
    expect((loaded.scenes[0] as unknown as Record<string, unknown>).futureSceneField).toBe(true);
  });

  it('新しいバージョンのファイルは警告つきで読む', () => {
    const data = JSON.parse(serializeProject(createProject()));
    data.formatVersion = 999;
    const { warnings } = parseProject(JSON.stringify(data));
    expect(warnings.length).toBe(1);
  });

  it('不正なファイルはエラーにする', () => {
    expect(() => parseProject('not json')).toThrow(ProjectFileError);
    expect(() => parseProject('{"format":"other"}')).toThrow(ProjectFileError);
    const data = JSON.parse(serializeProject(createProject()));
    data.scenes[0].objects.push({
      id: 'x',
      type: 'text',
      layer: 0,
      start: 0,
      length: 1,
      params: {},
      effects: [],
    });
    expect(() => parseProject(JSON.stringify(data))).toThrow(ProjectFileError);
  });
});
