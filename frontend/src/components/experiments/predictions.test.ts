import assert from 'node:assert/strict';
import test from 'node:test';
import type { ISpec, SpecEvaluation } from '../../ispec/types.ts';
import { buildPrediction, checkPrediction } from './predictions.ts';

const spec = {
  spec_version: '1.0', object_id: 'obj', kind: 'geometric',
  parameters: [{ id: 'a', label: 'a', default: 1, source: { page: 1, element_id: null, bbox: null, status: 'original', excerpt: 'x' } }],
  expressions: [{ id: 'det', label: '行列式' }, { id: 'angle', label: '角度', unit: 'deg' }],
  views: [],
} as unknown as ISpec;

function evaluation(derived: Record<string, number | boolean | string>): SpecEvaluation {
  return { values: {}, derived, violations: [] };
}

test('det 生成面积变化选择题并由当前值判定', () => {
  const grow = buildPrediction(spec, evaluation({ det: 2 }), { a: 1 });
  assert.equal(grow?.kind, 'choice');
  assert.equal(grow?.answer, '变大');
  assert.equal(checkPrediction(grow!, '变大'), true);
  const flip = buildPrediction(spec, evaluation({ det: -1 }), { a: 1 });
  assert.equal(flip?.answer, '翻转');
});

test('数值题按容差判定，参数变化会改变题目签名', () => {
  const first = buildPrediction(spec, evaluation({ value: 4 }), { a: 1 });
  const second = buildPrediction(spec, evaluation({ value: 4 }), { a: 2 });
  assert.equal(first?.kind, 'numeric');
  assert.notEqual(first?.signature, second?.signature);
  assert.equal(checkPrediction(first!, '4.0000001'), true);
  assert.equal(checkPrediction(first!, '5'), false);
});

test('角度类结果生成符号题', () => {
  const question = buildPrediction(spec, evaluation({ angle: -30 }), { a: 1 });
  assert.equal(question?.kind, 'sign');
  assert.equal(question?.answer, '负');
});

test('力与预算题使用当前内核结果生成答案', () => {
  const force = buildPrediction(spec, evaluation({ fx: -2, fy: 3 }), { a: 1 });
  assert.equal(force?.kind, 'choice');
  assert.equal(force?.answer, '第二象限');
  const budget = buildPrediction(spec, evaluation({ plan_a_total: 120, plan_b_total: 150 }), { a: 1 });
  assert.equal(budget?.answer, '方案 A');
});
