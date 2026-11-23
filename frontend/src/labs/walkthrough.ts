import { clamp, compileExpression } from './expr.ts';

export type WalkthroughParameterId = 'h' | 'n' | 'delta' | 'zoom';
export type WalkthroughVerificationStatus = 'verified' | 'unverified';
export type WalkthroughSliceKind = 'surface' | 'volume' | 'double';

export interface LimitApproachGeometry {
  kind: 'limit' | 'derivative';
  direction: 'both' | 'left' | 'right';
  point: number;
  point_tex: string;
  curve_expr: string;
  target_expr: string;
  principal_part_expr: string;
  exact_value: number;
  exact_tex: string;
  left_limit_tex: string;
  right_limit_tex: string;
  curve_tex: string;
  target_tex: string;
  f_at_point: number | null;
  span: number;
}

export interface DoubleRegionGeometry {
  order: 'x_outer' | 'y_outer';
  outer_var: 'x' | 'y';
  inner_var: 'x' | 'y';
  outer_lower: number;
  outer_upper: number;
  inner_lower: string;
  inner_upper: string;
  inner_lower_tex: string;
  inner_upper_tex: string;
  inner_min: number;
  inner_max: number;
  integrand_tex: string;
}

export interface WalkthroughGeometry {
  family: 'sphere' | 'hemisphere' | 'cylinder' | 'cone' | 'paraboloid' | 'volume_solid' | 'double_region';
  axis?: 'x' | 'y' | 'z';
  scale: number;
  lower: number;
  upper: number;
  radius_squared: string;
  inner_radius_squared?: string;
  density: string;
  density_tex: string;
  primitive: string;
  exact_tex: string;
  field_tex: string;
  field?: string[];
  orientation: 1 | -1;
  region?: DoubleRegionGeometry;
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
  view: { kind: 'primitive'; name: 'slice_bands' | 'slice_disks' | 'region_strips' | 'cumulative_chart' | 'zoom_curve' };
  formulas: { tex: string; check?: string }[];
  checkpoint?: { type: 'predict'; prompt: string; options: string[]; answer: number };
  final?: boolean;
}

export interface SliceWalkthrough {
  version: 1;
  pattern: 'slice_accumulate';
  slice_kind?: WalkthroughSliceKind;
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

export interface LimitApproachWalkthrough {
  version: 1;
  pattern: 'limit_approach';
  limit_kind?: 'limit' | 'derivative';
  strategy: { why: string; alternatives: string[] };
  source: 'authored' | 'model';
  approach: LimitApproachGeometry;
  params: WalkthroughParameter[];
  steps: WalkthroughStep[];
  verification: {
    engine: 'sympy';
    status: WalkthroughVerificationStatus;
    checks: { id: string; status: WalkthroughVerificationStatus; detail?: string }[];
  };
  conditions_source: 'problem' | 'model';
}

export type Walkthrough = SliceWalkthrough | LimitApproachWalkthrough;

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
    const radiusExpr = compileExpression(geometry.radius_squared || '1', ['z']);
    const innerRadiusExpr = geometry.inner_radius_squared && geometry.inner_radius_squared !== '0'
      ? compileExpression(geometry.inner_radius_squared, ['z'])
      : null;
    const regionLowerExpr = geometry.region ? compileExpression(geometry.region.inner_lower, ['z']) : null;
    const regionUpperExpr = geometry.region ? compileExpression(geometry.region.inner_upper, ['z']) : null;
    const densityExpr = compileExpression(geometry.density, ['z']);
    const primitive = compileExpression(geometry.primitive, ['z']);
    const field = geometry.field?.length === 3
      ? geometry.field.map((expression) => compileExpression(expression, ['x', 'y', 'z']))
      : undefined;
    const base = primitive.eval({ z: lower });
    const radius = (z: number): number => Math.sqrt(Math.max(0, radiusExpr.evalOrNull({ z }) ?? 0));
    const innerRadius = (z: number): number => (innerRadiusExpr ? Math.sqrt(Math.max(0, innerRadiusExpr.evalOrNull({ z }) ?? 0)) : 0);
    const regionBounds = (z: number): { lower: number; upper: number } | null => {
      if (!regionLowerExpr || !regionUpperExpr) return null;
      const lo = regionLowerExpr.evalOrNull({ z });
      const hi = regionUpperExpr.evalOrNull({ z });
      if (lo === null || hi === null || !Number.isFinite(lo) || !Number.isFinite(hi)) return null;
      return { lower: lo, upper: hi };
    };
    const exact = (z: number): number => primitive.eval({ z }) - base;
    const exactPoints: SlicePoint[] = Array.from({ length: 97 }, (_, index) => {
      const z = lower + (index / 96) * span;
      if (geometry.family !== 'double_region') radiusExpr.eval({ z });
      const value = exact(z);
      if (!Number.isFinite(value)) throw new RangeError('累积值不为有限数');
      return { z, value };
    });

    return {
      geometry,
      radius,
      innerRadius,
      regionBounds,
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

export interface ApproachSampleRow {
  delta: number;
  leftX: number;
  rightX: number;
  leftValue: number | null;
  rightValue: number | null;
  leftError: number | null;
  rightError: number | null;
}

export function createLimitApproachModel(approach: LimitApproachGeometry) {
  if (!Number.isFinite(approach.point) || !Number.isFinite(approach.exact_value)) return null;
  try {
    const curveExpr = compileExpression(approach.curve_expr, ['x']);
    const targetExpr = compileExpression(approach.target_expr, ['x']);
    const principalExpr = compileExpression(approach.principal_part_expr, ['x']);

    const curveAt = (x: number): number | null => {
      const val = curveExpr.evalOrNull({ x });
      return val !== null && Number.isFinite(val) ? val : null;
    };
    const targetAt = (x: number): number | null => {
      const val = targetExpr.evalOrNull({ x });
      return val !== null && Number.isFinite(val) ? val : null;
    };
    const principalAt = (x: number): number | null => {
      const val = principalExpr.evalOrNull({ x });
      return val !== null && Number.isFinite(val) ? val : null;
    };

    const sampleAtDelta = (delta: number): ApproachSampleRow => {
      const safeDelta = clamp(delta, 1e-5, 10);
      const leftX = approach.point - safeDelta;
      const rightX = approach.point + safeDelta;
      const leftValue = approach.direction === 'right' ? null : targetAt(leftX);
      const rightValue = approach.direction === 'left' ? null : targetAt(rightX);
      return {
        delta: safeDelta,
        leftX,
        rightX,
        leftValue,
        rightValue,
        leftError: leftValue === null ? null : Math.abs(leftValue - approach.exact_value),
        rightError: rightValue === null ? null : Math.abs(rightValue - approach.exact_value),
      };
    };

    const table = [0.5, 0.2, 0.1, 0.02, 0.005].map(sampleAtDelta);
    return {
      approach,
      curveAt,
      targetAt,
      principalAt,
      sampleAtDelta,
      table,
    };
  } catch {
    return null;
  }
}

export type LimitApproachModel = NonNullable<ReturnType<typeof createLimitApproachModel>>;
