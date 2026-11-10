import { describe, expect, it } from 'vitest';
import { createObject, createProject } from '../core/project/factory';
import { beginGesture, commit, endGesture, getState, redo, replaceProject, undo } from './store';

function setup() {
  const project = createProject();
  project.scenes[0].objects = [createObject('shape', 1, 0, 30)];
  replaceProject(project, null);
  return project.scenes[0].objects[0].id;
}

/** 試験用：オブジェクトの x・y を変える（実際の操作と同じく別々の履歴キーで） */
function move(id: string, key: 'x' | 'y', v: number) {
  commit(
    'move',
    (d) => {
      d.scenes[0].objects.find((o) => o.id === id)!.params[key] = v;
    },
    { mergeKey: `param:${id}:${key}` },
  );
}

const params = (id: string) =>
  getState().project.scenes[0].objects.find((o) => o.id === id)!.params;

describe('履歴', () => {
  it('1 つの操作の間の変更は、別々のパラメータでも 1 回で元に戻る・やり直せる', () => {
    const id = setup();
    beginGesture();
    for (let i = 1; i <= 20; i++) {
      move(id, 'x', i * 10);
      move(id, 'y', i * 5);
    }
    endGesture();
    expect(getState().past).toHaveLength(1);
    expect(params(id)).toMatchObject({ x: 200, y: 100 });
    undo();
    expect(params(id).x).toBeUndefined();
    expect(params(id).y).toBeUndefined();
    redo();
    expect(params(id)).toMatchObject({ x: 200, y: 100 });
  });

  it('操作が終われば、次の変更は別の履歴になる', () => {
    const id = setup();
    beginGesture();
    move(id, 'x', 10);
    endGesture();
    beginGesture();
    move(id, 'x', 20);
    endGesture();
    move(id, 'x', 30);
    expect(getState().past).toHaveLength(3);
    undo();
    expect(params(id).x).toBe(20);
    undo();
    expect(params(id).x).toBe(10);
  });

  it('操作の外では、これまでどおり同じキーの続けた変更だけをまとめる', () => {
    const id = setup();
    move(id, 'x', 10);
    move(id, 'x', 20);
    move(id, 'y', 5);
    expect(getState().past).toHaveLength(2);
  });
});
