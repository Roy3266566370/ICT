/** 模板内核共用类型与数值助手；与后端 templates_kernels.py 同口径。 */

export interface TemplateMetric { id: string; label: string; value: string; tone?: string }
export interface TemplateCheck {
  id: string; label: string; status: 'pass' | 'fail' | 'warn'; detail: string;
}
export interface TemplateSeriesPoint { x: number; y: number | null }
export interface TemplateTable { headers: string[]; rows: (string | number)[][] }
export interface TemplatePoint { x: number; y: number; label?: string }

export interface TemplateEvaluation {
  subject: string;
  metrics: TemplateMetric[];
  checks: TemplateCheck[];
  series: TemplateSeriesPoint[];
  overlaySeries?: TemplateSeriesPoint[];
  overlayLabel?: string;
  points?: TemplatePoint[];
  table?: TemplateTable | null;
  trace: Record<string, unknown>[];
  text?: string;
  error?: unknown;
  [key: string]: unknown;
}

export type TemplateValues = Record<string, unknown>;

export function listValue(value: unknown): number[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  if (!value.every((item) => typeof item === 'number' && Number.isFinite(item))) return null;
  return value as number[];
}

export function matrixValue(value: unknown): number[][] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const rows: number[][] = [];
  for (const row of value) {
    if (!Array.isArray(row) || !row.length) return null;
    if (!row.every((item) => typeof item === 'number' && Number.isFinite(item))) return null;
    rows.push(row as number[]);
  }
  return rows.every((row) => row.length === rows[0]!.length) ? rows : null;
}

export function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function metric(id: string, label: string, value: string, tone = ''): TemplateMetric {
  return tone ? { id, label, value, tone } : { id, label, value };
}

export function check(
  id: string,
  label: string,
  status: TemplateCheck['status'],
  detail: string,
): TemplateCheck {
  return { id, label, status, detail };
}

export function fmt(value: number | null | undefined, digits = 8): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return String(Number(value.toPrecision(digits)));
}

export function empty(subject: string, error: string, checks: TemplateCheck[] = []): TemplateEvaluation {
  return { subject, metrics: [], checks, series: [], trace: [], error };
}

export function seriesFrom(xs: number[], ys: (number | null)[]): TemplateSeriesPoint[] {
  return xs.map((x, index) => {
    const y = ys[index];
    return { x, y: typeof y === 'number' && Number.isFinite(y) ? y : null };
  });
}

export function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let index = 1; index <= k; index += 1) {
    result = (result * (n - index + 1)) / index;
  }
  return result;
}
