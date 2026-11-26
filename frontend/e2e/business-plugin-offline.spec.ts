import { expect, test, type Locator, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { stat } from 'node:fs/promises';

const templates = [
  { name: '经营盈亏、定价与敏感性热图', slider: /客单价/, value: '180' },
  { name: 'CPM 关键路径与人力负载', slider: /延期/, value: '4' },
] as const;

function instrument(slide: Locator): Locator {
  return slide.locator('[data-scene-workshop-plugin] [data-instrument-stage]');
}

function previewSlide(page: Page, pageNumber: number): Locator {
  return page.getByLabel(`幻灯片第 ${pageNumber} 页`, { exact: true });
}

async function setSlider(stage: Locator, name: RegExp, value: string): Promise<void> {
  const slider = stage.getByRole('slider', { name });
  if (await slider.isHidden()) {
    const drawer = stage.getByRole('button', { name: /调参/ });
    if (await drawer.isVisible().catch(() => false)) await drawer.click();
  }
  await expect(slider).toBeVisible();
  await slider.fill(value);
  await expect(slider).toHaveValue(value);
}

test('办公决策全景插件可在真实课件中保存、放映、断网播放及从 HTML 导回', async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/living');
  const blankPng = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 540;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await page.locator('input[type=file][accept*=".pptx"]').setInputFiles({
    name: '办公全景插件验收.png', mimeType: 'image/png', buffer: Buffer.from(blankPng, 'base64'),
  });
  await expect(page).toHaveURL(/\/materials\/[^/]+\/work/);
  const deckPath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: '编辑课件', exact: true }).click();

  const editor = page.locator('[data-free-editor]');
  const picker = page.getByRole('dialog', { name: '插入定象坊交互插件' });
  for (const [index, { name, slider, value }] of templates.entries()) {
    if (index) {
      await editor.getByRole('button', { name: '新建空白页', exact: true }).click();
    }
    await editor.getByRole('button', { name: '插入定象坊插件' }).first().click();
    await picker.getByRole('tab', { name: '办公决策', exact: true }).click();
    await expect(picker.getByRole('button').filter({ hasText: '原生离线' })).toHaveCount(8);
    if (index === 0) {
      await picker.getByRole('searchbox').fill('敏感性热图');
      await expect(picker.getByRole('button').filter({ hasText: '原生离线' })).toHaveCount(1);
    }
    await picker.getByText(name, { exact: true }).click();
    await expect(picker).toBeHidden();
    const slide = editor.getByLabel(`可编辑画布第 ${index + 1} 页`, { exact: true });
    const stage = instrument(slide);
    await expect(stage).toBeVisible();
    await expect(stage.getByRole('tablist', { name: '观察视角' }).getByRole('tab')).toHaveCount(index === 0 ? 3 : 3);
    await setSlider(stage, slider, value);
  }
  await expect(editor.getByText('已保存到服务端', { exact: true })).toBeVisible();
  await page.goto(`${deckPath}?page=1`);
  for (const [index, { slider, value }] of templates.entries()) {
    const stage = instrument(previewSlide(page, index + 1));
    await expect(stage.getByRole('slider', { name: slider })).toHaveValue(value);
    await expect(stage.locator('[data-stage-chart] svg, [data-stage-chart] canvas, [data-stage-chart] table').first()).toBeVisible();
    if (index < templates.length - 1) await page.getByRole('button', { name: '下一页', exact: true }).click();
  }

  await page.locator('summary[aria-label="导出与分享"]').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '下载离线交互网页' }).click(),
  ]);
  const htmlPath = testInfo.outputPath('business-panorama-deck.html');
  await download.saveAs(htmlPath);
  expect((await stat(htmlPath)).size).toBeLessThan(4 * 1024 * 1024);

  const offline = await browser.newContext({ offline: true, viewport: { width: 1600, height: 1000 } });
  const networkRequests: string[] = [];
  offline.on('request', (request) => {
    if (/^https?:\/\//.test(request.url())) networkRequests.push(request.url());
  });
  try {
    const offlinePage = await offline.newPage();
    offlinePage.on('pageerror', (error) => errors.push(error.message));
    await offlinePage.goto(pathToFileURL(htmlPath).href);
    await expect(offlinePage.locator('script[data-offline-runtime="lite"]')).toHaveCount(1);
    for (const [index, { slider, value }] of templates.entries()) {
      const stage = instrument(previewSlide(offlinePage, index + 1));
      await expect(stage.getByRole('slider', { name: slider })).toHaveValue(value);
      await expect(stage.locator('[data-stage-chart] svg, [data-stage-chart] canvas, [data-stage-chart] table').first()).toBeVisible();
      if (index < templates.length - 1) await offlinePage.getByRole('button', { name: '下一页', exact: true }).click();
    }
  } finally {
    await offline.close();
  }
  expect(networkRequests).toEqual([]);

  await page.goto('/living');
  await page.locator('input[type=file][accept*=".xsproj"]').setInputFiles(htmlPath);
  await expect(page).toHaveURL(/\/materials\/[^/]+\/work/);
  for (const [index, { slider, value }] of templates.entries()) {
    const stage = instrument(previewSlide(page, index + 1));
    await expect(stage).toBeVisible();
    await expect(stage.getByRole('slider', { name: slider })).toHaveValue(value);
    if (index < templates.length - 1) await page.getByRole('button', { name: '下一页', exact: true }).click();
  }
  expect(errors).toEqual([]);
});
