import { pickAndOpenProject, saveProject } from '../../app/projectFile';
import { redo, undo, useEditor } from '../../state/store';
import { openDialog } from '../../state/ui';

export function MenuBar() {
  const fileName = useEditor((s) => s.fileName);
  const dirty = useEditor((s) => s.dirty);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undoLabel = useEditor((s) => s.past[s.past.length - 1]?.label);
  const redoLabel = useEditor((s) => s.future[s.future.length - 1]?.label);

  return (
    <header className="menubar">
      <span className="app-title">Video Editor</span>
      <nav className="menu-buttons" aria-label="メニュー">
        <button type="button" onClick={() => openDialog({ type: 'newProject' })}>
          新規
        </button>
        <button type="button" onClick={() => void pickAndOpenProject()} title="Ctrl+O">
          開く
        </button>
        <button type="button" onClick={() => void saveProject()} title="Ctrl+S">
          保存
        </button>
        <button
          type="button"
          onClick={() => void saveProject({ saveAs: true })}
          title="Ctrl+Shift+S"
        >
          名前を付けて保存
        </button>
        <span className="menu-sep" />
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          title={undoLabel ? `元に戻す：${undoLabel}（Ctrl+Z）` : '元に戻す'}
        >
          元に戻す
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!canRedo}
          title={redoLabel ? `やり直し：${redoLabel}（Ctrl+Y）` : 'やり直し'}
        >
          やり直し
        </button>
        <span className="menu-sep" />
        <button type="button" onClick={() => openDialog({ type: 'projectSettings' })}>
          プロジェクト設定
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => openDialog({ type: 'export' })}
          title="Ctrl+E"
        >
          書き出し
        </button>
        <button type="button" onClick={() => openDialog({ type: 'about' })}>
          ヘルプ
        </button>
      </nav>
      <span className="file-name" title={fileName ?? '未保存'}>
        {fileName ?? '未保存のプロジェクト'}
        {dirty ? ' *' : ''}
      </span>
    </header>
  );
}
