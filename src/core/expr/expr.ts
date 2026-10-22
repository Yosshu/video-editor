/**
 * パラメータの「式」。他のパラメータや時刻から値を計算する。
 * 編集ファイルの中の文字列をプログラムとして実行しないよう、JavaScript の eval は使わず、
 * 四則演算・比較・条件・決まった関数だけを持つ小さな言語として自前で解釈する。
 *
 * 例：`sin(time * 2) * 100`、`x + 50`、`layer(2, "y") * -1`、`time < 1 ? 0 : 100`
 */

import { t } from '../../i18n';

export type ExprNode =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'var'; name: string }
  | { k: 'un'; op: '-' | '!' | '+'; a: ExprNode }
  | { k: 'bin'; op: string; a: ExprNode; b: ExprNode }
  | { k: 'cond'; c: ExprNode; a: ExprNode; b: ExprNode }
  | { k: 'call'; name: string; args: ExprNode[] };

export class ExprError extends Error {}

/** 式の長さ・入れ子の深さの上限（異常な入力で固まらないように） */
const MAX_LENGTH = 2_000;
const MAX_DEPTH = 64;

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string };

const OPS = [
  '<=',
  '>=',
  '==',
  '!=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '<',
  '>',
  '!',
  '?',
  ':',
  '(',
  ')',
  ',',
];

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ t: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) {
      out.push({ t: 'id', v: id[0] });
      i += id[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new ExprError(t('文字列が閉じていません'));
      out.push({ t: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(t('使えない文字です：{0}', c));
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  return out;
}

/** 二項演算子の優先順位（大きいほど先に計算する） */
const PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '>': 4,
  '<=': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
  '^': 8,
};

export function parseExpr(src: string): ExprNode {
  if (src.length > MAX_LENGTH) throw new ExprError(t('式が長すぎます'));
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new ExprError(t('「{0}」が必要です', v));
    pos++;
  };

  const primary = (depth: number): ExprNode => {
    if (depth > MAX_DEPTH) throw new ExprError(t('式の入れ子が深すぎます'));
    const tok = peek();
    if (!tok) throw new ExprError(t('式が途中で終わっています'));
    pos++;
    if (tok.t === 'num') return { k: 'num', v: tok.v };
    if (tok.t === 'str') return { k: 'str', v: tok.v };
    if (tok.t === 'id') {
      if (isOp('(')) {
        pos++;
        const args: ExprNode[] = [];
        if (!isOp(')')) {
          for (;;) {
            args.push(ternary(depth + 1));
            if (isOp(',')) {
              pos++;
              continue;
            }
            break;
          }
        }
        expect(')');
        return { k: 'call', name: tok.v, args };
      }
      return { k: 'var', name: tok.v };
    }
    if (tok.v === '(') {
      const e = ternary(depth + 1);
      expect(')');
      return e;
    }
    if (tok.v === '-' || tok.v === '+' || tok.v === '!') {
      // 単項演算子は累乗より弱く結び付ける（-2^2 = -4）
      return { k: 'un', op: tok.v, a: binary(PRECEDENCE['*'] + 1, depth + 1) };
    }
    throw new ExprError(t('ここに「{0}」は書けません', tok.v));
  };

  const binary = (minPrec: number, depth: number): ExprNode => {
    let left = primary(depth);
    for (;;) {
      const tok = peek();
      if (tok?.t !== 'op' || PRECEDENCE[tok.v] === undefined || PRECEDENCE[tok.v] < minPrec) break;
      pos++;
      // ^ は右から結び付ける（2^3^2 = 2^9）
      const next = tok.v === '^' ? PRECEDENCE[tok.v] : PRECEDENCE[tok.v] + 1;
      left = { k: 'bin', op: tok.v, a: left, b: binary(next, depth + 1) };
    }
    return left;
  };

  const ternary = (depth: number): ExprNode => {
    if (depth > MAX_DEPTH) throw new ExprError(t('式の入れ子が深すぎます'));
    const c = binary(1, depth);
    if (!isOp('?')) return c;
    pos++;
    const a = ternary(depth + 1);
    expect(':');
    const b = ternary(depth + 1);
    return { k: 'cond', c, a, b };
  };

  if (tokens.length === 0) throw new ExprError(t('式が空です'));
  const tree = ternary(0);
  if (pos < tokens.length) throw new ExprError(t('余分な「{0}」があります', String(tokens[pos].v)));
  return tree;
}

/** 0 以上 1 未満の、整数から決まる乱数 */
function hash(n: number, seed: number): number {
  let h =
    (Math.imul(Math.floor(n) | 0, 0x9e3779b1) ^ Math.imul(Math.floor(seed) | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

type Fn = (...args: number[]) => number;

const FUNCTIONS: Record<string, Fn> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  abs: Math.abs,
  sign: Math.sign,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sqrt: Math.sqrt,
  pow: Math.pow,
  exp: Math.exp,
  log: Math.log,
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  lerp: (a, b, t) => a + (b - a) * t,
  /** 角度の変換 */
  rad: (d) => (d * Math.PI) / 180,
  deg: (r) => (r * 180) / Math.PI,
  /** 整数 n ごとに決まる 0〜1 の乱数（seed を変えると別の並び） */
  random: (n, seed = 0) => hash(n, seed),
  /** なめらかに変化する -1〜1 の値 */
  noise: (x, seed = 0) => {
    const i = Math.floor(x);
    const f = x - i;
    const s = f * f * (3 - 2 * f);
    const a = hash(i, seed) * 2 - 1;
    const b = hash(i + 1, seed) * 2 - 1;
    return a + (b - a) * s;
  },
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, true: 1, false: 0 };

export interface ExprScope {
  /** 変数の値（なければ ExprError） */
  variable(name: string): number | undefined;
  /** 文字列の引数を取る関数（layer(2, "x") など） */
  call?(name: string, args: (number | string)[]): number | undefined;
}

export function evalExpr(node: ExprNode, scope: ExprScope): number {
  const num = (n: ExprNode): number => {
    const v = ev(n);
    if (typeof v !== 'number') throw new ExprError(t('数値が必要なところに文字列があります'));
    return v;
  };
  const ev = (n: ExprNode): number | string => {
    switch (n.k) {
      case 'num':
      case 'str':
        return n.v;
      case 'var': {
        if (n.name in CONSTANTS) return CONSTANTS[n.name];
        const v = scope.variable(n.name);
        if (v === undefined) throw new ExprError(t('「{0}」はありません', n.name));
        return v;
      }
      case 'un': {
        const a = num(n.a);
        return n.op === '-' ? -a : n.op === '!' ? Number(!a) : a;
      }
      case 'cond':
        return num(n.c) ? ev(n.a) : ev(n.b);
      case 'bin': {
        if (n.op === '&&') return num(n.a) ? num(n.b) : 0;
        if (n.op === '||') {
          const a = num(n.a);
          return a ? a : num(n.b);
        }
        const a = num(n.a);
        const b = num(n.b);
        switch (n.op) {
          case '+':
            return a + b;
          case '-':
            return a - b;
          case '*':
            return a * b;
          case '/':
            return a / b;
          case '%':
            return a % b;
          case '^':
            return a ** b;
          case '<':
            return Number(a < b);
          case '>':
            return Number(a > b);
          case '<=':
            return Number(a <= b);
          case '>=':
            return Number(a >= b);
          case '==':
            return Number(a === b);
          case '!=':
            return Number(a !== b);
        }
        throw new ExprError(t('演算子「{0}」は使えません', n.op));
      }
      case 'call': {
        const fn = FUNCTIONS[n.name];
        if (fn) return fn(...n.args.map(num));
        const v = scope.call?.(n.name, n.args.map(ev));
        if (v === undefined) throw new ExprError(t('関数「{0}」はありません', n.name));
        return v;
      }
    }
  };
  const result = num(node);
  return Number.isFinite(result) ? result : 0;
}

const cache = new Map<string, ExprNode | ExprError>();

/** 式を解釈して覚えておく（同じ式は 1 回だけ解釈する） */
export function compileExpr(src: string): ExprNode {
  let c = cache.get(src);
  if (!c) {
    try {
      c = parseExpr(src);
    } catch (e) {
      c = e instanceof ExprError ? e : new ExprError(String(e));
    }
    if (cache.size > 500) cache.clear();
    cache.set(src, c);
  }
  if (c instanceof ExprError) throw c;
  return c;
}

/** 式の誤りを返す（正しければ null）。variables・functions は使ってよい変数名と、文字列を取れる関数名 */
export function exprError(
  src: string,
  variables: string[] = [],
  functions: string[] = ['layer'],
): string | null {
  try {
    const node = compileExpr(src);
    // 名前の確認だけ行うため、すべて 1 として計算してみる
    evalExpr(node, {
      variable: (name) => (variables.includes(name) ? 1 : undefined),
      call: (name) => (functions.includes(name) ? 1 : undefined),
    });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
