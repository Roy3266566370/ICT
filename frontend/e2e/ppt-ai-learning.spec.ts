import { expect, test } from '@playwright/test';

const materialId = process.env.E2E_MATERIAL_ID;
const pageNo = process.env.E2E_LEARNING_PAGE || '6';

test.describe('原页学习入口', () => {
  test.skip(!materialId, '需要 E2E_MATERIAL_ID（已准备学习内容的材料）');

  test('本页学习 → 讲解 → 提问 → 草案执行 → 保存探索', async ({ page, context }) => {
    const cookie = process.env.E2E_SESSION_COOKIE;
    if (cookie) await context.addCookies([{ name: 'xiangsheng_session', value: cookie, url: process.env.E2E_BASE_URL || 'http://localhost:5173' }]);
    else await context.request.post('/api/v1/sessions');
    await page.goto(`/materials/${materialId}/work?page=${pageNo}`);
    const entry = page.getByRole('button', { name: '本页学习' });
    await expect(entry).toBeVisible();
    await entry.click();
    const panel = page.getByLabel('本页学习');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('讲懂这里')).toBeVisible();

    await panel.getByRole('button', { name: '开始讲解' }).click();
    await expect(panel.getByText('讲解')).toBeVisible({ timeout: 30_000 });

    await panel.getByRole('button', { name: '问一个问题' }).click();
    await panel.getByRole('textbox', { name: '你的问题' }).fill('已知 Av=(7,5)，求输入向量 v。');
    await panel.getByRole('button', { name: '提问', exact: true }).click();
    await expect(panel.getByRole('heading', { name: '执行前请核对条件' })).toBeVisible({ timeout: 30_000 });
    await panel.getByRole('button', { name: '确认并求解' }).click();
    await expect(panel.getByText('求解答案')).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText('v1 = 3，v2 = 1')).toBeVisible();

    await panel.getByRole('button', { name: '动手试试' }).click();
    await panel.getByRole('button', { name: '保存这次探索' }).click();
    await expect(panel.getByText('已保存为个人探索；课件基准不变。')).toBeVisible({ timeout: 30_000 });

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.getByRole('button', { name: '本页学习' })).toBeVisible();
  });

  test('手机宽度无整体横向溢出，面板可关闭并回到入口', async ({ page, context }) => {
    const cookie = process.env.E2E_SESSION_COOKIE;
    if (cookie) await context.addCookies([{ name: 'xiangsheng_session', value: cookie, url: process.env.E2E_BASE_URL || 'http://localhost:5173' }]);
    else await context.request.post('/api/v1/sessions');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/materials/${materialId}/work?page=${pageNo}`);
    await page.getByRole('button', { name: '本页学习' }).click();
    const panel = page.getByLabel('本页学习');
    await expect(panel).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await panel.getByRole('button', { name: '关闭本页学习' }).click();
    await expect(panel).toBeHidden();
  });
});
