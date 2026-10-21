# 03. 技術選定とアーキテクチャ

## 1. 基本方針

1. **静的サイトとして完結する**：サーバー処理は持たず、GitHub Pages にビルド結果を置くだけで動く。
2. **重い処理はブラウザの標準 API に任せる**：動画のデコード・エンコードは WebCodecs（ハードウェアアクセラレーション対応）、合成は WebGL2（GPU）、音声は Web Audio API。
3. **編集ロジックは UI から切り離す**：プロジェクトのデータ構造、タイムライン計算、補間などは DOM に依存しない純粋な TypeScript にする。単体テストしやすく、Worker でも同じコードを使える。
4. **プレビューと書き出しで同じ描画処理を使う**：見た目の食い違いを防ぐ。
5. **データ構造は宣言的に定義する**：オブジェクトやエフェクトのパラメータを定義データとして記述し、設定パネルの UI・保存形式の検証・補間処理をそこから自動で組み立てる。エフェクトの追加がそのまま機能追加になる構造にする。

## 2. 技術スタック

| 用途 | 採用候補 | 理由・備考 |
|---|---|---|
| 言語 | TypeScript | 型でデータ構造の整合性を保つ |
| ビルド | Vite | 高速、Worker・WASM・静的サイト出力が簡単 |
| UI | React | 部品・情報が多い。再生中の頻繁な描画は React を通さず Canvas に直接描くため、フレームワークの重さは問題になりにくい |
| 状態管理 | Zustand + Immer | Immer の差分（パッチ）を使って元に戻す/やり直しを実装しやすい |
| データ検証 | Zod | 編集ファイル読み込み時の形式検証と型の自動生成 |
| 合成描画 | WebGL2（自前の薄いレンダラー） | ほぼ全ブラウザで使える。合成モードやエフェクトをシェーダーで書く。将来 WebGPU 版を追加できるよう抽象化する |
| テキスト描画 | Canvas 2D（OffscreenCanvas）→ テクスチャ | 日本語の文字組み・フォントをブラウザに任せる |
| 動画・音声の読み書き | Mediabunny（MPL-2.0） | MP4 / MOV / WebM / MKV / MP3 / WAV / Ogg / FLAC などの分離・多重化と WebCodecs の連携をまとめて扱える。ファイル全体を読み込まないストリーム処理に対応 |
| デコード・エンコード | WebCodecs | ハードウェア支援が効く。対応コーデックは `isConfigSupported()` で実行時に確認 |
| 音声処理 | Web Audio API（AudioContext / AudioWorklet / OfflineAudioContext） | 再生・ミックス・エフェクト・書き出し用の高速レンダリング |
| ファイル保存 | File System Access API（Chromium 系）＋ ダウンロード方式（その他） | 上書き保存できる環境では上書き、できない環境ではダウンロード |
| ブラウザ内保存 | IndexedDB ＋ OPFS（Origin Private File System） | 自動保存、素材のキャッシュ、ファイルハンドルの保持 |
| ZIP | fflate または zip.js | 素材同梱パッケージ用（Phase 8） |
| テスト | Vitest（単体）、Playwright（E2E・描画結果の比較） | |
| 品質 | ESLint、Prettier、TypeScript の strict モード | |
| CI/CD | GitHub Actions → GitHub Pages | |

将来の選択肢：WebGPU（描画の高速化）、WebAssembly のデコーダー（ブラウザ非対応コーデック）、ブラウザ内推論（AI 機能）。

## 3. ブラウザ対応方針

| ブラウザ | 方針 |
|---|---|
| Chrome / Edge（PC） | 主対象。全機能を動かす |
| Firefox（PC） | WebCodecs は対応済み。File System Access API がないため保存はダウンロード方式。AAC エンコードなど一部コーデックは環境依存 |
| Safari（Mac） | 26 以降で WebCodecs の音声も対応。保存はダウンロード方式 |
| スマホ・タブレット | 当面対象外（起動時に案内を表示） |

- 機能の有無はブラウザ名ではなく **機能検出** で判定する（`'VideoEncoder' in window`、`isConfigSupported()` など）。
- WebCodecs・OPFS・File System Access API は **安全なコンテキスト（HTTPS）** が必要。GitHub Pages は HTTPS なので問題ない。

## 4. 全体構成

```
┌──────────────────────── メインスレッド ────────────────────────┐
│  UI（React）                                                    │
│   メニュー / 素材一覧 / プレビュー / タイムライン / 設定パネル     │
│        │ 操作（コマンド）            ▲ 状態の購読                │
│        ▼                            │                          │
│  Store（Zustand + Immer）── Undo/Redo 履歴                       │
│        │ プロジェクト（純粋なデータ）                             │
│        ▼                                                        │
│  Core：Evaluator（時刻 → 描画ツリー）← Animation（補間）          │
│        │ 描画ツリー                                              │
│        ▼                                                        │
│  Engine：Renderer（WebGL2）→ プレビュー Canvas                   │
│          AudioEngine（Web Audio）→ スピーカー                    │
└────────┬──────────────────────────────────────────────────────┘
         │ VideoFrame / PCM（Transferable で受け渡し）
┌────────▼────────── Worker ─────────────┐   ┌──── Worker ────────────┐
│ MediaWorker：分離・デコード・            │   │ ExportWorker：          │
│ フレームキャッシュ・サムネイル・波形     │   │ 描画 → エンコード → 多重化 │
└─────────────────────────────────────────┘   └────────────────────────┘
         ▲
┌────────┴──────── Storage ───────────────┐
│ 編集ファイル入出力 / 自動保存（IndexedDB）│
│ 素材キャッシュ（OPFS）/ ファイルハンドル    │
└──────────────────────────────────────────┘
```

## 5. ディレクトリ構成（案）

```
src/
  core/              # UI に依存しない純粋なロジック（単体テストの中心）
    model/           #   型定義（Project, Scene, Layer, TimelineObject, Effect …）
    schema/          #   Zod スキーマ、編集ファイルの検証・バージョン移行
    params/          #   パラメータ定義（型・範囲・既定値・補間可否）
    timeline/        #   配置・衝突判定・分割・スナップ・選択範囲の計算
    animation/       #   キーフレーム補間、イージング
    evaluate/        #   フレーム番号 → 描画ツリー（RenderGraph）の生成
    commands/        #   編集コマンド（Undo/Redo の単位）
  engine/
    render/          #   WebGL2 レンダラー、テクスチャプール、合成モード
    effects/         #   エフェクト定義（パラメータ定義 + シェーダー）
    objects/         #   オブジェクト種別ごとの描画（画像・テキスト・図形 …）
    media/           #   素材の解析、デコード要求、フレームキャッシュ
    audio/           #   ミキサー、再生、波形生成
    export/          #   書き出しパイプライン
    workers/         #   Worker のエントリーポイント
  storage/           # 編集ファイルの保存/読込、自動保存、素材キャッシュ、再リンク
  ui/
    app/             #   レイアウト、メニュー、ショートカット、ダイアログ
    timeline/
    preview/
    inspector/       #   設定パネル（パラメータ定義から自動生成）
    media-bin/       #   素材一覧
  i18n/              # 文言（日本語を既定、英語は後で追加）
tests/
  e2e/               # Playwright
  fixtures/          # テスト用の小さな動画・画像・音声
public/
docs/
.github/workflows/
```

## 6. 描画パイプライン

### 6.1 1フレームの描画手順

1. **Evaluator**：シーンとフレーム番号から、その時刻に存在するオブジェクトをレイヤー順に集める。
2. 制御オブジェクトを解決する（時間制御で各オブジェクトの「素材上の時刻」を決める、グループ制御・カメラ制御で変形を合成する）。
3. 各パラメータをキーフレームから補間して確定値にする。
4. 以上をまとめた **描画ツリー（RenderGraph）** を作る。描画ツリーはただのデータで、テストで中身を検証できる。
5. **Renderer** が描画ツリーを実行する。
   - オブジェクトごとに素材のテクスチャを用意（動画フレーム・画像・テキストの描画結果・図形）
   - オブジェクト専用のバッファ上でエフェクトを順に適用（2枚のバッファを交互に使う）。ぼかし・影など描画範囲が広がるエフェクトは余白を確保する
   - 座標変換・不透明度・合成モードのシェーダーでシーンのバッファに合成
   - フィルタオブジェクトはシーンのバッファ全体にエフェクトをかける
   - シーンオブジェクトは別のバッファに再帰的に描画して素材として使う（循環参照は禁止）
6. プレビューでは Canvas に表示し、書き出しでは結果を `VideoFrame` にしてエンコーダーへ渡す。

### 6.2 色と画質

- 内部は 8bit RGBA・乗算済みアルファで合成する（最初の版）。
- プレビュー画質（等倍・1/2・1/4）は内部バッファの解像度を下げて実現する。
- 将来の拡張：16bit 浮動小数点バッファ、リニア色空間での合成。

### 6.3 エフェクト定義の形（イメージ）

```ts
defineEffect({
  type: 'blur',
  label: 'ぼかし',
  params: {
    radius: { kind: 'number', min: 0, max: 500, default: 5, unit: 'px', animatable: true },
  },
  // 描画範囲がどれだけ広がるか
  margin: (p) => Math.ceil(p.radius * 2),
  // シェーダーのパスを組み立てる
  render: (ctx, input, p) => ctx.gaussianBlur(input, p.radius),
});
```

設定パネルは `params` から自動生成し、編集ファイルの検証や補間も同じ定義を使う。

## 7. 素材の読み込みとデコード

- **取り込み**：ファイルを受け取ったら Mediabunny でコンテナを解析し、長さ・解像度・コーデック・フレームレート・音声情報を取得する。デコードできないコーデックなら、その場で理由を表示する。
- **動画**：MediaWorker 内で WebCodecs の `VideoDecoder` を使う。
  - シーク時は直前のキーフレームからデコードし、目的のフレームを取り出す
  - デコード済みフレームはメモリ使用量の上限を決めた LRU キャッシュで保持し、再生中は先読みする
  - `VideoFrame` は使い終わったら必ず `close()` する（GPU メモリ漏れの防止）
  - 可変フレームレートの素材は、タイムスタンプが最も近いフレームを選ぶ
- **画像**：`createImageBitmap()`。アニメーション画像は `ImageDecoder`（Phase 8）。
- **音声**：`AudioDecoder` で PCM（Float32）にデコードし、プロジェクトのサンプリングレートにそろえて保持する。長い音声はチャンク単位で扱う。
- **サムネイル・波形**：バックグラウンドで生成してキャッシュする。
- **フォント**：システムにインストールされたフォントを名前で指定するほか、フォントファイルを素材として取り込める（`FontFace` API）。

## 8. 再生と同期

- **基準時計は音声**（`AudioContext.currentTime`）。映像は音声の時刻に合わせて表示するフレームを選び、間に合わないときはフレームを飛ばす。
- 最初の版では、音声オブジェクトの区間ごとに `AudioBufferSourceNode` を予約再生する方式で実装する。音量・パンは `GainNode` / `StereoPannerNode`。
- 将来、エフェクトや細かな制御が増えたら AudioWorklet でのミキサーに移行する。
- 再生中は React の再描画を通さず、`requestAnimationFrame` で直接 Canvas を更新する。タイムラインの再生ヘッドも同様。

## 9. 書き出し

1. 書き出し範囲の各フレームを **1フレームずつ確実に** 描画する（再生とは異なり、デコードを待ってから描画するのでフレーム落ちしない）。
2. 描画結果を `VideoFrame` にして `VideoEncoder` へ。
   - MP4：H.264（`avc1.*`）、音声 AAC（`mp4a.40.2`）
   - WebM：VP9 / AV1、音声 Opus
   - 使えるかどうかを `isConfigSupported()` で確認し、使えない組み合わせは選択肢に出さない（例：AAC エンコーダーがない環境では WebM か Opus を提案）
3. 音声は `OfflineAudioContext` でミックスを一括生成し、`AudioEncoder` へ。
4. Mediabunny で MP4 / WebM に多重化する。
   - Chromium 系：File System Access API の書き込みストリームへ直接書き出す（大きなファイルでもメモリを圧迫しない）
   - その他：メモリ上に作ってからダウンロード（長さの上限を警告で案内）
5. 書き出しは ExportWorker（`OffscreenCanvas` + WebGL2）で行い、UI を止めない。進捗・残り時間・キャンセルを表示する。

## 10. 保存・復元

詳細は [04-project-file-format.md](04-project-file-format.md)。

- **上書き保存**：File System Access API が使える場合はファイルハンドルを保持し、Ctrl+S で同じファイルに上書きする。使えない場合は毎回ダウンロード。
- **自動保存**：変更から数秒後と一定間隔で IndexedDB に保存し、次回起動時に「前回の編集を復元しますか？」と確認する。
- **素材の保持**：
  - Chromium 系：素材のファイルハンドルを IndexedDB に保存し、次回は許可を求めるだけで再び読める
  - 任意設定：素材を OPFS にコピーしておき、完全に自動で復元する（容量を消費するため選択制。`navigator.storage.persist()` で消去されにくくする）
  - どちらもない場合：編集ファイルを開いたときに不足素材を一覧表示し、ファイル（またはフォルダ）を投下してもらって自動照合する

## 11. 元に戻す／やり直し

- 編集操作はすべて **コマンド** を通して行う（UI から直接状態を書き換えない）。
- Immer のパッチ（変更差分と逆差分）を履歴に積む。
- ドラッグ中の連続した変更は1つの履歴にまとめる。
- 履歴の上限（例：200 件）を設ける。

## 12. 性能のための工夫

- デコード・書き出しを Worker で行い、UI スレッドを空ける。
- テクスチャ・バッファを使い回す（テクスチャプール）。
- キャッシュはメモリ量（バイト数）で上限を決める。
- タイムラインは画面に見えている範囲だけ描画する。
- テキストの描画結果は内容と書式をキーにキャッシュする。
- 重い機能（書き出し、エフェクト群など）は動的 import で必要になったときに読み込む。

## 13. GitHub Pages での公開

### 13.1 制約と対応

| 制約 | 対応 |
|---|---|
| サイトは `https://yosshu.github.io/video-editor/` のサブパスで公開される | Vite の `base` を `/video-editor/` にする。画面遷移はページ内で完結させる（パスによるルーティングは使わない） |
| HTTP ヘッダーを設定できない（COOP/COEP 不可） | `SharedArrayBuffer`（マルチスレッド WASM 等）を前提にしない設計にする。WebCodecs・WebGL2・Web Audio はヘッダーなしで使える |
| サーバー処理なし | すべてブラウザ内で処理する |

### 13.2 デプロイの流れ

- Pages の Source は「GitHub Actions」（設定済み）。
- `main` ブランチへの push で、ビルド → Pages へデプロイする。
- Pull Request では lint・型チェック・テスト・ビルドだけを実行する。

ワークフローの骨子（Phase 0 で作成。各 action のバージョンは作成時に最新を確認する）：

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run lint && npm run typecheck && npm test
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

## 14. テスト方針

| 種類 | 対象 | 方法 |
|---|---|---|
| 単体テスト | 衝突判定、分割、スナップ、補間、Evaluator、編集ファイルの保存→読込の往復、バージョン移行 | Vitest |
| 描画テスト | 代表的なシーンを描画し、基準画像と許容誤差つきで比較 | Playwright（Chromium） |
| E2E テスト | 素材取り込み → 編集 → 書き出し、保存 → 開き直し | Playwright。書き出したファイルの長さ・フレーム数を検証 |
| 手動確認 | Firefox / Safari での動作、実素材での性能 | リリース前のチェックリスト |
