import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

for (const entry of ['首页', '活页'] as const) {
  test(entry + '上传指定课件进入经典工作台', async ({ page }, info) => {
    test.setTimeout(360_000);
    const file = resolve(process.env.E2E_LEGACY_PPTX ?? resolve('..', '用空间视角理解矩阵运算.pptx'));
    test.skip(!existsSync(file), '需要本地验收课件，可设置 E2E_LEGACY_PPTX');
    await page.goto(entry === '首页' ? '/' : '/living');
    if (entry === '首页') await page.getByRole('button', { name: '上传文件', exact: true }).click();
    await page.locator('input[type=file]').setInputFiles(file);
    await expect(page).toHaveURL(/\/materials\/[^/]+\/work/, { timeout: 60_000 });
    await expect(page.getByRole('heading', { name: /用空间视角/, level: 1 })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole('link', { name: 'AI 交互 ↗' })).toBeVisible();
    await page.getByRole('link', { name: '编辑内容 / 交互' }).click();
    const editor = page.locator('[data-free-editor]');
    const ellipse = editor.getByRole('button', { name: '○ 椭圆', exact: true });
    await expect(ellipse).toBeEnabled({ timeout: 180_000 });
    await editor.locator('[data-node-type="text"][data-locked="false"]').first().dblclick();
    const input = editor.getByRole('textbox', { name: '画布文字编辑' });
    await input.fill('矩阵空间 · 编辑验收');
    await input.press('Tab');
    await ellipse.click();
    await expect(editor.locator('[data-node-type="shape"] [style*="border-radius: 50%"]').last()).toBeVisible();
    await editor.getByRole('tab', { name: /^交互/ }).click();
    await editor.getByRole('combobox', { name: '图形交互模板' }).selectOption('basis_change');
    await editor.getByRole('button', { name: '应用交互' }).click();
    await expect(editor.getByRole('tab', { name: '交互 ·已配置' })).toBeVisible();
    await editor.getByRole('button', { name: '保存并返回演示' }).click();
    await expect(page).toHaveURL(/\/work/, { timeout: 60_000 });
    await expect(page.getByText('矩阵空间 · 编辑验收', { exact: true }).and(page.locator('p:visible')).first()).toBeVisible({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByText('矩阵空间 · 编辑验收', { exact: true }).and(page.locator('p:visible')).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: /开始演示/ }).click();
    await expect(page.getByText('矩阵空间 · 编辑验收', { exact: true }).and(page.locator('p:visible')).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath('restored-deck.png') });
  });
}
