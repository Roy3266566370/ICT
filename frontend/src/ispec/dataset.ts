/**
 * dataset.ts —— 图表/表格视图的数据通道解析（iSpec v1.0 + 数据通道补丁）。
 *
 * 权威结构（`ispec/types.ts`，由契约方维护，本文件只 import）：
 * ```ts
 * interface SpecDataset {
 *   id: string;
 *   columns: string[];
 *   rows: Array<Array<number | string | boolean | null>>;
 * }
 * // ISpec.datasets?: SpecDataset[]
 * // VegaView.dataset?: string   // 引用 datasets[].id
 * // TableView.dataset?: string
 * ```
 *
 * 解析顺序（每一档都写明来源，绝不编造数据）：
 *  1. `dataset`：view 声明了 `dataset` → 在 `spec.datasets` 里按 id 找，
 *     把「按 columns 顺序排列的单元格数组」转成「键为列名的行对象」；
 *     找不到时返回 `missing: true` 与「该图表缺少数据（dataset 未提供）」，
 *     视图据此显示明确提示而不是静默空白；
 *  2. 未声明 dataset 时，兼容纯参数驱动的图表：
 *     `option_sweep`（x 是带 options 的枚举参数，逐选项代入求 y）→ `scalar`（x/y 都是标量）。
 */
import { evaluateSpec } from './evaluate';
import type { SpecCell } from './format';
import type { ISpec, SpecDataset, SpecEvaluation, VegaView } from './types';

/** 一行图表数据：字段名 → 标量值。 */
export interface SpecDataRow {
  [field: string]: SpecCell;
}

export type DatasetOrigin = 'dataset' | 'option_sweep' | 'scalar' | 'none';

export interface ResolvedDataset {
  id: string | null;
  columns: string[];
  rows: SpecDataRow[];
  /** true = view 引用了 dataset，但 `spec.datasets` 里找不到 */
  missing: boolean;
  note: string | null;
}

export interface ChartDataset {
  rows: SpecDataRow[];
  origin: DatasetOrigin;
  xField: string;
  yField: string;
  datasetId: string | null;
  /** true = 没有可用数据（未提供 dataset / 无法由参数求值） */
  missing: boolean;
  /** 面向用户的中文说明；完整时为 null */
  note: string | null;
}

/** 单元格 → 行对象：null / undefined 视为「该字段缺失」，不伪造 0。 */
export function datasetRowObjects(dataset: SpecDataset): SpecDataRow[] {
  const rows: SpecDataRow[] = [];
  for (const cells of dataset.rows) {
    const row: SpecDataRow = {};
    dataset.columns.forEach((column, index) => {
      const value = cells[index];
      if (typeof value === 'number') {
        if (Number.isFinite(value)) row[column] = value;
        return;
      }
      if (typeof value === 'boolean' || typeof value === 'string') {
        row[column] = value;
      }
    });
    rows.push(row);
  }
  return rows;
}

/**
 * 按 view 的 `dataset` 引用取数据集。
 * `subject` 只用于把提示写成「该图表…」或「该表格…」。
 */
export function resolveSpecDataset(
  spec: ISpec,
  datasetId: string | undefined,
  subject: '图表' | '表格' = '图表',
): ResolvedDataset {
  if (datasetId === undefined) {
    return { id: null, columns: [], rows: [], missing: false, note: null };
  }
  const dataset = (spec.datasets ?? []).find((item) => item.id === datasetId);
  if (dataset === undefined) {
    return {
      id: datasetId,
      columns: [],
      rows: [],
      missing: true,
      note: `该${subject}缺少数据（dataset 未提供：${datasetId}）`,
    };
  }
  return {
    id: datasetId,
    columns: [...dataset.columns],
    rows: datasetRowObjects(dataset),
    missing: false,
    note: null,
  };
}

/** Apply declared dimension choices consistently to both charts and tables. */
export function filterSpecRows(spec: ISpec, evaluation: SpecEvaluation, rows: SpecDataRow[]): SpecDataRow[] {
  if (spec.kind !== 'filter') return rows;
  return rows.filter(row => spec.parameters.every(parameter => {
    if (parameter.type !== 'enum' || !(parameter.id in row)) return true;
    const selected = evaluation.values[parameter.id] ?? parameter.default;
    return selected === '全部' || selected === 'all' || selected === '*' || row[parameter.id] === selected;
  }));
}

export function visibleSpecColumns(spec: ISpec, evaluation: SpecEvaluation, columns: string[]): string[] {
  const selected = evaluation.values['filter_column'];
  return spec.kind === 'filter' && typeof selected === 'string' && columns.includes(selected) ? [selected] : columns;
}

/** 把 iSpec + 当前求值结果解析成图表数据集。 */
export function resolveChartDataset(
  spec: ISpec,
  evaluation: SpecEvaluation,
  view: VegaView,
): ChartDataset {
  const xField = view.x ?? 'x';
  const yField = view.y ?? 'y';

  // 1) 新数据通道：view.dataset → spec.datasets
  if (view.dataset !== undefined) {
    const resolved = resolveSpecDataset(spec, view.dataset, '图表');
    if (resolved.missing) {
      return {
        rows: [],
        origin: 'dataset',
        xField,
        yField,
        datasetId: resolved.id,
        missing: true,
        note: resolved.note,
      };
    }
    const filteredRows = filterSpecRows(spec, evaluation, resolved.rows);
    const numericRows = filteredRows.filter((row) => typeof row[yField] === 'number').length;
    if (resolved.rows.length === 0) {
      return {
        rows: [],
        origin: 'dataset',
        xField,
        yField,
        datasetId: resolved.id,
        missing: true,
        note: `dataset ${view.dataset} 为空：该图表缺少数据`,
      };
    }
    return {
      rows: filteredRows,
      origin: 'dataset',
      xField,
      yField,
      datasetId: resolved.id,
      missing: numericRows === 0,
      note:
        numericRows === 0
          ? `dataset ${view.dataset} 中没有字段 ${yField} 的数值行：该图表缺少数据`
          : null,
    };
  }

  // 2) 兼容：x 是带 options 的枚举参数 → 逐选项代入并求 y
  const xParameter = spec.parameters.find((parameter) => parameter.id === xField);
  const sweepable =
    xParameter !== undefined &&
    (xParameter.type === 'enum' || (xParameter.options?.length ?? 0) > 0);

  if (xParameter !== undefined && sweepable) {
    const options = xParameter.options ?? [];
    const rows: SpecDataRow[] = [];
    for (const option of options) {
      const optionEvaluation = evaluateSpec(spec, { ...evaluation.values, [xField]: option });
      const yValue = optionEvaluation.derived[yField] ?? optionEvaluation.values[yField];
      const row: SpecDataRow = { [xField]: option };
      if (typeof yValue === 'number') row[yField] = yValue;
      rows.push(row);
    }
    const numericRows = rows.filter((row) => typeof row[yField] === 'number').length;
    return {
      rows,
      origin: 'option_sweep',
      xField,
      yField,
      datasetId: null,
      missing: numericRows === 0,
      note: numericRows === 0 ? '该图表缺少数据（dataset 未提供）' : null,
    };
  }

  // 3) 兼容：x/y 都是可直接取到的标量（单点图）
  const scope: Record<string, SpecCell> = { ...evaluation.values, ...evaluation.derived };
  const xValue = scope[xField];
  const yValue = scope[yField];
  if (xValue !== undefined && typeof yValue === 'number') {
    return {
      rows: [{ [xField]: xValue, [yField]: yValue }],
      origin: 'scalar',
      xField,
      yField,
      datasetId: null,
      missing: false,
      note: null,
    };
  }

  return {
    rows: [],
    origin: 'none',
    xField,
    yField,
    datasetId: null,
    missing: true,
    note: '该图表缺少数据（dataset 未提供）',
  };
}
