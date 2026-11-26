import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test('M4 动态关系面板：手动表达式绑定折叠区、白名单拦截、原子撤销与保存', async ({ page }) => {
  test.setTimeout(180_000);

  // 1. 上传示例图并进入自由编辑器
  await page.goto('/living');
  const fixturePath = fileURLToPath(new URL('./fixtures/basis-alternate.png', import.meta.url));
  await page.locator('input[type=file][accept*=".pptx"]').setInputFiles(fixturePath);
  await expect(page).toHaveURL(/\/materials\/([^/]+)\/work/, { timeout: 60_000 });

  await page.getByRole('button', { name: '编辑课件' }).click();
  const editor = page.locator('[data-free-editor]');
  const canvas = editor.getByLabel('可编辑画布第 1 页');
  await expect(canvas.locator('[data-node-type="image"]').first()).toBeVisible({ timeout: 60_000 });

  // 2. 添加 1 条箭头和 1 个文本框，取消选中后打开「动态关系」页签
  await editor.getByRole('button', { name: '＋ 箭头', exact: true }).click();
  await editor.getByRole('button', { name: '＋ 文字', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await editor.getByRole('tab', { name: /动态关系/ }).click();
  const relSection = editor.getByLabel('页面动态关系');
  await expect(relSection).toBeVisible();
  await expect(relSection.locator('[data-relation-id]')).toHaveCount(0);

  // 3. 手动绑定表单默认折叠在「高级：手动绑定表达式」中
  await expect(relSection.getByLabel('关系类型')).toBeHidden();
  await relSection.getByText('高级：手动绑定表达式').click();
  await expect(relSection.getByLabel('关系类型')).toBeVisible();

  // 4. 输入含非法函数 alert(1) 的表达式，验证白名单拒绝且不写入文档
  const txtId = await canvas.locator('[data-node-type="text"]').first().getAttribute('data-node-id');
  const vecId = await canvas.locator('[data-vector-node]').first().getAttribute('data-vector-node');
  expect(txtId).toBeTruthy();
  expect(vecId).toBeTruthy();

  await relSection.getByLabel('关系类型').selectOption('expr');
  await relSection.getByLabel('关系目标对象').selectOption(txtId!);
  await relSection.getByLabel('关系目标属性').selectOption('text');
  await relSection.getByLabel('关系计算表达式').fill('alert(1)');
  await relSection.getByRole('button', { name: '添加关系' }).click();
  await expect(relSection.getByRole('alert')).toContainText('未知函数 alert');
  await expect(relSection.locator('[data-relation-id]')).toHaveCount(0);

  // 5. 改为合法表达式：文本框实时显示箭头长度，验证关系生效且状态正常
  await relSection.getByLabel('关系计算表达式').fill(`round(${vecId}.length)`);
  await relSection.getByLabel('文字格式模板').fill('长度：{value}');
  await relSection.getByRole('button', { name: '添加关系' }).click();
  await expect(relSection.locator('[data-relation-id]')).toHaveCount(1);
  await expect(relSection.locator('[data-relation-status="ok"]')).toContainText('联动正常');
  await expect(canvas).toContainText(/长度：\d+/);

  // 6. 原子撤销移除整条关系，重做恢复
  await editor.getByRole('button', { name: '撤销编辑' }).click();
  await expect(relSection.locator('[data-relation-id]')).toHaveCount(0);
  await expect(canvas).not.toContainText(/长度：\d+/);
  await editor.getByRole('button', { name: '重做编辑' }).click();
  await expect(relSection.locator('[data-relation-id]')).toHaveCount(1);
  await expect(canvas).toContainText(/长度：\d+/);

  // 7. 自动保存落库
  await expect(editor.getByText('已保存到服务端', { exact: true })).toBeVisible({ timeout: 30_000 });
});
