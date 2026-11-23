import { clamp, compileExpression } from './expr.ts';

export type WalkthroughParameterId = 'h' | 'n';
export type WalkthroughVerificationStatus = 'verified' | 'unverified';

export interface WalkthroughGeometry {
  family: 'sphere' | 'hemisphere' | 'cylinder' | 'cone' | 'paraboloid';
  scale: number;
  lower: number;
  upper: number;
  radius_squared: string;
  density: string;
  density_tex: string;
  primitive: string;
  exact_tex: string;
  field_tex: string;
  field?: string[];
  orientation: 1 | -1;
}

export interface WalkthroughParameter {
  id: WalkthroughParameterId;
  label: string;
  min: number;
  max: number;
  default: number;
  source: 'teaching' | 'problem';
}

export interface WalkthroughStep {
  id: string;
  title: string;
  explain: string;
  controls: WalkthroughParameterId[];
  view: { kind: 'primitive'; name: 'slice_bands' | 'cumulative_chart' };
  formulas: { tex: string; check?: string }[];
  checkpoint?: { type: 'predict'; prompt: string; options: string[]; answer: number };
  final?: boolean;
}

export interface Walkthrough {
  version: 1;
  pattern: 'slice_accumulate';
  strategy: { why: string; alternatives: string[] };
  source: 'authored' | 'model';
  geometry: WalkthroughGeometry;
  params: WalkthroughParameter[];
  steps: WalkthroughStep[];
  verification: {
    engine: 'sympy';
    status: WalkthroughVerificationStatus;
    checks: { id: string; status: WalkthroughVerificationStatus; detail?: string }[];
  };
  conditions_source: 'problem' | 'model';
}

export interface SliceBand {
  index: number;
  lower: number;
  upper: number;
  midpoint: number;
  density: number;
  contribution: number;
  cumulative: number;
}

export interface SlicePoint {
  z: number;
  value: number;
}

export interface SurfacePoint {
  x: number;
  y: number;
  z: number;
}

export function createSliceModel(geometry: WalkthroughGeometry) {
  const { lower, upper, scale } = geometry;
  const span = upper - lower;
  if (!Number.isFinite(span) || span <= 0 || !Number.isFinite(scale) || scale <= 0) return null;

  try {
    const radiusExpr = compileExpression(geometry.radius_squared, ['z']);
    const densityExpr = compileExpression(geometry.density, ['z']);
    const primitive = compileExpression(geometry.primitive, ['z']);
    const field = geometry.field?.length === 3
      ? geometry.field.map((expression) => compileExpression(expression, ['x', 'y', 'z']))
      : undefined;
    const base = primitive.eval({ z: lower });
    const radius = (z: number): number => Math.sqrt(Math.max(0, radiusExpr.evalOrNull({ z }) ?? 0));
    const exact = (z: number): number => primitive.eval({ z }) - base;
    const exactPoints: SlicePoint[] = Array.from({ length: 97 }, (_, index) => {
      const z = lower + (index / 96) * span;
      radiusExpr.eval({ z });
      const value = exact(z);
      if (!Number.isFinite(value)) throw new RangeError('累积值不为有限数');
      return { z, value };
    });

    return {
      geometry,
      radius,
      exact,
      exactPoints,
      fieldAt(point: SurfacePoint): SurfacePoint | null {
        if (!field) return null;
        const [x, y, z] = field.map((expression) => expression.evalOrNull({ ...point }));
        return x == null || y == null || z == null ? null : { x, y, z };
      },
      bandArea(band: SliceBand): number | null {
        const offset = (band.upper - band.lower) / 100;
        const before = radiusExpr.evalOrNull({ z: band.midpoint - offset });
        const after = radiusExpr.evalOrNull({ z: band.midpoint + offset });
        if (before === null || after === null || offset <= 0) return null;
        // Using the slope of r² keeps the area estimate finite near a tapering tip.
        const areaDensity = 2 * Math.PI * Math.hypot(radius(band.midpoint), (after - before) / (4 * offset));
        const area = areaDensity * (band.upper - band.lower);
        return Number.isFinite(area) ? area : null;
      },
      bands(count: number): SliceBand[] {
        if (!Number.isInteger(count) || count < 1 || count > 240) return [];
        const dz = span / count;
        const bands: SliceBand[] = [];
        let cumulative = 0;
        for (let index = 0; index < count; index += 1) {
          const midpoint = lower + (index + 0.5) * dz;
          const density = densityExpr.evalOrNull({ z: midpoint });
          if (density === null) return [];
          const contribution = density * dz;
          cumulative += contribution;
          if (!Number.isFinite(cumulative)) return [];
          bands.push({
            index, midpoint, density, contribution, cumulative,
            lower: lower + index * dz,
            upper: index === count - 1 ? upper : lower + (index + 1) * dz,
          });
        }
        return bands;
      },
      at(bands: SliceBand[], h: number) {
        const index = clamp(Math.floor(((h - lower) / span) * bands.length), 0, bands.length - 1);
        const band = bands[index];
        if (!band) return null;
        const before = bands[index - 1]?.cumulative ?? 0;
        const partial = clamp((h - band.lower) / (band.upper - band.lower), 0, 1);
        const value = primitive.evalOrNull({ z: h });
        const exact = value === null ? NaN : value - base;
        return Number.isFinite(exact) ? { band, exact, approx: before + partial * band.contribution } : null;
      },
    };
  } catch {
    return null;
  }
}

export type SliceModel = NonNullable<ReturnType<typeof createSliceModel>>;
