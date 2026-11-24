import { expect, test } from '@playwright/test';

test('办公决策目录可搜索并打开四个可播放的沙盘', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const templates = [
    ['盈亏', '经营盈亏平衡与定价沙盘'],
    ['漏斗', '增长漏斗与留存复利推演'],
    ['甘特图', '项目排期与关键路径风险模拟器'],
    ['AB实验', 'A/B 实验样本量与统计显著性计算器'],
  ];
  await page.goto('/workshop');
  await expect(page.getByRole('button', { name: '办公决策 · 4' })).toBeVisible({ timeout: 5_000 });
  for (const [query, title] of templates) {
    await page.getByRole('button', { name: '办公决策 · 4' }).click();
    await page.getByRole('searchbox').fill(query!);
    await page.getByRole('button', { name: new RegExp(title!) }).click();
    const stage = page.locator('[data-instrument-stage]');
    const chart = stage.locator('[data-stage-chart]');
    await expect(chart.getByRole('img')).toBeVisible();
    await expect(stage.locator('[data-process-minis]').getByRole('img')).toHaveCount(2);
    const input = stage.getByLabel('精密控制舱').getByRole('slider').first();
    const before = await input.inputValue();
    const beforeChart = await chart.innerHTML();
    await input.press('End');
    await expect(input).not.toHaveValue(before);
    await expect.poll(() => chart.innerHTML()).not.toBe(beforeChart);
    const timeline = stage.getByRole('slider', { name: '时间轴位置' });
    await stage.getByRole('button', { name: '播放', exact: true }).click();
    await expect.poll(async () => Number(await timeline.inputValue())).toBeGreaterThan(0);
    await timeline.press('End');
    await expect(timeline).toHaveValue((await timeline.getAttribute('max'))!);
    await page.goto('/workshop?subject=business');
  }
  expect(errors).toEqual([]);
});

test('办公沙盘可以输入精确值并自定义对应单位', async ({ page }) => {
  await page.goto('/canvas?template=biz-breakeven');
  const stage = page.locator('[data-instrument-stage]');
  const price = stage.getByRole('spinbutton', { name: '客单价（元）数值' });
  await price.fill('12.75');
  await price.press('Enter');
  await expect(price).toHaveValue('12.75');
  await expect(stage.getByRole('slider', { name: '客单价（元）' })).toHaveValue('12.75');
  await price.fill('-5');
  await price.press('Enter');
  await expect(price).toHaveAttribute('aria-invalid', 'true');
  await expect(stage.getByRole('slider', { name: '客单价（元）' })).toHaveValue('12.75');
  await price.press('Escape');

  await stage.getByText('自定义单位', { exact: true }).click();
  await stage.getByRole('textbox', { name: '金额单位' }).fill('美元');
  await stage.getByRole('textbox', { name: '金额单位' }).press('Enter');
  await stage.getByRole('textbox', { name: '销量单位' }).fill('件');
  await stage.getByRole('textbox', { name: '销量单位' }).press('Enter');
  await expect(stage.getByRole('spinbutton', { name: '客单价（美元）数值' })).toHaveValue('12.75');
  await expect(stage.locator('[data-stage-chart]')).toContainText('金额（美元）');
  await expect(stage.locator('[data-stage-chart]')).toContainText('销量（件）');

  const [saved] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/v1/works') && response.request().method() === 'POST'),
    page.getByRole('button', { name: '保存到工坊' }).click(),
  ]);
  expect(saved.ok()).toBe(true);
  const { data: { work_id: workId } } = await saved.json();
  await page.goto(`/canvas?work=${encodeURIComponent(workId)}`);
  await expect(stage.getByRole('spinbutton', { name: '客单价（美元）数值' })).toHaveValue('12.75');
  await expect(stage.locator('[data-stage-chart]')).toContainText('销量（件）');
});
