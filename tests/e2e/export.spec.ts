import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { disableFileSystemAccess, previewPixel, seekRuler, timelineObjects } from './helpers';

const VIDEO = 'tests/fixtures/sample-vp9-opus.webm';
const AUDIO = 'tests/fixtures/tone-1khz.wav';

function near(
  [r, g, b]: [number, number, number],
  [er, eg, eb]: [number, number, number],
  tol = 50,
) {
  return Math.abs(r - er) <= tol && Math.abs(g - eg) <= tol && Math.abs(b - eb) <= tol;
}

async function addMedia(
  page: Page,
  files: (string | { name: string; mimeType: string; buffer: Buffer })[],
) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '追加…' }).click();
  await (await chooser).setFiles(files as never);
}

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
});

test('動画を書き出し、書き出したファイルを読み込み直すと同じ映像になる', async ({ page }) => {
  test.setTimeout(120_000);
  await addMedia(page, [VIDEO, AUDIO]);
  await expect(page.locator('.asset-item')).toHaveCount(2);
  await page.locator('.asset-item').nth(0).dblclick();
  await page.locator('.asset-item').nth(1).dblclick();
  await expect(timelineObjects(page)).toHaveCount(2);

  await page.getByRole('button', { name: '書き出し', exact: true }).click();
  // 使えるコーデックの確認が終わるのを待つ
  await expect(page.locator('#ex-vcodec option').first()).not.toHaveText('確認中…');
  await page.locator('#ex-size').selectOption('0.5');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '書き出し開始' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^video\.(mp4|webm)$/);
  await expect(page.getByTestId('export-done')).toContainText('ダウンロードしました');
  await page.locator('.dialog-footer').getByRole('button', { name: '閉じる' }).click();

  // 書き出したファイルを素材として読み込み直す
  const buffer = await readFile(await file.path());
  const name = file.suggestedFilename();
  await addMedia(page, [
    { name, mimeType: name.endsWith('.mp4') ? 'video/mp4' : 'video/webm', buffer },
  ]);
  const exported = page.locator('.asset-item').nth(2);
  await expect(exported).toContainText('960×540');
  await expect(exported).toContainText('0:02');

  // 元の動画のレイヤーを隠し、書き出した動画だけを表示する
  await page.getByRole('button', { name: 'レイヤー 1 の表示切り替え' }).click();
  await exported.dblclick();
  await expect(timelineObjects(page)).toHaveCount(3);
  // 音声も含まれている（波形が表示される）
  await expect(page.locator('.tl-object').nth(2).locator('.tl-waveform')).toBeVisible();

  await seekRuler(page, 10 * 4 + 1);
  await expect.poll(async () => near(await previewPixel(page, 0.5, 0.5), [255, 0, 0])).toBe(true);
  await seekRuler(page, 45 * 4 + 1);
  await expect.poll(async () => near(await previewPixel(page, 0.5, 0.5), [0, 0, 255])).toBe(true);
});

test('音声のみ（WAV）と静止画（PNG）を書き出せる', async ({ page }) => {
  await addMedia(page, [VIDEO]);
  await page.locator('.asset-item').first().dblclick();
  await page.getByRole('button', { name: '書き出し', exact: true }).click();

  const wav = page.waitForEvent('download');
  await page.getByRole('button', { name: '音声のみ（WAV）' }).click();
  const wavFile = await wav;
  expect(wavFile.suggestedFilename()).toBe('video.wav');
  const wavData = await readFile(await wavFile.path());
  expect(wavData.subarray(0, 4).toString()).toBe('RIFF');
  // 2 秒 × 48kHz × 2ch × 16bit + ヘッダー 44 バイト
  expect(wavData.length).toBe(44 + 2 * 48000 * 2 * 2);
  await page.locator('.dialog-footer').getByRole('button', { name: '閉じる' }).click();

  await seekRuler(page, 10 * 4 + 1);
  await page.getByRole('button', { name: '書き出し', exact: true }).click();
  const png = page.waitForEvent('download');
  await page.getByRole('button', { name: '静止画（PNG）' }).click();
  const pngFile = await png;
  expect(pngFile.suggestedFilename()).toMatch(/^video_\d+\.png$/);
  const pngData = await readFile(await pngFile.path());
  expect(pngData.subarray(1, 4).toString()).toBe('PNG');
});
