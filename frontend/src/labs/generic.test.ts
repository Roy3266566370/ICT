import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLab } from './compute.ts';
import { evaluateGeneric } from './generic.ts';
import type { LabModel, LabProblem, LabSolution } from './types.ts';

function genericProblem(model: Partial<LabModel>, solution: Partial<LabSolution> = {}): LabProblem {
  return {
    problem_id: 'prb_generic',
    number: null,
    title: '通用符号题',
    text: '通用符号题',
    subject: 'calculus',
    subject_label: '微积分',
    confidence: 0.9,
    status: 'ready',
    source: { page_from: 1, page_to: 1, file_names: [], label: '文本', excerpt: '' },
    source_pages: [],
    recognition: { method: 'generic_symbolic', raw_text: '', conditions: [], ambiguities: [], formulas: [], recognized_subject: 'calculus' },
    model: {
      engine: 'generic_v1',
      subject: 'calculus',
      defaults: { L: 6 },
      params: [{ id: 'L', label: 'L', kind: 'number', min: 1, max: 12, step: 0.1, options: [], value: 6 }],
      answer_kind: 'value',
      answer_formula: 'L',
      plot: { expr: 'L*sin(x)/x', var: 'x', range: [-3, 3], resolved: true },
      ...model,
    },
    solution: {
      summary: '通用符号模型',
      answer: '6',
      steps: [{ id: 's1', title: 's1 · 极限', detail: '6' }],
      ...solution,
    },
  };
}

test('通用模型按滑杆重算曲线与答案', () => {
  const problem = genericProblem({});
  const first = evaluateGeneric(problem, { L: 6 });
  assert.equal(first.kind, 'generic');
  assert.equal(first.answerText, '6');
  assert.ok(first.series.length > 100);
  assert.ok(first.series.some((point) => point.y !== null && Math.abs((point.y as number) - 6) < 0.2));
  const second = evaluateGeneric(problem, { L: 3 });
  assert.equal(second.answerText, '3');
});

test('通用模型 systems 答案按变量展开', () => {
  const problem = genericProblem({
    answer_kind: 'system',
    answer_variables: ['x', 'y'],
    answer_formula: [['L/2', 'L/4']],
    plot: null,
  }, { answer: 'x=3，y=1.5' });
  const result = evaluateGeneric(problem, { L: 6 });
  assert.match(result.answerText, /x=3/);
  assert.match(result.answerText, /y=1\.5/);
});

test('未知通用模型不抛错并保留步骤', () => {
  const problem = genericProblem({ plot: { expr: 'sqrt(x)', var: 'x', range: [-1, 1] } });
  const result = computeLab(problem, { L: 6 });
  assert.equal(result.kind, 'generic');
  assert.equal(result.trace.length, 1);
});