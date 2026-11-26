import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, evalOutput } from './engine.ts';
import type { CanvasDoc } from './types.ts';
import { functionValue, compileFunction, derivativeAt, integrate, approachLimit, taylorPolynomial } from './calculus.ts';
import { CALCULUS_TEMPLATES, calculusTemplateDoc } from './calculusTemplates.ts';

const fn = (expression: string) => compileFunction(functionValue(expression, {}));

test('极限观察区分可去间断点、左右不等、发散和单侧定义域', () => {
  assert.ok(Math.abs(approachLimit(fn('sin(x)/x'), 0).candidate! - 1) < 1e-6);
  assert.equal(approachLimit(fn('abs(x)/x'), 0).candidate, null);
  assert.equal(approachLimit(fn('1/x'), 0).candidate, null);
  assert.equal(approachLimit(fn('sqrt(x)'), 0).candidate, null);
  assert.ok(approachLimit(fn('x'), 0, 1).candidate !== null);
  assert.throws(() => derivativeAt(fn('sqrt(x)'), 0));
});

test('黎曼和随分割细化趋近参考值，零区间与定义域有明确行为', () => {
  const coarse = integrate(fn('x^2'), 0, 1, 4);
  const fine = integrate(fn('x^2'), 0, 1, 100);
  assert.ok(Math.abs(fine.reference - 1 / 3) < 1e-10);
  assert.ok(fine.error < coarse.error);
  assert.equal(integrate(fn('x'), 1, 1, 10).reference, 0);
  assert.throws(() => integrate(fn('sqrt(x)'), -1, 1, 10));
});

test('泰勒数值系数复现 exp 与 sin 的已知局部展开，拒绝尖点', () => {
  const exp = taylorPolynomial(fn('exp(x)'), 0, 5);
  [1, 1, 0.5, 1 / 6, 1 / 24, 1 / 120].forEach((want, i) => assert.ok(Math.abs(exp.coefficients[i]! - want) < 2e-4));
  const sin = compileFunction(taylorPolynomial(fn('sin(x)'), 0, 5).value);
  assert.ok(Math.abs(sin(0.3)! - Math.sin(0.3)) < 1e-6);
  assert.throws(() => taylorPolynomial(fn('abs(x)'), 0, 3));
  assert.throws(() => taylorPolynomial(fn('abs(x)'), 0, 1));
});

test('导数判定适应函数尺度，保留光滑函数并拒绝缩小后的尖点', () => {
  assert.equal(derivativeAt(fn('1000*x^2'), 0), 0);
  assert.ok(Math.abs(derivativeAt(fn('sin(1000*x)'), 0) - 1000) < 0.01);
  assert.ok(Math.abs(derivativeAt(fn('x^3'), 0)) < 1e-8);
  assert.equal(derivativeAt(fn('x^5'), 0), 0);
  assert.equal(derivativeAt(fn('x^7'), 0), 0);
  assert.throws(() => derivativeAt(fn('0.0001*abs(x)'), 0));
  assert.throws(() => taylorPolynomial(fn('0.0001*abs(x)'), 0, 1));
});

test('泰勒检验所需阶数的光滑性，不能把高阶尖点作为泰勒展开', () => {
  assert.throws(() => taylorPolynomial(fn('abs(x)^3'), 0, 3));
  assert.throws(() => taylorPolynomial(fn('abs(x)^5'), 0, 5));
  assert.ok(Math.abs(compileFunction(taylorPolynomial(fn('x^5'), 0, 5).value)(0.5)! - 0.03125) < 1e-12);
  assert.ok(Math.abs(compileFunction(taylorPolynomial(fn('1e-12*x^2'), 0, 3).value)(1)! - 1e-12) < 1e-20);
});

test('靠近定义域边界的合法泰勒中心无需越域采样', () => {
  const result = taylorPolynomial(fn('ln(x)'), 0.1, 3);
  assert.ok(Math.abs(result.coefficients[0]! - Math.log(0.1)) < 1e-6);
  assert.ok(Math.abs(result.coefficients[1]! - 10) < 0.01);
  assert.ok(Math.abs(result.coefficients[2]! + 50) < 0.1);
  const sqrt = compileFunction(taylorPolynomial(fn('sqrt(x)'), 0.1, 3).value);
  assert.ok(Math.abs(sqrt(0.101)! - Math.sqrt(0.101)) < 1e-6);
});

test('自动微分覆盖乘除、复合函数、负整数幂与常用初等函数', () => {
  for (const [expression, x, want] of [
    ['sin(x^2)', 1, 2 * Math.cos(1)], ['ln(x)', 0.1, 10], ['sqrt(x)', 4, 0.25],
    ['x^-2', -2, 0.25], ['tan(x)', 0, 1], ['arcsin(x)', 0, 1],
    ['arccos(x)', 0, -1], ['arctan(x)', 0, 1], ['sinh(x)', 0, 1],
    ['cosh(x)', 0, 0], ['tanh(x)', 0, 1], ['abs(x)^2', 0, 0],
  ] as const) assert.ok(Math.abs(derivativeAt(fn(expression), x) - want) < 1e-10, expression);
  const logarithm = taylorPolynomial(fn('ln(1+x)'), 0, 5);
  [0, 1, -0.5, 1 / 3, -0.25, 0.2].forEach((want, k) => assert.ok(Math.abs(logarithm.coefficients[k]! - want) < 1e-12));
  assert.deepEqual(taylorPolynomial(fn('1/(1-x)'), 0, 5).coefficients, [1, 1, 1, 1, 1, 1]);
});

test('截断指数不能把没有实数邻域的函数误当作常整数幂', () => {
  assert.throws(() => derivativeAt(fn('(-1)^(x^2)'), 0));
  assert.throws(() => taylorPolynomial(fn('(-1)^(x^6)'), 0, 5));
  assert.equal(derivativeAt(fn('1e308*x'), 1), 1e308);
});

function evaluate(type: string, expression: string, params: Record<string, number> = {}, port = 'out') {
  const doc = {
    version: 1, title: 'calculus', zoom: 1, strokes: [],
    nodes: [
      { id: 'f', type: 'functionSource', x: 0, y: 0, text: expression, params: { a: 2, b: 0, c: 0 } },
      { id: 'x', type: 'slider', x: 0, y: 0, params: { v: 2 } },
      { id: 'calc', type, x: 0, y: 0, params },
    ],
    wires: [
      { id: 'wf', from: 'f', to: 'calc', toPort: 'in' },
      { id: 'wx', from: 'x', to: 'calc', toPort: 'x' },
    ],
  } as CanvasDoc;
  return evalOutput(makeCtx(doc, new Map()), type === 'functionSource' ? 'f' : 'calc', port);
}

test('函数源可输出带参数的函数，而无效表达式不传播', () => {
  const value = evaluate('functionSource', 'a*x^2+b*x+c');
  assert.equal(value?.kind, 'function');
  assert.equal(evaluate('functionSource', 'window.alert(1)'), null);
});

test('标量接线驱动导数观察点，尖点不输出虚假的导数', () => {
  const slope = evaluate('derivative', 'a*x^2', { x: 0 });
  assert.ok(slope?.kind === 'scalar');
  assert.ok(Math.abs(slope.v - 8) < 1e-4);
  assert.equal(evaluate('derivative', 'abs(x-2)'), null);
});

test('积分节点输出带符号积分，面积模式和反向区间含义不同', () => {
  for (const [params, want] of [
    [{ lower: -1, upper: 1, area: 0 }, 0],
    [{ lower: -1, upper: 1, area: 1 }, 1],
    [{ lower: 1, upper: 0, area: 0 }, -0.5],
  ] as const) {
    const result = evaluate('integral', 'x', params);
    assert.ok(result?.kind === 'scalar');
    assert.ok(Math.abs(result.v - want) < 1e-5);
  }
  assert.equal(evaluate('integral', '1/x', { lower: -1, upper: 1 }), null);
});

test('旧版高数流水线可求值，泰勒输出可继续接函数图像且每次新建使用独立对象', () => {
  for (const template of CALCULUS_TEMPLATES) {
    if (template.panorama) continue;
    const doc = calculusTemplateDoc(template.kind);
    const ids = new Set(doc.nodes.map((node) => node.id));
    assert.equal(ids.size, doc.nodes.length);
    assert.ok(doc.wires.every((wire) => ids.has(wire.from) && ids.has(wire.to)));
    const other = calculusTemplateDoc(template.kind);
    assert.ok(other.nodes.every((node) => !ids.has(node.id)));
    const ctx = makeCtx(doc, new Map());
    for (const node of doc.nodes) {
      if (node.type === 'functionSource') assert.equal(evalOutput(ctx, node.id)?.kind, 'function');
      if (node.type === 'derivative') {
        const value = evalOutput(ctx, node.id);
        assert.ok(value?.kind === 'scalar' && Math.abs(value.v - 2) < 1e-4);
      }
      if (node.type === 'taylor') {
        const value = evalOutput(ctx, node.id);
        assert.ok(value?.kind === 'function');
        assert.ok(Math.abs(compileFunction(value)(0.1)! - Math.exp(0.1)) < 1e-5);
      }
      if (node.type === 'integral') assert.equal(evalOutput(ctx, node.id)?.kind, 'scalar');
    }
  }
});
