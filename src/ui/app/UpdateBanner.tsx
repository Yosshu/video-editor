import { applyUpdate, usePwa } from '../../app/pwa';
import { t } from '../../i18n';

/** 新しいバージョンが届いたことを知らせる */
export function UpdateBanner() {
  const ready = usePwa((s) => s.updateReady);
  if (!ready) return null;
  return (
    <div className="update-banner" role="status">
      {t('新しいバージョンがあります。')}
      <button type="button" className="primary" onClick={applyUpdate}>
        {t('更新して読み込み直す')}
      </button>
      <button type="button" onClick={() => usePwa.setState({ updateReady: false })}>
        {t('あとで')}
      </button>
    </div>
  );
}
