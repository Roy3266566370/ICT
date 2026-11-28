import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

for (const [fixture, file] of [
  ['basis-alternate.png', fileURLToPath(new URL('./fixtures/basis-alternate.png', import.meta.url))],
  ['basis-compressed.jpg', fileURLToPath(new URL('./fixtures/basis-compressed.jpg', import.meta.url))],
  ['basis-generated.pdf', process.env.E2E_M3_PDF],
] as const) {
  test(`${fixture} 上传保留位图，支持手动添加箭头`, async ({ page }) => {
    test.skip(!file, '可通过 E2E_M3_PDF 指定含换基图的验收 PDF');
    await page.goto('/living');
    await page.locator('input[type=file][accept*=".pptx"]').setInputFiles(file!);
    await expect(page).toHaveURL(/\/materials\/[^/]+\/work/, { timeout: 60_000 });
    const slide = page.getByLabel('幻灯片第 1 页', { exact: true });
    await expect(slide.locator('[data-vector-node]')).toHaveCount(0);
    await page.getByRole('button', { name: '编辑课件' }).click();
    const editor = page.locator('[data-free-editor]');
    const canvas = editor.getByLabel('可编辑画布第 1 页');
    const picture = canvas.locator('[data-node-type="image"]');
    await expect(picture).toBeVisible();
    await picture.click();
    await expect(editor.getByRole('button', { name: '矢量化此图', exact: true })).toHaveCount(0);
    await expect(canvas.locator('[data-vector-node]')).toHaveCount(0);
    await editor.getByRole('button', { name: '＋ 箭头', exact: true }).click();
    await expect(canvas.locator('[data-vector-node]')).toHaveCount(1);
    await editor.getByRole('button', { name: '撤销编辑' }).click();
    await expect(canvas.locator('[data-vector-node]')).toHaveCount(0);
  });
}
