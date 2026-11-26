import { compileFunction2d, type Function2dValue } from './calculus.ts';

/** Midpoint cells on concentric rings, including the polar area weight. */
export function* polarRings(radius: number, radial: number, angular: number) {
  const dr = radius / radial, dtheta = 2 * Math.PI / angular;
  for (let i = 0; i < radial; i++) {
    const r = (i + 0.5) * dr;
    yield Array.from({ length: angular }, (_, j) => {
      const theta = (j + 0.5) * dtheta;
      return { x: r * Math.cos(theta), y: r * Math.sin(theta), weight: r * dr * dtheta, drdtheta: dr * dtheta };
    });
  }
}

export function diskGrid<T>(radius: number, size: number, sample: (x: number, y: number) => T) {
  return Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => {
    const x = radius * (2*j/(size-1) - 1), y = radius * (1 - 2*i/(size-1));
    return { x, y, value: Math.hypot(x, y) <= radius * (1 + 1e-12) ? sample(x, y) : null };
  }));
}

function densitySamples(value: Function2dValue) {
  try {
    const f = compileFunction2d(value);
    const read = (x: number, y: number) => {
      const density = f(x, y);
      if (density === null || !Number.isFinite(density)) throw new Error('单位圆盘中的采样点存在无定义的密度。');
      return density;
    };
    let mass = 0, mx = 0, my = 0, withoutJacobian = 0;
    const grid = diskGrid(1, 17, read).map(row => row.map(({ value }) => value));
    let negative = grid.some(row => row.some(v => v !== null && v < 0));
    for (const ring of polarRings(1, 40, 64)) {
      for (const { x, y, weight, drdtheta } of ring) {
        const density = read(x, y);
        const amount = density * weight;
        negative ||= density < 0;
        mass += amount;
        mx += x * amount;
        my += y * amount;
        withoutJacobian += density * drdtheta;
      }
    }
    if (![mass, mx, my, withoutJacobian].every(Number.isFinite)) throw new Error('积分数值超出范围。');
    const hasCentroid = !negative && mass > 0;
    return { mass, withoutJacobian, grid, negative, cx: hasCentroid ? mx / mass : null, cy: hasCentroid ? my / mass : null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : '密度采样失败。' };
  }
}

let densityCache: { key: string; samples: ReturnType<typeof densitySamples> } | undefined;

export function sampleDiskDensity(value: Function2dValue) {
  const key = JSON.stringify(value);
  if (densityCache?.key !== key) densityCache = { key, samples: densitySamples(value) };
  return densityCache.samples;
}
