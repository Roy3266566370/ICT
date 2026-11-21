import { pathToFileURL } from 'node:url';
import { test, expect, type Page } from '@playwright/test';

/** P2 验收：图示热区 → 流程图画布（React Flow）→ 拖拽/单步/布局 → 插入正文 → 分享页只读演示。
 *  diagram 数据通过 PATCH 直接落库（确定性转译路径等价物），不消耗真实视觉预算；
 *  真实视觉连通性由后端 `verify` 脚本单独验证。 */
async function setupDiagramPage(page: Page) {
  const session = (await (await page.request.post('/api/v1/sessions')).json()).data;
  const headers = { 'X-CSRF-Token': session.csrf_token };

  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 400;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 640, 400);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
    ctx.strokeRect(40, 60, 160, 70);
    ctx.strokeRect(430, 60, 160, 70);
    ctx.beginPath(); ctx.moveTo(200, 95); ctx.lineTo(430, 95); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(430, 95); ctx.lineTo(415, 85); ctx.lineTo(415, 105); ctx.fill();
    ctx.fillStyle = '#222'; ctx.font = '22px sans-serif';
    ctx.fillText('输入', 90, 102); ctx.fillText('输出', 480, 102);
    return canvas.toDataURL('image/png');
  });
  const png = Buffer.from(dataUrl.split(',')[1]!, 'base64');
  const upload = await page.request.post('/api/v1/pages', {
    headers, multipart: { files: { name: 'flow.png', mimeType: 'image/png', buffer: png } },
    timeout: 60000,
  });
  expect(upload.status(), await upload.text()).toBe(201);
  const doc = (await upload.json()).data;
  const pageBlock = doc.blocks.find((b: { type: string }) => b.type === 'page');
  const assetId = pageBlock.data.regions?.[0]?.asset_id;
  expect(assetId).toBeTruthy();

  pageBlock.data.regions = [{
    id: 'r_flow', kind: 'diagram', bbox: [0.04, 0.08, 0.94, 0.9], asset_id: assetId,
    label: '推理流程', caption: '图1', text: '输入→处理→输出', source: 'e2e',
    confidence: 0.8,
    diagram: {
      version: 1,
      nodes: [
        { id: 'n1', label: '输入', x: 0.15, y: 0.3, shape: 'oval' },
        { id: 'n2', label: '编码器', x: 0.5, y: 0.3, shape: 'rect' },
        { id: 'n3', label: '输出', x: 0.85, y: 0.3, shape: 'oval' },
      ],
      edges: [
        { from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' },
      ],
      order: ['n1', 'n2', 'n3'], confidence: 0.9, warnings: [], cache_key: 'e2e',
    },
  }];
  const patched = await page.request.patch(`/api/v1/pages/${doc.page_id}`, {
    headers, data: { expected_revision: doc.revision, blocks: doc.blocks },
  });
  expect(patched.status(), await patched.text()).toBe(200);
  return { doc, headers };
}

test('图示热区 → 流程图画布 → 单步演示 → 插入正文 → 分享页只读', async ({ page, browser }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { doc, headers } = await setupDiagramPage(page);

  await page.goto(`/living/${doc.page_id}`);
  await page.getByRole('button', { name: /对照原页/ }).click();
  await page.getByRole('button', { name: '图示：推理流程' }).click();
  const panel = page.getByRole('region', { name: '图示：推理流程' });
  await expect(panel).toBeVisible();

  // 有 diagram → 面板默认落在交互图：React Flow 画布渲染 3 节点
  const canvas = panel.getByLabel('流程图画布');
  await expect(canvas).toBeVisible();
  await expect(panel.getByLabel('节点 输入')).toBeVisible();
  await expect(panel.getByLabel('节点 编码器')).toBeVisible();
  await expect(panel.getByLabel('节点 输出')).toBeVisible();

  // 单步演示：进入 → 第 1/3 步 → 下一步 → 第 2/3 步
  await panel.getByRole('button', { name: '单步演示' }).click();
  await expect(panel.getByText('第 1 / 3 步')).toBeVisible();
  await panel.getByRole('button', { name: '下一步' }).click();
  await expect(panel.getByText('第 2 / 3 步')).toBeVisible();
  await panel.getByRole('button', { name: '退出' }).click();

  // 上下游高亮：点中间节点（React Flow 节点包装层拦截指针，点其容器）
  await panel.locator('.react-flow__node[data-id="n2"]').click({ force: true });

  await expect(panel.getByLabel('节点 输入')).toHaveAttribute('data-hl', 'up');
  await expect(panel.getByLabel('节点 输出')).toHaveAttribute('data-hl', 'down');

  // 插入到正文 → figure + diagram 双块；diagram 块带可编辑画布
  const inserted = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().includes(doc.page_id),
  );
  await panel.getByRole('button', { name: '插入到正文' }).click();
  const insertedResponse = await inserted;
  expect(insertedResponse.ok(), await insertedResponse.text()).toBeTruthy();
  const insertedDoc = (await insertedResponse.json()).data;
  const diagramId = insertedDoc.blocks.find((block: { type: string }) => block.type === 'diagram').id;
  const bodyCanvas = page.locator(`[id="${diagramId}"]`).getByLabel('流程图画布');
  await expect(bodyCanvas).toBeVisible();
  await expect(bodyCanvas.getByLabel('节点 编码器')).toBeVisible();

  // 编辑态：双击节点 → 改字 → PATCH
  await bodyCanvas.locator('.react-flow__node[data-id="n2"]').dblclick({ force: true });
  await page.getByLabel('节点文字', { exact: true }).fill('解码器');
  const editSaved = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().includes(doc.page_id),
  );
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await editSaved;
  await expect(bodyCanvas.getByLabel('节点 解码器')).toBeVisible();

  const currentDiagram = async () => {
    const response = await page.request.get(`/api/v1/pages/${doc.page_id}`);
    return (await response.json()).data.blocks.find((block: { type: string }) => block.type === 'diagram').data.doc;
  };
  const node = bodyCanvas.locator('.react-flow__node[data-id="n2"]');
  await node.scrollIntoViewIfNeeded();
  const bounds = (await node.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 45, bounds.y + bounds.height / 2 + 35, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await currentDiagram()).nodes[1].y).not.toBe(0.3);
  await bodyCanvas.getByRole('button', { name: '整理布局' }).click();
  await expect.poll(async () => (await currentDiagram()).nodes[1].y).toBe(0.5);
  await bodyCanvas.getByRole('button', { name: '重置' }).click();
  await expect.poll(async () => (await currentDiagram()).nodes[1].y).toBe(0.3);

  // 发布 → 分享页：画布只读渲染，不出现插入/识别/AI 按钮
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载离线活页' }).click();
  const offlinePath = testInfo.outputPath('living-page.html');
  await (await downloaded).saveAs(offlinePath);
  const offline = await browser.newContext({ offline: true });
  try {
    const file = await offline.newPage();
    const network: string[] = [];
    const offlineErrors: string[] = [];
    file.on('request', (request) => {
      if (/^https?:/.test(request.url())) network.push(request.url());
    });
    file.on('pageerror', (error) => offlineErrors.push(error.message));
    await file.goto(pathToFileURL(offlinePath).href);
    await expect(file.getByLabel('节点 解码器')).toBeVisible();
    await file.getByRole('button', { name: /对照原页/ }).click();
    await expect(file.locator('img[src^="data:image/png"]').first()).toBeVisible();
    await file.getByRole('button', { name: '图示：推理流程' }).click();
    const hotspot = file.getByRole('region', { name: '图示：推理流程' });
    await hotspot.getByRole('button', { name: '单步演示' }).click();
    await hotspot.getByRole('button', { name: '下一步' }).click();
    await expect(hotspot.getByText('第 2 / 3 步')).toBeVisible();
    expect(network).toEqual([]);
    expect(offlineErrors).toEqual([]);
  } finally {
    await offline.close();
  }

  const published = await page.request.post(
    `/api/v1/pages/${doc.page_id}/publish`, { headers });
  expect(published.status()).toBe(201);
  const shareId = (await published.json()).data.share_id;
  await page.goto(`/page-shares/${shareId}`);
  // 分享页正文直接渲染 diagram 块（已插入）
  const shareCanvas = page.getByLabel('流程图画布').first();
  await expect(shareCanvas).toBeVisible();
  await expect(shareCanvas.getByLabel('节点 解码器')).toBeVisible();
  // 原页热区 → 面板无编辑按钮
  await page.getByRole('button', { name: /对照原页/ }).click();
  await page.getByRole('button', { name: '图示：推理流程' }).click();
  const sharePanel = page.getByRole('region', { name: '图示：推理流程' });
  await expect(sharePanel.getByRole('button', { name: '插入到正文' })).toHaveCount(0);
  await expect(sharePanel.getByRole('button', { name: '识别流程图' })).toHaveCount(0);
  await expect(sharePanel.getByRole('button', { name: 'AI 交互' })).toHaveCount(0);
  // 学生仍可玩单步演示
  await sharePanel.getByRole('button', { name: '单步演示' }).click();
  await expect(sharePanel.getByText('第 1 / 3 步')).toBeVisible();

  await sharePanel.getByRole('button', { name: '下一步' }).click();
  await sharePanel.getByRole('button', { name: '下一步' }).click();
  const backReport = page.waitForResponse((r) => r.url().endsWith('/progress')
    && r.request().postDataJSON()?.patch?.diagram_states?.step === 2);
  await sharePanel.getByRole('button', { name: '上一步' }).click();
  expect((await backReport).ok()).toBeTruthy();
  const insight = await page.request.get(`/api/v1/pages/${doc.page_id}/insights`);
  expect((await insight.json()).data.blocks).toEqual(expect.objectContaining({
    [doc.blocks.find((block: { type: string }) => block.type === 'page').id]:
      expect.objectContaining({ diagram_step_max: 3, diagram_completed: 1 }),
  }));

  expect(errors, `浏览器报错：${errors.join(' | ')}`).toEqual([]);
});

/** P3 移动端回归：≤720px 面板转底部抽屉，流程图与单步演示在手机视口可用。 */
test('移动端视口：分享页热区 → 底部抽屉面板 → 单步演示', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { doc, headers } = await setupDiagramPage(page);
  const published = await page.request.post(
    `/api/v1/pages/${doc.page_id}/publish`, { headers });
  expect(published.status()).toBe(201);
  const shareId = (await published.json()).data.share_id;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/page-shares/${shareId}`);
  await page.getByRole('button', { name: /对照原页/ }).click();
  await page.getByRole('button', { name: '图示：推理流程' }).click();
  const panel = page.getByRole('region', { name: '图示：推理流程' });
  await expect(panel).toBeVisible();
  // 底部抽屉：面板位于视口下半屏
  const box = (await panel.boundingBox())!;
  expect(box.y).toBeGreaterThan(844 / 3);

  // 画布与单步演示在移动端可用
  await expect(panel.getByLabel('流程图画布')).toBeVisible();
  await panel.getByRole('button', { name: '单步演示' }).click();
  await expect(panel.getByText('第 1 / 3 步')).toBeVisible();
  await panel.getByRole('button', { name: '下一步' }).click();
  await expect(panel.getByText('第 2 / 3 步')).toBeVisible();
  await expect(panel.getByRole('button', { name: '插入到正文' })).toHaveCount(0);

  expect(errors, `浏览器报错：${errors.join(' | ')}`).toEqual([]);
});
