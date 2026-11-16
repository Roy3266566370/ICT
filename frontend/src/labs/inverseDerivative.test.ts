import test from 'node:test';
import assert from 'node:assert/strict';

import { computeLab } from './compute.ts';
import type { LabProblem } from './types.ts';

function inverseProblem(): LabProblem {
  return {
    subject: 'calculus',
    model: {
      subject: 'calculus', engine: 'tangent_v1', kind: 'inverse_derivative',
      expression: 'x^3', variable: 'x', inverse_function: true,
      defaults: { point: 2, h: 0.1 }, params: [],
    },
    solution: {
      summary: '反函数导数', answer: '0.20998684', answer_value: 0.2099868416491455,
      steps: [],
    },
    recognition: { conditions: [], ambiguities: [], formulas: [] },
  } as unknown as LabProblem;
}

test('front-end inverse derivative uses 1/f\'(x0), not the original derivative', () => {
  const result = computeLab(inverseProblem(), { point: 2, h: 0.1 });
  assert.equal(result.subject, 'calculus');
  if (result.subject !== 'calculus') return;
  assert.equal(result.kind, 'derivative');
  assert.ok(Math.abs((result.exact ?? 0) - 0.2099868416491455) < 1e-8);
  assert.ok(Math.abs((result.point?.x ?? 0) - 2) < 1e-9);
  assert.ok(Math.abs((result.point?.y ?? 0) - 2 ** (1 / 3)) < 1e-5);
  assert.ok(Math.abs((result.point?.slope ?? 0) - 0.2099868416491455) < 1e-8);
});
