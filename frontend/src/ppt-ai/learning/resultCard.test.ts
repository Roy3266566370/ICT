import assert from 'node:assert/strict';
import test from 'node:test';

import type { TargetResult } from '../types.ts';
import { buildLearningResultCard, TARGET_STATUS_LABEL } from './resultCard.ts';

function target(overrides: Partial<TargetResult>): TargetResult {
  return {
    status: 'found',
    output: 'product',
    target_value: 0,
    candidates: [],
    method: 'linear_inverse',
    tolerance: 1e-6,
    atol: 1e-8,
    rtol: 1e-6,
    residual: 0,
    search_scope: {},
    iterations: 1,
    stop_reason: '',
    checks: [],
    candidate_branch_id: null,
    ...overrides,
  };
}

const solution = {
  unknowns: ['v1', 'v2'],
  values: [3, 1],
  classification: 'unique' as const,
  exact_values: ['3', '1'],
  free_variables: [],
  nullspace_basis: [],
  equations: ['2·v1 + 1·v2 = 7', '1·v1 + 2·v2 = 5'],
  verification: [
    { label: '代回第 1 行', expected: '7', actual: '7', residual: 0, status: 'pass' as const },
  ],
};

test('唯一解显示未知量、精确值与代回验证', () => {
  const card = buildLearningResultCard(target({
    candidates: [{ values: { v1: 3, v2: 1 }, output_value: null, residual: 0, method: 'unique_inverse', solution }],
  }), { inputHash: 'h'.repeat(64) });
  assert.equal(card.solution?.values[0], 3);
  assert.match(card.conclusion, /v1, v2 = \(3, 1\)/);
  assert.equal(card.verification[0]?.status, 'pass');
  assert.equal(card.steps.length, 2);
});

test('多解、无解与范围未发现使用各自的文案', () => {
  assert.equal(TARGET_STATUS_LABEL.multiple, '存在多解');
  const multiple = buildLearningResultCard(target({ status: 'multiple', candidates: [{ values: {}, output_value: null, residual: 0, method: 'rank', solution: { ...solution, classification: 'particular', free_variables: ['v2'] } }] }), { inputHash: 'h'.repeat(64) });
  assert.match(multiple.conclusion, /多解/);
  const infeasible = buildLearningResultCard(target({ status: 'infeasible_proven' }), { inputHash: 'h'.repeat(64) });
  assert.match(infeasible.conclusion, /不相容/);
  const none = buildLearningResultCard(target({ status: 'none_in_scope' }), { inputHash: 'h'.repeat(64) });
  assert.match(none.conclusion, /不等于数学无解/);
});

test('旧结果缺少显式解时明确要求重新求解', () => {
  const card = buildLearningResultCard(target({
    candidates: [{ values: { v1: 3, v2: 1 }, output_value: null, residual: 0, method: 'old' }],
  }), { inputHash: 'h'.repeat(64) });
  assert.equal(card.solution?.classification, 'scalar_candidate');
  assert.equal(card.verification[0]?.status, 'not_checked');
});
