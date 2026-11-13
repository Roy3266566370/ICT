import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';

const offlineHtml = process.env.E2E_OFFLINE_HTML;
const pageNo = process.env.E2E_LEARNING_PAGE || '6';

test.describe('离线学习快照', () => {
  test.skip(!offlineHtml, '需要 E2E_OFFLINE_HTML（本轮导出的单文件 HTML）');

  test('断网打开后可翻页、打开学习面板并读取已打包讲解', async ({ page, context }) => {
    await context.setOffline(true);
    const external: string[] = [];
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) external.push(request.url());
    });
    await page.goto(pathToFileURL(offlineHtml!).href);
    await page.waitForSelector('button');
    await page.locator(`button[aria-label^="第 ${pageNo} 页"]`).first().evaluate((element) => element.click());
    await page.getByRole('button', { name: '本页学习' }).click();
    const panel = page.locator('aside[aria-label="本页学习"]');
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/已分享\/离线内容/)).toBeVisible();
    await expect(panel.getByRole('button', { name: '问一个问题' })).toBeDisabled();
    await panel.getByRole('button', { name: '动手试试' }).click();
    await expect(panel.getByRole('button', { name: '保存这次探索' })).toHaveCount(0);
    await panel.getByRole('button', { name: '讲懂这里' }).click();
    await expect(panel.getByText(/矩阵可逆|det\\(A\\)/).first()).toBeVisible();
    expect(external).toEqual([]);
  });
});
