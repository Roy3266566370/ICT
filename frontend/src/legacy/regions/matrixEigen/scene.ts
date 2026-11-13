/**
 * matrixEigen/scene.ts —— S6「三条向量，各去哪了」的纯计算与标注布局。
 *
 * 施工依据：docs/rebuild-spec.md §4（坐标/参数）、§7（视觉与线宽）、§7.1（标注防遮挡）。
 *
 * 分工：
 *  - 本文件只做数学、坐标投影、文本测量与标注布局，不含 React / DOM，可被 SSR 直接调用；
 *  - 渲染在 `MatrixEigenScene.tsx`，参数面板在 `RegionPanel.tsx`。
 *
 * 坐标：`RegionRendererProps.region.coordinate_system` 给出 viewBox / origin / unit / y 轴方向，
 * 数学坐标 → 像素一律走 `projectPoint`（R2 的 `@/regions/types`），保证宿主缩放只改容器尺寸。
 */
import type {
  LinkedTextRuntime,
  RegionCoordinateSystem,
  RegionLinkedText,
} from '@/regions/types';
import { fillTemplate } from './projection';

export type Vec2 = [number, number];

export interface Mat2 {
  a11: number;
  a12: number;
  a21: number;
  a22: number;
}

/** C-MX 同源的范围约定（滑块与数字输入共用） */
export const PARAM_MIN = -3;
export const PARAM_MAX = 3;
export const PARAM_STEP = 0.1;
export const EPS = 1e-9;

/** region 未给坐标时的兜底（与 prototype/s06.html 已验证的坐标一致） */
export const DEFAULT_CS: RegionCoordinateSystem = {
  view_box: [1920, 1350],
  origin: [640, 770],
  unit: 150,
  y_axis: 'up',
};

export const DEFAULT_MATRIX: Mat2 = { a11: 2, a12: 1, a21: 1, a22: 2 };
export const DEFAULT_VECTORS: Vec2[] = [
  [1, 0],
  [1, 1],
  [1, -1],
];

/* -------------------------------------------------------------------------- */
/* 参数读取                                                                   */
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

export function readVectors(params: Record<string, unknown>, fallback: Vec2[]): Vec2[] {
  const raw = params['vectors'];
  if (!Array.isArray(raw)) return fallback.map((v): Vec2 => [v[0], v[1]]);
  const count = Math.max(fallback.length, raw.length);
  const result: Vec2[] = [];
  for (let index = 0; index < count; index += 1) {
    const fb = fallback[index] ?? [0, 0];
    result.push(readVectorForIndex(raw, index, fb));
  }
  return result;
}

function readVectorForIndex(raw: unknown[], index: number, fallback: Vec2): Vec2 {
  const item = raw[index];
  return readVector(item, fallback);
}

/** 参数吸附：clamp 到 [-3, 3] 并按 0.1 步长取整；-0 归一为 0。 */
export function clampParam(value: number): number {
  const clamped = Math.min(PARAM_MAX, Math.max(PARAM_MIN, value));
  const snapped = Math.round(clamped / PARAM_STEP) * PARAM_STEP;
  const rounded = Math.round(snapped * 1e6) / 1e6;
  return Math.abs(rounded) <= EPS ? 0 : rounded;
}

export function clampVector(vector: Vec2): Vec2 {
  return [clampParam(vector[0]), clampParam(vector[1])];
}

export function isZeroVector(vector: Vec2): boolean {
  return Math.abs(vector[0]) <= EPS && Math.abs(vector[1]) <= EPS;
}

/* -------------------------------------------------------------------------- */
/* 线性代数                                                                   */
/* -------------------------------------------------------------------------- */

export function applyMatrix(matrix: Mat2, vector: Vec2): Vec2 {
  const { a11, a12, a21, a22 } = matrix;
  const x = a11 * vector[0] + a12 * vector[1];
  const y = a21 * vector[0] + a22 * vector[1];
  return [normalizeZero(x), normalizeZero(y)];
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

export function matrixDet(matrix: Mat2): number {
  return normalizeZero(matrix.a11 * matrix.a22 - matrix.a12 * matrix.a21);
}

export function matrixTrace(matrix: Mat2): number {
  return normalizeZero(matrix.a11 + matrix.a22);
}

export interface EigenSummary {
  det: number;
  trace: number;
  /** 实特征值（升序）；判别式 < 0 时为 null */
  values: [number, number] | null;
}

export function eigenSummary(matrix: Mat2): EigenSummary {
  const trace = matrixTrace(matrix);
  const det = matrixDet(matrix);
  const disc = trace * trace - 4 * det;
  if (disc < 0) return { det, trace, values: null };
  const root = Math.sqrt(disc);
  return {
    det,
    trace,
    values: [normalizeZero((trace - root) / 2), normalizeZero((trace + root) / 2)],
  };
}

/**
 * 若 `A·v` 与 `v` 共线，返回倍数 λ（可正可负）；否则返回 null。
 * 用于 ×λ 标注与「不动」判定（§7.1）。
 */
export function eigenScale(matrix: Mat2, vector: Vec2): number | null {
  if (isZeroVector(vector)) return null;
  const image = applyMatrix(matrix, vector);
  const cross = vector[0] * image[1] - vector[1] * image[0];
  const tolerance = 1e-7 * Math.max(1, Math.hypot(image[0], image[1]));
  if (Math.abs(cross) > tolerance) return null;
  const length2 = vector[0] * vector[0] + vector[1] * vector[1];
  const scale = (vector[0] * image[0] + vector[1] * image[1]) / length2;
  if (Math.abs(scale) < 1e-9) return null;
  return normalizeZero(scale);
}

/**
 * `A·v ≈ v`：原像与像完全重合（特征值 1 的特征向量）。
 * §7.1 要求此时只画一条线并合并标注，不得画两条重叠线。
 */
export function isFixedVector(matrix: Mat2, vector: Vec2): boolean {
  if (isZeroVector(vector)) return false;
  const image = applyMatrix(matrix, vector);
  return (
    Math.abs(image[0] - vector[0]) <= 1e-9 && Math.abs(image[1] - vector[1]) <= 1e-9
  );
}

/** 数值展示：最多 2 位小数，去掉尾随零（0.1 步长的参数不会出现长尾差）。 */
export function fmt(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 100) / 100;
  if (Math.abs(rounded) < 1e-9) return '0';
  const text = String(rounded);
  return text;
}

/** 带空格的坐标标注：原页写法 `(1, 0)`。 */
export function fmtVec(vector: Vec2): string {
  return `(${fmt(vector[0])}, ${fmt(vector[1])})`;
}

/** 矩阵标注：`[[2, 1], [1, 2]]`。 */
export function fmtMatrix(matrix: Mat2): string {
  return `[[${fmt(matrix.a11)}, ${fmt(matrix.a12)}], [${fmt(matrix.a21)}, ${fmt(matrix.a22)}]]`;
}

/* -------------------------------------------------------------------------- */
/* 坐标投影与裁剪                                                             */
/* -------------------------------------------------------------------------- */

export function project(cs: RegionCoordinateSystem, vector: Vec2): [number, number] {
  const px = cs.origin[0] + vector[0] * cs.unit;
  const py = cs.y_axis === 'up' ? cs.origin[1] - vector[1] * cs.unit : cs.origin[1] + vector[1] * cs.unit;
  return [px, py];
}

/** 屏幕像素 → 数学坐标（拖动端点用）。 */
export function unproject(cs: RegionCoordinateSystem, px: number, py: number): Vec2 {
  const x = (px - cs.origin[0]) / cs.unit;
  const y = cs.y_axis === 'up' ? (cs.origin[1] - py) / cs.unit : (py - cs.origin[1]) / cs.unit;
  return [x, y];
}

export interface ScreenPoint {
  x: number;
  y: number;
  clipped: boolean;
}

/**
 * 以原点为起点，把射线裁到 viewBox 内（留 pad）。
 * 参数取极端值时像向量可能远超画布，必须裁剪，否则会压到页面上其它文字（§7.1「不得出界」）。
 */
export function clipFromOrigin(
  cs: RegionCoordinateSystem,
  viewBox: [number, number],
  point: [number, number],
  pad = 12,
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
  const x = ox + dx * t;
  const y = oy + dy * t;
  return { x, y, clipped: t < 0.999 };
}

/** 逆时针 90° 的数学法向（单位长度）。用于「内侧/外侧」标注分区。 */
export function normalOf(vector: Vec2): Vec2 {
  const length = Math.hypot(vector[0], vector[1]);
  if (length <= EPS) return [0, 1];
  return [-vector[1] / length, vector[0] / length];
}

/* -------------------------------------------------------------------------- */
/* 文本测量与标注布局（§7.1）                                                 */
/* -------------------------------------------------------------------------- */

/**
 * SVG 文本宽度估算（不依赖 DOM，SSR 可用）。
 * 中文按 1 em，数字/字母按 0.58 em，标点按 0.5 em；偏保守，宁可多留白。
 */
export function measureText(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    if (/[\u4e00-\u9fff\uff00-\uffef]/.test(char)) width += 1;
    else if (char === ' ') width += 0.32;
    else if (/[0-9]/.test(char)) width += 0.58;
    else if (/[×·→=,]/.test(char)) width += 0.52;
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
  /** 数字越小越优先保留 */
  priority: number;
  /** 样式分组：决定颜色与描边 */
  tone: 'image' | 'ghost' | 'scale' | 'meta' | 'tick' | 'merged';
  anchor: TextAnchor;
  x: number;
  y: number;
  /** 首选位置冲突时依次尝试 */
  alternatives?: Array<{ x: number; y: number; anchor: TextAnchor }>;
}

export interface PlacedLabel extends Omit<LabelRequest, 'alternatives'> {
  x: number;
  y: number;
  anchor: TextAnchor;
  hidden: boolean;
}

function boxOf(label: LabelRequest, x: number, y: number, anchor: TextAnchor): LabelBox {
  const width = measureText(label.text, label.fontSize) + 4;
  const height = label.fontSize * 1.32;
  const x1 = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
  return { x1, y1: y - height * 0.78, x2: x1 + width, y2: y + height * 0.22 };
}

function intersects(a: LabelBox, b: LabelBox, pad: number): boolean {
  return (
    a.x1 < b.x2 + pad && a.x2 + pad > b.x1 && a.y1 < b.y2 + pad && a.y2 + pad > b.y1
  );
}

/** 把包围盒平移回 viewBox 内（不得出界）。 */
function shiftInside(box: LabelBox, width: number, height: number, pad: number): Vec2 {
  let dx = 0;
  let dy = 0;
  if (box.x1 < pad) dx = pad - box.x1;
  if (box.x2 + dx > width - pad) dx -= box.x2 + dx - (width - pad);
  if (box.y1 < pad) dy = pad - box.y1;
  if (box.y2 + dy > height - pad) dy -= box.y2 + dy - (height - pad);
  return [dx, dy];
}

/**
 * 标注布局：按优先级依次放置，冲突时换备选位置；仍冲突则隐藏（刻度数字最先牺牲）。
 * 核心标注（priority ≤ 2）最后兜底放在首选位置，宁可轻微重叠也不丢结果。
 */
export function layoutLabels(
  requests: LabelRequest[],
  viewBox: [number, number],
): PlacedLabel[] {
  const [viewWidth, viewHeight] = viewBox;
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
      const [dx, dy] = shiftInside(base, viewWidth, viewHeight, 10);
      const box: LabelBox = {
        x1: base.x1 + dx,
        y1: base.y1 + dy,
        x2: base.x2 + dx,
        y2: base.y2 + dy,
      };
      if (!placed.some((existing) => intersects(existing, box, 6))) {
        chosen = {
          x: position.x + dx,
          y: position.y + dy,
          anchor: position.anchor,
          box,
        };
        break;
      }
    }

    if (chosen === null && request.priority <= 2) {
      // 结果类标注不允许消失：放到首选位置并 clamp（可能轻微压边）
      const base = boxOf(request, request.x, request.y, request.anchor);
      const [dx, dy] = shiftInside(base, viewWidth, viewHeight, 10);
      chosen = {
        x: request.x + dx,
        y: request.y + dy,
        anchor: request.anchor,
        box: {
          x1: base.x1 + dx,
          y1: base.y1 + dy,
          x2: base.x2 + dx,
          y2: base.y2 + dy,
        },
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


/** 单位圆在矩阵作用下的像（椭圆）的屏幕点列。 */
export function ellipsePoints(
  matrix: Mat2,
  cs: RegionCoordinateSystem,
  samples = 180,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const count = Math.max(24, Math.floor(samples));
  for (let index = 0; index <= count; index += 1) {
    const theta = (index / count) * Math.PI * 2;
    const image = applyMatrix(matrix, [Math.cos(theta), Math.sin(theta)]);
    points.push(project(cs, image));
  }
  return points;
}

/** 椭圆 path（闭合多边形近似，180 段足够平滑且便于 SSR）。 */
export function ellipsePath(matrix: Mat2, cs: RegionCoordinateSystem, samples = 180): string {
  const points = ellipsePoints(matrix, cs, samples);
  if (points.length === 0) return '';
  const commands = points.map(
    (point, index) => `${index === 0 ? 'M' : 'L'}${point[0].toFixed(1)},${point[1].toFixed(1)}`,
  );
  return `${commands.join('')}Z`;
}

/* -------------------------------------------------------------------------- */
/* 刻度                                                                       */
/* -------------------------------------------------------------------------- */

export interface Tick {
  value: number;
  /** viewBox 像素 */
  x: number;
  y: number;
  /** true = x 轴刻度（数字在轴下方），false = y 轴刻度（数字在轴左侧） */
  horizontal: boolean;
}

export interface TickOptions {
  /** 相邻刻度在区域显示宽度下的近似像素间距；< 28 时隔一个画（§7.1） */
  estimatedScreenGap: number;
}

/** 只取落在 viewBox 内、且与原点不重合的整数刻度。 */
export function buildTicks(
  cs: RegionCoordinateSystem,
  viewBox: [number, number],
  pad = 8,
): Tick[] {
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

  // y_axis='up' 时 sy = originY - k*unit；'down' 时 sy = originY + k*unit
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

/** 刻度数字是否需要隔一个画：按显示缩放后的间距与文字宽度双重判断。 */
export function shouldSkipAlternateTicks(unit: number, maxTickTextWidth: number, options: TickOptions): boolean {
  if (options.estimatedScreenGap < 28) return true;
  return unit < maxTickTextWidth + 12;
}

/* -------------------------------------------------------------------------- */
/* 文字同步                                                                   */
/* -------------------------------------------------------------------------- */

/** 与宿主契约 LinkedTextRuntime 同形（element_id / text / changed）。 */
export type LinkedTextOutput = LinkedTextRuntime;

/** 阶段类型（宿主 props 里的 0|1|2，单独提出来便于子组件复用）。 */
export type RegionStage = 0 | 1 | 2;



/**
 * 按 `linked_texts` 的模板回传三行结果。
 * §8 第 3 类（只在原始条件下成立的说明）在参数偏离时前置原条件，避免冒充当前结论。
 */
export function buildLinkedTexts(
  linkedTexts: RegionLinkedText[],
  vectors: Vec2[],
  matrix: Mat2,
  original: { matrix: Mat2; vectors: Vec2[] },
): LinkedTextRuntime[] {
  const matrixChanged =
    Math.abs(matrix.a11 - original.matrix.a11) > 1e-9 ||
    Math.abs(matrix.a12 - original.matrix.a12) > 1e-9 ||
    Math.abs(matrix.a21 - original.matrix.a21) > 1e-9 ||
    Math.abs(matrix.a22 - original.matrix.a22) > 1e-9;

  return linkedTexts.map((linked, index) => {
    const fallbackVector = original.vectors[index] ?? [0, 0];
    const vector = vectors[index] ?? fallbackVector;
    const originalVector = original.vectors[index] ?? fallbackVector;
    const image = applyMatrix(matrix, vector);
    const text = fillTemplate(linked.template, {
      x0: fmt(vector[0]),
      y0: fmt(vector[1]),
      x1: fmt(image[0]),
      y1: fmt(image[1]),
      a11: fmt(matrix.a11),
      a12: fmt(matrix.a12),
      a21: fmt(matrix.a21),
      a22: fmt(matrix.a22),
      det: fmt(matrixDet(matrix)),
      trace: fmt(matrixTrace(matrix)),
    });
    const vectorChanged =
      Math.abs(vector[0] - originalVector[0]) > 1e-9 ||
      Math.abs(vector[1] - originalVector[1]) > 1e-9;
    const changed = matrixChanged || vectorChanged;
    const annotated =
      linked.kind === 'hint' && changed
        ? `（原页为 A=${fmtMatrix(original.matrix)} 时）${text}`
        : text;
    return { element_id: linked.element_id, text: annotated, changed };
  });
}
/* -------------------------------------------------------------------------- */
/* 自适应缩放（防止参数取极值时椭圆/向量被裁掉一半）                            */
/* -------------------------------------------------------------------------- */

/** 椭圆在**数学坐标**下的采样点（不含投影），用于内容包围盒自检。 */
export function ellipseMathPoints(matrix: Mat2, samples = 120): Vec2[] {
  const count = Math.max(24, Math.floor(samples));
  const points: Vec2[] = [];
  for (let index = 0; index <= count; index += 1) {
    const theta = (index / count) * Math.PI * 2;
    points.push(applyMatrix(matrix, [Math.cos(theta), Math.sin(theta)]));
  }
  return points;
}

export interface FitResult {
  /** 1 表示不缩放；< 1 表示内容超出区域、已等比缩小 */
  scale: number;
  /** 实际使用的 unit（像素/数学单位） */
  unit: number;
  /** 是否触发了自动缩放（用于界面提示） */
  scaled: boolean;
}

/**
 * 内容包围盒自检：仅当内容（椭圆 + 全部向量端点）超出 viewBox 可用半径时才等比缩小 `unit`，
 * 原点位置与 viewBox 不变，因此图形不会被裁掉一半（§7「所有标注不得出界」的延伸）。
 * 默认参数下返回 1，保持与原页一致的尺寸。
 */
export function fitToViewBox(
  cs: RegionCoordinateSystem,
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
  const scale = Math.max(0.3, Math.min(1, raw));
  const rounded = Math.round(scale * 1000) / 1000;
  return { scale: rounded, unit: cs.unit * rounded, scaled: rounded < 0.999 };
}
