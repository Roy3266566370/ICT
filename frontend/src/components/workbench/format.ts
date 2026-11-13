import type { ParameterRange, ParameterType, Provenance, SourceRef } from '@/api/types';
import { displayUnit, formatDateTime as formatIsoDateTime } from '@/domain/format';

/**
 * 时间展示：复用 `@/domain/format` 的本地化格式，仅补 null 兜底。
 * （不参与计算，参见 §2.2 的展示层约定）
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '未知';
  return formatIsoDateTime(iso);
}

/** 相对当前时间的粗粒度描述，用于"到期""上传"等说明性文案。 */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '未知';
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return iso;
  const diffMinutes = Math.round((target - Date.now()) / 60000);
  const abs = Math.abs(diffMinutes);
  const suffix = diffMinutes >= 0 ? '后' : '前';
  if (abs < 1) return '刚刚';
  if (abs < 60) return `${abs} 分钟${suffix}`;
  if (abs < 60 * 24) return `${Math.round(abs / 60)} 小时${suffix}`;
  return `${Math.round(abs / (60 * 24))} 天${suffix}`;
}

/**
 * 参数单位展示：C-KO@1 约定无量纲为 `"1"`，界面显示"无量纲"而不是空白单元格。
 * 底层复用 `@/domain/format` 的 `displayUnit`。
 */
export function formatUnit(unit: string): string {
  const display = displayUnit(unit);
  return display.length === 0 ? '无量纲' : display;
}

/** 参数范围文案（C-KO@1 `ParameterRange`）。 */
export function formatRange(range: ParameterRange, unit: string): string {
  const min = range.min_decimal ?? (range.min === null ? null : String(range.min));
  const max = range.max_decimal ?? (range.max === null ? null : String(range.max));
  const unitText = unit && unit !== '1' ? ` ${unit}` : '';
  if (min !== null && max !== null) {
    const stepText = range.step === null ? '' : `，步长 ${range.step}`;
    return `${min} ~ ${max}${unitText}${stepText}`;
  }
  if (min !== null) return `≥ ${min}${unitText}`;
  if (max !== null) return `≤ ${max}${unitText}`;
  return '未限制';
}

const PROVENANCE_LABELS: Record<Provenance, string> = {
  original: '原文提取',
  inferred: '系统推断',
  user_confirmed: '用户确认',
  manual_demo: '示例预置',
};

export function formatProvenance(provenance: Provenance | null | undefined): string {
  if (!provenance) return '未知来源';
  return PROVENANCE_LABELS[provenance] ?? provenance;
}

/**
 * 来源状态优先级（C-KO@1）：user_confirmed > original > inferred > manual_demo。
 * 同一参数有多个来源时按此顺序选主标签，但 `source_ref_ids` 全量保留。
 */
const PROVENANCE_PRIORITY: Record<Provenance, number> = {
  user_confirmed: 0,
  original: 1,
  inferred: 2,
  manual_demo: 3,
};

export function pickPrimaryProvenance(provenances: Provenance[]): Provenance | null {
  if (provenances.length === 0) return null;
  const sorted = [...provenances].sort(
    (left, right) => PROVENANCE_PRIORITY[left] - PROVENANCE_PRIORITY[right],
  );
  return sorted[0] ?? null;
}

/** 来源定位文案：页级来源与元素级来源必须可区分（R4-AC3/R4-AC4）。 */
export function formatSourceLocation(source: SourceRef): string {
  if (source.page === null) return '无页码来源';
  if (source.element_id === null || source.bbox === null) return `第 ${source.page} 页（页级来源）`;
  return `第 ${source.page} 页 · 元素 ${source.element_id}`;
}

/** 参数值的界面文本形态（可回填到 CandidateTable 的编辑框）。 */
export function formatParameterValue(type: ParameterType, value: unknown): string {
  if (value === null || value === undefined) return '';
  switch (type) {
    case 'matrix2':
    case 'vector2':
    case 'graph':
    case 'force_list':
      return JSON.stringify(value);
    case 'integer':
    case 'decimal':
    case 'text':
    case 'enum':
      return typeof value === 'string' ? value : String(value);
    default:
      return String(value);
  }
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNumberArray(
  value: unknown,
  length: number,
  label: string,
): { ok: true; value: number[] } | { ok: false; message: string } {
  if (!Array.isArray(value) || value.length !== length) {
    return { ok: false, message: `${label} 需为 ${length} 个数字的数组` };
  }
  const numbers: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      return { ok: false, message: `${label} 的每个分量都必须是有限数字` };
    }
    numbers.push(item);
  }
  return { ok: true, value: numbers };
}

/**
 * 把候选表里的编辑文本还原为契约要求的 `Parameter.value` 形状。
 * 只做形状校验，取值范围由 modelStore / 内核负责（C-KO@1 与各模板契约）。
 */
export function parseParameterValueText(type: ParameterType, text: string): ParseResult {
  const trimmed = text.trim();
  switch (type) {
    case 'matrix2': {
      const parsed = tryParseJson(trimmed);
      if (!parsed.ok) return { ok: false, message: '矩阵需为合法 JSON，例如 [[1,1],[0,1]]' };
      if (!Array.isArray(parsed.value) || parsed.value.length !== 2) {
        return { ok: false, message: '矩阵需为 2 行' };
      }
      const rows: number[][] = [];
      for (let rowIndex = 0; rowIndex < 2; rowIndex += 1) {
        const row = readNumberArray(parsed.value[rowIndex], 2, `矩阵第 ${rowIndex + 1} 行`);
        if (!row.ok) return row;
        rows.push(row.value as number[]);
      }
      return { ok: true, value: rows };
    }
    case 'vector2': {
      const parsed = tryParseJson(trimmed);
      if (!parsed.ok) return { ok: false, message: '向量需为合法 JSON，例如 [1,1]' };
      return readNumberArray(parsed.value, 2, '向量');
    }
    case 'force_list': {
      const parsed = tryParseJson(trimmed);
      if (!parsed.ok) return { ok: false, message: '力列表需为合法 JSON 数组' };
      if (!Array.isArray(parsed.value) || parsed.value.length < 2 || parsed.value.length > 4) {
        return { ok: false, message: '力列表需包含 2 至 4 个力' };
      }
      for (const force of parsed.value) {
        if (!isRecord(force) || typeof force.magnitude !== 'string') {
          return { ok: false, message: '每个力需包含十进制字符串 magnitude 与数字 angle_deg' };
        }
        if (typeof force.angle_deg !== 'number' || !Number.isFinite(force.angle_deg)) {
          return { ok: false, message: '力的 angle_deg 必须是数字' };
        }
      }
      return { ok: true, value: parsed.value };
    }
    case 'graph': {
      const parsed = tryParseJson(trimmed);
      if (!parsed.ok) return { ok: false, message: '图需为合法 JSON，包含 nodes 与 edges' };
      if (!isRecord(parsed.value) || !Array.isArray(parsed.value.nodes) || !Array.isArray(parsed.value.edges)) {
        return { ok: false, message: '图需包含 nodes 与 edges 两个数组' };
      }
      return { ok: true, value: parsed.value };
    }
    case 'integer': {
      if (!/^-?\d+$/.test(trimmed)) return { ok: false, message: '需为整数' };
      const parsedNumber = Number.parseInt(trimmed, 10);
      if (!Number.isSafeInteger(parsedNumber)) return { ok: false, message: '整数超出可安全表示范围' };
      return { ok: true, value: parsedNumber };
    }
    case 'decimal': {
      if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
        return { ok: false, message: '金额需为十进制字符串，例如 "9400.50"' };
      }
      return { ok: true, value: trimmed };
    }
    case 'enum':
    case 'text':
    default: {
      if (trimmed.length === 0) return { ok: false, message: '文本不能为空' };
      return { ok: true, value: text };
    }
  }
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * 参数签名：用于判断"当前参数是否与某次运行的 input_snapshot 不同"。
 * 只对 `id + value` 做稳定序列化，便于比较；不参与任何数值计算。
 */
export function parameterSignature(parameters: { id: string; value: unknown }[]): string {
  const normalized = [...parameters]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((parameter) => `${parameter.id}=${stableStringify(parameter.value)}`);
  return normalized.join('|');
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${key}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return String(value);
}

/** 对象/报告里的 id 过长时在界面上截断，完整值放入 title。 */
export function shortId(id: string, maxLength = 14): string {
  if (id.length <= maxLength) return id;
  return `${id.slice(0, maxLength)}…`;
}
