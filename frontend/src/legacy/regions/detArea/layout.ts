/**
 * det_area_2d 的版式计算（纯函数，供 SSR 自检与组件共用）。
 *
 * 关键约束（spec §5）：
 *  - 动态层 SVG 的 viewBox 由 `coordinate_system.view_box` 决定；
 *  - 缩放只改容器尺寸，内部坐标不变，因此所有几何都按 viewBox 尺寸推导；
 *  - 四格与单格（`params.cell`）共用同一套布局函数，避免两套真相。
 */
import type { RegionCoordinateSystem } from '@/regions/types';
import type { CellId } from './model';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 数学可视范围：四格统一，保证"同一把尺子"比较不同情形。 */
export const MATH_BOUNDS = {
  xMin: -2.2,
  xMax: 3.2,
  yMin: -1.2,
  yMax: 3.2,
} as const;

export const MATH_WIDTH = MATH_BOUNDS.xMax - MATH_BOUNDS.xMin;
export const MATH_HEIGHT = MATH_BOUNDS.yMax - MATH_BOUNDS.yMin;

export interface CellLayout {
  id: CellId;
  /** 整格（含底部说明带） */
  cell: Rect;
  /** 绘图区（轴 / 方格 / 像） */
  plot: Rect;
  /** 数学原点 (0,0) 对应的 viewBox 像素 */
  origin: [number, number];
  /** 1 数学单位 = 多少 viewBox 像素 */
  unit: number;
  /** 视觉缩放：1 = 1920px 宽的设计尺度 */
  scale: number;
  /** 轴与像的线宽 */
  strokeWidth: number;
  axisWidth: number;
  dashedWidth: number;
  dashArray: string;
  /** 字号 */
  tickFont: number;
  labelFont: number;
  areaFont: number;
  /** 底部说明带起点 y */
  labelTop: number;
}

export interface LayoutResult {
  cells: CellLayout[];
  /** x 轴上要画的整数刻度（已按间距去重） */
  xTicks: number[];
  yTicks: number[];
  crossTickSize: number;
  tickFont: number;
  scale: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** viewBox → 每格矩形。count=4 走 2×2；count=1 走整块。 */
export function computeCellRects(viewBox: [number, number], count: number): Rect[] {
  const [vbW, vbH] = viewBox;
  const pad = Math.min(vbW, vbH) * 0.03;
  if (count <= 1) {
    return [
      {
        x: pad,
        y: pad,
        w: Math.max(1, vbW - pad * 2),
        h: Math.max(1, vbH - pad * 2),
      },
    ];
  }
  const gapX = vbW * 0.035;
  const gapY = vbH * 0.055;
  const cellW = Math.max(1, (vbW - pad * 2 - gapX) / 2);
  const cellH = Math.max(1, (vbH - pad * 2 - gapY) / 2);
  return [
    { x: pad, y: pad, w: cellW, h: cellH },
    { x: pad + cellW + gapX, y: pad, w: cellW, h: cellH },
    { x: pad, y: pad + cellH + gapY, w: cellW, h: cellH },
    { x: pad + cellW + gapX, y: pad + cellH + gapY, w: cellW, h: cellH },
  ];
}

/** 单格内部绘图区与原点。labelBand 给"面积 / 定向 / 退化说明"三行留位。 */
function computeCellLayout(id: CellId, cell: Rect, scale: number): CellLayout {
  const labelBand = cell.h * 0.30;
  const plot: Rect = {
    x: cell.x + cell.w * 0.05,
    y: cell.y + cell.h * 0.035,
    w: cell.w * 0.9,
    h: Math.max(1, cell.h - labelBand - cell.h * 0.05),
  };
  const unit = Math.min(plot.w / MATH_WIDTH, plot.h / MATH_HEIGHT);
  const usedW = unit * MATH_WIDTH;
  const usedH = unit * MATH_HEIGHT;
  const offsetX = plot.x + (plot.w - usedW) / 2;
  const offsetY = plot.y + (plot.h - usedH) / 2;
  const origin: [number, number] = [
    offsetX + (0 - MATH_BOUNDS.xMin) * unit,
    offsetY + (MATH_BOUNDS.yMax - 0) * unit,
  ];
  return {
    id,
    cell,
    plot,
    origin,
    unit,
    scale,
    // spec §7：像/原像 3.2、轴 1.8、原像虚线 9 8（1920px 设计尺度）
    strokeWidth: 3.2 * scale,
    axisWidth: 1.8 * scale,
    dashedWidth: 3.2 * scale,
    dashArray: `${(9 * scale).toFixed(2)} ${(8 * scale).toFixed(2)}`,
    tickFont: Math.max(6, 20 * scale),
    labelFont: Math.max(6, 26 * scale),
    areaFont: Math.max(8, Math.min(25 * scale, cell.w / 13)),
    labelTop: cell.y + cell.h - labelBand + labelBand * 0.28,
  };
}

/**
 * 生成布局。
 * @param cs 区域坐标系（只用 view_box 与 y_axis）
 * @param ids 需要渲染的格（四格或单格）
 */
export function computeLayout(cs: RegionCoordinateSystem, ids: CellId[]): LayoutResult {
  const viewBox: [number, number] = [
    Number.isFinite(cs.view_box[0]) && cs.view_box[0] > 0 ? cs.view_box[0] : 960,
    Number.isFinite(cs.view_box[1]) && cs.view_box[1] > 0 ? cs.view_box[1] : 640,
  ];
  const scale = clamp(viewBox[0] / 1920, 0.25, 2.5);
  const rects = computeCellRects(viewBox, ids.length);
  const cells: CellLayout[] = [];
  ids.forEach((id, index) => {
    const rect = rects[index];
    if (rect === undefined) return;
    cells.push(computeCellLayout(id, rect, scale));
  });

  const sample = cells[0];
  const unit = sample?.unit ?? 1;
  const tickFont = sample?.tickFont ?? 8;
  // spec §7.1：刻度间距 < 28px 时隔一个画，避免数字重叠
  const step = unit * scale < 28 ? 2 : 1;
  const xTicks: number[] = [];
  const yTicks: number[] = [];
  for (let x = Math.ceil(MATH_BOUNDS.xMin); x <= Math.floor(MATH_BOUNDS.xMax); x += 1) {
    if (x === 0) continue;
    if (Math.abs(x) % step === 0) xTicks.push(x);
  }
  for (let y = Math.ceil(MATH_BOUNDS.yMin); y <= Math.floor(MATH_BOUNDS.yMax); y += 1) {
    if (y === 0) continue;
    if (Math.abs(y) % step === 0) yTicks.push(y);
  }
  return {
    cells,
    xTicks,
    yTicks,
    crossTickSize: Math.max(2, unit * 0.09),
    tickFont,
    scale,
  };
}

/** 数学坐标 → viewBox 像素（y 轴向上时取负）。 */
export function project(layout: CellLayout, x: number, y: number): [number, number] {
  return [layout.origin[0] + x * layout.unit, layout.origin[1] - y * layout.unit];
}

/** 数学坐标 → SVG 字符串点集（如平行四边形）。 */
export function toPath(points: Array<[number, number]>, layout: CellLayout): string {
  return points
    .map(([x, y], index) => {
      const [px, py] = project(layout, x, y);
      return `${index === 0 ? 'M' : 'L'}${px.toFixed(2)},${py.toFixed(2)}`;
    })
    .join(' ')
    .concat(' Z');
}

/** 数值文本（保留一位小数，去掉浮点噪声）。 */
export function formatPoint(x: number, y: number): string {
  return `(${x.toFixed(1)}, ${y.toFixed(1)})`;
}