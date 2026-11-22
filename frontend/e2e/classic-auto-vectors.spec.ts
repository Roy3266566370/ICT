import { test, expect, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

async function dragArrowEnd(page: Page, arrow: Locator) {
  const handle = arrow.getByLabel('拖动终点');
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  const line = arrow.locator('[data-vector-stroke]');
  const before = await line.getAttribute('x2');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 - 15, { steps: 6 });
  await page.mouse.up();
  await expect(line).not.toHaveAttribute('x2', before!);
}

test('真实 PPTX 上传后原生和嵌图箭头直接可操作', async ({ page }, info) => {
  test.setTimeout(360_000);
  await page.goto('/living');
  await page.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('./fixtures/auto-vector-arrows.pptx', import.meta.url)));
  await expect(page).toHaveURL(/\/materials\/[^/]+\/work/);
  const slide = page.getByLabel('幻灯片第 1 页', { exact: true });
  const native = slide.locator('[data-vector-node]').first();
  await expect(native).toBeVisible({ timeout: 180_000 });
  await expect(native.locator('[data-vector-stroke]')).toHaveAttribute('x2', '430');
  await dragArrowEnd(page, native);
  await slide.getByLabel('线长', { exact: true }).fill('210');
  await slide.getByLabel('线条颜色').fill('#cc3300');
  await expect(native.locator('[data-vector-stroke]')).toHaveAttribute('stroke', '#cc3300');

  await page.keyboard.press('Tab');
  await page.getByRole('button', { name: /^第 2 页/ }).first().click();
  const second = page.getByLabel('幻灯片第 2 页', { exact: true });
  const detected = second.locator('[data-vector-node]').first();
  await expect(detected).toBeVisible();
  await dragArrowEnd(page, detected);
  await second.getByLabel('线条颜色').fill('#007744');
  await expect(detected.locator('[data-vector-stroke]')).toHaveAttribute('stroke', '#007744');
  await page.screenshot({ path: info.outputPath('recognized-arrows.png') });
  await page.getByRole('button', { name: '查看原图', exact: true }).click();
  await expect(detected).toBeHidden();
  await expect(second.getByRole('img', { name: '第 2 页原始 PPT' })).toBeVisible();
});
