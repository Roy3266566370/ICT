/**
 * det_area_2d（S18 行列式与面积）的纯计算模型。
 *
 * 位置：本文件不依赖 React / DOM，可在 SSR 自检与工作台组件中复用。
 * 语义依据：原页四格 —— 单位方格 / 横向 2 倍纵向 3 倍 / 剪切 / 压到横轴。
 * 面积 = |det A|，定向 = sign(det A)。
 *
 * 参数命名（original_params 的键，snake_case 与区域契约一致）：
 *  - `unit_flip`    ±1：第一格的横向翻转开关，用于演示"定向翻转"（det 变号）
 *  - `stretch_x`    横向倍率（默认 2）
 *  - `stretch_y`    纵向倍率（默认 3）
 *  - `shear_k`      剪切量（默认 1，矩阵 [[1,k],[0,1]]）
 *  - `compress_y`   纵向压缩到第几倍（默认 0，矩阵 [[1,0],[0,c]]）
 *  - `cell`         可选：该 region 只覆盖一格时指定 `unit|stretch|shear|compress`
 */

import type { LinkedTextRuntime, RegionLinkedText } from '@/regions/types';

/** 2×2 矩阵（行优先，字段名便于阅读与模板化输出）。 */
export interface Mat2 {
  a11: number;
  a12: number;
  a21: number;
  a22: number;
}

export type CellId = 'unit' | 'stretch' | 'shear' | 'compress';

/** 定向判定：负行列式表示"翻了"。 */
export type Orientation = 'positive' | 'negative' | 'collapsed';

export interface CellSpec {
  id: CellId;
  /** 界面短标题（参数面板用） */
  title: string;
  /** 原页该格下方的原文标注（用于识别说明与覆盖层兜底） */
  originalText: string;
  /** 该格主参数（拖动/滑块作用于它） */
  primaryParam: string;
  /** 原页标注 element_id（S18 的四个文本框） */
  elementId: string;
}

/** 原页四格顺序：左上、右上、左下、右下。 */
export const CELL_SPECS: readonly CellSpec[] = [
  {
    id: 'unit',
    title: '单位方格',
    originalText: '单位方格　面积 1',
    primaryParam: 'unit_flip',
    elementId: 'p18_s05',
  },
  {
    id: 'stretch',
    title: '横向 2 倍、纵向 3 倍',
    originalText: '横向 2 倍、纵向 3 倍　面积 6',
    primaryParam: 'stretch_x',
    elementId: 'p18_s08',
  },
  {
    id: 'shear',
    title: '剪切',
    originalText: '剪切　面积仍是 1',
    primaryParam: 'shear_k',
    elementId: 'p18_s11',
  },
  {
    id: 'compress',
    title: '压到横轴',
    originalText: '压到横轴　面积 0',
    primaryParam: 'compress_y',
    elementId: 'p18_s14',
  },
] as const;

/** 参数默认值 —— 与 spec「S18 四格 original_params」逐条一致，也是"恢复原稿"的目标值。 */
export interface DetAreaParams {
  unit_flip: number;
  stretch_x: number;
  stretch_y: number;
  shear_k: number;
  compress_y: number;
}

export const DEFAULT_PARAMS: DetAreaParams = {
  unit_flip: 1,
  stretch_x: 2,
  stretch_y: 3,
  shear_k: 1,
  compress_y: 0,
};

/** 参数元数据：供准备页/参数抽屉生成控件；不含任何 UI 依赖。 */
export interface ParamMeta {
  key: keyof DetAreaParams;
  name: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  description: string;
}

export const PARAM_METAS: readonly ParamMeta[] = [
  {
    key: 'unit_flip',
    name: '单位格翻转',
    unit: '1',
    min: -1,
    max: 1,
    step: 2,
    description: '1 = 没翻（正定向），−1 = 翻了（负定向）；只改符号不改面积',
  },
  {
    key: 'stretch_x',
    name: '横向倍率',
    unit: '倍',
    min: 0.4,
    max: 4,
    step: 0.1,
    description: '横向拉伸多少倍，面积倍率随之相乘',
  },
  {
    key: 'stretch_y',
    name: '纵向倍率',
    unit: '倍',
    min: 0.4,
    max: 4,
    step: 0.1,
    description: '纵向拉伸多少倍，面积倍率随之相乘',
  },
  {
    key: 'shear_k',
    name: '剪切量',
    unit: '1',
    min: -2,
    max: 2,
    step: 0.1,
    description: '顶边向右错开的量；剪切不改变面积（det 恒为 1）',
  },
  {
    key: 'compress_y',
    name: '纵向压缩',
    unit: '倍',
    min: 0,
    max: 1,
    step: 0.05,
    description: '纵向压缩到 0 时平面被压成一条线，det = 0',
  },
] as const;

/** 退化阈值：|det| 小于该值即视为"压成一条线"，避免除零与 NaN。 */
export const SINGULAR_EPSILON = 1e-9;

export interface CellState {
  id: CellId;
  spec: CellSpec;
  /** 该格的显示名：优先产物 `cells[].label`，否则用组件内的规范标题 */
  label: string;
  matrix: Mat2;
  /** 行列式（有限数；异常输入已回退到默认值） */
  det: number;
  /** 面积倍率 = |det| */
  area: number;
  orientation: Orientation;
  /** 形如 "1.0" / "6.0" */
  areaText: string;
  /** 形如 "正（+）" / "翻了（−）" / "无（压成一条线）" */
  orientationText: string;
  /** 一行式：`det = 2 × 3 = 6` */
  formulaText: string;
  /** det≈0 时的说明，非退化时为空串 */
  degenerateNote: string;
  /** 参数是否偏离 original_params（组件用于显示"当前值"） */
  modified: boolean;
}

/* -------------------------------------------------------------------------- */
/* 参数读取（外部 JSON 一律先按 unknown 收窄，禁止 any）                       */
/* -------------------------------------------------------------------------- */

/**
 * 读取数值参数：接受 number 与可解析的数字字符串。
 * 非法/非有限值一律回退到 fallback —— 这是"不得出现 NaN"的第一道防线。
 */
export function readNumericParam(
  params: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const raw = params[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** 后端产物里声明的单格（`original_params.cells[]`，见 R1 的 regions.json）。 */
export interface DeclaredCell {
  cell_id: string;
  matrix: Mat2;
  label: string | null;
  note: string | null;
}

/** 产物中的 cell_id 与组件内部 id 的别名：`flip` 就是"压到横轴"那一格。 */
const CELL_ID_ALIAS: Record<string, CellId> = {
  unit: 'unit',
  stretch: 'stretch',
  shear: 'shear',
  compress: 'compress',
  flip: 'compress',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMatrix(value: unknown): Mat2 | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [row0, row1] = value;
  if (!Array.isArray(row0) || !Array.isArray(row1) || row0.length !== 2 || row1.length !== 2) return null;
  const [a11, a12, a21, a22] = [row0[0], row0[1], row1[0], row1[1]];
  if (![a11, a12, a21, a22].every((item) => typeof item === 'number' && Number.isFinite(item))) return null;
  return { a11, a12, a21, a22 };
}

/**
 * 读取产物声明的四格矩阵。
 *
 * 为什么需要：R1 的 S18 产物把参数写成 `{ cells: [{ cell_id, matrix, label }], cells_order }`，
 * 而不是语义参数。组件必须两种形状都吃：产物矩阵作为**事实来源**，语义参数只用于用户改动。
 */
export function readDeclaredCells(
  params: Record<string, unknown>,
): Partial<Record<CellId, DeclaredCell>> | null {
  const raw = params['cells'];
  if (!Array.isArray(raw)) return null;
  const result: Partial<Record<CellId, DeclaredCell>> = {};
  raw.forEach((item) => {
    if (!isRecord(item)) return;
    const declaredId = item['cell_id'];
    if (typeof declaredId !== 'string') return;
    const cellId = CELL_ID_ALIAS[declaredId];
    if (cellId === undefined) return;
    const matrix = readMatrix(item['matrix']);
    if (matrix === null) return;
    const label = item['label'];
    const note = item['note'];
    result[cellId] = {
      cell_id: declaredId,
      matrix,
      label: typeof label === 'string' && label.length > 0 ? label : null,
      note: typeof note === 'string' && note.length > 0 ? note : null,
    };
  });
  return Object.keys(result).length > 0 ? result : null;
}

/** 该格的语义参数是否被用户改过（决定用产物矩阵还是用语义参数重建）。 */
function cellOverridden(params: Record<string, unknown>, cell: CellId): boolean {
  switch (cell) {
    case 'unit':
      return params['unit_flip'] !== undefined;
    case 'stretch':
      return params['stretch_x'] !== undefined || params['stretch_y'] !== undefined;
    case 'shear':
      return params['shear_k'] !== undefined;
    case 'compress':
      return params['compress_y'] !== undefined;
  }
}

/**
 * 合并 original_params 与用户改动后的有效参数（缺省/非法键回退到默认值）。
 *
 * 缺省值优先从产物 `cells[].matrix` 反推（如 stretch_x = A·e1 的横分量），
 * 这样拖动手柄时数值从产物的真实矩阵开始连续变化，而不是跳回 2 倍 / 3 倍。
 */
export function resolveParams(params: Record<string, unknown>): DetAreaParams {
  const declared = readDeclaredCells(params);
  const unitMatrix = declared?.unit?.matrix;
  const stretchMatrix = declared?.stretch?.matrix;
  const shearMatrix = declared?.shear?.matrix;
  const compressMatrix = declared?.compress?.matrix;
  return {
    unit_flip: readNumericParam(
      params,
      'unit_flip',
      unitMatrix === undefined ? DEFAULT_PARAMS.unit_flip : unitMatrix.a11 >= 0 ? 1 : -1,
    ),
    stretch_x: readNumericParam(
      params,
      'stretch_x',
      stretchMatrix === undefined ? DEFAULT_PARAMS.stretch_x : stretchMatrix.a11,
    ),
    stretch_y: readNumericParam(
      params,
      'stretch_y',
      stretchMatrix === undefined ? DEFAULT_PARAMS.stretch_y : stretchMatrix.a22,
    ),
    shear_k: readNumericParam(
      params,
      'shear_k',
      shearMatrix === undefined ? DEFAULT_PARAMS.shear_k : shearMatrix.a12,
    ),
    compress_y: readNumericParam(
      params,
      'compress_y',
      compressMatrix === undefined ? DEFAULT_PARAMS.compress_y : compressMatrix.a22,
    ),
  };
}

/** 参数级别的默认值对象（含 `cell` 以外全部键），供宿主"恢复原稿"用。 */
export function defaultParams(): Record<string, unknown> {
  return { ...DEFAULT_PARAMS };
}

/* -------------------------------------------------------------------------- */
/* 矩阵与行列式                                                                */
/* -------------------------------------------------------------------------- */

/** 每格的目标矩阵：语义参数 → 矩阵元素。翻转只作用于第一格。 */
export function matrixOf(cell: CellId, params: DetAreaParams): Mat2 {
  switch (cell) {
    case 'unit':
      return {
        a11: params.unit_flip >= 0 ? 1 : -1,
        a12: 0,
        a21: 0,
        a22: 1,
      };
    case 'stretch':
      return { a11: params.stretch_x, a12: 0, a21: 0, a22: params.stretch_y };
    case 'shear':
      return { a11: 1, a12: params.shear_k, a21: 0, a22: 1 };
    case 'compress':
      return { a11: 1, a12: 0, a21: 0, a22: params.compress_y };
    default:
      // 联合类型已穷尽；保留防御分支避免外部字符串被强转时崩溃。
      return { a11: 1, a12: 0, a21: 0, a22: 1 };
  }
}

/** 行列式 ad − bc。 */
export function determinant(m: Mat2): number {
  const value = m.a11 * m.a22 - m.a12 * m.a21;
  return Number.isFinite(value) ? value : 0;
}

/**
 * 步骤插值：A(t) = I + t·(A − I)。
 * t ∈ [0,1]：0 = 原像（单位方格），1 = 目标矩阵。
 * 只对"单一线性变换"做元素插值，不把它解释成多步复合运算（spec §9 播放语义）。
 */
export function interpolateMatrix(m: Mat2, t: number): Mat2 {
  const clamped = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  return {
    a11: 1 + (m.a11 - 1) * clamped,
    a12: 0 + (m.a12 - 0) * clamped,
    a21: 0 + (m.a21 - 0) * clamped,
    a22: 1 + (m.a22 - 1) * clamped,
  };
}

/** 面积文本：一位小数；极小的非零值不显示成 0（避免"面积 0"与退化混淆）。 */
export function formatArea(area: number): string {
  if (!Number.isFinite(area)) return '0.0';
  if (area > 0 && area < 0.05) return area.toFixed(2);
  return area.toFixed(1);
}

export function orientationOf(det: number): Orientation {
  if (!Number.isFinite(det) || Math.abs(det) <= SINGULAR_EPSILON) return 'collapsed';
  return det > 0 ? 'positive' : 'negative';
}

export function orientationText(orientation: Orientation): string {
  switch (orientation) {
    case 'positive':
      return '正（+）';
    case 'negative':
      return '翻了（−）';
    case 'collapsed':
      return '无（压成一条线）';
  }
}

/** 带符号的行列式文本，如 "+6.0" / "−1.0"（用 U+2212 减号，避免与连字符混淆）。 */
export function formatSigned(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) <= SINGULAR_EPSILON) return '0.0';
  const text = Math.abs(value).toFixed(1);
  return value < 0 ? `−${text}` : `+${text}`;
}

function formulaFor(cell: CellId, params: DetAreaParams, m: Mat2, det: number): string {
  switch (cell) {
    case 'unit':
      return `det = ${m.a11} × ${m.a22} = ${formatSigned(det)}`;
    case 'stretch':
      return `det = ${formatArea(params.stretch_x)} × ${formatArea(params.stretch_y)} = ${formatSigned(det)}`;
    case 'shear':
      return `det = 1 × 1 − ${formatArea(params.shear_k)} × 0 = ${formatSigned(det)}`;
    case 'compress':
      return `det = 1 × ${formatArea(params.compress_y)} = ${formatSigned(det)}`;
  }
}

export const DEGENERATE_NOTE = '面积 0，平面被压成一条线';

function degenerateNoteOf(orientation: Orientation): string {
  return orientation === 'collapsed' ? DEGENERATE_NOTE : '';
}

/**
 * 构建四格的状态（默认 stage=1，即"最终矩阵"）。
 * `t` 用于播放中间态：t=0 原像、t=0.5 变化中、t=1 完成。
 */
export function buildCells(
  params: Record<string, unknown>,
  original?: Record<string, unknown>,
  t = 1,
): CellState[] {
  const resolved = resolveParams(params);
  const declared = readDeclaredCells(params);
  return CELL_SPECS.map((spec) => {
    const declaredCell = declared?.[spec.id];
    // 产物矩阵是识别事实；只有当用户改过该格的语义参数时才用语义参数重建。
    const target =
      declaredCell !== undefined && !cellOverridden(params, spec.id)
        ? declaredCell.matrix
        : matrixOf(spec.id, resolved);
    const matrix = interpolateMatrix(target, t);
    const det = determinant(matrix);
    const area = Math.abs(det);
    const orientation = orientationOf(det);
    return {
      id: spec.id,
      spec,
      label: declaredCell?.label ?? spec.title,
      matrix,
      det,
      area,
      orientation,
      areaText: formatArea(area),
      orientationText: orientationText(orientation),
      formulaText: formulaFor(spec.id, resolved, matrix, det),
      degenerateNote: degenerateNoteOf(orientation),
      modified: original === undefined ? false : !matchesOriginal(params, original, spec.id),
    };
  });
}

/**
 * 仅比较某一格相关参数是否仍等于原值（其它格的改动不给本格标"当前值"）。
 * 返回 true = 与原始一致。
 */
function matchesOriginal(
  params: Record<string, unknown>,
  original: Record<string, unknown>,
  cell: CellId,
): boolean {
  const keys: Record<CellId, string[]> = {
    unit: ['unit_flip'],
    stretch: ['stretch_x', 'stretch_y'],
    shear: ['shear_k'],
    compress: ['compress_y'],
  };
  return !isOffOriginal(pickKeys(params, keys[cell]), pickKeys(original, keys[cell]));
}

function pickKeys(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  keys.forEach((key) => {
    result[key] = source[key];
  });
  return result;
}

/**
 * 参数是否偏离原值（浅比较，数值带 1e-9 容差）。
 *
 * `regions/types.ts` 的冻结契约只声明形状、不带工具函数，因此这里保留一份本地实现，
 * 避免给其它区域组件引入共享工具模块（各自独立、互不阻塞）。
 */
export function isOffOriginal(
  params: Record<string, unknown>,
  original: Record<string, unknown>,
): boolean {
  const keys = new Set([...Object.keys(params), ...Object.keys(original)]);
  for (const key of keys) {
    const left = params[key];
    const right = original[key];
    if (typeof left === 'number' && typeof right === 'number') {
      if (Math.abs(left - right) > 1e-9) return true;
      continue;
    }
    if (JSON.stringify(left) !== JSON.stringify(right)) return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* 文字同步（linked_texts 覆盖层）                                              */
/* -------------------------------------------------------------------------- */

/** 供 `linked_texts.template` 使用的占位符键（后端可任选其一组合）。 */
export function textValues(cells: CellState[], params: Record<string, unknown>): Record<string, string> {
  const resolved = resolveParams(params);
  const byId = new Map<CellId, CellState>(cells.map((cell) => [cell.id, cell]));
  const unit = byId.get('unit');
  const stretch = byId.get('stretch');
  const shear = byId.get('shear');
  const compress = byId.get('compress');
  return {
    area_unit: unit?.areaText ?? '—',
    area_stretch: stretch?.areaText ?? '—',
    area_shear: shear?.areaText ?? '—',
    area_compress: compress?.areaText ?? '—',
    sign_unit: unit?.orientationText ?? '—',
    sign_stretch: stretch?.orientationText ?? '—',
    sign_shear: shear?.orientationText ?? '—',
    sign_compress: compress?.orientationText ?? '—',
    det_unit: unit === undefined ? '—' : formatSigned(unit.det),
    det_stretch: stretch === undefined ? '—' : formatSigned(stretch.det),
    stretch_x: formatArea(resolved.stretch_x),
    stretch_y: formatArea(resolved.stretch_y),
    shear_k: formatArea(resolved.shear_k),
    compress_y: formatArea(resolved.compress_y),
  };
}

/**
 * 原页四格标注的兜底模板（`region.linked_texts` 缺失或为空时使用）。
 * 键为原页元素 id（S18：p18_s05 / s08 / s11 / s14，结论在 s15）。
 */
export const FALLBACK_TEXT_TEMPLATES: readonly RegionLinkedText[] = [
  {
    element_id: 'p18_s05',
    bbox: { x: 0.79, y: 3.35, w: 2.96, h: 0.19 },
    template: '单位方格　面积 {area_unit}',
    kind: 'result',
  },
  {
    element_id: 'p18_s08',
    bbox: { x: 4.25, y: 3.35, w: 2.96, h: 0.19 },
    template: '横向 {stretch_x} 倍、纵向 {stretch_y} 倍　面积 {area_stretch}',
    kind: 'result',
  },
  {
    element_id: 'p18_s11',
    bbox: { x: 0.79, y: 6.0, w: 2.96, h: 0.19 },
    template: '剪切　面积 {area_shear}',
    kind: 'result',
  },
  {
    element_id: 'p18_s14',
    bbox: { x: 4.25, y: 6.0, w: 2.96, h: 0.19 },
    template: '压到横轴　面积 {area_compress}',
    kind: 'result',
  },
  {
    element_id: 'p18_s15',
    bbox: { x: 7.97, y: 2.1, w: 4.69, h: 0.4 },
    // 只在原始参数下成立的说明：参数偏离后必须能看到"原页为……"的限定（spec §8 第 3 类）。
    template: '绝对值是面积倍率；符号是定向：{sign_summary}。',
    kind: 'hint',
  },
] as const;

/**
 * 生成 `onLinkedTexts` 回传数组。
 * - `changed=true` 表示当前参数偏离 `original_params`，宿主据此加"当前值"标记；
 * - 未偏离时仍回传原文（宿主可隐藏覆盖层，恢复原值后覆盖层自动消失）。
 */
/** 原页元素 → 格：产物模板是 `{label}　面积 {det}`，需要按元素把每条文字绑定到对应格。 */
const CELL_BY_ELEMENT: Record<string, CellId> = {
  p18_s05: 'unit',
  p18_s08: 'stretch',
  p18_s11: 'shear',
  p18_s14: 'compress',
};

/**
 * 生成 `onLinkedTexts` 回传数组。
 *
 * 兼容两种后端模板形态：
 *  - 明确占位符（`{area_stretch}` / `{stretch_x}`）：走全局值；
 *  - 通用占位符（`{label}` / `{det}` / `{area}`）：按 element_id（四格固定映射）
 *    或按数组顺序把每条文字绑定到对应格，避免四条文字都显示同一格的数值。
 *
 * `changed=true` 表示当前参数偏离 `original_params`，宿主据此加"当前值"标记。
 */
export function buildLinkedTextValues(
  texts: readonly RegionLinkedText[] | undefined,
  cells: CellState[],
  params: Record<string, unknown>,
  original: Record<string, unknown>,
): LinkedTextRuntime[] {
  const globalValues = textValues(cells, params);
  const resolved = resolveParams(params);
  const signSummary =
    resolved.unit_flip < 0
      ? '没翻为正，翻了为负（当前把单位格翻了过来）'
      : '翻了为负，没翻为正';
  const changed = isOffOriginal(params, original);
  const list = texts !== undefined && texts.length > 0 ? texts : FALLBACK_TEXT_TEMPLATES;

  return list.map((entry, index) => {
    const mappedId = CELL_BY_ELEMENT[entry.element_id];
    const cell = mappedId === undefined ? cells[index] ?? cells[0] : cells.find((item) => item.id === mappedId);
    const values: Record<string, string> = {
      ...globalValues,
      sign_summary: signSummary,
      label: cell?.label ?? '',
      det: cell === undefined ? '—' : formatSigned(cell.det),
      area: cell?.areaText ?? '—',
      sign: cell?.orientationText ?? '—',
      determinant: cell === undefined ? '—' : formatSigned(cell.det),
    };
    return {
      element_id: entry.element_id,
      text: entry.template.replace(/\{(\w+)\}/g, (_match: string, key: string) => {
        const value = values[key];
        return value === undefined ? '—' : value;
      }),
      changed,
    };
  });
}

/** 单格 region（`params.cell` 指定）或四格整体：决定渲染哪几格。 */
export function visibleCellIds(params: Record<string, unknown>): CellId[] {
  const focus = params['cell'];
  if (typeof focus === 'string') {
    const hit = CELL_SPECS.find((spec) => spec.id === focus);
    if (hit !== undefined) return [hit.id];
  }
  return CELL_SPECS.map((spec) => spec.id);
}