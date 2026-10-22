import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { disableFileSystemAccess, seekRuler, timelineObjects } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
});

test('素材ごと保存したパッケージを開くと、素材を指定し直さずに元に戻る', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '追加…' }).click();
  await (
    await chooser
  ).setFiles(['tests/fixtures/image-green-half.png', 'tests/fixtures/tone-1khz.wav']);
  await expect(page.locator('.asset-item')).toHaveCount(2);
  await page.locator('.asset-item').first().dblclick();
  await expect(timelineObjects(page)).toHaveCount(1);

  page.once('dialog', (d) => d.accept('pack-test'));
  // ファイル名を決めるため、先に通常の保存をしておく
  const saved = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await saved;
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '素材ごと保存' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('pack-test.vedpack');
  const path = await file.path();
  const data = await readFile(path);
  // 先頭は ZIP、最初のファイルは mimetype
  expect(data.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  expect(data.subarray(38, 59).toString()).toBe('application/x-vedpack');

  // 新しいプロジェクトにしてから、パッケージを開く
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '新規' }).click();
  await page.getByRole('button', { name: '作成' }).click();
  await expect(page.locator('.asset-item')).toHaveCount(0);

  const open = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '開く' }).click();
  // ダウンロードした一時ファイルには拡張子がないので、名前を付けて渡す
  await (
    await open
  ).setFiles({ name: 'pack-test.vedpack', mimeType: 'application/zip', buffer: data });
  await expect(page.locator('.asset-item')).toHaveCount(2);
  await expect(timelineObjects(page)).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // 画像が表示される（左半分が緑）
  await seekRuler(page, 41);
  await expect(page.locator('.asset-item.missing')).toHaveCount(0);
});
