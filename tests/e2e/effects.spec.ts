import { expect, test, type Page } from '@playwright/test';
import { addObjectAt, disableFileSystemAccess, previewPixel, seekRuler } from './helpers';

const BLUE: [number, number, number] = [79, 140, 255];
const BLACK: [number, number, number] = [0, 0, 0];

function spin(page: Page, name: string) {
  return page.getByRole('spinbutton', { name, exact: true });
}

/** レイヤー layer にオブジェクトを追加し、開始を 0 にする */
async function addAt(page: Page, label: string, layer: number) {
  await addObjectAt(page, label, 4, (layer - 1) * 30 + 10);
  await page.getByLabel('開始').fill('0');
}

function isGray([r, g, b]: [number, number, number]) {
  return Math.abs(r - g) < 4 && Math.abs(g - b) < 4 && r > 20;
}

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
});

test('エフェクトを追加・無効化・削除できる', async ({ page }) => {
  await addAt(page, '図形を追加', 1);
  await seekRuler(page, 41);
  await expect.poll(() => previewPixel(page, 0.5, 0.5)).toEqual(BLUE);
  await page.getByLabel('エフェクトを追加').selectOption('monochrome');
  await expect.poll(async () => isGray(await previewPixel(page, 0.5, 0.5))).toBe(true);
  await page.getByLabel('単色化を有効にする').uncheck();
  await expect.poll(() => previewPixel(page, 0.5, 0.5)).toEqual(BLUE);
  await page.getByLabel('単色化を有効にする').check();
  await page.getByRole('button', { name: '単色化を削除' }).click();
  await expect(page.locator('.effect-card')).toHaveCount(0);
  await expect.poll(() => previewPixel(page, 0.5, 0.5)).toEqual(BLUE);
});

test('フィルタオブジェクトは上のレイヤー全体にかかる', async ({ page }) => {
  await addAt(page, '図形を追加', 1);
  await addAt(page, 'フィルタを追加（上のレイヤー全体にエフェクト）', 2);
  await page.getByLabel('エフェクトを追加').selectOption('monochrome');
  await seekRuler(page, 41);
  await expect.poll(async () => isGray(await previewPixel(page, 0.5, 0.5))).toBe(true);
  await expect(page.locator('.tl-object', { hasText: 'フィルタ：単色化' })).toBeVisible();
});

test('上のオブジェクトでクリッピング', async ({ page }) => {
  await addAt(page, '図形を追加', 1);
  await page.getByLabel('形').selectOption('ellipse');
  await addAt(page, '単色を追加', 2);
  await page.locator('input.color-text').first().fill('#ffcc00');
  await page.getByLabel('上のオブジェクトでクリッピング').check();
  await seekRuler(page, 41);
  // 円の中は黄色（円そのものは描かれない）、円の外は背景の黒
  await expect.poll(() => previewPixel(page, 0.5, 0.5)).toEqual([255, 204, 0]);
  expect(await previewPixel(page, 0.1, 0.1)).toEqual(BLACK);
});

test('合成モード（差分）', async ({ page }) => {
  await addAt(page, '単色を追加', 1);
  await addAt(page, '図形を追加', 2);
  await page.getByLabel('合成モード').selectOption('difference');
  await seekRuler(page, 41);
  await expect.poll(() => previewPixel(page, 0.5, 0.5)).toEqual([176, 115, 0]);
});

test('登場の演出（ワイプ）', async ({ page }) => {
  await addAt(page, '図形を追加', 1);
  await page.getByLabel('登場', { exact: true }).selectOption('wipeLeft');
  await spin(page, '登場の時間').fill('1');
  // 0.5 秒時点：左半分だけ見える
  await seekRuler(page, 15 * 4 + 1);
  await expect.poll(() => previewPixel(page, 0.46, 0.5)).toEqual(BLUE);
  expect(await previewPixel(page, 0.54, 0.5)).toEqual(BLACK);
  // 1 秒以降は全体が見える
  await seekRuler(page, 40 * 4 + 1);
  await expect.poll(() => previewPixel(page, 0.54, 0.5)).toEqual(BLUE);
});

test('エフェクトのパラメータもキーフレームで変化する', async ({ page }) => {
  await addAt(page, '図形を追加', 1);
  await page.getByLabel('エフェクトを追加').selectOption('colorAdjust');
  await seekRuler(page, 1);
  await page.getByRole('button', { name: '明るさのキーフレーム' }).click();
  await spin(page, '明るさ').fill('0');
  await seekRuler(page, 30 * 4 + 1);
  await spin(page, '明るさ').fill('100');
  await expect.poll(() => previewPixel(page, 0.5, 0.5)).toEqual(BLUE);
  await seekRuler(page, 1);
  await expect.poll(() => previewPixel(page, 0.5, 0.5)).toEqual(BLACK);
  // タイムラインに中間点の印が出る
  await expect(page.locator('.tl-key')).toHaveCount(1);
});
