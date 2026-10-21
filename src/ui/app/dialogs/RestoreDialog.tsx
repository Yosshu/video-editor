import { discardAutosave, restoreAutosave } from '../../../app/projectFile';
import { closeDialog } from '../../../state/ui';
import { Dialog } from '../../common/Dialog';

export function RestoreDialog({ savedAt, fileName }: { savedAt: string; fileName: string | null }) {
  const date = new Date(savedAt);
  return (
    <Dialog
      title="前回の編集を復元しますか？"
      onClose={closeDialog}
      modal
      footer={
        <>
          <button
            type="button"
            onClick={() => {
              void discardAutosave();
              closeDialog();
            }}
          >
            復元しない
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              closeDialog();
              void restoreAutosave();
            }}
          >
            復元する
          </button>
        </>
      }
    >
      <p>
        {fileName ? `「${fileName}」の` : ''}自動保存されたデータがあります（
        {date.toLocaleString('ja-JP')}）。
      </p>
    </Dialog>
  );
}
