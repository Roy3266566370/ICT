import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceModel, type WalkthroughGeometry } from './walkthrough.ts';

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
