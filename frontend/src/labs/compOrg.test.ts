import test from 'node:test';
import assert from 'node:assert/strict';

import { replayCompOrg } from './compOrg.ts';
import type { LabProblem } from './types.ts';

const problem = {
  model: {
    co_result: {
      subject: 'computer_organization',
      engine: 'co_perf_v1',
      co_kind: 'performance',
      status: 'ok',
      headline: 'CPU 执行时间 = 0.002 s',
      answer: 'CPU 执行时间 = 0.002 s',
      answer_value: 0.002,
      answer_order: ['0.002'],
      metrics: [],
      checks: [],
      notes: [],
      pseudocode: ['T = N × CPI / f'],
      frames: [{ index: 1, label: '套用公式', detail: '0.002 s', values: { 执行时间: '0.002' } }],
      trace: [],
      params: {},
    },
  },
} as unknown as LabProblem;

test('replayCompOrg maps backend co_result to the frontend protocol', () => {
  const result = replayCompOrg(problem);
  assert.equal(result.subject, 'computer_organization');
  assert.equal(result.coKind, 'performance');
  assert.equal(result.engine, 'co_perf_v1');
  assert.equal(result.answerValue, 0.002);
  assert.deepEqual(result.answerOrder, ['0.002']);
  assert.equal(result.trace.length, 1);
  assert.equal(result.trace[0]?.label, '套用公式');
});
