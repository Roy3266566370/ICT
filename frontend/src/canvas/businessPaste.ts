import { BUSINESS_CONTROLS, businessExactRange } from './businessModels.ts';
import type { BusinessTemplateKind } from './businessPipelineTypes.ts';
import { businessControlLabel, businessLabelFields, cleanBusinessLabel, CPM_MAX_DURATION, CPM_TASKS, type BusinessSettings } from './businessUnits.ts';

export const BUSINESS_PASTE_MAX_LENGTH = 8_000;

type ChangeSet = Pick<BusinessSettings, 'labels' | 'durations'> & { params: Record<string, number> };

function error(row: number, message: string): never {
  throw new Error('第 ' + row + ' 行：' + message);
}

function tableRows(input: string): { cells: string[]; row: number }[] {
  const source = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!source) throw new Error('请先粘贴两列数据。');
  if (source.length > BUSINESS_PASTE_MAX_LENGTH) throw new Error('一次最多可粘贴 8000 个字符。');
  // Detect Excel TSV from the first separator outside a quoted cell.
  let quoted = false;
  let separator = ',';
  for (const char of source) {
    if (char === '"') quoted = !quoted;
    if (!quoted && (char === '\t' || char === ',')) { separator = char; break; }
  }

  const rows: { cells: string[]; row: number }[] = [];
  let row = 1;
  let cells: string[] = [];
  let field = '';
  let state: 'plain' | 'quoted' | 'finished' = 'plain';
  for (let i = 0; i <= source.length; i++) {
    const char = source[i] ?? '\n';
    if (state === 'quoted') {
      if (i === source.length) error(row, '引号未闭合。');
      if (char !== '"') field += char;
      else if (source[i + 1] === '"') { field += '"'; i++; }
      else state = 'finished';
    } else if (char === separator || char === '\n') {
      cells.push(field.trim());
      field = '';
      state = 'plain';
      if (char === '\n') {
        if (cells.some(Boolean)) rows.push({ cells, row });
        cells = [];
        row++;
      }
    } else if (char === '"' && !field.trim() && state === 'plain') {
      state = 'quoted';
      field = '';
    } else {
      if (char === '"' || state === 'finished' && char.trim()) error(row, '引号格式不正确。');
      field += char;
    }
  }
  return rows;
}

function comparison(value: string): string {
  return value.trim().toLowerCase().replace(/[（(][^（）()]*[）)]$/, '').trim();
}

function parseNumber(value: string): { value: number; percent: boolean } | undefined {
  const percent = /[%％]$/.test(value);
  let digits = value.replace(/[%％]$/, '').trim();
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(digits)) digits = digits.replaceAll(',', '');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(digits)) return undefined;
  const number = Number(digits);
  return { value: number, percent };
}

function assign<T>(map: Record<string, T>, key: string, value: T, row: number) {
  if (Object.hasOwn(map, key)) error(row, '重复设置了「' + key + '」。');
  map[key] = value;
}

export function parseBusinessPaste(
  kind: BusinessTemplateKind,
  input: string,
  settings: BusinessSettings,
  visibleParamKeys?: readonly string[],
): ChangeSet {
  const params: ChangeSet['params'] = {};
  const labels: ChangeSet['labels'] = {};
  const durations: ChangeSet['durations'] = {};
  const controls = BUSINESS_CONTROLS[kind];
  const labelFields = businessLabelFields(kind);
  const visible = visibleParamKeys && new Set(visibleParamKeys);
  for (const [index, { cells, row }] of tableRows(input).entries()) {
    if (cells.length !== 2 || !cells[0] || !cells[1]) error(row, '需要两列，且两列都要有内容。');
    const [name, raw] = cells as [string, string];
    if (index === 0 && /^(?:名称|参数名?|任务名称|项目|name|key)$/i.test(name)
      && /^(?:数值|值|工期|名称|value|duration)$/i.test(raw)) continue;
    const key = comparison(name);
    const number = parseNumber(raw);
    const control = controls.find(({ key: id, label }) => key === id.toLowerCase()
      || key === comparison(label) || key === comparison(businessControlLabel(kind, id, label, settings.units)));
    if (control && (number || !labelFields.some(({ id }) => id === control.key))) {
      if (visible && !visible.has(control.key)) error(row, '「' + name + '」不可编辑。');
      const range = businessExactRange(kind, control.key);
      const ratio = control.label.endsWith('（%）');
      if (!number || number.percent && !ratio && !control.options) error(row, '「' + name + '」的数值格式无效。');
      const value = number.value / (ratio || number.percent ? 100 : 1);
      const valid = control.options
        ? control.options.some((option) => option.value === value)
        : range && Number.isFinite(value) && value >= range.min && value <= range.max
          && (!range.integer || Number.isInteger(value));
      if (!valid) error(row, '「' + name + '」超出允许范围。');
      assign(params, control.key, value, row);
      continue;
    }
    const named = labelFields.filter(({ id, name: defaultName }) => key === comparison(defaultName)
      || key === comparison(settings.labels[id] ?? ''));
    const idMatch = labelFields.find(({ id }) => key === id.toLowerCase());
    if (!idMatch && named.length > 1) error(row, '名称重复，请使用对应的固定键。');
    const field = idMatch ?? named[0];
    if (kind === 'biz-cpm' && number) {
      if (number.percent || !Number.isInteger(number.value) || number.value < 1 || number.value > CPM_MAX_DURATION) {
        error(row, '工期须为 1 至 ' + CPM_MAX_DURATION + ' 的整数。');
      }
      const task = field ?? CPM_TASKS.find(({ id }) => !Object.hasOwn(durations, id) && !Object.hasOwn(labels, id));
      if (!task) error(row, '六个任务已填满。');
      if (!field) assign(labels, task.id, cleanBusinessLabel(name), row);
      assign(durations, task.id, number.value, row);
    } else if (field) {
      if (number) error(row, '业务名称需要填写文本。');
      assign(labels, field.id, cleanBusinessLabel(raw), row);
    } else {
      error(row, '找不到对应的参数或业务名称「' + name + '」。');
    }
  }
  if (!Object.keys(params).length && !Object.keys(labels).length && !Object.keys(durations).length) {
    throw new Error('未找到可应用的数据。');
  }
  return { params, labels, durations };
}
