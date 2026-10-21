import { expect, test, type Page } from '@playwright/test';
import { disableFileSystemAccess, previewPixel, seekRuler, timelineObjects } from './helpers';

const VIDEO = 'tests/fixtures/sample-vp9-opus.webm';
const IMAGE = 'tests/fixtures/image-green-half.png';
const AUDIO = 'tests/fixtures/tone-1khz.wav';

async function importFiles(page: Page, files: string[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '追加…' }).click();
  await (await chooser).setFiles(files);
  await expect(page.locator('.asset-item')).toHaveCount(files.length);
}

/** 画面上の色が期待した色に近いか */
function near(
  [r, g, b]: [number, number, number],
  [er, eg, eb]: [number, number, number],
  tol = 40,
) {
  return Math.abs(r - er) <= tol && Math.abs(g - eg) <= tol && Math.abs(b - eb) <= tol;
}

/** フレーム番号を指定して再生位置を移動する（30fps・1フレーム = 4px の初期表示を前提） */
async function seekFrame(page: Page, frame: number): Promise<void> {
  await seekRuler(page, frame * 4 + 1);
}

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
});

test('動画・画像・音声を読み込んで素材一覧に表示する', async ({ page }) => {
  await importFiles(page, [VIDEO, IMAGE, AUDIO]);
  await expect(page.locator('.asset-item').nth(0)).toContainText('320×180');
  await expect(page.locator('.asset-item').nth(0)).toContainText('0:02');
  await expect(page.locator('.asset-item').nth(1)).toContainText('64×64');
  await expect(page.locator('.asset-item').nth(2)).toContainText('音声');
});

test('動画のフレームが再生位置に合わせて表示される', async ({ page }) => {
  await importFiles(page, [VIDEO]);
  await page.locator('.asset-item').first().dblclick();
  await expect(timelineObjects(page)).toHaveCount(1);
  // 長さは素材と同じ 2 秒（60 フレーム）
  await expect(page.getByLabel('長さ')).toHaveValue('60');

  await seekFrame(page, 10);
  await expect.poll(async () => near(await previewPixel(page, 0.5, 0.5), [255, 0, 0])).toBe(true);
  await seekFrame(page, 45);
  await expect.poll(async () => near(await previewPixel(page, 0.5, 0.5), [0, 0, 255])).toBe(true);
});

test('再生すると再生位置が進み、停止できる', async ({ page }) => {
  await importFiles(page, [VIDEO, AUDIO]);
  await page.locator('.asset-item').nth(0).dblclick();
  await page.locator('.asset-item').nth(1).dblclick();
  await expect(timelineObjects(page)).toHaveCount(2);
  await page.getByRole('button', { name: '先頭へ' }).click();
  await page.getByRole('button', { name: '再生' }).click();
  await expect(page.getByRole('button', { name: '停止' })).toBeVisible();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: '停止' }).click();
  const tc = await page.getByTestId('timecode').textContent();
  const [, sec, frame] = /00:00:(\d\d)\.(\d\d)/.exec(tc ?? '') ?? [];
  const position = Number(sec) + Number(frame) / 30;
  expect(position).toBeGreaterThan(0.5);
  expect(position).toBeLessThan(1.9);
});

test('再読み込み後、素材を指定し直すと元に戻る', async ({ page }) => {
  await importFiles(page, [VIDEO]);
  await page.locator('.asset-item').first().dblclick();
  await page.waitForTimeout(2500);
  await page.reload();
  await page.getByRole('button', { name: '復元する' }).click();
  await expect(page.getByRole('dialog', { name: '見つからない素材があります' })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイルを選択…' }).click();
  await (await chooser).setFiles([VIDEO]);
  await expect(page.getByText('すべての素材が見つかりました。')).toBeVisible();
  await page.getByRole('button', { name: '完了' }).click();
  await seekFrame(page, 10);
  await expect.poll(async () => near(await previewPixel(page, 0.5, 0.5), [255, 0, 0])).toBe(true);
});
