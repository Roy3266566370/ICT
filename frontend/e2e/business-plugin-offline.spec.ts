import { expect, test, type Locator, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { stat } from 'node:fs/promises';

const templates = [
  { name: '经营盈亏平衡与定价沙盘', control: /客单价/ },
  { name: '增长漏斗与留存复利推演', control: /每周曝光/ },
  { name: '项目排期与关键路径风险模拟器（CPM / 甘特图）', control: /前端延期/ },
  { name: 'A/B 实验样本量与统计显著性计算器', control: /对照组转化率/ },
] as const;

function instrument(slide: Locator): Locator {
  return slide.locator('[data-scene-workshop-plugin] [data-instrument-stage]');
}

function parameter(stage: Locator, name: RegExp): Locator {
  return stage.getByRole('slider', { name });
}

async function expectCustomUnits(stage: Locator): Promise<void> {
  await expect(stage.locator('[data-stage-chart]')).toContainText('金额（美元）');
  await expect(stage.locator('[data-stage-chart]')).toContainText('销量（件）');
}

async function expectBusinessNames(stage: Locator, index: number): Promise<void> {
  if (index === 1) await expect(stage.locator('[data-stage-chart]')).toContainText('产品浏览');
  if (index === 2) {
    await expect(stage.locator('[data-stage-chart]')).toContainText('支付网关');
    await expect(stage.locator('[data-stage-chart]')).toContainText('仓储接口');
  }
}

async function changeParameter(slider: Locator): Promise<string> {
  const previous = await slider.inputValue();
  await slider.press('ArrowRight');
  await expect(slider).not.toHaveValue(previous);
  return slider.inputValue();
}

async function playTimeline(stage: Locator): Promise<void> {
  const timeline = stage.getByRole('group', { name: '连续时间轴' });
  const position = timeline.getByRole('slider', { name: '时间轴位置' });
  await expect(position).toHaveValue('0');
  await position.press('ArrowRight');
  await expect(position).toHaveValue('1');
  await timeline.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(async () => Number(await position.inputValue())).toBeGreaterThan(1);
  await timeline.getByRole('button', { name: '回到开头', exact: true }).click();
  await expect(position).toHaveValue('0');
}

async function showSubcharts(stage: Locator): Promise<void> {
  const selector = stage.getByRole('combobox', { name: '沙盘图表' });
  const chart = stage.locator('[data-stage-chart]').getByRole('img');
  const main = await chart.getAttribute('aria-label');
  await selector.selectOption('detail');
  await expect(chart).not.toHaveAttribute('aria-label', main!);
  const detail = await chart.getAttribute('aria-label');
  await selector.selectOption('history');
  await expect(chart).not.toHaveAttribute('aria-label', detail!);
  await selector.selectOption('main');
  await expect(chart).toHaveAttribute('aria-label', main!);
}

function previewSlide(page: Page, pageNumber: number): Locator {
  return page.getByLabel(`幻灯片第 ${pageNumber} 页`, { exact: true });
}

test('办公决策插件可在真实课件中保存、放映、断网播放及从 HTML 导回', async ({ page, browser }, testInfo) => {
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
    name: '办公决策插件验收.png', mimeType: 'image/png', buffer: Buffer.from(blankPng, 'base64'),
  });
  await expect(page).toHaveURL(/\/materials\/[^/]+\/work/);
  const deckPath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: '编辑课件', exact: true }).click();

  const editor = page.locator('[data-free-editor]');
  const properties = editor.getByLabel('对象属性');
  const picker = page.getByRole('dialog', { name: '插入万象工坊交互插件' });
  const savedValues: string[] = [];
  for (const [index, { name, control }] of templates.entries()) {
    if (index) {
      await editor.getByText('页面操作', { exact: true }).click();
      await editor.getByRole('button', { name: '新建空白页', exact: true }).click();
    }
    await editor.getByRole('button', { name: '插入工坊插件' }).click();
    await picker.getByRole('tab', { name: '办公决策', exact: true }).click();
    await expect(picker.getByRole('button').filter({ hasText: '原生离线' })).toHaveCount(4);
    if (index === 0) {
      await picker.getByRole('searchbox').fill('盈亏');
      await expect(picker.getByRole('button').filter({ hasText: '原生离线' })).toHaveCount(1);
    }
    await picker.getByText(name, { exact: true }).click();
    await expect(picker).toBeHidden();
    const slide = editor.getByLabel(`可编辑画布第 ${index + 1} 页`, { exact: true });
    const stage = instrument(slide);
    await expect(stage.locator('[data-stage-chart] svg')).toBeVisible();
    if (index === 0) {
      const price = stage.getByRole('spinbutton', { name: '客单价（元）数值' });
      await price.fill('12.75');
      await price.press('Enter');
      await stage.getByText('自定义单位', { exact: true }).click();
      const currency = stage.getByRole('textbox', { name: '金额单位' });
      const orders = stage.getByRole('textbox', { name: '销量单位' });
      await currency.fill('美元');
      await currency.press('Enter');
      await orders.fill('件');
      await orders.press('Enter');
      await expectCustomUnits(stage);
      const mode = properties.getByRole('combobox', { name: '展示模式' });
      await mode.selectOption('full');
      await expect(stage).toHaveAttribute('data-display-mode', 'full');
      await mode.selectOption('stage_only');
      await expect(stage).toHaveAttribute('data-display-mode', 'stage_only');
      const drawer = stage.getByRole('button', { name: /调参/ });
      await expect(parameter(stage, control)).toBeHidden();
      await drawer.click();
      await expect(parameter(stage, control)).toBeVisible();
      await mode.selectOption('compact');
      await properties.getByRole('checkbox', { name: '透明背景' }).check();
      await properties.getByRole('checkbox', { name: '隐藏边框' }).check();
      await properties.getByRole('combobox', { name: '配色主题' }).selectOption('dark');
      const costRate = stage.getByRole('spinbutton', { name: /变动成本率.*数值/ });
      await costRate.fill('42');
      await costRate.press('Enter');
      await properties.getByRole('checkbox', { name: /^公开 .*变动成本率/ }).uncheck();
      await properties.getByRole('textbox', { name: '预设名称' }).fill('实测定价');
      await properties.getByRole('button', { name: /将当前参数存为预设/ }).click();
      await properties.getByRole('button', { name: '预览 基准定价' }).click();
      await expect(parameter(stage, control)).toHaveValue('99');
      savedValues.push('12.75');
    } else if (index === 1 || index === 2) {
      await stage.getByText('自定义名称 / 粘贴 Excel 数据', { exact: true }).click();
      await stage.getByRole('textbox', { name: '两列 CSV 或 TSV' }).fill(index === 1
        ? 'impressions\t210000\n曝光\t产品浏览'
        : '支付网关,6\nT3,仓储接口\ndelayT2,1');
      await stage.getByRole('button', { name: '应用粘贴数据' }).click();
      await expectBusinessNames(stage, index);
      const value = index === 1 ? '210000' : '1';
      await expect(parameter(stage, control)).toHaveValue(value);
      savedValues.push(value);
    } else {
      savedValues.push(await changeParameter(parameter(stage, control)));
    }
  }
  await expect(editor.getByText('已保存到服务端', { exact: true })).toBeVisible();
  await page.goto(`${deckPath}?page=1`);
  for (const [index, { control }] of templates.entries()) {
    const stage = instrument(previewSlide(page, index + 1));
    const slider = parameter(stage, control);
    await expect(slider).toHaveValue(savedValues[index]!);
    await expectBusinessNames(stage, index);
    if (index === 0) {
      await expectCustomUnits(stage);
      await expect(stage).toHaveAttribute('data-display-mode', 'compact');
      await expect(stage).toHaveAttribute('data-transparent-bg', /^(|true)$/);
      await expect(stage).toHaveAttribute('data-hide-border', /^(|true)$/);
      await expect(stage).toHaveAttribute('data-instrument-theme', 'dark');
      await expect(parameter(stage, /变动成本率/)).toHaveCount(0);
      await stage.getByRole('group', { name: '情景预设' }).getByRole('button', { name: '基准定价' }).click();
      await expect(slider).toHaveValue('99');
      await expect(stage).toContainText('106,450');
      const position = stage.getByRole('slider', { name: '时间轴位置' });
      await position.press('ArrowRight');
      await previewSlide(page, 1).getByRole('button', { name: /全屏展开演示/ }).click();
      const expanded = page.getByRole('dialog', { name: '全屏工坊演示' });
      await expect(expanded).toBeVisible();
      await expect(expanded.getByRole('slider', { name: '时间轴位置' })).toHaveValue('1');
      await expanded.getByRole('group', { name: '情景预设' }).getByRole('button', { name: '实测定价' }).click();
      await expect(parameter(expanded, control)).toHaveValue('12.75');
      await page.keyboard.press('Escape');
      await expect(expanded).toBeHidden();
      await expect(slider).toHaveValue('12.75');
      await expect(position).toHaveValue('1');
      await stage.getByRole('button', { name: '回到开头', exact: true }).click();
    }
    await showSubcharts(stage);
    await changeParameter(slider);
    await playTimeline(stage);
    if (index < templates.length - 1) await page.getByRole('button', { name: '下一页', exact: true }).click();
  }

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '下载交互网页', exact: true }).click(),
  ]);
  const htmlPath = testInfo.outputPath('business-deck.html');
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
    for (const [index, { control }] of templates.entries()) {
      const stage = instrument(previewSlide(offlinePage, index + 1));
      const slider = parameter(stage, control);
      await expect(slider).toHaveValue(savedValues[index]!);
      await expectBusinessNames(stage, index);
      if (index === 0) {
        await expectCustomUnits(stage);
        await expect(stage).toHaveAttribute('data-display-mode', 'compact');
        await expect(parameter(stage, /变动成本率/)).toHaveCount(0);
        await stage.getByRole('group', { name: '情景预设' }).getByRole('button', { name: '基准定价' }).click();
        await expect(slider).toHaveValue('99');
        await expect(stage).toContainText('106,450');
        await stage.getByRole('group', { name: '情景预设' }).getByRole('button', { name: '实测定价' }).click();
        await expect(slider).toHaveValue('12.75');
      }
      await showSubcharts(stage);
      await changeParameter(slider);
      await playTimeline(stage);
      if (index < templates.length - 1) await offlinePage.getByRole('button', { name: '下一页', exact: true }).click();
    }
  } finally {
    await offline.close();
  }
  expect(networkRequests).toEqual([]);

  await page.goto('/living');
  await page.locator('input[type=file][accept*=".xsproj"]').setInputFiles(htmlPath);
  await expect(page).toHaveURL(/\/materials\/[^/]+\/work/);
  expect(new URL(page.url()).pathname).not.toBe(deckPath);
  for (const [index, { control }] of templates.entries()) {
    const slide = previewSlide(page, index + 1);
    await expect(slide.locator('[data-scene-workshop-plugin]')).toBeVisible();
    await expect(parameter(instrument(slide), control)).toHaveValue(savedValues[index]!);
    await expectBusinessNames(instrument(slide), index);
    if (index === 0) {
      await expectCustomUnits(instrument(slide));
      await expect(instrument(slide)).toHaveAttribute('data-display-mode', 'compact');
      await expect(parameter(instrument(slide), /变动成本率/)).toHaveCount(0);
      await expect(instrument(slide).getByRole('group', { name: '情景预设' })
        .getByRole('button', { name: '实测定价' })).toBeVisible();
    }
    if (index < templates.length - 1) await page.getByRole('button', { name: '下一页', exact: true }).click();
  }
  await page.getByRole('button', { name: '编辑课件', exact: true }).click();
  const restoredStage = instrument(editor.getByLabel('可编辑画布第 4 页', { exact: true }));
  await expect(parameter(restoredStage, templates[3].control)).toHaveValue(savedValues[3]!);
  expect(errors).toEqual([]);
});
