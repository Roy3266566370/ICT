import { expect, test } from '@playwright/test';

test('公式卡可用按钮输入分数，检查器和卡片共享排版结果', async ({ page }) => {
  await page.goto('/workshop');
  await page.getByRole('button', { name: /新建空白画布/ }).click();
  await page.getByRole('button', { name: /积木库/ }).click();
  await page.getByRole('searchbox', { name: '搜索积木' }).fill('公式卡');
  await page.getByRole('button', { name: '公式卡', exact: true }).click();

  const card = page.locator('[data-node]');
  await card.getByRole('button', { name: '检查模块' }).click();
  const inspector = page.getByRole('complementary').filter({ has: page.getByRole('button', { name: '关闭检查器' }) });
  await inspector.getByRole('button', { name: '编辑公式' }).click({ timeout: 5_000 });
  await inspector.getByRole('button', { name: '分数', exact: true }).click();
  await inspector.getByRole('button', { name: '完成公式', exact: true }).click();
  await expect(inspector.getByRole('alert')).toBeVisible();
  await inspector.getByRole('button', { name: '数字 1', exact: true }).click();
  await inspector.getByRole('button', { name: '下一个位置', exact: true }).click();
  await inspector.getByRole('button', { name: '数字 2', exact: true }).click();
  await inspector.getByRole('button', { name: '完成公式', exact: true }).click();

  const rendered = card.locator('.katex');
  await expect(rendered).toBeVisible();
  await expect(rendered.locator('mfrac > mn')).toHaveText(['1', '2']);
  await expect(inspector.locator('.katex mfrac > mn')).toHaveText(['1', '2']);
  await expect(card.getByRole('button', { name: '拖动 公式卡' })).toBeVisible();
  await expect(card.locator('textarea')).toHaveCount(0);

  await inspector.getByRole('button', { name: '编辑公式' }).click();
  await inspector.getByRole('button', { name: '更多符号' }).click();
  await expect.poll(() => page.evaluate(() => window.mathVirtualKeyboard.visible)).toBe(true);
  await inspector.getByRole('button', { name: '清空', exact: true }).click();
  await inspector.getByRole('button', { name: '取消', exact: true }).click();
  await expect(rendered.locator('mfrac > mn')).toHaveText(['1', '2']);
  await expect.poll(() => page.evaluate(() => window.mathVirtualKeyboard.visible)).toBe(false);

  const [saved] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/v1/works') && response.request().method() === 'POST'),
    page.getByRole('button', { name: '保存到工坊' }).click(),
  ]);
  expect(saved.ok()).toBe(true);
  const { data: { work_id: workId } } = await saved.json();
  await page.goto(`/canvas?work=${encodeURIComponent(workId)}`);
  await expect(rendered.locator('mfrac > mn')).toHaveText(['1', '2']);
});
