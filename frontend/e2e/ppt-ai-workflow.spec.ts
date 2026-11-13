import { expect, test } from '@playwright/test';

const materialId = process.env.E2E_MATERIAL_ID;

test.describe('PPT AI 工作流回归', () => {
  test.skip(!materialId, '需要 E2E_MATERIAL_ID');
  test('区域重试与验收入口不破坏原页阅读', async ({ page, context }) => {
    const cookie = process.env.E2E_SESSION_COOKIE;
    if (cookie) await context.addCookies([{ name: 'xiangsheng_session', value: cookie, url: 'http://127.0.0.1:5173' }]);
    else await context.request.post('/api/v1/sessions');
    await page.goto(`/materials/${materialId}/work?page=1`);
    await expect(page.locator('body')).toBeVisible();
    await page.goto(`/materials/${materialId}/ai`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('交互网页');
    const retry = page.getByRole('button', { name: '重试' }).first();
    if (await retry.isVisible()) {
      await expect(retry).toBeEnabled();
    }
    await page.getByRole('button', { name: '验收与视图' }).click();
    await expect(page.getByRole('heading', { name: /自动验收与有限修复/ })).toBeVisible();
  });
});
