import { expect, test } from '@playwright/test';

test.describe('英語のブラウザ', () => {
  test.use({ locale: 'en-US' });

  test('英語で表示され、言語と配色を切り替えられる', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    // 右クリックのメニューと、追加したテキストの最初の文字も英語
    const box = (await page.getByTestId('timeline-tracks').boundingBox())!;
    await page.mouse.click(box.x + 4, box.y + 10, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Add text' }).click();
    await expect(page.getByLabel('Text', { exact: true })).toHaveValue('Text');
    await expect(page.locator('.param-group summary').first()).toHaveText('Time');

    // 日本語に切り替えると、開いている画面の文言も変わる（編集内容はそのまま）
    await page.getByLabel('Language / 言語').selectOption('ja');
    await expect(page.getByRole('button', { name: '書き出し', exact: true })).toBeVisible();
    await expect(page.locator('.tl-object')).toHaveCount(1);

    // 配色の切り替えと保存
    const before = await page.locator('html').getAttribute('data-theme');
    await page.getByRole('button', { name: /配色にする/ }).click();
    const after = await page.locator('html').getAttribute('data-theme');
    expect(after).not.toBe(before);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', after!);
    await expect(page.getByRole('button', { name: '書き出し', exact: true })).toBeVisible();
  });
});
