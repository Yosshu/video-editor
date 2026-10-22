import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { disableFileSystemAccess } from './helpers';

const AUDIO = 'tests/fixtures/tone-1khz.wav';

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
});

/** 書き出した WAV の、0.2〜0.8 秒の左チャンネルの実効値 */
async function exportWavRms(page: Page): Promise<number> {
  await page.getByRole('button', { name: '書き出し', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '音声のみ（WAV）' }).click();
  const data = await readFile(await (await download).path());
  await page.locator('.dialog-footer').getByRole('button', { name: '閉じる' }).click();
  const samples = new Int16Array(data.buffer, data.byteOffset + 44, (data.length - 44) / 2);
  let sum = 0;
  let n = 0;
  for (let i = Math.round(0.2 * 48000); i < Math.round(0.8 * 48000); i++) {
    const v = samples[i * 2] / 32768;
    sum += v * v;
    n++;
  }
  return Math.sqrt(sum / n);
}

test('音声エフェクトをかけると書き出した音に反映される', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '追加…' }).click();
  await (await chooser).setFiles(AUDIO);
  await page.locator('.asset-item').first().dblclick();
  await expect(page.locator('.tl-object')).toHaveCount(1);
  await expect(page.getByTestId('level-meter')).toBeVisible();

  // 0.5 の振幅のサイン波 → 実効値は約 0.354
  expect(await exportWavRms(page)).toBeCloseTo(0.354, 1);

  // 音声オブジェクトには音声エフェクトだけが選べる
  await page.locator('.tl-object').first().click();
  const add = page.getByLabel('エフェクトを追加');
  await expect(add.locator('option', { hasText: 'イコライザー' })).toHaveCount(1);
  await expect(add.locator('option', { hasText: 'ぼかし' })).toHaveCount(0);
  await add.selectOption({ label: 'イコライザー' });
  await expect(page.locator('.effect-card')).toHaveCount(1);

  // 1kHz を -24dB にすると、ほとんど聞こえなくなる
  await page.getByLabel('中音', { exact: true }).fill('-24');
  const rms = await exportWavRms(page);
  expect(rms).toBeLessThan(0.05);
  expect(rms).toBeGreaterThan(0.005);

  // エフェクトを無効にすると元に戻る
  await page.getByLabel('イコライザーを有効にする').uncheck();
  expect(await exportWavRms(page)).toBeCloseTo(0.354, 1);
});
