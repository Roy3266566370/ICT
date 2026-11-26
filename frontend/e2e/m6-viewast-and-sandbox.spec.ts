import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CAPTURE_DIR = resolve('..', 'verify', 'm6-2026-11-23');

test('M6 活页 L3 演示框新 ViewAST 原语、drag-handle 画布拖动与断网离线 HTML 端到端验收', async ({ page, browser }) => {
  test.setTimeout(180_000);
  mkdirSync(CAPTURE_DIR, { recursive: true });

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

  // 2. 拦截 ai-page-lab 返回包含 arrow / polygon / formula / drag-handle 的 M6 演示程序
  const demoProgram =
    "function render(input){" +
    "var k=0.6+0.4*input.t,x=160+input.bx*70,y=300-input.by*50;" +
    "return {version:'ppt-ai.view.1',width:720,height:420," +
    "interactions:[{type:'drag-handle',id:'h_b2',label:'拖动 b2',x:x,y:y,xParam:'bx',yParam:'by'," +
    "bounds:{xMin:160,xMax:440,yMin:100,yMax:300},valueRange:{x:[0,4],y:[0,4]}}]," +
    "nodes:[" +
    "{id:'poly',type:'polygon',points:[[160,300],[160+140*k,300],[x+140*k,y],[x,y]],style:{fill:'#3b82f6',stroke:'#1d4ed8',strokeWidth:1.5,opacity:0.2}}," +
    "{id:'vec',type:'arrow',x1:160,y1:300,x2:x,y2:y,label:'b2',style:{stroke:'#c4622d',strokeWidth:3}}," +
    "{id:'eq',type:'formula',x:440,y:76,tex:'\\\\vec{b}_2=('+input.bx.toFixed(1)+','+input.by.toFixed(1)+')',style:{fill:'#0f172a',fontSize:16}}" +
    "]};}";

  await page.route(`**/api/v1/materials/${materialId}/pages/1/ai-lab**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        request_id: 'req_m6_demo',
        data: {
          lab: {
            version: 'ppt-ai.page-lab.3',
            page_no: 1,
            title: 'M6 交互演示',
            summary: '直接拖动 b2 手柄实时联动公式与平行四边形',
            explain: ['拖动橙色手柄改变 b2 分量'],
            params: [
              { id: 'bx', label: '横向 bx', min: 0, max: 4, step: 0.1, default: 1.5, unit: '' },
              { id: 'by', label: '纵向 by', min: 0, max: 4, step: 0.1, default: 2.0, unit: '' },
            ],
            public_params: ['bx', 'by'],
            timeline: {
              duration_s: 6,
              stops: [
                { t: 0, label: '起点' },
                { t: 1, label: '完成' },
              ],
            },
            program: demoProgram,
            content_hash: 'm6_demo_hash_001',
            generator: { model: 'test-vision', attempts: 1 },
            created_at: '2026-11-23T00:00:00Z',
          },
        },
      }),
    });
  });

  // 3. 在画布上拖出一个 AI 演示框并触发生成
  await editor.getByRole('button', { name: '＋ AI 演示框', exact: true }).click();
  const canvasBox = (await canvas.boundingBox())!;
  await page.mouse.move(canvasBox.x + 80, canvasBox.y + 80);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 480, canvasBox.y + 360, { steps: 6 });
  await page.mouse.up();

  await editor.getByRole('button', { name: 'AI 根据本页生成演示' }).first().click();
  await expect(editor.locator('[data-ast-formula="eq"]')).toBeVisible({ timeout: 30_000 });
  await expect(editor.locator('[data-ast-drag-handle="h_b2"]')).toBeVisible();

  // 4. 保存并返回放映态，验证公式节点与 drag-handle 画布拖动实时改参
  await expect(editor.getByText('已保存到服务端', {exact: true})).toBeVisible();
  await page.getByRole('button', { name: '互动预览' }).click();
  await expect(page).toHaveURL(/\/work/, { timeout: 60_000 });

  const slide = page.getByLabel('幻灯片第 1 页', { exact: true });
  const formula = slide.locator('[data-ast-formula="eq"]');
  const handle = slide.locator('[data-ast-drag-handle="h_b2"]');
  await expect(formula).toBeVisible({ timeout: 30_000 });
  await expect(handle).toBeVisible();
  const beforeFormula = await formula.textContent();

  const hBox = (await handle.boundingBox())!;
  await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(hBox.x + hBox.width / 2 + 70, hBox.y + hBox.height / 2 - 30, { steps: 6 });
  await page.mouse.up();

  await expect.poll(async () => await formula.textContent()).not.toBe(beforeFormula);
  await page.screenshot({ path: join(CAPTURE_DIR, 'm6-01-online-drag-handle.png') });

  // 5. 导出离线单文件 HTML，在严格断网（file://）环境下验证公式与 drag-handle 依然可用
  const offlineHtmlPath = join(CAPTURE_DIR, 'm6-exported-offline.html');
  await page.locator('summary[aria-label="导出与分享"]').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '下载离线交互网页' }).click(),
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
  const offlineFormula = offlineSlide.locator('[data-ast-formula="eq"]');
  const offlineHandle = offlineSlide.locator('[data-ast-drag-handle="h_b2"]');
  await expect(offlineFormula).toBeVisible({ timeout: 30_000 });
  await expect(offlineHandle).toBeVisible();
  const offlineBefore = await offlineFormula.textContent();

  const ohBox = (await offlineHandle.boundingBox())!;
  await offlinePage.mouse.move(ohBox.x + ohBox.width / 2, ohBox.y + ohBox.height / 2);
  await offlinePage.mouse.down();
  await offlinePage.mouse.move(ohBox.x + ohBox.width / 2 + 70, ohBox.y + ohBox.height / 2 - 30, { steps: 6 });
  await offlinePage.mouse.up();

  await expect.poll(async () => await offlineFormula.textContent()).not.toBe(offlineBefore);
  await offlinePage.screenshot({ path: join(CAPTURE_DIR, 'm6-02-offline-drag-handle.png') });
  await offlineContext.close();
});
