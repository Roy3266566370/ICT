import { expect, test } from '@playwright/test';

test('canvas palette keeps the split calculus groups and the 408 group selectable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/canvas');

  await page.locator('summary', { hasText: '添加对象' }).click();
  const palette = page.locator('section[aria-label="积木库"]');
  await expect(palette).toBeVisible();

  await palette.getByRole('button', { name: '高数', exact: true }).click();
  await expect(palette.getByRole('button', { name: '函数源', exact: true })).toBeVisible();
  await expect(palette.getByRole('button', { name: '二元函数源', exact: true })).toBeVisible();
  await expect(palette.getByRole('button', { name: '梯度等高线', exact: true })).toBeVisible();
  expect(await palette.locator('button[aria-label]').count()).toBeGreaterThanOrEqual(15);

  await palette.getByRole('button', { name: '408', exact: true }).click();
  await expect(palette.getByRole('button', { name: 'Cache 组相联', exact: true })).toBeVisible();
  expect(await palette.locator('button[aria-label]').count()).toBeGreaterThanOrEqual(13);

  expect(errors).toEqual([]);
});