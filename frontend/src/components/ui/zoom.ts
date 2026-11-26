export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

export function clampZoom(value: number, min = MIN_ZOOM, max = MAX_ZOOM): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value * 1000) / 1000));
}

export function stepZoom(value: number, delta: number, min = MIN_ZOOM, max = MAX_ZOOM): number {
  return clampZoom(value + delta, min, max);
}

export function wheelZoom(value: number, deltaY: number): number {
  return clampZoom(value * (deltaY < 0 ? 1.1 : 1 / 1.1));
}

export function fitZoom(
  viewport: {width: number; height: number},
  page: {width: number; height: number},
  padding = 40,
  min = MIN_ZOOM,
  max = MAX_ZOOM,
): number {
  const width = (viewport.width - padding) / page.width;
  const height = (viewport.height - padding) / page.height;
  const raw = Math.min(width, height);
  if (!Number.isFinite(raw)) return min;
  // 向下截断而非四舍五入，避免 page * fit + padding 超出视口 0.1~0.5px 触发滚动条震荡循环
  const floored = Math.floor(raw * 1000) / 1000;
  return Math.min(max, Math.max(min, floored));
}
