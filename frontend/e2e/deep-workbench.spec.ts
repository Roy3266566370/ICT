import { test, expect } from '@playwright/test';

test('shared blank canvas starts empty and accepts blocks from different subjects', async ({ page }) => {
  await page.goto('/workshop?subject=deep&q=no-match-example');
  const blank = page.getByRole('button', { name: '新建空白画布', exact: true });
  await expect(blank).toHaveCount(1);
  await blank.click();
  await expect(page).toHaveURL(/\/canvas$/);
  await expect(page.locator('[data-node]')).toHaveCount(0);
  await page.getByText('＋ 添加对象', { exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索积木' }).fill('逐行 Softmax');
  await page.getByRole('button', { name: '逐行 Softmax', exact: true }).click();
  const palette = page.getByText('＋ 添加对象', { exact: true });
  if (!await page.getByRole('searchbox', { name: '搜索积木' }).isVisible()) await palette.click();
  await page.getByRole('searchbox', { name: '搜索积木' }).fill('matrixSource');
  await page.getByRole('button', { name: '矩阵源', exact: true }).click();
  await expect(page.locator('[data-node]')).toHaveCount(2);
});

test('deep workbench docks the same result components and reflects broken wiring', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/workshop?subject=deep&q=Attention');
  await page.getByRole('button', { name: /Attention · 缩放 A\/B 对照/ }).click();
  await expect(page).toHaveURL(/\/canvas\?work=/);
  const result = page.getByRole('complementary', { name: '结果与参数' });
  await expect(result.getByRole('heading', { name: '缩放后权重' })).toBeVisible();
  const dimension = result.getByRole('slider', { name: /键维度/ });
  await dimension.fill('4');
  const canvas = page.locator('[data-node]').first();
  expect((await canvas.boundingBox())!.x).toBeLessThan((await result.boundingBox())!.x);
  await page.getByRole('button', { name: '收起结果栏' }).click();
  await expect(result).toBeHidden();
  await page.getByRole('button', { name: '展开结果栏' }).click();
  await expect(dimension).toHaveValue('4');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(result).toBeVisible();
  await page.getByRole('button', { name: '适应全图' }).click();
  await page.getByRole('button', { name: '移除 打分 QKᵀ', exact: true }).click();
  await expect(result.getByText('连接 tensor2d', { exact: false }).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(result).toBeHidden();
  await page.getByRole('button', { name: '结果与参数', exact: true }).click();
  await expect(result).toBeVisible();
});

test('all fourteen workbench graphs open with results at desktop sizes', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const { DEEP_TEMPLATES } = await import('../src/canvas/deepTemplates');
  const illustrated = new Set(['dlCnn', 'dlAttention', 'dlOptimizer', 'dlQlearning']);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  for (const template of DEEP_TEMPLATES) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/workshop?subject=deep&q=${encodeURIComponent(template.name)}`);
    await page.getByRole('button', { name: new RegExp(template.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
    await expect(page).toHaveURL(/\/canvas\?work=/);
    const result = page.getByRole('complementary', { name: '结果与参数' });
    await expect(result.getByRole('heading', { name: '实验结果' })).toBeVisible();
    await expect(result.getByRole('slider').first()).toBeVisible();
    expect(await page.locator('[data-node]').count()).toBeGreaterThan(2);
    if (illustrated.has(template.kind)) {
      await page.screenshot({ path: testInfo.outputPath(`${template.kind}-1440.png`) });
      await page.setViewportSize({ width: 1280, height: 720 });
      await expect(result.getByRole('heading', { name: '常用参数' })).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`${template.kind}-1280.png`) });
    }
  }
  expect(errors).toEqual([]);
});

test('training stays mounted when results are hidden and a setting change stops it', async ({ page }) => {
  await page.goto('/workshop?subject=deep&q=MLP');
  await page.getByRole('button', { name: /MLP · 流形折叠观察台/ }).click();
  const result = page.getByRole('complementary', { name: '结果与参数' });
  await result.getByRole('button', { name: '开始训练', exact: true }).click();
  const snapshot = async () => {
    const texts = await result.getByText(/Epoch [0-9]+\/2000/).allTextContents();
    return Number(texts[0]?.match(/Epoch (\d+)/)?.[1] ?? 0);
  };
  await expect.poll(snapshot).toBeGreaterThan(1);
  const before = await snapshot();
  await page.getByRole('button', { name: '收起结果栏' }).click();
  await page.getByRole('button', { name: '展开结果栏' }).click();
  await expect.poll(snapshot).toBeGreaterThan(before);
  const saved = page.waitForResponse((response) => {
    if (response.request().method() !== 'PATCH' || !response.url().includes('/works/')) return false;
    const payload = response.request().postDataJSON();
    return payload.document?.nodes?.some((node: { type: string; params: Record<string, number> }) =>
      node.type === 'studyHiddenLayer' && node.params['宽度'] === 4);
  });
  await result.getByRole('slider', { name: '隐层一宽度', exact: true }).fill('4');
  await expect(result.getByRole('button', { name: '开始训练', exact: true })).toBeVisible();
  await expect.poll(snapshot).toBe(0);
  expect((await saved).ok()).toBeTruthy();
  await page.reload();
  await expect(result.getByRole('slider', { name: '隐层一宽度', exact: true })).toHaveValue('4');
});
