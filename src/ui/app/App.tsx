import { useMemo } from 'react';
import { checkSupport } from '../../env/support';
import { Editor } from './Editor';
import { t } from '../../i18n';

export function App() {
  const support = useMemo(() => checkSupport(), []);

  if (!support.ok) {
    return (
      <main className="unsupported">
        <h1>{t('このブラウザには対応していません')}</h1>
        <p>
          {t(
            '次の機能が見つかりませんでした。PC 版の Chrome または Edge の最新版でお試しください。',
          )}
        </p>
        <ul>
          {support.missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </main>
    );
  }

  return <Editor />;
}
