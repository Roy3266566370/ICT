import { test, expect } from '@playwright/test';

test('Phase 0：真实保存、渲染、属性表单和公开快照', async ({ page, browser }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const sessionResponse = await page.request.post('/api/v1/sessions');
  expect(sessionResponse.ok()).toBeTruthy();
  const session = (await sessionResponse.json()).data;
  const headers = { 'X-CSRF-Token': session.csrf_token };
  const create = await page.request.post('/api/v1/pages/text', { headers, data: { title: 'Phase 0 浏览器验收', text: '存量文档正文' } });
  expect(create.status()).toBe(201);
  const doc = (await create.json()).data;
  const markdown = '# 混排验收\n\n- 第一项\n- 行内 $x^2$\n\n| 参数 | 值 |\n| --- | --- |\n| x | 2 |\n\n```js\nconst price = "$5";\n```\n\n$$\nx^2+1\n$$\n\n坏 $x\n正文 **保留**\n\n正常 **粗体**\n\n<script>window.__livingXss = 1</script>\n\n[恶意链接](javascript:alert(1))';
  const unknownData = { nested: [{ html: '<img src=x onerror="window.__livingXss=2">', value: 7 }] };
  const blocks = [
    { id: 'markdown', type: 'text', data: { md: markdown } },
    { id: 'legacy', type: 'text', data: { md: '旧文档仍能阅读', collapsed: true } },
    { id: 'unknown', type: '__proto__', data: unknownData },
    { id: 'quiz', type: 'quiz', data: { question: '旧预测', answer: '', explain: '', min: 0, max: 10, value: 1 } },
    { id: 'checkpoint', type: 'checkpoint', data: { prompt: '旧题目', expected: '', placeholder: '' } },
    { id: 'embed', type: 'embed', data: { url: '', height: 360 } },
  ];
  try {
    const patch = await page.request.patch(`/api/v1/pages/${doc.page_id}`, { headers, data: { expected_revision: doc.revision, blocks } });
    expect(patch.status(), await patch.text()).toBe(200);
    await page.goto(`/living/${doc.page_id}`);
    await expect(page.getByRole('heading', { name: '混排验收', exact: true })).toBeVisible();
    await expect(page.locator('#markdown table td')).toHaveCount(2);
    await expect(page.locator('#markdown .katex')).toHaveCount(2);
    await expect(page.locator('#markdown pre')).toContainText('const price = "$5";');
    await expect(page.locator('#markdown')).toContainText('坏 $x\n正文 **保留**');
    await expect(page.locator('#markdown strong')).toHaveText('粗体');
    await expect(page.locator('#markdown script')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__livingXss)).toBeUndefined();
    await expect(page.locator('#markdown a')).not.toHaveAttribute('href', /javascript:/);
    await page.locator('#legacy summary').click();
    await expect(page.locator('#legacy')).toContainText('旧文档仍能阅读');
    await page.locator('#unknown summary').click();
    await expect(page.locator('#unknown pre')).toContainText('onerror');
    await expect(page.locator('#unknown img')).toHaveCount(0);
    await expect(page.locator('#embed')).toContainText('尚未配置嵌入网页');

    await page.locator('#quiz').getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByLabel('问题', { exact: true }).fill('预测一半');
    await page.getByLabel('答案说明', { exact: true }).fill('答案为 0.5');
    await page.getByLabel('解析', { exact: true }).fill('一半等于 0.5');
    await page.getByLabel('最小值', { exact: true }).fill('2');
    await page.getByLabel('最大值', { exact: true }).fill('1');
    await expect(page.getByRole('button', { name: '完成', exact: true })).toBeDisabled();
    await page.getByLabel('最小值', { exact: true }).fill('0');
    await page.getByLabel('实际值', { exact: true }).fill('0.5');
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await expect(page.getByText(/^已保存 /)).toBeVisible();

    await page.locator('#checkpoint').getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByLabel('题目提示', { exact: true }).fill('请输入一半');
    await page.getByLabel('参考答案', { exact: true }).fill('0.5');
    await page.getByLabel('输入框占位提示', { exact: true }).fill('输入小数');
    const checkpointSaved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(doc.page_id));
    await page.getByRole('button', { name: '完成', exact: true }).click();
    expect((await checkpointSaved).ok()).toBeTruthy();

    await page.locator('#embed').getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByLabel('网页地址', { exact: false }).fill('javascript:alert(1)');
    await expect(page.getByRole('button', { name: '完成', exact: true })).toBeDisabled();
    await page.getByLabel('网页地址', { exact: false }).fill(new URL('/embed-fixture', page.url()).href);
    await page.route('**/embed-fixture', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>本地嵌入验收</h1>' }));
    await page.getByLabel('高度', { exact: false }).fill('480');
    const embedSaved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(doc.page_id));
    await page.getByRole('button', { name: '完成', exact: true }).click();
    expect((await embedSaved).ok()).toBeTruthy();
    await expect(page.locator('#embed iframe')).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(page.locator('#embed iframe')).toHaveAttribute('height', '480');
    await page.locator('#embed iframe').scrollIntoViewIfNeeded();
    await expect(page.frameLocator('#embed iframe').getByRole('heading', { name: '本地嵌入验收' })).toBeVisible();

    const moveSaved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(doc.page_id));
    await page.locator('#unknown').getByRole('button', { name: '↑', exact: true }).click();
    expect((await moveSaved).ok()).toBeTruthy();
    await page.reload();
    await expect(page.locator('#quiz')).toContainText('预测一半');
    await expect(page.locator('#checkpoint input')).toHaveAttribute('placeholder', '输入小数');
    const saved = (await (await page.request.get(`/api/v1/pages/${doc.page_id}`)).json()).data;
    expect(saved.schema_version).toBe('page.1');
    expect(saved.blocks.find((b: { id: string }) => b.id === 'unknown').data).toEqual(unknownData);
    expect(saved.blocks.find((b: { id: string }) => b.id === 'quiz').data).toEqual({ question: '预测一半', answer: '答案为 0.5', explain: '一半等于 0.5', min: 0, max: 1, value: 0.5 });

    for (const label of ['嵌入', '先猜再看', '判分点']) {
      await page.getByRole('button', { name: '在此插入块', exact: true }).last().click();
      await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
      await expect(page.getByRole('form', { name: `编辑${label}`, exact: true })).toBeVisible();
      const insertedSaved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(doc.page_id));
      await page.getByRole('button', { name: '完成', exact: true }).click();
      expect((await insertedSaved).ok()).toBeTruthy();
    }
    await page.screenshot({ path: testInfo.outputPath('editor.png'), fullPage: true });
    await page.getByRole('button', { name: '发布', exact: true }).click();
    const shareLink = page.locator('a[href*="/page-shares/"]');
    await expect(shareLink).toBeVisible();
    const shareUrl = await shareLink.getAttribute('href');
    const guest = await browser.newContext();
    const reader = await guest.newPage();
    reader.on('pageerror', (error) => errors.push(error.message));
    await reader.route('**/embed-fixture', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>本地嵌入验收</h1>' }));
    await reader.goto(new URL(shareUrl!, page.url()).href);
    await expect(reader.getByRole('heading', { name: '混排验收', exact: true })).toBeVisible();
    await expect(reader.locator('.katex')).toHaveCount(2);
    await expect(reader.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
    await expect(reader.getByText('查看原始数据', { exact: true })).toHaveCount(0);
    await reader.getByPlaceholder('输入小数').fill('0.5');
    await reader.getByRole('button', { name: '提交', exact: true }).first().click();
    await expect(reader.getByText('回答正确', { exact: true })).toBeVisible();
    await reader.locator('iframe').scrollIntoViewIfNeeded();
    await expect(reader.frameLocator('iframe').getByRole('heading', { name: '本地嵌入验收' })).toBeVisible();
    await reader.screenshot({ path: testInfo.outputPath('share.png'), fullPage: true });
    await guest.close();
    const deleteSaved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(doc.page_id));
    await page.locator('#unknown').getByRole('button', { name: '删', exact: true }).click();
    expect((await deleteSaved).ok()).toBeTruthy();
    await page.reload();
    await expect(page.locator('#unknown')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    const current = (await (await page.request.get('/api/v1/sessions/current')).json()).data;
    await page.request.delete(`/api/v1/pages/${doc.page_id}`, { headers: { 'X-CSRF-Token': current.csrf_token } });
  }
});
