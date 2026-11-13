/**
 * geometry.test.ts —— 矩阵实验台依赖的 2×2 线性代数纯函数单测。
 *
 * 断言重点：奇异值闭式解、数值秩的相对容差、逆矩阵不可逆时不伪造，
 * 以及动画用的矩阵插值在端点与中点上的取值。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyMatrix,
  determinant,
  inverseMatrix,
  lerpMatrix,
  matrixRank,
  realEigenpairs,
  singularValues,
  swapMatrixColumns,
  transposeMatrix,
  type Matrix2,
} from './geometry.ts';

const close = (actual: number, expected: number, epsilon = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `期望 ${expected}，实际 ${actual}`,
  );
};

test('奇异值：对称矩阵与剪切矩阵的闭式解', () => {
  const symmetric = singularValues({ a: 2, b: 1, c: 1, d: 2 });
  close(symmetric[0], 3);
  close(symmetric[1], 1);

  const shear = singularValues({ a: 1, b: 1, c: 0, d: 1 });
  close(shear[0], 1.618033988749895, 1e-12);
  close(shear[1], 0.618033988749895, 1e-12);
});

test('数值秩：满秩 / 投影 / 零矩阵', () => {
  assert.equal(matrixRank({ a: 2, b: 1, c: 1, d: 2 }), 2);
  assert.equal(matrixRank({ a: 1, b: 0, c: 0, d: 0 }), 1);
  assert.equal(matrixRank({ a: 0, b: 0, c: 0, d: 0 }), 0);
  assert.equal(matrixRank({ a: 1, b: 1, c: 1, d: 1 }), 1);
});

test('逆矩阵：可逆时 A·A⁻¹ = I，不可逆时返回 null', () => {
  const matrix: Matrix2 = { a: 2, b: 1, c: 1, d: 2 };
  const inverse = inverseMatrix(matrix);
  assert.notEqual(inverse, null);
  if (inverse === null) return;
  close(inverse.a, 2 / 3);
  close(inverse.b, -1 / 3);
  close(inverse.c, -1 / 3);
  close(inverse.d, 2 / 3);
  close(determinant(matrix) * determinant(inverse), 1);

  assert.equal(inverseMatrix({ a: 1, b: 0, c: 0, d: 0 }), null);
  assert.equal(inverseMatrix({ a: 0, b: 0, c: 0, d: 0 }), null);
});

test('实特征对：[[2,1],[1,2]] 得到 λ=3 与 λ=1 的特征方向', () => {
  const pairs = realEigenpairs({ a: 2, b: 1, c: 1, d: 2 });
  assert.equal(pairs.length, 2);
  const lambdas = pairs.map((pair) => Number(pair.lambda.toFixed(6))).sort((x, y) => x - y);
  assert.deepEqual(lambdas, [1, 3]);
  for (const pair of pairs) {
    const image = applyMatrix({ a: 2, b: 1, c: 1, d: 2 }, pair.direction);
    close(image[0], pair.lambda * pair.direction[0]);
    close(image[1], pair.lambda * pair.direction[1]);
  }

  assert.deepEqual(realEigenpairs({ a: 0, b: -1, c: 1, d: 0 }), []);
});

test('矩阵操作与动画插值', () => {
  const matrix: Matrix2 = { a: 2, b: 1, c: 1, d: 2 };
  assert.deepEqual(transposeMatrix(matrix), { a: 2, b: 1, c: 1, d: 2 });
  assert.deepEqual(swapMatrixColumns({ a: 2, b: 1, c: 1, d: 2 }), { a: 1, b: 2, c: 2, d: 1 });
  assert.deepEqual(lerpMatrix(matrix, matrix, 0.5), matrix);
  assert.deepEqual(lerpMatrix({ a: 1, b: 0, c: 0, d: 1 }, matrix, 0), { a: 1, b: 0, c: 0, d: 1 });
  assert.deepEqual(lerpMatrix({ a: 1, b: 0, c: 0, d: 1 }, matrix, 1), matrix);
  close(lerpMatrix({ a: 1, b: 0, c: 0, d: 1 }, matrix, 0.5).a, 1.5);
});