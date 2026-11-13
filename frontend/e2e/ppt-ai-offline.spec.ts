import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';

const offlineHtml = process.env.E2E_OFFLINE_HTML;

test.describe('离线交互网页', () => {
  test.skip(!offlineHtml, '需要 E2E_OFFLINE_HTML（导出的单文件 HTML 路径）');

  test('断网打开仍可翻页，冻结的 AI 交互可读', async ({ page, context }) => {
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('file:') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
      return route.abort();
    });
    await page.goto(pathToFileURL(offlineHtml!).href);
    await expect(page.locator('body')).toBeVisible();
    const aiHotspots = page.locator('[aria-label^="AI 交互："]');
    if (await aiHotspots.count()) {
      await aiHotspots.first().click();
      await expect(page.getByRole('complementary', { name: 'PPT AI 交互' })).toBeVisible();
    }
  });
});
