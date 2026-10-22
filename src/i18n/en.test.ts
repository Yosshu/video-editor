/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { EN } from './en';

const JP = /[぀-ヿ一-鿿]/;
/** 翻訳しない文言（言語の選択肢そのもの） */
const NOT_TRANSLATED = new Set(['日本語', 'Language / 言語']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'i18n' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|d)\.ts$/.test(name) ? [path] : [];
  });
}

/** ソースの中の日本語の文言（コメント・開発者向けのログ・シェーダーのコードを除く） */
function collect(): { text: string; where: string; kind: 'string' | 'jsx' | 'template' }[] {
  const out: { text: string; where: string; kind: 'string' | 'jsx' | 'template' }[] = [];
  for (const file of sourceFiles('src')) {
    const sf = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const where = (n: ts.Node) =>
      `${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) return;
      if (ts.isCallExpression(node) && node.expression.getText().startsWith('console.')) return;
      if (
        (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
        JP.test(node.text)
      ) {
        const p = node.parent;
        const isKey = ts.isPropertyAssignment(p) && p.name === node;
        const isShader = /void main\(|#version/.test(node.text);
        if (!isKey && !isShader) out.push({ text: node.text, where: where(node), kind: 'string' });
        return;
      }
      if (ts.isTemplateExpression(node)) {
        const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
        if (parts.some((p) => JP.test(p)) && !/void main\(|#version/.test(node.getText()))
          out.push({ text: node.getText(), where: where(node), kind: 'template' });
      }
      if (ts.isJsxText(node) && JP.test(node.text))
        out.push({ text: node.text.trim(), where: where(node), kind: 'jsx' });
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

const placeholders = (s: string) => [...new Set(s.match(/\{\d+\}/g) ?? [])].sort();

describe('英語の辞書', () => {
  const found = collect();

  it('画面に出す日本語の文言にはすべて英語がある', () => {
    const missing = found
      .filter((f) => f.kind === 'string' && !NOT_TRANSLATED.has(f.text) && !(f.text in EN))
      .map((f) => `${f.where}  ${JSON.stringify(f.text)}`);
    expect(missing).toEqual([]);
  });

  it('文言は t() で包み、テンプレート文字列や JSX の地の文に日本語を直接書かない', () => {
    const raw = found
      .filter((f) => f.kind !== 'string' && !NOT_TRANSLATED.has(f.text))
      .map((f) => `${f.where}  ${f.text}`);
    expect(raw).toEqual([]);
  });

  it('差し込み位置（{0} など）が日本語と英語で一致する', () => {
    const bad = Object.entries(EN)
      .filter(([ja, en]) => placeholders(ja).join() !== placeholders(en).join())
      .map(([ja]) => ja);
    expect(bad).toEqual([]);
  });
});
