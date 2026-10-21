import type { Page } from '@playwright/test';

/** ファイル選択ダイアログを使わず、ダウンロード・input 要素の経路を使わせる */
export async function disableFileSystemAccess(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker;
    delete w.showOpenFilePicker;
  });
}

export async function addObjectAt(page: Page, label: string, x: number, y: number): Promise<void> {
  const box = (await page.getByTestId('timeline-tracks').boundingBox())!;
  await page.mouse.click(box.x + x, box.y + y, { button: 'right' });
  await page.getByRole('menuitem', { name: label }).click();
}

export async function seekRuler(page: Page, x: number): Promise<void> {
  const rb = (await page.getByTestId('timeline-ruler').boundingBox())!;
  await page.mouse.click(rb.x + x, rb.y + 10);
}

export function timelineObjects(page: Page) {
  return page.locator('.tl-object');
}

/** プレビューの指定位置（0〜1）の色を読む */
export async function previewPixel(
  page: Page,
  fx: number,
  fy: number,
): Promise<[number, number, number]> {
  return page.getByTestId('preview-canvas').evaluate(
    (canvas: HTMLCanvasElement, [x, y]) => {
      const c = document.createElement('canvas');
      c.width = canvas.width;
      c.height = canvas.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(canvas, 0, 0);
      const d = ctx.getImageData(
        Math.floor(x * canvas.width),
        Math.floor(y * canvas.height),
        1,
        1,
      ).data;
      return [d[0], d[1], d[2]] as [number, number, number];
    },
    [fx, fy] as [number, number],
  );
}
