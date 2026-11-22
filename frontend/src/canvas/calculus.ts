/** 一元实函数数值实验。复用受限解析器，不进行动态代码执行。 */
import { compileExpression } from '../labs/expr.ts';
import type { LabModel } from '../labs/types.ts';
import { evaluateSandboxRegion, evaluatePolarSandbox, type SandboxRegionResult, type PolarSandboxResult } from '../labs/doubleIntegral.ts';
import type { PortValue } from './types.ts';
import { localSeries } from './series.ts';

export type { SandboxRegionResult, PolarSandboxResult };

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
/* ---------- 二元函数端口 ---------- */

export type Function2dValue = Extract<PortValue, { kind: 'function2d' }>;
export type RealFunction2d = (x: number, y: number) => number | null;

export function compileFunction2d(value: Function2dValue): RealFunction2d {
  if (value.expression.length > 500) throw new Error('表达式请控制在 500 字以内');
  const compiled = compileExpression(value.expression, ['x', 'y', 'a', 'b']);
  return (x, y) => compiled.evalOrNull({ x, y, a: value.a, b: value.b });
}

export function function2dValue(expression: string, params: Record<string, number>): Function2dValue {
  const result: Function2dValue = { kind: 'function2d', expression, a: params.a ?? 1, b: params.b ?? 1 };
  compileFunction2d(result);
  return result;
}

/* ---------- ε-δ 邻域带 ---------- */

export interface EpsilonDeltaBand {
  eps: number;
  level: number | null;
  delta: number | null;
  samples: { x: number; value: number | null; inside: boolean }[];
  message: string;
}

/** 向下保留指定位数的有效数字，用于把通过检验的 δ 收缩成语义化读数。 */
function floorToSignificant(value: number, digits: number): number {
  if (!Number.isFinite(value) || value <= 0) return value;
  const scale = 10 ** (digits - 1 - Math.floor(Math.log10(value)));
  return Math.floor(value * scale + 1e-9) / scale;
}

const EPSILON_DELTA_TOLERANCE = 1e-12;

/**
 * ε-δ 邻域：候选 δ 从 1 递减到 1e-6，取第一个使 x0±δ 内全部采样点进入 L±ε 的最大 δ。
 * 只给出数值证据，不声称证明极限存在。
 */
export function epsilonDeltaBand(
  f: RealFunction,
  x0: number,
  eps: number,
  domain?: readonly [number, number],
): EpsilonDeltaBand {
  const lo = domain?.[0] ?? x0 - 2;
  const hi = domain?.[1] ?? x0 + 2;
  const level = approachLimit(f, x0, 0).candidate;
  const candidates = Array.from({ length: 61 }, (_, i) => 10 ** (-i * 0.1));
  const band = (delta: number) => {
    const samples: EpsilonDeltaBand['samples'] = [];
    for (let i = 0; i < 60; i += 1) {
      const x = x0 - delta + (2 * delta * i) / 59;
      if (x < lo || x > hi) continue;
      if (Math.abs(x - x0) < delta * 1e-6) continue;
      const value = f(x);
      const inside =
        level !== null && value !== null && Number.isFinite(value)
        && Math.abs(value - level) <= Math.max(0, eps) + EPSILON_DELTA_TOLERANCE;
      samples.push({ x, value, inside });
    }
    return samples;
  };
  if (level === null) {
    return { eps, level: null, delta: null, samples: band(candidates[0]!), message: '极限候选不稳定：x0 附近取不到同一有限值，无法给出对应的 δ' };
  }
  let accepted: number | null = null;
  for (const delta of candidates) {
    const samples = band(delta);
    if (samples.length > 0 && samples.every((item) => item.inside)) {
      accepted = delta;
      break;
    }
  }
  if (accepted === null) {
    return {
      eps, level, delta: null, samples: band(candidates[0]!),
      message: '即使 δ 收缩到 1e-6，x0 邻域内仍有采样点越出 L±ε：可能不连续或 ε 过小',
    };
  }
  const delta = floorToSignificant(accepted, 2);
  return { eps, level, delta, samples: band(delta), message: `δ=${delta} 时 x0 邻域内全部采样点落在 L±ε 带内（数值证据，不构成 ε-δ 证明）` };
}

/* ---------- 变上限积分 ---------- */

export interface AntiderivativeSample {
  x: number;
  f: number | null;
  integral: number | null;
  slopeError: number | null;
}

/** 复合 Simpson（段数为偶数），任一样本无定义即整体视为不可算。 */
function compositeSimpson(f: RealFunction, a: number, b: number, segments: number): number | null {
  if (a === b) return 0;
  const n = segments % 2 === 0 ? segments : segments + 1;
  const h = (b - a) / n;
  let total = 0;
  for (let i = 0; i <= n; i += 1) {
    const value = f(a + i * h);
    if (value === null || !Number.isFinite(value)) return null;
    total += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * value;
  }
  return (total * h) / 3;
}

/**
 * 变上限积分采样：每点以 128 段 Simpson 求 F(x)=∫ₐˣ f，
 * 并用中心差分 F'(x) 与 f(x) 的偏差检验基本定理。
 */
export function antiderivativeSamples(f: RealFunction, a: number, xMin: number, xMax: number, n = 241): AntiderivativeSample[] {
  const count = Math.max(2, Math.min(2001, Math.round(Number.isFinite(n) ? n : 241)));
  const h = 1e-4;
  return Array.from({ length: count }, (_, i) => {
    const x = xMin + ((xMax - xMin) * i) / (count - 1);
    const value = f(x);
    const integral = compositeSimpson(f, a, x, 128);
    const left = compositeSimpson(f, a, x - h, 128);
    const right = compositeSimpson(f, a, x + h, 128);
    const slopeError =
      left === null || right === null || value === null || !Number.isFinite(value)
        ? null
        : Math.abs((right - left) / (2 * h) - value);
    return { x, f: value, integral, slopeError };
  });
}

/* ---------- 傅里叶级数 ---------- */

export type Waveform = 'square' | 'triangle' | 'sawtooth';

const FOURIER_FACTOR: Record<Waveform, number> = {
  square: 4 / Math.PI,
  triangle: 8 / Math.PI ** 2,
  sawtooth: 2 / Math.PI,
};

/** 周期 2π、仅正弦项的部分和，N 为最高谐波次数。 */
export function fourierPartialSum(waveform: Waveform, n: number, x: number): number {
  const terms = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  let sum = 0;
  for (let k = 1; k <= terms; k += 1) {
    if (waveform === 'square') {
      if (k % 2 === 0) continue;
      sum += Math.sin(k * x) / k;
    } else if (waveform === 'triangle') {
      if (k % 2 === 0) continue;
      const sign = ((k - 1) / 2) % 2 === 0 ? 1 : -1;
      sum += (sign * Math.sin(k * x)) / (k * k);
    } else {
      sum += ((k % 2 === 1 ? 1 : -1) * Math.sin(k * x)) / k;
    }
  }
  return FOURIER_FACTOR[waveform] * sum;
}

export function fourierSpectrum(waveform: Waveform, n: number): { harmonic: number; amplitude: number }[] {
  const terms = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  const spectrum: { harmonic: number; amplitude: number }[] = [];
  for (let k = 1; k <= terms; k += 1) {
    if (waveform !== 'sawtooth' && k % 2 === 0) continue;
    const amplitude =
      waveform === 'square'
        ? 4 / (Math.PI * k)
        : waveform === 'triangle'
          ? 8 / (Math.PI ** 2 * k * k)
          : 2 / (Math.PI * k);
    spectrum.push({ harmonic: k, amplitude });
  }
  return spectrum;
}

export function fourierSamples(waveform: Waveform, n: number, min: number, max: number, count = 241): { x: number; y: number }[] {
  const points = Math.max(2, Math.min(2001, Math.round(Number.isFinite(count) ? count : 241)));
  return Array.from({ length: points }, (_, i) => {
    const x = min + ((max - min) * i) / (points - 1);
    return { x, y: fourierPartialSum(waveform, n, x) };
  });
}

/* ---------- 斜率场与 RK4 ---------- */

export interface SlopeFieldGrid {
  min: number;
  max: number;
  xs: number[];
  ys: number[];
  slopes: (number | null)[][];
}

export function slopeFieldGrid(exprXY: string, min = -3, max = 3, n = 15): SlopeFieldGrid {
  const compiled = compileExpression(exprXY, ['x', 'y']);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const count = Math.max(2, Math.min(61, Math.round(Number.isFinite(n) ? n : 15)));
  const axis = (i: number) => lo + ((hi - lo) * i) / (count - 1);
  const xs = Array.from({ length: count }, (_, i) => axis(i));
  const ys = Array.from({ length: count }, (_, i) => axis(i));
  const slopes = xs.map((x) =>
    ys.map((y) => {
      const value = compiled.evalOrNull({ x, y });
      return value !== null && Number.isFinite(value) ? (value === 0 ? 0 : value) : null;
    }),
  );
  return { min: lo, max: hi, xs, ys, slopes };
}

/** 四阶 Runge–Kutta：step 夹在 [1e-4,0.5]、steps 夹在 [1,2000]，返回 steps+1 个点。 */
export function integrateOdeRK4(exprXY: string, x0: number, y0: number, step: number, steps: number): { x: number; y: number }[] {
  const compiled = compileExpression(exprXY, ['x', 'y']);
  const derivative = (x: number, y: number) => compiled.evalOrNull({ x, y }) ?? NaN;
  const h = Math.min(0.5, Math.max(1e-4, Number.isFinite(step) ? step : 1e-4));
  const count = Math.max(1, Math.min(2000, Math.round(Number.isFinite(steps) ? steps : 1)));
  const points = [{ x: x0, y: y0 }];
  let y = y0;
  for (let i = 0; i < count; i += 1) {
    const x = x0 + i * h;
    const k1 = derivative(x, y);
    const k2 = derivative(x + h / 2, y + (h / 2) * k1);
    const k3 = derivative(x + h / 2, y + (h / 2) * k2);
    const k4 = derivative(x + h, y + h * k3);
    y += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    points.push({ x: x + h, y });
  }
  return points;
}

/* ---------- 梯度与方向导数 ---------- */

export interface Gradient2d {
  value: number;
  fx: number;
  fy: number;
}

/** 中心差分梯度；任一侧无定义时该分量为 NaN，不伪装成 0。 */
export function gradient2d(f: RealFunction2d, x: number, y: number, h = 1e-5): Gradient2d {
  const difference = (xa: number, ya: number, xb: number, yb: number) => {
    const left = f(xa, ya);
    const right = f(xb, yb);
    if (left === null || right === null || !Number.isFinite(left) || !Number.isFinite(right)) return NaN;
    return (right - left) / (2 * h);
  };
  const value = f(x, y);
  return {
    value: value === null || !Number.isFinite(value) ? NaN : value,
    fx: difference(x - h, y, x + h, y),
    fy: difference(x, y - h, x, y + h),
  };
}

export function directionDerivative(g: Gradient2d, theta: number): number {
  return g.fx * Math.cos(theta) + g.fy * Math.sin(theta);
}

/* ---------- 二重积分沙盒 ---------- */

/** 拖拽探索用的直角条带模型：外层 y、内层 x 均取单位区间。 */
export function sandboxModel(integrand: string): LabModel {
  return {
    engine: 'sandbox',
    subject: 'calculus',
    region_kind: 'strip',
    outer_variable: 'y',
    outer_bounds: ['0', '1'],
    integrand,
    inner_bounds_tex: ['0', '1'],
  } as LabModel;
}

export interface PolarBounds { theta0?: number; theta1?: number; rMax?: number }

/** 拖拽探索用的极坐标模型：默认 θ∈[0,2π]、r∈[0,1]，Jacobian 已并入被积函数。 */
export function polarSandboxModel(transformedIntegrand: string, bounds: PolarBounds = {}): LabModel {
  const theta0 = Number.isFinite(bounds.theta0) ? bounds.theta0! : 0;
  const theta1 = Number.isFinite(bounds.theta1) ? bounds.theta1! : Math.PI * 2;
  const rMax = Number.isFinite(bounds.rMax) && (bounds.rMax ?? 0) > 0 ? bounds.rMax! : 1;
  return {
    engine: 'sandbox',
    subject: 'calculus',
    region_kind: 'polar',
    polar: {
      theta_bounds: [String(theta0), String(theta1)],
      r_bounds: ['0', String(rMax)],
      jacobian: 'r',
      transformed_integrand: transformedIntegrand,
      inner_integral: '',
      exact: '',
      answer_value: 0,
    },
  } as LabModel;
}

export function rectSandbox(integrand: string, n: number, slice?: number): SandboxRegionResult {
  return evaluateSandboxRegion(sandboxModel(integrand), ['0', '1'], slice === undefined ? { n } : { n, slice });
}

export function polarSandbox(transformedIntegrand: string, n: number, theta?: number, bounds: PolarBounds = {}): PolarSandboxResult {
  const theta0 = Number.isFinite(bounds.theta0) ? bounds.theta0! : 0;
  const theta1 = Number.isFinite(bounds.theta1) ? bounds.theta1! : Math.PI * 2;
  const rMax = Number.isFinite(bounds.rMax) && (bounds.rMax ?? 0) > 0 ? bounds.rMax! : 1;
  const region = { theta: [theta0, theta1] as [number, number], r: ['0', String(rMax)] as [string, string] };
  return evaluatePolarSandbox(polarSandboxModel(transformedIntegrand, { theta0, theta1, rMax }), region,
    theta === undefined ? { n } : { n, theta });
}
