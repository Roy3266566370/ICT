/**
 * matrixOrder/geometry.ts —— 投影与自适应比例尺（rebuild-spec §5 / §7）。
 *
 * 宿主把组件放进 `bbox` 百分比定位的容器里，内部坐标必须与 `coordinate_system` 完全一致：
 *   x_px = origin.x + x·unit，y_px = origin.y − y·unit（y_axis='up'）。
 *
 * 但 `unit` 由后端产出，可能大于区域实际可用空间。因此这里以 region 的 unit 为**上界**，
 * 按"内容所需范围"等比收缩：既保持数学比例（1 单位对应的像素数唯一），又保证不出界。
 */
import type { RegionCoordinateSystem } from '@/regions/types';

export interface Projection {
  /** 实际采用的"1 数学单位 = 多少 SVG px"（≤ coordinate_system.unit） */
  unit: number;
  /** 数学坐标 → SVG 坐标 */
  point: (x: number, y: number) => [number, number];
  /** 区域可用半宽/半高（SVG px，已留边距） */
  halfWidth: number;
  halfHeight: number;
}

function roundPx(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * @param requiredHalfX 内容需要的数学半宽（含标注）
 * @param requiredHalfY 内容需要的数学半高（含标注）
 * @param marginRatio   reserve 的比例（默认 0.96，即四周留 4%）
 */
export function buildProjection(
  cs: RegionCoordinateSystem,
  requiredHalfX: number,
  requiredHalfY: number,
  marginRatio = 0.96,
): Projection {
  const [viewWidth, viewHeight] = cs.view_box;
  const [originX, originY] = cs.origin;

  const halfWidth = Math.max(1, Math.min(originX, viewWidth - originX) * marginRatio);
  const halfHeight = Math.max(1, Math.min(originY, viewHeight - originY) * marginRatio);
  const safeX = Math.max(requiredHalfX, 1e-6);
  const safeY = Math.max(requiredHalfY, 1e-6);

  const unit = Math.min(
    cs.unit > 0 ? cs.unit : 1,
    halfWidth / safeX,
    halfHeight / safeY,
  );

  const point = (x: number, y: number): [number, number] => {
    const px = originX + x * unit;
    const py = cs.y_axis === 'up' ? originY - y * unit : originY + y * unit;
    return [roundPx(px), roundPx(py)];
  };

  return { unit, point, halfWidth, halfHeight };
}

/** SVG 坐标下的线段端点（用于箭头）。 */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function segment(projection: Projection, from: [number, number], to: [number, number]): Segment {
  const [x1, y1] = projection.point(from[0], from[1]);
  const [x2, y2] = projection.point(to[0], to[1]);
  return { x1, y1, x2, y2 };
}

/**
 * 标注偏移：沿向量方向再外移 `offsetPx`，并按左右/上下选择 text-anchor，
 * 保证文字始终落在箭头外侧、不压在线上（spec §7.1）。
 */
export function labelAnchor(
  projection: Projection,
  origin: [number, number],
  end: [number, number],
  offsetPx = 12,
): { x: number; y: number; anchor: 'start' | 'middle' | 'end' } {
  const [ox, oy] = projection.point(origin[0], origin[1]);
  const [ex, ey] = projection.point(end[0], end[1]);
  const dx = ex - ox;
  const dy = ey - oy;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) {
    return { x: ex + offsetPx, y: ey - offsetPx, anchor: 'start' };
  }
  const ux = dx / length;
  const uy = dy / length;
  const x = ex + ux * offsetPx + (ux < -0.35 ? -4 : 4);
  const y = ey + uy * offsetPx + (uy < 0 ? -2 : 12);
  const anchor = ux > 0.35 ? 'start' : ux < -0.35 ? 'end' : 'middle';
  return { x: roundPx(x), y: roundPx(y), anchor };
}