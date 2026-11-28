import { expect, test } from '@playwright/test';

test('画布工具坞支持直接从键盘输入公式', async ({ page }) => {
  await page.goto('/canvas');
  const dock = page.getByRole('toolbar', { name: '画布工具坞' });
  const open = dock.getByRole('button', { name: '输入公式' });
  const dialog = page.getByRole('dialog', { name: '输入公式' });
  const input = dialog.getByRole('textbox', { name: '数学公式' });

  await open.click();
  await expect(input).toBeFocused();
  await input.fill('\\frac{1');
  await input.press('Enter');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await input.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-node-type="latexNote"]')).toHaveCount(0);

  await open.click();
  await input.fill('\\frac{1}{x}');
  await expect(dialog.getByRole('math', { name: '公式预览' })).toBeVisible();
  await input.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-node-type="latexNote"] annotation')).toHaveText('\\frac{1}{x}');
});
