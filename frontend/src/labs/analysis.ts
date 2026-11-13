/** P1 分析类题目的前端确定性计算：极限、泰勒、高阶导数、区间研究。 */
import { clamp, compileExpression, formatNumber } from './expr.ts';
import { readNumber } from './types.ts';
import type {
  CalculusPoint,
  CalculusResult,
  LabCheck,
  LabModel,
  LabProblem,
  LabResultFrame,
  LabResultMetric,
} from './types.ts';

type Params = Record<string, unknown>;

function metric(id: string, label: string, value: string, tone?: LabResultMetric['tone']): LabResultMetric {
  return { id, label, value, tone };
}

function check(id: string, label: string, status: LabCheck['status'], detail: string): LabCheck {
  return { id, label, status, detail };
}

function frame(index: number, label: string, detail: string, values: Record<string, unknown>): LabResultFrame {
  return { index, label, detail, values };
}

function seriesOf(evaluate: (x: number) => number | null, low: number, high: number, skip?: number | null): CalculusPoint[] {
  const points: CalculusPoint[] = [];
  for (let index = 0; index < 240; index += 1) {
    const x = low + ((high - low) * index) / 239;
    const value = skip != null && Math.abs(x - skip) < 1e-9 ? null : evaluate(x);
    points.push({ x, y: value !== null && Number.isFinite(value) ? value : null });
  }
  return points;
}

function compileFunction(model: LabModel) {
  const variable = model.variable ?? 'x';
  const compiled = compileExpression(model.expression ?? 'x^2', [variable]);
  return { variable, evaluate: (x: number) => compiled.evalOrNull({ [variable]: x }) };
}

function constantValue(text: string): number | null {
  try {
    const value = compileExpression(text, []).eval({});
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function payloadValue(payload: { kind?: string; value?: number | null } | null | undefined): number | null {
  if (!payload || payload.kind !== 'finite') return null;
  return typeof payload.value === 'number' && Number.isFinite(payload.value) ? payload.value : null;
}

function factorial(value: number): number {
  let result = 1;
  for (let index = 2; index <= value; index += 1) result *= index;
  return result;
}

/* -------------------------------------------------------------------------- */
/* 极限                                                                       */
/* -------------------------------------------------------------------------- */

export function evaluateLimit(problem: LabProblem, params: Params): CalculusResult {
  const model = problem.model;
  const solution = problem.solution;
  const { variable, evaluate } = compileFunction(model);
  const infinite = model.limit_point_value === null || model.limit_point_value === undefined;
  const originalPoint = infinite ? null : (model.limit_point_value as number);
  const point = infinite ? null : readNumber(params.point, originalPoint ?? 0);
  const side = (String(params.side ?? model.side ?? 'both') as 'both' | 'left' | 'right');
  const samePoint = point !== null && originalPoint !== null && Math.abs(point - originalPoint) < 1e-9;
  const low = point === null ? -10 : point - 3;
  const high = point === null ? 10 : point + 3;
  const series = seriesOf(evaluate, low, high, point);
  const sideEstimate = (direction: 'left' | 'right'): number | null => {
    if (point === null) {
      let last: number | null = null;
      for (let exponent = 2; exponent <= 6; exponent += 1) {
        const probe = (model.limit_point ?? '').includes('-') ? -(10 ** exponent) : 10 ** exponent;
        const value = evaluate(probe);
        if (value !== null && Number.isFinite(value)) last = value;
      }
      return last;
    }
    let last: number | null = null;
    for (let exponent = 1; exponent <= 8; exponent += 1) {
      const step = 10 ** -exponent;
      const value = evaluate(point + (direction === 'left' ? -step : step));
      if (value !== null && Number.isFinite(value)) last = value;
    }
    return last;
  };
  const exactLeft = samePoint || infinite ? solution.left ?? null : null;
  const exactRight = samePoint || infinite ? solution.right ?? null : null;
  const exactBoth = samePoint || infinite ? solution.two_sided ?? null : null;
  const leftValue = payloadValue(exactLeft) ?? sideEstimate('left');
  const rightValue = payloadValue(exactRight) ?? sideEstimate('right');
  const selectedPayload = side === 'left' ? exactLeft : side === 'right' ? exactRight : exactBoth;
  const exact = payloadValue(selectedPayload);
  const approx = side === 'left' ? leftValue : side === 'right' ? rightValue : rightValue;
  const error = exact !== null && approx !== null ? Math.abs(exact - approx) : null;
  const frames: LabResultFrame[] = [];
  if (point !== null) {
    for (let exponent = 1; exponent <= 8; exponent += 1) {
      const h = 10 ** -exponent;
      const left = evaluate(point - h);
      const right = evaluate(point + h);
      frames.push(frame(exponent - 1, `h=1e-${exponent}`, `左 ${formatNumber(left)} · 右 ${formatNumber(right)}`, {
        h, left: Number.isFinite(left ?? NaN) ? left : null, right: Number.isFinite(right ?? NaN) ? right : null,
      }));
    }
  }
  const leftText = exactLeft?.text ?? formatNumber(leftValue);
  const rightText = exactRight?.text ?? formatNumber(rightValue);
  const bothText = exactBoth?.text ?? rightText;
  const selectedText = selectedPayload?.text ?? (side === 'left' ? leftText : side === 'right' ? rightText : bothText);
  if (!frames.length) {
    frames.push(frame(0, '极限结论', selectedText, { point, side }));
  }
  const leftRightOkay =
    exactLeft && exactRight
      ? exactLeft.kind === exactRight.kind && (exactLeft.kind !== 'finite' || Math.abs((leftValue ?? 0) - (rightValue ?? 0)) < 1e-6 || bothText.includes('不存在'))
      : leftValue !== null && rightValue !== null && Math.abs(leftValue - rightValue) <= 1e-3 * Math.max(1, Math.abs(leftValue));
  return {
    subject: 'calculus',
    task: 'limit',
    kind: 'limit',
    headline: `lim ${variable}→${infinite ? model.limit_point : formatNumber(point)} f = ${side === 'both' ? bothText : selectedText}`,
    metrics: [
      metric('left', '左极限', leftText),
      metric('right', '右极限', rightText),
      metric('both', side === 'both' ? '双侧极限' : '所选方向极限', selectedText, 'accent'),
      metric('approx', '数值估计', formatNumber(approx)),
    ],
    checks: [
      check(
        'left_right',
        '左右极限核对',
        leftRightOkay ? 'pass' : 'warn',
        `左极限 ${leftText}，右极限 ${rightText}；双侧结论 ${bothText}。`,
      ),
      check(
        'numeric',
        '数值逼近核对',
        error !== null && error <= 0.02 * Math.max(1, Math.abs(exact ?? 0)) ? 'pass' : 'warn',
        `数值估计 ${formatNumber(approx)}，符号结论 ${exact === null ? '非有限值或不存在' : formatNumber(exact)}。`,
      ),
    ],
    notes: ['结论以符号左右极限为准；数值逼近只用于核对，不改写不存在或发散。'],
    series,
    domain: { x_min: low, x_max: high },
    rects: [],
    exact,
    approx,
    error,
    answerText: selectedPayload ? selectedText : selectedText === '—' ? '无法判定' : `≈ ${selectedText}`,
    trace: frames,
    limit: {
      point,
      side,
      left: exactLeft ?? (leftValue === null ? null : { kind: 'finite', value: leftValue, text: formatNumber(leftValue) }),
      right: exactRight ?? (rightValue === null ? null : { kind: 'finite', value: rightValue, text: formatNumber(rightValue) }),
      value: selectedPayload ?? { kind: approx === null ? 'does_not_exist' : 'finite', value: approx, text: selectedText },
      status: selectedPayload?.kind ?? (exact === null ? 'does_not_exist' : 'finite'),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 泰勒展开                                                                   */
/* -------------------------------------------------------------------------- */

function numericDerivative(evaluate: (x: number) => number | null, point: number, order: number): number | null {
  if (order > 6) return null;
  const h = order >= 4 ? 1e-2 : 1e-3;
  const choose = (n: number, k: number) => {
    let result = 1;
    for (let index = 1; index <= k; index += 1) result = (result * (n - index + 1)) / index;
    return result;
  };
  let sum = 0;
  for (let index = 0; index <= order; index += 1) {
    const sample = point + (order / 2 - index) * h;
    const value = evaluate(sample);
    if (value === null || !Number.isFinite(value)) return null;
    sum += (index % 2 === 0 ? 1 : -1) * choose(order, index) * value;
  }
  const result = sum / h ** order;
  return Number.isFinite(result) ? result : null;
}

export function evaluateTaylor(problem: LabProblem, params: Params): CalculusResult {
  const model = problem.model;
  const solution = problem.solution;
  const { variable, evaluate } = compileFunction(model);
  const point = readNumber(params.point, model.taylor_point_value ?? 0);
  const order = Math.round(clamp(readNumber(params.order, model.order ?? 3), 1, 10));
  const samePoint = Math.abs(point - (model.taylor_point_value ?? 0)) < 1e-9;
  const sameOrder = order === (model.order ?? 3);
  let coefficients: (number | null)[] = [];
  let polynomial = '';
  let numeric = false;
  if (samePoint && sameOrder && solution.coefficients?.length) {
    coefficients = Array.from({ length: order + 1 }, (_, index) => {
      const item = solution.coefficients?.find((entry) => entry.order === index);
      return item ? constantValue(item.value) : null;
    });
    polynomial = solution.polynomial ?? solution.answer ?? '';
  } else {
    numeric = true;
    for (let index = 0; index <= order; index += 1) {
      const derivative = numericDerivative(evaluate, point, index);
      coefficients.push(derivative === null ? null : derivative / factorial(index));
    }
    polynomial = '';
  }
  const polynomialValue = (x: number): number | null => {
    let total = 0;
    for (let index = 0; index < coefficients.length; index += 1) {
      const coefficient = coefficients[index];
      if (coefficient === null || coefficient === undefined || !Number.isFinite(coefficient)) return null;
      total += coefficient * (x - point) ** index;
    }
    return Number.isFinite(total) ? total : null;
  };
  if (numeric) {
    const pieces: string[] = [];
    coefficients.forEach((coefficient, index) => {
      if (coefficient === null) return;
      if (index === 0) pieces.push(formatNumber(coefficient));
      else pieces.push(`${formatNumber(coefficient)}*(x-${formatNumber(point)})^${index}`);
    });
    polynomial = pieces.join(' + ').replace(/\+ -/g, '- ') || '—';
  }
  const low = point - 3;
  const high = point + 3;
  const series = seriesOf(evaluate, low, high, point);
  const overlay = seriesOf((x) => polynomialValue(x), low, high, point);
  const errors: number[] = [];
  for (let index = 0; index < 120; index += 1) {
    const x = point - 0.6 + (1.2 * index) / 119;
    const target = evaluate(x);
    const approx = polynomialValue(x);
    if (target !== null && approx !== null && Number.isFinite(target) && Number.isFinite(approx)) {
      errors.push(Math.abs(target - approx));
    }
  }
  const maxError = errors.length ? Math.max(...errors) : null;
  const frames: LabResultFrame[] = [];
  for (let partialOrder = 1; partialOrder <= order; partialOrder += 1) {
    const partial = (x: number) => {
      let total = 0;
      for (let index = 0; index <= partialOrder; index += 1) {
        const coefficient = coefficients[index];
        if (coefficient === null || coefficient === undefined || !Number.isFinite(coefficient)) return null;
        total += coefficient * (x - point) ** index;
      }
      return total;
    };
    const partialErrors: number[] = [];
    for (const delta of [-0.4, -0.2, 0.2, 0.4]) {
      const target = evaluate(point + delta);
      const approx = partial(point + delta);
      if (target !== null && approx !== null) partialErrors.push(Math.abs(target - approx));
    }
    frames.push(frame(partialOrder - 1, `n=${partialOrder}`, `最大偏差 ${formatNumber(partialErrors.length ? Math.max(...partialErrors) : null)}`, {
      order: partialOrder, error: partialErrors.length ? Math.max(...partialErrors) : null,
    }));
  }
  if (!frames.length) {
    frames.push(frame(0, `n=${order}`, polynomial, { order, error: maxError }));
  }
  return {
    subject: 'calculus',
    task: 'taylor',
    kind: 'taylor',
    headline: `在 x=${formatNumber(point)} 处展开到 ${order} 阶`,
    metrics: [
      metric('order', '展开阶数', String(order), 'accent'),
      metric('polynomial', numeric ? '数值泰勒多项式' : '泰勒多项式', polynomial),
      metric('error', '附近最大偏差', formatNumber(maxError)),
      metric('coefficients', '系数个数', String(coefficients.length)),
    ],
    checks: [
      check(
        'expansion',
        '展开式计算',
        coefficients.every((value) => value !== null) ? 'pass' : 'fail',
        numeric ? '阶数或展开点已改动，当前系数由数值差分估计。' : '系数来自后端符号展开。',
      ),
      check(
        'error',
        '附近数值误差',
        maxError !== null && maxError <= 0.05 ? 'pass' : 'warn',
        `展开点附近抽样最大偏差 ${formatNumber(maxError)}；余项只说明局部逼近。`,
      ),
    ],
    notes: [
      '实线为原函数，虚线为泰勒多项式。',
      numeric ? '展开点或阶数已改动：显示数值系数参照，不能标为精确展开。' : '当前显示后端符号展开结果。',
    ],
    series,
    domain: { x_min: low, x_max: high },
    rects: [],
    exact: null,
    approx: null,
    error: maxError,
    answerText: polynomial,
    trace: frames,
    taylor: { point, order, coefficients, polynomial, overlay, max_error: maxError },
  };
}

/* -------------------------------------------------------------------------- */
/* 高阶导数                                                                   */
/* -------------------------------------------------------------------------- */

export function evaluateHigherDerivative(problem: LabProblem, params: Params): CalculusResult {
  const model = problem.model;
  const solution = problem.solution;
  const { variable, evaluate } = compileFunction(model);
  const order = Math.round(clamp(readNumber(params.order, model.order ?? 1), 1, 10));
  const originalPoint = model.derivative_point == null ? null : Number(model.derivative_point);
  const point = readNumber(params.point, originalPoint ?? 0);
  const sameOrder = order === (model.order ?? 1);
  const samePoint = originalPoint !== null && Math.abs(point - originalPoint) < 1e-9;
  const exact = sameOrder && samePoint ? solution.derivative_value ?? null : null;
  const numeric = sameOrder && samePoint ? null : numericDerivative(evaluate, point, order);
  const value = exact ?? numeric;
  const low = point - 3;
  const high = point + 3;
  const series = seriesOf(evaluate, low, high, point);
  return {
    subject: 'calculus',
    task: 'higher_derivative',
    kind: 'higher_derivative',
    headline: `f^(${order})(${formatNumber(point)}) ${exact !== null ? '=' : '≈'} ${formatNumber(value)}`,
    metrics: [
      metric('order', '导数阶数', String(order), 'accent'),
      metric('expression', '导函数', sameOrder ? solution.derivative_expression ?? '—' : '数值差分参照'),
      metric('value', '指定点导数值', formatNumber(value)),
      metric('numeric', '数值差分参照', formatNumber(numeric)),
    ],
    checks: [
      check(
        'derivative',
        '高阶导数核对',
        value !== null ? 'pass' : 'fail',
        sameOrder && samePoint ? '当前为后端符号导数。' : '阶数或点已改动，数值结果为差分参照。',
      ),
      check(
        'numeric',
        '数值差分核对',
        exact !== null && numeric !== null && Math.abs(exact - numeric) <= 0.05 * Math.max(1, Math.abs(exact)) ? 'pass' : 'warn',
        `符号值 ${formatNumber(exact)}，数值差分 ${formatNumber(numeric)}；高阶差分误差通常更大。`,
      ),
    ],
    notes: ['曲线为原函数；高阶数值差分只用于核对，不替代符号求导。'],
    series,
    domain: { x_min: low, x_max: high },
    rects: [],
    exact,
    approx: numeric,
    error: exact !== null && numeric !== null ? Math.abs(exact - numeric) : null,
    answerText: sameOrder ? solution.derivative_expression ?? formatNumber(value) : `≈ ${formatNumber(value)}`,
    trace: [frame(0, `n=${order}`, sameOrder ? `f^(${order}) 已由后端求出` : '数值差分参照', { order, value })],
    higher: { order, point, value, expression: sameOrder ? solution.derivative_expression ?? '' : '数值差分参照' },
  };
}

/* -------------------------------------------------------------------------- */
/* 函数区间研究                                                               */
/* -------------------------------------------------------------------------- */

export function evaluateFunctionStudy(problem: LabProblem): CalculusResult {
  const model = problem.model;
  const solution = problem.solution;
  const { evaluate } = compileFunction(model);
  const plot = model.plot_domain ?? [model.study_lower ?? -6, model.study_upper ?? 6];
  const low = plot[0] ?? -6;
  const high = plot[1] ?? 6;
  const series = seriesOf(evaluate, low, high);
  const study = solution.study;
  const monotonic = study?.monotonic ?? [];
  const concavity = study?.concavity ?? [];
  const extrema = study?.extrema ?? [];
  const inflections = study?.inflections ?? [];
  const asymptotes = study?.asymptotes ?? { vertical: [], horizontal: [], oblique: [] };
  const complete = solution.solution_complete !== false && solution.solution_status !== 'incomplete';
  const trace = monotonic.map((item, index) => frame(index, item.label, item.interval, { from: item.from, to: item.to }));
  if (!trace.length) trace.push(frame(0, '区间研究', solution.answer || '区间研究尚未完成', {}));
  return {
    subject: 'calculus',
    task: 'function_study',
    kind: 'function_study',
    headline: '单调性、凹凸性、极值、拐点与渐近线',
    metrics: [
      metric('increasing', '递增区间数', String(monotonic.filter((item) => item.kind === 'increasing').length), 'accent'),
      metric('decreasing', '递减区间数', String(monotonic.filter((item) => item.kind === 'decreasing').length)),
      metric('extrema', '极值点', String(extrema.length)),
      metric('inflections', '拐点', String(inflections.length)),
      metric('asymptotes', '渐近线', String(asymptotes.vertical.length + asymptotes.horizontal.length + asymptotes.oblique.length)),
    ],
    checks: [
      check('complete', '区间分解完成', complete ? 'pass' : 'fail', complete ? '全部临界点和渐近线均已核对。' : '临界点或渐近线尚未完整求出。'),
      check('sign', '区间判号', complete ? 'pass' : 'warn', complete ? '各子区间内点的一阶、二阶导数符号已核对。' : '部分区间无法符号判号。'),
    ],
    notes: ['绿色/红色带表示单调区间；竖线、横线表示渐近线。'],
    series,
    domain: { x_min: low, x_max: high },
    rects: [],
    exact: null,
    approx: null,
    error: null,
    answerText: solution.answer || '区间研究尚未完成',
    trace,
    study: study as CalculusResult['study'],
  };
}
