import { expect, test } from '@playwright/test';

const materialId = process.env.E2E_GENERATED_VIEW_MATERIAL_ID;

test.describe('专用视图隔离沙箱', () => {
  test.skip(!materialId, '需要 E2E_GENERATED_VIEW_MATERIAL_ID 且后端 PPT_AI_GENERATED_VIEWS_ENABLED=true');

  test('iframe 只授予 allow-scripts，沙箱内不发起外部请求', async ({ page, context }) => {
    const cookie = process.env.E2E_GENERATED_VIEW_COOKIE || process.env.E2E_SESSION_COOKIE;
    if (cookie) await context.addCookies([{ name: 'xiangsheng_session', value: cookie, url: 'http://127.0.0.1:5173' }]);
    else await context.request.post('/api/v1/sessions');
    const external: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost') && !url.startsWith('data:') && !url.startsWith('blob:')) {
        external.push(url);
      }
    });
    await page.goto(`/materials/${materialId}/ai`);
    await page.getByRole('button', { name: '验收与视图' }).click();
    const generate = page.getByRole('button', { name: /生成专用视图/ });
    if (await generate.isVisible()) {
      await generate.click();
      const iframe = page.locator('iframe[title="专用视图隔离沙箱"]').first();
      await expect(iframe).toBeVisible({ timeout: 45_000 });
      const sandbox = await iframe.getAttribute('sandbox');
      expect(sandbox).toBe('allow-scripts');
      await expect(page.getByText(/已通过隔离验收|待隔离验收/)).toBeVisible({ timeout: 20_000 });
    }
    expect(external).toEqual([]);
  });
});
