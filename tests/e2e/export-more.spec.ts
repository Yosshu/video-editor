import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  addObjectAt,
  disableFileSystemAccess,
  previewPixel,
  seekRuler,
  timelineObjects,
} from './helpers';

const SHAPE = [79, 140, 255];
const near = (a: number[], b: number[], tol = 40) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
});

/** 図形を置いて書き出しの画面を開き、範囲（フレーム）と大きさを決める */
async function openExport(page: Page, endFrame: number): Promise<void> {
  await addObjectAt(page, '図形を追加', 1, 10);
  await page.getByRole('button', { name: '書き出し', exact: true }).click();
  await expect(page.locator('#ex-vcodec option').first()).not.toHaveText('確認中…');
  await page.locator('#ex-size').selectOption('0.25');
  await page.getByLabel('指定').check();
  await page.getByLabel('開始フレーム').fill('0');
  await page.getByLabel('終了フレーム').fill(String(endFrame));
}

/** ブラウザの画像デコーダーで、画像のコマ数と、指定位置（0〜1）の RGBA を読む */
async function decodeImage(page: Page, bytes: Buffer, type: string, points: [number, number][]) {
  return page.evaluate(
    async ({ data, type, points }) => {
      const decoder = new ImageDecoder({ data: new Uint8Array(data), type });
      await decoder.tracks.ready;
      await decoder.completed;
      const frameCount = decoder.tracks.selectedTrack!.frameCount;
      const { image } = await decoder.decode({ frameIndex: 0 });
      const canvas = new OffscreenCanvas(image.displayWidth, image.displayHeight);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      const pixels = points.map(([x, y]) => [
        ...ctx.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data,
      ]);
      const size = [image.displayWidth, image.displayHeight];
      image.close();
      return { frameCount, pixels, size };
    },
    { data: [...bytes], type, points },
  );
}

test('アニメーション GIF を背景を透明にして書き出せる', async ({ page }) => {
  await openExport(page, 30);
  await page.locator('#ex-format').selectOption('gif');
  await expect(page.locator('#ex-vcodec')).toHaveCount(0);
  await page.locator('#ex-gif-fps').selectOption('10');
  await page.getByLabel('透明にする').check();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '書き出し開始' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('video.gif');
  const bytes = await readFile(await file.path());
  expect(bytes.subarray(0, 6).toString()).toBe('GIF89a');
  // 1 秒 × 10 fps = 10 コマ。中心は図形の色、角は透明
  const { frameCount, pixels, size } = await decodeImage(page, bytes, 'image/gif', [
    [0.5, 0.5],
    [0.05, 0.05],
  ]);
  expect(frameCount).toBe(10);
  expect(size).toEqual([480, 270]);
  expect(near(pixels[0], [...SHAPE, 255], 12)).toBe(true);
  expect(pixels[1][3]).toBe(0);
});

test('連番 PNG を ZIP にまとめて書き出せる', async ({ page }) => {
  await openExport(page, 3);
  await page.locator('#ex-format').selectOption('png');
  await page.getByLabel('透明にする').check();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '書き出し開始' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('video_png.zip');
  const bytes = await readFile(await file.path());
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  const text = bytes.toString('latin1');
  for (const name of ['video_00000.png', 'video_00001.png', 'video_00002.png']) {
    expect(text).toContain(name);
  }
  expect(text).not.toContain('video_00003.png');
  // 最初の PNG を取り出して、透明になっているか確かめる
  const start = bytes.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const end = bytes.indexOf(Buffer.from('IEND'), start) + 8;
  const { pixels } = await decodeImage(page, bytes.subarray(start, end), 'image/png', [
    [0.5, 0.5],
    [0.05, 0.05],
  ]);
  expect(near(pixels[0], [...SHAPE, 255], 4)).toBe(true);
  expect(pixels[1][3]).toBe(0);
});

test('背景を透明にした WebM を書き出し、読み込み直すと下のレイヤーが透けて見える', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openExport(page, 15);
  await page.locator('#ex-format').selectOption('webm');
  await page.locator('#ex-vcodec').selectOption('vp9');
  await page.getByLabel('音声を含める').uncheck();
  await page.getByLabel('透明にする').check();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '書き出し開始' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('video.webm');
  await expect(page.getByTestId('export-done')).toContainText('ダウンロードしました');
  await page.locator('.dialog-footer').getByRole('button', { name: '閉じる' }).click();

  // 図形を隠し、白い単色の上に書き出した動画を置く
  await page.getByRole('button', { name: 'レイヤー 1 の表示切り替え' }).click();
  await addObjectAt(page, '単色を追加', 1, 10 + 40);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '追加…' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'video.webm',
    mimeType: 'video/webm',
    buffer: await readFile(await file.path()),
  });
  await expect(page.locator('.asset-item')).toContainText('480×270');
  await page.locator('.asset-item').first().dblclick();
  await expect(timelineObjects(page)).toHaveCount(3);
  await seekRuler(page, 5 * 4 + 1);
  // 動画の中心は図形の色、動画の中でも図形の外は透明（白が見える）
  await expect.poll(async () => near(await previewPixel(page, 0.5, 0.5), SHAPE)).toBe(true);
  await expect
    .poll(async () => near(await previewPixel(page, 0.5 + 150 / 1920, 0.5), [255, 255, 255]))
    .toBe(true);
});
