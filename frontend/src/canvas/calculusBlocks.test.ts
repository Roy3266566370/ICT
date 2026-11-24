import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFunction, functionValue } from './calculus.ts';
import {
  combineFunctions,
  multiplyMatrix,
  probabilitySeries,
  solveLinear2x2,
  svd2x2,
  type Matrix2Value,
} from './calculusBlocks.ts';

function matrixApprox(actual: Matrix2Value, expected: Matrix2Value, tolerance = 1e-8): void {
  for (const key of ['a', 'b', 'c', 'd'] as const) {
    assert.ok(Math.abs(actual[key] - expected[key]) < tolerance, `${key}: ${actual[key]} vs ${expected[key]}`);
  }
}

test('函数运算支持加减乘除与复合，并保留 f 的参数', () => {
  const f = functionValue('a*x^2', { a: 1 });
  const g = functionValue('sin(x)', {});
  const sum = combineFunctions(f, g, 0);
  const add = compileFunction(sum);
  assert.ok(Math.abs((add(2) ?? 0) - (4 + Math.sin(2))) < 1e-9);
  const composed = combineFunctions(f, g, 4);
  const composedFn = compileFunction(composed);
  assert.ok(Math.abs((composedFn(Math.PI / 2) ?? 0) - 1) < 1e-8);
  const scaledG = functionValue('a*x', { a: 2 });
  const shifted = combineFunctions(functionValue('x^2', {}), scaledG, 0);
  assert.ok(Math.abs((compileFunction(shifted)(3) ?? 0) - 15) < 1e-9);
  const divided = combineFunctions(functionValue('1', {}), functionValue('x', {}), 3);
  assert.equal(compileFunction(divided)(0), null);
});

test('2×2 SVD 重构原矩阵并识别秩与条件数', () => {
  const matrices: Matrix2Value[] = [
    { a: 3, b: 1, c: 1, d: 3 },
    { a: 1, b: 2, c: 2, d: 4 },
    { a: 0, b: 0, c: 0, d: 0 },
    { a: 0, b: -1, c: 1, d: 0 },
  ];
  for (const matrix of matrices) {
    const result = svd2x2(matrix);
    const reconstructed = multiplyMatrix(multiplyMatrix(result.u, result.sigma), result.vt);
    matrixApprox(reconstructed, matrix, 1e-8);
    assert.ok(result.s1 >= result.s2);
    assert.ok(Number.isFinite(result.s1) && Number.isFinite(result.s2));
  }
  assert.equal(svd2x2({ a: 0, b: 0, c: 0, d: 0 }).rank, 0);
  assert.equal(svd2x2({ a: 1, b: 2, c: 2, d: 4 }).rank, 1);
  assert.equal(svd2x2({ a: 3, b: 1, c: 1, d: 3 }).rank, 2);
});

test('线性方程组区分唯一解、无穷多解、无解与最小二乘', () => {
  const unique = solveLinear2x2({ a: 2, b: 1, c: 1, d: 3 }, 5, 6);
  assert.equal(unique.kind, 'unique');
  assert.ok(Math.abs(unique.x - 1.8) < 1e-9 && Math.abs(unique.y - 1.4) < 1e-9);
  const infinite = solveLinear2x2({ a: 1, b: 2, c: 2, d: 4 }, 3, 6);
  assert.equal(infinite.kind, 'infinite');
  const inconsistent = solveLinear2x2({ a: 1, b: 2, c: 2, d: 4 }, 1, 0);
  assert.equal(inconsistent.kind, 'leastSquares');
  assert.ok(inconsistent.residual > 0);
  const zero = solveLinear2x2({ a: 0, b: 0, c: 0, d: 0 }, 1, 0);
  assert.equal(zero.kind, 'none');
  assert.equal(solveLinear2x2({ a: 0, b: 0, c: 0, d: 0 }, 0, 0).kind, 'infinite');
});

test('概率采样确定性、有限且直方图/理论曲线同长', () => {
  const first = probabilitySeries({ distribution: 0, samples: 400, bins: 24, seed: 11 });
  const second = probabilitySeries({ distribution: 0, samples: 400, bins: 24, seed: 11 });
  assert.deepEqual(first.series.values, second.series.values);
  assert.equal(first.series.values.length, 24);
  assert.equal(first.series.secondary?.[0]?.values.length, 24);
  assert.ok(first.series.values.every(Number.isFinite));
  assert.ok(Math.abs(first.mean) < 0.2);
  const binomial = probabilitySeries({ distribution: 1, samples: 300, bins: 12, seed: 3 });
  const observedTotal = binomial.series.values.reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(observedTotal - 1) < 1e-9);
  const capped = probabilitySeries({ distribution: 3, samples: 5000, bins: 99, seed: 3 });
  assert.ok(capped.series.values.length <= 60);
  assert.ok(capped.series.values.every(Number.isFinite));
});
