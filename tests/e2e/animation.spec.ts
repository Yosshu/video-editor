import { expect, test, type Page } from '@playwright/test';
import { addObjectAt, disableFileSystemAccess, previewPixel, seekRuler } from './helpers';

const BLUE: [number, number, number] = [79, 140, 255];
const BLACK: [number, number, number] = [0, 0, 0];

async function seekFrame(page: Page, frame: number) {
  await seekRuler(page, frame * 4 + 1);
}

function spin(page: Page, name: string) {
  return page.getByRole('spinbutton', { name, exact: true });
}

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
  await addObjectAt(page, '図形を追加', 10, 10);
  await page.getByLabel('開始').fill('0');
});

test('キーフレームで位置が変化し、変化の仕方を変えられる', async ({ page }) => {
  await seekFrame(page, 0);
  await page.getByRole('button', { name: 'Xのキーフレーム' }).click();
  await spin(page, 'X').fill('-600');
  await seekFrame(page, 30);
  // アニメーション中は、値を変えるとその時刻にキーが追加される
  await spin(page, 'X').fill('600');
  await expect(page.getByRole('button', { name: 'Xのキーフレーム' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.tl-key')).toHaveCount(1);

  await seekFrame(page, 15);
  await expect(spin(page, 'X')).toHaveValue('0');
  await expect.poll(() => previewPixel(page, 0.5, 0.5)).toEqual(BLUE);
  await seekFrame(page, 0);
  await expect.poll(() => previewPixel(page, 0.5, 0.5)).toEqual(BLACK);

  // 瞬間切り替えにすると、次のキーまで値が変わらない
  await seekFrame(page, 15);
  await page.getByLabel('Xの変化の仕方').selectOption('hold');
  await expect(spin(page, 'X')).toHaveValue('-600');
  await expect.poll(() => previewPixel(page, 0.5, 0.5)).toEqual(BLACK);

  // 前後のキーへ移動できる
  await page.getByRole('button', { name: 'Xの次のキーへ' }).click();
  await expect(page.getByTestId('timecode')).toContainText('00:00:01.00');
});

test('中間点の追加・削除', async ({ page }) => {
  await seekFrame(page, 40);
  await page.getByRole('button', { name: '中間点を追加' }).click();
  await expect(page.locator('.tl-key')).toHaveCount(1);
  await spin(page, '拡大率').fill('50');
  await seekFrame(page, 20);
  // 開始時点（100%）から中間点（50%）へ直線で変化する
  await expect(spin(page, '拡大率')).toHaveValue('75');
  await seekFrame(page, 40);
  await page.getByRole('button', { name: '中間点を削除' }).click();
  await expect(page.locator('.tl-key')).toHaveCount(0);
});
