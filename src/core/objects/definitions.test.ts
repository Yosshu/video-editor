import { describe, expect, it } from 'vitest';
import { OBJECT_TYPES } from './definitions';

describe('オブジェクトの定義', () => {
  it('同じ種類の中でパラメータの ID が重ならない', () => {
    for (const def of Object.values(OBJECT_TYPES)) {
      const ids = def.params.map((p) => p.id);
      const duplicated = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect(duplicated, def.type).toEqual([]);
    }
  });
});
