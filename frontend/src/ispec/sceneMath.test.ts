import test from 'node:test';
import assert from 'node:assert/strict';
import {dualPath, formatPoint, interpolateDualPath, matrixFor, polygonArea, RECTANGLE, transformPolygon} from './sceneMath.ts';

test('旋转90°后横拉2倍：先转后拉得到 (0,1)，先拉后转得到 (0,2)', () => {
  const a = dualPath('A', 90, 2, 1, [1, 0]);
  const b = dualPath('B', 90, 2, 1, [1, 0]);
  assert.equal(formatPoint(a.middle), '(0, 1)');
  assert.equal(formatPoint(a.final), '(0, 1)');
  assert.equal(formatPoint(b.middle), '(2, 0)');
  assert.equal(formatPoint(b.final), '(0, 2)');
});

test('两条路径矩阵与执行顺序一致', () => {
  const a = matrixFor('A', 90, 2, 1);
  const b = matrixFor('B', 90, 2, 1);
  assert.ok(Math.abs(a[0][0]) < 1e-9 && Math.abs(a[0][1] + 2) < 1e-9);
  assert.ok(Math.abs(a[1][0] - 1) < 1e-9 && Math.abs(a[1][1]) < 1e-9);
  assert.ok(Math.abs(b[0][0]) < 1e-9 && Math.abs(b[0][1] + 1) < 1e-9);
  assert.ok(Math.abs(b[1][0] - 2) < 1e-9 && Math.abs(b[1][1]) < 1e-9);
});

test('矩形面积相同但最终形状一般不同', () => {
  const a = transformPolygon(matrixFor('A', 30, 1.6, 1), RECTANGLE);
  const b = transformPolygon(matrixFor('B', 30, 1.6, 1), RECTANGLE);
  assert.ok(Math.abs(polygonArea(a) - polygonArea(b)) < 1e-9);
  assert.notDeepEqual(a, b);
});

test('时间轴中间态停在顺序第一步，完成态与最终矩阵一致', () => {
  const middle = interpolateDualPath('A', 90, 2, 1, [1, 0], 0.5);
  assert.equal(formatPoint(middle.middle), '(0, 1)');
  assert.equal(formatPoint(middle.final), '(0, 1)');
  const final = interpolateDualPath('B', 90, 2, 1, [1, 0], 1);
  assert.equal(formatPoint(final.final), '(0, 2)');
});

import {svd2, multiplyMatrices, type Mat2} from './sceneMath.ts';

function approx(actual: number, expected: number, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}

test('SVD 对对角、旋转和剪切矩阵都满足 A = UΣVᵀ', () => {
  const matrices: Mat2[] = [ [[1.618, 0], [0, 0.618]], [[0, -1], [1, 0]], [[1, 1], [0, 1]], [[2, 1], [1, 2]] ];
  for (const matrix of matrices) {
    const result = svd2(matrix);
    const sigma: Mat2 = [[result.sigma[0], 0], [0, result.sigma[1]]];
    const rebuilt = multiplyMatrices(multiplyMatrices(result.u, sigma), [[result.v[0][0], result.v[1][0]], [result.v[0][1], result.v[1][1]]]);
    approx(rebuilt[0][0], matrix[0][0]);
    approx(rebuilt[0][1], matrix[0][1]);
    approx(rebuilt[1][0], matrix[1][0]);
    approx(rebuilt[1][1], matrix[1][1]);
    assert.ok(result.sigma[0] >= result.sigma[1] - 1e-12);
  }
});

test('剪切 k=1 的奇异值为 1.618 与 0.618', () => {
  const result = svd2([[1, 1], [0, 1]]);
  approx(result.sigma[0], 1.6180339887, 1e-6);
  approx(result.sigma[1], 0.6180339887, 1e-6);
});
