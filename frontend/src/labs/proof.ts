import { compileExpression, formatNumber } from './expr.ts';
import type { CalculusPoint, CalculusResult, LabProblem } from './types.ts';

export function evaluateProof(problem: LabProblem): CalculusResult {
  const model = problem.model;
  const solution = problem.solution;
  const lower = Number(model.lower ?? 0);
  const upper = Number(model.upper ?? 1);
  const series: CalculusPoint[] = [];
  if (model.expression) {
    try {
      const compiled = compileExpression(model.expression, ['x']);
      for (let index = 0; index < 200; index += 1) {
        const x = lower + ((upper - lower) * index) / 199;
        const y = compiled.evalOrNull({ x });
        series.push({ x, y: y !== null && Number.isFinite(y) ? y : null });
      }
    } catch {
      series.length = 0;
    }
  }
  const obligations = solution.obligations ?? [];
  const complete = solution.solution_complete !== false && solution.solution_status !== 'incomplete';
  return {
    subject: 'calculus', task: 'proof', kind: 'proof',
    headline: solution.answer || solution.summary || '证明核对',
    metrics: [
      { id: 'status', label: '证明状态', value: solution.proof_status ?? '—', tone: 'accent' },
      { id: 'level', label: '认证级别', value: solution.verification_level ?? '—' },
      { id: 'obligations', label: '已通过义务', value: `${obligations.filter(item => item.status === 'pass').length}/${obligations.length}` },
    ],
    checks: obligations.map(item => ({ id: item.id, label: item.label, status: item.status, detail: item.detail })),
    notes: solution.limitations ?? [],
    series, domain: { x_min: lower, x_max: upper }, rects: [],
    exact: null, approx: null, error: null,
    answerText: solution.answer || '',
    trace: obligations.map((item, index) => ({ index, label: item.label, detail: item.detail, values: item })),
    proof: {
      proof_kind: solution.proof_kind, status: solution.proof_status,
      verification_level: solution.verification_level, obligations,
      certificate: solution.certificate, statement: model.statement,
    },
  };
}
