import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { addObjectAt, disableFileSystemAccess, previewPixel, seekRuler } from './helpers';

const BLUE: [number, number, number] = [79, 140, 255];
const near = (a: number[], b: number[], tol = 24) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const fx = (x: number) => 0.5 + x / 1920;

test.beforeEach(async ({ page }) => {
  await disableFileSystemAccess(page);
  await page.goto('./');
  await addObjectAt(page, '図形を追加', 1, 10);
  await page.locator('#ins-start').fill('0');
});

test('式で位置を計算する', async ({ page }) => {
  await page.getByRole('button', { name: 'Xを式で計算する' }).click();
  const input = page.getByLabel('Xの式', { exact: true });
  await expect(input).toHaveValue('0');
  await input.fill('time * 600');
  // 1 秒目（30 フレーム目）では X = 600
  await seekRuler(page, 30 * 4 + 1);
  await expect(page.locator('.expression-field')).toContainText('= 600');
  await expect.poll(async () => near(await previewPixel(page, fx(600), 0.5), BLUE)).toBe(true);

  // 誤りがあれば知らせ、既定値（0）で表示する
  await input.fill('time *');
  await expect(page.locator('.expression-field .error-text')).toBeVisible();
  await expect.poll(async () => near(await previewPixel(page, 0.5, 0.5), BLUE)).toBe(true);

  // 式をやめると数値に戻る
  await input.fill('123');
  await page.getByRole('button', { name: 'Xの式をやめる' }).click();
  await expect(page.getByLabel('X', { exact: true })).toHaveValue('123');
});

test('自作のシェーダーを使い、開いたファイルのシェーダーは確認してから実行する', async ({
  page,
}) => {
  await seekRuler(page, 41);
  await page.getByLabel('エフェクトを追加').selectOption({ label: 'シェーダー（自作）' });
  const code = page.getByLabel('コード（GLSL）');
  await code.fill('vec4 effect(vec2 uv) { vec4 c = src(uv); return vec4(c.a, 0.0, 0.0, c.a); }');
  await expect.poll(async () => near(await previewPixel(page, 0.5, 0.5), [255, 0, 0])).toBe(true);

  // コンパイルできなければ誤りを表示し、元の画像のまま
  await code.fill('vec4 effect(vec2 uv) { return oops; }');
  await expect(page.locator('.shader-status.error-text')).toContainText('oops');
  await expect.poll(async () => near(await previewPixel(page, 0.5, 0.5), BLUE)).toBe(true);
  await code.fill('vec4 effect(vec2 uv) { vec4 c = src(uv); return vec4(c.a, 0.0, 0.0, c.a); }');

  // 保存して開き直すと、実行してよいか確認する
  page.once('dialog', (d) => d.accept('shader'));
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const data = await readFile(await (await download).path());
  // 保存直後なので、新規作成の確認は出ない
  await page.getByRole('button', { name: '新規' }).click();
  await page.getByRole('button', { name: '作成' }).click();

  page.once('dialog', (d) => {
    expect(d.message()).toContain('シェーダー');
    void d.dismiss();
  });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '開く' }).click();
  await (
    await chooser
  ).setFiles({ name: 'shader.vedproj', mimeType: 'application/json', buffer: data });
  await page.locator('.tl-object').first().click();
  await seekRuler(page, 41);
  await expect.poll(async () => near(await previewPixel(page, 0.5, 0.5), BLUE)).toBe(true);
  await page.getByRole('button', { name: '実行を許可する' }).click();
  await expect.poll(async () => near(await previewPixel(page, 0.5, 0.5), [255, 0, 0])).toBe(true);
});
