/** 办公决策自由积木的纯函数内核：表格、增长、情景、折现、加权评分与瀑布。 */

import type { PortValue } from './types.ts';

export type SeriesValue = Extract<PortValue, { kind: 'series' }>;

const MAX_POINTS = 60;
const MAX_VALUE = 1e12;

export function clampNumber(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function finite(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-MAX_VALUE, Math.min(MAX_VALUE, value));
}

export function makeSeries(
  title: string,
  labels: string[],
  values: number[],
  secondary?: { name: string; values: number[] }[],
): SeriesValue {
  const count = Math.max(1, Math.min(MAX_POINTS, Math.min(labels.length, values.length)));
  const safeLabels = Array.from({ length: count }, (_, index) => String(labels[index] ?? `#${index + 1}`).slice(0, 40));
  const safeValues = Array.from({ length: count }, (_, index) => finite(values[index] ?? 0));
  const safeSecondary = secondary?.slice(0, 4).map((item) => ({
    name: String(item.name || '对比').slice(0, 40),
    values: Array.from({ length: count }, (_, index) => finite(item.values[index] ?? 0)),
  }));
  return {
    kind: 'series',
    title: String(title || '数据序列').slice(0, 60),
    labels: safeLabels,
    values: safeValues,
    ...(safeSecondary?.length ? { secondary: safeSecondary } : {}),
  };
}

function parseNumeric(raw: string): number {
  const text = raw.trim();
  const percent = text.endsWith('%');
  const cleaned = text
    .replace(/[¥$€£\s]/g, '')
    .replace(/%$/, '')
    .replace(/,/g, '');
  const value = Number(cleaned);
  if (!Number.isFinite(value)) throw new Error(`无法解析数值「${raw.trim()}」`);
  const result = percent ? value / 100 : value;
  return finite(result);
}

export interface TableParseResult {
  labels: string[];
  values: number[];
}

/** 拆分单行 CSV/TSV，支持双引号包裹的逗号、千分位和转义引号。 */
export function splitTableLine(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((cell) => cell.trim());
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (character === ',' || character === '，' || character === ';' || character === '；')) {
      cells.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

/** 解析两列 CSV/TSV；首行若第二列不是数字则视为表头。 */
export function parseBusinessTable(text: string): TableParseResult {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error('请粘贴至少一行数据');
  const rows: { label: string; value: number }[] = [];
  for (const line of lines) {
    if (rows.length === 0 && /^[^\d+\-.,%¥$€£\s]/.test(line) && !/\d/.test(line)) continue;
    const cells = splitTableLine(line);
    const first = cells[0] ?? '';
    const second = cells[1] ?? '';
    if (!first && !second) continue;
    if (!second) {
      try {
        rows.push({ label: `#${rows.length + 1}`, value: parseNumeric(first) });
      } catch {
        continue;
      }
      continue;
    }
    try {
      rows.push({ label: (first || `#${rows.length + 1}`).slice(0, 24), value: parseNumeric(second) });
    } catch {
      if (rows.length === 0) continue;
      throw new Error(`第 ${rows.length + 1} 行的数值无法解析：${second}`);
    }
    if (rows.length >= MAX_POINTS) break;
  }
  if (!rows.length) throw new Error('没有找到有效的「标签, 数值」行');
  return { labels: rows.map((row) => row.label), values: rows.map((row) => row.value) };
}

export const BUSINESS_SAMPLES = [
  {
    id: 'revenue',
    label: '月度营收',
    text:
      '月份,营收\n1月,128\n2月,136\n3月,151\n4月,147\n5月,163\n6月,178\n7月,171\n8月,189\n9月,204\n10月,218\n11月,231\n12月,252',
  },
  {
    id: 'cost',
    label: '费用结构',
    text: '科目,金额\n研发,86\n市场,54\n人力,72\n云服务,31\n办公,18\n其他,12',
  },
  {
    id: 'plans',
    label: '项目方案',
    text: '方案,预期收益\n方案 A,82\n方案 B,67\n方案 C,95\n方案 D,74',
  },
] as const;

export function businessSampleText(sample: number): string {
  return BUSINESS_SAMPLES[Math.round(clampNumber(sample, 0, 0, BUSINESS_SAMPLES.length - 1))]?.text ?? BUSINESS_SAMPLES[0]!.text;
}

export function businessTableSeries(text: string, sample = 0): SeriesValue {
  const source = text.trim() ? text : businessSampleText(sample);
  const parsed = parseBusinessTable(source);
  return makeSeries('业务数据', parsed.labels, parsed.values);
}

export interface GrowthOptions {
  initial: number;
  monthlyRate: number;
  months: number;
  seasonality: number;
  overrideRate?: number;
}

export function growthSeries(options: GrowthOptions): SeriesValue {
  const initial = clampNumber(options.initial, 100, -1e6, 1e7);
  const monthlyRate = clampNumber(options.overrideRate ?? options.monthlyRate, 0.05, -0.5, 1);
  const months = Math.round(clampNumber(options.months, 12, 1, 24));
  const seasonality = clampNumber(options.seasonality, 0, 0, 0.6);
  const labels = Array.from({ length: months }, (_, index) => `第 ${index + 1} 月`);
  const values = labels.map((_, index) =>
    finite(initial * (1 + monthlyRate) ** index * (1 + seasonality * Math.sin((index + 1) * Math.PI * 2 / 12))));
  return makeSeries('增长曲线', labels, values);
}

export interface ScenarioOptions {
  spread: number;
  drift: number;
}

export function scenarioSeries(series: SeriesValue, options: ScenarioOptions): SeriesValue {
  const spread = clampNumber(options.spread, 0.2, 0, 0.8);
  const drift = clampNumber(options.drift, 0.02, -0.2, 0.2);
  const optimistic = series.values.map((value, index) => finite(value * (1 + spread + drift * index)));
  const pessimistic = series.values.map((value, index) => finite(value * (1 - spread - drift * index)));
  return makeSeries(series.title + ' · 情景', series.labels, series.values, [
    { name: '乐观', values: optimistic },
    { name: '悲观', values: pessimistic },
  ]);
}

export interface DiscountOptions {
  annualRate: number;
  initialInvestment: number;
}

export interface DiscountResult {
  series: SeriesValue;
  npv: number;
  paybackIndex: number | null;
}

export function discountSeries(series: SeriesValue, options: DiscountOptions): DiscountResult {
  const annualRate = clampNumber(options.annualRate, 0.08, -0.5, 1);
  const initial = clampNumber(options.initialInvestment, 0, -1e9, 1e9);
  const rate = annualRate / 12;
  let cumulative = -initial;
  let paybackIndex: number | null = initial <= 0 ? 0 : null;
  const values = series.values.map((value, index) => {
    const factor = rate > -1 ? 1 / (1 + rate) ** (index + 1) : 1;
    cumulative += finite(value * factor);
    if (paybackIndex === null && cumulative >= 0) paybackIndex = index;
    return finite(cumulative);
  });
  return {
    series: makeSeries('累计净现值', series.labels, values),
    npv: finite(cumulative),
    paybackIndex,
  };
}

export interface DecisionScheme {
  name: string;
  scores: [number, number, number, number];
}

export const DECISION_SCHEMES: readonly DecisionScheme[] = [
  { name: '稳健方案', scores: [72, 64, 86, 68] },
  { name: '增长方案', scores: [56, 70, 58, 92] },
  { name: '低成本方案', scores: [92, 82, 66, 55] },
  { name: '平衡方案', scores: [76, 74, 74, 78] },
];

export const DECISION_DIMENSIONS = ['成本效率', '交付周期', '风险控制', '预期收益'] as const;

export interface DecisionRow {
  name: string;
  score: number;
  parts: [number, number, number, number];
}

export interface DecisionResult {
  rows: DecisionRow[];
  series: SeriesValue;
  weights: [number, number, number, number];
}

export function weightedDecision(weights: [number, number, number, number]): DecisionResult {
  const safe = weights.map((value) => clampNumber(value, 0.25, 0, 1)) as [number, number, number, number];
  const sum = safe.reduce((total, value) => total + value, 0);
  const normalized = (sum > 0 ? safe.map((value) => value / sum) : [0.25, 0.25, 0.25, 0.25]) as [
    number,
    number,
    number,
    number,
  ];
  const rows = DECISION_SCHEMES.map((scheme) => {
    const score = finite(scheme.scores.reduce((total, value, index) => total + value * normalized[index]!, 0));
    return { name: scheme.name, score, parts: [...scheme.scores] as [number, number, number, number] };
  }).sort((a, b) => b.score - a.score);
  return {
    rows,
    weights: normalized,
    series: makeSeries('加权评分', rows.map((row) => row.name), rows.map((row) => row.score)),
  };
}

export interface WaterfallBar {
  label: string;
  start: number;
  end: number;
  delta: number;
  kind: 'total' | 'delta';
}

export interface WaterfallResult {
  bars: WaterfallBar[];
  total: number;
  peak: number;
  growth: number | null;
}

export function waterfallData(series: SeriesValue): WaterfallResult {
  const first = series.values[0] ?? 0;
  const last = series.values[series.values.length - 1] ?? first;
  const bars: WaterfallBar[] = [{ label: series.labels[0] ?? '起点', start: 0, end: first, delta: first, kind: 'total' }];
  let previous = first;
  for (let index = 1; index < series.values.length; index += 1) {
    const current = series.values[index] ?? previous;
    bars.push({
      label: series.labels[index] ?? `#${index + 1}`,
      start: previous,
      end: current,
      delta: finite(current - previous),
      kind: 'delta',
    });
    previous = current;
  }
  const peak = series.values.reduce((top, value) => Math.max(top, value), Number.NEGATIVE_INFINITY);
  return {
    bars,
    total: finite(last),
    peak: Number.isFinite(peak) ? peak : 0,
    growth: Math.abs(first) > 1e-9 ? finite((last - first) / Math.abs(first)) : null,
  };
}

export function formatBusinessValue(value: number, unit?: string): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const text = abs >= 1e6 ? value.toExponential(2) : abs >= 1000 ? value.toFixed(0) : Number(value.toPrecision(4)).toString();
  return unit ? `${text}${unit}` : text;
}
