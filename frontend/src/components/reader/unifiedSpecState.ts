/**
 * `unifiedSpecState.ts` —— 单一参数值源的纯函数层（P0-02）。
 *
 * 背景：旧实现里「图」读 `regions.original_params + 用户改动`，「当前参数表 / 校验 / 保存」
 * 读另一份 `knowledge_object.parameters`，于是调参后图变了而表格与保存值仍是旧值。
 *
 * 这里把"合并"做成可单测的纯函数：区域基线 + 用户改动 → 唯一的参数表；
 * 再用同一份参数投影到知识对象（供保存 / 校验 / 表格读取）。
 *
 * 约束：本文件只允许 `import type`（无运行时依赖），以便 `node --test` 直接跑 TS 单测。
 */
import type { KnowledgeObject, ParameterType } from '@/api/types';
import type { ISpec } from '@/ispec/types';
import type { PageRegion } from '@/regions/types';

/** iSpec 参数值（与 `frontend/src/ispec/types.ts` 的 `SpecEvaluation.values` 对齐）。 */
export type SpecValue = number | boolean | string;
export type SpecValues = Record<string, SpecValue>;

/** 按区域隔离的用户改动：`{ [region_id]: { [param_key]: value } }`。 */
export type RegionOverrides = Record<string, Record<string, unknown>>;

export type UnifiedParamSource = 'spec' | 'region' | 'object';

export interface UnifiedParameterRow {
  id: string;
  label: string;
  valueText: string;
  unit: string;
  source: UnifiedParamSource;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 统一的数值/数组格式化：表格与图读到同一个值时，展示文本也一致。 */
export function formatUnifiedValue(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—';
    const rounded = Math.round(value * 1e6) / 1e6;
    return String(rounded);
  }
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return value.length === 0 ? '—' : value;
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value);
  } catch {
    return '—';
  }
}

/** 深比较（数字按 1e-9 容差），用于判断"是否真的改了"，避免无意义的重渲染。 */
export function sameUnifiedValue(left: unknown, right: unknown): boolean {
  if (isFiniteNumber(left) && isFiniteNumber(right)) {
    return Math.abs(left - right) < 1e-9;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((item, index) => sameUnifiedValue(item, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => sameUnifiedValue(left[key], right[key]));
  }
  return left === right;
}

/**
 * 区域基线 + 用户改动 = 唯一参数值源。
 *
 * - 不修改传入的 `regions`（`original_params` 必须保持原稿语义）；
 * - 每个区域独立合并，用户改一个区域不会污染另一个区域；
 * - 没有用户改动的区域直接复用原对象，便于上层用引用相等判断"未改动"。
 */
export function mergeAllRegionParams(
  regions: PageRegion[],
  overrides: RegionOverrides,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const region of regions) {
    const override = overrides[region.region_id];
    result[region.region_id] =
      override === undefined ? { ...region.original_params } : { ...region.original_params, ...override };
  }
  return result;
}

/** 只保留当前区域自己的改动：清理 sessionStorage 里残留的其他材料/区域键。 */
export function sanitizeRegionOverrides(raw: unknown): RegionOverrides {
  if (!isRecord(raw)) return {};
  const result: RegionOverrides = {};
  for (const [regionId, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    result[regionId] = { ...value };
  }
  return result;
}

/** 清理 iSpec 参数值：只接受数字/布尔/字符串（其余键丢弃）。 */
export function sanitizeSpecValues(raw: unknown): SpecValues {
  if (!isRecord(raw)) return {};
  const result: SpecValues = {};
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value === 'number' && Number.isFinite(value)) result[id] = value;
    else if (typeof value === 'boolean' || typeof value === 'string') result[id] = value;
  }
  return result;
}

function isPair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1]);
}

function isMatrix2(value: unknown): value is [[number, number], [number, number]] {
  return Array.isArray(value) && value.length === 2 && value.every((row) => isPair(row));
}

/**
 * 把区域参数键值收窄成知识对象参数类型；类型不匹配时返回 `undefined`（宁可保持旧值，
 * 也不把字符串硬塞进 matrix2）。
 */
export function coerceParameterValue(type: ParameterType, raw: unknown): unknown | undefined {
  switch (type) {
    case 'decimal':
    case 'integer': {
      const parsed =
        typeof raw === 'number'
          ? raw
          : typeof raw === 'string' && raw.trim().length > 0
            ? Number(raw)
            : Number.NaN;
      if (!Number.isFinite(parsed)) return undefined;
      return type === 'integer' ? Math.round(parsed) : parsed;
    }
    case 'vector2':
      return isPair(raw) ? [raw[0], raw[1]] : undefined;
    case 'matrix2':
      return isMatrix2(raw)
        ? [
            [raw[0][0], raw[0][1]],
            [raw[1][0], raw[1][1]],
          ]
        : undefined;
    case 'text':
    case 'enum':
      return typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : undefined;
    case 'force_list':
    case 'graph':
      return isRecord(raw) || Array.isArray(raw) ? raw : undefined;
    default:
      return undefined;
  }
}

/**
 * 把区域参数投影到知识对象：键名（参数 id）一致且类型兼容才覆盖。
 *
 * 另外处理「区域用 a11..a22、知识对象用 matrix_A」的命名差异（P0-02 的实际根因）：
 * `matrix2` 类型的对象参数在没有同名键时，由 `a11/a12/a21/a22` 合成。
 */
export function applyRegionParamsToObject(
  object: KnowledgeObject | null,
  region: PageRegion | null,
  params: Record<string, unknown>,
): KnowledgeObject | null {
  if (region === null) return object;
  return projectParamsToObject(object, params);
}

/**
 * 把 iSpec 参数值投影到知识对象。
 *
 * iSpec 是"这一页的运行时"，它的参数值与 ISpecView / 表格 / 约束校验同源；
 * 保存运行与独立校验必须读投影后的对象，否则又会出现"图变了、保存值没变"。
 */
export function applySpecValuesToObject(
  object: KnowledgeObject | null,
  spec: ISpec | null,
  values: SpecValues,
): KnowledgeObject | null {
  if (spec === null) return object;
  return projectParamsToObject(object, values);
}

function projectParamsToObject(
  object: KnowledgeObject | null,
  params: Record<string, unknown>,
): KnowledgeObject | null {
  if (object === null) return object;
  let changed = false;
  const parameters = object.parameters.map((parameter) => {
    const sameId = Object.prototype.hasOwnProperty.call(params, parameter.id);
    const next = sameId
      ? coerceParameterValue(parameter.type, params[parameter.id])
      : parameter.type === 'matrix2'
        ? matrixWithOverrides(parameter.value, params)
        : undefined;
    if (next === undefined || sameUnifiedValue(next, parameter.value)) return parameter;
    changed = true;
    return { ...parameter, value: next };
  });
  if (!changed) return object;
  return { ...object, parameters };
}

/** 从平铺的 a11/a12/a21/a22 合成 2×2 矩阵；缺字段或非数字返回 undefined。 */
export function matrixFromFlatParams(params: Record<string, unknown>): [[number, number], [number, number]] | undefined {
  const { a11, a12, a21, a22 } = params;
  if (!isFiniteNumber(a11) || !isFiniteNumber(a12) || !isFiniteNumber(a21) || !isFiniteNumber(a22)) {
    return undefined;
  }
  return [
    [a11, a12],
    [a21, a22],
  ];
}

/**
 * 用平铺参数覆盖已有矩阵：iSpec 可能只改 a11 这一项，其余三项沿用对象原值。
 * 这样"改一个参数"不会因为另外三项缺失而整块矩阵失效。
 */
function matrixWithOverrides(
  base: unknown,
  params: Record<string, unknown>,
): [[number, number], [number, number]] | undefined {
  if (!isMatrix2(base)) return matrixFromFlatParams(params);
  const flat: Record<string, number> = {
    a11: base[0][0],
    a12: base[0][1],
    a21: base[1][0],
    a22: base[1][1],
  };
  let touched = false;
  for (const key of ['a11', 'a12', 'a21', 'a22'] as const) {
    const value = params[key];
    if (isFiniteNumber(value)) {
      flat[key] = value;
      touched = true;
    }
  }
  if (!touched) return undefined;
  return [
    [flat.a11 ?? 0, flat.a12 ?? 0],
    [flat.a21 ?? 0, flat.a22 ?? 0],
  ];
}

export interface BuildUnifiedRowsInput {
  spec: ISpec | null;
  specValues: SpecValues;
  /** 已完成区域参数投影的知识对象；表格与保存读取同一份。 */
  object: KnowledgeObject | null;
  activeRegion: PageRegion | null;
  activeParams: Record<string, unknown>;
}

/**
 * "当前参数"表的唯一构造入口。优先级与渲染优先级一致：
 * 1. 有 iSpec → 表格读 `spec.parameters + specValues`（ISpecView 也读这份）；
 * 2. 有区域 → 表格直接列出区域参数键（与图读的是同一份 `activeParams`），
 *    `matrix_A` 之类的派生对象参数只在保存/校验时由 `applyRegionParamsToObject` 合成；
 * 3. 只有知识对象 → 列出对象参数。
 */
export function buildUnifiedRows(input: BuildUnifiedRowsInput): UnifiedParameterRow[] {
  const { spec, specValues, object, activeRegion, activeParams } = input;
  if (spec !== null) {
    return spec.parameters.map((parameter) => ({
      id: parameter.id,
      label: parameter.label,
      valueText: formatUnifiedValue(specValues[parameter.id] ?? parameter.default),
      unit: parameter.unit ?? '1',
      source: 'spec',
    }));
  }
  if (activeRegion !== null) {
    const byId = new Map((object?.parameters ?? []).map((parameter) => [parameter.id, parameter] as const));
    return Object.keys(activeParams).map((key) => {
      const matched = byId.get(key);
      return {
        id: key,
        label: matched?.name ?? key,
        valueText: formatUnifiedValue(activeParams[key]),
        unit: matched?.unit ?? '1',
        source: 'region',
      };
    });
  }
  if (object !== null) {
    return object.parameters.map((parameter) => ({
      id: parameter.id,
      label: parameter.name,
      valueText: formatUnifiedValue(parameter.value),
      unit: parameter.unit,
      source: 'object',
    }));
  }
  return [];
}