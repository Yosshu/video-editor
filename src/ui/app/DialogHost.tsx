import { useUi } from '../../state/ui';
import { AboutDialog } from './dialogs/AboutDialog';
import { BeatGridDialog } from './dialogs/BeatGridDialog';
import { ExportDialog } from './dialogs/ExportDialog';
import { MissingAssetsDialog } from './dialogs/MissingAssetsDialog';
import { NewProjectDialog } from './dialogs/NewProjectDialog';
import { ProjectSettingsDialog } from './dialogs/ProjectSettingsDialog';
import { RestoreDialog } from './dialogs/RestoreDialog';

export function DialogHost() {
  const dialog = useUi((s) => s.dialog);
  if (!dialog) return null;
  switch (dialog.type) {
    case 'newProject':
      return <NewProjectDialog />;
    case 'projectSettings':
      return <ProjectSettingsDialog />;
    case 'missingAssets':
      return <MissingAssetsDialog />;
    case 'restore':
      return <RestoreDialog savedAt={dialog.savedAt} fileName={dialog.fileName} />;
    case 'export':
      return <ExportDialog />;
    case 'about':
      return <AboutDialog />;
    case 'beatGrid':
      return <BeatGridDialog />;
  }
}
