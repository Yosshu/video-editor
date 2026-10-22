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
            const next = window.prompt('プリセットの名前', name);
            if (next) renamePreset(kind, id, next);
          }}
        >
          名前を変更
        </button>
        <button
          type="button"
          aria-label={`${name}を削除`}
          onClick={() => {
            if (window.confirm(`プリセット「${name}」を削除しますか？`)) deletePreset(kind, id);
          }}
        >
          削除
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
      title="プリセット"
      onClose={closeDialog}
      width={560}
      footer={
        <>
          <button type="button" onClick={() => void importPresets()}>
            ファイルから読み込む…
          </button>
          <button
            type="button"
            onClick={exportPresets}
            disabled={objects.length + effects.length === 0}
          >
            ファイルに書き出す
          </button>
          <button type="button" onClick={closeDialog}>
            閉じる
          </button>
        </>
      }
    >
      <p className="hint">
        オブジェクトの設定は設定パネルの「プリセット…」、エフェクトの設定は各エフェクトの ☆
        から保存します。プリセットはこのブラウザに保存され、どのプロジェクトでも使えます。
      </p>
      <h3 className="dialog-subtitle">オブジェクト（{objects.length}）</h3>
      {objects.length === 0 ? (
        <p className="dim">まだありません。</p>
      ) : (
        <table className="preset-table">
          <tbody>
            {objects.map((p) => (
              <PresetRow
                key={p.id}
                kind="objects"
                id={p.id}
                name={p.name}
                typeLabel={getObjectDef(p.type)?.label ?? p.type}
              />
            ))}
          </tbody>
        </table>
      )}
      <h3 className="dialog-subtitle">エフェクト（{effects.length}）</h3>
      {effects.length === 0 ? (
        <p className="dim">まだありません。</p>
      ) : (
        <table className="preset-table">
          <tbody>
            {effects.map((p) => (
              <PresetRow
                key={p.id}
                kind="effects"
                id={p.id}
                name={p.name}
                typeLabel={getEffectDef(p.type)?.label ?? p.type}
              />
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}
