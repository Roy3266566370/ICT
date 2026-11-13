/**
 * 区域草稿（识别结果的本地修正）—— 纯函数，不依赖 React。
 *
 * 作用：把 `PageRegion` + 用户的修改，整理成准备页的"参数行 / 映射行"，
 * 并在提交/跳转前生成可复现的参数快照。
 *
 * 复现约束（spec 第 6 条基础条件）：
 *  - 未修改的参数严格取 `original_params`（不补默认值、不猜测）；
 *  - 已修改的参数只保存"被改过的键"，避免把未确认的推断值写回；
 *  - 快照按账号 scope + material_id + region_id 隔离，并核对来源签名。
 */
import type { Provenance } from '@/api/types';
import type { PageRegion, RegionLinkedText, RegionStatus } from '@/regions/types';
import { readDeclaredCells, resolveParams } from '@/legacy/regions/detArea/model';
import { draftStorageKey as scopedDraftStorageKey, type DraftScope } from '@/state/draftScope';
import type { RegionMappingRow } from './RegionMappingList';
import { pickProvenance, type RegionParamRow } from './RegionParamTable';

export interface RegionDraft {
  /**
   * 草稿对应的"识别事实指纹"（script_id + status + original_params + linked_texts）。
   *
   * 为什么需要：区域数据会先以演示值到达、后被真实产物替换；同一 region_id 的两份
   * 事实可能完全不同（S18 演示用语义参数、产物用 cells）。没有指纹就会把演示草稿
   * 套到真实区域上，界面显示"已调整 / 待确认"，用户却从没改过。
   */
  sourceSignature: string;
  status: RegionStatus;
  /** 当前参数（= original_params 覆盖用户改动） */
  params: Record<string, unknown>;
  /** 被用户改过的参数键 */
  editedKeys: Record<string, true>;
  /** 单位覆盖（键 → 单位文本） */
  units: Record<string, string>;
  /** 参数级校验错误（键 → 中文错误） */
  errors: Record<string, string | null>;
  /** 文字模板覆盖（element_id → 模板） */
  templates: Record<string, string>;
  /** 被用户改过的模板 element_id */
  editedTemplates: Record<string, true>;
}

/** 常见参数键的中文名；未知键直接显示键名（不编造含义）。 */
const PARAM_LABELS: Record<string, string> = {
  a11: '矩阵 a11（第一列横向分量）',
  a12: '矩阵 a12（第二列横向分量）',
  a21: '矩阵 a21（第一列纵向分量）',
  a22: '矩阵 a22（第二列纵向分量）',
  vectors: '三条输入向量',
  unit_flip: '单位格翻转',
  stretch_x: '横向倍率',
  stretch_y: '纵向倍率',
  shear_k: '剪切量',
  compress_y: '纵向压缩',
  cell: '对应格（单格区域）',
  cells: '四格矩阵与面积（结构）',
  cells_order: '四格顺序',
  matrix: '矩阵',
  columns: '矩阵的列',
  basis: '基向量',
};

/** 常见参数键的默认单位。 */
const PARAM_UNITS: Record<string, string> = {
  stretch_x: '倍',
  stretch_y: '倍',
  compress_y: '倍',
};

/**
 * 从结构参数派生出的可操作参数（目前只有 S18）：
 * 产物把四格写成 `cells:[{matrix}]`，用户很难直接改矩阵元素；
 * 这里把"拉伸倍率 / 剪切量 / 纵向压缩 / 翻转"以只读事实派生出来，改了就覆盖对应格。
 */
const DERIVED_SEMANTIC_KEYS = ['unit_flip', 'stretch_x', 'stretch_y', 'shear_k', 'compress_y'] as const;

function derivedParamValues(region: PageRegion): Record<string, number> | null {
  if (region.script_id !== 'det_area_2d') return null;
  if (readDeclaredCells(region.original_params) === null) return null;
  const resolved = resolveParams(region.original_params);
  return {
    unit_flip: resolved.unit_flip,
    stretch_x: resolved.stretch_x,
    stretch_y: resolved.stretch_y,
    shear_k: resolved.shear_k,
    compress_y: resolved.compress_y,
  };
}

const PROVENANCE_PATTERN = /provenance=(original|inferred|user_confirmed|manual_demo|read_from_figure)/;

/**
 * 从 region.notes 里读出后端声明的 provenance（读不到返回 null，绝不默认成 original）。
 *
 * `read_from_figure`（渲染产物：从图上读出）在界面上归入"系统推断"，
 * 因为 `Provenance` 白名单只有 4 个值；原文仍保留在备注里，不丢信息。
 */
export function readRegionProvenance(region: PageRegion): Provenance | null {
  const match = PROVENANCE_PATTERN.exec(region.notes ?? '');
  if (match === null) return null;
  const value = match[1];
  if (value === 'read_from_figure') return 'inferred';
  if (value === 'original' || value === 'inferred' || value === 'user_confirmed' || value === 'manual_demo') {
    return value;
  }
  return null;
}

/** 识别事实指纹：判断"这份草稿是否还适用于当前区域"。 */
export function regionSignature(region: PageRegion): string {
  return [
    region.script_id,
    region.status,
    JSON.stringify(region.original_params),
    JSON.stringify(region.linked_texts),
  ].join('|');
}

/** 从原始参数派生初稿：只复制，不做任何补默认值。 */
export function createDraft(region: PageRegion): RegionDraft {
  const params: Record<string, unknown> = {};
  Object.keys(region.original_params).forEach((key) => {
    params[key] = region.original_params[key];
  });
  return {
    sourceSignature: regionSignature(region),
    status: region.status,
    params,
    editedKeys: {},
    units: {},
    errors: {},
    templates: {},
    editedTemplates: {},
  };
}

function rangeText(value: unknown): string {
  if (typeof value === 'number') return '数值';
  if (typeof value === 'boolean') return 'true / false';
  if (typeof value === 'string') return '文本';
  if (Array.isArray(value)) return `数组（${value.length} 项）`;
  if (typeof value === 'object' && value !== null) return '结构（JSON）';
  return '未知类型';
}

/**
 * 参数表行：名称 / 当前值 / 单位 / 来源页 / provenance / 是否偏离。
 *
 * 键集合 = `original_params` ∪ 草稿里的新增键：用户拖动/键入产生的语义参数
 * （如 `stretch_x`）也必须出现在表里，否则"改了却看不到"。
 */
export function buildParamRows(region: PageRegion, draft: RegionDraft): RegionParamRow[] {
  const declared = readRegionProvenance(region);
  const derived = derivedParamValues(region);
  const keys = [...Object.keys(region.original_params)];
  Object.keys(draft.params).forEach((key) => {
    if (!keys.includes(key)) keys.push(key);
  });
  if (derived !== null) {
    DERIVED_SEMANTIC_KEYS.forEach((key) => {
      if (!keys.includes(key)) keys.push(key);
    });
  }

  return keys.map((key) => {
    const rawOriginal = region.original_params[key];
    const derivedValue = derived === null ? undefined : derived[key];
    // 派生参数的"原始值"是产物矩阵反推出的值（不是 JSON 里的键），因此可"恢复原值"
    const original = rawOriginal === undefined ? derivedValue : rawOriginal;
    const current = draft.params[key] ?? (rawOriginal === undefined ? derivedValue : rawOriginal);
    const edited =
      draft.editedKeys[key] === true ||
      (rawOriginal === undefined && derivedValue !== undefined && draft.params[key] !== undefined);
    const provenance: Provenance | null = edited
      ? 'user_confirmed'
      : pickProvenance(declared === null ? [] : [declared]);
    const range =
      rawOriginal !== undefined
        ? rangeText(rawOriginal)
        : derivedValue !== undefined
          ? `从四格矩阵派生（${rangeText(derivedValue)}）`
          : `新增参数（${rangeText(current)}）`;
    return {
      key,
      name: PARAM_LABELS[key] ?? key,
      value: current,
      originalValue: original,
      unit: draft.units[key] ?? PARAM_UNITS[key] ?? '1',
      rangeText: range,
      sourcePage: region.page,
      provenance,
      editable: true,
      error: draft.errors[key] ?? null,
      changed: edited,
    };
  });
}

/** 映射行：element_id + kind + 当前模板。 */
export function buildMappingRows(region: PageRegion, draft: RegionDraft): RegionMappingRow[] {
  return region.linked_texts.map((text: RegionLinkedText) => ({
    elementId: text.element_id,
    kind: text.kind,
    template: draft.templates[text.element_id] ?? text.template,
    edited: draft.editedTemplates[text.element_id] === true,
  }));
}

export type ParamParseResult = { ok: true; value: unknown } | { ok: false; message: string };

/**
 * 文本 → 参数值。按**原始值的类型**解析，拒绝静默改类型：
 * 数值参数输入 "abc" 直接报错，而不是变成字符串存下去。
 */
export function parseParamText(original: unknown, text: string): ParamParseResult {
  const trimmed = text.trim();
  if (typeof original === 'number') {
    if (trimmed === '') return { ok: false, message: '请输入数值' };
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return { ok: false, message: '请输入有效数值（如 2 或 -1.5）' };
    return { ok: true, value };
  }
  if (typeof original === 'boolean') {
    if (trimmed === 'true' || trimmed === '1') return { ok: true, value: true };
    if (trimmed === 'false' || trimmed === '0') return { ok: true, value: false };
    return { ok: false, message: '请输入 true 或 false' };
  }
  if (typeof original === 'string') {
    return { ok: true, value: text };
  }
  if (original === undefined || original === null) {
    // 用户新增的参数（如拖动产生 stretch_x）：数字优先，保持与组件读取逻辑一致
    if (trimmed === '') return { ok: false, message: '请输入数值或文本' };
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return { ok: true, value: numeric };
    return { ok: true, value: text };
  }
  if (Array.isArray(original) || (typeof original === 'object' && original !== null)) {
    if (trimmed === '') return { ok: false, message: '请输入 JSON（如 [1, 2]）' };
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return { ok: true, value: parsed };
    } catch {
      return { ok: false, message: 'JSON 格式不正确，请检查括号与引号' };
    }
  }
  return { ok: true, value: text };
}

/** 应用一次值编辑，返回新草稿（纯函数，便于测试）。 */
export function applyParamEdit(region: PageRegion, draft: RegionDraft, key: string, text: string): RegionDraft {
  const original = region.original_params[key];
  const parsed = parseParamText(original, text);
  if (!parsed.ok) {
    return { ...draft, errors: { ...draft.errors, [key]: parsed.message } };
  }
  return {
    ...draft,
    params: { ...draft.params, [key]: parsed.value },
    editedKeys: { ...draft.editedKeys, [key]: true },
    errors: { ...draft.errors, [key]: null },
  };
}

export function applyUnitEdit(draft: RegionDraft, key: string, unit: string): RegionDraft {
  return { ...draft, units: { ...draft.units, [key]: unit } };
}

export function resetParam(region: PageRegion, draft: RegionDraft, key: string): RegionDraft {
  const params = { ...draft.params };
  if (region.original_params[key] === undefined) {
    delete params[key];
  } else {
    params[key] = region.original_params[key];
  }
  const editedKeys = { ...draft.editedKeys };
  delete editedKeys[key];
  const errors = { ...draft.errors, [key]: null };
  return { ...draft, params, editedKeys, errors };
}

export function applyTemplateEdit(draft: RegionDraft, elementId: string, template: string): RegionDraft {
  return {
    ...draft,
    templates: { ...draft.templates, [elementId]: template },
    editedTemplates: { ...draft.editedTemplates, [elementId]: true },
  };
}

export function resetTemplate(region: PageRegion, draft: RegionDraft, elementId: string): RegionDraft {
  const text = region.linked_texts.find((item) => item.element_id === elementId);
  const templates = { ...draft.templates };
  delete templates[elementId];
  const editedTemplates = { ...draft.editedTemplates };
  delete editedTemplates[elementId];
  if (text !== undefined) templates[elementId] = text.template;
  return { ...draft, templates, editedTemplates };
}

/** 草稿是否有未保存的修正（决定"有改动"提示）。 */
export function isDraftEdited(draft: RegionDraft): boolean {
  return Object.keys(draft.editedKeys).length > 0 || Object.keys(draft.editedTemplates).length > 0;
}

/** 用草稿生成"确认后"的区域对象（只改 status / params / linked_texts，不动 bbox 等识别事实）。 */
export function draftToRegion(region: PageRegion, draft: RegionDraft): PageRegion {
  return {
    ...region,
    status: draft.status,
    original_params: { ...draft.params },
    linked_texts: region.linked_texts.map((text) => ({
      ...text,
      template: draft.templates[text.element_id] ?? text.template,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* 复现：会话内快照                                                            */
/* -------------------------------------------------------------------------- */

/**
 * 会话内快照的存储键。
 * 为什么不是后端：本任务不改 `src/api`，也尚无区域写接口（已在交付总结里列为缺口）；
 * 用 sessionStorage 至少保证"同一浏览器标签页重开准备页 → 输入相同"，且不污染后端数据。
 */
export function draftStorageKey(materialId: string, regionId: string, scope: DraftScope): string {
  return scopedDraftStorageKey('region', scope, [materialId, regionId]);
}

/** 保存草稿；存储不可用（隐私模式/配额）时静默跳过，不影响主流程。 */
export function saveDraft(materialId: string, regionId: string, draft: RegionDraft, scope: DraftScope): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(draftStorageKey(materialId, regionId, scope), JSON.stringify({ ...draft, scope }));
  } catch {
    // 存储不可用时不影响确认流程
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 读取草稿；数据损坏 / 指纹不符（区域识别结果已变化）时返回 null，
 * 回落到当前 original_params —— 绝不把旧事实套到新区域上。
 */
export function loadDraft(
  materialId: string,
  regionId: string,
  expectedSignature: string,
  scope: DraftScope,
): RegionDraft | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null;
  try {
    // 无 scope 的旧键不迁移、不恢复，避免把无法确认归属的草稿交给当前账号。
    raw = window.sessionStorage.getItem(draftStorageKey(materialId, regionId, scope));
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (parsed.scope !== scope) return null;
    const status = parsed.status;
    const params = parsed.params;
    if (typeof status !== 'string' || !isRecord(params)) return null;
    const validStatus: RegionStatus =
      status === 'confirmed' || status === 'static_only' || status === 'unsupported' || status === 'pending'
        ? status
        : 'pending';
    const signature = parsed.sourceSignature;
    if (typeof signature !== 'string') return null;
    if (signature !== expectedSignature) return null;
    return {
      sourceSignature: signature,
      status: validStatus,
      params,
      editedKeys: isRecord(parsed.editedKeys) ? (parsed.editedKeys as Record<string, true>) : {},
      units: isStringRecord(parsed.units),
      errors: {},
      templates: isStringRecord(parsed.templates),
      editedTemplates: isRecord(parsed.editedTemplates) ? (parsed.editedTemplates as Record<string, true>) : {},
    };
  } catch {
    return null;
  }
}

function isStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  Object.keys(value).forEach((key) => {
    const item = value[key];
    if (typeof item === 'string') result[key] = item;
  });
  return result;
}

/** 清理某个区域的历史草稿（"恢复原稿"时用）。 */
export function clearDraft(materialId: string, regionId: string, scope: DraftScope): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(draftStorageKey(materialId, regionId, scope));
  } catch {
    // 忽略
  }
}
