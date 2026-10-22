import { useEffect, useState } from 'react';
import { resetAllKeys, setCustomKeys, useKeymap } from '../../../state/keymap';
import { closeDialog } from '../../../state/ui';
import { Dialog } from '../../common/Dialog';
import { COMMANDS, commandForKey, formatKey, keyString, keysOf, MOUSE_HINTS } from '../shortcuts';

const GROUPS = [...new Set(COMMANDS.map((c) => c.group))];

/** ショートカットの一覧と変更 */
export function ShortcutsDialog() {
  const custom = useKeymap((s) => s.custom);
  // キーの入力を待っているコマンド
  const [capturing, setCapturing] = useState<string | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        setCapturing(null);
        return;
      }
      const key = keyString(e);
      if (!key) return;
      const command = COMMANDS.find((c) => c.id === capturing)!;
      const other = commandForKey(key, command.id);
      if (other) {
        const ok = window.confirm(
          `${formatKey(key)} は「${other.label}」に割り当てられています。「${command.label}」に付け替えますか？`,
        );
        if (!ok) {
          setCapturing(null);
          return;
        }
        setCustomKeys(
          other.id,
          keysOf(other).filter((k) => k !== key),
        );
      }
      const current = keysOf(command);
      if (!current.includes(key)) setCustomKeys(command.id, [...current, key]);
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing]);

  return (
    <Dialog
      title="キーボードショートカット"
      onClose={closeDialog}
      width={640}
      footer={
        <>
          <button
            type="button"
            onClick={() => {
              if (window.confirm('すべてのショートカットを最初の状態に戻しますか？'))
                resetAllKeys();
            }}
          >
            すべて既定に戻す
          </button>
          <button type="button" onClick={closeDialog}>
            閉じる
          </button>
        </>
      }
    >
      <p className="hint">
        「＋」を押してから割り当てたいキーを押します（Esc
        で取り消し）。設定はこのブラウザに保存されます。
      </p>
      {GROUPS.map((group) => (
        <section key={group} className="shortcut-group">
          <h3>{group}</h3>
          <table className="shortcut-table">
            <tbody>
              {COMMANDS.filter((c) => c.group === group).map((c) => {
                const keys = keysOf(c, custom);
                return (
                  <tr key={c.id} data-command={c.id}>
                    <td>{c.label}</td>
                    <td className="shortcut-keys">
                      {keys.map((k) => (
                        <span key={k} className="key-chip">
                          <kbd>{formatKey(k)}</kbd>
                          <button
                            type="button"
                            className="key-remove"
                            aria-label={`${c.label}から ${formatKey(k)} を外す`}
                            onClick={() =>
                              setCustomKeys(
                                c.id,
                                keys.filter((x) => x !== k),
                              )
                            }
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {capturing === c.id ? (
                        <span className="capturing">キーを押してください…</span>
                      ) : (
                        <button
                          type="button"
                          className="key-add"
                          aria-label={`${c.label}にキーを追加`}
                          onClick={() => setCapturing(c.id)}
                        >
                          ＋
                        </button>
                      )}
                    </td>
                    <td>
                      {custom[c.id] && (
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => setCustomKeys(c.id, null)}
                        >
                          既定に戻す
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
      <section className="shortcut-group">
        <h3>マウス</h3>
        <table className="shortcut-table">
          <tbody>
            {MOUSE_HINTS.map((h) => (
              <tr key={h.keys}>
                <td>{h.label}</td>
                <td>
                  <kbd>{h.keys}</kbd>
                </td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </Dialog>
  );
}
