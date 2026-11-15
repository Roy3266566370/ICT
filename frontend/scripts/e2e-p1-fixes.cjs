/* 2026-11-15 五项残留问题修复的浏览器端到端验证（独立环境 5188/8018，legacy 确定性模式）。
 * 覆盖：P1-1 两条曲线面积忠实求解；P1-2 同类小问不遗漏；P2-5 删除当前分问后状态重置与保存持久化；
 * 以及基线面积+体积回归。P1-3/P1-4 属于后端计划校验与执行层门禁，已由
 * backend/tests/test_orchestrator_p1_fixes.py 覆盖，浏览器阶段复核基线不回归。
 * 断言只作用于“当前答案列表”（面板第一个 ol），等待各阶段特征答案出现后再读取。 */
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:5188';
const OUT = 'E:/代码/ICT/verify/orchestration-fixes-20261115';
const results = [];
const consoleErrors = [];
const notAuthorized = [];

function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: String(detail || '') });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + String(detail).slice(0, 300) : ''}`);
}

async function shot(page, name) {
  try {
    await page.screenshot({ path: path.join(OUT, name), fullPage: false });
  } catch (e) { /* 截图失败不阻断断言 */ }
}

async function openComposite(page) {
  const panel = page.locator('[aria-label="完整题目与分问解答"]');
  const details = page.locator('[aria-label="完整题目与分问解答"] > details').first();
  const isOpen = await details.evaluate((el) => el.open).catch(() => false);
  if (!isOpen) await panel.locator('summary').first().click();
  return panel;
}

/* 等待“当前答案列表”（面板内第一个 ol）出现指定文本；整面板文本包含历史步骤状态，
 * 不能作为跨阶段等待依据。 */
async function waitForAnswer(page, needle, timeout = 150000) {
  try {
    await page.waitForFunction(
      (exp) => {
        const panel = document.querySelector('[aria-label="完整题目与分问解答"]');
        const ol = panel && panel.querySelector('ol');
        return !!(ol && ol.textContent && ol.textContent.includes(exp));
      },
      needle,
      { timeout },
    );
  } catch (err) {
    const current = await page.evaluate(() => {
      const panel = document.querySelector('[aria-label="完整题目与分问解答"]');
      const ol = panel && panel.querySelector('ol');
      return ol ? ol.textContent.slice(0, 300) : '(no answers ol)';
    }).catch(() => '(evaluate failed)');
    throw new Error(`等待答案「${needle}」超时；当前答案列表：${current}`);
  }
}

async function getAnswers(page) {
  const panel = page.locator('[aria-label="完整题目与分问解答"]');
  return panel.locator('ol').first().locator('li').allTextContents();
}

async function solveComposite(page, text) {
  const panel = await openComposite(page);
  const box = page.getByLabel('修改完整题目');
  await box.fill(text);
  await panel.getByRole('button', { name: '重新理解并求解' }).click();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(150000);
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push('console: ' + msg.text()); });
  page.on('response', (resp) => { if (resp.status() === 401) notAuthorized.push(resp.url()); });

  const evidence = {};
  try {
    // ---------- A. 基线：面积 + 体积，两个分问 ----------
    await page.goto(BASE + '/labs', { waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: '粘贴文字' }).click();
    await page.locator('label:has-text("题目原文") textarea').fill(
      '在0≤x≤2内，求曲线y=x²−x与x轴之间的面积，以及该区域绕x轴旋转所得旋转体的体积。');
    await page.getByRole('button', { name: '建立实验室' }).click();
    await page.waitForURL(/\/labs\/[A-Za-z0-9_-]+$/, { timeout: 180000 });
    await page.waitForFunction(() => {
      const panel = document.querySelector('[aria-label="完整题目与分问解答"]');
      const ol = panel && panel.querySelector('ol');
      return !!(ol && ol.children.length >= 2);
    }, null, { timeout: 180000 });
    let answers = await getAnswers(page);
    evidence.A = answers;
    await shot(page, '01-baseline-open-panel.png');
    record('A1 基线两分问都有解答（2 条答案）', answers.length === 2, JSON.stringify(answers));
    record('A2 面积分问答案恰为 1（几何面积，非有向积分 2/3）',
      answers.some((t) => /面积/.test(t) && /面积\s*=\s*1\.0+\s*$/.test(t.trim()))
        && !answers.some((t) => t.includes('2/3')),
      answers.find((t) => /面积/.test(t)) || '');
    record('A3 体积分问答案为 16π/15（含 pi，旋转体积口径）',
      answers.some((t) => /体积/.test(t) && /pi/.test(t) && /1\.0666/.test(t)),
      answers.find((t) => /体积/.test(t)) || '');

    // ---------- D. P2-5：删除当前分问后状态重置与保存持久化 ----------
    await openComposite(page);
    await page.getByLabel('题目列表').selectOption('prb_2');
    const nInput = page.getByLabel('分割数 数值');
    await nInput.fill('32');
    await page.waitForTimeout(400);
    record('D1 体积分问分割数已改为 32', (await nInput.inputValue()) === '32', '');
    await shot(page, '02-before-remove-volume.png');

    await solveComposite(page, '在0≤x≤3内，只求曲线y=x²−x与x轴之间的面积。');
    await waitForAnswer(page, '4.8333');
    answers = await getAnswers(page);
    evidence.D = answers;
    await shot(page, '03-after-revise-fresh.png');

    const listLoc = page.getByLabel('题目列表');
    const listCount = await listLoc.count();
    const optionCount = listCount ? await listLoc.locator('option').count() : 0;
    record('D2 旧分问已从题目列表移除（列表隐藏或只剩 1 项）',
      listCount === 0 || optionCount === 1, `select=${listCount} options=${optionCount}`);
    const nAfter = await page.getByLabel('分割数 数值').inputValue();
    record('D3 分问删除后参数回到新题默认 16（不再残留 32）', nAfter === '16', `n=${nAfter}`);
    const undoDisabled = await page.getByRole('button', { name: '撤销上一步参数' }).isDisabled();
    record('D4 旧分问的撤销历史已清空（撤销不可用）', undoDisabled, '');

    await page.getByLabel('分割数 数值').fill('24');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => !!document.querySelector('[data-status="saved"]'), null, { timeout: 30000 });
    await shot(page, '04-saved-n24.png');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const panel = document.querySelector('[aria-label="完整题目与分问解答"]');
      const ol = panel && panel.querySelector('ol');
      return !!(ol && ol.textContent && ol.textContent.includes('4.8333'));
    }, null, { timeout: 180000 });
    const nReload = await page.getByLabel('分割数 数值').inputValue();
    record('D5 刷新后 n=24 真实持久化（修复前刷新回 16）', nReload === '24', `n=${nReload}`);

    // ---------- B. P1-1：两条曲线之间的面积 ----------
    await solveComposite(page, '在0≤x≤1内，求曲线y=x²与直线y=1之间的面积。');
    await waitForAnswer(page, '2/3');
    answers = await getAnswers(page);
    evidence.B = answers;
    await shot(page, '05-two-curves-2over3.png');
    record('B1 两曲线面积返回 2/3', answers.some((t) => t.includes('2/3')), JSON.stringify(answers));
    record('B2 目标保留原题边界（含直线 y=1，不改写为与 x 轴）',
      answers.some((t) => t.includes('直线 y=1') && !t.includes('与 x 轴')), '');

    // ---------- C. P1-2：同类小问不遗漏 ----------
    await solveComposite(page, '在0≤x≤1内，求曲线y=x²与x轴之间的面积，再求曲线y=x与x轴之间的面积。');
    await waitForAnswer(page, '0.50000');
    answers = await getAnswers(page);
    evidence.C = answers;
    await shot(page, '06-two-area-questions.png');
    record('C1 两个同类面积小问都有解答（2 条答案）', answers.length === 2, JSON.stringify(answers));
    record('C2 第二问 1/2 未被遗漏（0.500…）', answers.some((t) => /面积.*0\.50000/.test(t)), '');
    record('C3 第一问 1/3 正确（0.333…）', answers.some((t) => /面积.*0\.3333/.test(t)), '');

    // ---------- 汇总 ----------
    record('E1 全程无 JavaScript 异常（pageerror）', consoleErrors.filter((e) => e.startsWith('pageerror')).length === 0,
      consoleErrors.filter((e) => e.startsWith('pageerror')).slice(0, 3).join(' || '));
  } catch (err) {
    record('F0 流程未完成（异常中断）', false, String(err).slice(0, 400));
    await shot(page, '99-failure.png').catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }

  const lines = [];
  lines.push('五项残留问题修复 · 浏览器端到端验证（独立环境 5188/8018，legacy 确定性模式）');
  lines.push('日期：2026-11-15');
  lines.push('');
  lines.push(`结果：${results.filter(r => r.ok).length}/${results.length} 项通过`);
  lines.push('');
  for (const r of results) lines.push(`${r.ok ? '通过' : '未通过'} | ${r.name}${r.detail ? ' | ' + r.detail : ''}`);
  lines.push('');
  for (const k of Object.keys(evidence)) lines.push(`阶段 ${k} 当前答案列表：${JSON.stringify(evidence[k])}`);
  lines.push('');
  lines.push('说明：P1-3 重规划义务门与 P1-4 零点完整性伪造由后端专项测试覆盖；');
  lines.push('本浏览器阶段同时复核了基线面积+体积组合不回归。');
  lines.push('JavaScript 异常：' + (consoleErrors.filter((e) => e.startsWith('pageerror')).join(' || ') || '无'));
  lines.push('未登录访客下的 401 观察项（非修复引入，列表仅记录）：' +
    (Array.from(new Set(notAuthorized)).slice(0, 5).join(' , ') || '无'));
  fs.writeFileSync(path.join(OUT, 'report.txt'), lines.join('\n'), 'utf8');
  const failed = results.filter(r => !r.ok).length;
  console.log(`SUMMARY: ${results.filter(r => r.ok).length}/${results.length} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
