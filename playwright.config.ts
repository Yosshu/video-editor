import { defineConfig, devices } from '@playwright/test';

// ローカル（クラウド開発環境）では事前インストール済みの Chromium を使う
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173/video-editor/',
    trace: 'on-first-retry',
    // 画面の言語はブラウザの言語で決まるので、日本語にそろえる（英語は個別のテストで確認する）
    locale: 'ja-JP',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/video-editor/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
