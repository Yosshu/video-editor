import { expect, test, type Page } from '@playwright/test';
import { addObjectAt, disableFileSystemAccess, previewPixel, seekRuler } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
});

async function setNumber(page: Page, label: string, value: string): Promise<void> {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press('Enter');
}

// 色は #ffd166〜#ff6b6b、だんだん薄くなるので暗めでもよい
const isParticle = ([r, , b]: number[]) => r > 100 && b < r * 0.6;
const isBlack = ([r, g, b]: number[]) => r < 30 && g < 30 && b < 30;

test('パーティクルは時刻だけで決まり、同じ時刻なら同じ絵になる', async ({ page }) => {
  await addObjectAt(page, 'パーティクルを追加', 1, 10);
  // まっすぐ上へ、毎秒 200px で飛ばす
  await setNumber(page, '広がり', '0');
  await setNumber(page, '速さ', '200');
  await setNumber(page, '速さのばらつき', '0');
  await setNumber(page, '重力', '0');
  // 1 秒後（30 フレーム）：中心から上 200px までの線上に粒が並ぶ
  await seekRuler(page, 30 * 4 + 1);
  const above = 0.5 - 100 / 1080;
  const below = 0.5 + 100 / 1080;
  await expect.poll(async () => isParticle(await previewPixel(page, 0.5, above))).toBe(true);
  expect(isBlack(await previewPixel(page, 0.5, below))).toBe(true);
  // 別の時刻へ移動して戻っても、同じ色になる
  const before = await previewPixel(page, 0.5, above - 0.01);
  await seekRuler(page, 50 * 4 + 1);
  await expect.poll(async () => previewPixel(page, 0.5, above - 0.01)).not.toEqual(before);
  await seekRuler(page, 30 * 4 + 1);
  await expect.poll(async () => previewPixel(page, 0.5, above - 0.01)).toEqual(before);
  // 0 フレーム目にはまだ 1 粒だけ（中心）で、上には何もない
  await seekRuler(page, 1);
  await expect.poll(async () => isBlack(await previewPixel(page, 0.5, above))).toBe(true);
  // 方向を下（180°）にすると、下に並ぶ
  await setNumber(page, '方向（0° が上）', '180');
  await seekRuler(page, 30 * 4 + 1);
  await expect.poll(async () => isParticle(await previewPixel(page, 0.5, below))).toBe(true);
  expect(isBlack(await previewPixel(page, 0.5, above))).toBe(true);
});
