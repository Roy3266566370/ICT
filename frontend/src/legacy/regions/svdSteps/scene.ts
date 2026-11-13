/**
 * svdSteps/scene.ts —— S14「SVD 三步：Vᵀ → Σ → U」的纯计算与标注布局。
 *
 * 施工依据：docs/rebuild-spec.md §4（区域 / 坐标）、§7（视觉与线宽）、§7.1（标注防遮挡）、
 * §9（S14：按 Vᵀ → Σ → U 播放，**保留标记点**；圆旋转外观不变，但标记点揭示第一步）。
 *
 * 分工：本文件不依赖 React / DOM，SSR 可直接调用；渲染与参数面板在 `index.tsx`。
 *
 * 数学：
 *  - `A = U Σ Vᵀ`；V 取 `AᵀA` 的特征向量（对称矩阵也有解析式，非对称同样成立）；
 *  - `σᵢ = |A·vᵢ|`，`uᵢ = A·vᵢ / σᵢ`（秩亏时退化，界面明确说明）；
 *  - 标记点 p0 依次经过 `Vᵀ`、`Σ`、`U`，最终位置必须等于 `A·p0`（本文件自校验）。
 *
 * 三步的形态（§9："圆旋转外观不变，但标记点揭示第一步"）：
 *  ① Vᵀ：单位圆外观不变，标记点从 (1,0) 转到 σ 轴方向；
 *  ② Σ ：沿两条坐标轴各自伸缩 σ1 / σ2（圆变椭圆，标记点随之移动）；
 *  ③ U ：椭圆整体转向输出方向（标记点落到 A·p0）。
 */
import type { RegionCoordinateSystem } from '@/regions/types';

export type Vec2 = [number, number];

export interface Mat2 {
  a11: number;
  a12: number;
  a21: number;
  a22: number;
}

export interface Point {
  x: number;
  y: number;
}

export const PARAM_MIN = -3;
export const PARAM_MAX = 3;
export const PARAM_STEP = 0.1;
export const EPS = 1e-9;

export const DEFAULT_CS: RegionCoordinateSystem = {
  view_box: [1920, 1350],
  origin: [640, 770],
  unit: 150,
  y_axis: 'up',
};

/**
 * 页内原矩阵：[[0, 1], [1, 1]]（黄金比矩阵）。
 * σ = (1.618…, 0.618…)，乘积 = det = 1 —— 与页内标注 "1.618 / 0.618" 一致。
 */
export const DEFAULT_MATRIX: Mat2 = { a11: 0, a12: 1, a21: 1, a22: 1 };

/** 标记点默认取单位圆上的 (1, 0)。 */
export const DEFAULT_MARKER: Vec2 = [1, 0];

/* -------------------------------------------------------------------------- */
/* 参数读取                                                                   */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function item(values: readonly unknown[], index: number): unknown {
  return index >= 0 && index < values.length ? values[index] : undefined;
}

function readFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readMatrixCandidate(value: unknown): Mat2 | null {
  if (Array.isArray(value)) {
    const rows: unknown[] = value;
    const row0 = item(rows, 0);
    const row1 = item(rows, 1);
    if (Array.isArray(row0) && Array.isArray(row1)) {
      const a11 = readFinite(item(row0, 0));
      const a12 = readFinite(item(row0, 1));
      const a21 = readFinite(item(row1, 0));
      const a22 = readFinite(item(row1, 1));
      if (a11 !== null && a12 !== null && a21 !== null && a22 !== null) {
        return { a11, a12, a21, a22 };
      }
    }
    return null;
  }
  if (isRecord(value)) {
    const record = value;
    if (['a11', 'a12', 'a21', 'a22'].every((key) => typeof record[key] === 'number')) {
      return {
        a11: num(record['a11'], 0),
        a12: num(record['a12'], 0),
        a21: num(record['a21'], 0),
        a22: num(record['a22'], 0),
      };
    }
  }
  return null;
}

function readVec2Of(value: unknown): Vec2 | null {
  if (!Array.isArray(value)) return null;
  const x = readFinite(item(value, 0));
  const y = readFinite(item(value, 1));
  return x !== null && y !== null ? [x, y] : null;
}

/** 读 `[σ1, σ2]`，按降序归一（SVD 约定 σ1 ≥ σ2 ≥ 0）。 */
function readSigmaPair(value: unknown): [number, number] | null {
  if (!Array.isArray(value)) return null;
  const first = readFinite(item(value, 0));
  const second = readFinite(item(value, 1));
  if (first === null || second === null) return null;
  const high = Math.max(Math.abs(first), Math.abs(second));
  const low = Math.min(Math.abs(first), Math.abs(second));
  return [high, low];
}

/** 读两列向量（region 里的 `u` / `v` 形状为 `[[x, y], [x, y]]`）。 */
function readVecPair(value: unknown): [Vec2, Vec2] | null {
  if (!Array.isArray(value)) return null;
  const first = readVec2Of(item(value, 0));
  const second = readVec2Of(item(value, 1));
  return first !== null && second !== null ? [first, second] : null;
}

function isIdentityPair(pair: [Vec2, Vec2]): boolean {
  const tol = 1e-6;
  const [first, second] = pair;
  return (
    Math.abs(first[0] - 1) < tol &&
    Math.abs(first[1]) < tol &&
    Math.abs(second[0]) < tol &&
    Math.abs(second[1] - 1) < tol
  );
}

/** `A = U Σ Vᵀ`：由 region 提供的 `sigma / u / v` 反推等价的 2×2 矩阵。 */
export function matrixFromSvd(sigma: [number, number], u: [Vec2, Vec2], v: [Vec2, Vec2]): Mat2 {
  const [s1, s2] = sigma;
  const [u1, u2] = u;
  const [v1, v2] = v;
  return {
    a11: s1 * u1[0] * v1[0] + s2 * u2[0] * v2[0],
    a12: s1 * u1[0] * v1[1] + s2 * u2[0] * v2[1],
    a21: s1 * u1[1] * v1[0] + s2 * u2[1] * v2[0],
    a22: s1 * u1[1] * v1[1] + s2 * u2[1] * v2[1],
  };
}

/**
 * 读取矩阵。优先级：
 * 1. `params.matrix` / `params.A`（二维数组或 `{a11..a22}`）；
 * 2. 扁平 `a11..a22`（参数抽屉写单个元素）；
 * 3. 真实产物 `{sigma, u, v, is_square}` → `A = U Σ Vᵀ`；
 *    若 `u`、`v` 都是单位阵（产物只给了伸缩信息、没有旋转），而 σ 与页内
 *    黄金比矩阵一致，则用黄金比矩阵，保证第一步 Vᵀ 真的旋转、标记点真的移动；
 * 4. 缺省 → `DEFAULT_MATRIX`。
 */
export function readMatrix(params: Record<string, unknown>, fallback: Mat2 = DEFAULT_MATRIX): Mat2 {
  const nested = readMatrixCandidate(params['matrix']) ?? readMatrixCandidate(params['A']);
  if (nested !== null) return nested;

  const flatKeys = ['a11', 'a12', 'a21', 'a22'] as const;
  if (flatKeys.some((key) => typeof params[key] === 'number')) {
    return {
      a11: num(params['a11'], fallback.a11),
      a12: num(params['a12'], fallback.a12),
      a21: num(params['a21'], fallback.a21),
      a22: num(params['a22'], fallback.a22),
    };
  }

  const sigma = readSigmaPair(params['sigma']);
  const u = readVecPair(params['u']);
  const v = readVecPair(params['v']);
  if (sigma !== null && u !== null && v !== null) {
    if (isIdentityPair(u) && isIdentityPair(v)) {
      const reference = decompSvd(fallback).sigma;
      const same =
        Math.abs(reference[0] - sigma[0]) <= 1e-3 && Math.abs(reference[1] - sigma[1]) <= 1e-3;
      if (same) return { ...fallback };
    }
    return matrixFromSvd(sigma, u, v);
  }

  return { ...fallback };
}

function readVec2(value: unknown, fallback: Vec2): Vec2 {
  if (Array.isArray(value)) {
    const values: unknown[] = value;
    const x = readFinite(item(values, 0));
    const y = readFinite(item(values, 1));
    if (x !== null && y !== null) return [x, y];
  }
  return [fallback[0], fallback[1]];
}

export function readCoordinateSystem(raw: unknown): RegionCoordinateSystem {
  if (!isRecord(raw)) {
    return { ...DEFAULT_CS, view_box: [...DEFAULT_CS.view_box], origin: [...DEFAULT_CS.origin] };
  }
  const viewBox = Array.isArray(raw['view_box']) ? raw['view_box'] : [];
  const origin = Array.isArray(raw['origin']) ? raw['origin'] : [];
  const width = num(item(viewBox, 0), DEFAULT_CS.view_box[0]);
  const height = num(item(viewBox, 1), DEFAULT_CS.view_box[1]);
  return {
    view_box: [width > 0 ? width : DEFAULT_CS.view_box[0], height > 0 ? height : DEFAULT_CS.view_box[1]],
    origin: [num(item(origin, 0), DEFAULT_CS.origin[0]), num(item(origin, 1), DEFAULT_CS.origin[1])],
    unit: num(raw['unit'], DEFAULT_CS.unit) > 0 ? num(raw['unit'], DEFAULT_CS.unit) : DEFAULT_CS.unit,
    y_axis: raw['y_axis'] === 'down' ? 'down' : 'up',
  };
}

/**
 * 当前实例负责第几幅子图（1 / 2 / 3）。
 *
 * S14 页内三段 bbox 依次为 `(0.75,1.21,3.54,2.23)` `(4.90,…)` `(9.04,…)`，
 * 若宿主为每段建一个 region，则按 bbox.x 推断；也接受参数显式指定 `panel`。
 */
export function readPanelIndex(
  params: Record<string, unknown>,
  bbox: { x: number; w: number; h: number },
): 1 | 2 | 3 {
  const raw = params['panel'] ?? params['panel_index'];
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 3) {
    return raw === 1 ? 1 : raw === 2 ? 2 : 3;
  }
  if (typeof raw === 'string' && ['1', '2', '3'].includes(raw)) {
    return raw === '2' ? 2 : raw === '3' ? 3 : 1;
  }
  if (bbox.x >= 6.9) return 3;
  if (bbox.x >= 2.8) return 2;
  return 1;
}

/**
 * 计算实际绘制的 viewBox 尺寸。
 *
 * 背景：`regions.json` 给 S14 的 `coordinate_system.view_box` 是 `[1920, 1350]`（6.67×4.69in
 * 的比例），但 S14 区域实际是 11.83×2.23in（约 5.3:1）。若照抄 1.42:1 的 viewBox，
 * `preserveAspectRatio="xMidYMid meet"` 会按高度缩放并左右留白，三格被压成中间一条，
 * 最右一格在视觉上"只剩边缘"。
 *
 * 处理：比例差超过约 1.28 倍时，保持 viewBox 宽度与 y 轴方向，按 bbox 比例修正高度
 * （宽幅时变成 1920×362），让三格铺满区域；比例接近时原样使用（如单段 3.54×2.23in）。
 */
export function fitViewBox(cs: RegionCoordinateSystem, bbox: { w: number; h: number }): [number, number] {
  const [width, height] = cs.view_box;
  if (!(width > 0) || !(height > 0)) return [width, height];
  if (!(bbox.w > 0) || !(bbox.h > 0)) return [width, height];
  const bboxRatio = bbox.w / bbox.h;
  const ratio = width / height;
  if (Math.abs(Math.log(bboxRatio / ratio)) < 0.25) return [width, height];
  const fitted = Math.round(width / bboxRatio);
  return [width, Math.min(height, Math.max(160, fitted))];
}

/** 宽高比 > 2.6 视为"一整块覆盖三段的宽幅区域"，此时组件内部并排画三幅。 */
export function isWideRegion(bbox: { w: number; h: number }): boolean {
  if (!(bbox.w > 0) || !(bbox.h > 0)) return false;
  return bbox.w / bbox.h > 2.6;
}

/* -------------------------------------------------------------------------- */
/* 数值与文本                                                                 */
/* -------------------------------------------------------------------------- */

export function fmt(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return '—';
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  if (Math.abs(rounded) < 1e-12) return '0';
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

export function vecText(vector: Vec2): string {
  return `(${fmt(vector[0])}, ${fmt(vector[1])})`;
}

export function isOffOriginal(current: Mat2, original: Mat2): boolean {
  const pairs: Array<[number, number]> = [
    [current.a11, original.a11],
    [current.a12, original.a12],
    [current.a21, original.a21],
    [current.a22, original.a22],
  ];
  return pairs.some(([left, right]) => Math.abs(left - right) > EPS);
}

export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, key: string) => {
    const replacement = values[key];
    return replacement === undefined ? whole : replacement;
  });
}

/* -------------------------------------------------------------------------- */
/* 线性代数                                                                   */
/* -------------------------------------------------------------------------- */

export function applyMatrix(matrix: Mat2, vector: Vec2): Vec2 {
  return [
    matrix.a11 * vector[0] + matrix.a12 * vector[1],
    matrix.a21 * vector[0] + matrix.a22 * vector[1],
  ];
}

function norm(vector: Vec2): number {
  return Math.hypot(vector[0], vector[1]);
}

function normalize(vector: Vec2, fallback: Vec2): Vec2 {
  const length = norm(vector);
  if (!(length > EPS)) return [fallback[0], fallback[1]];
  return [vector[0] / length, vector[1] / length];
}

export interface SvdDecomp {
  /** [σ1 ≥ σ2] */
  sigma: [number, number];
  /** V 的两列（v1 对应 σ1 的方向）。 */
  v: [Vec2, Vec2];
  /** U 的两列。 */
  u: [Vec2, Vec2];
  /** V 的旋转角（弧度）。 */
  thetaV: number;
  /** U 的旋转角（弧度）。 */
  thetaU: number;
  det: number;
  rank: 0 | 1 | 2;
  /** 秩为 2 时三步都可完整演示；否则第三步退化。 */
  valid: boolean;
  reason: string | null;
}

/**
 * 2×2 闭式 SVD（手写，不引第三方库）。
 * `thetaV = ½·atan2(2q, p − r)` 直接给出 `AᵀA` 最大特征值对应的特征向量方向。
 */
export function decompSvd(matrix: Mat2): SvdDecomp {
  const p = matrix.a11 * matrix.a11 + matrix.a21 * matrix.a21;
  const q = matrix.a11 * matrix.a12 + matrix.a21 * matrix.a22;
  const r = matrix.a12 * matrix.a12 + matrix.a22 * matrix.a22;
  const det = matrix.a11 * matrix.a22 - matrix.a12 * matrix.a21;

  const thetaV = 0.5 * Math.atan2(2 * q, p - r);
  const v1: Vec2 = [Math.cos(thetaV), Math.sin(thetaV)];
  const v2: Vec2 = [-Math.sin(thetaV), Math.cos(thetaV)];

  const av1 = applyMatrix(matrix, v1);
  const av2 = applyMatrix(matrix, v2);
  const s1 = norm(av1);
  const s2 = norm(av2);

  const rank: 0 | 1 | 2 = s2 > 1e-6 ? 2 : s1 > 1e-6 ? 1 : 0;
  const u1 = normalize(av1, [1, 0]);
  const u2 = normalize(av2, [-u1[1], u1[0]]);
  const thetaU = Math.atan2(u1[1], u1[0]);

  return {
    sigma: [s1, s2],
    v: [v1, v2],
    u: [u1, u2],
    thetaV,
    thetaU,
    det,
    rank,
    valid: rank === 2,
    reason:
      rank === 2
        ? null
        : '矩阵秩小于 2（σ₂ = 0）：第三步会把图形压扁成一条线段，仅完整演示前两步。',
  };
}

/* -------------------------------------------------------------------------- */
/* 三步形态                                                                   */
/* -------------------------------------------------------------------------- */

export interface SvdStageShape {
  index: 0 | 1 | 2;
  /** 例如 `① Vᵀ` */
  badge: string;
  /** 例如 `先转置坐标系` */
  title: string;
  /** 该阶段的一句话说明（页内原文语义）。 */
  detail: string;
  /** 标记点在该阶段的数学位置。 */
  marker: Vec2;
  /** 该阶段的图形：单位圆或椭圆（半轴 + 旋转角）。 */
  shape: { a: number; b: number; angle: number; circle: boolean };
}

/**
 * 生成三阶段。
 * 标记点严格按三步推进：`Vᵀ p0` → `Σ(Vᵀ p0)` → `U(Σ Vᵀ p0) = A p0`。
 */
export function buildStages(
  decomposition: SvdDecomp,
  marker: Vec2 = DEFAULT_MARKER,
): [SvdStageShape, SvdStageShape, SvdStageShape] {
  const { sigma, v, u, thetaU } = decomposition;
  const [v1, v2] = v;
  const [u1, u2] = u;
  const [s1, s2] = sigma;

  const p0: Vec2 = [marker[0], marker[1]];
  // ① Vᵀ p0 = (v1·p0, v2·p0)
  const p1: Vec2 = [v1[0] * p0[0] + v1[1] * p0[1], v2[0] * p0[0] + v2[1] * p0[1]];
  // ② Σ p1 = (σ1·p1x, σ2·p1y)
  const p2: Vec2 = [s1 * p1[0], s2 * p1[1]];
  // ③ U p2 = u1·p2x + u2·p2y（等于 A·p0）
  const p3: Vec2 = [u1[0] * p2[0] + u2[0] * p2[1], u1[1] * p2[0] + u2[1] * p2[1]];

  return [
    {
      index: 0,
      badge: '① Vᵀ',
      title: '先转置',
      detail: '圆不变，只有标记点离开 (1, 0)',
      marker: p1,
      shape: { a: 1, b: 1, angle: 0, circle: true },
    },
    {
      index: 1,
      badge: '② Σ',
      title: '沿轴伸缩',
      detail: `横向 ×${fmt(s1)}、纵向 ×${fmt(s2)}`,
      marker: p2,
      shape: { a: s1, b: s2, angle: 0, circle: false },
    },
    {
      index: 2,
      badge: '③ U',
      title: '转向输出',
      detail: '椭圆转向 A 的输出方向',
      marker: p3,
      shape: { a: s1, b: s2, angle: thetaU, circle: false },
    },
  ];
}

/** 自校验：第三步标记点必须等于 `A·p0`（容差 1e-6），用于测试与调试。 */
export function markerMatchesImage(matrix: Mat2, marker: Vec2, stages: readonly SvdStageShape[]): boolean {
  const last = stages[2];
  if (last === undefined) return false;
  const image = applyMatrix(matrix, marker);
  return Math.abs(last.marker[0] - image[0]) <= 1e-6 && Math.abs(last.marker[1] - image[1]) <= 1e-6;
}

/* -------------------------------------------------------------------------- */
/* 几何布局                                                                   */
/* -------------------------------------------------------------------------- */

export interface SvdGeometry {
  cx: number;
  cy: number;
  unit: number;
  /** 轴半宽 / 向上、向下的可用像素长度。 */
  axisHalf: number;
  axisUp: number;
  axisDown: number;
}

export function project(geometry: SvdGeometry, yAxis: 'up' | 'down', point: Vec2): Point {
  const sign = yAxis === 'up' ? -1 : 1;
  return {
    x: geometry.cx + point[0] * geometry.unit,
    y: geometry.cy + sign * point[1] * geometry.unit,
  };
}

/**
 * 子图几何。
 * - 单幅（宿主为每段建 region）：占满 bbox；
 * - 三联（宽幅 region）：三等分并排，三幅共用同一 unit，保证形态可比。
 * `unit` 由最大半轴反推，确保任何参数下都不出 viewBox。
 */
export function buildGeometries(
  mode: 'single' | 'triple',
  cs: RegionCoordinateSystem,
  maxAbs: number,
): SvdGeometry[] {
  const [width, height] = cs.view_box;
  const safeMax = Math.max(0.4, maxAbs);
  const cy = height * 0.5;
  if (mode === 'triple') {
    // 三格等宽：每格 width/3，格与格之间留 24 逻辑像素
    const halfWidth = Math.min(width / 6 - 12, 320);
    const halfHeight = height * 0.3;
    const unit = Math.min(halfWidth, halfHeight) / safeMax;
    const centers = [width / 6, width / 2, (width * 5) / 6];
    return centers.map((cx) => ({
      cx,
      cy,
      unit,
      axisHalf: halfWidth,
      axisUp: halfHeight,
      axisDown: halfHeight,
    }));
  }
  const axisHalf = Math.min(width * 0.29, 620);
  const axisUp = height * 0.3;
  const axisDown = height * 0.26;
  const unit = Math.min(axisHalf, axisUp, axisDown) / safeMax;
  return [
    {
      cx: width / 2,
      cy,
      unit,
      axisHalf,
      axisUp,
      axisDown,
    },
  ];
}

/** 椭圆（可旋转）采样路径；`unit` 决定 1 个数学单位的像素数。 */
export function ellipsePath(
  geometry: SvdGeometry,
  yAxis: 'up' | 'down',
  semiA: number,
  semiB: number,
  angle: number,
  samples = 96,
): string {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const sign = yAxis === 'up' ? -1 : 1;
  const parts: string[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const t = (index / samples) * Math.PI * 2;
    const localX = semiA * Math.cos(t);
    const localY = semiB * Math.sin(t);
    const x = localX * cos - localY * sin;
    const y = localX * sin + localY * cos;
    const px = geometry.cx + x * geometry.unit;
    const py = geometry.cy + sign * y * geometry.unit;
    parts.push(`${px.toFixed(2)},${py.toFixed(2)}`);
  }
  return `M${parts.join('L')}Z`;
}

/* -------------------------------------------------------------------------- */
/* 标注布局（与 matrixOrder 同一套规则，spec §7.1）                            */
/* -------------------------------------------------------------------------- */

export interface LabelItem {
  id: string;
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  fontSize: number;
  fill: string;
  weight: number;
}

interface LabelBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function textWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    units += /[\u2e80-\u9fff\uff00-\uffef]/.test(char) ? 1 : 0.56;
  }
  return units * fontSize;
}

function boxOf(label: LabelItem): LabelBox {
  const width = textWidth(label.text, label.fontSize);
  const height = label.fontSize * 1.2;
  const left =
    label.anchor === 'start' ? label.x : label.anchor === 'end' ? label.x - width : label.x - width / 2;
  return { left, right: left + width, top: label.y - label.fontSize, bottom: label.y - label.fontSize + height };
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function resolveLabelCollisions(
  labels: readonly LabelItem[],
  viewBox: [number, number],
): LabelItem[] {
  const [width, height] = viewBox;
  const margin = 10;
  const offsets: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [0, -30],
    [0, 30],
    [0, -60],
    [0, 60],
    [0, -90],
    [0, 90],
  ];
  const placed: LabelBox[] = [];
  const result: LabelItem[] = [];
  for (const label of labels) {
    const anchorWidth = textWidth(label.text, label.fontSize);
    const half = label.anchor === 'middle' ? anchorWidth / 2 : 0;
    const minX = margin + (label.anchor === 'end' ? anchorWidth : half);
    const maxX = width - margin - (label.anchor === 'start' ? anchorWidth : half);
    let best: LabelItem | null = null;
    for (const [dx, dy] of offsets) {
      const candidate: LabelItem = {
        ...label,
        x: Math.min(Math.max(label.x + dx, minX), Math.max(minX, maxX)),
        y: Math.min(Math.max(label.y + dy, label.fontSize + margin), height - margin),
      };
      const box = boxOf(candidate);
      if (!placed.some((other) => overlaps(box, other))) {
        best = candidate;
        break;
      }
    }
    const finalLabel = best ?? {
      ...label,
      x: Math.min(Math.max(label.x, minX), Math.max(minX, maxX)),
      y: Math.min(Math.max(label.y, label.fontSize + margin), height - margin),
    };
    placed.push(boxOf(finalLabel));
    result.push(finalLabel);
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* 原位文字                                                                   */
/* -------------------------------------------------------------------------- */

export interface LinkedTextDraft {
  element_id: string;
  text: string;
  changed: boolean;
}

export interface LinkedTextInput {
  element_id: string;
  template: string;
  kind: 'result' | 'hint';
}

/**
 * 生成原位文字：把页内的 "1.618 与 0.618" 换成当前奇异值（§8）。
 * 模板含 `{sigma1}` / `{sigma2}` / `{sigma_product}` / `{det}` 时按占位符代入，
 * 否则回传统一的 `${σ1} 与 ${σ2}` 文案。
 */
export function buildLinkedTexts(
  linkedTexts: readonly LinkedTextInput[],
  decomposition: SvdDecomp,
  changed: boolean,
): LinkedTextDraft[] {
  const [s1, s2] = decomposition.sigma;
  const values: Record<string, string> = {
    sigma1: fmt(s1),
    sigma2: fmt(s2),
    s1: fmt(s1),
    s2: fmt(s2),
    sigma_product: fmt(s1 * s2),
    product: fmt(s1 * s2),
    det: fmt(Math.abs(decomposition.det)),
  };
  const fallbackText = `${fmt(s1)} 与 ${fmt(s2)}`;
  const placeholderPattern = /\{(sigma1|sigma2|s1|s2|sigma_product|product|det)\}/;
  const resultElements = linkedTexts.filter((entry) => entry.kind === 'result');
  if (resultElements.length === 0) {
    return [{ element_id: 's14_singular_values', text: fallbackText, changed }];
  }
  return resultElements.map((element) => {
    const filled = placeholderPattern.test(element.template)
      ? fillTemplate(element.template, values)
      : fallbackText;
    return {
      element_id: element.element_id,
      text: filled.includes('{') ? fallbackText : filled,
      changed,
    };
  });
}