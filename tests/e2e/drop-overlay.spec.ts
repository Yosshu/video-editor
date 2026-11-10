import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { disableFileSystemAccess } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
});

/** 画像ファイルを持ったドラッグのデータを作る */
async function fileTransfer(page: Page) {
  const bytes = [...(await readFile('tests/fixtures/image-green-half.png'))];
  return page.evaluateHandle((data) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(data)], 'green.png', { type: 'image/png' }));
    return dt;
  }, bytes);
}

test('素材一覧やタイムラインに投下した後は「ドロップして読み込む」の表示が消える', async ({
  page,
}) => {
  const editor = page.locator('.editor');
  for (const target of ['.media-bin', '[data-testid="timeline-tracks"]']) {
    const dt = await fileTransfer(page);
    await page.locator('.preview-panel').dispatchEvent('dragover', { dataTransfer: dt });
    await expect(editor).toHaveClass(/window-drag-over/);
    await page.locator(target).dispatchEvent('drop', { dataTransfer: dt });
    await expect(editor).not.toHaveClass(/window-drag-over/);
  }
  await expect(page.locator('.asset-item')).toHaveCount(1);
});

test('ファイルを持ったままウィンドウの外へ出ると表示が消える', async ({ page }) => {
  const editor = page.locator('.editor');
  const dt = await fileTransfer(page);
  await page.locator('.preview-panel').dispatchEvent('dragover', { dataTransfer: dt });
  await expect(editor).toHaveClass(/window-drag-over/);
  // 子の要素の上からウィンドウの外へ出る（行き先がない）
  await page.locator('.preview-panel').dispatchEvent('dragleave', { dataTransfer: dt });
  await expect(editor).not.toHaveClass(/window-drag-over/);
});
