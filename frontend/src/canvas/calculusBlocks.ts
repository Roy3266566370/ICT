/** 高数/线代自由积木的纯函数内核：函数复合、2×2 SVD、线性方程组与概率采样。 */

import { compileExpression, type ExpressionNode } from '../labs/expr.ts';
import { compileFunction, functionValue, type FunctionValue } from './calculus.ts';
import { makeSeries, type SeriesValue } from './officeBlocks.ts';

export type Matrix2Value = { a: number; b: number; c: number; d: number };

const FUNCTION_VARIABLES = ['x', 'a', 'b', 'c'] as const;

function formatNodeNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const text = Number(value.toPrecision(8)).toString();
  return text;
}

function renderAst(node: ExpressionNode, env: { x?: string; a?: number; b?: number; c?: number }): string {
  if (node.type === 'number') return formatNodeNumber(node.value);
  if (node.type === 'variable') {
    if (node.name === 'x' && env.x !== undefined) return `(${env.x})`;
    if (node.name === 'a' && env.a !== undefined) return `(${formatNodeNumber(env.a)})`;
    if (node.name === 'b' && env.b !== undefined) return `(${formatNodeNumber(env.b)})`;
    if (node.name === 'c' && env.c !== undefined) return `(${formatNodeNumber(env.c)})`;
    return node.name;
  }
  if (node.type === 'unary') return `(${node.op}${renderAst(node.arg, env)})`;
  if (node.type === 'call') return `${node.name}(${node.args.map((arg) => renderAst(arg, env)).join(',')})`;
  return `(${renderAst(node.left, env)}${node.op}${renderAst(node.right, env)})`;
}

function expressionWithParams(value: FunctionValue): string {
  compileFunction(value);
  return renderAst(compileExpression(value.expression, FUNCTION_VARIABLES).ast, { a: value.a, b: value.b, c: value.c });
}

export const COMBINE_OPERATORS = ['f + g', 'f − g', 'f · g', 'f / g', 'f(g(x))'] as const;

/** 组合两个受限函数值；g 的 a/b/c 会替换成数值，输出保留 f 的参数。 */
export function combineFunctions(f: FunctionValue, g: FunctionValue, operator: number): FunctionValue {
  const op = Math.max(0, Math.min(COMBINE_OPERATORS.length - 1, Math.round(operator)));
  const fText = f.expression;
  const gText = expressionWithParams(g);
  let expression: string;
  if (op === 4) {
    compileFunction(f);
    const fAst = compileExpression(f.expression, FUNCTION_VARIABLES).ast;
    expression = renderAst(fAst, { x: gText });
  } else {
    const symbol = op === 0 ? '+' : op === 1 ? '-' : op === 2 ? '*' : '/';
    expression = `(${fText})${symbol}(${gText})`;
  }
  if (expression.length > 500) throw new Error('组合后的函数表达式超过 500 字，请拆分积木');
  return functionValue(expression, { a: f.a, b: f.b, c: f.c });
}

export interface Svd2x2Result {
  u: Matrix2Value;
  sigma: Matrix2Value;
  vt: Matrix2Value;
  s1: number;
  s2: number;
  rank: number;
  condition: number;
}

function multiplyA(m: Matrix2Value, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.b * y, y: m.c * x + m.d * y };
}

export function svd2x2(matrix: Matrix2Value): Svd2x2Result {
  const { a, b, c, d } = matrix;
  const ata00 = a * a + c * c;
  const ata01 = a * b + c * d;
  const ata11 = b * b + d * d;
  const theta = 0.5 * Math.atan2(2 * ata01, ata00 - ata11);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const v1 = { x: cos, y: sin };
  const v2 = { x: -sin, y: cos };
  const av1 = multiplyA(matrix, v1.x, v1.y);
  const av2 = multiplyA(matrix, v2.x, v2.y);
  let s1 = Math.hypot(av1.x, av1.y);
  let s2 = Math.hypot(av2.x, av2.y);
  let u1 = s1 > 1e-10 ? { x: av1.x / s1, y: av1.y / s1 } : { x: 1, y: 0 };
  let u2 = s2 > 1e-10 ? { x: av2.x / s2, y: av2.y / s2 } : { x: -u1.y, y: u1.x };
  if (s1 < s2) {
    [s1, s2] = [s2, s1];
    [u1, u2] = [u2, u1];
    [v1.x, v2.x] = [v2.x, v1.x];
    [v1.y, v2.y] = [v2.y, v1.y];
  }
  const u: Matrix2Value = { a: u1.x, b: u2.x, c: u1.y, d: u2.y };
  const vt: Matrix2Value = { a: v1.x, b: v1.y, c: v2.x, d: v2.y };
  const sigma: Matrix2Value = { a: Math.max(0, s1), b: 0, c: 0, d: Math.max(0, s2) };
  return {
    u,
    sigma,
    vt,
    s1: Math.max(0, s1),
    s2: Math.max(0, s2),
    rank: s1 > 1e-8 ? (s2 > 1e-8 ? 2 : 1) : 0,
    condition: s2 > 1e-10 ? s1 / s2 : Number.POSITIVE_INFINITY,
  };
}

export function multiplyMatrix(m: Matrix2Value, n: Matrix2Value): Matrix2Value {
  return {
    a: m.a * n.a + m.b * n.c,
    b: m.a * n.b + m.b * n.d,
    c: m.c * n.a + m.d * n.c,
    d: m.c * n.b + m.d * n.d,
  };
}

export interface LinearSolution {
  kind: 'unique' | 'infinite' | 'none' | 'leastSquares';
  x: number;
  y: number;
  residual: number;
  rank: number;
  message: string;
}

export function solveLinear2x2(matrix: Matrix2Value, bx: number, by: number): LinearSolution {
  const { a, b, c, d } = matrix;
  const determinant = a * d - b * c;
  const scale = Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  if (Math.abs(determinant) > 1e-9 * scale * scale) {
    const x = (bx * d - b * by) / determinant;
    const y = (a * by - bx * c) / determinant;
    return {
      kind: 'unique', x: finite(x), y: finite(y),
      residual: Math.hypot(a * x + b * y - bx, c * x + d * y - by),
      rank: 2, message: 'det(A) ≠ 0，存在唯一解。',
    };
  }
  const column0 = { x: a, y: c };
  const column1 = { x: b, y: d };
  const norm0 = Math.hypot(column0.x, column0.y);
  const norm1 = Math.hypot(column1.x, column1.y);
  const rank = norm0 > 1e-9 || norm1 > 1e-9 ? 1 : 0;
  if (rank === 0) {
    return Math.hypot(bx, by) < 1e-9
      ? { kind: 'infinite', x: 0, y: 0, residual: 0, rank: 0, message: '零矩阵且 b = 0：任意 (x,y) 都是解。' }
      : { kind: 'none', x: 0, y: 0, residual: Math.hypot(bx, by), rank: 0, message: '零矩阵且 b ≠ 0：方程组无解。' };
  }
  const base = norm0 >= norm1 ? column0 : column1;
  const baseNorm = Math.hypot(base.x, base.y);
  const crossBase = base.x * by - base.y * bx;
  const consistent = Math.abs(crossBase) < 1e-7 * Math.max(1, baseNorm * Math.hypot(bx, by));
  if (consistent) {
    return {
      kind: 'infinite', x: 0, y: 0, residual: 0, rank: 1,
      message: 'A 的列线性相关且 b 在列空间中：存在无穷多解。',
    };
  }
  const projection = (base.x * bx + base.y * by) / Math.max(1e-12, baseNorm * baseNorm);
  const x = base === column0 ? projection : 0;
  const y = base === column1 ? projection : 0;
  const residual = Math.hypot(a * x + b * y - bx, c * x + d * y - by);
  return {
    kind: 'leastSquares', x: finite(x), y: finite(y), residual: finite(residual), rank: 1,
    message: 'b 不在列空间中：显示 A 的列空间最小二乘投影。',
  };
}

function finite(value: number): number {
  return Number.isFinite(value) ? Math.max(-1e12, Math.min(1e12, value)) : 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSample(random: () => number): number {
  const u1 = Math.max(1e-9, random());
  const u2 = random();
  return Math.max(-4, Math.min(4, Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)));
}

function poissonSample(random: () => number, lambda: number): number {
  const limit = Math.exp(-lambda);
  let product = 1;
  let count = 0;
  do {
    count += 1;
    product *= random();
  } while (product > limit && count < 80);
  return count - 1;
}

function combination(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const choose = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= choose; index += 1) result = result * (n - choose + index) / index;
  return result;
}

function binomialPmf(n: number, k: number, p: number): number {
  return combination(n, k) * p ** k * (1 - p) ** (n - k);
}

function poissonPmf(lambda: number, k: number): number {
  let factorial = 1;
  for (let index = 2; index <= k; index += 1) factorial *= index;
  return Math.exp(-lambda) * lambda ** k / factorial;
}

export interface ProbabilityParams {
  distribution: number;
  samples: number;
  bins: number;
  seed: number;
}

export interface ProbabilityResult {
  series: SeriesValue;
  mean: number;
  spread: number;
}

export function probabilitySeries(params: Partial<ProbabilityParams>): ProbabilityResult {
  const distribution = Math.round(Math.max(0, Math.min(3, params.distribution ?? 0)));
  const count = Math.round(Math.max(20, Math.min(2000, params.samples ?? 400)));
  const bins = Math.round(Math.max(6, Math.min(40, params.bins ?? 24)));
  const seed = Math.round(Number.isFinite(params.seed) ? params.seed! : 7);
  const random = mulberry32(seed);
  const samples: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if (distribution === 0) samples.push(normalSample(random));
    else if (distribution === 1) samples.push(Array.from({ length: 10 }, () => random() < 0.5 ? 1 : 0).reduce<number>((sum, value) => sum + value, 0));
    else if (distribution === 2) samples.push(poissonSample(random, 4));
    else samples.push(Math.min(12, -Math.log(Math.max(1e-9, random()))));
  }
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const spread = Math.sqrt(samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length);
  if (distribution === 1 || distribution === 2) {
    const low = Math.round(Math.min(...samples));
    const high = Math.round(Math.max(...samples));
    const labels: string[] = [];
    const observed: number[] = [];
    const theory: number[] = [];
    for (let value = Math.max(0, low); value <= Math.min(high, low + 59); value += 1) {
      labels.push(String(value));
      observed.push(samples.filter((sample) => Math.round(sample) === value).length / samples.length);
      theory.push(distribution === 1 ? binomialPmf(10, value, 0.5) : poissonPmf(4, value));
    }
    return {
      series: makeSeries(distribution === 1 ? '二项分布采样' : '泊松分布采样', labels, observed, [{ name: '理论概率', values: theory }]),
      mean,
      spread,
    };
  }
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const width = Math.max(1e-6, (max - min) / bins);
  const labels: string[] = [];
  const observed: number[] = [];
  const theory: number[] = [];
  for (let index = 0; index < bins; index += 1) {
    const lower = min + index * width;
    const upper = lower + width;
    const middle = (lower + upper) / 2;
    labels.push(middle.toFixed(2));
    observed.push(samples.filter((sample) => sample >= lower && (index === bins - 1 ? sample <= upper : sample < upper)).length / samples.length / width);
    theory.push(distribution === 0
      ? Math.exp(-(middle ** 2) / 2) / Math.sqrt(2 * Math.PI)
      : Math.max(0, Math.exp(-Math.max(0, middle))));
  }
  return {
    series: makeSeries(distribution === 0 ? '正态分布采样' : '指数分布采样', labels, observed, [{ name: '理论密度', values: theory }]),
    mean,
    spread,
  };
}
