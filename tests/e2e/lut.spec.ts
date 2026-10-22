import { expect, test } from '@playwright/test';
import { addObjectAt, disableFileSystemAccess, previewPixel, seekRuler } from './helpers';

const near = (a: number[], b: number[], tol = 24) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
});

test('LUT ファイルで色を変換する', async ({ page }) => {
  await addObjectAt(page, '図形を追加', 1, 10);
  await seekRuler(page, 41);
  await expect
    .poll(async () => near(await previewPixel(page, 0.5, 0.5), [79, 140, 255]))
    .toBe(true);
  await page.getByLabel('エフェクトを追加').selectOption({ label: 'LUT（色の変換表）' });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイルを読み込む…' }).click();
  await (await chooser).setFiles('tests/fixtures/invert.cube');
  await expect(page.getByLabel('LUT ファイル（.cube）')).toHaveValue(/as_/);
  // 反転：(79, 140, 255) → (176, 115, 0)
  await expect.poll(async () => near(await previewPixel(page, 0.5, 0.5), [176, 115, 0])).toBe(true);
  // 素材一覧に LUT が並ぶ
  await expect(page.locator('.asset-item')).toContainText('invert.cube');
  await page.getByLabel('強さ', { exact: true }).fill('0');
  await expect
    .poll(async () => near(await previewPixel(page, 0.5, 0.5), [79, 140, 255]))
    .toBe(true);
});
