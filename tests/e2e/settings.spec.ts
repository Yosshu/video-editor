import { expect, test } from '@playwright/test';
import { addObjectAt, disableFileSystemAccess, seekRuler, timelineObjects } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
});

test('オブジェクトとエフェクトのプリセットを保存して使う', async ({ page }) => {
  await addObjectAt(page, '図形を追加', 1, 10);
  await page.getByLabel('X', { exact: true }).fill('250');
  await page.getByLabel('エフェクトを追加').selectOption({ label: 'ぼかし' });

  // オブジェクトのプリセット
  page.once('dialog', (d) => d.accept('右の図形'));
  await page.getByLabel('プリセット', { exact: true }).selectOption('save');
  // エフェクトのプリセット
  page.once('dialog', (d) => d.accept('強いぼかし'));
  await page.getByRole('button', { name: 'ぼかしの設定をプリセットに保存' }).click();

  // 別の図形に適用する
  await addObjectAt(page, '図形を追加', 1, 40);
  await expect(page.getByLabel('X', { exact: true })).toHaveValue('0');
  await page.getByLabel('プリセット', { exact: true }).selectOption({ label: '右の図形' });
  await expect(page.getByLabel('X', { exact: true })).toHaveValue('250');
  await expect(page.locator('.effect-card')).toHaveCount(1);

  // エフェクトのプリセットを追加する
  await page.getByLabel('エフェクトを追加').selectOption({ label: '強いぼかし（ぼかし）' });
  await expect(page.locator('.effect-card')).toHaveCount(2);

  // タイムラインの右クリックからプリセットで追加する
  await addObjectAt(page, 'プリセットから追加：右の図形', 1, 70);
  await expect(timelineObjects(page)).toHaveCount(3);
  await expect(page.getByLabel('X', { exact: true })).toHaveValue('250');

  // ページを開き直しても残っている（自動保存を待ってから開き直し、復元はしない）
  await page.waitForTimeout(2500);
  await page.reload();
  await page.getByRole('button', { name: '復元しない' }).click();
  await page.getByRole('button', { name: 'プリセット', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('右の図形');
  await expect(page.getByRole('dialog')).toContainText('強いぼかし');
});

test('ショートカットを変更する', async ({ page }) => {
  await addObjectAt(page, 'テキストを追加', 1, 10);
  await page.getByRole('button', { name: 'ショートカット', exact: true }).click();
  const row = page.locator('tr[data-command="split"]');
  await row.getByRole('button', { name: '再生位置で分割から S を外す' }).click();
  await row.getByRole('button', { name: '再生位置で分割にキーを追加' }).click();
  await page.keyboard.press('k');
  await expect(row).toContainText('K');
  await page.locator('.dialog-footer').getByRole('button', { name: '閉じる' }).click();

  await seekRuler(page, 200);
  await page.keyboard.press('s');
  await expect(timelineObjects(page)).toHaveCount(1);
  await page.keyboard.press('k');
  await expect(timelineObjects(page)).toHaveCount(2);

  // 開き直しても残っていて、既定に戻せる
  await page.reload();
  await page.getByRole('button', { name: 'ショートカット', exact: true }).click();
  await expect(page.locator('tr[data-command="split"]')).toContainText('K');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'すべて既定に戻す' }).click();
  await expect(page.locator('tr[data-command="split"] kbd')).toHaveText(['S']);
});

test('フレームレートを変えると時間を換算する', async ({ page }) => {
  await addObjectAt(page, 'テキストを追加', 1, 10);
  await page.locator('#ins-length').fill('90');
  await page.locator('#ins-start').fill('30');
  await page.getByRole('button', { name: 'プロジェクト設定' }).click();
  await page.locator('#ps-fps').selectOption('60');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '適用' }).click();
  await timelineObjects(page).first().click();
  await expect(page.locator('#ins-start')).toHaveValue('60');
  await expect(page.locator('#ins-length')).toHaveValue('180');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#ins-start')).toHaveValue('30');
});

test('特殊な変化（反復）を選ぶと周期を設定できる', async ({ page }) => {
  await addObjectAt(page, 'テキストを追加', 1, 10);
  await seekRuler(page, 20);
  await page.getByRole('button', { name: 'Xのキーフレーム' }).click();
  await seekRuler(page, 400);
  await page.getByLabel('X', { exact: true }).fill('300');
  await seekRuler(page, 20);
  await page.getByLabel('Xの変化の仕方').selectOption('repeat');
  await expect(page.getByLabel('Xの周期（フレーム）')).toHaveValue('30');
  await page.getByLabel('Xの周期（フレーム）').fill('20');
  // キーの位置（5 フレーム目）から 10 フレーム後は折り返し点 = 300
  await seekRuler(page, (5 + 10) * 4 + 1);
  await expect(page.getByLabel('X', { exact: true })).toHaveValue('300');
});
