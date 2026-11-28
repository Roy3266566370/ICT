import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test('真实 PPTX 保留原生矢量与嵌入图片', async ({ page }) => {
  test.setTimeout(360_000);
  await page.goto('/living');
  await page.locator('input[type=file][accept*=".pptx"]').setInputFiles(fileURLToPath(new URL('./fixtures/auto-vector-arrows.pptx', import.meta.url)));
  await expect(page).toHaveURL(/\/materials\/[^/]+\/work/);
  const slide = page.getByLabel('幻灯片第 1 页', { exact: true });
  const native = slide.locator('[data-vector-node]').first();
  await expect(native).toBeVisible({ timeout: 180_000 });
  await expect(native.locator('[data-vector-stroke]')).toHaveAttribute('x2', '430');

  await page.getByRole('button', { name: /^第 2 页/ }).first().click();
  const second = page.getByLabel('幻灯片第 2 页', { exact: true });
  await expect(second.locator('[data-vector-node]')).toHaveCount(0);
  await page.getByRole('button', { name: '编辑课件' }).click();
  const editor = page.locator('[data-free-editor]');
  const canvas = editor.getByLabel('可编辑画布第 2 页');
  const picture = canvas.locator('[data-node-type="image"]').first();
  await expect(picture).toBeVisible({ timeout: 180_000 });
  await picture.click();
  const originalSource = await picture.locator('img').getAttribute('src');
  await expect(editor.getByRole('button', { name: '矢量化此图', exact: true })).toHaveCount(0);
  await expect(editor.getByRole('button', { name: '图示校对', exact: true })).toHaveCount(0);
  await expect(canvas.locator('[data-vector-node]')).toHaveCount(0);
  await expect(picture.locator('img')).toHaveAttribute('src', originalSource!);

});
