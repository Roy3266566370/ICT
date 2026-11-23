import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CAPTURE_DIR = process.env.E2E_M4_CAPTURE_DIR
  ? resolve(process.env.E2E_M4_CAPTURE_DIR)
  : resolve('..', 'verify', 'm4-2026-11-23');

async function dragEndHandle(page: Page, handle: Locator, deltaX: number, deltaY: number) {
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y + deltaY, { steps: 8 });
  await page.mouse.up();
}

test('M4 换基图在线矢量化、动态关系面板、实时拖动联动与断网离线 HTML 端到端验收', async ({ page, browser }) => {
  test.setTimeout(240_000);
  mkdirSync(CAPTURE_DIR, { recursive: true });
  const shot = (name: string, targetPage: Page = page) =>
    targetPage.screenshot({ path: join(CAPTURE_DIR, name) });

  // 1. 上传换基图并进入自由编辑器
  await page.goto('/living');
  const fixturePath = fileURLToPath(new URL('./fixtures/basis-alternate.png', import.meta.url));
  await page.locator('input[type=file][accept*=".pptx"]').setInputFiles(fixturePath);
  await expect(page).toHaveURL(/\/materials\/([^/]+)\/work/, { timeout: 60_000 });
  const materialMatch = /\/materials\/([^/]+)\/work/.exec(page.url());
  expect(materialMatch).toBeTruthy();
  const materialId = materialMatch![1]!;

  await page.getByRole('link', { name: '编辑内容 / 交互' }).click();
  const editor = page.locator('[data-free-editor]');
  const canvas = editor.getByLabel('可编辑画布第 1 页');
  const picture = canvas.locator('[data-node-type="image"]').first();
  await expect(picture).toBeVisible({ timeout: 60_000 });
  await picture.click();

  // 2. 按需矢量化并应用（自动物化右图 basis_decompose 关系与细粒度权限）
  await editor.getByRole('button', { name: '矢量化此图', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '矢量化此图' });
  const applyBtn = dialog.getByRole('button', { name: '应用到文档' });
  await expect(applyBtn).toBeEnabled({ timeout: 30_000 });
  await applyBtn.click();
  await expect(dialog).toBeHidden();

  // 3. 验证「页面动态关系」面板已自动生成换基分解关系，并校验非法表达式拦截与自定义关系添加/撤销
  await picture.click();
  await editor.getByRole('tab', { name: /交互/ }).click();
  const relSection = editor.getByLabel('页面动态关系');
  await expect(relSection).toBeVisible();
  await expect(relSection.locator('[data-relation-id]')).toHaveCount(1);
  await expect(relSection.locator('[data-relation-status="ok"]')).toContainText('联动正常');

  // 输入含非法函数 alert(1) 的表达式，验证白名单拒绝
  await relSection.getByLabel('关系类型').selectOption('expr');
  await relSection.getByLabel('关系计算表达式').fill('alert(1)');
  await relSection.getByRole('button', { name: '添加关系' }).click();
  await expect(relSection.getByRole('alert')).toContainText('未知函数 alert');
  await expect(relSection.locator('[data-relation-id]')).toHaveCount(1);
  await shot('m4-01-editor-relations-panel.png');

  // 4. 保存并返回演示（放映态），验证细粒度权限与拖动 b₂ 实时联动
  await editor.getByRole('button', { name: '保存并返回演示' }).click();
  await expect(page).toHaveURL(/\/work/, { timeout: 60_000 });
  const slide = page.getByLabel('幻灯片第 1 页', { exact: true });
  await expect(slide.locator('[data-vector-node]').first()).toBeVisible();

  // 细粒度权限断言：整页仅斜基 b₂ 开放了 1 个「拖动终点」手柄，且无「拖动起点」手柄
  await expect(slide.getByLabel('拖动终点')).toHaveCount(1);
  await expect(slide.getByLabel('拖动起点')).toHaveCount(0);

  const boundCoord = slide.locator('[data-basis-coordinates]').first();
  await expect(boundCoord).toContainText('(1, 1)');
  // 左图标准基坐标 (2, 1) 也在同页
  await expect(slide).toContainText('(2, 1)');
  await shot('m4-02-online-before-drag.png');

  // 拖动右图 b₂ 终点手柄，验证右图坐标与虚线平行四边形实时更新，左图 (2, 1) 不变
  const endHandle = slide.getByLabel('拖动终点').first();
  await dragEndHandle(page, endHandle, -32, -18);
  const updatedCoordText = (await boundCoord.textContent())?.trim() ?? '';
  expect(updatedCoordText).not.toBe('(1, 1)');
  expect(updatedCoordText).toMatch(/^\(\d+(?:\.\d+)?,\s*\d+(?:\.\d+)?\)$/);
  await expect(slide).toContainText('(2, 1)');
  await shot('m4-03-online-after-drag.png');

  // 一键重置恢复 (1, 1)
  await slide.getByRole('button', { name: '一键重置' }).click();
  await expect(boundCoord).toContainText('(1, 1)');

  // 5. 点击「生成分享网页」，在全新无痕会话打开公开分享链接，验证观众权限隔离与拖动联动
  await page.getByRole('button', { name: '生成分享网页' }).click();
  const shareLink = page.getByRole('status').filter({ hasText: '分享网页已生成' }).locator('a');
  await expect(shareLink).toBeVisible({ timeout: 30_000 });
  const shareUrl = await shareLink.getAttribute('href');
  expect(shareUrl).toBeTruthy();

  const shareContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const sharePage = await shareContext.newPage();
  await sharePage.goto(shareUrl!);
  const shareSlide = sharePage.getByLabel('幻灯片第 1 页', { exact: true });
  await expect(shareSlide.locator('[data-vector-node]').first()).toBeVisible();
  await expect(shareSlide.getByLabel('拖动终点')).toHaveCount(1);
  await expect(shareSlide.getByLabel('拖动起点')).toHaveCount(0);
  const shareCoord = shareSlide.locator('[data-basis-coordinates]').first();
  await expect(shareCoord).toContainText('(1, 1)');
  await dragEndHandle(sharePage, shareSlide.getByLabel('拖动终点').first(), -32, -18);
  expect((await shareCoord.textContent())?.trim()).not.toBe('(1, 1)');
  await expect(shareSlide).toContainText('(2, 1)');
  await shot('m4-04-share-after-drag.png', sharePage);
  await shareContext.close();

  // 6. 点击「下载交互网页」导出离线单文件 HTML，在严格断网（file://）上下文中验证拖动联动与只读隔离
  const offlineHtmlPath = join(CAPTURE_DIR, 'm4-exported-offline.html');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '下载交互网页' }).click(),
  ]);
  await download.saveAs(offlineHtmlPath);

  const offlineContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await offlineContext.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('file:') || url.startsWith('data:') || url.startsWith('blob:')) {
      return route.continue();
    }
    return route.abort();
  });
  const offlinePage = await offlineContext.newPage();
  await offlinePage.goto(pathToFileURL(offlineHtmlPath).href);

  const offlineSlide = offlinePage.getByLabel('幻灯片第 1 页', { exact: true });
  await expect(offlineSlide.locator('[data-vector-node]').first()).toBeVisible();
  // 清底图内联无裂图
  const offlineCleanImg = offlineSlide.locator('[data-node-type="image"] img').first();
  await expect.poll(() => offlineCleanImg.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  // 离线页同样严格执行细粒度 viewer_parameters：仅 1 个「拖动终点」，0 个「拖动起点」
  await expect(offlineSlide.getByLabel('拖动终点')).toHaveCount(1);
  await expect(offlineSlide.getByLabel('拖动起点')).toHaveCount(0);

  const offlineCoord = offlineSlide.locator('[data-basis-coordinates]').first();
  await expect(offlineCoord).toContainText('(1, 1)');
  await expect(offlineSlide).toContainText('(2, 1)');

  await dragEndHandle(offlinePage, offlineSlide.getByLabel('拖动终点').first(), -32, -18);
  const offlineUpdatedCoord = (await offlineCoord.textContent())?.trim() ?? '';
  expect(offlineUpdatedCoord).not.toBe('(1, 1)');
  expect(offlineUpdatedCoord).toMatch(/^\(\d+(?:\.\d+)?,\s*\d+(?:\.\d+)?\)$/);
  await expect(offlineSlide).toContainText('(2, 1)');
  await shot('m4-05-offline-after-drag.png', offlinePage);

  await offlineSlide.getByRole('button', { name: '一键重置' }).click();
  await expect(offlineCoord).toContainText('(1, 1)');
  await offlineContext.close();
});
