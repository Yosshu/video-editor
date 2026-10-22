import { describe, expect, it } from 'vitest';
import { createObject, createProject } from './factory';
import { convertFrameRate } from './convert';

describe('convertFrameRate', () => {
  it('30fps → 60fps でオブジェクト・キー・マーカー・グリッドを換算する', () => {
    const p = createProject({ fps: { num: 30, den: 1 } });
    const scene = p.scenes[0];
    const a = createObject('text', 1, 15, 30, {
      params: {
        x: {
          keys: [
            { t: 0, v: 0 },
            { t: 10, v: 100, ease: 'linear' },
          ],
        },
      },
    });
    a.effects.push({
      id: 'fx',
      type: 'blur',
      enabled: true,
      params: { radius: { keys: [{ t: 5, v: 1 }] } },
    });
    scene.objects = [a];
    scene.markers = [{ id: 'm', frame: 45 }];
    scene.beatGrid = { bpm: 120, offset: 3, beatsPerBar: 4, visible: true };
    convertFrameRate(p, { num: 60, den: 1 });
    expect(p.settings.fps).toEqual({ num: 60, den: 1 });
    expect(a.start).toBe(30);
    expect(a.length).toBe(60);
    expect(a.params.x).toEqual({
      keys: [
        { t: 0, v: 0 },
        { t: 20, v: 100, ease: 'linear' },
      ],
    });
    expect(a.effects[0].params.radius).toEqual({ keys: [{ t: 10, v: 1 }] });
    expect(scene.markers[0].frame).toBe(90);
    expect(scene.beatGrid.offset).toBe(6);
  });

  it('下げても隣り合うオブジェクトは重ならず、長さは 1 以上', () => {
    const p = createProject({ fps: { num: 60, den: 1 } });
    const a = createObject('text', 1, 0, 3);
    const b = createObject('text', 1, 3, 1);
    const c = createObject('text', 1, 4, 5);
    p.scenes[0].objects = [a, b, c];
    convertFrameRate(p, { num: 24, den: 1 });
    expect(a.start + a.length).toBeLessThanOrEqual(b.start);
    expect(b.start + b.length).toBeLessThanOrEqual(c.start);
    expect(b.length).toBeGreaterThanOrEqual(1);
  });

  it('29.97fps のような分数のフレームレートにも換算できる', () => {
    const p = createProject({ fps: { num: 30, den: 1 } });
    const a = createObject('text', 1, 300, 300);
    p.scenes[0].objects = [a];
    convertFrameRate(p, { num: 30000, den: 1001 });
    expect(a.start).toBe(300);
    expect(a.length).toBe(299);
  });
});
