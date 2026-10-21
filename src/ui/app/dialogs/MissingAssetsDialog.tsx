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
        n > 0 ? `${n} 個の素材を見つけました。` : '一致する素材が見つかりませんでした。',
        n > 0 ? 'info' : 'error',
      );
    } finally {
      setBusy(false);
    }
  };

  const supportsHandles = 'showOpenFilePicker' in window;

  return (
    <Dialog
      title="見つからない素材があります"
      onClose={closeDialog}
      width={560}
      footer={
        <button
          type="button"
          className={missing.length === 0 ? 'primary' : ''}
          onClick={closeDialog}
        >
          {missing.length === 0 ? '完了' : 'あとで'}
        </button>
      }
    >
      {missing.length === 0 ? (
        <p>すべての素材が見つかりました。</p>
      ) : (
        <>
          <p>
            ブラウザはファイルの場所を覚えられないため、素材ファイルをもう一度指定してください。フォルダごと指定すると、ファイル名と内容から自動で探します。
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
            {busy ? '照合しています…' : 'ここに素材ファイルをドロップ'}
          </div>
          <div className="button-row">
            <button
              type="button"
              disabled={busy}
              onClick={() => void pickFiles(false).then(handleFiles)}
            >
              ファイルを選択…
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void pickFiles(true).then(handleFiles)}
            >
              フォルダを選択…
            </button>
            {supportsHandles && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const n = await requestStoredHandles();
                    if (n === 0) notify('ブラウザに記録された素材はありませんでした。', 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                前回のファイルへのアクセスを許可
              </button>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
