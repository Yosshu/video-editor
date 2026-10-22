import { addScene, deleteScene, renameScene, switchScene } from '../../app/sceneActions';
import { useEditor } from '../../state/store';
import { openContextMenu } from '../../state/ui';
import { t } from '../../i18n';

/** シーンの切り替えタブ */
export function SceneTabs() {
  const scenes = useEditor((s) => s.project.scenes);
  const rootId = useEditor((s) => s.project.rootSceneId);
  const current = useEditor((s) => s.sceneId);

  return (
    <div className="scene-tabs" role="tablist" aria-label={t('シーン')}>
      {scenes.map((s) => {
        const rename = () => {
          const name = window.prompt(t('シーンの名前'), s.name);
          if (name !== null) renameScene(s.id, name);
        };
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={s.id === current}
            className={`scene-tab ${s.id === current ? 'active' : ''}`}
            onClick={() => switchScene(s.id)}
            onDoubleClick={rename}
            onContextMenu={(e) => {
              e.preventDefault();
              openContextMenu(e.clientX, e.clientY, [
                { label: t('名前を変更…'), action: rename },
                {
                  label: t('シーンを削除'),
                  disabled: s.id === rootId,
                  action: () => deleteScene(s.id),
                },
              ]);
            }}
            title={
              s.id === rootId
                ? t('メインのシーン（書き出しの対象）')
                : t('ダブルクリックで名前を変更')
            }
          >
            {s.name}
          </button>
        );
      })}
      <button
        type="button"
        className="scene-tab add"
        onClick={addScene}
        title={t('シーンを追加')}
        aria-label={t('シーンを追加')}
      >
        ＋
      </button>
    </div>
  );
}
