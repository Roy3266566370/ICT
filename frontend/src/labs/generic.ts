import { compileExpression, formatNumber } from './expr.ts';
import type { CalculusPoint, CalculusResult, LabModel, LabProblem, LabResultFrame } from './types.ts';

type Params = Record<string, unknown>;

function numberParam(params: Params, key: string, fallback: number): number {
  const value = params[key];
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function constantsOf(model: LabModel): [string, number][] {
  if (model.constants?.length) return model.constants.map((item) => [item.name, item.value]);
  return (model.params ?? []).map((item) => [
    item.id,
    typeof item.value === 'number' ? item.value : Number(model.defaults?.[item.id] ?? 0),
  ]);
}

function formulaValue(formula: unknown, model: LabModel, params: Params): string | null {
  if (typeof formula !== 'string' || !formula.trim()) return null;
  const constants = constantsOf(model).map(([name]) => name);
  try {
    const compiled = compileExpression(formula, constants);
    const values: Record<string, number> = {};
    for (const [name, fallback] of constantsOf(model)) values[name.toLowerCase()] = numberParam(params, name, fallback);
    const value = compiled.evalOrNull(values);
    return value === null ? formula : formatNumber(value, 8);
  } catch {
    return formula;
  }
}

function answerText(model: LabModel, params: Params, fallback: string): string {
  const kind = model.answer_kind ?? 'text';
  const variables = model.answer_variables ?? [];
  if (kind === 'value') {
    const value = formulaValue(model.answer_formula, model, params) ?? fallback;
    return variables[0] ? `${variables[0]}=${value}` : value;
  }
  if (kind === 'values' && Array.isArray(model.answer_formula)) {
    const values = (model.answer_formula as string[]).map((formula) => formulaValue(formula, model, params) ?? formula);
    return values.length ? values.map((value) => `${variables[0] ?? ''}=${value}`.replace(/^=/, '')).join('；') : fallback;
  }
  if (kind === 'system' && Array.isArray(model.answer_formula)) {
    const rows = model.answer_formula as string[][];
    return rows.map((row) => row.map((formula, index) => `${variables[index] ?? ''}=${formulaValue(formula, model, params) ?? formula}`).join('，')).join('；') || fallback;
  }
  return fallback;
}

function samplePlot(model: LabModel, params: Params): { series: CalculusPoint[]; domain: { x_min: number; x_max: number } } {
  const plot = model.plot;
  const fallback = { series: [] as CalculusPoint[], domain: { x_min: -1, x_max: 1 } };
  if (!plot) return fallback;
  const constants = constantsOf(model).map(([name]) => name);
  try {
    const compiled = compileExpression(plot.expr, [plot.var, ...constants]);
    const values: Record<string, number> = {};
    for (const [name, value] of constantsOf(model)) values[name.toLowerCase()] = numberParam(params, name, value);
    const [low, high] = plot.range;
    const series: CalculusPoint[] = [];
    for (let index = 0; index < 260; index += 1) {
      const x = low + ((high - low) * index) / 259;
      const y = compiled.evalOrNull({ ...values, [plot.var.toLowerCase()]: x });
      series.push({ x, y: y === null || !Number.isFinite(y) ? null : y });
    }
    return { series, domain: { x_min: low, x_max: high } };
  } catch {
    return fallback;
  }
}

export function evaluateGeneric(problem: LabProblem, params: Params): CalculusResult {
  const model = problem.model;
  const { series, domain } = samplePlot(model, params);
  const solution = problem.solution;
  const text = answerText(model, params, solution.answer || '');
  const steps = solution.steps ?? [];
  const trace: LabResultFrame[] = steps.map((step, index) => ({
    index,
    label: step.title,
    detail: step.detail,
    values: {},
  }));
  const checks = solution.checks ?? [];
  return {
    subject: 'calculus',
    kind: 'generic',
    headline: text || '通用符号模型',
    answerText: text,
    metrics: [
      { id: 'answer', label: '当前答案', value: text || '—', tone: 'accent' },
      { id: 'steps', label: '运算步骤', value: String(steps.length) },
    ],
    checks,
    notes: solution.limitations ?? [],
    series,
    rects: [],
    domain,
    exact: null,
    approx: null,
    error: null,
    trace: trace.length ? trace : [{ index: 0, label: '通用符号模型', detail: '滑杆变化后由内核重新计算。', values: {} }],
  };
}

export { answerText as genericAnswerText, samplePlot as genericPlot };