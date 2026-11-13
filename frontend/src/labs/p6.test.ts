import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLab } from './compute.ts';
import type { LabModel, LabProblem, LabSolution } from './types.ts';

function problem(model: Partial<LabModel>, solution: Partial<LabSolution> = {}): LabProblem {
  return {
    problem_id: 'p6', number: '1', title: 'P6', text: 'P6', subject: 'calculus', subject_label: '微积分',
    confidence: 0.9, status: 'ready',
    source: { page_from: 1, page_to: 1, file_names: [], label: '文本', excerpt: 'P6' }, source_pages: [],
    recognition: { method: 'typed_text', raw_text: 'P6', conditions: [], ambiguities: [], formulas: [], recognized_subject: 'calculus' },
    model: { engine: 'proof_v1', subject: 'calculus', defaults: {}, params: [], ...model },
    solution: { summary: '', answer: '', steps: [], ...solution },
    states: { params: {}, step: 0, mode: 'explore', notes: '', observations: [], events: [], scenarios: [], active_scenario_id: 'baseline', attempts: [], evaluated: null },
  };
}

test('证明任务展示义务清单和认证级别', () => {
  const result = computeLab(problem({
    kind: 'proof', task: 'proof', proof_kind: 'ivt_root', expression: 'x^2-1', lower: '0', upper: '2',
    defaults: {},
  }, {
    answer: '已认证（介值定理证书）', proof_kind: 'ivt_root', proof_status: 'verified',
    verification_level: 'kernel_certificate', solution_complete: true,
    obligations: [
      { id: 'domain', label: '区间上连续', status: 'pass', detail: '连续域检查：True' },
      { id: 'sign_change', label: '端点异号', status: 'pass', detail: 'f(0)f(2)<0' },
    ],
  }), {});
  assert.equal(result.subject === 'calculus' ? result.kind : '', 'proof');
  if (result.subject !== 'calculus') return;
  assert.equal(result.proof?.status, 'verified');
  assert.equal(result.proof?.obligations.length, 2);
  assert.equal(result.checks.length, 2);
});

test('局部步骤证明不显示为完整认证', () => {
  const result = computeLab(problem({
    kind: 'proof', task: 'proof', proof_kind: 'steps', defaults: {},
  }, {
    answer: '', proof_kind: 'steps', proof_status: 'local_steps_verified',
    verification_level: 'local_steps_only', solution_complete: false,
    obligations: [{ id: 'Step1', label: '第 1 步等式', status: 'pass', detail: 'x^2-1=(x-1)(x+1)' }],
  }), {});
  if (result.subject !== 'calculus') return;
  assert.equal(result.proof?.verification_level, 'local_steps_only');
  assert.equal(result.checks[0]?.status, 'pass');
});
