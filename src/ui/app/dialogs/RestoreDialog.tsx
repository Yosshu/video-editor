import { discardAutosave, restoreAutosave } from '../../../app/projectFile';
import { closeDialog } from '../../../state/ui';
import { Dialog } from '../../common/Dialog';
import { t, useLocale } from '../../../i18n';

export function RestoreDialog({ savedAt, fileName }: { savedAt: string; fileName: string | null }) {
  const date = new Date(savedAt);
  const locale = useLocale((s) => (s.locale === 'en' ? 'en-US' : 'ja-JP'));
  return (
    <Dialog
      title={t('前回の編集を復元しますか？')}
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
            {t('復元しない')}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              closeDialog();
              void restoreAutosave();
            }}
          >
            {t('復元する')}
          </button>
        </>
      }
    >
      <p>
        {fileName
          ? t(
              '「{0}」の自動保存されたデータがあります（{1}）。',
              fileName,
              date.toLocaleString(locale),
            )
          : t('自動保存されたデータがあります（{0}）。', date.toLocaleString(locale))}
      </p>
    </Dialog>
  );
}
