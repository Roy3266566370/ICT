/**
 * matrixEigen/projection.ts —— 区域动态组件的纯函数工具（SSR 安全，不依赖 DOM）。
 *
 * 为什么放在 region 目录而不是 `@/regions/types`：
 * `regions/types.ts` 是 R2 冻结的**类型契约**（rebuild-spec §5），本次任务不允许修改它，
 * 因此把 `projectPoint / fillTemplate / isOffOriginal` 三个实现放在组件自己的目录内，
 * 由 `scene.ts` 与本目录其它文件统一 import；`matrixColumns` 复用同名语义的本地副本，
 * 避免两套 region 并行开发时互相覆盖同一文件。
 */
import type { RegionCoordinateSystem } from '@/regions/types';

/**
 * 数学坐标 → SVG 像素坐标（spec §5：`x = origin.x + x*unit`，`y_axis='up'` 时 `y = origin.y - y*unit`）。
 * 宿主缩放只改容器尺寸、不改本函数结果，因此动态层与底图始终共用一套变换。
 */
export function projectPoint(
  cs: RegionCoordinateSystem,
  x: number,
  y: number,
): [number, number] {
  const px = cs.origin[0] + x * cs.unit;
  const py = cs.y_axis === 'up' ? cs.origin[1] - y * cs.unit : cs.origin[1] + y * cs.unit;
  return [roundPx(px), roundPx(py)];
}

/** 保留 3 位小数，避免 SSR 与浏览器出现 `640.0000000000001` 这类无意义尾差。 */
function roundPx(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * 用数值填充模板占位符（`{x0}` 等），spec §8。
 * 未提供的占位符**原样保留**——宿主据"是否仍含 `{`"决定不覆盖原页文字。
 */
export function fillTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match: string, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

/**
 * 当前参数是否偏离 `original_params`。
 *
 * 逐字段比较：数字按 `epsilon` 容差；数组逐项递归；其余用 JSON 序列化作稳定比较
 * （参数都是标量/数组，不做深对象 diff）。仅用于 `changed` 标记，不参与渲染计算。
 */
export function isOffOriginal(
  params: Record<string, unknown>,
  original: Record<string, unknown>,
  epsilon = 1e-9,
): boolean {
  const keys = new Set<string>([...Object.keys(params), ...Object.keys(original)]);
  for (const key of keys) {
    if (!isSameValue(params[key], original[key], epsilon)) return true;
  }
  return false;
}

function isSameValue(a: unknown, b: unknown, epsilon: number): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return Math.abs(a - b) <= epsilon;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!isSameValue(a[index], b[index], epsilon)) return false;
    }
    return true;
  }
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === 'object' && typeof b === 'object') {
    return stableJson(a) === stableJson(b);
  }
  return false;
}

function stableJson(value: object): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}