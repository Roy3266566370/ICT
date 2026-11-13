/** 一元实函数数值实验。复用受限解析器，不进行动态代码执行。 */
import { compileExpression } from '../labs/expr.ts';
import type { PortValue } from './types.ts';
import { localSeries } from './series.ts';

export type FunctionValue = Extract<PortValue, { kind: 'function' }>;
export type RealFunction = ((x: number) => number | null) & { series?: (center: number, order: number) => number[] };

export function compileFunction(value: FunctionValue): RealFunction {
  if (value.expression.length > 500) throw new Error('表达式请控制在 500 字以内');
  const compiled = compileExpression(value.expression, ['x', 'a', 'b', 'c']);
  return Object.assign((x: number) => compiled.evalOrNull({ x, a: value.a, b: value.b, c: value.c }), {
    series: (center: number, order: number) => localSeries(compiled.ast, { x: center, a: value.a, b: value.b, c: value.c }, order),
  });
}

export function functionValue(expression: string, params: Record<string, number>): FunctionValue {
  const result: FunctionValue = { kind: 'function', expression, a: params.a ?? 1, b: params.b ?? 0, c: params.c ?? 0 };
  compileFunction(result);
  return result;
}

export function finiteAt(f: RealFunction, x: number): number {
  const value = f(x);
  if (value === null || !Number.isFinite(value)) throw new Error(`x=${Number(x.toPrecision(5))} 处无有限实数值，请检查定义域`);
  return value;
}

/** 自动微分并核对左右分支，避免把 |x| 的对称差分 0 当作导数。 */
export function derivativeAt(f: RealFunction, x: number): number {
  finiteAt(f, x);
  if (!f.series) throw new Error('请使用函数源或泰勒输出进行自动微分');
  return f.series(x, 1)[1]!;
}

export interface IntegralResult {
  sum: number; reference: number; error: number; dx: number;
  rectangles: { x: number; y: number; width: number }[];
}

export function integrate(f: RealFunction, lower: number, upper: number, count: number, method = 1, area = false): IntegralResult {
  if (![lower, upper, count].every(Number.isFinite)) throw new Error('积分区间与分割数必须为有限数');
  const n = Math.max(1, Math.min(200, Math.round(count)));
  const lo = Math.min(lower, upper), hi = Math.max(lower, upper);
  const sign = area || upper >= lower ? 1 : -1;
  const dx = (hi - lo) / n;
  const value = (x: number) => { const y = finiteAt(f, x); return area ? Math.abs(y) : y; };
  // 有限闭区间采样；碰到奇点拒绝计算，不把主值冒充定积分。
  const steps = 1024;
  let reference = 0;
  for (let i = 0; i <= steps; i++) {
    reference += (i === 0 || i === steps ? 1 : i % 2 ? 4 : 2) * value(lo + (hi - lo) * i / steps);
  }
  reference *= sign * (hi - lo) / (3 * steps);
  const rectangles = Array.from({ length: n }, (_, i) => {
    const x = lo + i * dx;
    return { x, y: value(x + dx * (method === 0 ? 0 : method === 2 ? 1 : 0.5)), width: dx };
  });
  const sum = sign * rectangles.reduce((total, rect) => total + rect.y * dx, 0);
  if (!Number.isFinite(sum) || !Number.isFinite(reference)) throw new Error('结果超出有限数范围，请缩小区间');
  return { sum, reference, error: Math.abs(sum - reference), dx, rectangles };
}

export interface LimitResult {
  rows: { h: number; left: number | null; right: number | null }[];
  candidate: number | null;
  message: string;
}

/** 只输出样本稳定时的数值候选，不声称证明存在性。side: -1 左、0 双侧、1 右。 */
export function approachLimit(f: RealFunction, x: number, side = 0): LimitResult {
  const rows = Array.from({ length: 6 }, (_, i) => {
    const h = 10 ** (-i - 1);
    return { h, left: f(x - h), right: f(x + h) };
  });
  const tail = rows.slice(-3);
  const samples = tail.flatMap((row) => side < 0 ? [row.left] : side > 0 ? [row.right] : [row.left, row.right]);
  if (samples.some((v) => v === null || !Number.isFinite(v))) {
    return { rows, candidate: null, message: '所选方向存在无定义样本；可切换单侧观察' };
  }
  const numbers = samples as number[];
  const mean = numbers.reduce((s, v) => s + v, 0) / numbers.length;
  if (Math.max(...numbers) - Math.min(...numbers) > 0.002 * Math.max(1, Math.abs(mean))) {
    return { rows, candidate: null, message: '样本尚未趋于同一有限值：检查跳跃、发散或振荡' };
  }
  return { rows, candidate: mean, message: '数值趋近候选，仅作观察证据，不构成极限存在性的证明' };
}

/** 截断幂级数自动微分求局部泰勒系数，最高五阶。 */
export function taylorPolynomial(f: RealFunction, center: number, degree: number): { coefficients: number[]; value: FunctionValue } {
  const order = Math.max(1, Math.min(5, Math.round(degree)));
  finiteAt(f, center);
  if (!f.series) throw new Error('请连接函数源进行泰勒展开');
  const coefficients = f.series(center, order);
  const expression = coefficients.map((v, k) => `(${v.toPrecision(12)})*(x-(${center}))^${k}`).join('+');
  return { coefficients, value: functionValue(expression, {}) };
}
