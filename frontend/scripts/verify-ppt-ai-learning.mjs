/**
 * 服务端受信浏览器验证：打开本轮导出的离线 HTML，验证学习入口、来源、场景与手机布局。
 *
 * 用法：node scripts/verify-ppt-ai-learning.mjs '<json-args>'
 * 服务端只读取本脚本产出的证据；前端自报的 browser.status=passed 不进入这里。
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const raw = process.argv[2];
if (!raw) {
  console.error('缺少验证参数');
  process.exit(2);
}
const args = JSON.parse(raw);
const results = [];
// 优先使用系统 Chrome（项目部署允许自带兼容浏览器）；缺少时再回退到 Playwright 自带内核。
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  .catch(() => chromium.launch({ headless: true }));

for (const viewport of [
  { name: 'desktop', width: 1600, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  try {
    await page.goto(`file://${args.htmlPath.replace(/\\/g, '/')}`);
    await page.waitForSelector('button', { timeout: 20_000 });
    const thumbnail = page.locator(`button[aria-label^="第 ${args.pageNo} 页"]`).first();
    if (await thumbnail.count()) await thumbnail.first().evaluate((element) => element.click());
    const entry = page.getByRole('button', { name: '本页学习' });
    if (!(await entry.count())) {
      results.push({ ...viewport, status: 'failed', reason: '缺少本页学习入口', errors });
      await context.close();
      continue;
    }
    await entry.first().click();
    const panel = page.locator('aside[aria-label="本页学习"]');
    await panel.waitFor({ state: 'visible', timeout: 15_000 });
    await panel.getByRole('button', { name: '动手试试' }).click();
    const text = await panel.innerText();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    const hasScene = /det\(A\)|Av|P⁻¹AP|共线|矩阵/.test(text);
    const leaked = /(bnd_|brn_|ain_|cpt_|session_id|recipe_id|provider)/i.test(text);
    const askDisabled = await panel.getByRole('button', { name: '问一个问题' }).isDisabled();
    const saveHidden = (await panel.getByRole('button', { name: '保存这次探索' }).count()) === 0;
    const passed = overflow <= 1 && hasScene && !leaked && errors.length === 0 && askDisabled && saveHidden;
    results.push({
      ...viewport,
      status: passed ? 'passed' : 'failed',
      overflow,
      hasScene,
      leaked,
      askDisabled,
      saveHidden,
      errors,
    });
  } catch (error) {
    results.push({ ...viewport, status: 'failed', reason: String(error), errors });
  } finally {
    await context.close();
  }
}

await browser.close();
const status = results.length === 2 && results.every((item) => item.status === 'passed') ? 'passed' : 'failed';
fs.writeFileSync(
  args.outPath,
  JSON.stringify({
    status,
    server_verified: status === 'passed',
    viewport: '1600x1000,390x844',
    checked_at: new Date().toISOString(),
    runtime_version: args.runtimeVersion,
    snapshot_hash: args.snapshotHash,
    script_version: 'ppt-learning.browser.1',
    results,
  }),
  'utf-8',
);
process.exit(status === 'passed' ? 0 : 1);
