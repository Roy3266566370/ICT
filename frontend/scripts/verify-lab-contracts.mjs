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
  function repairChoices(problem) {
    const originals = { T: 'π', 胃: 'θ', 蟺: 'π', E: '∈', '{': '∫' };
    return Object.fromEntries(problem.recognition.ambiguities.filter(item => item.repair).map(item => {
      const replacement = originals[item.repair.original];
      assert.ok(replacement, `No visually verified replacement for ${item.repair.original}`);
      const option = item.options.find(candidate => candidate.replacement === replacement);
      assert.ok(option, `Missing candidate for ${item.repair.original}`);
      return [item.id, option.value];
    }));
  }
  async function confirm(correctedText, choices = {}, confirmSource = true) {
    await page.getByRole('button', { name: '核对条件并求解', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '核对与修正条件' });
    assert.equal(await dialog.locator('input[name^="ambiguity-source_repair_"]:checked').count(), 0);
    if (correctedText !== undefined) await dialog.getByLabel('题目文字', { exact: true }).fill(correctedText);
    for (const [id, value] of Object.entries(choices)) {
      await dialog.locator(`input[name="ambiguity-${id}"][value="${value}"]`).check();
    }
    if (Object.values(choices).some(value => value.startsWith('replace:'))) {
      await dialog.getByLabel('候选修正后的题目预览', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, 'source-repair-preview.png'), fullPage: true });
    }
    if (confirmSource) await dialog.getByRole('radio', { name: '已对照原图核对并修正全部公式' }).check();
    const [response] = await Promise.all([
      waitPost('/review'),
      dialog.getByRole('button', { name: '确认并重新求解' }).click(),
    ]);
    assert.equal(response.status(), 200);
    assert.deepEqual(response.request().postDataJSON().condition_values, {});
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

    doc = await create('求行列式|12;34|的值。');
    assert.equal(doc.problems[0].status, 'needs_review');
    assert.equal(doc.problems[0].solution.answer, '');
    assert.ok(doc.problems[0].recognition.ambiguities.some(item => item.id === 'matrix_layout_ambiguity'));
    cases.push('joined_determinant_text_blocks');
    doc = await create('求行列式|1 2;3 4|的值。');
    assert.equal(doc.problems[0].status, 'ready');
    assert.equal(doc.problems[0].solution.answer_value, -2);
    await page.getByRole('region', { name: '执行轨迹控制' }).waitFor();
    cases.push('separated_determinant_text_solves');

    for (const [label, notation] of [['compact', 'x3'], ['superscript', 'x³']]) {
      for (const optimization of [false, true]) {
        doc = await create(optimization
          ? `使用梯度下降法求 f(x)=${notation}-3*x 的极小值，初始点 x0=2，学习率 0.1。`
          : `求函数 f(x)=${notation}-3*x 的极值。`);
        assert.equal(doc.problems[0].status, 'ready');
        assert.equal(doc.problems[0].subject, optimization ? 'optimization' : 'calculus');
        assert.match(doc.problems[0].solution.answer, optimization ? /极小值点 x=1，f=-2/ : /极小值 f\(1\)=-2/);
        assert.doesNotMatch(doc.problems[0].model.expression, /x3|³/);
        await page.getByRole('region', { name: '执行轨迹控制' }).waitFor();
        await page.screenshot({ path: path.join(output, `power-${optimization ? 'optimization' : 'analysis'}.png`), fullPage: true });
        cases.push(`${label}_power_${optimization ? 'optimization' : 'analysis'}`);
      }
    }
    const eighthRound = [
      ['m8a_fx2.png', p => {
        assert.equal(p.solution.fourier.a0, '2*pi**2/3');
        assert.equal(p.solution.fourier.coefficients[0].an, '-4');
      }],
      ['m8b_fx.png', p => {
        assert.equal(p.solution.fourier.a0, '0');
        assert.equal(p.solution.fourier.coefficients[0].bn, '2');
      }],
      ['m8c_fabs.png', p => {
        assert.equal(p.solution.fourier.a0, 'pi');
        assert.equal(p.solution.fourier.coefficients[0].an, '-4/pi');
      }],
      ['m8d_pd.png', p => assert.equal(p.solution.parametric_details.slope_value, '1')],
      ['m8e_pd2.png', p => assert.equal(p.solution.parametric_details.second_value, '3/4')],
      ['m8f_pa.png', null],
      ['m8g_parc.png', null],
      ['m8h_card.png', p => assert.match(p.solution.answer, /3\*pi\/2/)],
      ['m8i_rose.png', p => assert.match(p.solution.answer, /pi\/12/)],
      ['m8j_impp.png', p => assert.equal(p.solution.answer, '1')],
      ['m8k_impd.png', p => assert.equal(p.solution.answer, '2')],
      ['m8l_pdis.png', null],
      ['m8m_invd.png', p => assert.equal(Number(p.solution.answer_value), 0.25)],
    ];
    const round8Failures = [];
    for (const [name, check] of eighthRound) {
      try {
        doc = await upload(name);
        const original = doc.problems[0];
        assert.equal(doc.problems.length, 1);
        assert.notEqual(original.status, 'ready');
        assert.equal(original.solution.answer, '');
        await fs.writeFile(path.join(output, `${name}.before.json`), JSON.stringify(doc, null, 2));
        if (name === 'm8l_pdis.png') {
          await page.getByRole('button', { name: '核对条件并求解', exact: true }).click();
          const dialog = page.getByRole('dialog', { name: '核对与修正条件' });
          const condition = original.recognition.conditions.find(item => item.id === 'expression');
          const field = dialog.getByRole('textbox', { name: condition.label, exact: true });
          assert.equal(await field.inputValue(), condition.value);
          await field.fill('x+');
          assert.equal(await dialog.getByRole('button', { name: '确认并重新求解' }).isDisabled(), true);
          await page.screenshot({ path: path.join(output, 'invalid-edited-expression.png'), fullPage: true });
          await field.fill(condition.value);
          assert.equal(await dialog.getByRole('button', { name: '确认并重新求解' }).isEnabled(), true);
          await dialog.getByRole('button', { name: '关闭', exact: true }).click();
          cases.push('round8_invalid_edited_expression_blocks_submission');
        }
        if (name === 'm8c_fabs.png' && !/\|\s*x\s*\||abs\s*\(/.test(original.text)) {
          const correctedText = original.text.replace(/(f\s*\(\s*x\s*\)\s*=\s*)x/, '$1|x|');
          assert.notEqual(correctedText, original.text);
          doc = await confirm(correctedText);
          cases.push('round8_abs_bars_corrected_against_image');
        } else {
          doc = await confirm();
        }
        if (name === 'm8b_fx.png' && /\bT\b/.test(original.text)) {
          assert.notEqual(doc.problems[0].status, 'ready');
          assert.equal(doc.problems[0].solution.answer, '');
          doc = await confirm(original.text.replace(/[（(]\s*-π\s*,\s*T\s*[）)]/, '[-π,π]').replace(/\bT\b/g, 'π'));
          cases.push('round8_fourier_interval_requires_text_correction');
        }
        if (check && doc.problems[0].recognition.ambiguities.some(item => item.repair)) {
          assert.notEqual(doc.problems[0].status, 'ready');
          assert.equal(doc.problems[0].solution.answer, '');
          doc = await confirm(undefined, repairChoices(doc.problems[0]));
          assert.ok(doc.problems[0].recognition.source_repair_history.length);
          cases.push(`${name}_human_selected_local_correction`);
        }
        const reviewed = doc.problems[0];
        await fs.writeFile(path.join(output, `${name}.after.json`), JSON.stringify(doc, null, 2));
        assert.equal(reviewed.model.teaching, false);
        if (check) {
          assert.equal(reviewed.status, 'ready', `${name}: ${JSON.stringify(reviewed.recognition.ambiguities)}`);
          check(reviewed);
          await page.getByRole('region', { name: '执行轨迹控制' }).waitFor();
        } else {
          assert.notEqual(reviewed.status, 'ready', name);
          assert.equal(reviewed.solution.answer, '', name);
          assert.ok(reviewed.recognition.ambiguities.some(a => a.severity === 'blocking' && !a.resolved));
        }
        const saved = await page.request.get(`http://127.0.0.1:4175/api/v1/labs/${doc.lab_id}`);
        assert.equal(saved.status(), 200);
        assert.deepEqual((await saved.json()).data.problems[0].solution, reviewed.solution);
        await page.screenshot({ path: path.join(output, `${name}.reviewed.png`), fullPage: true });
        cases.push(`round8_${name}_${check ? 'confirmed_exact_answer' : 'confirmed_still_blocked'}`);
      } catch (error) {
        round8Failures.push({ name, error: String(error) });
        await page.screenshot({ path: path.join(output, `${name}.failure.png`), fullPage: true });
      }
    }
    await fs.writeFile(path.join(output, 'round8-failures.json'), JSON.stringify(round8Failures, null, 2));
    assert.deepEqual(round8Failures, []);
    doc = await upload('m8i_rose.png');
    const originalOcr = doc.problems[0].source_pages[0].ocr_text;
    const driftText = '求极坐标曲线 r=cos3胃 在 胃E[-T/6,蟺/6] 上围成的一瓣面积。';
    doc = await confirm(driftText);
    assert.notEqual(doc.problems[0].status, 'ready');
    assert.equal(doc.problems[0].solution.answer, '');
    const parameter = doc.problems[0].recognition.ambiguities.find(item => item.repair?.original === 'T');
    assert.ok(parameter);
    await page.getByRole('button', { name: '核对条件并求解', exact: true }).click();
    const repairDialog = page.getByRole('dialog', { name: '核对与修正条件' });
    const parameterRadio = repairDialog.locator(`input[name="ambiguity-${parameter.id}"][value="replace:0"]`);
    await parameterRadio.check();
    await repairDialog.getByLabel('题目文字', { exact: true }).fill(`${driftText}请核对原图。`);
    assert.equal(await repairDialog.locator('input[name^="ambiguity-source_repair_"]:checked').count(), 0);
    assert.equal(await parameterRadio.isDisabled(), true);
    await repairDialog.getByRole('button', { name: '关闭', exact: true }).click();
    cases.push('manual_text_edit_invalidates_old_proposal_selection');
    doc = await confirm(undefined, { [parameter.id]: 'keep' });
    assert.equal(doc.problems[0].text, driftText);
    assert.equal(doc.problems[0].solution.answer, '');
    assert.equal(doc.problems[0].recognition.source_repair_history.at(-1).decisions[0].action, 'keep');
    const repairs = doc.problems[0].recognition.ambiguities.filter(item => item.repair);
    const rightEndpoint = repairs.find(item => item.repair.original === '蟺');
    assert.ok(rightEndpoint);
    const partialChoices = repairChoices(doc.problems[0]);
    delete partialChoices[rightEndpoint.id];
    doc = await confirm(undefined, partialChoices);
    assert.match(doc.problems[0].text, /蟺/);
    assert.equal(doc.problems[0].solution.answer, '');
    assert.ok(doc.problems[0].recognition.ambiguities.some(item => item.repair?.original === '蟺'));
    doc = await confirm(undefined, repairChoices(doc.problems[0]), false);
    assert.equal(doc.problems[0].solution.answer, '');
    assert.ok(doc.problems[0].recognition.ambiguities.some(item => item.id === 'source_formula_confirmation' && !item.resolved));
    doc = await confirm();
    assert.equal(doc.problems[0].status, 'ready');
    assert.match(doc.problems[0].solution.answer, /pi\/12/);
    assert.equal(doc.problems[0].source_pages[0].ocr_text, originalOcr);
    assert.equal(doc.problems[0].recognition.source_repair_history.length, 3);
    await fs.writeFile(path.join(output, 'drift-replay.after.json'), JSON.stringify(doc, null, 2));
    await page.screenshot({ path: path.join(output, 'drift-replay.reviewed.png'), fullPage: true });
    cases.push('drift_replay_keeps_parameter_and_checks_both_endpoints');
    cases.push('source_repairs_still_require_complete_formula_confirmation');
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
