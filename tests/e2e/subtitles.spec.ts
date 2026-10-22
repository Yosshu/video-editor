import { expect, test } from '@playwright/test';
import { disableFileSystemAccess, timelineObjects } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
});

test('字幕ファイルから字幕ごとにテキストオブジェクトを作る', async ({ page }) => {
  const box = (await page.getByTestId('timeline-tracks').boundingBox())!;
  await page.mouse.click(box.x + 1, box.y + 10, { button: 'right' });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: '字幕ファイル（SRT・WebVTT）を読み込む…' }).click();
  await (await chooser).setFiles('tests/fixtures/sample.srt');
  await expect(page.getByText('3 個の字幕を読み込みました。')).toBeVisible();
  await expect(timelineObjects(page)).toHaveCount(3);
  const objects = timelineObjects(page);
  await expect(objects.filter({ hasText: '最初の字幕' })).toHaveCount(1);
  // 書式のタグは取り除く
  await expect(objects.filter({ hasText: '重なる字幕' })).toHaveCount(1);
  await expect(objects.filter({ hasText: '3 つ目' })).toHaveCount(1);

  // 時刻（30fps）と、重なる字幕は下のレイヤーに置かれること
  await objects.filter({ hasText: '最初の字幕' }).click();
  await expect(page.getByLabel('開始')).toHaveValue('15');
  await expect(page.getByLabel('長さ')).toHaveValue('30');
  await expect(page.getByTestId('inspector-layer')).toHaveText('1');
  await objects.filter({ hasText: '重なる字幕' }).click();
  await expect(page.getByLabel('開始')).toHaveValue('30');
  await expect(page.getByTestId('inspector-layer')).toHaveText('2');
  await objects.filter({ hasText: '3 つ目' }).click();
  await expect(page.getByTestId('inspector-layer')).toHaveText('1');
  await expect(page.getByLabel('文字', { exact: true })).toHaveValue('3 つ目\n2 行目');
});
