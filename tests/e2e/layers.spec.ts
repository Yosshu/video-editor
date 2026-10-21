import { expect, test, type Page } from '@playwright/test';
import { disableFileSystemAccess, previewPixel, seekRuler } from './helpers';

const BLUE: [number, number, number] = [79, 140, 255];
const BLACK: [number, number, number] = [0, 0, 0];

function spin(page: Page, name: string) {
  return page.getByRole('spinbutton', { name, exact: true });
}

async function addAt(page: Page, label: string | RegExp, layer: number) {
  const box = (await page.getByTestId('timeline-tracks').boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + (layer - 1) * 30 + 10, { button: 'right' });
  await page.getByRole('menuitem', { name: label }).click();
  await page.locator('#ins-start').fill('0');
}

/** シーン座標の x（中央が 0）をプレビュー上の割合にする */
const fx = (x: number) => x / 1920 + 0.5;

function isGray([r, g, b]: [number, number, number]) {
  return Math.abs(r - g) < 4 && Math.abs(g - b) < 4 && r > 20;
}

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
});

test('別のシーンをシーンオブジェクトとして配置できる', async ({ page }) => {
  await page.getByRole('button', { name: 'シーンを追加' }).click();
  await expect(page.getByRole('tab', { name: 'シーン 1' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await addAt(page, '図形を追加', 1);
  await page.getByRole('tab', { name: 'メイン' }).click();
  await expect(page.locator('.tl-object')).toHaveCount(0);
  await addAt(page, /シーンを追加/, 1);
  await expect(page.locator('.tl-object', { hasText: 'シーン：シーン 1' })).toBeVisible();
  await spin(page, 'X').fill('300');
  await seekRuler(page, 41);
  await expect.poll(() => previewPixel(page, fx(300), 0.5)).toEqual(BLUE);
  expect(await previewPixel(page, 0.5, 0.5)).toEqual(BLACK);
});

test('グループ制御で下のレイヤーをまとめて動かす', async ({ page }) => {
  await addAt(page, '図形を追加', 2);
  await addAt(page, /グループ制御を追加/, 1);
  await spin(page, 'X').fill('500');
  await seekRuler(page, 41);
  await expect.poll(() => previewPixel(page, fx(500), 0.5)).toEqual(BLUE);
  expect(await previewPixel(page, 0.5, 0.5)).toEqual(BLACK);
});

test('時間制御で静止させる', async ({ page }) => {
  await addAt(page, '図形を追加', 2);
  await seekRuler(page, 1);
  await page.getByRole('button', { name: 'Xのキーフレーム' }).click();
  await spin(page, 'X').fill('-600');
  await seekRuler(page, 30 * 4 + 1);
  await spin(page, 'X').fill('600');
  await addAt(page, /時間制御を追加/, 1);
  await page.getByLabel('静止（開始時点の画面のまま）').check();
  await seekRuler(page, 30 * 4 + 1);
  await expect.poll(() => previewPixel(page, fx(-600), 0.5)).toEqual(BLUE);
  expect(await previewPixel(page, fx(600), 0.5)).toEqual(BLACK);
});

test('部分フィルタは範囲の中だけにかかる', async ({ page }) => {
  await addAt(page, '図形を追加', 1);
  await addAt(page, /部分フィルタを追加/, 2);
  await spin(page, '幅').fill('100');
  await page.getByLabel('エフェクトを追加').selectOption('monochrome');
  await seekRuler(page, 41);
  await expect.poll(async () => isGray(await previewPixel(page, 0.5, 0.5))).toBe(true);
  expect(await previewPixel(page, fx(-100), 0.5)).toEqual(BLUE);
});

test('フレームバッファで上までの画面を動かす', async ({ page }) => {
  await addAt(page, '図形を追加', 1);
  await addAt(page, /フレームバッファを追加/, 2);
  await page.getByLabel('元の画面を消す').check();
  await spin(page, 'X').fill('500');
  await seekRuler(page, 41);
  await expect.poll(() => previewPixel(page, fx(500), 0.5)).toEqual(BLUE);
  expect(await previewPixel(page, 0.5, 0.5)).toEqual(BLACK);
});

test('Z 座標で奥に置くと小さく見え、カメラ制御のズームで大きくなる', async ({ page }) => {
  await addAt(page, '図形を追加', 2);
  await page.getByText('3D', { exact: true }).click();
  await spin(page, 'Z（奥行き）').fill('1024');
  await seekRuler(page, 41);
  // 300px の四角が半分の 150px に見える
  await expect.poll(() => previewPixel(page, fx(100), 0.5)).toEqual(BLACK);
  expect(await previewPixel(page, fx(50), 0.5)).toEqual(BLUE);
  await addAt(page, /カメラ制御を追加/, 1);
  await spin(page, 'ズーム').fill('200');
  await expect.poll(() => previewPixel(page, fx(100), 0.5)).toEqual(BLUE);
});
