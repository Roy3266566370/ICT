/**
 * 四类题目的前端确定性计算。
 *
 * 图形、轨迹、时间轴和讲解侧栏读取同一份结果。后端会在保存时用 Python 内核
 * 重新计算同一组参数并附上执行轨迹；这里的实现保持同一更新规则，便于即时交互。
 */

import { clamp, compileExpression, formatNumber } from './expr.ts';
import { evaluateDoubleIntegral } from './doubleIntegral.ts';
import { evaluateFunctionStudy, evaluateHigherDerivative, evaluateLimit, evaluateTaylor } from './analysis.ts';
import { evaluateOde } from './ode.ts';
import { evaluateFourierSeries, evaluatePowerSeries, evaluateSeriesConvergence } from './series.ts';
import { evaluateSpace } from './space.ts';
import { evaluateProof } from './proof.ts';
import { evaluateConstrainedExtrema } from './constrainedExtrema.ts';
import type {
  BfsResult,
  BfsResultFrame,
  CalculusPoint,
  CalculusRect,
  CalculusResult,
  DlFrame,
  DlResult,
  LabCheck,
  LabModel,
  LabProblem,
  LabResult,
  LabResultFrame,
  LabResultMetric,
  OptimizationPointFrame,
  OptimizationResult,
} from './types.ts';
import { readNumber } from './types.ts';
import { evaluateHeap } from './heap.ts';
import { evaluateLinAlg } from './linalg.ts';
import { evaluateOs } from './opsys.ts';
import { evaluateExamMath } from './examMath.ts';

type Params = Record<string, unknown>;

function num(params: Params, key: string, fallback: number): number {
  return readNumber(params[key], fallback);
}

function defaultNumber(model: LabModel, key: string, fallback: number): number {
  return readNumber(model.defaults[key], fallback);
}

function metric(id: string, label: string, value: string, tone?: LabResultMetric['tone']): LabResultMetric {
  return { id, label, value, tone };
}

function check(id: string, label: string, status: LabCheck['status'], detail: string): LabCheck {
  return { id, label, status, detail };
}

function frame(
  index: number,
  label: string,
  detail: string,
  values: Record<string, unknown>,
): LabResultFrame {
  return { index, label, detail, values };
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/* -------------------------------------------------------------------------- */
/* 微积分                                                                     */
/* -------------------------------------------------------------------------- */

function simpson(
  evaluate: (x: number) => number | null,
  lower: number,
  upper: number,
  intervals = 2000,
): number | null {
  const n = intervals % 2 === 0 ? intervals : intervals + 1;
  const h = (upper - lower) / n;
  if (!Number.isFinite(h) || h === 0) return 0;
  let sum = 0;
  for (let index = 0; index <= n; index += 1) {
    const value = evaluate(lower + index * h);
    if (value === null) return null;
    const weight = index === 0 || index === n ? 1 : index % 2 === 0 ? 2 : 4;
    sum += weight * value;
  }
  const result = (h / 3) * sum;
  return Number.isFinite(result) ? result : null;
}

function riemann(
  evaluate: (x: number) => number | null,
  lower: number,
  upper: number,
  n: number,
): { sum: number; rects: CalculusRect[] } {
  const dx = (upper - lower) / n;
  const rects: CalculusRect[] = [];
  let sum = 0;
  for (let index = 0; index < n; index += 1) {
    const x0 = lower + index * dx;
    const x1 = x0 + dx;
    const mid = (x0 + x1) / 2;
    const height = evaluate(mid) ?? 0;
    sum += height * dx;
    rects.push({ x0, x1, mid, height });
  }
  return { sum, rects };
}

function computeCalculus(problem: LabProblem, params: Params): CalculusResult {
  const model = problem.model;
  const expression = model.expression ?? 'x^2';
  const variable = model.variable ?? 'x';
  const improperUpper = model.improper_upper === true;
  const compiled = compileExpression(expression, [variable]);
  const evaluate = (x: number): number | null => compiled.evalOrNull({ [variable]: x });

  if ((model.kind ?? 'integral') === 'antiderivative') {
    // 不定积分：图像是 F(x)+C 一族；C 只做上下平移，答案必须带 +C。
    const constant = num(params, 'c', defaultNumber(model, 'c', 0));
    const rawDomain = model.plot_domain ?? [-3, 3];
    const domain = { x_min: rawDomain[0], x_max: rawDomain[1] };
    let family: ReturnType<typeof compileExpression> | null = null;
    const familySource = (model.antiderivative_expression ?? '').trim();
    if (familySource) {
      try {
        family = compileExpression(familySource, [variable]);
      } catch {
        family = null;
      }
    }
    const series: CalculusPoint[] = [];
    for (let index = 0; index < 260; index += 1) {
      const x = domain.x_min + ((domain.x_max - domain.x_min) * index) / 259;
      const base = family ? family.evalOrNull({ [variable]: x }) : null;
      series.push({
        x,
        y: base === null || !Number.isFinite(base) ? null : base + constant,
      });
    }
    const deviations: number[] = [];
    if (family) {
      const step = 1e-4;
      for (const sample of [-2, -1, -0.5, 0.5, 1, 2]) {
        if (sample <= domain.x_min || sample >= domain.x_max) continue;
        const left = family.evalOrNull({ [variable]: sample - step });
        const right = family.evalOrNull({ [variable]: sample + step });
        const target = evaluate(sample);
        if (left === null || right === null || target === null) continue;
        const derivative = (right - left) / (2 * step);
        if (Number.isFinite(derivative) && Number.isFinite(target)) {
          deviations.push(Math.abs(derivative - target));
        }
      }
    }
    const deviation = deviations.length ? Math.max(...deviations) : null;
    const answerText = (problem.solution.answer || `${familySource || 'F(x)'}+C`).trim();
    const cValues = Array.from(
      new Set([-2, -1, 0, 1, 2, constant].map((value) => Number(value.toFixed(6)))),
    ).sort((a, b) => a - b);
    const frames: LabResultFrame[] = cValues.map((value, index) =>
      frame(index, `C=${formatNumber(value)}`, `原函数族整体上下平移（C=${formatNumber(value)}）`, {
        c: value,
      }),
    );
    return {
      subject: 'calculus',
      kind: 'antiderivative',
      headline: `∫ f(${variable}) d${variable} = ${answerText}`,
      metrics: [
        metric('antiderivative', '原函数 F(x)+C', answerText, 'accent'),
        metric('constant', '积分常数 C', formatNumber(constant)),
        metric('expression', '被积函数 f(x)', expression),
        metric('deviation', "F′ 与 f 的偏差", formatNumber(deviation)),
      ],
      checks: [
        check(
          'derivative',
          '原函数求导回到被积函数',
          deviation !== null && deviation <= 0.05 ? 'pass' : 'warn',
          deviation !== null
            ? `抽样核对最大偏差 ${formatNumber(deviation)}；改变 C 不会改变导数。`
            : '未拿到可绘制的初等原函数，解答仍保留符号积分形式。',
        ),
        check(
          'family',
          '答案要写出 +C',
          'pass',
          '不定积分表示一族原函数；改变 C 只让曲线整体上下平移。',
        ),
      ],
      notes: [
        '不定积分没有上下限：图像显示 F(x)+C 一族，拖动 C 观察整体平移。',
        '原题答案必须保留任意常数 C。',
      ],
      trace: frames,
      domain,
      series,
      rects: [],
      exact: null,
      approx: null,
      error: null,
      answerText,
    };
  }

  if ((model.kind ?? 'integral') === 'integral') {
    const originalLower = defaultNumber(model, 'lower', 0);
    const originalUpper = defaultNumber(model, 'upper', 1);
    const lower = num(params, 'lower', originalLower);
    const upper = num(params, 'upper', originalUpper);
    const plotLower = Math.min(lower, upper);
    const plotUpper = Math.max(lower, upper);
    const n = Math.round(clamp(num(params, 'n', 8), 2, 80));
    const span = Math.abs(upper - lower);
    const pad = Math.max(0.35, span * 0.14);
    // 正区间左侧不向外扩展，避免把 x<lower 处的极点（如 1/(x-1)）画进图里。
    const domain = {
      x_min: plotLower > 0 ? plotLower : plotLower - pad,
      x_max: plotUpper < 0 ? plotUpper : plotUpper + pad,
    };
    const series: CalculusPoint[] = [];
    for (let index = 0; index < 260; index += 1) {
      const x = domain.x_min + ((domain.x_max - domain.x_min) * index) / 259;
      series.push({ x, y: evaluate(x) });
    }
    const { sum, rects } = riemann(evaluate, lower, upper, n);
    const original = problem.solution.answer_value ?? null;
    const solutionConvergence = problem.solution.convergence ?? null;
    const originalReferenceValid =
      solutionConvergence === null ? finite(original) : solutionConvergence === 'finite' && finite(original);
    const atOriginalInterval =
      Math.abs(lower - originalLower) < 1e-9 && Math.abs(upper - originalUpper) < 1e-9;
    const sameOriginal = atOriginalInterval && originalReferenceValid;
    const originalInvalid =
      atOriginalInterval && solutionConvergence !== null && solutionConvergence !== 'finite';
    const allFinite = series.every(
      (point) => point.x < plotLower || point.x > plotUpper || point.y !== null,
    );
    const reference = sameOriginal
      ? original
      : !originalInvalid && allFinite
        ? simpson(evaluate, lower, upper)
        : null;
    const error = finite(reference) ? Math.abs(sum - reference) : null;
    const ns = Array.from(
      new Set([2, 4, 8, 16, 32, 64, n].filter((item) => item <= 80).sort((a, b) => a - b)),
    );
    const frames: LabResultFrame[] = ns.map((frameN, index) => {
      const frameSum = riemann(evaluate, lower, upper, frameN).sum;
      return frame(
        index,
        `n=${frameN}`,
        `中点黎曼和 ${formatNumber(frameSum)}`,
        {
          n: frameN,
          sum: frameSum,
          error: finite(reference) ? Math.abs(frameSum - reference) : null,
        },
      );
    });
    const checks = [
      check(
        'finite',
        '区间内函数可计算',
        originalInvalid || !allFinite ? 'fail' : 'pass',
        originalInvalid
          ? '原题区间含瑕点且后端判定为发散或未定，不能把数值采样当作积分值。'
          : allFinite
            ? '区间内采样点都有有限函数值。'
            : '区间内存在无定义点或瑕点，图形断开，数值参照无效。',
      ),
      check(
        'riemann',
        '黎曼和与参照值对照',
        error !== null && error <= Math.max(0.05, 0.02 * Math.max(1, Math.abs(reference ?? 0)))
          ? 'pass'
          : 'warn',
        error === null
          ? '当前没有可信参照值；含瑕点时必须先分段，不能跨瑕点直接求数值积分。'
          : `当前分割数误差 ${formatNumber(error)}；增大 n 观察是否趋近。${
              sameOriginal ? '参照值来自原题解析结果。' : '区间已改动，参照值为高精度数值近似。'
            }`,
      ),
    ];
    const exact = sameOriginal ? original : null;
    const notes = [
      '矩形、曲线与数值读取同一被积函数。',
      ...(upper < lower ? ['上限小于下限，积分按原方向取负号；图形按坐标从小到大展示。'] : []),
      originalInvalid
        ? '当前区间与原题一致，但原题结论为发散或未定；数值参照已停用，不能当作积分值。'
        : sameOriginal
          ? '当前区间与原题一致，解析值来自符号求解。'
          : allFinite
            ? '当前区间属于新情景。参照值改为高精度数值近似，原题答案仍保留在右上角。'
            : '当前区间属于新情景且含无定义点；数值参照已停用，不能把它当作积分值。',
    ];
    if (improperUpper && sameOriginal) {
      notes.push(
        `原题上限为 +∞；图形与黎曼和在截断区间 b=${formatNumber(originalUpper)} 上展示，解析值按无穷积分计算。`,
      );
    }
    return {
      subject: 'calculus',
      kind: 'integral',
      headline: `∫ 近似 ${formatNumber(sum)} · ${
        sameOriginal
          ? '解析'
          : originalInvalid
            ? '原题发散/未定'
            : reference !== null
              ? '数值参照'
              : '无可信参照'
      } ${formatNumber(reference)}`,
      metrics: [
        metric('sum', `黎曼和 n=${n}`, formatNumber(sum), 'accent'),
        metric(
          'reference',
          sameOriginal ? (improperUpper ? '无穷积分解析值' : '解析值') : '数值参照',
          formatNumber(reference),
        ),
        metric('error', '绝对误差', formatNumber(error)),
        metric('n', '分割数', String(n)),
      ],
      checks,
      notes,
      trace: frames,
      domain,
      series,
      rects,
      exact,
      approx: sum,
      error,
      answerText: originalInvalid
        ? '原题积分发散或未定'
        : reference !== null
          ? `≈ ${formatNumber(sum)}`
          : '参照无效',
    };
  }

  const originalPoint = defaultNumber(model, 'point', 0);
  const point = num(params, 'point', originalPoint);
  const h = clamp(num(params, 'h', 0.1), 0.001, 2);
  const value = evaluate(point);
  const slope = (() => {
    const left = evaluate(point - h);
    const right = evaluate(point + h);
    if (left === null || right === null) return null;
    return (right - left) / (2 * h);
  })();
  const exactSlope =
    Math.abs(point - originalPoint) < 1e-9 && finite(problem.solution.answer_value)
      ? problem.solution.answer_value
      : null;
  const referenceSlope = exactSlope ?? slope;
  const slopeForLine = finite(referenceSlope) ? referenceSlope : slope ?? 0;
  const span = Math.max(1, h * 8);
  const domain = { x_min: point - span, x_max: point + span };
  const series: CalculusPoint[] = [];
  for (let index = 0; index < 260; index += 1) {
    const x = domain.x_min + ((domain.x_max - domain.x_min) * index) / 259;
    series.push({ x, y: evaluate(x) });
  }
  const hs = [1, 0.5, 0.25, 0.1, 0.05, 0.01];
  const frames: LabResultFrame[] = hs.map((frameH, index) => {
    const left = evaluate(point - frameH);
    const right = evaluate(point + frameH);
    const quotient =
      left === null || right === null ? null : (right - left) / (2 * frameH);
    return frame(index, `h=${frameH}`, `中心差商 ${formatNumber(quotient)}`, {
      h: frameH,
      quotient,
    });
  });
  return {
    subject: 'calculus',
    kind: 'derivative',
    headline: `f(${formatNumber(point)}) = ${formatNumber(value)} · f'(${formatNumber(
      point,
    )}) ${exactSlope !== null ? '=' : '≈'} ${formatNumber(referenceSlope)}${
      exactSlope !== null ? '' : '（数值差商）'
    }`,
    metrics: [
      metric('value', '函数值', formatNumber(value)),
      metric('slope', exactSlope !== null ? '精确斜率' : '数值差商参照', formatNumber(referenceSlope), 'accent'),
      metric('secant', '中心差商', formatNumber(slope)),
      metric('h', '差商步长', formatNumber(h)),
    ],
    checks: [
      check(
        'point',
        '研究点有定义',
        value !== null ? 'pass' : 'fail',
        value !== null ? `f(${formatNumber(point)}) = ${formatNumber(value)}` : '该点无有限函数值。',
      ),
      check(
        'secant',
        '差商趋近导数',
        slope !== null && finite(referenceSlope) && Math.abs(slope - referenceSlope) <= Math.max(1e-3, 0.02 * Math.max(1, Math.abs(referenceSlope)))
          ? 'pass'
          : 'warn',
        exactSlope !== null
          ? `当前差商为 ${formatNumber(slope)}，精确斜率为 ${formatNumber(exactSlope)}。`
          : `研究点已改动，参照为中心差商 ${formatNumber(referenceSlope)}；数值实验不等于符号求导。`,
      ),
    ],
    notes: [
      exactSlope !== null
        ? '切线、割线与差商读取同一函数。'
        : '研究点已改动：切线按中心差商绘制，仅用于观察趋势，不能标为精确斜率。',
    ],
    trace: frames,
    domain,
    series,
    rects: [],
    exact: exactSlope,
    approx: slope,
    error: slope !== null && exactSlope !== null ? Math.abs(slope - exactSlope) : null,
    point:
      value === null
        ? undefined
        : {
            x: point,
            y: value,
            slope: slopeForLine,
            tangent: { m: slopeForLine, b: value - slopeForLine * point },
          },
    answerText: exactSlope !== null ? `${formatNumber(exactSlope)}` : `≈ ${formatNumber(referenceSlope)}`,
  };
}

/* -------------------------------------------------------------------------- */
/* 最优化                                                                     */
/* -------------------------------------------------------------------------- */

function computeOptimization(problem: LabProblem, params: Params): OptimizationResult {
  const model = problem.model;
  const variables = model.variables && model.variables.length ? model.variables : ['x'];
  const expression = model.expression ?? 'x^2';
  let objective;
  try {
    objective = compileExpression(expression, variables);
  } catch {
    objective = compileExpression('0', variables);
  }
  const gradients = variables.map((_variable, index) => {
    const source = model.grad_exprs?.[index];
    if (source) {
      try {
        return compileExpression(source, variables);
      } catch {
        /* fall through */
      }
    }
    return null;
  });
  const evalObjective = (point: number[]): number | null => {
    const values = Object.fromEntries(variables.map((name, index) => [name, point[index]!]));
    return objective.evalOrNull(values);
  };
  const evalGradient = (point: number[]): number[] | null => {
    const values = Object.fromEntries(variables.map((name, index) => [name, point[index]!]));
    const result: number[] = [];
    for (let index = 0; index < variables.length; index += 1) {
      const compiled = gradients[index];
      if (compiled) {
        const value = compiled.evalOrNull(values);
        if (value === null) return null;
        result.push(value);
      } else {
        // 极少数没有梯度表达式的手工模型：中心差分兜底，并明确标注。
        const step = 1e-5;
        const plus = [...point];
        const minus = [...point];
        plus[index] = (plus[index] ?? 0) + step;
        minus[index] = (minus[index] ?? 0) - step;
        const high = evalObjective(plus);
        const low = evalObjective(minus);
        if (high === null || low === null) return null;
        result.push((high - low) / (2 * step));
      }
    }
    return result;
  };
  const initial = variables.map((name) => defaultNumber(model, `${name}0`, 0));
  const start = variables.map((name, index) => num(params, `${name}0`, initial[index]!));
  const learningRate = clamp(num(params, 'learning_rate', 0.1), 0.001, 2);
  const iterations = Math.round(clamp(num(params, 'iterations', 30), 1, 120));
  const bounds: Record<string, [number | null, number | null]> = {};
  for (const [name, value] of Object.entries(model.bounds ?? {})) {
    if (Array.isArray(value) && value.length === 2) {
      bounds[name] = [
        typeof value[0] === 'number' ? value[0] : null,
        typeof value[1] === 'number' ? value[1] : null,
      ];
    }
  }
  const project = (point: number[]): { point: number[]; touched: boolean } => {
    const result = [...point];
    let touched = false;
    variables.forEach((name, index) => {
      const range = bounds[name];
      if (!range) return;
      if (range[0] !== null && result[index]! < range[0]) {
        result[index] = range[0];
        touched = true;
      }
      if (range[1] !== null && result[index]! > range[1]) {
        result[index] = range[1];
        touched = true;
      }
    });
    return { point: result, touched };
  };

  let current = [...start];
  let fValue = evalObjective(current);
  const trajectory: OptimizationPointFrame[] = [];
  let stopReason = '达到迭代上限';
  let converged = false;
  let diverged = false;
  let constrained = false;
  for (let index = 0; index <= iterations; index += 1) {
    const gradient = evalGradient(current);
    if (!gradient || fValue === null) {
      diverged = true;
      stopReason = '数值发散或进入未定义区域';
      break;
    }
    const gradNorm = Math.sqrt(gradient.reduce((sum, value) => sum + value * value, 0));
    trajectory.push({ index, point: [...current], f: fValue, gradient, gradNorm });
    if (gradNorm <= 1e-7) {
      converged = true;
      stopReason = '梯度范数 < 1e-7，已收敛';
      break;
    }
    if (index >= iterations) break;
    const nextPoint = current.map((value, dim) => value - learningRate * gradient[dim]!);
    const projected = project(nextPoint);
    constrained = constrained || projected.touched;
    const nextF = evalObjective(projected.point);
    if (nextF === null || projected.point.some((value) => Math.abs(value) > 1e12)) {
      diverged = true;
      stopReason = '数值发散或进入未定义区域';
      break;
    }
    current = projected.point;
    fValue = nextF;
  }
  if (constrained && stopReason === '达到迭代上限') {
    stopReason = '达到迭代上限（部分点被投影回约束区间）';
  }
  const last = trajectory[trajectory.length - 1] ?? null;

  const domain = model.domain ?? {};
  const xMin = domain.x_min ?? -6;
  const xMax = domain.x_max ?? 6;
  let series: CalculusPoint[] = [];
  let grid: OptimizationResult['grid'] = null;
  if (variables.length === 1) {
    for (let index = 0; index < 260; index += 1) {
      const x = xMin + ((xMax - xMin) * index) / 259;
      series.push({ x, y: evalObjective([x]) });
    }
  } else {
    const yMin = domain.y_min ?? -6;
    const yMax = domain.y_max ?? 6;
    const xs = Array.from({ length: 33 }, (_, index) => xMin + ((xMax - xMin) * index) / 32);
    const ys = Array.from({ length: 33 }, (_, index) => yMin + ((yMax - yMin) * index) / 32);
    const z = ys.map((y) => xs.map((x) => evalObjective([x, y])));
    grid = { x: xs, y: ys, z };
  }
  const constraintOk =
    !Object.keys(bounds).length ||
    (last
      ? variables.every((name, index) => {
          const range = bounds[name];
          if (!range) return true;
          const value = last.point[index]!;
          return (range[0] === null || value >= range[0] - 1e-8) && (range[1] === null || value <= range[1] + 1e-8);
        })
      : false);
  const checks = [
    check(
      'constraints',
      '约束满足',
      constraintOk ? 'pass' : 'fail',
      Object.keys(bounds).length
        ? '迭代点在箱约束内。'
        : '题目没有可执行的箱约束；未声称满足其它约束。',
    ),
    check(
      'stopping',
      '停止原因明确',
      diverged ? 'fail' : 'pass',
      stopReason,
    ),
    check(
      'gradient',
      '终点梯度核对',
      last && last.gradNorm <= 0.05 ? 'pass' : 'warn',
      `终点梯度范数 ${formatNumber(last?.gradNorm ?? null)}；越小越接近驻点。`,
    ),
  ];
  const exactPoint = problem.solution.answer_point ?? null;
  const exactValue = problem.solution.answer_value ?? null;
  const globalNote = problem.solution.global_note ?? '数值轨迹不等于全局最优证明。';
  const answerText = last
    ? variables.length === 1
      ? `x≈${formatNumber(last.point[0]!)}，f≈${formatNumber(last.f)}`
      : `点≈(${last.point.map((value) => formatNumber(value)).join(', ')})，f≈${formatNumber(last.f)}`
    : '—';
  const trace: LabResultFrame[] = trajectory.map((item) => {
    const values: Record<string, unknown> = {
      point: item.point,
      f: item.f,
      grad_norm: item.gradNorm,
      gradient: item.gradient,
    };
    return frame(
      item.index,
      `迭代 ${item.index}`,
      `f=${formatNumber(item.f)} · ‖∇f‖=${formatNumber(item.gradNorm)}`,
      values,
    );
  });
  return {
    subject: 'optimization',
    variables,
    headline: answerText,
    metrics: [
      metric('f', '当前目标值', formatNumber(last?.f ?? null), 'accent'),
      metric('grad', '梯度范数', formatNumber(last?.gradNorm ?? null)),
      metric('iterations', '实际迭代', String(Math.max(0, trajectory.length - 1))),
      metric('stop', '停止原因', stopReason),
    ],
    checks,
    notes: [globalNote],
    trace,
    series,
    grid,
    domain,
    trajectory,
    current: last,
    // 注册表声明的派生输出键是 loss/grad_norm；顶层暴露这两个键，
    // 前后端 declared_output_value 才能取到同一份值。
    loss: last?.f ?? null,
    grad_norm: last?.gradNorm ?? null,
    stopReason,
    converged,
    diverged,
    exactPoint,
    exactValue,
    globalNote,
    bounds,
  };
}

/* -------------------------------------------------------------------------- */
/* BFS                                                                        */
/* -------------------------------------------------------------------------- */

const PSEUDOCODE = [
  'queue ← [start]; visited ← {start}; parent[start] ← null',
  'while queue 不为空:',
  '  u ← queue.dequeue()',
  '  order.append(u)',
  '  for v in neighbors(u) sorted by id:',
  '    if v not in visited:',
  '      visited.add(v); parent[v] ← u; queue.enqueue(v)',
  'return order',
];

function computeBfs(problem: LabProblem, params: Params): BfsResult {
  const model = problem.model;
  const nodes = (model.nodes ?? []).map((node) => ({ id: String(node.id), label: String(node.label) }));
  const edges = (model.edges ?? []).map((edge) => ({ from: String(edge.from), to: String(edge.to) }));
  const directed = !!model.directed;
  let start = String(params.start ?? model.start ?? model.defaults.start ?? '');
  if (!nodes.some((node) => node.id === start)) start = nodes[0]?.id ?? '';
  const adjacency: Record<string, string[]> = {};
  for (const node of nodes) adjacency[node.id] = [];
  for (const edge of edges) {
    if (!adjacency[edge.from] || !adjacency[edge.to]) continue;
    adjacency[edge.from]!.push(edge.to);
    if (!directed) adjacency[edge.to]!.push(edge.from);
  }
  for (const node of Object.keys(adjacency)) {
    adjacency[node] = Array.from(new Set(adjacency[node]!)).sort();
  }
  const queue = start ? [start] : [];
  const visited = new Set(start ? [start] : []);
  const parent: Record<string, string | null> = start ? { [start]: null } : {};
  const level: Record<string, number> = start ? { [start]: 0 } : {};
  const order: string[] = [];
  const treeEdges: { from: string; to: string }[] = [];
  const rejectedEdges: { from: string; to: string; reason: string }[] = [];
  const frames: BfsResultFrame[] = [
    {
      ...frame(0, '初始化', `从 ${start || '—'} 开始；入队即标记已访问。`, {
        queue: [...queue],
        visited: [...visited].sort(),
      }),
      action: 'init',
      current: null,
      queue: [...queue],
      visited: [...visited].sort(),
      order: [],
      parent: { ...parent },
      level: { ...level },
      pseudocodeLine: 1,
    },
  ];
  while (queue.length) {
    const current = queue.shift()!;
    order.push(current);
    frames.push({
      ...frame(frames.length, `出队 ${current}`, `队列按先进先出取出 ${current}；层级 ${level[current]}。`, {
        queue: [...queue],
        visited: [...visited].sort(),
      }),
      action: 'dequeue',
      current,
      queue: [...queue],
      visited: [...visited].sort(),
      order: [...order],
      parent: { ...parent },
      level: { ...level },
      pseudocodeLine: 3,
    });
    for (const neighbor of adjacency[current] ?? []) {
      if (visited.has(neighbor)) {
        rejectedEdges.push({ from: current, to: neighbor, reason: '已在已访问集合中' });
        frames.push({
          ...frame(frames.length, `跳过 ${neighbor}`, `${neighbor} 已访问，不重复入队。`, {
            queue: [...queue],
            visited: [...visited].sort(),
          }),
          action: 'skip',
          current,
          neighbor,
          queue: [...queue],
          visited: [...visited].sort(),
          order: [...order],
          parent: { ...parent },
          level: { ...level },
          pseudocodeLine: 6,
        });
        continue;
      }
      visited.add(neighbor);
      parent[neighbor] = current;
      level[neighbor] = (level[current] ?? 0) + 1;
      queue.push(neighbor);
      treeEdges.push({ from: current, to: neighbor });
      frames.push({
        ...frame(frames.length, `入队 ${neighbor}`, `${neighbor} 首次被发现，父节点 ${current}，层级 ${level[neighbor]}。`, {
          queue: [...queue],
          visited: [...visited].sort(),
        }),
        action: 'enqueue',
        current,
        neighbor,
        queue: [...queue],
        visited: [...visited].sort(),
        order: [...order],
        parent: { ...parent },
        level: { ...level },
        pseudocodeLine: 6,
      });
    }
  }
  frames.push({
    ...frame(frames.length, '完成', '队列为空，所有可达节点都已按 BFS 顺序处理。', {
      queue: [],
      visited: [...visited].sort(),
    }),
    action: 'done',
    current: null,
    queue: [],
    visited: [...visited].sort(),
    order: [...order],
    parent: { ...parent },
    level: { ...level },
    pseudocodeLine: 8,
  });
  const unvisited = nodes.map((node) => node.id).filter((id) => !visited.has(id));
  const reachable = new Set<string>();
  if (start) {
    const frontier = [start];
    while (frontier.length) {
      const node = frontier.pop()!;
      if (reachable.has(node)) continue;
      reachable.add(node);
      frontier.push(...(adjacency[node] ?? []));
    }
  }
  const coverage = visited.size === reachable.size && order.length === visited.size;
  const checks = [
    check(
      'coverage',
      '访问覆盖',
      coverage ? 'pass' : 'fail',
      `出队顺序 ${order.join(' → ') || '空'}；已访问 ${visited.size} 个，可达 ${reachable.size} 个。`,
    ),
    check(
      'parent_edges',
      '父边有效',
      Object.entries(parent).every(([node, parentId]) =>
        parentId === null
          ? true
          : edges.some(
              (edge) =>
                (edge.from === parentId && edge.to === node) ||
                (!directed && edge.from === node && edge.to === parentId),
            ),
      )
        ? 'pass'
        : 'fail',
      '每个父节点都能在原图中找到一条边。',
    ),
    check('queue', '队列规则', 'pass', '入队即标记；同层邻居按节点编号升序。'),
  ];
  return {
    subject: 'algorithm',
    nodes,
    edges,
    directed,
    adjacency,
    order,
    visited: [...visited].sort(),
    unvisited,
    parent,
    level,
    treeEdges,
    rejectedEdges,
    pseudocode: PSEUDOCODE,
    start,
    headline: `BFS 出队顺序：${order.join(' → ') || '—'}`,
    metrics: [
      metric('order', '访问顺序', order.join(' → ') || '—', 'accent'),
      metric('visited', '已访问', String(visited.size)),
      metric('queue', '结束队列', '空'),
      metric('unvisited', '不可达', unvisited.join(', ') || '无'),
    ],
    checks,
    notes: ['动画只回放真实执行记录；入队与出队是两种不同的顺序。'],
    trace: frames,
    frames,
  };
}

/* -------------------------------------------------------------------------- */
/* 深度学习                                                                   */
/* -------------------------------------------------------------------------- */

function activation(name: string, values: number[]): number[] {
  if (name === 'relu') return values.map((value) => Math.max(0, value));
  if (name === 'sigmoid') return values.map((value) => 1 / (1 + Math.exp(-value)));
  if (name === 'linear') return [...values];
  return values.map((value) => Math.tanh(value));
}

function activationDerivative(name: string, values: number[]): number[] {
  if (name === 'relu') return values.map((value) => (value > 0 ? 1 : 0));
  if (name === 'sigmoid') {
    return values.map((value) => {
      const sigmoid = 1 / (1 + Math.exp(-value));
      return sigmoid * (1 - sigmoid);
    });
  }
  if (name === 'linear') return values.map(() => 1);
  return values.map((value) => 1 - Math.tanh(value) ** 2);
}

function matVec(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * (vector[index] ?? 0), 0));
}

function outer(left: number[], right: number[]): number[][] {
  return left.map((value) => right.map((item) => value * item));
}

function transposeMatVec(matrix: number[][], vector: number[]): number[] {
  if (!matrix.length) return [];
  return (matrix[0] ?? []).map((_, column) =>
    matrix.reduce((sum, row, index) => sum + (row[column] ?? 0) * (vector[index] ?? 0), 0),
  );
}

interface ForwardState {
  activations: { activation: string; z: number[]; a: number[] }[];
  output: number[];
}

function forward(
  weights: number[][][],
  biases: number[][],
  input: number[],
  hiddenActivation: string,
): ForwardState {
  let a = [...input];
  const layers: { activation: string; z: number[]; a: number[] }[] = [
    { activation: 'input', z: [], a: [...a] },
  ];
  for (let index = 0; index < weights.length; index += 1) {
    const z = matVec(weights[index]!, a).map((value, dim) => value + (biases[index]?.[dim] ?? 0));
    const name = index === weights.length - 1 ? 'linear' : hiddenActivation;
    a = activation(name, z);
    layers.push({ activation: name, z, a: [...a] });
  }
  return { activations: layers, output: a };
}

interface GradState {
  loss: number;
  gradWeights: number[][][];
  gradBiases: number[][];
  forward: ForwardState;
}

function lossAndGradients(
  weights: number[][][],
  biases: number[][],
  input: number[],
  target: number[],
  hiddenActivation: string,
): GradState {
  const state = forward(weights, biases, input, hiddenActivation);
  const output = state.output;
  const loss = output.reduce((sum, value, index) => sum + (value - (target[index] ?? 0)) ** 2, 0) / output.length;
  const gradWeights: number[][][] = weights.map(() => []);
  const gradBiases: number[][] = weights.map(() => []);
  const last = weights.length - 1;
  let delta = output.map(
    (value, index) =>
      (2 / output.length) *
      (value - (target[index] ?? 0)) *
      activationDerivative('linear', [state.activations[last + 1]?.z[index] ?? 0])[0]!,
  );
  for (let index = last; index >= 0; index -= 1) {
    const previous = state.activations[index]?.a ?? [];
    gradWeights[index] = outer(delta, previous);
    gradBiases[index] = [...delta];
    if (index > 0) {
      const zPrev = state.activations[index]?.z ?? [];
      const derivative = activationDerivative(
        index - 1 === 0 ? hiddenActivation : state.activations[index]?.activation ?? hiddenActivation,
        zPrev,
      );
      delta = transposeMatVec(weights[index]!, delta).map((value, dim) => value * (derivative[dim] ?? 1));
    }
  }
  return { loss, gradWeights, gradBiases, forward: state };
}

function computeDeepLearning(problem: LabProblem, params: Params): DlResult {
  const model = problem.model;
  const layers = (model.layers ?? []).map((layer) => ({
    size: Number(layer.size),
    activation: String(layer.activation),
  }));
  if (!layers.length) layers.push({ size: 2, activation: 'input' }, { size: 3, activation: 'tanh' }, { size: 1, activation: 'linear' });
  const weights = (model.weights ?? []).map((matrix) => matrix.map((row) => row.map(Number)));
  const biases = (model.biases ?? []).map((row) => row.map(Number));
  const input = layers[0]!.size
    ? Array.from({ length: layers[0]!.size }, (_, index) => num(params, `input_${index + 1}`, model.input?.[index] ?? 0))
    : [];
  const target = (model.target ?? [1]).map(Number);
  const learningRate = clamp(num(params, 'learning_rate', 0.1), 0.001, 2);
  const epochs = Math.round(clamp(num(params, 'epochs', 8), 1, 30));
  const hiddenActivation = model.activation ?? 'tanh';

  const initialGradient = lossAndGradients(weights, biases, input, target, hiddenActivation);
  const frames: DlFrame[] = [];
  const initialForward = initialGradient.forward;
  const initialGradNorm = Math.sqrt(
    initialGradient.gradWeights.flat(2).reduce((sum, value) => sum + value * value, 0),
  );
  const weightNorm = (stateWeights: number[][][]) =>
    Math.sqrt(stateWeights.flat(2).reduce((sum, value) => sum + value * value, 0));
  frames.push({
    ...frame(0, '初始权重', `loss=${formatNumber(initialGradient.loss)}`, {
      loss: initialGradient.loss,
      output: initialForward.output,
      weight_norm: weightNorm(weights),
      grad_norm: initialGradNorm,
    }),
    loss: initialGradient.loss,
    lossBefore: initialGradient.loss,
    output: initialForward.output,
    weightNorm: weightNorm(weights),
    gradNorm: initialGradNorm,
    weights: weights.map((matrix) => matrix.map((row) => [...row])),
    biases: biases.map((row) => [...row]),
    activations: initialForward.activations,
  });
  const lossHistory = [initialGradient.loss];
  let currentWeights = weights.map((matrix) => matrix.map((row) => [...row]));
  let currentBiases = biases.map((row) => [...row]);
  let lastGradients = initialGradient.gradWeights;
  let lastBiasesGradient = initialGradient.gradBiases;
  for (let epoch = 1; epoch <= epochs; epoch += 1) {
    const before = lossAndGradients(currentWeights, currentBiases, input, target, hiddenActivation);
    currentWeights = currentWeights.map((matrix, layer) =>
      matrix.map((row, rowIndex) =>
        row.map((value, column) => value - learningRate * (before.gradWeights[layer]?.[rowIndex]?.[column] ?? 0)),
      ),
    );
    currentBiases = currentBiases.map((row, layer) =>
      row.map((value, index) => value - learningRate * (before.gradBiases[layer]?.[index] ?? 0)),
    );
    const after = lossAndGradients(currentWeights, currentBiases, input, target, hiddenActivation);
    lossHistory.push(after.loss);
    lastGradients = before.gradWeights;
    lastBiasesGradient = before.gradBiases;
    const gradNorm = Math.sqrt(before.gradWeights.flat(2).reduce((sum, value) => sum + value * value, 0));
    frames.push({
      ...frame(epoch, `Epoch ${epoch}`, `loss=${formatNumber(after.loss)} · ‖W‖=${formatNumber(weightNorm(currentWeights))}`, {
        loss: after.loss,
        output: after.forward.output,
        weight_norm: weightNorm(currentWeights),
        grad_norm: gradNorm,
      }),
      loss: after.loss,
      lossBefore: before.loss,
      output: after.forward.output,
      weightNorm: weightNorm(currentWeights),
      gradNorm,
      weights: currentWeights.map((matrix) => matrix.map((row) => [...row])),
      biases: currentBiases.map((row) => [...row]),
      activations: after.forward.activations,
    });
  }
  const final = frames[frames.length - 1]!;
  // 有限差分核对一次梯度；只用一个小网络的一个权重。
  let gradientCheck: number | null = null;
  try {
    const epsilon = 1e-5;
    const plus = weights.map((matrix) => matrix.map((row) => [...row]));
    const minus = weights.map((matrix) => matrix.map((row) => [...row]));
    plus[0]![0]![0] = plus[0]![0]![0]! + epsilon;
    minus[0]![0]![0] = minus[0]![0]![0]! - epsilon;
    const high = lossAndGradients(plus, biases, input, target, hiddenActivation).loss;
    const low = lossAndGradients(minus, biases, input, target, hiddenActivation).loss;
    const numeric = (high - low) / (2 * epsilon);
    const analytic = initialGradient.gradWeights[0]?.[0]?.[0] ?? 0;
    gradientCheck = Math.abs(numeric - analytic) / Math.max(1e-12, Math.abs(numeric), Math.abs(analytic));
  } catch {
    gradientCheck = null;
  }
  const initialLoss = lossHistory[0]!;
  const finalLoss = lossHistory[lossHistory.length - 1]!;
  const checks = [
    check(
      'shape',
      '张量维度一致',
      weights.every((matrix, index) => matrix.length === layers[index + 1]?.size && matrix.every((row) => row.length === layers[index]?.size))
        ? 'pass'
        : 'fail',
      `网络 ${layers.map((layer) => layer.size).join('–')}；权重形状为 [输出维度, 输入维度]。`,
    ),
    check(
      'gradient',
      '反向传播梯度核对',
      gradientCheck !== null && gradientCheck < 1e-4 ? 'pass' : 'warn',
      `有限差分相对误差 ${formatNumber(gradientCheck, 3)}。`,
    ),
    check(
      'loss',
      '损失下降',
      finalLoss <= initialLoss + 1e-9 ? 'pass' : 'warn',
      `损失 ${formatNumber(initialLoss)} → ${formatNumber(finalLoss)}；学习率过大时可能振荡或发散。`,
    ),
  ];
  return {
    subject: 'deep_learning',
    layers,
    activation: hiddenActivation,
    weights,
    target,
    headline: `MSE ${formatNumber(initialLoss)} → ${formatNumber(final.loss)}`,
    metrics: [
      metric('loss', '当前损失', formatNumber(final.loss), 'accent'),
      metric('initial_loss', '初始损失', formatNumber(initialLoss)),
      metric('epoch', '训练轮', String(epochs)),
      metric('lr', '学习率', formatNumber(learningRate)),
    ],
    checks,
    notes: [
      `${model.weight_source === 'original' ? '题目提供权重' : '可复现教学初始化权重（seed=42）'}。`,
      '大型模型不在首版自动展开范围；这里展示维度与运算均可核对的小型网络。',
    ],
    trace: frames,
    frames,
    lossHistory,
    initialLoss,
    gradientCheck,
    finalWeights: currentWeights,
    finalBiases: currentBiases,
    gradients: { weights: lastGradients, biases: lastBiasesGradient },
  };
}

/* -------------------------------------------------------------------------- */
/* 入口与当前帧辅助                                                            */
/* -------------------------------------------------------------------------- */

export function computeLab(problem: LabProblem, params: Record<string, unknown>): LabResult {
  switch (problem.subject) {
    case 'calculus': {
      if (problem.manual_input?.double_extension || problem.manual_input?.conditions?.integral_mode === 'improper' || problem.manual_input?.conditions?.region_mode === 'improper') {
        const s=problem.solution;
        return {subject:'calculus',kind:'integral',headline:s.summary,metrics:[],checks:[],notes:s.limitations ?? [],series:[],rects:[],domain:{x_min:-1,x_max:1},exact:s.answer_value ?? null,approx:null,error:null,answerText:s.answer,trace:s.steps.map((step,index)=>({index,label:step.title,detail:step.detail,values:{}}))};
      }
      if (problem.manual_input?.task === 'double_integral' && problem.solution.solution_complete !== true) {
        const s=problem.solution;
        return {subject:'calculus',task:'double_integral',kind:'integral',headline:s.incomplete_reason || s.summary,answerText:'',metrics:[],checks:[],notes:s.limitations ?? [],series:[],rects:[],domain:{x_min:-1,x_max:1},exact:null,approx:null,error:null,trace:s.steps.map((step,index)=>({index,label:step.title,detail:step.detail,values:{}}))};
      }
      if (problem.model.task === 'multivariable_extrema') {
        const s=problem.solution;
        return {subject:'calculus',kind:'multivariable_extrema',task:'multivariable_extrema',headline:s.answer || s.summary,metrics:[],checks:[{id:'result',label:'候选与分类核验',status:s.solution_complete === true ? 'pass' : 'warn',detail:s.incomplete_reason || s.summary}],notes:s.limitations ?? [],series:[],domain:{x_min:-1,x_max:1},rects:[],exact:null,approx:null,error:null,answerText:s.answer || '',trace:s.steps.map((step,index)=>({index,label:step.title,detail:step.detail,values:{}}))};
      }
      if (problem.model.task === 'multivariable') {
        const s=problem.solution;
        return {subject:'calculus',kind:'multivariable',task:'multivariable',headline:s.answer || s.summary,metrics:[],checks:[{id:'result',label:'本任务核验',status:s.solution_complete === true ? 'pass' : 'warn',detail:s.incomplete_reason || s.summary}],notes:s.limitations ?? [],series:[],domain:{x_min:-1,x_max:1},rects:[],exact:s.answer_value ?? null,approx:null,error:null,answerText:s.answer || '',trace:s.steps.map((step,index)=>({index,label:step.title,detail:step.detail,values:{}}))};
      }
      if (problem.model.task === 'ode') return evaluateOde(problem);
      if (problem.model.task === 'series_convergence') return evaluateSeriesConvergence(problem);
      if (problem.model.task === 'power_series') return evaluatePowerSeries(problem);
      if (problem.model.task === 'fourier_series') return evaluateFourierSeries(problem);
      if (problem.model.task === 'proof') return evaluateProof(problem);
      if (['triple_integral','line_integral','surface_integral','green','gauss','stokes','space_geometry'].includes(problem.model.task ?? '')) return evaluateSpace(problem);
      const analysisKind = problem.model.analysis_kind
        ?? (['limit', 'taylor', 'higher_derivative', 'function_study'].includes(problem.model.task ?? '')
          ? problem.model.task
          : undefined);
      if (problem.model.task === 'double_integral') return evaluateDoubleIntegral(problem.model, params);
      if (analysisKind === 'limit') return evaluateLimit(problem, params);
      if (analysisKind === 'taylor') return evaluateTaylor(problem, params);
      if (analysisKind === 'higher_derivative') return evaluateHigherDerivative(problem, params);
      if (analysisKind === 'function_study') return evaluateFunctionStudy(problem);
      if (problem.model.task) {
        const exam = evaluateExamMath(problem.model, params);
        if (exam) return { ...exam, task: problem.model.task };
      }
      return computeCalculus(problem, params);
    }
    case 'optimization':
      if (problem.model.task === 'constrained_extrema') return evaluateConstrainedExtrema(problem);
      return computeOptimization(problem, params);
    case 'algorithm':
      if (problem.model.engine === 'heap_v1') {
        const result = evaluateHeap(problem.model, params);
        if (result.status !== 'ok') throw new Error(result.reason ?? '请核对堆的条件');
        return result;
      }
      return computeBfs(problem, params);
    case 'deep_learning':
      return computeDeepLearning(problem, params);
    case 'linear_algebra': {
      const result = evaluateLinAlg(problem.model, params);
      if (result.status !== 'ok') throw new Error(result.reason ?? '请核对线性代数题目的条件');
      return result;
    }
    case 'operating_system': {
      const result = evaluateOs(problem.model, params);
      if (result.status !== 'ok') throw new Error(result.reason ?? '请核对操作系统题目的条件');
      return result;
    }
    default:
      return { subject: 'unknown', headline: '请先核对题目类型与条件', metrics: [], checks: [],
        notes: ['尚未建立可执行模型。请核对原题并选择支持的类型。'],
        trace: [frame(0, '待核对', '尚未开始计算', {})] };
  }
}

export function defaultParams(problem: LabProblem): Record<string, unknown> {
  return { ...(problem.model.defaults ?? {}) };
}

export function currentFrame(result: LabResult, step: number): LabResultFrame | DlFrame | BfsResultFrame {
  const frames = result.trace;
  const index = clamp(Math.round(step), 0, Math.max(0, frames.length - 1));
  return frames[index] ?? frames[0] ?? {index:0,label:'暂无执行步骤',detail:result.headline,values:{}};
}

export function currentMetrics(result: LabResult, step: number): LabResultMetric[] {
  const index = clamp(Math.round(step), 0, Math.max(0, result.trace.length - 1));
  if (result.subject === 'calculus' && result.task) return result.metrics;
  if (result.subject === 'optimization' && result.kind === 'constrained_extrema') return result.metrics;
  if (result.subject === 'optimization') {
    const item = result.trajectory[index] ?? result.current;
    return [
      metric('step', '当前步', String(index), 'accent'),
      metric('point', '当前位置', item ? item.point.map((value) => formatNumber(value)).join(', ') : '—'),
      metric('f', '目标值', formatNumber(item?.f ?? null)),
      metric('grad', '梯度范数', formatNumber(item?.gradNorm ?? null)),
      metric('iterations', '轨迹总步数', String(Math.max(0, result.trajectory.length - 1))),
    ];
  }
  if (result.subject === 'algorithm') {
    if (result.algorithm === 'heap') {
      const frame = result.frames[index] ?? result.frames[0];
      return [metric('action', '当前动作', frame?.label ?? '待核对', 'accent'),
        metric('heap', '当前堆数组', `[${frame?.array.join(', ') ?? ''}]`),
        metric('deleted', '已删除', `[${frame?.deleted.join(', ') ?? ''}]`),
        metric('invariant', '当前堆序', frame?.heap_valid ? '满足' : '正在下滤恢复')];
    }
    const frame = result.frames[index] ?? result.frames[result.frames.length - 1]!;
    return [
      metric('current', '当前动作', frame.label, 'accent'),
      metric('queue', '队列', `[${frame.queue.join(', ')}]`),
      metric('visited', '已访问', `{${frame.visited.join(', ')}}`),
      metric('order', '出队顺序', frame.order.join(' → ') || '—'),
    ];
  }
  if (result.subject === 'linear_algebra') {
    const frame = result.frames[index] ?? result.frames[0];
    const items = [
      metric('action', '当前动作', frame?.label ?? '待核对', 'accent'),
    ];
    const det = frame?.values?.det;
    if (typeof det === 'number' && result.laKind !== 'matmul') {
      items.push(metric('det', '累计主元乘积', formatNumber(det)));
    }
    const solution = Array.isArray(frame?.values?.solution)
      ? (frame.values.solution as (number | null)[]).filter((v): v is number => v !== null)
      : [];
    if (solution.length) {
      items.push(metric('solution', '已解出分量', `(${solution.map((v) => formatNumber(v)).join(', ')})`));
    }
    if (result.laKind === 'matmul' && typeof frame?.values?.op_label === 'string' && frame.values.op_label) {
      items.push(metric('cell', '本步运算', String(frame.values.op_label)));
    }
    items.push(metric('frames', '轨迹总步数', String(Math.max(0, result.frames.length - 1))));
    return items;
  }
  if (result.subject === 'operating_system') {
    const frame = result.frames[index] ?? result.frames[0];
    const values = frame?.values ?? {};
    const items = [metric('action', '当前动作', frame?.label ?? '待核对', 'accent')];
    if (result.osKind === 'cpu_schedule') {
      const ready = Array.isArray(values.ready) ? (values.ready as string[]) : [];
      items.push(metric('time', '当前时刻', formatNumber(Number(values.time ?? 0))));
      items.push(metric('ready', '就绪队列', `[${ready.join(', ')}]`));
    } else if (result.osKind === 'page_replace') {
      items.push(metric('faults', '累计缺页', String(values.faults ?? 0)));
      items.push(metric('hits', '累计命中', String(values.hits ?? 0)));
    } else if (result.osKind === 'disk_schedule') {
      items.push(metric('head', '磁头位置', formatNumber(Number(values.head ?? 0))));
      items.push(metric('total', '累计移动', formatNumber(Number(values.total ?? 0))));
    } else {
      const work = Array.isArray(values.work) ? (values.work as number[]) : [];
      items.push(metric('work', 'Work', `(${work.map((v) => formatNumber(v)).join(', ')})`));
    }
    items.push(metric('frames', '轨迹总步数', String(Math.max(0, result.frames.length - 1))));
    return items;
  }
  if (result.subject === 'deep_learning') {
    const frame = result.frames[index] ?? result.frames[result.frames.length - 1]!;
    return [
      metric('loss', '当前损失', formatNumber(frame.loss), 'accent'),
      metric('output', '输出', frame.output.map((value) => formatNumber(value)).join(', ')),
      metric('weight', '权重范数', formatNumber(frame.weightNorm)),
      metric('grad', '梯度范数', formatNumber(frame.gradNorm)),
    ];
  }
  if (result.subject === 'calculus' && result.kind === 'antiderivative') {
    const frameValue = result.trace[index];
    const constant = readNumber(frameValue?.values?.c, result.exact ?? 0);
    return result.metrics.map((item) =>
      item.id === 'constant'
        ? metric('constant', '积分常数 C', formatNumber(constant), 'accent')
        : item,
    );
  }
  if (result.subject === 'calculus' && result.kind === 'integral') {
    const frame = result.trace[index];
    const n = readNumber(frame?.values?.n, 8);
    const sum = readNumber(frame?.values?.sum, result.approx ?? 0);
    const error = readNumber(frame?.values?.error, result.error ?? 0);
    return [
      metric('sum', `黎曼和 n=${n}`, formatNumber(sum), 'accent'),
      metric('reference', result.exact !== null ? '解析/参照值' : '参照值', formatNumber(result.exact)),
      metric('error', '绝对误差', formatNumber(error)),
      metric('n', '分割数', String(n)),
    ];
  }
  return result.metrics;
}

export function traceLabel(result: LabResult, step: number): string {
  const frame = currentFrame(result, step);
  return frame.label;
}
