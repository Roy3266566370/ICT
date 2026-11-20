/**
 * 自由手绘曲线 → 初等表达式（纯前端、确定性、可核查）。
 *
 * 流程：笔迹按 x 单调化并重采样 → 最小二乘拟合 affine/quadratic/cubic/sqrt 平移族
 * → 残差诚实打分 → 拟合失败明确拒绝，绝不伪造一个“看起来像”的表达式。
 *
 * 设计红线：不接受任意分段拼接——表达式语言只支持单表达式，
 * 所以一条笔迹只能拟合成一个表达式；多条笔迹由调用方逐条处理。
 */

export type CurveFamily = 'affine' | 'quadratic' | 'cubic' | 'sqrt';

export interface CurveFitResult {
  family: CurveFamily;
  /** 可直接喂给 compileExpression(source, ['x']) 的表达式。 */
  source: string;
  /** 拟合域 [x0, x1]（笔迹横向范围映射后的区间）。 */
  domain: [number, number];
  /** 归一化空间内的均方根误差（相对 y 幅度）。 */
  rmse: number;
  /** 相对最大 |y| 的最大绝对残差，用于残差可视化。 */
  maxError: number;
  /** 采样点（拟合域内均匀分布）与拟合值，供 UI 叠画对照。 */
  samples: { x: number; drawn: number; fitted: number }[];
}

export interface CurveFitInput {
  /** 画布坐标点（y 轴向下）。 */
  points: [number, number][];
}

const MIN_SPAN = 24;
const SAMPLE_COUNT = 96;
/** 相对 y 幅度超过这个 RMSE 就拒绝——不拟合胜过假拟合。 */
const RMSE_REJECT = 0.12;
const FAMILY_LABELS: Record<CurveFamily, string> = {
  affine: '直线',
  quadratic: '抛物线',
  cubic: '三次曲线',
  sqrt: '根式曲线',
};

function rational(value: number, maxDenominator = 1000): string {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-12) return '0';
  for (let denominator = 1; denominator <= maxDenominator; denominator += 1) {
    const numerator = Math.round(value * denominator);
    if (Math.abs(value - numerator / denominator) <= 1e-9) {
      const sign = numerator < 0 ? '-' : '';
      const absolute = Math.abs(numerator);
      return denominator === 1 ? `${sign}${absolute}` : `${sign}${absolute}/${denominator}`;
    }
  }
  return String(Number(value.toFixed(4)));
}

function formatPoly(terms: [number, string][]): string {
  let source = '';
  for (const [coefficient, symbol] of terms) {
    if (Math.abs(coefficient) < 1e-10) continue;
    const absolute = Math.abs(coefficient);
    const body = symbol === '1' ? rational(absolute) : absolute === 1 ? symbol : `${rational(absolute)}*${symbol}`;
    source += source ? (coefficient < 0 ? ' - ' : ' + ') + body : (coefficient < 0 ? '-' : '') + body;
  }
  return source || '0';
}

/** 解小线性方程组（高斯消元 + 微小岭正则防奇异）。 */
function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => {
    const copy = [...row];
    copy[i] = (copy[i] ?? 0) + 1e-10;
    return [...copy, rhs[i]!];
  });
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(a[pivot]![col]!) < 1e-14) return null;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row]![col]! / a[col]![col]!;
      for (let k = col; k <= n; k += 1) a[row]![k] = a[row]![k]! - factor * a[col]![k]!;
    }
  }
  const out = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = a[row]![n]!;
    for (let k = row + 1; k < n; k += 1) sum -= a[row]![k]! * out[k]!;
    out[row] = sum / a[row]![row]!;
  }
  return out;
}

/** 按基函数做最小二乘：basis 每项是 u→值，u∈[0,1]。返回系数或 null。 */
function leastSquares(us: number[], vs: number[], basis: ((u: number) => number)[]): number[] | null {
  const m = basis.length;
  const gram = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const rhs = new Array<number>(m).fill(0);
  for (let i = 0; i < us.length; i += 1) {
    const row = basis.map((fn) => fn(us[i]!));
    for (let j = 0; j < m; j += 1) {
      rhs[j]! += row[j]! * vs[i]!;
      for (let k = j; k < m; k += 1) gram[j]![k]! += row[j]! * row[k]!;
    }
  }
  for (let j = 0; j < m; j += 1) for (let k = 0; k < j; k += 1) gram[j]![k] = gram[k]![j]!;
  return solveLinear(gram, rhs);
}

/**
 * 把一条笔迹拟合成表达式。失败返回 null 并给出 reason——
 * 手绘曲线天然病态，误差过大时宁缺毋滥。
 */
export function fitFreehandCurve(input: CurveFitInput): { fit: CurveFitResult; reason?: never } | { fit?: never; reason: string } {
  const raw = input.points;
  if (raw.length < 6) return { reason: '笔迹太短，请画出一条完整的曲线。' };
  const xs = raw.map((p) => p[0]);
  const ys = raw.map((p) => p[1]);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  if (xMax - xMin < MIN_SPAN) return { reason: '曲线横向跨度太小，无法可靠拟合为函数。' };

  // 按 x 单调化：同一 x 桶内取 y 中位数，保证是函数而非闭合曲线。
  const buckets = new Map<number, number[]>();
  for (const [px, py] of raw) {
    const key = Math.round(px / 2) * 2;
    const list = buckets.get(key) ?? [];
    list.push(py);
    buckets.set(key, list);
  }
  const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  if (sorted.length < 6) return { reason: '笔迹在横向上重叠过多，无法解释为函数图像。' };
  // 覆盖率：笔迹必须大致连续地横跨其包围盒，否则像是散点或折返线。
  const coverage = sorted.length / Math.max(1, Math.round((xMax - xMin) / 2));
  if (coverage < 0.4) return { reason: '曲线不连续或折返过多，无法解释为函数图像（试试分开画）。' };
  // 多值性：闭合/折返曲线在同一 x 桶内有多个相差很远的 y（如圆、8 字），
  // 取中位数会塌缩成假函数，必须识别出来拒绝。
  const ySpanAll = Math.max(...ys) - Math.min(...ys);
  if (ySpanAll >= MIN_SPAN / 2) {
    const ambiguous = sorted.filter(([, list]) => Math.max(...list) - Math.min(...list) > ySpanAll * 0.3).length;
    if (ambiguous / sorted.length > 0.15) {
      return { reason: '这条笔迹不是函数图像（同一横坐标有多个高度，如闭合曲线），无法拟合为表达式。' };
    }
  }

  const xsSorted = sorted.map(([x]) => x);
  const ysSorted = sorted.map(([, list]) => {
    const copy = [...list].sort((a, b) => a - b);
    return copy[Math.floor(copy.length / 2)]!;
  });

  // 归一化：u∈[0,1] 对应 x∈[X0,X1] = [-4,4]（与函数图像默认视窗同量级），
  // y 保持纵横比映射为 v，防止把矮扁曲线夸成高幅振荡。
  const X0 = -4, X1 = 4;
  const yMid = (Math.max(...ysSorted) + Math.min(...ysSorted)) / 2;
  const scale = (X1 - X0) / (xMax - xMin);
  const us = xsSorted.map((x) => (x - xMin) / (xMax - xMin));
  const vs = ysSorted.map((y) => (yMid - y) * scale);

  // 均匀重采样，避免笔画速度影响权重。
  const su: number[] = [], sv: number[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i += 1) {
    const u = i / (SAMPLE_COUNT - 1);
    let j = 0;
    while (j < us.length - 2 && us[j + 1]! < u) j += 1;
    const u0 = us[j]!, u1 = us[j + 1]!;
    const t = u1 > u0 ? (u - u0) / (u1 - u0) : 0;
    su.push(u);
    sv.push(vs[j]! + t * (vs[j + 1]! - vs[j]!));
  }

  const amplitude = Math.max(1, ...sv.map((v) => Math.abs(v)));

  interface Candidate {
    family: CurveFamily;
    predict: (u: number) => number;
    build: () => string;
    params: number;
  }
  const candidates: Candidate[] = [];
  const poly = (degree: number, family: CurveFamily): void => {
    const basis = Array.from({ length: degree + 1 }, (_, k) => (u: number) => u ** k);
    const coef = leastSquares(su, sv, basis);
    if (!coef) return;
    candidates.push({
      family,
      params: degree + 1,
      predict: (u) => coef.reduce((sum, c, k) => sum + c * u ** k, 0),
      build: () => formatPoly(coef.map((c, k) => {
        // u = (x - X0)/(X1-X0) = (x+4)/8：低次项直接展开成 x 的多项式。
        const terms: [number, string][] = [];
        for (let j = 0; j <= k; j += 1) {
          const binomial = binom(k, j);
          // u^k = ((x - X0)/(X1-X0))^k；对 X0=-4、X1=8 展开：((x+4)/8)^k
          const pow = (X1 - X0) ** -k * binomial * (-X0) ** (k - j);
          terms.push([c * pow, j === 0 ? '1' : j === 1 ? 'x' : `x^${j}`]);
        }
        return terms;
      }).reduce<[number, string][]>((acc, list) => {
        for (const [c, s] of list) {
          const hit = acc.find((entry) => entry[1] === s);
          if (hit) hit[0] += c; else acc.push([c, s]);
        }
        return acc;
      }, [])),
    });
  };
  poly(1, 'affine');
  poly(2, 'quadratic');
  poly(3, 'cubic');
  // sqrt 平移族 v = c·sqrt(u)+d：对 t=sqrt(u) 做线性回归即可。
  {
    const coef = leastSquares(su, sv, [(u) => Math.sqrt(u), () => 1]);
    if (coef) {
      const c = coef[0]!, d = coef[1]!;
      candidates.push({
        family: 'sqrt',
        params: 2,
        predict: (u) => c * Math.sqrt(u) + d,
        build: () => formatPoly([[c, 'sqrt((x+4)/8)'], [d, '1']]),
      });
    }
    const coefR = leastSquares(su, sv, [(u) => Math.sqrt(Math.max(0, 1 - u)), () => 1]);
    if (coefR) {
      const c = coefR[0]!, d = coefR[1]!;
      candidates.push({
        family: 'sqrt',
        params: 2,
        predict: (u) => c * Math.sqrt(Math.max(0, 1 - u)) + d,
        build: () => formatPoly([[c, 'sqrt((4-x)/8)'], [d, '1']]),
      });
    }
  }

  if (!candidates.length) return { reason: '拟合失败：曲线形状超出可解参数族。' };

  let best: { candidate: Candidate; rmse: number; maxError: number; score: number } | null = null;
  for (const candidate of candidates) {
    let sse = 0, maxError = 0;
    for (let i = 0; i < su.length; i += 1) {
      const error = sv[i]! - candidate.predict(su[i]!);
      sse += error * error;
      maxError = Math.max(maxError, Math.abs(error));
    }
    const rmse = Math.sqrt(sse / su.length) / amplitude;
    // 简单优先：每多一个参数需要 15% 的误差改善才值得。
    const score = rmse * (1 + 0.15 * (candidate.params - 1));
    if (!best || score < best.score) {
      best = { candidate, rmse, maxError: maxError / amplitude, score };
    }
  }
  if (!best) return { reason: '拟合失败：曲线形状超出可解参数族。' };
  if (best.rmse > RMSE_REJECT) {
    return { reason: `拟合误差过大（RMSE ${best.rmse.toFixed(2)}）：这条曲线不能用直线/抛物线/三次/根式可靠解释，请重画或拆成多条。` };
  }

  const source = best.candidate.build();
  const samples = su.map((u, i) => ({
    x: X0 + u * (X1 - X0),
    drawn: sv[i]!,
    fitted: best!.candidate.predict(u),
  }));
  return {
    fit: {
      family: best.candidate.family,
      source,
      domain: [X0, X1],
      rmse: best.rmse,
      maxError: best.maxError,
      samples,
    },
  };
}

function binom(n: number, k: number): number {
  let result = 1;
  for (let i = 0; i < k; i += 1) result = (result * (n - i)) / (i + 1);
  return result;
}

export function curveFamilyLabel(family: CurveFamily): string {
  return FAMILY_LABELS[family];
}
