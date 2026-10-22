import {
  deletePreset,
  exportPresets,
  importPresets,
  renamePreset,
} from '../../../app/presetActions';
import { getEffectDef } from '../../../core/effects/definitions';
import { getObjectDef } from '../../../core/objects/definitions';
import { usePresets } from '../../../state/presets';
import { closeDialog } from '../../../state/ui';
import { Dialog } from '../../common/Dialog';
import { t } from '../../../i18n';

function PresetRow({
  kind,
  id,
  name,
  typeLabel,
}: {
  kind: 'objects' | 'effects';
  id: string;
  name: string;
  typeLabel: string;
}) {
  return (
    <tr>
      <td>{name}</td>
      <td className="dim">{typeLabel}</td>
      <td className="row-buttons">
        <button
          type="button"
          onClick={() => {
            const next = window.prompt(t('プリセットの名前'), name);
            if (next) renamePreset(kind, id, next);
          }}
        >
          {t('名前を変更')}
        </button>
        <button
          type="button"
          aria-label={t('{0}を削除', name)}
          onClick={() => {
            if (window.confirm(t('プリセット「{0}」を削除しますか？', name)))
              deletePreset(kind, id);
          }}
        >
          {t('削除')}
        </button>
      </td>
    </tr>
  );
}

/** 保存したプリセットの管理 */
export function PresetsDialog() {
  const { objects, effects } = usePresets();
  return (
    <Dialog
      title={t('プリセット')}
      onClose={closeDialog}
      width={560}
      footer={
        <>
          <button type="button" onClick={() => void importPresets()}>
            {t('ファイルから読み込む…')}
          </button>
          <button
            type="button"
            onClick={exportPresets}
            disabled={objects.length + effects.length === 0}
          >
            {t('ファイルに書き出す')}
          </button>
          <button type="button" onClick={closeDialog}>
            {t('閉じる')}
          </button>
        </>
      }
    >
      <p className="hint">
        {t(
          'オブジェクトの設定は設定パネルの「プリセット…」、エフェクトの設定は各エフェクトの ☆ から保存します。プリセットはこのブラウザに保存され、どのプロジェクトでも使えます。',
        )}
      </p>
      <h3 className="dialog-subtitle">{t('オブジェクト（{0}）', objects.length)}</h3>
      {objects.length === 0 ? (
        <p className="dim">{t('まだありません。')}</p>
      ) : (
        <table className="preset-table">
          <tbody>
            {objects.map((p) => (
              <PresetRow
                key={p.id}
                kind="objects"
                id={p.id}
                name={p.name}
                typeLabel={t(getObjectDef(p.type)?.label ?? p.type)}
              />
            ))}
          </tbody>
        </table>
      )}
      <h3 className="dialog-subtitle">{t('エフェクト（{0}）', effects.length)}</h3>
      {effects.length === 0 ? (
        <p className="dim">{t('まだありません。')}</p>
      ) : (
        <table className="preset-table">
          <tbody>
            {effects.map((p) => (
              <PresetRow
                key={p.id}
                kind="effects"
                id={p.id}
                name={p.name}
                typeLabel={t(getEffectDef(p.type)?.label ?? p.type)}
              />
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}
