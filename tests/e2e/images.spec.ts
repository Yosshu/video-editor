import { expect, test, type Page } from '@playwright/test';
import {
  addObjectAt,
  disableFileSystemAccess,
  previewPixel,
  seekRuler,
  timelineObjects,
} from './helpers';

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
const WHITE = [255, 255, 255];

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

test('連番画像を 1 本の動画として読み込み、透明度も残す', async ({ page }) => {
  // 左半分が透明な 10 枚（1〜5 が赤、6〜10 が青）。名前の数字の順に並べる
  const files = Array.from({ length: 10 }, (_, i) => `tests/fixtures/seq/frame_${i + 1}.png`);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '連番画像…' }).click();
  await (await chooser).setFiles(files.reverse());
  await expect(page.getByText('10 枚の画像を')).toBeVisible();
  await page.getByLabel('フレームレート').fill('10');
  await page.getByRole('button', { name: '読み込む' }).click();
  await expect(page.locator('.asset-item')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator('.asset-item')).toContainText('frame_1-10.webm');
  await expect(page.locator('.asset-item')).toContainText('0:01');

  // 下のレイヤーに白い単色を置き、透明な部分から見えるようにする
  await addObjectAt(page, '単色を追加', 1, 10);
  await page.locator('.asset-item').first().dblclick();
  await expect(timelineObjects(page)).toHaveCount(2);
  await expect(page.getByLabel('長さ')).toHaveValue('30');
  const right = 0.5 + 40 / 1920;
  const left = 0.5 - 40 / 1920;
  await seekFrame(page, 7);
  await expect.poll(async () => near(await previewPixel(page, right, 0.5), RED)).toBe(true);
  // 透明な部分は下の単色（白）が見える
  await expect.poll(async () => near(await previewPixel(page, left, 0.5), WHITE)).toBe(true);
  await seekFrame(page, 22);
  await expect.poll(async () => near(await previewPixel(page, right, 0.5), BLUE)).toBe(true);
  await expect.poll(async () => near(await previewPixel(page, left, 0.5), WHITE)).toBe(true);
});

test('連番画像から作った動画は、再読み込みしてもブラウザから復元される', async ({ page }) => {
  const files = Array.from({ length: 10 }, (_, i) => `tests/fixtures/seq/frame_${i + 1}.png`);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '連番画像…' }).click();
  await (await chooser).setFiles(files);
  await page.getByLabel('フレームレート').fill('10');
  await page.getByRole('button', { name: '読み込む' }).click();
  await expect(page.locator('.asset-item')).toHaveCount(1, { timeout: 30_000 });
  await page.locator('.asset-item').first().dblclick();
  await expect(timelineObjects(page)).toHaveCount(1);
  await page.waitForTimeout(2500);
  await page.reload();
  await page.getByRole('button', { name: '復元する' }).click();
  await expect(page.locator('.asset-item')).toContainText('0:01');
  await expect(page.getByRole('dialog', { name: '見つからない素材があります' })).toHaveCount(0);
  await seekFrame(page, 22);
  await expect
    .poll(async () => near(await previewPixel(page, 0.5 + 40 / 1920, 0.5), BLUE))
    .toBe(true);
});
