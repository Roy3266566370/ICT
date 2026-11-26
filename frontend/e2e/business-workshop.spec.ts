import { test, expect, type Page } from '@playwright/test';
import type { CanvasDoc } from '../src/canvas/types';
import { BUSINESS_TEMPLATES, BUSINESS_TOPICS, VISIBLE_BUSINESS_TEMPLATES } from '../src/canvas/businessTemplates';

const WIDE = { width: 1440, height: 900 };
const LEGACY_TEMPLATES = BUSINESS_TEMPLATES.filter((template) => template.legacy);

test.beforeEach(async ({ page }) => {
  const works = new Map<string, { document: CanvasDoc; revision: number }>();
  await page.setViewportSize(WIDE);
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.slice('/api/v1/'.length);
    const method = route.request().method();
    const reply = (data: unknown) => route.fulfill({ json: { data } });
    if (path.startsWith('sessions')) return reply({ session_id: 'biz-e2e', csrf_token: 'biz-csrf' });
    if (path === 'works' && method === 'GET') return reply({ works: [] });
    if (path === 'work-shares') return reply({ items: [] });
    if (path === 'works' && method === 'POST') {
      const { document } = route.request().postDataJSON() as { document: CanvasDoc };
      const work_id = `biz-work-${works.size + 1}`;
      const record = { document, revision: 1 };
      works.set(work_id, record);
      return reply({ work_id, ...record });
    }
    const [collection, id] = path.split('/');
    if (collection === 'works' && id) {
      const work = works.get(id);
      if (!work) return route.fulfill({ status: 404 });
      if (method === 'PATCH') {
        const { document, expected_revision } = route.request().postDataJSON() as { document: CanvasDoc; expected_revision: number };
        if (work.revision !== expected_revision) return route.fulfill({ status: 409 });
        work.document = document;
        work.revision += 1;
      }
      return reply({ work_id: id, ...work });
    }
    return route.fulfill({ status: 404, json: {} });
  });
});

async function openPanorama(page: Page, kind: string): Promise<void> {
  const template = VISIBLE_BUSINESS_TEMPLATES.find((item) => item.kind === kind);
  expect(template, `缺少办公沙盘 ${kind}`).toBeTruthy();
  await page.goto('/workshop?subject=business&q=' + encodeURIComponent(template!.name));
  await page.locator('button').filter({ has: page.getByText(template!.name, { exact: true }) }).click();
  await expect(page).toHaveURL(/\/canvas\?work=/);
  await expect(page.locator('[class*="aiCardShell"]').first()).toBeVisible();
}

async function openLegacy(page: Page, kind: string): Promise<void> {
  const template = LEGACY_TEMPLATES.find((item) => item.kind === kind);
  expect(template, `缺少旧办公模板 ${kind}`).toBeTruthy();
  await page.goto('/canvas?template=' + encodeURIComponent(kind));
  await expect(page.locator('[data-instrument-stage]')).toBeVisible();
}

test('办公决策目录列出四个专题与八个全景沙盘', async ({ page }) => {
  await page.goto('/workshop?subject=business');
  expect(BUSINESS_TOPICS).toHaveLength(4);
  expect(VISIBLE_BUSINESS_TEMPLATES).toHaveLength(8);
  expect(LEGACY_TEMPLATES).toHaveLength(4);
  await expect(page.locator('[class*="tplCard"]')).toHaveCount(8);
  for (const topic of BUSINESS_TOPICS) {
    const expected = VISIBLE_BUSINESS_TEMPLATES.filter((template) => template.topic === topic.id);
    const section = page.getByLabel(topic.name, { exact: true });
    await expect(section.getByRole('heading', { name: topic.name, exact: true })).toBeVisible();
    await expect(section.getByText(expected.length + ' 个实验', { exact: true })).toBeVisible();
    for (const template of expected) {
      await expect(section.getByText(template.name, { exact: true })).toBeVisible();
    }
  }
});

test('八个全景沙盘打开后规则块连线渲染且无页面错误', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const template of VISIBLE_BUSINESS_TEMPLATES) {
    await openPanorama(page, template.kind);
    expect(await page.locator('[class*="aiCardShell"]').count()).toBeGreaterThanOrEqual(1);
    await expect.poll(() => page.locator('[data-wire]').count()).toBeGreaterThanOrEqual(2);
  }
  expect(errors).toEqual([]);
});

test('旧四个流水线模板仍可通过模板 URL 打开并播放', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const template of LEGACY_TEMPLATES) {
    await openLegacy(page, template.kind);
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
    page.getByRole('button', { name: '保存到定象坊' }).click(),
  ]);
  expect(saved.ok()).toBe(true);
  const { data: { work_id: workId } } = await saved.json();
  await page.goto(`/canvas?work=${encodeURIComponent(workId)}`);
  await expect(stage.getByRole('spinbutton', { name: '客单价（美元）数值' })).toHaveValue('12.75');
  await expect(stage.locator('[data-stage-chart]')).toContainText('销量（件）');
});
