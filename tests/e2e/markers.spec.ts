import { expect, test } from '@playwright/test';
import { addObjectAt, disableFileSystemAccess, seekRuler, timelineObjects } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
});

test('マーカーの追加・移動・名前と、前後のマーカーへの移動', async ({ page }) => {
  await seekRuler(page, 40 * 4 + 1);
  await page.keyboard.press('m');
  await seekRuler(page, 100 * 4 + 1);
  await page.keyboard.press('m');
  await expect(page.getByTestId('marker')).toHaveCount(2);

  await page.keyboard.press('Home');
  await page.keyboard.press('Control+ArrowRight');
  await expect(page.getByTestId('timecode')).toContainText('00:00:01.10 /');
  await page.keyboard.press('Control+ArrowRight');
  await expect(page.getByTestId('timecode')).toContainText('00:00:03.10 /');
  await page.keyboard.press('Control+ArrowLeft');
  await expect(page.getByTestId('timecode')).toContainText('00:00:01.10 /');

  // 名前を付ける
  page.once('dialog', (d) => d.accept('サビ'));
  await page.getByTestId('marker').first().dblclick();
  await expect(page.getByTestId('marker').first()).toContainText('サビ');

  // ドラッグで 10 フレーム後ろへ
  const m = (await page.getByTestId('marker').first().boundingBox())!;
  await page.mouse.move(m.x + m.width / 2, m.y + 4);
  await page.mouse.down();
  await page.mouse.move(m.x + m.width / 2 + 20, m.y + 4, { steps: 4 });
  await page.mouse.move(m.x + m.width / 2 + 40, m.y + 4, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('timecode')).toContainText('00:00:01.20 /');

  // 右クリックで削除
  await page.getByTestId('marker').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'マーカーを削除' }).click();
  await expect(page.getByTestId('marker')).toHaveCount(1);
});

test('BPM グリッドを表示し、拍に吸着する', async ({ page }) => {
  await page.getByRole('button', { name: /^BPM/ }).click();
  await page.locator('#bg-visible').check();
  await page.getByLabel('BPM', { exact: true }).fill('120');
  await page.locator('.dialog-footer').getByRole('button', { name: '閉じる' }).click();
  await expect(page.locator('.tl-beat').first()).toBeAttached();
  await expect(page.locator('.tl-beat.bar').first()).toBeAttached();

  // 120 BPM・30fps では 1 拍 = 15 フレーム。14 フレーム分ドラッグすると 15 に吸着する
  await addObjectAt(page, 'テキストを追加', 1, 10);
  const o = (await timelineObjects(page).first().boundingBox())!;
  await page.mouse.move(o.x + 100, o.y + o.height / 2);
  await page.mouse.down();
  await page.mouse.move(o.x + 100 + 28, o.y + o.height / 2, { steps: 4 });
  await page.mouse.move(o.x + 100 + 56, o.y + o.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('#ins-start')).toHaveValue('15');
});
