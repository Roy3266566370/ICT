import { formatNumber } from './expr.ts';
import type { LabProblem, OptimizationResult } from './types.ts';

export function evaluateConstrainedExtrema(problem: LabProblem): OptimizationResult {
  const solution = problem.solution;
  const candidates = solution.candidates ?? [];
  const complete = solution.solution_complete !== false && solution.solution_status !== 'incomplete';
  const minima = candidates.filter(item => item.classification === 'minimum');
  const maxima = candidates.filter(item => item.classification === 'maximum');
  return {
    subject: 'optimization', kind: 'constrained_extrema', variables: ['x', 'y'],
    headline: solution.answer || solution.summary || '等式约束极值',
    metrics: [
      { id: 'candidates', label: '约束驻点', value: String(candidates.length), tone: 'accent' },
      { id: 'minimum', label: '极小点', value: String(minima.length) },
      { id: 'maximum', label: '极大点', value: String(maxima.length) },
      { id: 'constraint', label: '约束', value: problem.model.constraint ?? '—' },
    ],
    checks: [
      { id: 'lagrange', label: '乘数方程组', status: complete ? 'pass' : 'fail', detail: complete ? '候选已代回 ∇f=λ∇g 与约束。' : solution.incomplete_reason ?? '未完成。' },
      { id: 'classification', label: '加边 Hessian 分类', status: complete ? 'pass' : 'warn', detail: complete ? '非退化候选已分类。' : '存在未定或退化点。' },
    ],
    notes: [solution.global_note ?? '局部约束极值不等于全局最值。'],
    series: [], grid: null, domain: {},
    trajectory: [], current: null, loss: null, grad_norm: null,
    stopReason: '约束驻点枚举', converged: complete, diverged: false,
    exactPoint: null, exactValue: typeof solution.answer_value === 'number' ? solution.answer_value : null,
    globalNote: solution.global_note ?? '', bounds: {},
    candidates,
    constraint: problem.model.constraint,
    constraint_tex: solution.constraint_tex ?? problem.model.formula_tex,
    trace: candidates.length ? candidates.map((item, index) => ({
      index, label: `(${item.point.join(', ')})`, detail: `${item.classification}，f=${formatNumber(Number(item.value))}，λ=${item.lambda}`, values: item,
    })) : [{ index: 0, label: '约束驻点', detail: solution.answer || solution.incomplete_reason || '待核对', values: {} }],
  };
}
