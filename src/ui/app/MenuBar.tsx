import { pickAndOpenProject, savePackage, saveProject } from '../../app/projectFile';
import { redo, undo, useEditor } from '../../state/store';
import { openDialog } from '../../state/ui';
import { setLocale, t, useLocale, type Locale } from '../../i18n';
import { setTheme, useTheme } from '../../app/theme';

export function MenuBar() {
  const locale = useLocale((s) => s.locale);
  const theme = useTheme((s) => s.theme);
  const fileName = useEditor((s) => s.fileName);
  const dirty = useEditor((s) => s.dirty);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undoLabel = useEditor((s) => s.past[s.past.length - 1]?.label);
  const redoLabel = useEditor((s) => s.future[s.future.length - 1]?.label);

  return (
    <header className="menubar">
      <span className="app-title">Video Editor</span>
      <nav className="menu-buttons" aria-label={t('メニュー')}>
        <button type="button" onClick={() => openDialog({ type: 'newProject' })}>
          {t('新規')}
        </button>
        <button type="button" onClick={() => void pickAndOpenProject()} title="Ctrl+O">
          {t('開く')}
        </button>
        <button type="button" onClick={() => void saveProject()} title="Ctrl+S">
          {t('保存')}
        </button>
        <button
          type="button"
          onClick={() => void saveProject({ saveAs: true })}
          title="Ctrl+Shift+S"
        >
          {t('名前を付けて保存')}
        </button>
        <button
          type="button"
          onClick={() => void savePackage()}
          title={t(
            '素材ファイルも 1 つにまとめて保存します（.vedpack）。別の PC へ持っていくとき用',
          )}
        >
          {t('素材ごと保存')}
        </button>
        <span className="menu-sep" />
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          title={undoLabel ? t('元に戻す：{0}（Ctrl+Z）', undoLabel) : t('元に戻す')}
        >
          {t('元に戻す')}
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!canRedo}
          title={redoLabel ? t('やり直し：{0}（Ctrl+Y）', redoLabel) : t('やり直し')}
        >
          {t('やり直し')}
        </button>
        <span className="menu-sep" />
        <button type="button" onClick={() => openDialog({ type: 'projectSettings' })}>
          {t('プロジェクト設定')}
        </button>
        <button type="button" onClick={() => openDialog({ type: 'presets' })}>
          {t('プリセット')}
        </button>
        <button type="button" onClick={() => openDialog({ type: 'shortcuts' })}>
          {t('ショートカット')}
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => openDialog({ type: 'export' })}
          title="Ctrl+E"
        >
          {t('書き出し')}
        </button>
        <button type="button" onClick={() => openDialog({ type: 'about' })}>
          {t('ヘルプ')}
        </button>
      </nav>
      <span className="menu-settings">
        <select
          aria-label="Language / 言語"
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
        >
          <option value="ja">日本語</option>
          <option value="en">English</option>
        </select>
        <button
          type="button"
          className="icon-button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={theme === 'dark' ? t('明るい配色にする') : t('暗い配色にする')}
          title={theme === 'dark' ? t('明るい配色にする') : t('暗い配色にする')}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </span>
      <span className="file-name" title={fileName ?? t('未保存')}>
        {fileName ?? t('未保存のプロジェクト')}
        {dirty ? ' *' : ''}
      </span>
    </header>
  );
}
