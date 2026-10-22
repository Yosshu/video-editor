import { describe, expect, it } from 'vitest';
import { sequenceFileName, sortSequenceFiles } from './sequence';

describe('連番画像', () => {
  it('名前の数字を数として並べる', () => {
    const names = ['f10.png', 'f2.png', 'f1.png', 'F3.png'].map((name) => ({ name }));
    expect(sortSequenceFiles(names).map((f) => f.name)).toEqual([
      'f1.png',
      'f2.png',
      'F3.png',
      'f10.png',
    ]);
  });

  it('最初と最後の番号から動画の名前を作る', () => {
    expect(sequenceFileName('frame_0001.png', 'frame_0120.png')).toBe('frame_0001-0120.webm');
    expect(sequenceFileName('shot1_a.png', 'shot9_a.png')).toBe('shot1_a-9_a.webm');
    expect(sequenceFileName('a.png', 'b.png')).toBe('a.webm');
  });
});
