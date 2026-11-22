import { test, expect, type Page } from '@playwright/test';
import { CALCULUS_TEMPLATES, CALCULUS_TOPICS } from '../src/canvas/calculusTemplates';
import type { CanvasDoc } from '../src/canvas/types';

const WIDE = { width: 1440, height: 900 };
const inspector = (page: Page) => page.getByRole('complementary', { name: '结果与参数' });

test.beforeEach(async ({ page }) => {
  const works = new Map<string, { document: CanvasDoc; revision: number }>();
  await page.setViewportSize(WIDE);
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.slice('/api/v1/'.length);
    const method = route.request().method();
    const reply = (data: unknown) => route.fulfill({ json: { data } });
    if (path.startsWith('sessions')) return reply({ session_id: 'calculus-e2e', csrf_token: 'calculus-csrf' });
    if (path === 'works' && method === 'GET') return reply({ works: [] });
    if (path === 'work-shares') return reply({ items: [] });
    if (path === 'works' && method === 'POST') {
      const { document } = route.request().postDataJSON() as { document: CanvasDoc };
      const work_id = `calculus-work-${works.size + 1}`;
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

async function openCalculusTemplate(page: Page, kind: string): Promise<void> {
  const template = CALCULUS_TEMPLATES.find((item) => item.kind === kind);
  expect(template, `缺少高数模板 ${kind}`).toBeTruthy();
  await page.goto(`/workshop?subject=calculus&q=${encodeURIComponent(template!.name)}`);
  const card = page.locator('[class*="tplCard"]').filter({ has: page.getByText(template!.name, { exact: true }) }).first();
  await card.click();
  await expect(page).toHaveURL(/\/canvas\?work=/);
  await expect(page.locator('[data-calculus-module]').first()).toBeVisible();
}

async function selectCalculusStage(page: Page, stageId: string): Promise<void> {
  await page.locator(`[data-calculus-module="${stageId}"]`).getByRole('button', { name: /^拖动/ }).press('Enter');
  await expect(inspector(page).locator(`[data-calculus-stage="${stageId}"]`)).toBeVisible();
}

test('calculus catalog renders four topics and fourteen pipeline cards', async ({ page }) => {
  await page.goto('/workshop?subject=calculus');
  await expect(page.getByRole('button', { name: /^高等数学/ })).toHaveAttribute('aria-pressed', 'true');
  expect(CALCULUS_TOPICS).toHaveLength(4);
  expect(CALCULUS_TEMPLATES).toHaveLength(14);
  await expect(page.locator('[class*="tplCard"]')).toHaveCount(14);
  for (const topic of CALCULUS_TOPICS) {
    const expected = CALCULUS_TEMPLATES.filter((template) => template.topic === topic.id);
    const group = page.getByLabel(topic.name, { exact: true });
    await expect(group.getByRole('heading', { name: topic.name, exact: true })).toBeVisible();
    await expect(group.getByText(`${expected.length} 个实验`, { exact: true })).toBeVisible();
    await expect(group.locator('[class*="tplCard"]')).toHaveCount(expected.length);
    for (const template of expected) await expect(group.getByText(template.name, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('已预设仪器面板 · 可嵌入活页', { exact: true })).toHaveCount(14);
});

test('all fourteen calculus pipelines load wired cards and a working inspector', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const template of CALCULUS_TEMPLATES) {
    await openCalculusTemplate(page, template.kind);
    expect(await page.locator('[data-calculus-module]').count()).toBeGreaterThanOrEqual(4);
    await expect.poll(() => page.locator('[data-wire]').count()).toBeGreaterThanOrEqual(3);
    await page.locator('[data-calculus-module]').first().getByRole('button', { name: /^拖动/ }).press('Enter');
    await expect(inspector(page).locator('[data-science-subject="calculus"]')).toBeVisible();
    await expect(inspector(page).locator('svg').first()).toBeVisible();
    await expect(inspector(page).locator('[data-timeline="1"]')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('mean-value pipeline reports the analytic tangent point and parallel slope', async ({ page }) => {
  await openCalculusTemplate(page, 'mean-value');
  await selectCalculusStage(page, 'tangent-search');
  await expect(inspector(page).getByText('切点数量', { exact: true }).locator('..')).toContainText('1');
  await expect(inspector(page).getByText('当前 ξ', { exact: true }).locator('..')).toContainText('0.5');
  await expect(inspector(page).locator('dt').filter({ hasText: "f′(ξ)" }).locator('..')).toContainText('1');
  await expect(inspector(page).getByText('斜率误差', { exact: true }).locator('..')).toContainText('0');
});

test('SVD rank control and shared timeline reach a zero-error rank-two reconstruction', async ({ page }) => {
  await openCalculusTemplate(page, 'svd-steps');
  await selectCalculusStage(page, 'matrix');
  await inspector(page).locator('select').selectOption('2');
  await selectCalculusStage(page, 'low-rank');
  const next = inspector(page).getByRole('button', { name: '下一步', exact: true });
  await next.click();
  await next.click();
  await expect(inspector(page).locator('[data-timeline="1"]')).toContainText('3/3');
  await expect(inspector(page).getByText('低秩误差', { exact: true }).locator('..')).toContainText('0');
});

test('double-green radius really changes the polar integral instead of only the drawing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openCalculusTemplate(page, 'double-green');
  await selectCalculusStage(page, 'polar');
  const next = inspector(page).getByRole('button', { name: '下一步', exact: true });
  for (let index = 1; index < 12; index += 1) await next.click();
  await expect(inspector(page).locator('[data-timeline="1"]')).toContainText('12/12');
  const integral = inspector(page).getByText('累计积分', { exact: true }).locator('..').locator('dd');
  const before = Number.parseFloat((await integral.textContent()) ?? '0');
  expect(before).toBeGreaterThan(25);

  await selectCalculusStage(page, 'region');
  await inspector(page).getByLabel('外半径 R', { exact: true }).fill('1');
  await selectCalculusStage(page, 'polar');
  await expect.poll(async () => Number.parseFloat((await integral.textContent()) ?? '0')).toBeLessThan(before / 4);
  const after = Number.parseFloat((await integral.textContent()) ?? '0');
  expect(after).toBeGreaterThan(1.5);
  expect(after).toBeLessThan(1.7);
  expect(errors).toEqual([]);
});