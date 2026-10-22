import { expect, test, type Page } from '@playwright/test';
import { disableFileSystemAccess, previewPixel, seekRuler, timelineObjects } from './helpers';

const near = (a: number[], b: number[], tol = 40) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

async function importFiles(page: Page, files: string[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '追加…' }).click();
  await (await chooser).setFiles(files);
  await expect(page.locator('.asset-item')).toHaveCount(files.length);
}

/** フレーム番号を指定して再生位置を移動する（30fps・1フレーム = 4px の初期表示を前提） */
async function seekFrame(page: Page, frame: number): Promise<void> {
  await seekRuler(page, frame * 4 + 1);
}

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
});

test('アニメーション画像（GIF）はコマが時間で切り替わる', async ({ page }) => {
  // 赤 0.5 秒 → 青 0.5 秒のループする GIF
  await importFiles(page, ['tests/fixtures/anim-red-blue.gif']);
  await page.locator('.asset-item').first().dblclick();
  await expect(timelineObjects(page)).toHaveCount(1);
  // 長さは 1 回分（1 秒 = 30 フレーム）
  await expect(page.getByLabel('長さ')).toHaveValue('30');

  await seekFrame(page, 7);
  await expect.poll(async () => near(await previewPixel(page, 0.5, 0.5), RED)).toBe(true);
  await seekFrame(page, 22);
  await expect.poll(async () => near(await previewPixel(page, 0.5, 0.5), BLUE)).toBe(true);

  // 2 倍速：0.73 秒 → 素材内 1.47 秒 → ループして 0.47 秒（赤）
  await page.locator('summary', { hasText: 'アニメーション画像' }).click();
  await page.getByLabel('再生速度', { exact: true }).fill('200');
  await page.getByLabel('再生速度', { exact: true }).press('Enter');
  await expect.poll(async () => near(await previewPixel(page, 0.5, 0.5), RED)).toBe(true);
  // ループしなければ最後のコマ（青）で止まる
  await page.getByLabel('ループ再生').uncheck();
  await expect.poll(async () => near(await previewPixel(page, 0.5, 0.5), BLUE)).toBe(true);
});
