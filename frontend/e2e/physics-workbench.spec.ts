import { test, expect, type Page } from '@playwright/test';
import { PHYSICS_TEMPLATES, PHYSICS_TOPICS } from '../src/canvas/physicsTemplates';
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
    if (path.startsWith('sessions')) return reply({ session_id: 'physics-e2e', csrf_token: 'physics-csrf' });
    if (path === 'works' && method === 'GET') return reply({ works: [] });
    if (path === 'work-shares') return reply({ items: [] });
    if (path === 'works' && method === 'POST') {
      const { document } = route.request().postDataJSON() as { document: CanvasDoc };
      const work_id = `physics-work-${works.size + 1}`;
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

async function openPhysicsTemplate(page: Page, kind: string): Promise<void> {
  const template = PHYSICS_TEMPLATES.find((item) => item.kind === kind);
  expect(template, `缺少物理模板 ${kind}`).toBeTruthy();
  await page.goto(`/workshop?subject=mechanics&q=${encodeURIComponent(template!.name)}`);
  const card = page.locator('button').filter({ has: page.getByText(template!.name, { exact: true }) }).first();
  await card.click();
  await expect(page).toHaveURL(/\/canvas\?work=/);
  await expect(page.locator('[data-physics-module]').first()).toBeVisible();
}

async function selectPhysicsStage(page: Page, stageId: string): Promise<void> {
  await page.locator(`[data-physics-module="${stageId}"]`).getByRole('button', { name: /^拖动/ }).press('Enter');
  await expect(inspector(page).locator(`[data-physics-stage="${stageId}"]`)).toBeVisible();
}

test('physics catalog lists four topics and all twelve pipeline cards', async ({ page }) => {
  await page.goto('/workshop?subject=mechanics');
  await expect(page.getByRole('button', { name: /^大学物理 · \d+$/ })).toHaveAttribute('aria-pressed', 'true');
  expect(PHYSICS_TOPICS).toHaveLength(4);
  expect(PHYSICS_TEMPLATES).toHaveLength(12);
  await expect(page.locator('[class*="tplCard"]')).toHaveCount(12);
  for (const topic of PHYSICS_TOPICS) {
    const expected = PHYSICS_TEMPLATES.filter((template) => template.topic === topic.id);
    const section = page.getByLabel(topic.name, { exact: true });
    await expect(section.getByRole('heading', { name: topic.name, exact: true })).toBeVisible();
    await expect(section.getByText(`${expected.length} 个实验`, { exact: true })).toBeVisible();
    await expect(section.locator('[class*="tplCard"]')).toHaveCount(expected.length);
    for (const template of expected) {
      await expect(section.getByText(template.name, { exact: true })).toBeVisible();
      await expect(section.getByText(template.desc, { exact: true })).toBeVisible();
    }
  }
  await expect(page.getByText('已预设仪器面板 · 可嵌入活页', { exact: true })).toHaveCount(12);
});

test('all twelve physics pipelines load wired cards and a working inspector', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const template of PHYSICS_TEMPLATES) {
    await openPhysicsTemplate(page, template.kind);
    expect(await page.locator('[data-physics-module]').count()).toBeGreaterThanOrEqual(4);
    await expect.poll(() => page.locator('[data-wire]').count()).toBeGreaterThanOrEqual(3);
    await page.locator('[data-physics-module]').first().getByRole('button', { name: /^拖动/ }).press('Enter');
    await expect(inspector(page).locator('[data-science-subject="physics"]')).toBeVisible();
    await expect(inspector(page).locator('svg').first()).toBeVisible();
    await expect(inspector(page).locator('[data-timeline="1"]')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('projectile preset propagates through both branches and updates the comparison', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openPhysicsTemplate(page, 'projectile-drag');
  await selectPhysicsStage(page, 'source');
  await inspector(page).getByRole('button', { name: '无阻力对照', exact: true }).click();
  await selectPhysicsStage(page, 'compare');
  await expect(inspector(page).getByText('射程缩减', { exact: true }).locator('..')).toContainText('0.0%');

  await selectPhysicsStage(page, 'source');
  await inspector(page).getByLabel('线性阻力系数 k (N·s/m)', { exact: true }).fill('0.8');
  await expect.poll(() => page.locator('[data-408-flow] animateMotion').count()).toBeGreaterThan(0);
  await selectPhysicsStage(page, 'compare');
  await expect(inspector(page).getByText('射程缩减', { exact: true }).locator('..')).not.toContainText('0.0%');
  await expect(inspector(page).getByText('阻力机械能损耗', { exact: true }).locator('..')).not.toContainText('0.00 J');
  expect(errors).toEqual([]);
});