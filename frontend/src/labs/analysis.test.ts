import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLab } from './compute.ts';
import { evaluateFunctionStudy, evaluateHigherDerivative, evaluateLimit, evaluateTaylor } from './analysis.ts';
import type { LabModel, LabProblem, LabSolution } from './types.ts';

function problem(model: Partial<LabModel>, solution: Partial<LabSolution> = {}): LabProblem {
  return {
    problem_id: 'p1', number: '1', title: 'P1', text: 'P1', subject: 'calculus', subject_label: '微积分',
    confidence: 0.9, status: 'ready',
    source: { page_from: 1, page_to: 1, file_names: ['f'], label: '文本', excerpt: 'P1' }, source_pages: [],
    recognition: { method: 'typed_text', raw_text: 'P1', conditions: [], ambiguities: [], formulas: [], recognized_subject: 'calculus' },
    model: { engine: 'analysis_v1', subject: 'calculus', defaults: {}, params: [], ...model },
    solution: { summary: '', answer: '', steps: [], ...solution },
    states: { params: {}, step: 0, mode: 'explore', notes: '', observations: [], events: [], scenarios: [], active_scenario_id: 'baseline', attempts: [], evaluated: null },
  };
}

test('极限计算区分双侧与单侧', () => {
  const model: Partial<LabModel> = {
    engine: 'analysis_v1', kind: 'limit', task: 'limit', analysis_kind: 'limit',
    expression: 'abs(x)/x', variable: 'x', side: 'both', limit_point: '0', limit_point_value: 0,
    defaults: { point: 0, side: 'both' },
  };
  const solution: Partial<LabSolution> = {
    answer: '极限不存在',
    left: { kind: 'finite', value: -1, text: '-1' },
    right: { kind: 'finite', value: 1, text: '1' },
    two_sided: { kind: 'does_not_exist', value: null, text: '不存在（左右极限不同）' },
  };
  const both = evaluateLimit(problem(model, solution), { side: 'both' });
  assert.equal(both.kind, 'limit');
  assert.equal(both.exact, null);
  assert.match(both.answerText, /不存在/);
  const left = evaluateLimit(problem(model, solution), { side: 'left' });
  assert.equal(left.exact, -1);
  assert.equal(left.metrics.find((item) => item.id === 'both')?.value, '-1');
});

test('泰勒展开原题使用符号系数，改阶后标注数值参照', () => {
  const model: Partial<LabModel> = {
    engine: 'analysis_v1', kind: 'taylor', task: 'taylor', analysis_kind: 'taylor',
    expression: 'exp(x)', variable: 'x', taylor_point: '0', taylor_point_value: 0, order: 3,
    defaults: { point: 0, order: 3 },
  };
  const solution: Partial<LabSolution> = {
    answer: 'P_3(x)=1+x+x^2/2+x^3/6',
    polynomial: 'x^3/6 + x^2/2 + x + 1',
    coefficients: [{ order: 0, value: '1' }, { order: 1, value: '1' }, { order: 2, value: '1/2' }, { order: 3, value: '1/6' }],
  };
  const exact = evaluateTaylor(problem(model, solution), { point: 0, order: 3 });
  assert.equal(exact.kind, 'taylor');
  assert.equal(exact.exact, null);
  assert.ok((exact.taylor?.overlay.length ?? 0) > 100);
  assert.equal(exact.checks.find((item) => item.id === 'expansion')?.status, 'pass');

  const changed = evaluateTaylor(problem(model, solution), { point: 0, order: 2 });
  assert.match(changed.notes.join(' '), /数值系数参照/);
});

test('高阶导数原题给符号值，改阶后给数值差分', () => {
  const model: Partial<LabModel> = {
    engine: 'analysis_v1', kind: 'higher_derivative', task: 'higher_derivative', analysis_kind: 'higher_derivative',
    expression: 'x^4', variable: 'x', order: 2, derivative_point: '1',
    defaults: { order: 2, point: 1 },
  };
  const solution: Partial<LabSolution> = { answer: 'f^(2)(x)=12*x^2', derivative_expression: '12*x^2', derivative_value: 12 };
  const original = evaluateHigherDerivative(problem(model, solution), { order: 2, point: 1 });
  assert.equal(original.exact, 12);
  assert.equal(original.higher?.expression, '12*x^2');
  const changed = evaluateHigherDerivative(problem(model, solution), { order: 3, point: 1 });
  assert.equal(changed.exact, null);
  assert.match(changed.notes.join(' '), /数值差分/);
});

test('函数区间研究绘制单调带与渐近线', () => {
  const model: Partial<LabModel> = {
    engine: 'analysis_v1', kind: 'function_study', task: 'function_study', analysis_kind: 'function_study',
    expression: '(x^2+1)/x', variable: 'x', plot_domain: [-6, 6], defaults: { lower: -6, upper: 6 },
  };
  const solution: Partial<LabSolution> = {
    answer: '递增区间：(-∞, -1)、(1, +∞)',
    study: {
      monotonic: [
        { kind: 'increasing', label: '单调递增', interval: '(-∞, -1)', from: null, to: -1 },
        { kind: 'decreasing', label: '单调递减', interval: '(-1, 0)', from: -1, to: 0 },
        { kind: 'decreasing', label: '单调递减', interval: '(0, 1)', from: 0, to: 1 },
        { kind: 'increasing', label: '单调递增', interval: '(1, +∞)', from: 1, to: null },
      ],
      concavity: [], extrema: [], inflections: [],
      asymptotes: { vertical: ['x=0'], horizontal: [], oblique: ['y=1*x+0'], vertical_values: [0], horizontal_values: [] },
      domain: [],
    },
  };
  const result = evaluateFunctionStudy(problem(model, solution));
  assert.equal(result.kind, 'function_study');
  assert.equal(result.study?.monotonic.length, 4);
  assert.deepEqual(result.study?.asymptotes.vertical_values, [0]);
  assert.equal(result.checks.find((item) => item.id === 'complete')?.status, 'pass');
});

test('computeLab 将四类 P1 任务分派到分析计算', () => {
  const limit = computeLab(problem({
    kind: 'limit', task: 'limit', analysis_kind: 'limit', expression: 'sin(x)/x', variable: 'x',
    side: 'both', limit_point: '0', limit_point_value: 0, defaults: { point: 0, side: 'both' },
  }, { answer: '1', two_sided: { kind: 'finite', value: 1, text: '1' }, left: { kind: 'finite', value: 1, text: '1' }, right: { kind: 'finite', value: 1, text: '1' } }), {});
  assert.equal(limit.subject === 'calculus' ? limit.kind : '', 'limit');
});
