import { test, expect, type Page } from '@playwright/test';
import { PHYSICS_TEMPLATES } from '../src/canvas/physicsTemplates';
import { CALCULUS_TEMPLATES } from '../src/canvas/calculusTemplates';
import type { CanvasDoc } from '../src/canvas/types';

const inspector = (page: Page) => page.getByRole('complementary', { name: '结果与参数' });

test.beforeEach(async ({ page }) => {
  const works = new Map<string, { document: CanvasDoc; revision: number }>();
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.slice('/api/v1/'.length);
    const method = route.request().method();
    const reply = (data: unknown) => route.fulfill({ json: { data } });
    if (path.startsWith('sessions')) return reply({ session_id: 'science-e2e', csrf_token: 'science-csrf' });
    if (path === 'works' && method === 'GET') return reply({ works: [] });
    if (path === 'work-shares') return reply({ items: [] });
    if (path === 'works' && method === 'POST') {
      const { document } = route.request().postDataJSON() as { document: CanvasDoc };
      const work_id = `science-work-${works.size + 1}`;
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

async function openTemplate(page: Page, subject: 'physics' | 'calculus', kind: string): Promise<void> {
  const templates = subject === 'physics' ? PHYSICS_TEMPLATES : CALCULUS_TEMPLATES;
  const template = templates.find((item) => item.kind === kind);
  expect(template, `缺少 ${subject} 模板 ${kind}`).toBeTruthy();
  const querySubject = subject === 'physics' ? 'mechanics' : 'calculus';
  await page.goto(`/workshop?subject=${querySubject}&q=${encodeURIComponent(template!.name)}`);
  await page.locator('button').filter({ has: page.getByText(template!.name, { exact: true }) }).first().click();
  await expect(page).toHaveURL(/\/canvas\?work=/);
  await expect(page.locator(`[data-${subject}-module]`).first()).toBeVisible();
}

async function selectStage(page: Page, subject: 'physics' | 'calculus', stageId: string): Promise<void> {
  await page.locator(`[data-${subject}-module="${stageId}"]`).getByRole('button', { name: /^拖动/ }).press('Enter');
  await expect(inspector(page).locator(`[data-${subject}-stage="${stageId}"]`)).toBeVisible();
}

test('physics branches share one timeline cursor and reset together', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTemplate(page, 'physics', 'projectile-drag');
  await selectStage(page, 'physics', 'ideal');
  await inspector(page).getByRole('button', { name: '下一步', exact: true }).click();
  await expect(inspector(page).locator('[data-timeline="1"]')).toContainText('2/61');
  await selectStage(page, 'physics', 'drag');
  await expect(inspector(page).locator('[data-timeline="1"]')).toContainText('2/61');
  await inspector(page).getByRole('button', { name: '重置', exact: true }).click();
  await expect(inspector(page).locator('[data-timeline="1"]')).toContainText('1/61');
  await selectStage(page, 'physics', 'ideal');
  await expect(inspector(page).locator('[data-timeline="1"]')).toContainText('1/61');
});

test('calculus stages share the cursor and invalid source text blocks downstream honestly', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTemplate(page, 'calculus', 'mean-value');
  await selectStage(page, 'calculus', 'secant-line');
  await inspector(page).getByRole('button', { name: '下一步', exact: true }).click();
  await expect(inspector(page).locator('[data-timeline="1"]')).toContainText('2/61');
  await selectStage(page, 'calculus', 'tangent-search');
  await expect(inspector(page).locator('[data-timeline="1"]')).toContainText('2/61');

  await selectStage(page, 'calculus', 'function-source');
  await inspector(page).locator('textarea').fill('x+');
  await expect(inspector(page).getByRole('status')).toContainText('函数表达式无效');
  await selectStage(page, 'calculus', 'tangent-search');
  await expect(inspector(page).getByRole('status')).toContainText('等待有效输入');
  expect(errors).toEqual([]);
});

test('tapping a science module opens the narrow-screen inspector and returns to the canvas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTemplate(page, 'physics', 'charged-particle');
  await selectStage(page, 'physics', 'particle-selector');
  await expect(inspector(page).getByLabel('入射速度 v (m/s)', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看画布', exact: true }).click();
  await expect(inspector(page)).toBeHidden();
  await expect(page.locator('[data-physics-module="particle-selector"]')).toBeVisible();
});