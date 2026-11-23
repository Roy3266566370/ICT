import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

for (const [fixture, file] of [
  ['basis-alternate.png', fileURLToPath(new URL('./fixtures/basis-alternate.png', import.meta.url))],
  ['basis-compressed.jpg', fileURLToPath(new URL('./fixtures/basis-compressed.jpg', import.meta.url))],
  ['basis-generated.pdf', process.env.E2E_M3_PDF],
] as const) {
  test(`${fixture} 上传保留位图并按需生成图示预览`, async ({ page }, info) => {
    test.skip(!file, '可通过 E2E_M3_PDF 指定含换基图的验收 PDF');
    const screenshot = (name: string) => page.screenshot({ path: process.env.E2E_M3_CAPTURE_DIR ? join(process.env.E2E_M3_CAPTURE_DIR, name) : info.outputPath(name) });
    await page.goto('/living');
    const uploadStart = Date.now();
    await page.locator('input[type=file][accept*=".pptx"]').setInputFiles(file!);
    await expect(page).toHaveURL(/\/materials\/[^/]+\/work/, { timeout: 60_000 });
    const slide = page.getByLabel('幻灯片第 1 页', { exact: true });
    await expect(slide.locator('[data-vector-node]')).toHaveCount(0);
    await page.getByRole('link', { name: '编辑内容 / 交互' }).click();
    const editor = page.locator('[data-free-editor]');
    const canvas = editor.getByLabel('可编辑画布第 1 页');
    const picture = canvas.locator('[data-node-type="image"]');
    await expect(picture).toBeVisible();
    const uploadMs = Date.now() - uploadStart;
    await picture.click();
    const previewStart = Date.now();
    await editor.getByRole('button', { name: '矢量化此图', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '矢量化此图' });
    await expect(dialog.getByRole('status')).toContainText(fixture.endsWith('.pdf')?/识别 \d+ 个候选/:/识别 [1-9]\d* 个候选/);
    console.log(`M3 ${fixture} upload-to-editable=${uploadMs}ms click-to-preview=${Date.now() - previewStart}ms total=${Date.now() - uploadStart}ms`);
    if (!fixture.endsWith('.pdf')) await expect(dialog.locator('[data-vector-node], [data-figure-candidate]').first()).toBeVisible();
    await expect(canvas.locator('[data-vector-node]')).toHaveCount(0);
    await screenshot(`${fixture}-overlay.png`);
    await dialog.getByRole('button', { name: '手动添加箭头' }).click();
    await expect(dialog).toBeHidden();
    await expect(canvas.locator('[data-vector-node]')).toHaveCount(1);
    await expect(canvas.getByLabel('拖动终点')).toBeVisible();
    await editor.getByRole('button', { name: '撤销编辑' }).click();
    await expect(canvas.locator('[data-vector-node]')).toHaveCount(0);
  });
}
