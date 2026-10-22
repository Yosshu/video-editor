import { useUi } from '../../state/ui';
import { t } from '../../i18n';

/** 時間のかかる処理の間、画面を覆って進み具合を表示する */
export function BusyOverlay() {
  const busy = useUi((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="busy-overlay" role="status" aria-live="polite">
      <div className="busy-box">
        <p>{busy.label}</p>
        {busy.progress !== undefined && (
          <progress max={1} value={busy.progress} aria-label={t('進み具合')} />
        )}
      </div>
    </div>
  );
}
