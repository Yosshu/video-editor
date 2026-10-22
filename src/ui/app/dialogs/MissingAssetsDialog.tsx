import { useState } from 'react';
import {
  collectDroppedFiles,
  relinkFiles,
  requestStoredHandles,
  type IncomingFile,
} from '../../../app/assets';
import { notify, useEditor } from '../../../state/store';
import { closeDialog } from '../../../state/ui';
import { pickFilesWithInput } from '../../../storage/filePicker';
import { Dialog } from '../../common/Dialog';
import { formatBytes } from '../../common/format';
import { t } from '../../../i18n';

async function pickFiles(directory: boolean): Promise<IncomingFile[]> {
  const files = await pickFilesWithInput({ multiple: true, directory });
  return files.map((file) => ({ file }));
}

export function MissingAssetsDialog() {
  const assets = useEditor((s) => s.project.assets);
  const status = useEditor((s) => s.assetStatus);
  const missing = assets.filter((a) => status[a.id] === 'missing' || status[a.id] === 'error');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const handleFiles = async (files: IncomingFile[]) => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      const n = await relinkFiles(files);
      notify(
        n > 0 ? t('{0} 個の素材を見つけました。', n) : t('一致する素材が見つかりませんでした。'),
        n > 0 ? 'info' : 'error',
      );
    } finally {
      setBusy(false);
    }
  };

  const supportsHandles = 'showOpenFilePicker' in window;

  return (
    <Dialog
      title={t('見つからない素材があります')}
      onClose={closeDialog}
      width={560}
      footer={
        <button
          type="button"
          className={missing.length === 0 ? 'primary' : ''}
          onClick={closeDialog}
        >
          {missing.length === 0 ? t('完了') : t('あとで')}
        </button>
      }
    >
      {missing.length === 0 ? (
        <p>{t('すべての素材が見つかりました。')}</p>
      ) : (
        <>
          <p>
            {t(
              'ブラウザはファイルの場所を覚えられないため、素材ファイルをもう一度指定してください。フォルダごと指定すると、ファイル名と内容から自動で探します。',
            )}
          </p>
          <ul className="missing-list">
            {missing.map((a) => (
              <li key={a.id}>
                <span className="missing-name">{a.name}</span>
                <span className="dim">{formatBytes(a.size)}</span>
              </li>
            ))}
          </ul>
          <div
            className={`drop-zone ${over ? 'over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOver(false);
              void collectDroppedFiles(e.dataTransfer).then(handleFiles);
            }}
          >
            {busy ? t('照合しています…') : t('ここに素材ファイルをドロップ')}
          </div>
          <div className="button-row">
            <button
              type="button"
              disabled={busy}
              onClick={() => void pickFiles(false).then(handleFiles)}
            >
              {t('ファイルを選択…')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void pickFiles(true).then(handleFiles)}
            >
              {t('フォルダを選択…')}
            </button>
            {supportsHandles && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const n = await requestStoredHandles();
                    if (n === 0) notify(t('ブラウザに記録された素材はありませんでした。'), 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('前回のファイルへのアクセスを許可')}
              </button>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
