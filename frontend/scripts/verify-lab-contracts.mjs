import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = process.argv[2];
const output = process.argv[3];
if (!backend || !output) throw new Error('Usage: node verify-lab-contracts.mjs BACKEND_URL OUTPUT_DIR');
await fs.mkdir(output, { recursive: true });
const server = await createServer({
  root, server: { host: '127.0.0.1', port: 4175, strictPort: true,
    proxy: { '/api': { target: backend, changeOrigin: true } } },
});
let browser;
const errors = [];
const cases = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' })
    .catch(() => chromium.launch({ headless: true }));
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(String(error)));
  const guestEndpoints = new Set(['/api/v1/me', '/api/v1/sessions/current']);
  page.on('console', message => {
    const location = message.location().url;
    const expectedGuest = message.text().includes('401 (Unauthorized)') && location
      && guestEndpoints.has(new URL(location).pathname);
    if (message.type() === 'error' && !expectedGuest) errors.push(message.text());
  });
  page.on('response', response => {
    const expectedGuest = response.status() === 401 && guestEndpoints.has(new URL(response.url()).pathname);
    if (response.status() >= 400 && !expectedGuest) errors.push(`${response.status()} ${response.url()}`);
  });
  const waitPost = suffix => page.waitForResponse(response =>
    response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(suffix), { timeout: 120000 });
  async function create(text) {
    await page.goto('http://127.0.0.1:4175/labs');
    await page.getByRole('button', { name: '上传原题 / 粘贴题干', exact: true }).click();
    await page.getByRole('tab', { name: '粘贴题目文字' }).click();
    await page.getByPlaceholder('粘贴完整题干。', { exact: false }).fill(text);
    const responsePromise = waitPost('/labs/text');
    await page.getByRole('button', { name: '识别文字并建模', exact: false }).click();
    const response = await responsePromise;
    assert.equal(response.status(), 201);
    const data = (await response.json()).data;
    await page.waitForURL(`**/labs/${data.lab_id}`);
    return data;
  }
  async function upload(name) {
    await page.goto('http://127.0.0.1:4175/labs');
    await page.getByRole('button', { name: '上传原题 / 粘贴题干', exact: true }).click();
    await page.locator('input[type=file]').setInputFiles(path.resolve(root, '../tmp/408test', name));
    const responsePromise = waitPost('/labs');
    await page.getByRole('button', { name: '开始识别并建模', exact: false }).click();
    const response = await responsePromise;
    assert.equal(response.status(), 201);
    const data = (await response.json()).data;
    await page.waitForURL(`**/labs/${data.lab_id}`);
    return data;
  }
  async function confirm() {
    await page.getByRole('button', { name: '核对条件并求解', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '核对与修正条件' });
    await dialog.getByRole('radio', { name: '已对照原图核对并修正全部公式' }).check();
    const responsePromise = waitPost('/review');
    await dialog.getByRole('button', { name: '确认并重新求解' }).click();
    const response = await responsePromise;
    assert.equal(response.status(), 200);
    await dialog.waitFor({ state: 'hidden' });
    return (await response.json()).data;
  }
  async function eigenVisible() {
    await page.getByRole('table', { name: '原矩阵 A', exact: true }).waitFor();
    await page.getByLabel('特征值求解步骤').waitFor();
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    assert.match(await page.getByRole('region', { name: '执行轨迹控制' }).innerText(), /特征多项式/);
  }
  try {
    let doc = await create('求矩阵A=[[2,1],[1,2]]的特征值和特征向量。');
    assert.equal(doc.problems[0].status, 'ready');
    assert.match(doc.problems[0].solution.answer, /λ=1/);
    assert.match(doc.problems[0].solution.answer, /λ=3/);
    await eigenVisible();
    await page.screenshot({ path: path.join(output, 'eigen.png'), fullPage: true });
    cases.push('eigen_exact_and_timeline');

    doc = await create('求矩阵A=[[1/3,0],[0,0.5]]的特征值。');
    assert.equal(doc.problems[0].status, 'ready');
    await page.getByRole('table', { name: '原矩阵 A', exact: true }).waitFor();
    assert.match(await page.getByRole('table', { name: '原矩阵 A', exact: true }).innerText(), /1\/3/);
    cases.push('rational_matrix_display');

    doc = await create('求矩阵A=[[0,-1],[1,0]]的特征值与特征向量。');
    assert.match(doc.problems[0].solution.answer, /λ=-I/);
    await eigenVisible();
    cases.push('complex_eigen');

    doc = await create('将矩阵A=[[2,1],[1,2]]对角化，求变换矩阵。');
    assert.notEqual(doc.problems[0].status, 'ready');
    assert.equal(doc.problems[0].solution.answer, '');
    assert.equal(await page.getByLabel('特征值求解步骤').count(), 0);
    cases.push('unsupported_diagonalization_blocks');

    doc = await upload('m7m_eig.png');
    assert.equal(doc.problems[0].status, 'needs_review');
    assert.equal(doc.problems[0].solution.answer, '');
    doc = await confirm();
    assert.equal(doc.problems[0].status, 'ready');
    await eigenVisible();
    cases.push('eigen_image_confirmation');

    doc = await upload('m7d_inv.png');
    assert.equal(doc.problems[0].solution.answer, '');
    doc = await confirm();
    assert.equal(doc.problems[0].status, 'ready');
    assert.match(doc.problems[0].solution.answer, /A/);
    await page.getByRole('region', { name: '执行轨迹控制' }).waitFor();
    cases.push('inverse_image_regression');

    doc = await upload('m5m_mul.png');
    assert.equal(doc.problems.length, 2);
    assert.ok(doc.problems.every(problem => problem.status === 'needs_review' && !problem.solution.answer));
    doc = await confirm();
    assert.equal(doc.problems[0].status, 'ready');
    assert.equal(doc.problems[1].status, 'needs_review');
    await page.getByLabel('题目列表').selectOption(doc.problems[1].problem_id);
    doc = await confirm();
    assert.equal(doc.problems[1].status, 'ready');
    assert.ok(doc.problems[1].solution.answer.includes('f(-1)=2'));
    assert.ok(doc.problems[1].solution.answer.includes('f(1)=-2'));
    await page.screenshot({ path: path.join(output, 'subquestions.png'), fullPage: true });
    cases.push('subquestions_separate_confirmation');
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
    await fs.writeFile(path.join(output, 'failure.txt'), await page.locator('body').innerText());
    throw error;
  }
} finally {
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ cases, errors }, null, 2));
  await browser?.close();
  await server.close();
}
console.log(JSON.stringify({ status: 'passed', cases, errors }));
