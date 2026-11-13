import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateDoubleIntegral, evaluateTaylor } from './calculus.ts';
import { evaluateSorting, evaluateStackQueue } from './dataStructures.ts';
import { evaluateActivation, evaluateConvPool } from './deepLearning.ts';
import { evaluateLeastSquares, evaluateNewton } from './optimization.ts';
import { evaluateProjectile, evaluateSpring } from './physics.ts';

function approx(actual: unknown, expected: number, tolerance = 1e-6): void {
  const value = typeof actual === 'number' ? actual : Number(actual);
  assert.ok(Number.isFinite(value), `期望数值，实际为 ${String(actual)}`);
  assert.ok(Math.abs(value - expected) <= tolerance, `${String(actual)} != ${expected}`);
}

test('泰勒：sin(x) 五阶近似与误差', () => {
  const result = evaluateTaylor(
    { expression: 'sin(x)', x0: 0, order: 5, x_eval: 0.5 },
    { expression: 'sin(x)', taylor_meta: { family: 'sin', base_x0: 0 } },
  );
  approx(result.metrics.find((item) => item.id === 'approx_value')?.value, 0.4794270833, 1e-8);
  assert.equal(result.series.length, 241);
  assert.equal(result.overlaySeries?.length, 241);
});

test('二重积分：x^2+y 在 [0,2]×[0,1] 的网格与解析值一致', () => {
  const result = evaluateDoubleIntegral(
    { expression: 'x^2 + y', ax: 0, bx: 2, ay: 0, by: 1, nx: 40, ny: 40 },
    {},
  );
  approx(result.numeric, 3.666, 0.002);
  approx(result.analytic, 11 / 3, 1e-6);
});

test('牛顿优化：二次函数收敛到极小点', () => {
  const result = evaluateNewton(
    { expression: 'x^2 - 4*x + 1', x0: 3, max_iter: 8 },
    {},
  );
  approx(result.metrics.find((item) => item.id === 'x_final')?.value, 2, 1e-5);
  approx(result.metrics.find((item) => item.id === 'f_final')?.value, -3, 1e-5);
  assert.equal(result.metrics.find((item) => item.id === 'classification')?.value, 'local_minimum');
});

test('最小二乘：斜率、截距与残差', () => {
  const result = evaluateLeastSquares({ xs: [1, 2, 3, 4], ys: [2, 3, 5, 4] }, {});
  approx(result.metrics.find((item) => item.id === 'slope')?.value, 0.8, 1e-8);
  approx(result.metrics.find((item) => item.id === 'intercept')?.value, 1.5, 1e-8);
  assert.equal(result.points?.length, 4);
});

test('栈、队列与排序', () => {
  const stack = evaluateStackQueue(
    { mode: 'stack', initial: [3, 1, 4], operations: 'push 2; pop; push 5; pop', capacity: 8 },
    {},
  );
  assert.deepEqual(stack.final_state, [3, 1, 4]);
  const sorting = evaluateSorting({ values: [5, 1, 4, 2, 8], algorithm: 'bubble' }, {});
  assert.deepEqual(sorting.sorted, [1, 2, 4, 5, 8]);
  approx(sorting.metrics.find((item) => item.id === 'comparisons')?.value, 9, 0);
});

test('激活函数与卷积/池化', () => {
  const sigmoid = evaluateActivation({ activation: 'sigmoid', x: 0, upstream: 2 }, {});
  approx(sigmoid.metrics.find((item) => item.id === 'activation_value')?.value, 0.5, 1e-10);
  approx(sigmoid.metrics.find((item) => item.id === 'gradient')?.value, 0.5, 1e-10);
  const conv = evaluateConvPool(
    {
      matrix: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
      kernel: [[1, 0, -1], [1, 0, -1], [1, 0, -1]],
      mode: 'conv',
      stride: 1,
      padding: 0,
    },
    { window: null },
  );
  assert.deepEqual(conv.output, [[-6]]);
  const pool = evaluateConvPool(
    {
      matrix: [[1, 3, 2, 4], [5, 6, 7, 8], [9, 2, 1, 0], [3, 4, 5, 6]],
      mode: 'maxpool',
      stride: 2,
      padding: 0,
    },
    { window: [2, 2] },
  );
  assert.deepEqual(pool.output, [[6, 8], [9, 6]]);
});

test('抛体与弹簧：单位换算后的位置与能量', () => {
  const projectile = evaluateProjectile(
    { v0: 10, angle_deg: 30, y0: 0, g: 9.8, t: 1 },
    {},
  );
  approx((projectile.position as number[])[0], 8.660254, 1e-5);
  approx((projectile.position as number[])[1], 0.1, 1e-9);
  const spring = evaluateSpring({ m: 2, k: 8, x0: 0.1, v0: 0, t: 2 }, {});
  approx(spring.energy, 0.04, 1e-8);
});
