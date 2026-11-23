/** ViewAST drag-handle 交互手柄坐标与参数值之间的纯函数映射工具。 */

export interface DragHandleSpec {
  type: 'drag-handle';
  id: string;
  targetNodeId?: string;
  label?: string;
  x: number;
  y: number;
  xParam?: string;
  yParam?: string;
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number };
  valueRange: { x?: [number, number]; y?: [number, number] };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function extractDragHandles(ast: Record<string, unknown>): DragHandleSpec[] {
  const interactions = ast.interactions;
  if (!Array.isArray(interactions)) return [];
  const handles: DragHandleSpec[] = [];
  for (const item of interactions) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    if (rec.type !== 'drag-handle' || typeof rec.id !== 'string') continue;
    if (typeof rec.x !== 'number' || typeof rec.y !== 'number') continue;
    const bounds = rec.bounds as Record<string, unknown> | undefined;
    const valueRange = rec.valueRange as Record<string, unknown> | undefined;
    if (!bounds || !valueRange) continue;
    if (
      typeof bounds.xMin !== 'number' ||
      typeof bounds.xMax !== 'number' ||
      typeof bounds.yMin !== 'number' ||
      typeof bounds.yMax !== 'number'
    ) {
      continue;
    }
    handles.push({
      type: 'drag-handle',
      id: rec.id,
      targetNodeId: typeof rec.targetNodeId === 'string' ? rec.targetNodeId : undefined,
      label: typeof rec.label === 'string' ? rec.label : undefined,
      x: rec.x,
      y: rec.y,
      xParam: typeof rec.xParam === 'string' ? rec.xParam : undefined,
      yParam: typeof rec.yParam === 'string' ? rec.yParam : undefined,
      bounds: {
        xMin: bounds.xMin,
        xMax: bounds.xMax,
        yMin: bounds.yMin,
        yMax: bounds.yMax,
      },
      valueRange: {
        x: Array.isArray(valueRange.x) && valueRange.x.length === 2 ? [Number(valueRange.x[0]), Number(valueRange.x[1])] : undefined,
        y: Array.isArray(valueRange.y) && valueRange.y.length === 2 ? [Number(valueRange.y[0]), Number(valueRange.y[1])] : undefined,
      },
    });
  }
  return handles;
}

/**
 * 将 SVG 画布坐标 (x, y) 映射回绑定参数值：
 * - x 轴从左到右单调递增（xMin -> valueRange.x[0], xMax -> valueRange.x[1]）；
 * - y 轴符合数学坐标系习惯，从下到上单调递增（yMax -> valueRange.y[0], yMin -> valueRange.y[1]）。
 */
export function mapDragPointToParams(handle: DragHandleSpec, x: number, y: number): Record<string, number> {
  const patch: Record<string, number> = {};
  if (handle.xParam && handle.valueRange.x && handle.bounds.xMax > handle.bounds.xMin) {
    const cx = clamp(x, handle.bounds.xMin, handle.bounds.xMax);
    const ratioX = (cx - handle.bounds.xMin) / (handle.bounds.xMax - handle.bounds.xMin);
    const [vMin, vMax] = handle.valueRange.x;
    patch[handle.xParam] = round4(vMin + ratioX * (vMax - vMin));
  }
  if (handle.yParam && handle.valueRange.y && handle.bounds.yMax > handle.bounds.yMin) {
    const cy = clamp(y, handle.bounds.yMin, handle.bounds.yMax);
    const ratioY = (handle.bounds.yMax - cy) / (handle.bounds.yMax - handle.bounds.yMin);
    const [vMin, vMax] = handle.valueRange.y;
    patch[handle.yParam] = round4(vMin + ratioY * (vMax - vMin));
  }
  return patch;
}
