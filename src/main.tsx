import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerServiceWorker } from './app/pwa';
import { applyTheme } from './app/theme';
import { useLocale } from './i18n';
import { App } from './ui/app/App';
import './styles/global.css';

registerServiceWorker();
applyTheme();
document.documentElement.lang = useLocale.getState().locale;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
