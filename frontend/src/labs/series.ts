import { compileExpression, formatNumber } from './expr.ts';
import type { CalculusPoint, CalculusResult, LabProblem } from './types.ts';

function curve(compiled: ReturnType<typeof compileExpression>, variable: string, low: number, high: number): CalculusPoint[] {
  const points: CalculusPoint[] = [];
  for (let index = 0; index < 240; index += 1) {
    const x = low + ((high - low) * index) / 239;
    const y = compiled.evalOrNull({ [variable]: x });
    points.push({ x, y: y !== null && Number.isFinite(y) ? y : null });
  }
  return points;
}

export function evaluateSeriesConvergence(problem: LabProblem, params: Record<string, unknown> = {}): CalculusResult {
  const solution = problem.solution;
  const model = problem.model;
  const start = Number(model.index_start ?? 1);
  const points: CalculusPoint[] = [];
  let total = 0;
  let compiled: ReturnType<typeof compileExpression> | null = null;
  try {
    compiled = compileExpression(model.term ?? '0', ['n']);
  } catch {
    compiled = null;
  }
  const terms = Math.max(1, Math.min(200, Math.round(Number(params.terms ?? 40))));
  for (let n = start; n < start + terms && compiled; n += 1) {
    const value = compiled.evalOrNull({ n });
    if (value === null || !Number.isFinite(value)) break;
    total += value;
    points.push({ x: n, y: total });
  }
  const status = solution.series_status ?? 'undetermined';
  const labels: Record<string, string> = {
    absolutely_convergent: '绝对收敛', conditionally_convergent: '条件收敛',
    divergent: '发散', undetermined: '无法判定',
  };
  return {
    subject: 'calculus', task: 'series_convergence', kind: 'series_convergence',
    headline: solution.answer || labels[status] || '数项级数',
    metrics: [
      { id: 'status', label: '敛散性', value: labels[status] ?? status, tone: 'accent' },
      { id: 'method', label: '判别法', value: solution.series_method ?? '—' },
      { id: 'sum', label: '级数和', value: solution.series_sum ?? '—' },
      { id: 'n', label: '已累计项数', value: String(points.length) },
    ],
    checks: [
      { id: 'convergence', label: '敛散性判定', status: solution.solution_complete ? 'pass' : 'warn', detail: solution.answer || solution.incomplete_reason || '未判定。' },
      { id: 'method', label: '判别法', status: solution.series_method ? 'pass' : 'warn', detail: solution.series_method ?? '未找到确定的符号判别法。' },
    ],
    notes: solution.limitations ?? [],
    series: points, seriesPartial: points, domain: { x_min: start, x_max: start + Math.max(1, terms - 1) }, rects: [],
    exact: typeof solution.answer_value === 'number' ? solution.answer_value : null,
    approx: points.length ? points[points.length - 1]!.y : null, error: null,
    answerText: solution.answer || '',
    trace: points.slice(0, 20).map((point, index) => ({ index, label: `n=${point.x}`, detail: `部分和 ${formatNumber(point.y)}`, values: { n: point.x, sum: point.y } })),
    series_status: status, series_method: solution.series_method ?? undefined,
  };
}

export function evaluatePowerSeries(problem: LabProblem): CalculusResult {
  const solution = problem.solution;
  const goal = solution.power_goal ?? problem.model.goal ?? 'radius';
  const center = Number(solution.center ?? problem.model.center ?? 0);
  const radiusText = solution.radius;
  const radius = radiusText && radiusText !== 'oo' ? Number(radiusText) : null;
  let points: CalculusPoint[] = [];
  const source = solution.sum_function ?? solution.polynomial;
  if (source) {
    try {
      const compiled = compileExpression(source, ['x']);
      const span = radius && radius > 0 ? radius * 0.95 : 3;
      points = curve(compiled, 'x', center - span, center + span);
    } catch {
      points = [];
    }
  }
  const complete = solution.solution_complete !== false && solution.solution_status !== 'incomplete';
  return {
    subject: 'calculus', task: 'power_series', kind: 'power_series',
    headline: solution.answer || (goal === 'expand' ? '幂级数展开' : '幂级数'),
    metrics: [
      { id: 'radius', label: '收敛半径', value: solution.radius ?? '—', tone: 'accent' },
      { id: 'interval', label: '收敛区间', value: solution.interval ?? '—' },
      { id: 'sum', label: '和函数/展开式', value: source ?? '—' },
      { id: 'endpoints', label: '端点判断', value: String((solution.endpoint_status ?? []).length) },
    ],
    checks: [
      { id: 'radius', label: '收敛半径', status: solution.radius || goal === 'expand' ? 'pass' : 'fail', detail: solution.radius_method ?? solution.summary ?? '' },
      { id: 'completion', label: '端点/和函数完整', status: complete ? 'pass' : 'warn', detail: complete ? '半径、端点和目标均已处理。' : solution.incomplete_reason ?? '存在未完成项。' },
    ],
    notes: solution.limitations ?? [],
    series: points, domain: { x_min: center - (radius ?? 3), x_max: center + (radius ?? 3) }, rects: [],
    exact: null, approx: null, error: null,
    answerText: solution.answer || '',
    trace: (solution.endpoint_status ?? []).map((item: { label: string; point: string; status: string }, index: number) => ({
      index, label: item.label, detail: `${item.point}：${item.status}`, values: item,
    })),
    power: {
      goal, center, radius: solution.radius, interval: solution.interval,
      endpoints: solution.endpoint_status ?? [], sum_function: solution.sum_function ?? null,
      polynomial: solution.polynomial ?? null, coefficients: solution.coefficients ?? [],
    },
  };
}

export function evaluateFourierSeries(problem: LabProblem, params: Record<string, unknown> = {}): CalculusResult {
  const solution = problem.solution;
  const model = problem.model;
  const original = solution.fourier;
  const order = Math.max(1, Math.min(original?.order ?? 5, Number(params.order ?? original?.order ?? 5)));
  const fourier = original ? { ...original, order, coefficients: original.coefficients.filter(item => item.n <= order) } : original;
  const lower = Number(model.defaults.lower ?? -Math.PI);
  const upper = Number(model.defaults.upper ?? Math.PI);
  let series: CalculusPoint[] = [];
  let overlay: CalculusPoint[] = [];
  if (fourier) {
    try {
      const f = compileExpression(model.expression ?? '0', ['x']);
      series = curve(f, 'x', lower, upper);
      const centered = Math.abs(lower + upper) < 1e-9;
      const phase = centered ? `x*${Math.PI / upper}` : `(x-(${lower}))*${2 * Math.PI / (upper - lower)}`;
      const source = `(${fourier.a0})/2` + fourier.coefficients.map(item => `+(${item.an})*cos(${item.n}*(${phase}))+(${item.bn})*sin(${item.n}*(${phase}))`).join('');
      const partial = compileExpression(source, ['x']);
      overlay = curve(partial, 'x', lower, upper);
    } catch {
      series = [];
      overlay = [];
    }
  }
  const complete = solution.solution_complete !== false && solution.solution_status !== 'incomplete';
  return {
    subject: 'calculus', task: 'fourier_series', kind: 'fourier_series',
    headline: `傅里叶级数（n≤${fourier?.order ?? model.order ?? 5}）`,
    metrics: [
      { id: 'order', label: '截断阶数', value: String(fourier?.order ?? model.order ?? 5), tone: 'accent' },
      { id: 'a0', label: 'a₀', value: fourier?.a0 ?? '—' },
      { id: 'coefficients', label: '系数个数', value: String((fourier?.coefficients.length ?? 0) * 2) },
      { id: 'jump', label: '间断点', value: fourier?.discontinuities.length || fourier?.endpoint_jump ? '有' : '无' },
    ],
    checks: [
      { id: 'coefficients', label: '系数计算', status: complete ? 'pass' : 'fail', detail: complete ? 'a0、an、bn 均已求出。' : solution.incomplete_reason ?? '系数未完成。' },
      { id: 'convergence', label: '和函数与间断点', status: complete ? 'pass' : 'warn', detail: fourier?.convergence_note ?? '' },
    ],
    notes: solution.limitations ?? [], series, overlays: [{ id: 'fourier', label: '傅里叶部分和', series: overlay }],
    domain: { x_min: lower, x_max: upper }, rects: [], exact: null, approx: null, error: null,
    answerText: solution.answer || '',
    trace: (fourier?.coefficients ?? []).slice(0, 20).map((item, index) => ({ index, label: `n=${item.n}`, detail: `a=${item.an}，b=${item.bn}`, values: item })),
    fourier,
  };
}
