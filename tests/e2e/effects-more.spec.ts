import { expect, test } from '@playwright/test';
import { addObjectAt, disableFileSystemAccess, previewPixel, seekRuler } from './helpers';

const BLUE: [number, number, number] = [79, 140, 255];
const BLACK: [number, number, number] = [0, 0, 0];

function near(a: [number, number, number], b: [number, number, number], tol = 24) {
  return a.every((v, i) => Math.abs(v - b[i]) <= tol);
}

/** シーンの座標（px、中央が原点）→ プレビュー上の割合 */
const fx = (x: number) => 0.5 + x / 1920;
const fy = (y: number) => 0.5 + y / 1080;

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
  // 幅・高さ 300px の青い四角形を中央に置く
  await addObjectAt(page, '図形を追加', 1, 10);
  await seekRuler(page, 41);
  await expect.poll(() => previewPixel(page, 0.5, 0.5)).toEqual(BLUE);
});

test('ミラー：右側に反転した図形が並ぶ', async ({ page }) => {
  expect(await previewPixel(page, fx(300), 0.5)).toEqual(BLACK);
  await page.getByLabel('エフェクトを追加').selectOption({ label: 'ミラー' });
  await expect.poll(async () => near(await previewPixel(page, fx(300), 0.5), BLUE)).toBe(true);
  await expect.poll(async () => near(await previewPixel(page, fx(-300), 0.5), BLACK)).toBe(true);
});

test('斜めクリッピング：直線の片側を消す', async ({ page }) => {
  await page.getByLabel('エフェクトを追加').selectOption({ label: '斜めクリッピング' });
  await expect.poll(async () => near(await previewPixel(page, fx(75), 0.5), BLACK)).toBe(true);
  expect(near(await previewPixel(page, fx(-75), 0.5), BLUE)).toBe(true);
});

test('画像ループ：縦横に並べる', async ({ page }) => {
  await page.getByLabel('エフェクトを追加').selectOption({ label: '画像ループ（並べる）' });
  await expect.poll(async () => near(await previewPixel(page, fx(280), fy(280)), BLUE)).toBe(true);
  expect(near(await previewPixel(page, fx(-280), fy(-280)), BLUE)).toBe(true);
});

test('色ずれ：端に赤と青のずれが出る', async ({ page }) => {
  await page.getByLabel('エフェクトを追加').selectOption({ label: '色ずれ' });
  await page.getByLabel('ずれ幅', { exact: true }).fill('20');
  // 角度 0 では赤が左へ、青が右へずれる。右端の外側には青だけ、左端の外側には赤だけが残る
  await expect
    .poll(async () => {
      const [r, g, b] = await previewPixel(page, fx(160), 0.5);
      return r < 20 && g < 20 && b > 200;
    })
    .toBe(true);
  const [r, g, b] = await previewPixel(page, fx(-160), 0.5);
  expect(r > 40 && g < 20 && b < 20).toBe(true);
});

test('音声波形：対象のレイヤーの音の大きさを棒で表示する', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '追加…' }).click();
  await (await chooser).setFiles('tests/fixtures/tone-1khz.wav');
  // 図形のあるレイヤー 1 を空けるため、四角形は消しておく
  await page.locator('.tl-object').first().click();
  await page.keyboard.press('Delete');
  await page.locator('.asset-item').first().dblclick();
  await addObjectAt(page, '音声波形を追加（音声・動画の音を表示する）', 1, 40);
  await expect(page.locator('.tl-object').nth(1)).toContainText('レイヤー 1 の音');
  await seekRuler(page, 15 * 4 + 1);
  // 高さ 200px の枠の下半分（振幅 0.5）に棒が描かれる。棒の中の点と、上の空いている点を調べる
  const barX = fx(-400 + 24 * (800 / 48) + 8);
  await expect.poll(async () => near(await previewPixel(page, barX, fy(70)), BLUE)).toBe(true);
  expect(near(await previewPixel(page, barX, fy(-70)), BLACK)).toBe(true);
});
