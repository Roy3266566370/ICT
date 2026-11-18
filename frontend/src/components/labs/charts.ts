/** 实验室画布共用的小型 SVG 数学工具（不依赖第三方图表库）。 */

export interface Scale {
  (value: number): number;
}

export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (value: number) => r0 + ((value - d0) / span) * (r1 - r0);
}

/** linearScale 的逆映射：像素坐标 → 数据坐标。 */
export function invertLinearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = r1 - r0 || 1;
  return (pixel: number) => d0 + ((pixel - r0) / span) * (d1 - d0);
}

/** 把数值吸附到最近的步长；用于拖拽反推时避免 0.983742 这类灾难小数。 */
export function snapToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

export function niceTicks(min: number, max: number, count = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const span = max - min;
  const rough = span / Math.max(1, count);
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / power;
  const step = (normalized >= 7.5 ? 10 : normalized >= 3.5 ? 5 : normalized >= 1.5 ? 2 : 1) * power;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= max + step * 0.01; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return ticks;
}

export function formatTick(value: number): string {
  if (Math.abs(value) < 1e-10) return '0';
  const abs = Math.abs(value);
  if (abs >= 1000 || abs < 0.01) return value.toExponential(1).replace('e+', 'e');
  return Number(value.toFixed(2)).toString();
}

export function seriesPath(
  points: { x: number; y: number | null }[],
  scaleX: Scale,
  scaleY: Scale,
): string {
  let path = '';
  let drawing = false;
  for (const point of points) {
    if (point.y === null || !Number.isFinite(point.y)) {
      drawing = false;
      continue;
    }
    const x = scaleX(point.x);
    const y = scaleY(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      drawing = false;
      continue;
    }
    path += `${drawing ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
    drawing = true;
  }
  return path;
}

/**
 * 用 marching squares 提取等高线线段（数据坐标）。
 * 只用于 33×33 的教学网格；不追求出版级曲面，但线条来自真实目标函数。
 */
export function contourSegments(
  grid: { x: number[]; y: number[]; z: (number | null)[][] },
  level: number,
): [number, number, number, number][] {
  const segments: [number, number, number, number][] = [];
  const xs = grid.x;
  const ys = grid.y;
  const z = grid.z;
  const interpolate = (a: number, b: number, za: number, zb: number): number => {
    if (Math.abs(zb - za) < 1e-12) return (a + b) / 2;
    return a + ((level - za) / (zb - za)) * (b - a);
  };
  for (let row = 0; row < ys.length - 1; row += 1) {
    for (let column = 0; column < xs.length - 1; column += 1) {
      const x0 = xs[column]!;
      const x1 = xs[column + 1]!;
      const y0 = ys[row]!;
      const y1 = ys[row + 1]!;
      const z00 = z[row]?.[column];
      const z10 = z[row]?.[column + 1];
      const z11 = z[row + 1]?.[column + 1];
      const z01 = z[row + 1]?.[column];
      if (
        typeof z00 !== 'number' ||
        typeof z10 !== 'number' ||
        typeof z11 !== 'number' ||
        typeof z01 !== 'number'
      ) {
        continue;
      }
      const edges: [number, number][] = [];
      if ((z00 - level) * (z10 - level) < 0) edges.push([interpolate(x0, x1, z00, z10), y0]);
      if ((z10 - level) * (z11 - level) < 0) edges.push([x1, interpolate(y0, y1, z10, z11)]);
      if ((z11 - level) * (z01 - level) < 0) edges.push([interpolate(x1, x0, z11, z01), y1]);
      if ((z01 - level) * (z00 - level) < 0) edges.push([x0, interpolate(y1, y0, z01, z00)]);
      if (edges.length >= 2) {
        segments.push([edges[0]![0], edges[0]![1], edges[1]![0], edges[1]![1]]);
        if (edges.length === 4) {
          segments.push([edges[2]![0], edges[2]![1], edges[3]![0], edges[3]![1]]);
        }
      }
    }
  }
  return segments;
}

export function contourLevels(grid: { z: (number | null)[][] }, count = 7): number[] {
  const values = grid.z.flat().filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < 1e-12) return [min];
  return Array.from({ length: count }, (_, index) => min + ((max - min) * (index + 1)) / (count + 1));
}

export function normalize(value: number, min: number, max: number): number {
  if (max - min < 1e-12) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const bigint = Number.parseInt(normalized.length === 3 ? normalized.split('').map((item) => item + item).join('') : normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function clampBox(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
