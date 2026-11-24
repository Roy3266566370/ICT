import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test('M5 自然语言生成动态关系：未配置模型提示、预览确认、原子撤销与放映态联动', async ({ page }) => {
  test.setTimeout(180_000);

  // 1. 上传示例图并进入自由编辑器
  await page.goto('/living');
  const fixturePath = fileURLToPath(new URL('./fixtures/basis-alternate.png', import.meta.url));
  await page.locator('input[type=file][accept*=".pptx"]').setInputFiles(fixturePath);
  await expect(page).toHaveURL(/\/materials\/([^/]+)\/work/, { timeout: 60_000 });
  const materialMatch = /\/materials\/([^/]+)\/work/.exec(page.url());
  expect(materialMatch).toBeTruthy();
  const materialId = materialMatch![1]!;

  const editLink = page.getByRole('button', { name: '编辑课件' });
  await expect(editLink).toBeVisible({ timeout: 60_000 });
  await editLink.click();
  const editor = page.locator('[data-free-editor]');
  const canvas = editor.getByLabel('可编辑画布第 1 页');
  await expect(canvas.locator('[data-node-type="image"]').first()).toBeVisible({ timeout: 60_000 });

  // 2. 添加 1 条箭头向量和 1 个文本框，用于自然语言动态绑定
  await editor.getByRole('button', { name: '＋ 箭头', exact: true }).click();
  await editor.getByRole('button', { name: '＋ 文字', exact: true }).click();
  // 退出文字输入态并取消选中，在右侧空白属性面板直接看到「页面动态关系」
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  const relSection = editor.getByLabel('页面动态关系');
  await expect(relSection).toBeVisible();
  const nlInput = relSection.getByLabel('自然语言生成动态关系').locator('textarea');
  await expect(nlInput).toBeVisible();
  await expect(relSection.locator('[data-relation-id]')).toHaveCount(0);

  // 3. 验证真实后端在未配置 AI 模型时返回清晰中文错误，不写入文档
  await nlInput.fill('把新增文字绑定为箭头长度');
  await relSection.getByRole('button', { name: '生成关系预览' }).click();
  await expect(relSection.getByRole('alert')).toContainText(/AI|模型|配置/);
  await expect(relSection.locator('[data-relation-id]')).toHaveCount(0);

  // 4. 拦截 /relations/suggest 返回基于当前真实节点 ID 与 revision 的提案，验证预览确认流
  const vecId = await canvas.locator('[data-vector-node]').first().getAttribute('data-vector-node');
  const txtId = await canvas.locator('[data-node-type="text"]').first().getAttribute('data-node-id');
  expect(vecId).toBeTruthy();
  expect(txtId).toBeTruthy();

  await page.route(`**/api/v1/materials/${materialId}/document/pages/1/relations/suggest`, async (route) => {
    const reqBody = route.request().postDataJSON() as { expected_revision?: number } | null;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        request_id: 'req_m5_nl_test',
        data: {
          summary: '将文字绑定为箭头长度，并仅开放箭头终点供观众拖动',
          relations: [
            {
              id: 'rel_nl_len',
              kind: 'expr',
              enabled: true,
              provenance: 'user',
              targetId: txtId,
              targetProperty: 'text',
              expression: `round(${vecId}.length)`,
              formatTemplate: '当前长度：{value}',
              precision: 0,
            },
          ],
          viewer_updates: [
            {
              nodeId: vecId,
              viewer_editable: true,
              viewer_parameters: ['end'],
            },
          ],
          warnings: [],
          source_revision: reqBody?.expected_revision ?? 0,
          cached: false,
        },
      }),
    });
  });

  await nlInput.fill('把文字实时显示为箭头长度，并只允许观众拖动箭头终点');
  await relSection.getByRole('button', { name: '生成关系预览' }).click();

  const previewCard = relSection.locator('[data-nl-relation-preview]');
  await expect(previewCard).toBeVisible();
  await expect(previewCard).toContainText('将文字绑定为箭头长度');
  await expect(previewCard).toContainText('试算正常');
  await expect(previewCard).toContainText('允许观众操作（拖动终点）');

  // 预览阶段尚未应用，文档关系数仍为 0
  await expect(relSection.locator('[data-relation-id]')).toHaveCount(0);

  // 5. 点击确认应用，验证关系与文字计算结果立即生效
  await previewCard.getByRole('button', { name: '确认应用' }).click();
  await expect(previewCard).toBeHidden();
  await expect(relSection.locator('[data-relation-id]')).toHaveCount(1);
  await expect(canvas).toContainText(/当前长度：\d+/);

  // 6. 点击「撤销编辑」，验证一次性原子撤销新增关系
  await editor.getByRole('button', { name: '撤销编辑' }).click();
  await expect(relSection.locator('[data-relation-id]')).toHaveCount(0);
  await expect(canvas).not.toContainText(/当前长度：\d+/);

  // 7. 点击「重做编辑」，保存并返回放映态，验证观众权限（仅终点手柄）与拖动实时联动
  await editor.getByRole('button', { name: '重做编辑' }).click();
  await expect(relSection.locator('[data-relation-id]')).toHaveCount(1);
  await expect(editor.getByText('已保存到服务端', {exact: true})).toBeVisible();
  await page.getByRole('button', { name: '互动预览' }).click();
  await expect(page).toHaveURL(/\/work/, { timeout: 60_000 });

  const slide = page.getByLabel('幻灯片第 1 页', { exact: true });
  await expect(slide).toContainText(/当前长度：\d+/);
  await expect(slide.getByLabel('拖动终点')).toHaveCount(1);
  await expect(slide.getByLabel('拖动起点')).toHaveCount(0);

  const beforeText = await slide.locator('[data-node-type="text"]').first().textContent();
  const endHandle = slide.getByLabel('拖动终点').first();
  const box = (await endHandle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 20, { steps: 6 });
  await page.mouse.up();

  const afterText = await slide.locator('[data-node-type="text"]').first().textContent();
  expect(afterText).toMatch(/当前长度：\d+/);
  expect(afterText).not.toBe(beforeText);
});
