import { closeDialog } from '../../../state/ui';
import { Dialog } from '../../common/Dialog';

/** 書き出し（Phase 3 で実装） */
export function ExportDialog() {
  return (
    <Dialog
      title="書き出し"
      onClose={closeDialog}
      footer={
        <button type="button" onClick={closeDialog}>
          閉じる
        </button>
      }
    >
      <p>書き出し機能は準備中です。</p>
    </Dialog>
  );
}
