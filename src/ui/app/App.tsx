import { useMemo } from 'react';
import { checkSupport } from '../../env/support';
import { Editor } from './Editor';

export function App() {
  const support = useMemo(() => checkSupport(), []);

  if (!support.ok) {
    return (
      <main className="unsupported">
        <h1>このブラウザには対応していません</h1>
        <p>次の機能が見つかりませんでした。PC 版の Chrome または Edge の最新版でお試しください。</p>
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
