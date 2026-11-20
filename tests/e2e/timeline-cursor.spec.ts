import { expect, test, type Page } from '@playwright/test';
import { addObjectAt, disableFileSystemAccess, timelineObjects } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
});

/** 画面上の位置にある要素のカーソル */
function cursorAt(page: Page, x: number, y: number) {
  return page.evaluate(
    ([px, py]) => getComputedStyle(document.elementFromPoint(px, py)!).cursor,
    [x, y],
  );
}

test('帯の端では左右の矢印、真ん中では手の形のカーソルになり、端のドラッグで長さが変わる', async ({
  page,
}) => {
  await addObjectAt(page, '図形を追加', 1, 10);
  const box = (await timelineObjects(page).first().boundingBox())!;
  const y = box.y + box.height / 2;
  expect(await cursorAt(page, box.x + 3, y)).toBe('ew-resize');
  expect(await cursorAt(page, box.x + box.width - 3, y)).toBe('ew-resize');
  expect(await cursorAt(page, box.x + box.width / 2, y)).toBe('grab');

  const length = page.getByLabel('長さ');
  const before = Number(await length.inputValue());
  // 終わりの端を左へ 40px（10 フレーム）ドラッグすると短くなる
  await page.mouse.move(box.x + box.width - 3, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 43, y, { steps: 5 });
  await page.mouse.up();
  await expect(length).toHaveValue(String(before - 10));
  // 真ん中のドラッグは移動（長さは変わらない）
  await page.mouse.move(box.x + 100, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByLabel('開始')).toHaveValue('10');
  await expect(length).toHaveValue(String(before - 10));
});
