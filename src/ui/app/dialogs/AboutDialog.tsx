import { closeDialog } from '../../../state/ui';
import { Dialog } from '../../common/Dialog';
import { SHORTCUTS } from '../shortcuts';

export function AboutDialog() {
  return (
    <Dialog
      title="使い方とショートカット"
      onClose={closeDialog}
      width={560}
      footer={
        <button type="button" onClick={closeDialog}>
          閉じる
        </button>
      }
    >
      <p>
        ブラウザだけで動くレイヤー型の動画編集アプリです（v{__APP_VERSION__}
        ）。素材ファイルはブラウザの外へ送信されません。
      </p>
      <ul className="hint-list">
        <li>
          素材（動画・画像・音声）をタイムラインや素材一覧にドラッグ＆ドロップして追加します。
        </li>
        <li>タイムラインの空いている場所を右クリックすると、テキストや図形を追加できます。</li>
        <li>編集ファイル（.vedproj）を画面にドロップすると、続きから編集できます。</li>
      </ul>
      <table className="shortcut-table">
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.keys}>
              <td>
                <kbd>{s.keys}</kbd>
              </td>
              <td>{s.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
