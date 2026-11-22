import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, evalOutput } from './engine.ts';
import type { CanvasDoc } from './types.ts';
import {
  functionValue,
  compileFunction,
  compileFunction2d,
  function2dValue,
  epsilonDeltaBand,
  antiderivativeSamples,
  fourierPartialSum,
  fourierSpectrum,
  fourierSamples,
  slopeFieldGrid,
  integrateOdeRK4,
  gradient2d,
  directionDerivative,
  sandboxModel,
  polarSandboxModel,
  rectSandbox,
  polarSandbox,
} from './calculus.ts';

const fn = (expression: string) => compileFunction(functionValue(expression, {}));

test('二元函数端口复用受限解析器并拒绝动态执行', () => {
  const f = compileFunction2d(function2dValue('x^2+y^2', {}));
  assert.equal(f(1, 2), 5);
  assert.throws(() => function2dValue('window.alert(1)', {}));
  assert.throws(() => function2dValue('x'.repeat(501), {}));
  assert.equal(function2dValue('a*x^2+b*y^2', { a: 2, b: 3 }).a, 2);
});

test('engine 的 func2dSource 广播 function2d，非法表达式返回 null', () => {
  const doc: CanvasDoc = {
    version: 1,
    title: '',
    nodes: [
      { id: 's', type: 'func2dSource', x: 0, y: 0, params: { a: 1, b: 1 }, text: 'x^2+y^2' },
      { id: 'bad', type: 'func2dSource', x: 0, y: 0, params: {}, text: 'window.alert(1)' },
    ],
    wires: [],
    strokes: [],
    zoom: 1,
  };
  const ctx = makeCtx(doc, new Map());
  const source = evalOutput(ctx, 's');
  if (source?.kind !== 'function2d') throw new Error('func2dSource 应广播 function2d 端口值');
  const compiled = compileFunction2d(source);
  assert.equal(compiled(2, 3), 13);
  assert.equal(evalOutput(ctx, 'bad'), null);
});

test('ε-δ 邻域带对连续函数给出 δ，对间断与发散拒绝', () => {
  const identity = epsilonDeltaBand(fn('x'), 0, 0.1);
  assert.ok(identity.delta !== null);
  assert.ok(identity.delta >= 0.09 && identity.delta <= 0.1);
  assert.ok(identity.samples.every((s) => s.inside));

  const sinc = epsilonDeltaBand(fn('sin(x)/x'), 0, 0.1);
  assert.ok(sinc.delta !== null && sinc.delta > 0.1);

  const pole = epsilonDeltaBand(fn('1/x'), 0, 0.1);
  assert.equal(pole.delta, null);
  assert.equal(pole.level, null);
  assert.ok(pole.message.length > 0);

  const jump = epsilonDeltaBand(fn('abs(x)/x'), 0, 0.1);
  assert.equal(jump.delta, null);
  assert.ok(jump.message.length > 0);
});

test('变上限积分采样：末点复现 1/3 且差分斜率与 f 一致', () => {
  const samples = antiderivativeSamples(fn('x^2'), 0, 0, 1);
  assert.equal(samples.length, 241);
  const last = samples[samples.length - 1]!;
  assert.equal(last.x, 1);
  assert.ok(Math.abs(last.integral! - 1 / 3) < 1e-6);
  assert.ok(last.slopeError! < 1e-3);
  assert.ok(samples.every((s) => s.slopeError !== null));
});

test('傅里叶部分和在 N=1 给出基波幅值，方波高次部分和收敛', () => {
  const x = Math.PI / 2;
  assert.ok(Math.abs(fourierPartialSum('square', 1, x) - 4 / Math.PI) < 1e-12);
  assert.ok(Math.abs(fourierPartialSum('triangle', 1, x) - 8 / Math.PI ** 2) < 1e-12);
  assert.ok(Math.abs(fourierPartialSum('sawtooth', 1, x) - 2 / Math.PI) < 1e-12);
  const square = (t: number) => fourierPartialSum('square', 99, t);
  assert.ok(Math.abs(square(Math.PI / 2) - square(1)) < 0.02);
});

test('傅里叶频谱只保留奇次谐波（锯齿波除外）并按系数衰减', () => {
  const square = fourierSpectrum('square', 5);
  assert.deepEqual(square.map((s) => s.harmonic), [1, 3, 5]);
  assert.ok(Math.abs(square[0]!.amplitude - 4 / Math.PI) < 1e-12);
  assert.ok(Math.abs(square[1]!.amplitude - 4 / (3 * Math.PI)) < 1e-12);
  assert.ok(Math.abs(square[2]!.amplitude - 4 / (5 * Math.PI)) < 1e-12);

  const triangle = fourierSpectrum('triangle', 3);
  assert.ok(Math.abs(triangle[1]!.amplitude - 8 / (Math.PI ** 2 * 9)) < 1e-12);

  const saw = fourierSpectrum('sawtooth', 3);
  assert.deepEqual(saw.map((s) => s.harmonic), [1, 2, 3]);
  assert.ok(Math.abs(saw[2]!.amplitude - 2 / (3 * Math.PI)) < 1e-12);

  const samples = fourierSamples('square', 9, -Math.PI, Math.PI, 121);
  assert.equal(samples.length, 121);
  assert.ok(samples.every((p) => Number.isFinite(p.y)));
});

test('斜率场按网格采样，非有限斜率记为 null', () => {
  const grid = slopeFieldGrid('-y', 0, 1, 3);
  assert.deepEqual(grid.xs, [0, 0.5, 1]);
  assert.equal(grid.slopes[0]![0], 0);
  assert.equal(grid.slopes[0]![2], -1);

  const centered = slopeFieldGrid('x-y');
  assert.equal(centered.min, -3);
  assert.equal(centered.max, 3);
  assert.equal(centered.xs.length, 15);
  assert.equal(centered.slopes[7]![7], 0);

  const singular = slopeFieldGrid('1/y', -1, 1, 3);
  assert.equal(singular.slopes[1]![1], null);
});

test('RK4 积分逼近 e^{-1} 并返回 steps+1 个点', () => {
  const points = integrateOdeRK4('-y', 0, 1, 0.01, 100);
  assert.equal(points.length, 101);
  const last = points[points.length - 1]!;
  assert.ok(Math.abs(last.x - 1) < 1e-9);
  assert.ok(Math.abs(last.y - Math.exp(-1)) < 1e-6);
  assert.equal(integrateOdeRK4('-y', 0, 1, 10, 3).length, 4);
  assert.throws(() => integrateOdeRK4('window.alert(1)', 0, 1, 0.1, 10));
});

test('中心差分梯度与方向导数满足解析值，梯度垂直于等高线切向', () => {
  const f = compileFunction2d(function2dValue('x^2+y^2', {}));
  const g = gradient2d(f, 1, 1);
  assert.ok(Math.abs(g.value - 2) < 1e-12);
  assert.ok(Math.abs(g.fx - 2) < 1e-6);
  assert.ok(Math.abs(g.fy - 2) < 1e-6);

  assert.ok(Math.abs(directionDerivative(g, 0) - 2) < 1e-6);
  assert.ok(Math.abs(directionDerivative(g, Math.PI / 2) - 2) < 1e-6);

  const tangentX = -g.fy;
  const tangentY = g.fx;
  assert.ok(Math.abs(tangentX * g.fx + tangentY * g.fy) < 1e-9);

  const singular = gradient2d((x, y) => (x < 0 ? null : x + y), 0, 0);
  assert.ok(Number.isNaN(singular.fx));
});

test('二重积分沙盒模型与矩形/极坐标近似值', () => {
  const rect = sandboxModel('x+y');
  assert.equal(rect.engine, 'sandbox');
  assert.equal(rect.subject, 'calculus');
  assert.equal(rect.region_kind, 'strip');
  assert.equal(rect.outer_variable, 'y');
  assert.deepEqual(rect.outer_bounds, ['0', '1']);
  assert.deepEqual(rect.inner_bounds_tex, ['0', '1']);
  assert.equal(rect.integrand, 'x+y');

  const polar = polarSandboxModel('r');
  assert.equal(polar.polar?.jacobian, 'r');
  assert.deepEqual(polar.polar?.theta_bounds, ['0', '6.283185307179586']);
  assert.deepEqual(polar.polar?.r_bounds, ['0', '1']);
  assert.equal(polar.polar?.transformed_integrand, 'r');
  assert.equal(polar.polar?.answer_value, 0);

  assert.ok(Math.abs(rectSandbox('1', 40).approx - 1) < 1e-9);
  assert.ok(Math.abs(rectSandbox('x+y', 40).approx - 1) < 1e-9);

  const polarResult = polarSandbox('r', 60);
  assert.ok(Math.abs(polarResult.approx - Math.PI) < 0.02);
  assert.equal(polarResult.outerPoints.length, 121);

  // 极坐标沙盒必须跟随节点的 θ 范围与半径上限，不能固定为单位圆
  const half = polarSandbox('r', 60, Math.PI / 2, { theta0: 0, theta1: Math.PI, rMax: 1 });
  assert.ok(Math.abs(half.approx - Math.PI / 2) < 0.05);
  const large = polarSandbox('r', 60, Math.PI, { theta0: 0, theta1: 2 * Math.PI, rMax: 2 });
  assert.ok(Math.abs(large.approx - 4 * Math.PI) < 0.3);
  const radius = Math.max(...large.outerPoints.map(point => Math.hypot(point.x, point.y)));
  assert.ok(radius <= 2.01 && radius > 1.9);
  const bounded = polarSandboxModel('r', { theta0: 0, theta1: Math.PI, rMax: 2 });
  assert.deepEqual(bounded.polar?.theta_bounds, ['0', String(Math.PI)]);
  assert.deepEqual(bounded.polar?.r_bounds, ['0', '2']);
});