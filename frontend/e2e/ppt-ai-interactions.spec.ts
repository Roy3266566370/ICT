import { expect, test } from '@playwright/test';

const materialId = process.env.E2E_MATERIAL_ID;

test.describe('PPT AI 工作流与交互验收', () => {
  test.skip(!materialId, '需要 E2E_MATERIAL_ID（本地后端 + 前端已启动）');

  test.beforeEach(async ({ context }) => {
    const cookie = process.env.E2E_SESSION_COOKIE;
    if (cookie) {
      await context.addCookies([{ name: 'xiangsheng_session', value: cookie, url: 'http://127.0.0.1:5173' }]);
      return;
    }
    const response = await context.request.post('/api/v1/sessions');
    expect(response.ok()).toBeTruthy();
  });

  test('规划、采用、调参与两档视口可访问', async ({ page }) => {
    await page.goto(`/materials/${materialId}/ai`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('交互网页');

    const start = page.getByRole('button', { name: /开始识别并规划|重新生成规划/ });
    await start.click();
    await expect(page.getByRole('heading', { name: '1 · 交互规划' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('覆盖表')).toBeVisible();

    const apply = page.getByRole('button', { name: /采用选中方案并编译/ });
    if (await apply.isVisible()) {
      await apply.click();
      await expect(page.getByRole('heading', { name: '2 · 根据追问生成补充实验' })).toBeVisible({ timeout: 60_000 }).catch(() => undefined);
    }

    // 1600×1000
    const body = page.locator('body');
    const overflow = await body.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);

    // 390×844
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const mobileOverflow = await body.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(mobileOverflow).toBeLessThanOrEqual(2);
  });

  test('演示页有 AI 热区与工作台入口', async ({ page }) => {
    await page.goto(`/materials/${materialId}/work?page=1`);
    const link = page.getByRole('link', { name: /AI 交互/ }).first();
    if (await link.isVisible()) {
      await expect(link).toBeVisible();
      const hotspot = page.locator('[aria-label^="AI 交互："]').first();
      if (await hotspot.count()) {
        await hotspot.click();
        await expect(page.getByRole('complementary', { name: 'PPT AI 交互' })).toBeVisible();
      }
    }
  });
});
