import { applyUpdate, usePwa } from '../../app/pwa';

/** 新しいバージョンが届いたことを知らせる */
export function UpdateBanner() {
  const ready = usePwa((s) => s.updateReady);
  if (!ready) return null;
  return (
    <div className="update-banner" role="status">
      新しいバージョンがあります。
      <button type="button" className="primary" onClick={applyUpdate}>
        更新して読み込み直す
      </button>
      <button type="button" onClick={() => usePwa.setState({ updateReady: false })}>
        あとで
      </button>
    </div>
  );
}
