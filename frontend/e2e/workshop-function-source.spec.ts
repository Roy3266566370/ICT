import { expect, test } from '@playwright/test';

test('从积木库连续添加积木会留出前一张卡片的标题', async ({ page }) => {
  await page.goto('/canvas');
  await page.getByRole('button', { name: /积木库/ }).click();
  await page.getByRole('searchbox', { name: '搜索积木' }).fill('滑杆源');
  const add = page.getByRole('button', { name: '滑杆源', exact: true });
  for (let i = 0; i < 6; i++) await add.click();
  const cards = page.locator('[data-node-type="slider"]');
  await expect(cards).toHaveCount(6);
  const positions = await cards.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).offsetTop));
  for (let i = 1; i < positions.length; i++) {
    expect(positions[i]! - positions[i - 1]!).toBeGreaterThanOrEqual(40);
  }
});

test('函数源左侧显示图像，右侧修改参数并用键盘输入函数', async ({ page }) => {
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
  const input = inspector.getByRole('textbox', { name: '函数表达式', exact: true });
  await expect(input).toBeFocused();
  await input.fill('sin(');
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await input.fill('a*sin(x)');
  await input.press('Enter');
  await expect(inspector.locator('annotation')).toContainText('\\sin');
  await expect(graph.locator('path')).not.toHaveAttribute('d', absolutePath!);
  await expect(inspector.getByRole('textbox', { name: '函数表达式', exact: true })).toHaveCount(0);
  await expect(card.getByRole('button', { name: '拖动 函数源' })).toBeVisible();
});
