import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBoundary, buildBoundarySource } from './boundaryHandles.ts';

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

test('三次及非常数曲线不被误判为线性或二次', () => {
  assert.equal(analyzeBoundary('x^3', 'x', -1, 1), null);
  assert.equal(analyzeBoundary('sin(x)', 'x', 0, 3), null);
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
