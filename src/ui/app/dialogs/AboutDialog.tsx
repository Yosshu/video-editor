import { promptInstall, usePwa } from '../../../app/pwa';
import { closeDialog, openDialog } from '../../../state/ui';
import { Dialog } from '../../common/Dialog';
import { t } from '../../../i18n';

export function AboutDialog() {
  const canInstall = usePwa((s) => s.canInstall);
  return (
    <Dialog
      title={t('使い方')}
      onClose={closeDialog}
      width={560}
      footer={
        <button type="button" onClick={closeDialog}>
          {t('閉じる')}
        </button>
      }
    >
      <p>
        {t(
          'ブラウザだけで動くレイヤー型の動画編集アプリです（v{0}）。素材ファイルはブラウザの外へ送信されません。',
          __APP_VERSION__,
        )}
      </p>
      <ul className="hint-list">
        <li>
          {t(
            '素材（動画・画像・音声）をタイムラインや素材一覧にドラッグ＆ドロップして追加します。',
          )}
        </li>
        <li>
          {t('タイムラインの空いている場所を右クリックすると、テキストや図形を追加できます。')}
        </li>
        <li>{t('編集ファイル（.vedproj）を画面にドロップすると、続きから編集できます。')}</li>
      </ul>
      <p>
        <button type="button" onClick={() => openDialog({ type: 'shortcuts' })}>
          {t('キーボードショートカットの一覧と変更…')}
        </button>
      </p>
      <p className="hint">
        {t(
          'アプリとしてインストールすると、ネットにつながっていなくても使え、編集ファイル（.vedproj・.vedpack）をダブルクリックで開けるようになります（対応ブラウザのみ）。',
        )}
      </p>
      {canInstall && (
        <p>
          <button type="button" className="primary" onClick={() => void promptInstall()}>
            {t('アプリとしてインストール')}
          </button>
        </p>
      )}
    </Dialog>
  );
}
