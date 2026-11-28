import { expect, test } from '@playwright/test';

test('发布快照可以整理重叠积木，刷新后仍显示原布局', async ({ page }) => {
  await page.route('**/api/v1/work-shares/layout-test', route => route.fulfill({
    json: { data: {
      share_id: 'layout-test', title: '重叠测试',
      document: {
        version: 1, title: '重叠测试', zoom: 1, wires: [], strokes: [],
        nodes: [
          { id: 'first', type: 'slider', x: 60, y: 60, params: { v: 2 } },
          { id: 'second', type: 'slider', x: 60, y: 60, params: { v: 5 } },
        ],
      },
    }, request_id: 'layout-test' },
  }));
  await page.goto('/work-shares/layout-test');
  const first = page.locator('[data-node="first"]');
  const second = page.locator('[data-node="second"]');
  await expect(first).toHaveCSS('top', '60px');
  await expect(second).toHaveCSS('top', '60px');
  await page.getByRole('button', { name: '自动整理排版' }).click();
  await expect.poll(async () => {
    const a = await first.boundingBox();
    const b = await second.boundingBox();
    return Boolean(a && b && (a.x + a.width <= b.x || b.x + b.width <= a.x ||
      a.y + a.height <= b.y || b.y + b.height <= a.y));
  }).toBe(true);
  await page.reload();
  await expect(first).toHaveCSS('top', '60px');
  await expect(second).toHaveCSS('top', '60px');
});
