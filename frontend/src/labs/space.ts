import { formatNumber } from './expr.ts';
import type { CalculusResult, LabProblem } from './types.ts';

export function evaluateSpace(problem: LabProblem): CalculusResult {
  const model = problem.model;
  const solution = problem.solution;
  const space = solution.space;
  const complete = solution.solution_complete !== false && solution.solution_status !== 'incomplete';
  return {
    subject: 'calculus', task: model.task, kind: 'space',
    headline: solution.answer || solution.summary || '空间计算',
    metrics: [
      { id: 'value', label: '结果', value: solution.answer || '—', tone: 'accent' },
      { id: 'method', label: '方法', value: solution.summary || '—' },
    ],
    checks: [
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
