import { inspectMath } from './mathKeyboard.ts';

export type IntegralTask = 'integral' | 'antiderivative';
export interface ManualIntegralDraft {
  task: IntegralTask;
  expression: string;
  variable: string;
  lower: string;
  upper: string;
}
export interface ManualIntegralPreview {
  task: IntegralTask;
  label: string;
  conditions: Record<string, string>;
  latex: string;
  question: string;
}

export function manualConditions(draft: ManualIntegralDraft): Record<string, string> {
  return { expression: draft.expression.trim(), variable: draft.variable,
    ...(draft.task === 'integral' ? { lower: draft.lower.trim(), upper: draft.upper.trim() } : {}) };
}

export function manualInputKey(draft: ManualIntegralDraft): string {
  return JSON.stringify([draft.task, manualConditions(draft)]);
}

export function manualInputError(draft: ManualIntegralDraft): string | null {
  if (!draft.expression.trim()) return '请填写被积函数。';
  const expression = inspectMath(draft.expression, [draft.variable]);
  if (expression.error) return `请检查公式：${expression.error}`;
  if (draft.task === 'integral') {
    for (const [key, label] of [['lower', '下限'], ['upper', '上限']] as const) {
      if (!draft[key].trim()) return `请填写积分${label}。`;
      if (inspectMath(draft[key], []).error) return `积分${label}必须是常数表达式，如 0、1/3 或 pi。`;
    }
  }
  return null;
}
