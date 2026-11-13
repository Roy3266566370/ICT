import { compileExpression } from '../../labs/expr.ts';
import {
  binomial,
  check,
  empty,
  fmt,
  metric,
  numberValue,
  seriesFrom,
  type TemplateEvaluation,
  type TemplateSeriesPoint,
  type TemplateValues,
} from './types.ts';

const POINTS = 241;

interface TaylorMeta {
  family?: string;
  base_x0?: number;
  poly_coefficients?: number[];
  coeffs?: number[];
}

function factorial(value: number): number {
  let result = 1;
  for (let index = 2; index <= value; index += 1) result *= index;
  return result;
}

function knownCoefficients(meta: TaylorMeta, x0: number, order: number): number[] | null {
  const family = String(meta.family ?? '');
  const coefficients = Array.from({ length: order + 1 }, () => 0);
  if (family === 'poly') {
    const base = meta.poly_coefficients;
    if (!Array.isArray(base)) return null;
    for (let degree = 0; degree < base.length; degree += 1) {
      for (let index = 0; index <= degree && index <= order; index += 1) {
        coefficients[index] = (coefficients[index] ?? 0) + base[degree]! * binomial(degree, index) * x0 ** (degree - index);
      }
    }
    return coefficients;
  }
  if (family === 'sin' || family === 'cos') {
    for (let index = 0; index <= order; index += 1) {
      let cosCoefficient = 0;
      let sinCoefficient = 0;
      if (index % 2 === 0) {
        const m = index / 2;
        cosCoefficient = (m % 2 === 0 ? 1 : -1) / factorial(index);
      } else {
        const m = (index - 1) / 2;
        sinCoefficient = (m % 2 === 0 ? 1 : -1) / factorial(index);
      }
      coefficients[index] =
        family === 'sin'
          ? Math.sin(x0) * cosCoefficient + Math.cos(x0) * sinCoefficient
          : Math.cos(x0) * cosCoefficient - Math.sin(x0) * sinCoefficient;
    }
    return coefficients;
  }
  if (family === 'exp') {
    const base = Math.exp(x0);
    for (let index = 0; index <= order; index += 1) coefficients[index] = base / factorial(index);
    return coefficients;
  }
  if (family === 'log1p') {
    if (1 + x0 <= 0) return null;
    coefficients[0] = Math.log(1 + x0);
    for (let index = 1; index <= order; index += 1) {
      coefficients[index] = ((index % 2 === 1 ? 1 : -1) / index) / (1 + x0) ** index;
    }
    return coefficients;
  }
  if (family === 'generic') {
    if (!Array.isArray(meta.coeffs) || Math.abs(numberValue(meta.base_x0) - x0) > 1e-9) return null;
    for (let index = 0; index <= Math.min(order, meta.coeffs.length - 1); index += 1) {
      coefficients[index] = meta.coeffs[index] ?? 0;
    }
    return coefficients;
  }
  return null;
}

function evaluatePolynomial(coefficients: number[], x0: number, x: number): number {
  const h = x - x0;
  let value = 0;
  for (let index = coefficients.length - 1; index >= 0; index -= 1) {
    value = value * h + coefficients[index]!;
  }
  return value;
}

export function evaluateTaylor(values: TemplateValues, provider: Record<string, unknown>): TemplateEvaluation {
  const expression = String(values.expression ?? provider.expression ?? '');
  const meta = (provider.taylor_meta ?? {}) as TaylorMeta;
  const x0 = numberValue(values.x0, 0);
  const order = Math.max(0, Math.min(8, Math.round(numberValue(values.order, 5))));
  const xEval = numberValue(values.x_eval, 0.5);
  let compiled;
  try {
    compiled = compileExpression(expression, ['x']);
  } catch (error) {
    return empty('calculus', error instanceof Error ? error.message : '表达式无法解析');
  }
  const coefficients = knownCoefficients(meta, x0, order);
  const checks = [
    check(
      'supported_family',
      '支持函数族',
      coefficients === null ? 'fail' : 'pass',
      coefficients === null ? '前端无法展开该函数族；后端仍可验收，但当前运行时不伪造系数。' : '函数族在模板允许范围内。',
    ),
  ];
  if (coefficients === null) {
    return { ...empty('calculus', '前端不支持该函数的泰勒展开', checks), text: expression };
  }
  const functionAt = (x: number): number | null => {
    const value = compiled.evalOrNull({ x });
    return value !== null && Number.isFinite(value) ? value : null;
  };
  const low = meta.family === 'log1p' ? Math.max(x0 - 3, -0.99) : x0 - 3;
  const high = x0 + 3;
  const xs = Array.from({ length: POINTS }, (_, index) => low + ((high - low) * index) / (POINTS - 1));
  const functionValues = xs.map(functionAt);
  const approximationValues = xs.map((x) => evaluatePolynomial(coefficients, x0, x));
  const functionValue = functionAt(xEval);
  const approximation = evaluatePolynomial(coefficients, x0, xEval);
  const absError = functionValue === null ? null : Math.abs(functionValue - approximation);
  checks.push(
    check(
      'finite',
      '当前点有有限值',
      functionValue === null ? 'fail' : 'pass',
      '原函数与多项式分别求值。',
    ),
  );
  checks.push(
    check(
      'approximation',
      '近似误差',
      absError !== null && absError <= 10 ** -order * 100 ? 'pass' : 'warn',
      `|f(x)-P(x)| = ${fmt(absError)}。`,
    ),
  );
  return {
    subject: 'calculus',
    kind: 'taylor',
    expression,
    x0,
    order,
    x_eval: xEval,
    value: functionValue,
    approx: approximation,
    error: absError,
    series: seriesFrom(xs, functionValues),
    overlaySeries: seriesFrom(xs, approximationValues),
    overlayLabel: `${order} 阶泰勒多项式`,
    metrics: [
      metric('function_value', 'f(x)', fmt(functionValue)),
      metric('approx_value', 'P(x)', fmt(approximation)),
      metric('abs_error', '绝对误差', fmt(absError)),
      metric('order', '阶数', String(order)),
    ],
    table: {
      headers: ['k', '系数 a_k'],
      rows: coefficients.map((value, index) => [index, fmt(value, 10)]),
    },
    checks,
    trace: [],
  };
}

interface PolyTerm { coefficient: number; xPower: number; yPower: number }

function parseBivariatePolynomial(expression: string): PolyTerm[] | null {
  const normalized = expression.replace(/−/g, '-').replace(/×/g, '*').replace(/\s+/g, '');
  if (!normalized) return null;
  const transformed = normalized.startsWith('-') ? normalized.slice(1) : normalized;
  const tokens = transformed.replace(/-/g, '+-').split('+').filter(Boolean);
  const terms: PolyTerm[] = [];
  let sign = normalized.startsWith('-') ? -1 : 1;
  for (const token of tokens) {
    let body = token;
    let localSign = sign;
    sign = 1;
    if (body.startsWith('-')) {
      localSign *= -1;
      body = body.slice(1);
    }
    if (!body) return null;
    if (/^\d+(?:\.\d+)?$/.test(body)) {
      terms.push({ coefficient: localSign * Number(body), xPower: 0, yPower: 0 });
      continue;
    }
    const match = /^(\d+(?:\.\d+)?)?\*?x(?:\^(\d+))?(?:\*y(?:\^(\d+))?)?$/.exec(body)
      ?? /^(\d+(?:\.\d+)?)?\*?y(?:\^(\d+))?$/.exec(body);
    if (!match) return null;
    const coefficient = localSign * (match[1] ? Number(match[1]) : 1);
    if (body.includes('x')) {
      terms.push({
        coefficient,
        xPower: match[2] ? Number(match[2]) : 1,
        yPower: match[3] ? Number(match[3]) : body.includes('y') ? 1 : 0,
      });
    } else {
      terms.push({ coefficient, xPower: 0, yPower: match[2] ? Number(match[2]) : 1 });
    }
  }
  return terms.length ? terms : null;
}

export function evaluateDoubleIntegral(values: TemplateValues, provider: Record<string, unknown>): TemplateEvaluation {
  const expression = String(values.expression ?? provider.expression ?? '');
  const ax = numberValue(values.ax);
  const bx = numberValue(values.bx);
  const ay = numberValue(values.ay);
  const by = numberValue(values.by);
  let nx = Math.max(1, Math.min(64, Math.round(numberValue(values.nx, 20))));
  let ny = Math.max(1, Math.min(64, Math.round(numberValue(values.ny, 20))));
  const checks = [
    check('rectangular_domain', '矩形区域', ax < bx && ay < by ? 'pass' : 'fail', `x∈[${ax},${bx}]，y∈[${ay},${by}]。`),
    check('grid_limit', '网格规模', 'pass', `${nx}×${ny}。`),
  ];
  if (ax >= bx || ay >= by) return { ...empty('calculus', '积分上下限无效', checks) };
  let compiled;
  try {
    compiled = compileExpression(expression, ['x', 'y']);
  } catch (error) {
    return empty('calculus', error instanceof Error ? error.message : '被积函数无法解析', checks);
  }
  const dx = (bx - ax) / nx;
  const dy = (by - ay) / ny;
  let numeric = 0;
  const rows: (string | number)[][] = [];
  for (let j = 0; j < ny; j += 1) {
    const yMid = ay + (j + 0.5) * dy;
    let strip = 0;
    for (let i = 0; i < nx; i += 1) {
      const xMid = ax + (i + 0.5) * dx;
      const value = compiled.evalOrNull({ x: xMid, y: yMid });
      if (value !== null && Number.isFinite(value)) strip += value;
    }
    strip *= dx * dy;
    numeric += strip;
    rows.push([`[${(ay + j * dy).toPrecision(3)}, ${(ay + (j + 1) * dy).toPrecision(3)}]`, strip, numeric]);
  }
  const polynomial = parseBivariatePolynomial(expression);
  let analytic: number | null = null;
  if (polynomial) {
    analytic = 0;
    for (const term of polynomial) {
      if (term.xPower < 0 || term.yPower < 0) {
        analytic = null;
        break;
      }
      analytic +=
        (term.coefficient * (bx ** (term.xPower + 1) - ax ** (term.xPower + 1)) * (by ** (term.yPower + 1) - ay ** (term.yPower + 1))) /
        ((term.xPower + 1) * (term.yPower + 1));
    }
  }
  const error = analytic === null ? null : Math.abs(numeric - analytic);
  checks.push(check('finite', '网格求和有限', Number.isFinite(numeric) ? 'pass' : 'fail', `数值积分 ${fmt(numeric)}。`));
  checks.push(check('analytic_available', '解析参考值', analytic === null ? 'warn' : 'pass', analytic === null ? '当前函数未取得前端解析参考值，只显示数值近似。' : `解析值 ${fmt(analytic)}。`));
  return {
    subject: 'calculus',
    kind: 'double_integral',
    expression,
    numeric,
    analytic,
    nx,
    ny,
    series: [],
    table: { headers: ['y 区间', '条带积分', '累计'], rows },
    metrics: [
      metric('numeric', '数值近似', fmt(numeric)),
      metric('analytic', '解析参考', fmt(analytic)),
      metric('error', '误差', fmt(error)),
      metric('grid', '网格', `${nx}×${ny}`),
    ],
    checks,
    trace: [],
  };
}

export function taylorOverlayForTest(meta: TaylorMeta, x0: number, order: number): number[] | null {
  return knownCoefficients(meta, x0, order);
}

export type { TaylorMeta, TemplateSeriesPoint };
