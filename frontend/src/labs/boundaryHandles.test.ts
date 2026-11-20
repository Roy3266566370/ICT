import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBoundary, buildBoundarySource } from './boundaryHandles.ts';
import { compileExpression } from './expr.ts';

const compileEval = (source: string, theta: number): number | null =>
  compileExpression(source, ['theta']).evalOrNull({ theta });

test('线性边界识别为仿射并只开放两个端点手柄', () => {
  const curve = analyzeBoundary('2*x + 1', 'x', 0, 2);
  assert.ok(curve);
  assert.equal(curve.kind, 'affine');
  assert.deepEqual(curve.samples, [1, 3, 5]);
  assert.deepEqual(curve.handles, [0, 2]);
});

test('二次边界识别为抛物线并开放三个手柄', () => {
  const curve = analyzeBoundary('(x - 1)^2', 'x', -1, 3);
  assert.ok(curve);
  assert.equal(curve.kind, 'quadratic');
  assert.deepEqual(curve.samples, [4, 0, 4]);
  assert.deepEqual(curve.handles, [0, 1, 2]);
});

test('根式边界 sqrt(x) 可识别并只开放右端点手柄', () => {
  const curve = analyzeBoundary('sqrt(x)', 'x', 0, 1);
  assert.ok(curve);
  assert.equal(curve.kind, 'sqrt');
  assert.deepEqual(curve.handles, [2]);
  assert.ok(Math.abs(curve.samples[0]!) < 1e-12);
  assert.ok(Math.abs(curve.samples[2]! - 1) < 1e-12);
  assert.equal(curve.base, 0);
});

test('根式边界表达式可往返重建（含平移 sqrt(x-1)）', () => {
  const plain = buildBoundarySource('sqrt', 'x', 0, 1, [0, Math.SQRT1_2, 1], 0);
  assert.equal(plain, 'sqrt(x)');
  const shiftedCurve = analyzeBoundary('sqrt(x - 1)', 'x', 1, 2);
  assert.ok(shiftedCurve);
  assert.equal(shiftedCurve.kind, 'sqrt');
  assert.equal(shiftedCurve.base, 1);
  const shifted = buildBoundarySource('sqrt', 'x', 1, 2, shiftedCurve.samples, shiftedCurve.base);
  assert.equal(shifted, 'sqrt(x - 1)');
});

test('三次曲线不误判为线性、二次或正弦族', () => {
  assert.equal(analyzeBoundary('x^3', 'x', -1, 1), null);
  // sin(x) 本身就是正弦族成员，应被正确识别而非拒绝
  assert.equal(analyzeBoundary('sin(x)', 'x', 0, 3)?.kind, 'sinusoid');
});

test('反推表达式可往返重建并保持三个采样值', () => {
  const source = buildBoundarySource('quadratic', 'y', 0, 2, [1, 0.5, 3]);
  const curve = analyzeBoundary(source, 'y', 0, 2);
  assert.ok(curve);
  assert.equal(curve.kind, 'quadratic');
  for (let index = 0; index < 3; index += 1) {
    assert.ok(Math.abs(curve.samples[index]! - [1, 0.5, 3][index]!) < 1e-9);
  }
});

test('常值边界保持常数表达式', () => {
  const source = buildBoundarySource('affine', 'x', 0, 4, [2, 2, 2]);
  assert.equal(source, '2');
});

test('小数系数转换为有理数，避免符号换序把浮点系数判为病态', () => {
  assert.equal(buildBoundarySource('affine', 'x', 0, 1, [0, 0, 1.5]), '3/2*x');
  assert.equal(buildBoundarySource('affine', 'x', 0, 1, [0, 0, 1.15]), '23/20*x');
  const curve = analyzeBoundary('3/2*x', 'x', 0, 1);
  assert.ok(curve);
  assert.equal(curve.kind, 'affine');
});

test('正弦族边界 r=2cos(θ) 识别为 sinusoid 并可往返重建', () => {
  const a = -Math.PI / 2, b = Math.PI / 2;
  const curve = analyzeBoundary('2*cos(theta)', 'theta', a, b);
  assert.ok(curve);
  assert.equal(curve.kind, 'sinusoid');
  assert.deepEqual(curve.handles, [0, 1, 2]);
  const rebuilt = buildBoundarySource('sinusoid', 'theta', a, b, curve.samples);
  const evalAt = (theta: number) => {
    const value = Math.abs(2 * Math.cos(theta) - (compileEval(rebuilt, theta) ?? NaN));
    return value;
  };
  for (const theta of [-1.2, -0.4, 0.5, 1.4]) {
    assert.ok(evalAt(theta) < 1e-9, `θ=${theta} 重建偏差 ${evalAt(theta)}`);
  }
});

test('正弦族拖点重建：r=cos(θ)+0.5 心脏线族', () => {
  const a = 0, b = Math.PI;
  const curve = analyzeBoundary('cos(theta) + 1/2', 'theta', a, b);
  assert.ok(curve);
  assert.equal(curve.kind, 'sinusoid');
  // 拖中点上移 → 重建仍是可编译的正弦族表达式
  const dragged = buildBoundarySource('sinusoid', 'theta', a, b, [curve.samples[0]!, curve.samples[1]! + 0.5, curve.samples[2]!]);
  assert.ok(compileEval(dragged, 0.7) !== null);
});

test('非正弦族曲线不误判为 sinusoid', () => {
  const curve = analyzeBoundary('theta^2', 'theta', 0, 1);
  assert.equal(curve?.kind, 'quadratic');
});
