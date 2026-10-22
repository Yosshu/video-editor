import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

/** public フォルダのファイル一覧（相対パス） */
function publicFiles(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? publicFiles(path, root)
      : [relative(root, path).replace(/\\/g, '/')];
  });
}

/**
 * オフライン用の Service Worker（sw.js）を出力する。
 * ビルドしたファイルの一覧を埋め込み、一覧が変わればキャッシュ名も変わる。
 */
function serviceWorker(): Plugin {
  return {
    name: 'video-editor-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = [
        './',
        ...Object.keys(bundle).filter((f) => !f.endsWith('.map')),
        ...publicFiles(new URL('./public', import.meta.url).pathname),
      ].filter((f, i, all) => all.indexOf(f) === i && f !== 'index.html');
      const hash = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync(new URL('./scripts/sw-template.js', import.meta.url), 'utf-8')
        .replace(
          "const CACHE = '__CACHE__';",
          `const CACHE = 'video-editor-${pkg.version}-${hash}';`,
        )
        .replace('const ASSETS = __ASSETS__;', `const ASSETS = ${JSON.stringify(assets)};`);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// GitHub Pages ではリポジトリ名のサブパスで公開される
export default defineConfig({
  base: '/video-editor/',
  plugins: [react(), serviceWorker()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    // 動画処理ライブラリを含むため 1 ファイルが大きめ（圧縮後で約 300KB）
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
