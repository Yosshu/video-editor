import { expect, test } from '@playwright/test';

test('マニフェストがあり、一度開けばオフラインでも起動できる', async ({ page, context }) => {
  await page.goto('./');
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBe('./manifest.webmanifest');
  const manifest = await (await page.request.get('manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.file_handlers[0].accept['application/x-vedpack']).toEqual(['.vedpack']);
  expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);

  // Service Worker が準備できるまで待ち、制御下に入るよう読み込み直す
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: '書き出し', exact: true })).toBeVisible();
  await expect(page.getByTestId('timeline-tracks')).toBeVisible();
  await context.setOffline(false);
});
