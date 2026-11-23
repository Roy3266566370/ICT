import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimitApproachModel, createSliceModel, type LimitApproachGeometry, type WalkthroughGeometry } from './walkthrough.ts';

const cylinder: WalkthroughGeometry = {
  family: 'cylinder', scale: 1, lower: 0, upper: 2,
  radius_squared: '1', density: '-z**2', primitive: '-z**3/3',
  density_tex: '-z^2', exact_tex: '-8/3', field_tex: '', orientation: -1,
};

test('the same midpoint bands drive the selected contribution and cumulative curve', () => {
  const model = createSliceModel(cylinder);
  assert.ok(model);
  const bands = model.bands(4);
  assert.equal(bands[0]?.contribution, -1 / 32);
  assert.equal(model.at(bands, 0.75)?.band.index, 1);
  assert.equal(model.at(bands, 0.75)?.approx, -(1 / 32 + 9 / 64));
  assert.equal(model.at(bands, 2)?.band.index, 3);
  const coarse = model.at(bands, 2)!;
  const fine = model.at(model.bands(24), 2)!;
  assert.ok(Math.abs(fine.exact - fine.approx) < Math.abs(coarse.exact - coarse.approx));
});

test('signed cumulative values use the primitive at the actual lower boundary', () => {
  const model = createSliceModel({ ...cylinder, lower: 1 });
  assert.ok(model);
  assert.equal(model.exact(1), 0);
  assert.ok(Math.abs(model.exact(2) + 7 / 3) < 1e-12);
});

test('unsupported or nonfinite expressions fail without drawing invalid pixels', () => {
  assert.equal(createSliceModel({ ...cylinder, radius_squared: 'unknown(z)' }), null);
  assert.equal(createSliceModel({ ...cylinder, primitive: '1/z' }), null);
});

test('equal-height sphere bands have the same area, including adjacent to the poles', () => {
  const model = createSliceModel({ ...cylinder, family: 'sphere', lower: -1, upper: 1, radius_squared: '1-z**2' });
  assert.ok(model);
  for (const band of model.bands(8)) {
    assert.ok(Math.abs(model.bandArea(band)! - Math.PI / 2) < 1e-8);
  }
});

test('volume washer model evaluates outer/inner radii and converges to pi/6', () => {
  const washer: WalkthroughGeometry = {
    family: 'volume_solid',
    axis: 'x',
    scale: 1,
    lower: 0,
    upper: 1,
    radius_squared: 'z',
    inner_radius_squared: 'z**2',
    density: 'pi*(z - z**2)',
    density_tex: '\\pi(x - x^2)',
    primitive: 'pi*(z**2/2 - z**3/3)',
    exact_tex: '\\frac{\\pi}{6}',
    field_tex: '1',
    orientation: 1,
  };
  const model = createSliceModel(washer);
  assert.ok(model);
  assert.ok(Math.abs(model.radius(0.25) - 0.5) < 1e-12);
  assert.ok(Math.abs(model.innerRadius(0.25) - 0.25) < 1e-12);
  assert.ok(Math.abs(model.exact(1) - Math.PI / 6) < 1e-12);
  const coarse = model.at(model.bands(6), 1)!;
  const fine = model.at(model.bands(48), 1)!;
  assert.ok(Math.abs(fine.exact - fine.approx) < Math.abs(coarse.exact - coarse.approx));
});

test('double integral region model evaluates strip bounds and cumulative integral', () => {
  const parabolaY: WalkthroughGeometry = {
    family: 'double_region',
    axis: 'y',
    scale: 1,
    lower: 0,
    upper: 1,
    radius_squared: '1',
    density: '(z**2/2 + z**2) - (z**4/2 + z**3)',
    density_tex: '\\frac{3}{2}y^2 - y^3 - \\frac{1}{2}y^4',
    primitive: 'z**3/2 - z**4/4 - z**5/10',
    exact_tex: '\\frac{3}{20}',
    field_tex: 'x + y',
    orientation: 1,
    region: {
      order: 'y_outer',
      outer_var: 'y',
      inner_var: 'x',
      outer_lower: 0,
      outer_upper: 1,
      inner_lower: 'z**2',
      inner_upper: 'z',
      inner_lower_tex: 'y^2',
      inner_upper_tex: 'y',
      inner_min: 0,
      inner_max: 1,
      integrand_tex: 'x + y',
    },
  };
  const model = createSliceModel(parabolaY);
  assert.ok(model);
  const b = model.regionBounds(0.5);
  assert.ok(b);
  assert.equal(b.lower, 0.25);
  assert.equal(b.upper, 0.5);
  assert.ok(Math.abs(model.exact(1) - 0.15) < 1e-12);
});

test('limit approach model shrinks error as delta decreases for sin(x)/x', () => {
  const approach: LimitApproachGeometry = {
    kind: 'limit',
    direction: 'both',
    point: 0,
    point_tex: '0',
    curve_expr: 'sin(x)/x',
    target_expr: 'sin(x)/x',
    principal_part_expr: '1 - x**2/6',
    exact_value: 1,
    exact_tex: '1',
    left_limit_tex: '1',
    right_limit_tex: '1',
    curve_tex: '\\frac{\\sin(x)}{x}',
    target_tex: '\\frac{\\sin(x)}{x}',
    f_at_point: null,
    span: 1.5,
  };
  const model = createLimitApproachModel(approach);
  assert.ok(model);
  const coarse = model.sampleAtDelta(0.5);
  const fine = model.sampleAtDelta(0.01);
  assert.ok(coarse.rightError !== null && fine.rightError !== null);
  assert.ok(fine.rightError < coarse.rightError);
  assert.ok(fine.rightError < 1e-4);
});
