import { useMemo } from 'react';
import { checkSupport } from '../../env/support';

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

  return (
    <main className="placeholder">
      <h1>Video Editor</h1>
      <p>ブラウザだけで動くレイヤー型の動画編集アプリ（準備中）</p>
      <p className="version">v{__APP_VERSION__}</p>
    </main>
  );
}
