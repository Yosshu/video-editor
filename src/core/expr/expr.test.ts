import { describe, expect, it } from 'vitest';
import { evalExpr, exprError, parseExpr, type ExprScope } from './expr';

const scope = (vars: Record<string, number>, call?: ExprScope['call']): ExprScope => ({
  variable: (n) => vars[n],
  call,
});
const ev = (src: string, vars: Record<string, number> = {}, call?: ExprScope['call']) =>
  evalExpr(parseExpr(src), scope(vars, call));

describe('式', () => {
  it('四則演算と優先順位', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('(1 + 2) * 3')).toBe(9);
    expect(ev('-2 ^ 2')).toBe(-4);
    expect(ev('2 ^ 3 ^ 2')).toBe(512);
    expect(ev('10 % 4')).toBe(2);
    expect(ev('.5 + 1e2')).toBe(100.5);
  });

  it('比較・論理・条件', () => {
    expect(ev('time < 1 ? 0 : 100', { time: 0.5 })).toBe(0);
    expect(ev('time < 1 ? 0 : 100', { time: 2 })).toBe(100);
    expect(ev('1 == 1 && 2 > 3')).toBe(0);
    expect(ev('0 || 5')).toBe(5);
    expect(ev('!0')).toBe(1);
  });

  it('関数・定数・変数', () => {
    expect(ev('sin(pi / 2)')).toBeCloseTo(1);
    expect(ev('clamp(x * 2, 0, 10)', { x: 7 })).toBe(10);
    expect(ev('lerp(0, 100, 0.25)')).toBe(25);
    expect(ev('max(1, 5, 3)')).toBe(5);
    expect(ev('deg(rad(90))')).toBeCloseTo(90);
    const r = ev('random(3)');
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(1);
    expect(ev('random(3)')).toBe(r);
    expect(ev('random(3, 1)')).not.toBe(r);
    expect(Math.abs(ev('noise(1.5)'))).toBeLessThanOrEqual(1);
  });

  it('文字列の引数を取る関数（レイヤーの参照など）', () => {
    const call: ExprScope['call'] = (name, args) =>
      name === 'layer' && args[0] === 2 && args[1] === 'x' ? 40 : undefined;
    expect(ev('layer(2, "x") + 1', {}, call)).toBe(41);
    expect(() => ev('layer(3, "x")', {}, call)).toThrow('layer');
  });

  it('誤りを分かりやすく伝え、JavaScript は実行しない', () => {
    expect(exprError('1 +')).toContain('途中');
    expect(exprError('foo + 1')).toContain('foo');
    expect(exprError('x + 1', ['x'])).toBeNull();
    expect(exprError('alert(1)')).toContain('alert');
    expect(exprError('constructor.constructor("return 1")()')).not.toBeNull();
    expect(exprError('a; b')).not.toBeNull();
    expect(exprError('x'.repeat(3000))).toContain('長すぎ');
  });

  it('計算できない値は 0 にする', () => {
    expect(ev('1 / 0')).toBe(0);
    expect(ev('sqrt(-1)')).toBe(0);
  });
});
