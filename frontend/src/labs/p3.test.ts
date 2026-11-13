import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLab } from './compute.ts';
import type { LabModel, LabProblem, LabSolution } from './types.ts';

function problem(model: Partial<LabModel>, solution: Partial<LabSolution> = {}): LabProblem {
  return {
    problem_id: 'p3', number: '1', title: 'P3', text: 'P3', subject: model.subject ?? 'calculus',
    subject_label: '测试', confidence: 0.9, status: 'ready',
    source: { page_from: 1, page_to: 1, file_names: [], label: '文本', excerpt: 'P3' }, source_pages: [],
    recognition: { method: 'typed_text', raw_text: 'P3', conditions: [], ambiguities: [], formulas: [], recognized_subject: model.subject ?? 'calculus' },
    model: { engine: 'test', subject: 'calculus', defaults: {}, params: [], ...model },
    solution: { summary: '', answer: '', steps: [], ...solution },
    states: { params: {}, step: 0, mode: 'explore', notes: '', observations: [], events: [], scenarios: [], active_scenario_id: 'baseline', attempts: [], evaluated: null },
  };
}

test('ODE 结果绘制解曲线并展示组合量', () => {
  const result = computeLab(problem({
    engine: 'ode_v1', subject: 'calculus', kind: 'ode', task: 'ode',
    equation: "y' = y", independent_variable: 'x', order: 1, defaults: { x_min: -1, x_max: 1 },
  }, {
    answer: 'y = exp(x)', ode_order: 1, ode_hints: ['一阶线性'], plot_expression: 'exp(x)',
    target: { status: 'complete', kind: 'area', value: 'E - 1', text: 'E - 1', lower: '0', upper: '1' },
    residual_verified: true, initial_conditions_verified: true, solution_complete: true,
  }), {});
  assert.equal(result.subject === 'calculus' ? result.kind : '', 'ode');
  if (result.subject !== 'calculus') return;
  assert.equal(result.ode?.order, 1);
  assert.ok((result.series.length ?? 0) > 100);
  assert.match(result.checks.find(item => item.id === 'residual')?.detail ?? '', /残差/);
});

test('等式约束极值展示驻点分类', () => {
  const result = computeLab(problem({
    engine: 'constrained_extrema_v1', subject: 'optimization', kind: 'constrained_extrema',
    task: 'constrained_extrema', constraint: 'x+y=1', variables: ['x', 'y'],
    defaults: {}, params: [],
  }, {
    answer: '极小值点 (1/2, 1/2)，f=1/2，λ=1', solution_status: 'complete', solution_complete: true,
    candidates: [{ point: ['1/2', '1/2'], point_values: [0.5, 0.5], value: '1/2', lambda: '1', classification: 'minimum', evidence: '' }],
    global_note: '局部约束极值不等于全局最值。',
  }), {});
  assert.equal(result.subject, 'optimization');
  if (result.subject !== 'optimization') return;
  assert.equal(result.kind, 'constrained_extrema');
  assert.equal(result.candidates?.length, 1);
  assert.equal(result.metrics.find(item => item.id === 'candidates')?.value, '1');
});
