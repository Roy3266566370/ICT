import type { PipelineControl } from './lab408PipelineTypes.ts';
import type { BusinessTemplateKind } from './businessPipelineTypes.ts';
import { CPM_TASKS, FUNNEL_LAYERS, type BusinessSettings } from './businessUnits.ts';

export const BUSINESS_CONTROLS: Record<BusinessTemplateKind, PipelineControl[]> = {
  'biz-breakeven': [
    { key: 'price', label: '客单价（元）', value: 99, min: 20, max: 500, step: 1 },
    { key: 'varRate', label: '变动成本率（%）', value: .35, min: .1, max: .8, step: .01 },
    { key: 'fixedCost', label: '月固定开销（元）', value: 200_000, min: 50_000, max: 1_000_000, step: 5000 },
    { key: 'monthlySales', label: '首月销量（单）', value: 2500, min: 500, max: 10_000, step: 100 },
    { key: 'growthRate', label: '月销量增长率（%）', value: .08, min: -.1, max: .3, step: .01 },
    { key: 'adBudget', label: '月营销预算（元）', value: 50_000, min: 0, max: 500_000, step: 5000 },
  ],
  'biz-funnel': [
    { key: 'impressions', label: '每周曝光（次）', value: 200_000, min: 10_000, max: 1_000_000, step: 10_000 },
    { key: 'ctr', label: '点击率（%）', value: .05, min: .01, max: .2, step: .01 },
    { key: 'regRate', label: '注册率（%）', value: .25, min: .05, max: .6, step: .01 },
    { key: 'payRate', label: '付费转化率（%）', value: .08, min: .01, max: .3, step: .01 },
    { key: 'retention', label: '周留存率（%）', value: .65, min: .2, max: .95, step: .01 },
    { key: 'arpu', label: '每周客单价 ARPU（元）', value: 120, min: 10, max: 500, step: 1 },
  ],
  'biz-cpm': [
    { key: 'delayT2', label: '前端延期（天）', value: 0, min: 0, max: 10, step: 1 },
    { key: 'delayT3', label: '后端延期（天）', value: 0, min: 0, max: 10, step: 1 },
    { key: 'delayT4', label: 'UI 延期（天）', value: 0, min: 0, max: 10, step: 1 },
    { key: 'devBoost', label: '并行投入系数', value: 1, min: .5, max: 1.5, step: .05 },
  ],
  'biz-abtest': [
    { key: 'baseRate', label: '对照组转化率（%）', value: .1, min: .01, max: .5, step: .01 },
    { key: 'lift', label: '相对提升（%）', value: .12, min: .01, max: .4, step: .01 },
    { key: 'dailyTraffic', label: '日均总流量', value: 4000, min: 500, max: 50_000, step: 100 },
    { key: 'alpha', label: '显著性水平 α', value: .05,
      options: [{ value: .01, label: '0.01' }, { value: .05, label: '0.05' }, { value: .1, label: '0.10' }] },
  ],
};

type Parameters = Record<string, number>;

interface BusinessExactRange {
  min: number;
  max: number;
  integer?: boolean;
}

const BUSINESS_EXACT_RANGES: Record<BusinessTemplateKind, Record<string, BusinessExactRange>> = {
  'biz-breakeven': {
    price: { min: .01, max: 1_000_000 },
    varRate: { min: 0, max: .9999 },
    fixedCost: { min: 0, max: 1_000_000_000 },
    monthlySales: { min: 0, max: 100_000_000, integer: true },
    growthRate: { min: -1, max: 1 },
    adBudget: { min: 0, max: 1_000_000_000 },
  },
  'biz-funnel': {
    impressions: { min: 0, max: 100_000_000, integer: true },
    ctr: { min: 0, max: 1 },
    regRate: { min: 0, max: 1 },
    payRate: { min: 0, max: 1 },
    retention: { min: 0, max: .9999 },
    arpu: { min: 0, max: 1_000_000 },
  },
  'biz-cpm': {
    delayT2: { min: 0, max: 365, integer: true },
    delayT3: { min: 0, max: 365, integer: true },
    delayT4: { min: 0, max: 365, integer: true },
    devBoost: { min: .5, max: 10 },
  },
  'biz-abtest': {
    // Even at both upper bounds, p1 = p0 × (1 + lift) must be below 1.
    baseRate: { min: .0001, max: .7 },
    lift: { min: .0001, max: .42 },
    dailyTraffic: { min: 1, max: 100_000_000, integer: true },
  },
};

export function businessExactRange(kind: BusinessTemplateKind, key: string): BusinessExactRange | undefined {
  const ranges = BUSINESS_EXACT_RANGES[kind];
  return Object.hasOwn(ranges, key) ? ranges[key] : undefined;
}

export function normalizeBusinessParameters(kind: BusinessTemplateKind, input: Parameters): Parameters {
  return Object.fromEntries(BUSINESS_CONTROLS[kind].map(({ key, value, options }) => {
    const proposed = input[key] ?? value;
    if (!Number.isFinite(proposed)) return [key, value];
    if (options) return [key, options.some((option) => option.value === proposed) ? proposed : value];
    const range = businessExactRange(kind, key);
    if (!range) return [key, value];
    const bounded = Math.max(range.min, Math.min(range.max, proposed));
    return [key, range.integer ? Math.round(bounded) : bounded];
  }));
}

export function calculateBreakeven(input: Parameters = {}) {
  const parameters = normalizeBusinessParameters('biz-breakeven', input);
  const { price = 99, varRate = .35, fixedCost = 200_000, monthlySales = 2500, growthRate = .08, adBudget = 50_000 } = parameters;
  const fixed = fixedCost + adBudget;
  const contribution = price - price * varRate;
  const theoreticalSales = fixed / contribution;
  const nearestUnit = Math.round(theoreticalSales);
  const breakEvenSales = Math.abs(theoreticalSales - nearestUnit) <= theoreticalSales * Number.EPSILON * 4
    ? nearestUnit : theoreticalSales;
  let cumulativeProfit = 0;
  const months = Array.from({ length: 24 }, (_, i) => {
    const sales = monthlySales * (1 + growthRate) ** i;
    const revenue = price * sales;
    const variableCost = revenue * varRate;
    const grossProfit = revenue - variableCost;
    const totalCost = fixed + variableCost;
    const profit = grossProfit - fixed;
    cumulativeProfit += profit;
    return {
      month: i + 1, sales, revenue, variableCost, grossProfit, totalCost, profit, cumulativeProfit,
      roi: totalCost > 0 ? profit / totalCost : null,
      sensitivity: [
        sales * price * .1 * (1 - varRate), -sales * price * .1 * (1 - varRate),
        -revenue * varRate * .1, revenue * varRate * .1,
      ],
    };
  });
  return { parameters, price, varRate, fixed, breakEvenSales, months,
    paybackMonth: months.find(({ cumulativeProfit }) => cumulativeProfit >= 0)?.month };
}

function runCohorts(newPaid: number, retention: number, arpu: number) {
  let cohort = newPaid;
  let active = 0;
  let revenue = 0;
  return Array.from({ length: 12 }, (_, i) => {
    active = newPaid + active * retention;
    revenue += active * arpu;
    const week = { week: i + 1, cohort, active, revenue };
    cohort *= retention;
    return week;
  });
}

export function calculateFunnel(input: Parameters = {}, settings?: Pick<BusinessSettings, 'labels'>) {
  const parameters = normalizeBusinessParameters('biz-funnel', input);
  const { impressions = 200_000, ctr = .05, regRate = .25, payRate = .08, retention = .65, arpu = 120 } = parameters;
  const clicked = impressions * ctr;
  const registered = clicked * regRate;
  const paid = registered * payRate;
  const funnel = [impressions, clicked, registered, paid, paid * retention];
  const base = runCohorts(paid, retention, arpu);
  const improved = runCohorts(paid, Math.min(1, retention + .05), arpu);
  const increasedReach = runCohorts(paid * 1.2, retention, arpu);
  const increasedConversion = runCohorts(registered * Math.min(1, payRate + .01), retention, arpu);
  const weeks = base.map((week, i) => ({
    ...week,
    improvedCohort: improved[i]!.cohort,
    improvedActive: improved[i]!.active,
    increments: [increasedReach[i]!.revenue, increasedConversion[i]!.revenue, improved[i]!.revenue]
      .map((revenue) => revenue - week.revenue),
  }));
  const names = FUNNEL_LAYERS.map(({ id, name }) => settings?.labels[id] ?? name);
  return { parameters, funnel, names, weeks, ltv: arpu / (1 - retention), conversion: ctr * regRate * payRate };
}

export const CPM_CAPACITY = 2;

interface ScheduledTask {
  id: string;
  name: string;
  duration: number;
  after: string[];
  es: number;
  ef: number;
  ls: number;
  lf: number;
  slack: number;
}

export function calculateCpm(input: Parameters = {}, settings?: Pick<BusinessSettings, 'labels' | 'durations'>) {
  const parameters = normalizeBusinessParameters('biz-cpm', input);
  const boost = parameters.devBoost ?? 1;
  const byId = new Map<string, ScheduledTask>();
  const baseline = new Map<string, number>();
  const tasks = CPM_TASKS.map(({ id, name, duration: defaultDuration, after, delay, scalable }) => {
    const base = settings?.durations[id] ?? defaultDuration;
    baseline.set(id, Math.max(0, ...after.map((predecessor) => baseline.get(predecessor)!)) + base);
    const duration = (scalable ? Math.ceil(base / boost) : base) + (delay ? parameters[delay] ?? 0 : 0);
    const es = Math.max(0, ...after.map((predecessor) => byId.get(predecessor)!.ef));
    const task = { id, name: settings?.labels[id] ?? name, duration, after, es, ef: es + duration, ls: 0, lf: 0, slack: 0 };
    byId.set(id, task);
    return task;
  });
  const totalDays = Math.max(...tasks.map(({ ef }) => ef));
  for (const task of [...tasks].reverse()) {
    task.lf = Math.min(totalDays, ...tasks.filter(({ after }) => after.includes(task.id)).map(({ ls }) => ls));
    task.ls = task.lf - task.duration;
    task.slack = task.ls - task.es;
  }
  const critical = tasks.filter(({ slack }) => slack === 0);
  function trace(task: ScheduledTask): string[][] {
    const successors = critical.filter((candidate) => candidate.after.includes(task.id) && candidate.es === task.ef);
    return successors.length
      ? successors.flatMap((successor) => trace(successor).map((path) => [task.id, ...path]))
      : [[task.id]];
  }
  const paths = critical.filter(({ es }) => es === 0).flatMap(trace);
  const load = Array.from({ length: totalDays + 1 }, (_, day) =>
    tasks.filter(({ es, ef }) => es <= day && day < ef).length);
  return { parameters, tasks, totalDays, paths, load, delay: totalDays - Math.max(...baseline.values()) };
}

const NORMAL_95 = 1.959963984540054;
const NORMAL_80 = .8416212335729143;
const CRITICAL_Z: Record<number, number> = { .01: 2.5758293035489004, .05: NORMAL_95, .10: 1.6448536269514722 };

export function normalDensity(value: number): number {
  return Math.exp(-.5 * value ** 2) / Math.sqrt(2 * Math.PI);
}

function normalUpperTail(value: number): number {
  // Evaluate the complementary error function directly to preserve small p-values.
  const x = Math.abs(value) / Math.SQRT2;
  const t = 1 / (1 + .3275911 * x);
  const erfRemainder = (((((1.061405429 * t - 1.453152027) * t + 1.421413741)
    * t - .284496736) * t + .254829592) * t) * Math.exp(-x * x);
  return value < 0 ? 1 - .5 * erfRemainder : .5 * erfRemainder;
}

export function calculateAbTest(input: Parameters = {}) {
  const parameters = normalizeBusinessParameters('biz-abtest', input);
  const { baseRate = .1, lift = .12, dailyTraffic = 4000, alpha = .05 } = parameters;
  const experimentalRate = baseRate * (1 + lift);
  const difference = experimentalRate - baseRate;
  const pooled = (baseRate + experimentalRate) / 2;
  const controlVariance = baseRate * (1 - baseRate);
  const experimentalVariance = experimentalRate * (1 - experimentalRate);
  const nullScale = Math.sqrt(2 * pooled * (1 - pooled));
  const alternativeScale = Math.sqrt(controlVariance + experimentalVariance);
  const criticalZ = CRITICAL_Z[alpha] ?? NORMAL_95;
  const requiredSamples = Math.ceil(((criticalZ * nullScale + NORMAL_80 * alternativeScale) / difference) ** 2);
  const daysRequired = Math.ceil(requiredSamples * 2 / dailyTraffic);
  const days = Array.from({ length: 30 }, (_, i) => {
    const day = i + 1;
    const samples = dailyTraffic * day / 2;
    const rootN = Math.sqrt(samples);
    const criticalDifference = criticalZ * nullScale / rootN;
    const margin95 = NORMAL_95 * alternativeScale / rootN;
    const confidenceInterval: [number, number] = [difference - margin95, difference + margin95];
    const pValue = 2 * normalUpperTail(difference * rootN / nullScale);
    const power = normalUpperTail((criticalDifference - difference) * rootN / alternativeScale)
      + normalUpperTail((criticalDifference + difference) * rootN / alternativeScale);
    const adequateCounts = samples * Math.min(baseRate, 1 - experimentalRate) >= 5;
    const significant = pValue < alpha;
    const remaining = Math.max(0, daysRequired - day);
    return { day, samples, criticalDifference, confidenceInterval, pValue, power, adequateCounts, significant, remaining,
      controlSE: Math.sqrt(controlVariance) / rootN, experimentalSE: Math.sqrt(experimentalVariance) / rootN };
  });
  return { parameters, baseRate, experimentalRate, difference, alpha, requiredSamples, daysRequired, days };
}
