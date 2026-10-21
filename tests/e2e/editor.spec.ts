import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  addObjectAt,
  disableFileSystemAccess,
  previewPixel,
  seekRuler,
  timelineObjects,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
});

test('図形を追加するとプレビューに描画される', async ({ page }) => {
  await addObjectAt(page, '図形を追加', 10, 10);
  await expect(timelineObjects(page)).toHaveCount(1);
  await seekRuler(page, 60);
  await expect.poll(() => previewPixel(page, 0.5, 0.5)).toEqual([79, 140, 255]);
  // 背景は黒
  expect(await previewPixel(page, 0.05, 0.05)).toEqual([0, 0, 0]);
});

test('元に戻す・やり直し・分割・削除', async ({ page }) => {
  await addObjectAt(page, 'テキストを追加', 10, 10);
  await expect(timelineObjects(page)).toHaveCount(1);
  await seekRuler(page, 200);
  await page.keyboard.press('s');
  await expect(timelineObjects(page)).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(timelineObjects(page)).toHaveCount(1);
  await page.keyboard.press('Control+y');
  await expect(timelineObjects(page)).toHaveCount(2);
  await timelineObjects(page).first().click();
  await page.keyboard.press('Delete');
  await expect(timelineObjects(page)).toHaveCount(1);
});

test('編集ファイルを保存して開き直すと同じ状態に戻る', async ({ page }) => {
  await addObjectAt(page, 'テキストを追加', 10, 10);
  await page.getByLabel('文字', { exact: true }).fill('保存テスト');
  await addObjectAt(page, '図形を追加', 30, 40);
  await expect(timelineObjects(page)).toHaveCount(2);

  page.once('dialog', (d) => d.accept('e2e-project'));
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('e2e-project.vedproj');
  const path = await download.path();
  const json = JSON.parse(await readFile(path, 'utf-8'));
  expect(json.format).toBe('vedproj');
  expect(json.scenes[0].objects).toHaveLength(2);

  // 新しいプロジェクトにしてから開き直す
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '新規' }).click();
  await page.getByRole('button', { name: '作成' }).click();
  await expect(timelineObjects(page)).toHaveCount(0);

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '開く' }).click();
  const chooser = await chooserPromise;
  // パスに日本語（テスト名）を含むと選択できないため、内容を直接渡す
  await chooser.setFiles({
    name: 'e2e-project.vedproj',
    mimeType: 'application/json',
    buffer: await readFile(path),
  });
  await expect(timelineObjects(page)).toHaveCount(2);
  await expect(page.locator('.tl-object', { hasText: '保存テスト' })).toBeVisible();
  await expect(page.locator('.file-name')).toHaveText('e2e-project.vedproj');
});

test('ページを再読み込みすると自動保存から復元できる', async ({ page }) => {
  await addObjectAt(page, '図形を追加', 10, 10);
  await expect(timelineObjects(page)).toHaveCount(1);
  // 自動保存を待つ
  await page.waitForTimeout(2500);
  await page.reload();
  await page.getByRole('button', { name: '復元する' }).click();
  await expect(timelineObjects(page)).toHaveCount(1);
});
