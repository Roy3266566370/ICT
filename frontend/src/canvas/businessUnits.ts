import type { BusinessTemplateKind } from './businessPipelineTypes.ts';

export const BUSINESS_UNIT_MAX_LENGTH = 8;
export const BUSINESS_LABEL_MAX_LENGTH = 16;
export const CPM_MAX_DURATION = 365;

export const CPM_TASKS = [
  { id: 'T1', name: '需求评审', duration: 3, after: [] },
  { id: 'T2', name: '前端开发', duration: 6, after: ['T1'], delay: 'delayT2', scalable: true },
  { id: 'T3', name: '后端接口', duration: 7, after: ['T1'], delay: 'delayT3', scalable: true },
  { id: 'T4', name: 'UI 设计', duration: 4, after: ['T1'], delay: 'delayT4' },
  { id: 'T5', name: '联调测试', duration: 4, after: ['T2', 'T3', 'T4'] },
  { id: 'T6', name: '灰度上线', duration: 2, after: ['T5'] },
];

export const FUNNEL_LAYERS = [
  { id: 'impressions', name: '曝光' },
  { id: 'clicks', name: '点击' },
  { id: 'registrations', name: '注册' },
  { id: 'paid', name: '付费' },
  { id: 'repeat', name: '次周复购' },
];

export interface BusinessSettings {
  units: Record<string, string>;
  labels: Record<string, string>;
  durations: Record<string, number>;
}

export function businessLabelFields(kind: string): readonly { id: string; name: string }[] {
  if (kind === 'biz-cpm') return CPM_TASKS;
  return kind === 'biz-funnel' ? FUNNEL_LAYERS : [];
}

export function cleanBusinessLabel(value: string): string {
  return [...value.trim().replace(/\s+/g, ' ')].slice(0, BUSINESS_LABEL_MAX_LENGTH).join('').trim();
}

interface BusinessUnitField {
  key: string;
  label: string;
  defaultUnit: string;
}

const currency = { key: 'currency', label: '金额单位', defaultUnit: '元' };
const time = { key: 'time', label: '时长单位', defaultUnit: '天' };

const unitFields: Record<BusinessTemplateKind, readonly BusinessUnitField[]> = {
  'biz-breakeven': [currency, { key: 'orders', label: '销量单位', defaultUnit: '单' }],
  'biz-funnel': [
    currency, { key: 'impressions', label: '曝光与点击单位', defaultUnit: '次' },
    { key: 'people', label: '用户数量单位', defaultUnit: '人' },
  ],
  'biz-cpm': [time],
  'biz-abtest': [{ key: 'samples', label: '样本数量单位', defaultUnit: '人' }, time],
};

export function businessUnitFields(kind: string): readonly BusinessUnitField[] {
  return Object.hasOwn(unitFields, kind) ? unitFields[kind as BusinessTemplateKind] : [];
}

function normalizedUnits(kind: string, data: unknown): Record<string, string> {
  const values = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
  return Object.fromEntries(businessUnitFields(kind).map(({ key, defaultUnit }) => {
    const value = values[key];
    const unit = typeof value === 'string'
      ? [...value.trim().replace(/\s+/g, ' ')].slice(0, BUSINESS_UNIT_MAX_LENGTH).join('').trim() : '';
    return [key, unit || defaultUnit];
  }));
}

function readSettingsData(text: string | undefined): Record<string, unknown> {
  try {
    return objectData(text ? JSON.parse(text) : undefined);
  } catch {
    return {};
  }
}

function objectData(data: unknown): Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? data as Record<string, unknown> : {};
}

export function readBusinessSettings(kind: string, text: string | undefined): BusinessSettings {
  const data = readSettingsData(text);
  const labels = objectData(data.labels);
  const durations = objectData(data.durations);
  return {
    units: normalizedUnits(kind, data),
    labels: Object.fromEntries(businessLabelFields(kind).map(({ id, name }) => {
      const value = labels[id];
      return [id, typeof value === 'string' && cleanBusinessLabel(value) || name];
    })),
    durations: kind === 'biz-cpm' ? Object.fromEntries(CPM_TASKS.map(({ id, duration }) => {
      const value = durations[id];
      return [id, typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= CPM_MAX_DURATION ? value : duration];
    })) : {},
  };
}

export function writeBusinessSettings(kind: string, settings: BusinessSettings): string {
  const shape = { ...settings.units, labels: settings.labels, durations: settings.durations };
  const { units, labels, durations } = readBusinessSettings(kind, JSON.stringify(shape));
  return JSON.stringify({
    ...units,
    ...(Object.keys(labels).length ? { labels } : {}),
    ...(Object.keys(durations).length ? { durations } : {}),
  });
}

export function readBusinessUnits(kind: string, text: string | undefined): Record<string, string> {
  return normalizedUnits(kind, readSettingsData(text));
}

export function writeBusinessUnits(kind: string, units: Record<string, string>, sourceText?: string): string {
  return writeBusinessSettings(kind, { ...readBusinessSettings(kind, sourceText), units });
}

const controlUnits: Record<BusinessTemplateKind, Readonly<Record<string, string>>> = {
  'biz-breakeven': { price: 'currency', fixedCost: 'currency', adBudget: 'currency', monthlySales: 'orders' },
  'biz-funnel': { impressions: 'impressions', arpu: 'currency' },
  'biz-cpm': { delayT2: 'time', delayT3: 'time', delayT4: 'time' },
  'biz-abtest': {},
};

export function businessControlLabel(kind: string, key: string, label: string, units: Record<string, string>): string {
  if (kind === 'biz-abtest' && key === 'dailyTraffic') {
    return label + '（' + (units.samples ?? '人') + '/' + (units.time ?? '天') + '）';
  }
  const unitKey = Object.hasOwn(controlUnits, kind) ? controlUnits[kind as BusinessTemplateKind][key] : undefined;
  const unit = unitKey && units[unitKey];
  return unit ? label.replace(/（[^（）]+）$/, '') + '（' + unit + '）' : label;
}
