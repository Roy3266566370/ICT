import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileExpression } from './expr.ts';
import { fitFreehandCurve } from './curveFit.ts';

/** 把函数 f 在画布坐标里画成一条笔迹：W=400px 横向映射 [-4,4]，50px 对应纵轴 1 单位（保持纵横比）。 */
function drawFunction(f: (x: number) => number, n = 160, jitter = 1.5): [number, number][] {
  const points: [number, number][] = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };
  for (let i = 0; i < n; i += 1) {
    const x = -4 + (8 * i) / (n - 1);
    const px = 100 + ((x + 4) / 8) * 400;
    const py = 300 - f(x) * 50 + rand() * jitter;
    points.push([px, py]);
  }
  return points;
}

function drawPoints(points: [number, number][]): [number, number][] {
  return points;
}

function evalFit(source: string, x: number): number {
  const value = compileExpression(source, ['x']).evalOrNull({ x });
  assert.notEqual(value, null, `表达式 ${source} 在 x=${x} 处无法求值`);
  return value!;
}

describe('fitFreehandCurve', () => {
  it('直线笔迹 → affine 族且斜率还原（纵向以笔迹中心为原点）', () => {
    const result = fitFreehandCurve({ points: drawFunction((x) => 0.5 * x + 1) });
    assert.ok(result.fit, `应成功：${result.reason}`);
    assert.equal(result.fit!.family, 'affine');
    // 画布无坐标轴：纵心对齐 y=0，故只要求形状一致 g(x)-g(0) == f(x)-f(0)。
    for (const x of [-4, -1, 2, 4]) {
      const diff = evalFit(result.fit!.source, x) - evalFit(result.fit!.source, 0);
      assert.ok(Math.abs(diff - 0.5 * x) < 0.15, `x=${x} 偏差过大`);
    }
  });

  it('抛物线笔迹 → quadratic 族且形状还原', () => {
    const result = fitFreehandCurve({ points: drawFunction((x) => 0.25 * x * x - 0.5 * x - 1) });
    assert.ok(result.fit, `应成功：${result.reason}`);
    assert.equal(result.fit!.family, 'quadratic');
    for (const x of [-3, 0, 3]) {
      const diff = evalFit(result.fit!.source, x) - evalFit(result.fit!.source, 0);
      const expected = 0.25 * x * x - 0.5 * x;
      assert.ok(Math.abs(diff - expected) < 0.2, `x=${x} 偏差过大`);
    }
  });

  it('S 形三次笔迹 → cubic 族', () => {
    const result = fitFreehandCurve({ points: drawFunction((x) => 0.1 * x * x * x - 0.6 * x) });
    assert.ok(result.fit, `应成功：${result.reason}`);
    assert.equal(result.fit!.family, 'cubic');
    assert.ok(result.fit!.rmse < 0.08);
  });

  it('根号弧笔迹 → sqrt 族', () => {
    const result = fitFreehandCurve({ points: drawFunction((x) => 2 * Math.sqrt((x + 4) / 8)) });
    assert.ok(result.fit, `应成功：${result.reason}`);
    assert.equal(result.fit!.family, 'sqrt');
  });

  it('闭合圆形笔迹 → 明确拒绝（非函数）', () => {
    const points: [number, number][] = [];
    for (let i = 0; i <= 200; i += 1) {
      const t = (2 * Math.PI * i) / 200;
      points.push([300 + 120 * Math.cos(t), 300 + 120 * Math.sin(t)]);
    }
    const result = fitFreehandCurve({ points: drawPoints(points) });
    assert.equal(result.fit, undefined);
    assert.match(result.reason!, /函数/);
  });

  it('高频正弦笔迹 → 明确拒绝（低次族误差过大）', () => {
    const result = fitFreehandCurve({ points: drawFunction((x) => 2 * Math.sin(3.5 * x), 240) });
    assert.equal(result.fit, undefined);
    assert.match(result.reason!, /误差过大/);
  });

  it('过短笔迹 → 拒绝', () => {
    const result = fitFreehandCurve({ points: drawPoints([[10, 10], [20, 12], [30, 11]]) });
    assert.equal(result.fit, undefined);
  });
});
