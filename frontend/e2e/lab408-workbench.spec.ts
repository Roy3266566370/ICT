import { test, expect, type Page } from '@playwright/test';
import type { CanvasDoc } from '../src/canvas/types';
import { LAB408_TOPICS, LAB408_TEMPLATES, LAB408_WORKBENCH_TEMPLATES } from '../src/canvas/lab408Templates';

const WIDE = { width: 1440, height: 900 };

test.beforeEach(async ({ page }) => {
  const works = new Map<string, { document: CanvasDoc; revision: number }>();
  const snapshots = new Map<string, { share_id: string; title: string; document: CanvasDoc }>();
  await page.setViewportSize(WIDE);
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.slice('/api/v1/'.length);
    const method = route.request().method();
    const reply = (data: unknown) => route.fulfill({ json: { data } });
    if (path.startsWith('sessions')) return reply({ session_id: 'test-408', csrf_token: 'test-408-csrf' });
    if (path === 'labs/408/evaluate' && method === 'POST') {
      const { subject, text } = route.request().postDataJSON();
      if (subject === 'computer_organization' && text === '给定 32 位地址，求 Cache 地址位段。') {
        return reply({ status: 'ready', answer: '已收到组成原理题干' });
      }
    }
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

async function open408(page: Page, kind: string): Promise<void> {
  const template = LAB408_TEMPLATES.find((item) => item.kind === kind);
  expect(template).toBeTruthy();
  const name = template!.name;
  await page.goto('/workshop?subject=lab408&q=' + encodeURIComponent(name));
  await page.locator('button').filter({ has: page.getByText(name, { exact: true }) }).click();
  await expect(page).toHaveURL(/\/canvas\?work=/);
  await expect(page.locator('[data-408-module]').first()).toBeVisible();
}

const inspector = (page: Page) => page.getByRole('complementary', { name: '结果与参数' });

async function selectModule(page: Page, id: string, title: string): Promise<void> {
  await page.locator('[data-408-module="' + id + '"]').getByText(title, { exact: true }).click();
  await expect(inspector(page).getByRole('heading', { name: title, exact: true })).toBeVisible();
}

test('408 catalog lists 13 pipelines and four original-question workbenches', async ({ page }) => {
  await page.goto('/workshop?subject=lab408');
  const templates = [...LAB408_TEMPLATES, ...LAB408_WORKBENCH_TEMPLATES];
  expect(LAB408_TEMPLATES).toHaveLength(13);
  expect(LAB408_WORKBENCH_TEMPLATES).toHaveLength(4);
  for (const topic of LAB408_TOPICS) {
    const section = page.getByLabel(topic.name, { exact: true });
    const expected = templates.filter((template) => template.topic === topic.id);
    await expect(section.getByRole('heading', { name: topic.name, exact: true })).toBeVisible();
    await expect(section.getByText(expected.length + ' 个实验', { exact: true })).toBeVisible();
    for (const template of expected) {
      await expect(section.getByText(template.name, { exact: true })).toBeVisible();
    }
  }
  await expect(page.getByText('模块流水线 · 可编辑输入', { exact: true })).toHaveCount(13);
});

test('all 13 workbenches load wired diagram cards and inspect a result', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const template of LAB408_TEMPLATES) {
    await open408(page, template.kind);
    expect(await page.locator('[data-408-module]').count()).toBeGreaterThanOrEqual(4);
    await expect.poll(() => page.locator('[data-wire]').count()).toBeGreaterThanOrEqual(3);
    await page.locator('[data-408-module]').first().getByRole('button', { name: /^拖动/ }).press('Enter');
    await expect(inspector(page).locator('[data-408-stage]')).toHaveCount(1);
    await expect(inspector(page).locator('[data-timeline="1"]')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('Cache input propagates to the detail panel, timeline, save and share', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open408(page, 'cacheSimLab');
  await selectModule(page, 'source', 'CPU 访存流');
  const input = inspector(page).getByRole('textbox', { name: /32 位虚拟地址序列/ });
  await inspector(page).getByLabel('导入纯文本数据（TXT / CSV）').setInputFiles({
    name: 'addresses.txt', mimeType: 'text/plain', buffer: Buffer.from('0x1000 0x1000 0x1000'),
  });
  await expect(input).toHaveValue('0x1000 0x1000 0x1000');
  await expect(page.locator('[data-408-flow] animateMotion')).toHaveCount(4);
  await expect(inspector(page).getByRole('region', { name: /CPU 发出访存请求/ })).toContainText('0x00001000');
  await inspector(page).getByText('核对题目原文', { exact: true }).click();
  await inspector(page).getByLabel('粘贴完整题干').fill('给定 32 位地址，求 Cache 地址位段。');
  await inspector(page).getByRole('button', { name: '按此参数核对原题' }).click();
  await expect(inspector(page).getByText('已收到组成原理题干')).toBeVisible();

  await selectModule(page, 'split', '地址切分');
  const block = inspector(page).getByLabel('块大小 B');
  await block.selectOption('64');
  await expect(inspector(page).getByText('Offset · 6 位', { exact: true })).toBeVisible();

  await selectModule(page, 'cache', 'Cache 组相联表');
  await expect(inspector(page).getByText('Miss · 缺失', { exact: true })).toBeVisible();
  await inspector(page).getByRole('button', { name: '下一步' }).click();
  await expect(inspector(page).getByText('Hit · 命中', { exact: true })).toBeVisible();
  await selectModule(page, 'amat', '命中率与 AMAT');
  await expect(inspector(page).getByText('50.00%', { exact: true })).toBeVisible();
  await inspector(page).getByRole('button', { name: '下一步' }).click();
  await expect(inspector(page).getByText('66.67%', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('408-cache-pipeline.png') });

  await selectModule(page, 'source', 'CPU 访存流');
  await input.fill('0x1000 0x1000 0x1000 0x2000');
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
  await open408(page, 'cpuScheduleLab');
  await page.setViewportSize({ width: 390, height: 844 });
  await selectModule(page, 'processes', '进程表');
  await expect(inspector(page).getByRole('textbox', { name: /进程 到达时间 服务时间/ })).toBeVisible();
  await page.getByRole('button', { name: '查看画布', exact: true }).click();
  await expect(inspector(page)).toBeHidden();
  await expect(page.locator('[data-408-module="processes"]')).toBeVisible();
});

test('TCP shortcut appends an RTT and the state-machine inspector follows the new event', async ({ page }) => {
  await open408(page, 'tcpCongestionLab');
  await selectModule(page, 'source', 'TCP RTT 事件源');
  await page.getByRole('button', { name: '追加正常 ACK' }).click();
  await expect(inspector(page).getByText('共 8 个事件', { exact: false })).toBeVisible();
  await selectModule(page, 'machine', 'TCP Reno 状态机');
  await expect(inspector(page).locator('[data-timeline="1"]')).toContainText('9/9');
  await inspector(page).getByRole('button', { name: '重置' }).click();
  await expect(inspector(page).locator('[data-timeline="1"]')).toContainText('1/9');
});
