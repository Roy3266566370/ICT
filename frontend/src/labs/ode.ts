import { compileExpression, formatNumber } from './expr.ts';
import type { CalculusPoint, CalculusResult, LabProblem } from './types.ts';

export function evaluateOde(problem: LabProblem, params: Record<string, unknown> = {}): CalculusResult {
  const model = problem.model;
  const solution = problem.solution;
  const variable = model.independent_variable ?? 'x';
  const lower = Number(params.x_min ?? solution.plot_window?.x_min ?? model.defaults.x_min ?? -3);
  const upper = Number(params.x_max ?? solution.plot_window?.x_max ?? model.defaults.x_max ?? 3);
  const series: CalculusPoint[] = [];
  const source = solution.plot_expression;
  if (source) {
    try {
      const compiled = compileExpression(source, [variable]);
      for (let index = 0; index < 260; index += 1) {
        const x = lower + ((upper - lower) * index) / 259;
        const y = compiled.evalOrNull({ [variable]: x });
        series.push({ x, y: y !== null && Number.isFinite(y) ? y : null });
      }
    } catch {
      series.length = 0;
    }
  }
  const target = solution.target ?? null;
  const exact = typeof solution.answer_value === 'number' ? solution.answer_value : null;
  const residual = solution.residual_verified === true;
  const initial = solution.initial_conditions_verified === true;
  const complete = solution.solution_complete === true && solution.solution_status === 'complete';
  return {
    subject: 'calculus', task: 'ode', kind: 'ode',
    headline: solution.answer || solution.summary || '微分方程',
    metrics: [
      { id: 'order', label: '方程阶数', value: String(solution.ode_order ?? model.order ?? 1), tone: 'accent' },
      { id: 'hints', label: '方程类型', value: (solution.ode_hints ?? []).join('、') || '—' },
      { id: 'target', label: '组合量', value: target?.text ?? '—' },
      { id: 'residual', label: '残差核验', value: residual ? '通过' : '未通过' },
    ],
    checks: [
      { id: 'residual', label: '代入原方程残差', status: residual ? 'pass' : 'fail', detail: residual ? 'checkodesol 残差为 0。' : '残差核验未通过。' },
      { id: 'initial', label: '初值条件', status: !solution.initial_conditions?.length ? 'warn' : initial ? 'pass' : 'fail', detail: !solution.initial_conditions?.length ? '未给初值，不自动补入条件或声称唯一解。' : initial ? '初值逐条满足。' : '初值条件未满足。' },
      { id: 'explicit', label: '显式解与组合量', status: complete ? 'pass' : 'warn', detail: complete ? '已得到显式解并完成组合量。' : solution.incomplete_reason ?? '存在未完成项。' },
    ],
    notes: solution.limitations ?? [],
    series, domain: { x_min: lower, x_max: upper }, rects: [],
    exact, approx: null, error: null,
    answerText: solution.answer || '',
    trace: [
      { index: 0, label: '方程', detail: model.equation ?? '', values: { order: solution.ode_order } },
      { index: 1, label: '解', detail: solution.exact ?? '', values: {} },
    ],
    ode: {
      order: solution.ode_order, hints: solution.ode_hints ?? [],
      solution: solution.plot_expression ?? solution.general_solution ?? '',
      initial_conditions: solution.initial_conditions ?? [], target,
    },
  };
}
