import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('lab reading surfaces render formulas in titles, conditions, answers and explanations', async (t) => {
  const server = await createServer({
    configFile: false,
    cacheDir: 'node_modules/.vite-lab-formula-tests',
    root: process.cwd(),
    resolve: { alias: { '@': path.resolve('src') } },
    esbuild: { jsx: 'automatic' },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  });
  const formula = String.raw`$\frac{1}{\sqrt{1+x^2}}$`;
  const condition = { id: 'expression', label: formula, value: formula, kind: 'expression', provenance: 'original', note: formula,
    source: { excerpt: `条件 ${formula}，${'请核对原题。'.repeat(20)}` } };
  const problem = { problem_id: 'p1', title: `求 ${formula}`, text: `求 ${formula}。`, subject: 'calculus', status: 'ready',
    source: { label: '原题' }, source_pages: [], model: { engine: 'sympy', defaults: {}, params: [] },
    recognition: { ambiguities: [], conditions: [condition], formulas: [], reference_answer_text: formula },
    solution: { summary: formula, answer: formula, global_note: formula, steps: [{ id: 's1', title: formula, detail: formula }] } };
  const lab = { lab_id: 'lab1', revision: 1, source: { pages: [], files: [], citation: '来源' } };
  const state = { scenarios: [], notes: '', observations: [], attempts: [], events: [], evaluated: null };
  const result = { subject: 'calculus', kind: 'limit', metrics: [], trace: [{ label: formula, detail: formula }] };
  const noop = () => {};
  const cases = [
    ['LabSourcePanel', { lab, problem, tab: 'conditions', currentParams: {}, previewUrl: () => '', onTab: noop, onSelect: noop }],
    ['AssistantPanel', { problem, result, step: 0, mode: 'solution', notes: '', observations: [], attempts: [], onSelect: noop }],
    ['OutcomePanel', { lab, problem, state, open: true }],
    ['CompositeSolvePanel', { result: { problem: { text: formula }, status: '完成', answers: [{ subquestion: '1', goal: formula, answer: formula }],
      previous_summary: { answers: [{ goal: formula, answer: formula }, { answer: formula }] },
      solve: { steps: [{ id: 's1', goal: formula, state: '完成', detail: formula }] } } }],
    ['LabTimeline', { result, step: 0, speed: 1 }],
    ['OriginalCompare', { lab, problem, result, open: true, step: 0 }],
    ['ReviewDialog', { problem, open: true }],
    ['ManualIntegralResult', { problem: { ...problem, manual_input: { task: 'limit', latex: 'x', result_note: formula } }, params: {} }],
    ['LabAISolvePanel', { problem: { ...problem, ai_solution: { verification: 'needs_review', answer: formula,
      steps: [{ title: formula, detail: formula }], conditions: [formula], limitations: [formula], missing_conditions: [formula] } } }],
    ['LabCanvas', { problem, result: { subject: 'calculus', kind: 'proof', proof: {
      obligations: [{ id: 'o1', label: formula, detail: formula, status: 'pass' }] } } }],
  ] as const;
  try {
    await t.test('generic models use their own answer and guidance labels', async () => {
      const { AssistantPanel } = await server.ssrLoadModule('/src/components/labs/AssistantPanel.tsx');
      const html = renderToStaticMarkup(createElement(AssistantPanel, {
        problem: { ...problem, model: { ...problem.model, engine: 'generic_v1' } },
        result: { ...result, kind: 'generic' }, step: 0, mode: 'explore', notes: '',
        observations: [], attempts: [], draftText: '', selected: null, onSelect: noop,
      }));
      assert.ok(html.includes('原题条件下的完整答案'));
      assert.ok(html.includes('结果如何核验？'));
      assert.ok(!html.includes('定积分的值') && !html.includes('黎曼和'));
    });
    for (const [name, props] of cases) {
      await t.test(name, async () => {
        const module = await server.ssrLoadModule(`/src/components/labs/${name}.tsx`);
        const html = renderToStaticMarkup(createElement(module[name], props));
        const visible = html.replace(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/g, '')
          .replace(/<annotation\b[^>]*>[\s\S]*?<\/annotation>/g, '').replace(/<[^>]+>/g, '');
        assert.ok(html.includes('class="katex"'), `${name} must typeset the formula`);
        assert.ok(!visible.includes('\\frac') && !visible.includes('$'), `${name} leaked formula source: ${visible}`);
      });
    }
  } finally {
    await server.close();
  }
});

test('math display accepts delimited TeX fields and replaces invalid TeX with a review notice', async () => {
  const server = await createServer({ configFile: false, cacheDir: 'node_modules/.vite-lab-formula-tests', root: process.cwd(), resolve: { alias: { '@': path.resolve('src') } },
    esbuild: { jsx: 'automatic' }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  try {
    const { LabFormula, MathText } = await server.ssrLoadModule('/src/components/labs/ProblemText.tsx');
    const good = renderToStaticMarkup(createElement(LabFormula, { tex: String.raw`$\frac{1}{2}$` }));
    assert.ok(good.includes('class="katex"'));
    assert.ok(!good.includes('katex-error'));
    const numbered = renderToStaticMarkup(createElement(LabFormula, { tex: String.raw`x^2+y^2=1\tag{1}`, block: true }));
    assert.ok(numbered.includes('class="katex"') && !numbered.includes('katex-error'));
    const unfinished = renderToStaticMarkup(createElement(MathText, { text: String.raw`结果 $\frac{1}{2}，因此原积分收敛，请选择 B。` }));
    assert.match(unfinished, /因此原积分收敛，请选择 B。/);
    for (const element of [createElement(LabFormula, { tex: String.raw`\frac{1}{` }),
      createElement(MathText, { text: String.raw`结果 $\frac{1}{$，请核对。` }),
      createElement(MathText, { text: String.raw`结果 $\lim_{x\to 0} x…` })]) {
      const html = renderToStaticMarkup(element);
      const visible = html.replace(/<[^>]+>/g, '');
      assert.match(visible, /公式.*核对/);
      assert.ok(!visible.includes('\\frac') && !visible.includes('$') && !html.includes('katex-error'));
    }
  } finally { await server.close(); }
});
