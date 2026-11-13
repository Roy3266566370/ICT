import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLinAlg } from './linalg.ts';
import type { LabModel } from './types.ts';

function systemModel(): LabModel {
  return {
    engine: 'gauss_v1', subject: 'linear_algebra', la_kind: 'linear_system',
    matrix_a: [[2, 1, -1], [-3, -1, 2], [-2, 1, 2]], vector_b: [8, -11, -3],
    variables: ['x', 'y', 'z'],
    defaults: { method: 'gauss', pivoting: 'partial' }, params: [],
  } as LabModel;
}

test('gaussian elimination solves Ax=b with back-substitution trace', () => {
  const result = evaluateLinAlg(systemModel(), {});
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.solution.map((v) => Number(v!.toFixed(6))), [2, 3, -1]);
  assert.equal(result.answer, 'x = 2，y = 3，z = -1');
  const backSubs = result.frames.filter((f) => f.action === 'back_sub');
  assert.equal(backSubs.length, 3);
  assert.equal(result.checks.find((c) => c.id === 'residual')?.status, 'pass');
});

test('jordan method reaches RREF and reads solution directly', () => {
  const result = evaluateLinAlg(systemModel(), { method: 'jordan' });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.solution.map((v) => Number(v!.toFixed(6))), [2, 3, -1]);
  assert.ok(result.frames.some((f) => f.action === 'rref'));
  assert.ok(result.frames.every((f) => f.action !== 'back_sub'));
});

test('determinant keeps swap sign and pivot product', () => {
  const model = {
    engine: 'gauss_v1', subject: 'linear_algebra', la_kind: 'determinant',
    matrix_a: [[0, 1], [2, 3]], defaults: { pivoting: 'partial' }, params: [],
  } as LabModel;
  const result = evaluateLinAlg(model, {});
  assert.equal(result.status, 'ok');
  assert.equal(result.det, -2);
  assert.ok(result.frames.some((f) => f.action === 'swap'));
});

test('inverse produces [I|A^-1] and verifies product', () => {
  const model = {
    engine: 'gauss_v1', subject: 'linear_algebra', la_kind: 'inverse',
    matrix_a: [[1, 2], [3, 4]], defaults: { method: 'gauss', pivoting: 'partial' }, params: [],
  } as LabModel;
  for (const method of ['gauss', 'jordan']) {
    const result = evaluateLinAlg(model, { method });
    assert.equal(result.status, 'ok');
    const flat = result.inverse!.flat().map((v) => Number(v.toFixed(6)));
    assert.deepEqual(flat, [-2, 1, 1.5, -0.5]);
  }
});

test('singular matrix keeps trace with a singular marker', () => {
  const model = {
    engine: 'gauss_v1', subject: 'linear_algebra', la_kind: 'inverse',
    matrix_a: [[1, 2], [2, 4]], defaults: { method: 'gauss', pivoting: 'partial' }, params: [],
  } as LabModel;
  const result = evaluateLinAlg(model, {});
  assert.equal(result.status, 'ok');
  assert.equal(result.stopReason, 'singular');
  assert.ok(result.frames.some((f) => f.action === 'singular'));
});

test('matmul emits per-element frames and honours ba order', () => {
  const model = {
    engine: 'matmul_v1', subject: 'linear_algebra', la_kind: 'matmul', op: 'mul',
    matrix_a: [[1, 2], [3, 4]], matrix_b: [[5, 6], [7, 8]],
    defaults: { order: 'ab' }, params: [],
  } as LabModel;
  const result = evaluateLinAlg(model, {});
  assert.deepEqual(result.resultMatrix, [[19, 22], [43, 50]]);
  assert.equal(result.frames.filter((f) => f.action === 'element').length, 4);
  const first = result.frames.find((f) => f.action === 'element')!;
  assert.deepEqual(first.values.terms, [5, 14]);
  const ba = evaluateLinAlg(model, { order: 'ba' });
  assert.deepEqual(ba.resultMatrix, [[23, 34], [31, 46]]);
});

test('elementwise ops and live scalar parameter', () => {
  const add = {
    engine: 'matmul_v1', subject: 'linear_algebra', la_kind: 'matmul', op: 'add',
    matrix_a: [[1, 2], [3, 4]], matrix_b: [[5, 6], [7, 8]], defaults: {}, params: [],
  } as LabModel;
  assert.deepEqual(evaluateLinAlg(add, {}).resultMatrix, [[6, 8], [10, 12]]);
  const scalar = {
    engine: 'matmul_v1', subject: 'linear_algebra', la_kind: 'matmul', op: 'scalar',
    matrix_a: [[1, 2], [3, 4]], defaults: { scalar: 3 }, params: [],
  } as LabModel;
  assert.deepEqual(evaluateLinAlg(scalar, {}).resultMatrix, [[3, 6], [9, 12]]);
  assert.deepEqual(evaluateLinAlg(scalar, { scalar: -1 }).resultMatrix, [[-1, -2], [-3, -4]]);
});

test('blocked when shapes are wrong instead of fabricating', () => {
  const model = {
    engine: 'matmul_v1', subject: 'linear_algebra', la_kind: 'matmul', op: 'mul',
    matrix_a: [[1, 2, 3]], matrix_b: [[1, 2], [3, 4]], defaults: {}, params: [],
  } as LabModel;
  const result = evaluateLinAlg(model, {});
  assert.equal(result.status, 'blocked');
  assert.equal(result.frames.length, 0);
});
