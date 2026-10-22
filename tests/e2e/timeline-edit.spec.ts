import { expect, test, type Page } from '@playwright/test';
import { addObjectAt, disableFileSystemAccess, timelineObjects } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
});

/** 既定の拡大率（1 フレーム 4px）でのフレーム → タイムライン上の x */
const px = (frame: number) => frame * 4 + 1;

/** テキストを置いて、開始と長さを数値で指定する */
async function addText(page: Page, frame: number, length: number, layer = 1) {
  await addObjectAt(page, 'テキストを追加', px(frame), (layer - 1) * 28 + 10);
  await page.locator('#ins-length').fill(String(length));
}

async function startOf(page: Page, index: number): Promise<number> {
  await timelineObjects(page).nth(index).click();
  return Number(await page.locator('#ins-start').inputValue());
}

test('リップル削除・空白を詰める', async ({ page }) => {
  await addText(page, 0, 30);
  await addText(page, 50, 30);
  await addText(page, 100, 30);
  await expect(timelineObjects(page)).toHaveCount(3);

  // 2 つ目を削除して詰める → 3 つ目が 30 フレーム前へ
  await timelineObjects(page).nth(1).click();
  await page.keyboard.press('Shift+Delete');
  await expect(timelineObjects(page)).toHaveCount(2);
  expect(await startOf(page, 1)).toBe(70);

  // 30〜70 の空白を詰める
  const box = (await page.getByTestId('timeline-tracks').boundingBox())!;
  await page.mouse.click(box.x + px(50), box.y + 10, { button: 'right' });
  await page.getByRole('menuitem', { name: '空白を詰める（このレイヤー）' }).click();
  expect(await startOf(page, 1)).toBe(30);

  await page.keyboard.press('Control+z');
  expect(await startOf(page, 1)).toBe(70);
});

test('レイヤーの挿入・削除と、まとまりの折りたたみ', async ({ page }) => {
  await addText(page, 0, 30, 1);
  await addText(page, 0, 30, 2);
  const header = (i: number) => page.locator(`.tl-layer-header[data-layer="${i}"]`);

  // レイヤー 1 の位置に挿入 → 中身は 2・3 へ
  await header(1).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'この位置にレイヤーを挿入' }).click();
  await timelineObjects(page).nth(0).click();
  await expect(page.locator('.timing-grid')).toContainText('レイヤー2');
  await timelineObjects(page).nth(1).click();
  await expect(page.locator('.timing-grid')).toContainText('レイヤー3');

  // 空になったレイヤー 1 を削除 → 元に戻る
  await header(1).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'このレイヤーを削除（中身ごと）' }).click();
  await timelineObjects(page).nth(0).click();
  await expect(page.locator('.timing-grid')).toContainText('レイヤー1');

  // レイヤー 1 の下の 2 レイヤーをまとめて折りたたむ
  const before = await page.locator('.tl-layer-header').count();
  page.once('dialog', (d) => d.accept('2'));
  await header(1).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '下のレイヤーとまとめる…' }).click();
  await page.getByRole('button', { name: 'レイヤー 1 のまとまりを折りたたむ' }).click();
  await expect(page.locator('.tl-layer-header')).toHaveCount(before - 2);
  // 折りたたまれたレイヤー 2 のオブジェクトは表示しない
  await expect(timelineObjects(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'レイヤー 1 のまとまりを開く' }).click();
  await expect(timelineObjects(page)).toHaveCount(2);
});

test('前のオブジェクトの終了時の値を引き継ぐ', async ({ page }) => {
  await addText(page, 0, 30);
  await page.getByLabel('X', { exact: true }).fill('123');
  await addText(page, 50, 30);
  await expect(page.getByLabel('X', { exact: true })).toHaveValue('0');
  await timelineObjects(page).nth(1).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '前のオブジェクトの終了時の値を引き継ぐ' }).click();
  await expect(page.getByLabel('X', { exact: true })).toHaveValue('123');
});
