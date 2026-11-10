import { expect, test, type Page } from '@playwright/test';
import { addObjectAt, disableFileSystemAccess } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
  await addObjectAt(page, '図形を追加', 1, 10);
});

/** マウスで少しずつドラッグする（steps 回に分けて動かす） */
async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 25 });
  await page.mouse.up();
}

test('プレビューでのドラッグ移動は、1 回の「元に戻す」でドラッグ前に戻り、1 回でやり直せる', async ({
  page,
}) => {
  const x = page.getByLabel('X', { exact: true });
  const y = page.getByLabel('Y', { exact: true });
  await expect(x).toHaveValue('0');
  const box = (await page.getByTestId('preview-canvas').boundingBox())!;
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 80, 40);
  const movedX = await x.inputValue();
  const movedY = await y.inputValue();
  expect(Number(movedX)).toBeGreaterThan(100);
  expect(Number(movedY)).toBeGreaterThan(50);

  await page.keyboard.press('Control+z');
  await expect(x).toHaveValue('0');
  await expect(y).toHaveValue('0');
  await page.keyboard.press('Control+y');
  await expect(x).toHaveValue(movedX);
  await expect(y).toHaveValue(movedY);
  // もう一度元に戻すと、図形を追加する前に戻る（ドラッグの途中の状態は残っていない）
  await page.keyboard.press('Control+z');
  await expect(x).toHaveValue('0');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.tl-object')).toHaveCount(0);
});

test('項目名をドラッグして値を変えたときも、1 回の「元に戻す」で戻る', async ({ page }) => {
  const x = page.getByLabel('X', { exact: true });
  const label = page.locator('label.scrub', { hasText: /^X$/ });
  await label.scrollIntoViewIfNeeded();
  const box = (await label.boundingBox())!;
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 120, 0);
  expect(Number(await x.inputValue())).toBeGreaterThan(0);
  await page.keyboard.press('Control+z');
  await expect(x).toHaveValue('0');
});
