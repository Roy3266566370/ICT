import { test, expect, type Page } from '@playwright/test';
import type { CanvasDoc } from '../src/canvas/types';
import { LAB408_TOPICS, LAB408_TEMPLATES, VISIBLE_LAB408_TEMPLATES } from '../src/canvas/lab408Templates';

const WIDE = { width: 1440, height: 900 };
const LEGACY_TEMPLATES = LAB408_TEMPLATES.filter((template) => template.legacy);
const inspector = (page: Page) => page.getByRole('complementary', { name: '结果与参数' });

test.beforeEach(async ({ page }) => {
  const works = new Map<string, { document: CanvasDoc; revision: number }>();
  const snapshots = new Map<string, { share_id: string; title: string; document: CanvasDoc }>();
  await page.setViewportSize(WIDE);
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.slice('/api/v1/'.length);
    const method = route.request().method();
    const reply = (data: unknown) => route.fulfill({ json: { data } });
    if (path.startsWith('sessions')) return reply({ session_id: 'test-408', csrf_token: 'test-408-csrf' });
    if (path === 'works' && method === 'GET') return reply({ works: [] });
    if (path === 'work-shares') return reply({ items: [] });
    if (path === 'works' && method === 'POST') {
      const { document } = route.request().postDataJSON() as { document: CanvasDoc };
      const work_id = 'work-' + (works.size + 1);
      const record = { document, revision: 1 };
      works.set(work_id, record);
      return reply({ work_id, ...record });
    }
    const [collection, id, action] = path.split('/');
    if (collection === 'works' && id) {
      const work = works.get(id);
      if (!work) return route.fulfill({ status: 404 });
      if (method === 'PATCH') {
        const { document, expected_revision } = route.request().postDataJSON();
        if (work.revision !== expected_revision) return route.fulfill({ status: 409 });
        work.document = document;
        work.revision += 1;
      }
      if (action === 'publish') {
        const share_id = 'share-' + id;
        snapshots.set(share_id, { share_id, title: work.document.title, document: structuredClone(work.document) });
        return reply({ share_id, share_url: '/work-shares/' + share_id });
      }
      return reply({ work_id: id, ...work });
    }
    if (collection === 'work-shares' && id && snapshots.has(id)) return reply(snapshots.get(id));
    return route.fulfill({ status: 404, json: {} });
  });
});

async function openPanorama(page: Page, kind: string): Promise<void> {
  const template = VISIBLE_LAB408_TEMPLATES.find((item) => item.kind === kind);
  expect(template, `缺少 408 沙盘 ${kind}`).toBeTruthy();
  await page.goto('/workshop?subject=lab408&q=' + encodeURIComponent(template!.name));
  await page.locator('button').filter({ has: page.getByText(template!.name, { exact: true }) }).click();
  await expect(page).toHaveURL(/\/canvas\?work=/);
  await expect(page.locator('[class*="aiCardShell"]').first()).toBeVisible();
}

async function openLegacy(page: Page, kind: string): Promise<void> {
  const template = LEGACY_TEMPLATES.find((item) => item.kind === kind);
  expect(template, `缺少旧 408 模板 ${kind}`).toBeTruthy();
  await page.goto('/canvas?template=' + encodeURIComponent(kind));
  await expect(page.locator('[data-408-module]').first()).toBeVisible();
}

async function selectModule(page: Page, id: string, title: string): Promise<void> {
  await page.locator('[data-408-module="' + id + '"]').getByText(title, { exact: true }).click();
  await expect(inspector(page).getByRole('heading', { name: title, exact: true })).toBeVisible();
}

test('408 catalog lists four topics and the sixteen panorama sandboxes', async ({ page }) => {
  await page.goto('/workshop?subject=lab408');
  expect(LAB408_TOPICS).toHaveLength(4);
  expect(VISIBLE_LAB408_TEMPLATES).toHaveLength(16);
  expect(LEGACY_TEMPLATES).toHaveLength(21);
  await expect(page.locator('[class*="tplCard"]')).toHaveCount(16);
  for (const topic of LAB408_TOPICS) {
    const expected = VISIBLE_LAB408_TEMPLATES.filter((template) => template.topic === topic.id);
    const section = page.getByLabel(topic.name, { exact: true });
    await expect(section.getByRole('heading', { name: topic.name, exact: true })).toBeVisible();
    await expect(section.getByText(expected.length + ' 个实验', { exact: true })).toBeVisible();
    for (const template of expected) {
      await expect(section.getByText(template.name, { exact: true })).toBeVisible();
    }
  }
});

test('all sixteen panoramas open with wired rule blocks and no page errors', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const template of VISIBLE_LAB408_TEMPLATES) {
    await openPanorama(page, template.kind);
    expect(await page.locator('[class*="aiCardShell"]').count()).toBeGreaterThanOrEqual(2);
    await expect.poll(() => page.locator('[data-wire]').count()).toBeGreaterThanOrEqual(2);
  }
  expect(errors).toEqual([]);
});

test('all 21 legacy pipelines still open via template URL', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const template of LEGACY_TEMPLATES) {
    await openLegacy(page, template.kind);
    expect(await page.locator('[data-408-module]').count()).toBeGreaterThanOrEqual(4);
    await expect.poll(() => page.locator('[data-wire]').count()).toBeGreaterThanOrEqual(3);
    await page.locator('[data-408-module]').first().getByRole('button', { name: /^拖动/ }).press('Enter');
    await expect(inspector(page).locator('[data-408-stage]')).toHaveCount(1);
    await expect(inspector(page).locator('[data-timeline="1"]')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('legacy cache pipeline propagates input, saves and publishes a share', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openLegacy(page, 'cacheSimLab');
  await selectModule(page, 'source', 'CPU 访存流');
  const input = inspector(page).getByRole('textbox', { name: /32 位虚拟地址序列/ });
  await input.fill('0x1000 0x1000 0x1000 0x2000');
  await expect(page.locator('[data-408-flow] animateMotion').first()).toBeVisible();

  await selectModule(page, 'cache', 'Cache 组相联表');
  await page.screenshot({ path: testInfo.outputPath('408-cache-pipeline.png') });

  await selectModule(page, 'source', 'CPU 访存流');
  await page.getByRole('button', { name: '发布画布', exact: true }).click();
  const share = page.getByRole('link', { name: /work-shares/ });
  await expect(share).toBeVisible();
  await page.goto((await share.getAttribute('href'))!);
  await selectModule(page, 'source', 'CPU 访存流');
  await expect(inspector(page).getByRole('textbox', { name: /32 位虚拟地址序列/ })).toHaveValue('0x1000 0x1000 0x1000 0x2000');
  await expect(inspector(page).getByRole('textbox', { name: /32 位虚拟地址序列/ })).toHaveAttribute('readonly', '');
  expect(errors).toEqual([]);
});

test('tapping a module opens its inspector on a narrow screen and returns to the diagram', async ({ page }) => {
  await openLegacy(page, 'cpuScheduleLab');
  await page.setViewportSize({ width: 390, height: 844 });
  await selectModule(page, 'processes', '进程表');
  await expect(inspector(page).getByRole('textbox', { name: /进程 到达时间 服务时间/ })).toBeVisible();
  await page.getByRole('button', { name: '查看画布', exact: true }).click();
  await expect(inspector(page)).toBeHidden();
  await expect(page.locator('[data-408-module="processes"]')).toBeVisible();
});

test('TCP shortcut appends an RTT and the state-machine inspector follows the new event', async ({ page }) => {
  await openLegacy(page, 'tcpCongestionLab');
  await selectModule(page, 'source', 'TCP RTT 事件源');
  await page.getByRole('button', { name: '追加正常 ACK' }).click();
  await expect(inspector(page).getByText('共 8 个事件', { exact: false })).toBeVisible();
  await selectModule(page, 'machine', 'TCP Reno 状态机');
  await expect(inspector(page).locator('[data-timeline="1"]')).toContainText('9/9');
  await inspector(page).getByRole('button', { name: '重置' }).click();
  await expect(inspector(page).locator('[data-timeline="1"]')).toContainText('1/9');
});
