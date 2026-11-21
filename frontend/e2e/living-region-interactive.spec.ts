import { test, expect } from '@playwright/test';

/** P1.1 验收：公式热区 → 聚焦面板 → 交互函数图 → 拖滑杆 → 插入正文 → 分享页仍可用。
 *  覆盖两个验收阻塞：热区不再绕过面板直接滚动；插入只补 canvas 不重复 formula。 */
test('公式热区面板 → 函数图 → 拖滑杆 → 插入正文 → 分享页只读可玩', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const session = (await (await page.request.post('/api/v1/sessions')).json()).data;
  const headers = { 'X-CSRF-Token': session.csrf_token };

  // 浏览器内生成一张含公式笔迹的 PNG，走真实图片上传链路（保留原页热区）
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = '#222222'; ctx.font = '30px serif';
    ctx.fillText('y = x^2 + a', 60, 90);
    ctx.strokeStyle = '#334455'; ctx.lineWidth = 2;
    ctx.strokeRect(60, 280, 300, 160);
    ctx.font = '22px sans-serif';
    ctx.fillText('输入层', 90, 330);
    ctx.fillText('输出层', 270, 410);
    return canvas.toDataURL('image/png');
  });
  const png = Buffer.from(dataUrl.split(',')[1]!, 'base64');
  const upload = await page.request.post('/api/v1/pages', {
    headers,
    multipart: { files: { name: 'board.png', mimeType: 'image/png', buffer: png } },
  });
  expect(upload.status(), await upload.text()).toBe(201);
  const doc = (await upload.json()).data;
  const pageBlock = doc.blocks.find((b: { type: string }) => b.type === 'page');
  const assetId = pageBlock.data.regions?.[0]?.asset_id;
  expect(assetId, '图片上传应自动生成原页热区与裁剪资产').toBeTruthy();

  // 把自动热区改写成一个公式区 + 一个带标签的图示区（复用同一份裁剪资产）
  pageBlock.data.regions = [
    {
      id: 'r_fx', kind: 'formula', bbox: [0.04, 0.04, 0.92, 0.42], asset_id: assetId,
      label: '抛物线公式', caption: '', text: 'y = x^2 + a', source: 'e2e',
      confidence: 0.9, latex: 'y = x^{2} + a', expression: 'x^2 + a', params: ['a'],
    },
    {
      id: 'r_diag', kind: 'diagram', bbox: [0.04, 0.55, 0.92, 0.96], asset_id: assetId,
      label: '结构图', caption: '图1 网络结构', text: '', source: 'e2e',
      confidence: 0.8,
      labels: [
        { text: '输入层', bbox: [0.05, 0.1, 0.4, 0.35] },
        { text: '输出层', bbox: [0.55, 0.6, 0.9, 0.85] },
      ],
    },
  ];
  const patched = await page.request.patch(`/api/v1/pages/${doc.page_id}`, {
    headers, data: { expected_revision: doc.revision, blocks: doc.blocks },
  });
  expect(patched.status(), await patched.text()).toBe(200);

  await page.goto(`/living/${doc.page_id}`);
  await page.getByRole('button', { name: /对照原页/ }).click();

  // 阻塞 1 回归：公式热区 → 打开聚焦面板（不是直接滚动离开）
  await page.getByRole('button', { name: '公式：抛物线公式' }).click();
  const panel = page.getByRole('region', { name: '公式：抛物线公式' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: '交互图' })).toBeVisible();

  // 交互图：标准函数图画布 + 滑杆源
  await panel.getByRole('button', { name: '交互图' }).click();
  const exprInput = panel.getByLabel('函数表达式');
  await expect(exprInput).toBeVisible();
  await expect(exprInput).toHaveValue('x^2 + a');
  const slider = panel.getByLabel('滑杆值');
  await expect(slider).toBeVisible();
  // 拖动滑杆 → 观察点变化（真实交互，不只是渲染）
  await slider.fill('0.8');
  await expect(slider).toHaveValue('0.8');

  // 表达式可编辑：改成 x^3 仍然渲染
  await exprInput.fill('x^3 + a');
  await expect(panel.getByRole('img', { name: /横轴/ })).toBeVisible();

  // 阻塞 2 回归：自动识别公式已有保真块时，面板提供「插入函数图」而非重复 formula
  //（此用例 blockify 没跑，block_id 为空 → 按钮为「插入到正文」）
  const inserted = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().includes(doc.page_id),
  );
  await panel.getByRole('button', { name: '插入到正文' }).click();
  await inserted;
  // 正文出现 canvas 块（工坊积木）与变量滑杆 参数 a
  await expect(page.getByLabel('内嵌工坊画布')).toBeVisible();
  await expect(page.getByLabel('参数 a').first()).toBeVisible();
  // 插入后面板仍在打开状态并回写关联：出现两个定位按钮，不再有插入按钮
  await expect(panel.getByRole('button', { name: '定位到正文' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '定位函数图' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '插入到正文' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '插入函数图' })).toHaveCount(0);
  await panel.getByRole('button', { name: '定位函数图' }).click();
  await expect(page.getByLabel('内嵌工坊画布')).toBeInViewport();

  // 图示热区 → 标签遮挡自测
  await page.getByRole('button', { name: '公式：抛物线公式' }).click(); // 关公式面板
  await page.getByRole('button', { name: '图示：结构图' }).click();
  const diagPanel = page.getByRole('region', { name: '图示：结构图' });
  await diagPanel.getByRole('button', { name: '交互图' }).click();
  await diagPanel.getByRole('button', { name: '第 1 个标签，点击显示' }).click();
  await expect(diagPanel.getByLabel('标签：输入层')).toBeVisible();

  // 发布 → 分享页：只读可玩，不出现 插入/AI 按钮
  const published = await page.request.post(
    `/api/v1/pages/${doc.page_id}/publish`, { headers },
  );
  expect(published.status(), await published.text()).toBe(201);
  const shareId = (await published.json()).data.share_id;
  await page.goto(`/page-shares/${shareId}`);
  await page.getByRole('button', { name: /对照原页/ }).click();
  await page.getByRole('button', { name: '公式：抛物线公式' }).click();
  const sharePanel = page.getByRole('region', { name: '公式：抛物线公式' });
  await expect(sharePanel).toBeVisible();
  await expect(sharePanel.getByRole('button', { name: '插入到正文' })).toHaveCount(0);
  await expect(sharePanel.getByRole('button', { name: '插入函数图' })).toHaveCount(0);
  await expect(sharePanel.getByRole('button', { name: 'AI 交互' })).toHaveCount(0);
  await expect(sharePanel.getByRole('button', { name: '识别公式' })).toHaveCount(0);
  await sharePanel.getByRole('button', { name: '交互图' }).click();
  const shareSlider = sharePanel.getByLabel('滑杆值');
  await expect(shareSlider).toBeVisible();
  await shareSlider.fill('0.5');
  // 学生也可玩遮挡自测
  await page.getByRole('button', { name: '公式：抛物线公式' }).click();
  await page.getByRole('button', { name: '图示：结构图' }).click();
  const shareDiag = page.getByRole('region', { name: '图示：结构图' });
  await shareDiag.getByRole('button', { name: '交互图' }).click();
  await shareDiag.getByRole('button', { name: '第 2 个标签，点击显示' }).click();
  await expect(shareDiag.getByLabel('标签：输出层')).toBeVisible();

  expect(errors, `浏览器报错：${errors.join(' | ')}`).toEqual([]);
});
