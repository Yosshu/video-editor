# video-editor

ブラウザだけで動く、レイヤー型の動画編集 Web アプリです（開発中）。

- 公開予定 URL：https://yosshu.github.io/video-editor/
- 主な動作環境（予定）：PC 版 Chrome / Edge の最新版（Firefox・Safari は順次対応）
- 素材はすべてブラウザ内で処理し、サーバーへアップロードしません

## できるようにすること

- 縦に積み重なる **レイヤー** と横方向の **時間** でできたタイムラインに、動画・画像・音声・テキスト・図形を重ねて編集
- オブジェクトごとに位置・拡大率・回転・不透明度などのパラメータ、キーフレームによるアニメーション、エフェクトを設定
- フィルタ・グループ制御・時間制御・カメラ制御などの「制御オブジェクト」で、複数レイヤーにまとめて効果をかける
- 編集内容を **編集ファイル（`.vedproj`、仮）** として保存し、後でブラウザに投下すると続きから編集できる
- MP4 / WebM で書き出し（ブラウザのハードウェアエンコーダーを利用）

## ドキュメント

| ファイル                                                         | 内容                                   |
| ---------------------------------------------------------------- | -------------------------------------- |
| [docs/01-feature-survey.md](docs/01-feature-survey.md)           | 動画編集ソフトの一般的な機能の洗い出し |
| [docs/02-requirements.md](docs/02-requirements.md)               | 実装する機能と優先度（要件定義）       |
| [docs/03-architecture.md](docs/03-architecture.md)               | 技術選定とアーキテクチャ               |
| [docs/04-project-file-format.md](docs/04-project-file-format.md) | 編集ファイルの形式と拡張子             |
| [docs/05-roadmap.md](docs/05-roadmap.md)                         | 実装の順序とマイルストーン             |

## 進捗

| Phase | 内容                                                                       | 状態   |
| :---: | -------------------------------------------------------------------------- | ------ |
|   0   | 開発基盤と技術検証                                                         | 完了   |
|   1   | データ構造とエディタの骨格                                                 | 完了   |
|   2   | 動画・音声                                                                 | 完了   |
|   3   | 書き出し（v0.1）                                                           | 未着手 |
| 4〜8  | アニメーション、エフェクト、高度なレイヤー制御、音声・効率化、拡張（v1.0） | 未着手 |

## 開発

Node.js 22 以上が必要です。

```sh
npm install        # 依存パッケージのインストール
npm run dev        # 開発サーバー（http://localhost:5173/video-editor/）
npm run build      # 本番ビルド（dist/）
npm run lint       # ESLint
npm run typecheck  # 型チェック
npm test           # 単体テスト（Vitest）
npm run test:e2e   # E2E テスト（Playwright）
```

デフォルトブランチへ push すると、GitHub Actions で https://yosshu.github.io/video-editor/ に自動で公開されます。
