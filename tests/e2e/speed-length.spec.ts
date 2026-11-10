import { expect, test, type Page } from '@playwright/test';
import { addObjectAt, disableFileSystemAccess, timelineObjects } from './helpers';

const VIDEO = 'tests/fixtures/sample-vp9-opus.webm';

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
});

async function setSpeed(page: Page, value: string): Promise<void> {
  const input = page.getByLabel('再生速度', { exact: true });
  await input.fill(value);
  await input.press('Enter');
}

test('再生速度を変えると長さも変わり、伸ばすときは次のオブジェクトの手前で止まる', async ({
  page,
}) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '追加…' }).click();
  await (await chooser).setFiles(VIDEO);
  await page.locator('.asset-item').first().dblclick();
  const video = timelineObjects(page).filter({ hasText: 'sample-vp9-opus.webm' });
  const length = page.getByLabel('長さ');
  // 2 秒の動画（30fps で 60 フレーム）
  await expect(length).toHaveValue('60');

  // 2 倍速で半分の長さ、0.8 倍速で 75 フレーム
  await setSpeed(page, '200');
  await expect(length).toHaveValue('30');
  await setSpeed(page, '80');
  await expect(length).toHaveValue('75');
  await setSpeed(page, '100');
  await expect(length).toHaveValue('60');

  // 同じレイヤーの 70 フレーム目に図形を置く（1 フレーム = 4px）
  await addObjectAt(page, '図形を追加', 70 * 4 + 1, 10);
  await expect(timelineObjects(page)).toHaveCount(2);
  await video.click();
  // 半分の速さなら 120 フレームになるはずだが、図形の手前（70 フレーム）で止まる
  await setSpeed(page, '50');
  await expect(length).toHaveValue('70');
  await expect(
    page.getByText('同じレイヤーの次のオブジェクトの手前までの長さにしました。'),
  ).toBeVisible();
  // 速さを戻すと元の長さに戻る
  await setSpeed(page, '100');
  await expect(length).toHaveValue('60');

  // ループ再生のときは長さを変えない
  await page.getByLabel('ループ再生').check();
  await setSpeed(page, '200');
  await expect(length).toHaveValue('60');
});

test('速度と長さの変更は 1 回の「元に戻す」で戻る', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '追加…' }).click();
  await (await chooser).setFiles(VIDEO);
  await page.locator('.asset-item').first().dblclick();
  const length = page.getByLabel('長さ');
  await expect(length).toHaveValue('60');
  await setSpeed(page, '200');
  await expect(length).toHaveValue('30');
  await page.getByRole('button', { name: '元に戻す' }).click();
  await expect(length).toHaveValue('60');
  await expect(page.getByLabel('再生速度', { exact: true })).toHaveValue('100');
});
