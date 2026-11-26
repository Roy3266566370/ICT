import { expect, test } from '@playwright/test';

test('自定义定象坊作品嵌入课件后保持参数并在缩略图中显示真实图形', async ({ page }) => {
  await page.goto('/canvas?template=biz-breakeven');
  const source = page.locator('[data-instrument-stage]');
  const originalPrice = source.getByRole('spinbutton', { name: '客单价（元）数值' });
  await originalPrice.fill('123.45');
  await originalPrice.press('Enter');
  const workTitle = '经营盈亏平衡与定价沙盘' + '🧮'.repeat(96);
  await page.getByRole('textbox', { name: '画布标题' }).fill(workTitle);
  const [created] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/api/v1/works') && response.request().method() === 'POST'),
    page.getByRole('button', { name: '保存到定象坊' }).click(),
  ]);
  expect(created.ok()).toBe(true);
  const { data: { work_id: workId } } = await created.json();

  await page.goto('/living');
  const blankPage = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 540;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await page.locator('input[type=file][accept*=".pptx"]').setInputFiles({
    name: '我的定象坊作品验收.png', mimeType: 'image/png', buffer: Buffer.from(blankPage, 'base64'),
  });
  await expect(page).toHaveURL(/\/materials\/[^/]+\/work/);
  await page.getByRole('button', { name: '编辑课件', exact: true }).click();
  const editor = page.locator('[data-free-editor]');
  await editor.getByRole('button', { name: '插入定象坊插件' }).first().click();
  const picker = page.getByRole('dialog', { name: '插入定象坊交互插件' });
  await picker.getByRole('tab', { name: '我的作品' }).click({ timeout: 5_000 });
  await picker.getByRole('searchbox').fill('盈亏');
  const [inserted] = await Promise.all([
    page.waitForResponse(response => /\/api\/v1\/materials\/[^/]+\/document$/.test(response.url()) && response.request().method() === 'PATCH'),
    picker.getByRole('button', { name: /经营盈亏平衡与定价沙盘/ }).click(),
  ]);
  expect(inserted.ok()).toBe(true);
  await expect(picker).toBeHidden();

  const slide = editor.getByLabel('可编辑画布第 1 页');
  const price = slide.getByRole('spinbutton', { name: '客单价（元）数值' });
  await expect(price).toHaveValue('123.45');
  const thumbnail = editor.getByRole('button', { name: '编辑第 1 页', exact: true }).locator('[data-workshop-preview]');
  await expect(thumbnail).toHaveAttribute('src', /^data:image\/(png|webp);base64,/);
  const originalPreview = await thumbnail.getAttribute('src');
  expect(originalPreview!.length).toBeLessThan(350_000);
  const previewSize = await thumbnail.evaluate(async (image: HTMLImageElement) => {
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<number>();
    for (let i = 0; i < pixels.length; i += 4) colors.add(pixels[i]! * 65536 + pixels[i + 1]! * 256 + pixels[i + 2]!);
    return { width: image.naturalWidth, colors: colors.size };
  });
  expect(previewSize.width).toBeGreaterThan(0);
  expect(previewSize.width).toBeLessThanOrEqual(480);
  expect(previewSize.colors).toBeGreaterThan(5);

  await price.fill('246.90');
  await price.press('Enter');
  await expect(thumbnail).not.toHaveAttribute('src', originalPreview!);
  await editor.getByRole('button', { name: '撤销编辑' }).click();
  await expect(price).toHaveValue('123.45');
  await editor.getByRole('button', { name: '重做编辑' }).click();
  await expect(price).toHaveValue('246.9');
  await expect(editor.getByText('已保存到服务端', { exact: true })).toBeVisible();
  const [saved] = await Promise.all([
    page.waitForResponse(response => /\/api\/v1\/materials\/[^/]+\/document$/.test(response.url()) && response.request().method() === 'GET'),
    page.reload(),
  ]);
  expect(saved.ok()).toBe(true);
  const { data } = await saved.json();
  const embedded = data.pages[0].nodes.find((node: { type: string }) => node.type === 'workshop_plugin');
  expect(embedded.name).toBe([...workTitle].slice(0, 100).join(''));
  expect(embedded.workshop_plugin).toMatchObject({ template_kind: 'custom-work', work_id: workId, title: workTitle });
  await expect(thumbnail).toHaveAttribute('src', /^data:image\/(png|webp);base64,/);
  await expect(price).toHaveValue('246.9');

  await page.goto(`/canvas?work=${encodeURIComponent(workId)}`);
  await expect(originalPrice).toHaveValue('123.45');
});
