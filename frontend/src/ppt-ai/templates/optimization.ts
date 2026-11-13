import { compileExpression } from '../../labs/expr.ts';
import {
  check,
  empty,
  fmt,
  listValue,
  metric,
  numberValue,
  seriesFrom,
  type TemplateEvaluation,
  type TemplateValues,
} from './types.ts';

const POINTS = 241;

function derivativeAt(compiled: { evalOrNull(values?: Readonly<Record<string, number>>): number | null }, x: number): { d1: number | null; d2: number | null; f: number | null } {
  const h = 1e-5 * Math.max(1, Math.abs(x));
  const f = compiled.evalOrNull({ x });
  const plus = compiled.evalOrNull({ x: x + h });
  const minus = compiled.evalOrNull({ x: x - h });
  if (f === null || plus === null || minus === null) return { d1: null, d2: null, f };
  return { d1: (plus - minus) / (2 * h), d2: (plus - 2 * f + minus) / (h * h), f };
}

export function evaluateNewton(values: TemplateValues, provider: Record<string, unknown>): TemplateEvaluation {
  const expression = String(values.expression ?? provider.expression ?? '');
  const start = numberValue(values.x0, 0);
  const maxIter = Math.max(1, Math.min(50, Math.round(numberValue(values.max_iter, 8))));
  let compiled;
  try {
    compiled = compileExpression(expression, ['x']);
  } catch (error) {
    return empty('optimization', error instanceof Error ? error.message : '目标函数无法解析');
  }
  let x = start;
  const trace: { iteration: number; x: number; f: number; gradient: number; curvature: number }[] = [];
  let status = 'iteration_limit';
  let finalF: number | null = null;
  let finalG: number | null = null;
  let finalH: number | null = null;
  for (let iteration = 1; iteration <= maxIter; iteration += 1) {
    const valuesAt = derivativeAt(compiled, x);
    if (valuesAt.f === null || valuesAt.d1 === null || valuesAt.d2 === null) {
      status = 'invalid_value';
      break;
    }
    finalF = valuesAt.f;
    finalG = valuesAt.d1;
    finalH = valuesAt.d2;
    trace.push({
      iteration,
      x: Number(x.toPrecision(10)),
      f: Number(valuesAt.f.toPrecision(10)),
      gradient: Number(valuesAt.d1.toPrecision(10)),
      curvature: Number(valuesAt.d2.toPrecision(10)),
    });
    if (finalH <= 1e-10) {
      status = finalH < 0 ? 'non_positive_curvature' : 'zero_curvature';
      break;
    }
    const next = x - valuesAt.d1 / valuesAt.d2;
    if (!Number.isFinite(next)) {
      status = 'invalid_value';
      break;
    }
    if (Math.abs(next - x) <= 1e-9) {
      x = next;
      status = 'converged';
      break;
    }
    x = next;
  }
  if (trace.length > 0) {
    const finalValues = derivativeAt(compiled, x);
    finalF = finalValues.f;
    finalG = finalValues.d1;
    finalH = finalValues.d2;
  }
  const classification =
    status === 'converged' && finalH !== null && finalH > 0
      ? 'local_minimum'
      : finalH !== null && finalH < 0
        ? 'local_maximum'
        : status === 'non_positive_curvature' || status === 'zero_curvature'
          ? 'not_a_minimum'
          : status !== 'converged'
            ? 'not_converged'
            : 'flat_curvature';
  const xs = Array.from({ length: POINTS }, (_, index) => start - 3 + (6 * index) / (POINTS - 1));
  const ys = xs.map((value) => {
    const y = compiled.evalOrNull({ x: value });
    return y !== null && Number.isFinite(y) ? y : null;
  });
  const checks = [
    check('curvature_positive', '二阶导为正', finalH !== null && finalH > 0 ? 'pass' : 'warn', `f''(x)=${fmt(finalH)}；曲率非正时停止，不把结果称为极小值。`),
    check('converged', '收敛', status === 'converged' ? 'pass' : 'warn', `停止原因：${status}。`),
    check('finite', '迭代值有限', finalF !== null ? 'pass' : 'fail', `f(x)=${fmt(finalF)}。`),
  ];
  return {
    subject: 'optimization',
    kind: 'newton_1d',
    expression,
    x_final: x,
    f_final: finalF,
    gradient: finalG,
    curvature: finalH,
    classification,
    status,
    series: seriesFrom(xs, ys),
    points: trace.map((item) => ({ x: item.x, y: item.f, label: String(item.iteration) })),
    table: {
      headers: ['迭代', 'x', 'f(x)', "f'(x)", "f''(x)"],
      rows: trace.map((item) => [item.iteration, item.x, item.f, item.gradient, item.curvature]),
    },
    metrics: [
      metric('x_final', 'x*', fmt(x)),
      metric('f_final', 'f(x*)', fmt(finalF)),
      metric('iterations', '迭代次数', String(trace.length)),
      metric('classification', '分类', classification),
    ],
    checks,
    trace: trace.map((item) => ({ ...item })),
  };
}

export function evaluateLeastSquares(values: TemplateValues, _provider: Record<string, unknown>): TemplateEvaluation {
  const xs = listValue(values.xs) ?? [];
  const ys = listValue(values.ys) ?? [];
  const checks = [check('same_length', '数据长度一致', xs.length === ys.length && xs.length >= 2 ? 'pass' : 'fail', `x=${xs.length}，y=${ys.length}。`)];
  if (xs.length !== ys.length || xs.length < 2) {
    return { ...empty('optimization', 'x/y 数据长度不足或不一致', checks), table: null };
  }
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const sxx = xs.reduce((sum, value) => sum + (value - xMean) ** 2, 0);
  const sxy = xs.reduce((sum, value, index) => sum + (value - xMean) * (ys[index]! - yMean), 0);
  if (sxx <= 1e-12) {
    checks.push(check('full_rank', '满秩', 'fail', '所有 x 相同，直线不唯一。'));
    return {
      ...empty('optimization', 'x 数据没有变化，秩不足，不能声称唯一解', checks),
      points: xs.map((x, index) => ({ x, y: ys[index]!, label: String(index + 1) })),
      table: { headers: ['x', 'y'], rows: xs.map((x, index) => [x, ys[index]!]) },
    };
  }
  const slope = sxy / sxx;
  const intercept = yMean - slope * xMean;
  const residuals = xs.map((x, index) => ys[index]! - (slope * x + intercept));
  const sse = residuals.reduce((sum, value) => sum + value * value, 0);
  const sst = ys.reduce((sum, value) => sum + (value - yMean) ** 2, 0);
  const rSquared = sst > 1e-12 ? 1 - sse / sst : null;
  const low = Math.min(...xs);
  const high = Math.max(...xs) > low ? Math.max(...xs) : low + 1;
  const lineXs = Array.from({ length: POINTS }, (_, index) => low + ((high - low) * index) / (POINTS - 1));
  const lineYs = lineXs.map((x) => slope * x + intercept);
  checks.push(check('full_rank', '满秩', 'pass', 'x 数据存在变化，直线唯一。'));
  checks.push(check('finite', '结果有限', Number.isFinite(slope) && Number.isFinite(intercept) && Number.isFinite(sse) ? 'pass' : 'fail', '斜率/截距/残差均为有限值。'));
  return {
    subject: 'optimization',
    kind: 'least_squares',
    slope,
    intercept,
    r_squared: rSquared,
    sse,
    series: seriesFrom(lineXs, lineYs),
    overlayLabel: '拟合直线',
    points: xs.map((x, index) => ({ x, y: ys[index]!, label: String(index + 1) })),
    table: {
      headers: ['#', 'x', 'y', '拟合值', '残差'],
      rows: xs.map((x, index) => [index + 1, x, ys[index]!, slope * x + intercept, residuals[index]!]),
    },
    metrics: [
      metric('slope', '斜率', fmt(slope)),
      metric('intercept', '截距', fmt(intercept)),
      metric('r_squared', 'R²', fmt(rSquared)),
      metric('sse', '残差平方和', fmt(sse)),
    ],
    checks,
    trace: [],
  };
}
