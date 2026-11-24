import { expect, test } from '@playwright/test';

test('函数源左侧显示图像，右侧修改参数并用按钮编写函数', async ({ page }) => {
  await page.goto('/workshop');
  await page.getByRole('button', { name: /新建空白画布/ }).click();
  await page.getByRole('button', { name: /积木库/ }).click();
  await page.getByRole('searchbox', { name: '搜索积木' }).fill('函数源');
  await page.getByRole('button', { name: '函数源', exact: true }).click();
  await page.getByRole('button', { name: '关闭积木库' }).click();

  const card = page.locator('[data-node]');
  const graph = card.getByRole('img', { name: /f\(x\)/ });
  await expect(graph).toBeVisible({ timeout: 5_000 });
  await expect(card.locator('input, textarea')).toHaveCount(0);
  await graph.click();

  const inspector = page.getByRole('complementary').filter({ has: page.getByRole('button', { name: '关闭检查器' }) });
  const before = await graph.innerHTML();
  await inspector.getByRole('spinbutton', { name: '参数 c' }).fill('2');
  await expect.poll(() => graph.innerHTML()).not.toBe(before);
  await inspector.getByRole('button', { name: '绝对值', exact: true }).click();
  await expect(inspector.locator('annotation')).toContainText('\\left|');
  const absolutePath = await graph.locator('path').getAttribute('d');

  await inspector.getByRole('button', { name: '编辑函数' }).click();
  await inspector.getByRole('button', { name: '清空', exact: true }).click();
  await inspector.getByRole('button', { name: '字母 a', exact: true }).click();
  await inspector.getByRole('button', { name: '正弦', exact: true }).last().click();
  await inspector.getByRole('button', { name: '字母 x', exact: true }).click();
  await inspector.getByRole('button', { name: '应用函数', exact: true }).click();
  await expect(inspector.locator('annotation')).toContainText('\\sin');
  await expect(graph.locator('path')).not.toHaveAttribute('d', absolutePath!);
  await expect(inspector.getByRole('textbox', { name: '函数表达式', exact: true })).toHaveCount(0);
  await expect(card.getByRole('button', { name: '拖动 函数源' })).toBeVisible();
});
