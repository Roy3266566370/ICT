/**
 * matrixColumns/scene.ts —— S9「矩阵各列与基向量」的纯计算、投影与标注布局。
 *
 * 施工依据：docs/rebuild-spec.md §4（坐标/参数）、§7（视觉）、§7.1（标注防遮挡）。
 *
 * 本文件刻意**不依赖** `matrixEigen`：两个 region 目录并行施工时各自可独立编译，
 * 通用小函数（projectPoint / fillTemplate / isOffOriginal / layoutLabels）在此保留一份
 * 语义相同的实现，避免跨目录改动互相踩踏。
 *
 * 教学语义：`A·v = v₁·col₁ + v₂·col₂`——拖动两列的像即可反推矩阵的两列。
 */
import type {
  RegionCoordinateSystem as CoordinateSystem,
  RegionLinkedText as LinkedText,
} from '@/regions/types';

export type Vec2 = [number, number];

export interface Mat2 {
  a11: number;
  a12: number;
  a21: number;
  a22: number;
}

export const EPS = 1e-9;
export const PARAM_MIN = -3;
export const PARAM_MAX = 3;
export const PARAM_STEP = 0.1;

/** region 未给坐标时的兜底（与 S6 原型同一套坐标）。 */
export const DEFAULT_CS: CoordinateSystem = {
  view_box: [1920, 1350],
  origin: [640, 770],
  unit: 150,
  y_axis: 'up',
};

export const DEFAULT_MATRIX: Mat2 = { a11: 2, a12: 1, a21: 1, a22: 2 };
export const DEFAULT_VECTOR: Vec2 = [1, 1];

/* -------------------------------------------------------------------------- */
/* 投影 / 模板 / 原值比对                                                      */
/* -------------------------------------------------------------------------- */

export function projectPoint(cs: CoordinateSystem, x: number, y: number): [number, number] {
  const px = cs.origin[0] + x * cs.unit;
  const py = cs.y_axis === 'up' ? cs.origin[1] - y * cs.unit : cs.origin[1] + y * cs.unit;
  return [round(px), round(py)];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * SVG 像素 → 数学坐标（拖动两列端点时反推矩阵列用）。
 * 与 `projectPoint` 严格互逆；宿主缩放只改容器尺寸，本函数输入是**未缩放**的 viewBox 坐标。
 */
export function unproject(cs: CoordinateSystem, px: number, py: number): Vec2 {
  const x = (px - cs.origin[0]) / cs.unit;
  const y = cs.y_axis === 'up' ? (cs.origin[1] - py) / cs.unit : (py - cs.origin[1]) / cs.unit;
  return [x, y];
}


export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match: string, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

export function isOffOriginal(
  params: Record<string, unknown>,
  original: Record<string, unknown>,
  epsilon = EPS,
): boolean {
  const keys = new Set<string>([...Object.keys(params), ...Object.keys(original)]);
  for (const key of keys) {
    if (!sameValue(params[key], original[key], epsilon)) return true;
  }
  return false;
}

function sameValue(a: unknown, b: unknown, epsilon: number): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= epsilon;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => sameValue(item, b[index], epsilon));
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* 参数读取                                                                    */
/* -------------------------------------------------------------------------- */

export function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function readVector(value: unknown, fallback: Vec2): Vec2 {
  if (!Array.isArray(value) || value.length < 2) return [fallback[0], fallback[1]];
  const [x, y] = value;
  if (typeof x !== 'number' || typeof y !== 'number') return [fallback[0], fallback[1]];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [fallback[0], fallback[1]];
  return [x, y];
}

export function readMatrix(params: Record<string, unknown>, fallback: Mat2): Mat2 {
  return {
    a11: readNumber(params['a11'], fallback.a11),
    a12: readNumber(params['a12'], fallback.a12),
    a21: readNumber(params['a21'], fallback.a21),
    a22: readNumber(params['a22'], fallback.a22),
  };
}

/** 输入向量：优先 `v1/v2` 两个标量参数，其次 `vector: [x, y]`，最后用兜底值。 */
export function readInputVector(params: Record<string, unknown>, fallback: Vec2): Vec2 {
  if (params['v1'] !== undefined || params['v2'] !== undefined) {
    return [readNumber(params['v1'], fallback[0]), readNumber(params['v2'], fallback[1])];
  }
  return readVector(params['vector'], fallback);
}

export function clampParam(value: number): number {
  const clamped = Math.min(PARAM_MAX, Math.max(PARAM_MIN, value));
  const snapped = Math.round(clamped / PARAM_STEP) * PARAM_STEP;
  const rounded = Math.round(snapped * 1e6) / 1e6;
  return Math.abs(rounded) <= EPS ? 0 : rounded;
}

export function clampVector(vector: Vec2): Vec2 {
  return [clampParam(vector[0]), clampParam(vector[1])];
}

/* -------------------------------------------------------------------------- */
/* 线性代数                                                                    */
/* -------------------------------------------------------------------------- */

export function applyMatrix(matrix: Mat2, vector: Vec2): Vec2 {
  return [
    normalizeZero(matrix.a11 * vector[0] + matrix.a12 * vector[1]),
    normalizeZero(matrix.a21 * vector[0] + matrix.a22 * vector[1]),
  ];
}

export function scaleVector(vector: Vec2, factor: number): Vec2 {
  return [normalizeZero(vector[0] * factor), normalizeZero(vector[1] * factor)];
}

export function addVectors(a: Vec2, b: Vec2): Vec2 {
  return [normalizeZero(a[0] + b[0]), normalizeZero(a[1] + b[1])];
}

function normalizeZero(value: number): number {
  const rounded = Math.round(value * 1e10) / 1e10;
  return Math.abs(rounded) <= EPS ? 0 : rounded;
}

export function isZeroVector(vector: Vec2): boolean {
  return Math.abs(vector[0]) <= EPS && Math.abs(vector[1]) <= EPS;
}

export function cross(a: Vec2, b: Vec2): number {
  return normalizeZero(a[0] * b[1] - a[1] * b[0]);
}

/** 数值展示：最多 2 位小数。 */
export function fmt(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 100) / 100;
  if (Math.abs(rounded) < EPS) return '0';
  return String(rounded);
}

export function fmtVec(vector: Vec2): string {
  return `(${fmt(vector[0])}, ${fmt(vector[1])})`;
}

/* -------------------------------------------------------------------------- */
/* S9 组合模型                                                                 */
/* -------------------------------------------------------------------------- */

export interface ColumnsModel {
  matrix: Mat2;
  vector: Vec2;
  /** 矩阵两列（= e₁ / e₂ 的像） */
  col1: Vec2;
  col2: Vec2;
  /** v₁·col₁ 与 v₂·col₂ */
  scaled1: Vec2;
  scaled2: Vec2;
  /** A·v = v₁·col₁ + v₂·col₂ */
  image: Vec2;
  /** 被映成零的列下标（0/1） */
  zeroCols: number[];
  /** 两列共线（不含零列判定，零列另有文案） */
  collinear: boolean;
  rank: 0 | 1 | 2;
}

export function buildColumnsModel(matrix: Mat2, vector: Vec2): ColumnsModel {
  const col1: Vec2 = [matrix.a11, matrix.a21];
  const col2: Vec2 = [matrix.a12, matrix.a22];
  const scaled1 = scaleVector(col1, vector[0]);
  const scaled2 = scaleVector(col2, vector[1]);
  const image = addVectors(scaled1, scaled2);
  const zeroCols: number[] = [];
  if (isZeroVector(col1)) zeroCols.push(0);
  if (isZeroVector(col2)) zeroCols.push(1);
  const collinear = zeroCols.length === 0 && Math.abs(cross(col1, col2)) <= 1e-7;
  const rank: 0 | 1 | 2 =
    zeroCols.length === 2 ? 0 : zeroCols.length === 1 || collinear ? 1 : 2;
  return { matrix, vector, col1, col2, scaled1, scaled2, image, zeroCols, collinear, rank };
}

/**
 * 退化文案（任务要求逐字包含两句）：
 *  - 两列共线 → `两列共线，平面被压成一条线（rank=1）`
 *  - 零列     → `该列被映成零`
 */
export function degenerationNotice(model: ColumnsModel): string | null {
  if (model.zeroCols.length === 2) {
    return '两列都被映成零：整个平面塌到原点（rank=0）';
  }
  if (model.zeroCols.length === 1) {
    const index = model.zeroCols[0] ?? 0;
    return `col${index === 0 ? '₁' : '₂'} = (0, 0)：该列被映成零（rank=1）`;
  }
  if (model.collinear) return '两列共线，平面被压成一条线（rank=1）';
  return null;
}

/* -------------------------------------------------------------------------- */
/* 视图裁剪 / 文本测量 / 标注布局                                               */
/* -------------------------------------------------------------------------- */

export interface ScreenPoint {
  x: number;
  y: number;
  clipped: boolean;
}

export function clipFromOrigin(
  cs: CoordinateSystem,
  viewBox: [number, number],
  point: [number, number],
  pad = 14,
): ScreenPoint {
  const [ox, oy] = cs.origin;
  const dx = point[0] - ox;
  const dy = point[1] - oy;
  const limits: number[] = [1];
  if (dx > EPS) limits.push((viewBox[0] - pad - ox) / dx);
  else if (dx < -EPS) limits.push((pad - ox) / dx);
  if (dy > EPS) limits.push((viewBox[1] - pad - oy) / dy);
  else if (dy < -EPS) limits.push((pad - oy) / dy);
  const t = Math.max(0, Math.min(...limits));
  return { x: ox + dx * t, y: oy + dy * t, clipped: t < 0.999 };
}

export function measureText(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    if (/[\u4e00-\u9fff\uff00-\uffef]/.test(char)) width += 1;
    else if (char === ' ') width += 0.32;
    else if (/[0-9]/.test(char)) width += 0.58;
    else width += 0.58;
  }
  return width * fontSize;
}

export interface LabelBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type TextAnchor = 'start' | 'middle' | 'end';

export interface LabelRequest {
  id: string;
  text: string;
  fontSize: number;
  priority: number;
  tone: 'column' | 'basis' | 'input' | 'compose' | 'meta' | 'tick';
  anchor: TextAnchor;
  x: number;
  y: number;
  alternatives?: Array<{ x: number; y: number; anchor: TextAnchor }>;
}

export interface PlacedLabel {
  id: string;
  text: string;
  fontSize: number;
  priority: number;
  tone: LabelRequest['tone'];
  anchor: TextAnchor;
  x: number;
  y: number;
  hidden: boolean;
}

function boxOf(request: LabelRequest, x: number, y: number, anchor: TextAnchor): LabelBox {
  const width = measureText(request.text, request.fontSize) + 4;
  const height = request.fontSize * 1.32;
  const x1 = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
  return { x1, y1: y - height * 0.78, x2: x1 + width, y2: y + height * 0.22 };
}

function intersects(a: LabelBox, b: LabelBox, pad: number): boolean {
  return a.x1 < b.x2 + pad && a.x2 + pad > b.x1 && a.y1 < b.y2 + pad && a.y2 + pad > b.y1;
}

function shiftInside(box: LabelBox, width: number, height: number, pad: number): Vec2 {
  let dx = 0;
  let dy = 0;
  if (box.x1 < pad) dx = pad - box.x1;
  if (box.x2 + dx > width - pad) dx -= box.x2 + dx - (width - pad);
  if (box.y1 < pad) dy = pad - box.y1;
  if (box.y2 + dy > height - pad) dy -= box.y2 + dy - (height - pad);
  return [dx, dy];
}

/** 与 matrixEigen 相同的布局策略：优先级放置、换备选、必要时隐藏（刻度优先牺牲）。 */
export function layoutLabels(
  requests: LabelRequest[],
  viewBox: [number, number],
): PlacedLabel[] {
  const [width, height] = viewBox;
  const sorted = [...requests].sort((a, b) => a.priority - b.priority);
  const placed: LabelBox[] = [];
  const result: PlacedLabel[] = [];

  for (const request of sorted) {
    const positions = [
      { x: request.x, y: request.y, anchor: request.anchor },
      ...(request.alternatives ?? []),
    ];
    let chosen: { x: number; y: number; anchor: TextAnchor; box: LabelBox } | null = null;

    for (const position of positions) {
      const base = boxOf(request, position.x, position.y, position.anchor);
      const [dx, dy] = shiftInside(base, width, height, 10);
      const box: LabelBox = {
        x1: base.x1 + dx,
        y1: base.y1 + dy,
        x2: base.x2 + dx,
        y2: base.y2 + dy,
      };
      if (!placed.some((existing) => intersects(existing, box, 6))) {
        chosen = { x: position.x + dx, y: position.y + dy, anchor: position.anchor, box };
        break;
      }
    }

    if (chosen === null && request.priority <= 2) {
      const base = boxOf(request, request.x, request.y, request.anchor);
      const [dx, dy] = shiftInside(base, width, height, 10);
      chosen = {
        x: request.x + dx,
        y: request.y + dy,
        anchor: request.anchor,
        box: { x1: base.x1 + dx, y1: base.y1 + dy, x2: base.x2 + dx, y2: base.y2 + dy },
      };
    }

    if (chosen === null) {
      result.push({
        id: request.id,
        text: request.text,
        fontSize: request.fontSize,
        priority: request.priority,
        tone: request.tone,
        anchor: request.anchor,
        x: request.x,
        y: request.y,
        hidden: true,
      });
      continue;
    }

    placed.push(chosen.box);
    result.push({
      id: request.id,
      text: request.text,
      fontSize: request.fontSize,
      priority: request.priority,
      tone: request.tone,
      anchor: chosen.anchor,
      x: chosen.x,
      y: chosen.y,
      hidden: false,
    });
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* 刻度                                                                       */
/* -------------------------------------------------------------------------- */

export interface Tick {
  value: number;
  x: number;
  y: number;
  horizontal: boolean;
}

export function buildTicks(cs: CoordinateSystem, viewBox: [number, number], pad = 26): Tick[] {
  const [viewWidth, viewHeight] = viewBox;
  const [originX, originY] = cs.origin;
  const unit = cs.unit;
  const ticks: Tick[] = [];

  const xMin = Math.ceil((pad - originX) / unit);
  const xMax = Math.floor((viewWidth - pad - originX) / unit);
  for (let value = xMin; value <= xMax; value += 1) {
    if (value === 0) continue;
    ticks.push({ value, x: originX + value * unit, y: originY, horizontal: true });
  }

  const sign = cs.y_axis === 'up' ? -1 : 1;
  const yMin =
    sign < 0 ? Math.ceil((originY - (viewHeight - pad)) / unit) : Math.ceil((pad - originY) / unit);
  const yMax =
    sign < 0 ? Math.floor((originY - pad) / unit) : Math.floor((viewHeight - pad - originY) / unit);
  for (let value = yMin; value <= yMax; value += 1) {
    if (value === 0) continue;
    ticks.push({ value, x: originX, y: originY + sign * value * unit, horizontal: false });
  }

  return ticks;
}

/** 数字间距 < 28px 时隔一个画（§7.1）。 */
export function shouldSkipAlternateTicks(estimatedScreenGap: number, maxTextWidth: number, unit: number): boolean {
  if (estimatedScreenGap < 28) return true;
  return unit < maxTextWidth + 12;
}

/* -------------------------------------------------------------------------- */
/* 文字同步                                                                    */
/* -------------------------------------------------------------------------- */

export interface LinkedTextOutput {
  element_id: string;
  text: string;
  changed: boolean;
}

/** S9 的三行文字：e₁→col₁、e₂→col₂、v→A·v（参数偏离时全部标 changed）。 */
export function buildLinkedTexts(
  linkedTexts: LinkedText[],
  model: ColumnsModel,
  original: { matrix: Mat2; vector: Vec2 },
): LinkedTextOutput[] {
  const changed = isOffOriginal(
    { a11: model.matrix.a11, a12: model.matrix.a12, a21: model.matrix.a21, a22: model.matrix.a22, v1: model.vector[0], v2: model.vector[1] },
    { a11: original.matrix.a11, a12: original.matrix.a12, a21: original.matrix.a21, a22: original.matrix.a22, v1: original.vector[0], v2: original.vector[1] },
  );

  const rows: Array<{ x0: number; y0: number; x1: number; y1: number }> = [
    { x0: 1, y0: 0, x1: model.col1[0], y1: model.col1[1] },
    { x0: 0, y0: 1, x1: model.col2[0], y1: model.col2[1] },
    { x0: model.vector[0], y0: model.vector[1], x1: model.image[0], y1: model.image[1] },
  ];

  return linkedTexts.map((linked, index) => {
    const row = rows[index] ?? rows[2]!;
    const text = fillTemplate(linked.template, {
      x0: fmt(row.x0),
      y0: fmt(row.y0),
      x1: fmt(row.x1),
      y1: fmt(row.y1),
      v1: fmt(model.vector[0]),
      v2: fmt(model.vector[1]),
      a11: fmt(model.matrix.a11),
      a12: fmt(model.matrix.a12),
      a21: fmt(model.matrix.a21),
      a22: fmt(model.matrix.a22),
      rank: model.rank,
    });
    const annotated =
      linked.kind === 'hint' && changed
        ? `（原页为 A=[[${fmt(original.matrix.a11)}, ${fmt(original.matrix.a12)}], [${fmt(original.matrix.a21)}, ${fmt(original.matrix.a22)}]], v=${fmtVec(original.vector)} 时）${text}`
        : text;
    return { element_id: linked.element_id, text: annotated, changed };
  });
}
/* -------------------------------------------------------------------------- */
/* 自适应缩放（参数取极值时内容不越界）                                        */
/* -------------------------------------------------------------------------- */

export interface FitResult {
  scale: number;
  unit: number;
  scaled: boolean;
}

/**
 * 内容包围盒自检：内容（两列、v、两段组合、合向量）超出 viewBox 可用半径时等比缩小 `unit`，
 * 原点与 viewBox 不变，避免图形被裁掉一半。默认参数下返回 1。
 */
export function fitToViewBox(
  cs: CoordinateSystem,
  viewBox: [number, number],
  points: Vec2[],
  pad = 26,
): FitResult {
  const [originX, originY] = cs.origin;
  const [width, height] = viewBox;
  let maxRight = 0;
  let maxLeft = 0;
  let maxUp = 0;
  let maxDown = 0;
  for (const [x, y] of points) {
    if (x > maxRight) maxRight = x;
    if (-x > maxLeft) maxLeft = -x;
    const up = cs.y_axis === 'up' ? y : -y;
    const down = -up;
    if (up > maxUp) maxUp = up;
    if (down > maxDown) maxDown = down;
  }

  const limits: number[] = [1];
  const check = (need: number, available: number): void => {
    if (need * cs.unit > 1e-6 && available > 0) limits.push(available / (need * cs.unit));
  };
  check(maxRight, width - pad - originX);
  check(maxLeft, originX - pad);
  check(maxUp, originY - pad);
  check(maxDown, height - pad - originY);

  const raw = Math.min(...limits);
  const rounded = Math.round(Math.max(0.3, Math.min(1, raw)) * 1000) / 1000;
  return { scale: rounded, unit: cs.unit * rounded, scaled: rounded < 0.999 };
}
