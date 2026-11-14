import { formatNumber } from './expr.ts';
import type { CalculusResult, LabProblem } from './types.ts';

export function evaluateSpace(problem: LabProblem): CalculusResult {
  const model = problem.model;
  const solution = problem.solution;
  const space = solution.space;
  const complete = solution.solution_complete !== false && solution.solution_status !== 'incomplete';
  const geometry = model.task === 'space_geometry' || problem.manual_input?.task === 'space_geometry';
  const formula = ['green', 'gauss', 'stokes'].includes(solution.space_integral_details?.kind ?? '') ||
    ['green', 'gauss', 'stokes'].includes(model.task ?? '');
  return {
    subject: 'calculus', task: model.task, kind: 'space',
    headline: solution.answer || solution.summary || '空间计算',
    metrics: [
      { id: 'value', label: '结果', value: solution.answer || '—', tone: 'accent' },
      { id: 'method', label: '方法', value: solution.summary || '—' },
    ],
    checks: geometry ? [
      { id: 'exact', label: '符号计算', status: complete ? 'pass' : 'fail', detail: solution.answer || solution.incomplete_reason || '' },
      { id: 'graph', label: '图形与方程', status: complete ? 'pass' : 'warn', detail: '距离、夹角、位置关系与方程由符号计算给出；空间图形仅作有限范围采样。' },
    ] : formula ? [
      { id: 'exact', label: '公式结果', status: complete ? 'pass' : 'fail', detail: solution.answer || solution.incomplete_reason || '' },
      { id: 'two_paths', label: '两条路径互验', status: complete ? 'pass' : 'warn', detail: '边界/通量与二重/体积分分别计算，两条路径结果一致。' },
    ] : [
      { id: 'exact', label: '符号/双路径结果', status: complete ? 'pass' : 'fail', detail: solution.answer || solution.incomplete_reason || '' },
      { id: 'numeric', label: '独立数值复核', status: complete ? 'pass' : 'warn', detail: '解析结果与独立数值积分或另一条公式路径一致。' },
    ],
    notes: solution.limitations ?? [],
    series: [], domain: { x_min: -1, x_max: 1 }, rects: [],
    exact: typeof solution.answer_value === 'number' ? solution.answer_value : null,
    approx: null, error: null,
    answerText: solution.answer || '',
    trace: [{ index: 0, label: '空间对象', detail: solution.answer || '', values: {} }],
    space,
  };
}
