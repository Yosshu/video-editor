import { useEffect, useState } from 'react';
import { collectDroppedFiles, importMediaFiles } from '../../app/assets';
import { checkAutosave, openProjectFile, startAutosave } from '../../app/projectFile';
import { isProjectFileName } from '../../engine/media/detect';
import { setupPreviewAudio } from '../../engine/preview/previewMediaInstance';
import { getState } from '../../state/store';
import { Inspector } from '../inspector/Inspector';
import { MediaBin } from '../media-bin/MediaBin';
import { PreviewPanel } from '../preview/PreviewPanel';
import { Timeline } from '../timeline/Timeline';
import { ContextMenu } from './ContextMenu';
import { DialogHost } from './DialogHost';
import { MenuBar } from './MenuBar';
import { BusyOverlay } from './BusyOverlay';
import { UpdateBanner } from './UpdateBanner';
import { Notices } from './Notices';
import { handleShortcut } from './shortcuts';
import { Splitter } from './Splitter';

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function Editor() {
  const [leftW, setLeftW] = useState(240);
  const [rightW, setRightW] = useState(300);
  const [timelineH, setTimelineH] = useState(() => Math.round(window.innerHeight * 0.38));
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    setupPreviewAudio();
    window.addEventListener('keydown', handleShortcut);
    const stopAutosave = startAutosave();
    // インストールしたアプリで編集ファイルを開いたとき（ダブルクリックなど）
    let launched = false;
    window.launchQueue?.setConsumer(async ({ files }) => {
      for (const handle of files) {
        const file = await handle.getFile();
        if (!isProjectFileName(file.name)) continue;
        launched = true;
        await openProjectFile(file, handle);
        return;
      }
    });
    // ファイルを開いて起動したときは、自動保存からの復元を尋ねない
    setTimeout(() => {
      if (!launched) void checkAutosave();
    }, 0);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (getState().dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('keydown', handleShortcut);
      window.removeEventListener('beforeunload', beforeUnload);
      stopAutosave();
    };
  }, []);

  return (
    <div
      className={`editor ${dragOver ? 'window-drag-over' : ''}`}
      style={{
        gridTemplateColumns: `${leftW}px 5px minmax(200px, 1fr) 5px ${rightW}px`,
        gridTemplateRows: `auto minmax(120px, 1fr) 5px ${timelineH}px`,
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        setDragOver(false);
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        // どこにも受け取られなかったファイル：編集ファイルなら開き、素材なら素材一覧に追加
        void collectDroppedFiles(e.dataTransfer).then(async (files) => {
          const project = files.find((f) => isProjectFileName(f.file.name));
          if (project) await openProjectFile(project.file, project.handle);
          else await importMediaFiles(files);
        });
      }}
    >
      <MenuBar />
      <MediaBin />
      <Splitter
        direction="vertical"
        area="s1"
        label="素材一覧の幅"
        onDrag={(d) => setLeftW((w) => clamp(w + d, 140, 600))}
      />
      <PreviewPanel />
      <Splitter
        direction="vertical"
        area="s2"
        label="設定パネルの幅"
        onDrag={(d) => setRightW((w) => clamp(w - d, 200, 700))}
      />
      <Inspector />
      <Splitter
        direction="horizontal"
        area="s3"
        label="タイムラインの高さ"
        onDrag={(d) => setTimelineH((h) => clamp(h - d, 120, window.innerHeight - 200))}
      />
      <Timeline />
      <ContextMenu />
      <DialogHost />
      <Notices />
      <BusyOverlay />
      <UpdateBanner />
    </div>
  );
}
