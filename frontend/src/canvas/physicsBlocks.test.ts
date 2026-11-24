import test from 'node:test';
import assert from 'node:assert/strict';
import {
  electricFieldAt,
  emFieldFromParams,
  magneticStrength,
  opticsField,
  opticsFringes,
  potentialAt,
  rlcWaveform,
  thermoCycle,
  traceParticle,
} from './physicsBlocks.ts';

test('电场源支持点电荷与匀强场，并给出有限场强/电势', () => {
  const charges = emFieldFromParams({ mode: 0, count: 2, x1: 40, y1: 60, s1: 2, x2: 90, y2: 60, s2: -1 });
  assert.equal(charges.mode, 'electric');
  assert.equal(charges.sources.length, 2);
  assert.ok(Number.isFinite(potentialAt(charges, 60, 60)));
  assert.ok(Number.isFinite(electricFieldAt(charges, 60, 60).ex));
  const uniform = emFieldFromParams({ mode: 0, uniform: 1, ux: 1, uy: 0, uStrength: 2 });
  assert.equal(uniform.sources[0]!.kind, 'uniform');
  assert.ok(Math.abs(electricFieldAt(uniform, 50, 50).ex) > 0);
  const magnetic = emFieldFromParams({ mode: 1, uniform: 1, uStrength: 1.5 });
  assert.ok(magneticStrength(magnetic) > 0);
});

test('带电粒子轨迹在电场/磁场中保持有限且受步数限制', () => {
  const field = emFieldFromParams({ mode: 0, count: 1, x1: 40, y1: 60, s1: -2 });
  const path = traceParticle(field, { px: 80, py: 60, vx: 0.4, vy: 0.2, charge: 1, mass: 1 }, 60);
  assert.ok(path.length > 1 && path.length <= 60);
  assert.ok(path.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  const magnetic = emFieldFromParams({ mode: 1, uniform: 1, uStrength: 2 });
  const orbit = traceParticle(magnetic, { px: 50, py: 50, vx: 0.8, vy: 0, charge: 1, mass: 1 }, 40);
  assert.ok(orbit.length > 1);
  assert.ok(orbit.slice(1).some((point) => Math.abs(point.y - 50) > 0.01));
});

test('RLC 波形给出有限暂态、谐振频率与峰值电流', () => {
  const result = rlcWaveform({ r: 18, l: 0.08, c: 0.002, freq: 3, amplitude: 12, seconds: 2, drive: 0 });
  assert.equal(result.series.values.length, 60);
  assert.ok(result.series.values.every(Number.isFinite));
  assert.ok(result.series.secondary?.[0]?.values.every(Number.isFinite));
  assert.ok(result.resonance > 0);
  assert.ok(result.peakCurrent > 0);
  const rc = rlcWaveform({ r: 10, l: 0, c: 0.001, amplitude: 5, seconds: 1, drive: 1 });
  assert.ok(rc.series.values.every(Number.isFinite));
  assert.equal(rc.resonance, 0);
});

test('光学台输出光路源，双缝条纹为有限强度', () => {
  const lens = opticsField({ mode: 0, focal: 40 });
  assert.equal(lens.mode, 'optics');
  assert.ok(lens.sources.some((item) => item.kind === 'lens'));
  const slit = opticsField({ mode: 1, slitSpacing: 0.4 });
  assert.ok(slit.sources.some((item) => item.kind === 'slit'));
  const fringes = opticsFringes({ wavelength: 550, slitSpacing: 0.4, screenDistance: 120 });
  assert.equal(fringes.length, 120);
  assert.ok(fringes.every((value) => value >= 0 && value <= 1 && Number.isFinite(value)));
});

test('卡诺循环给出四状态、分段功与只由温度决定的效率', () => {
  const cycle = thermoCycle({ hot: 600, cold: 300, compression: 3, gamma: 1.4 });
  assert.equal(cycle.states.length, 4);
  assert.ok(cycle.states.every((state) => Number.isFinite(state.p) && Number.isFinite(state.v)));
  assert.ok(Math.abs(cycle.efficiency - 0.5) < 1e-9);
  assert.ok(cycle.netWork > 0);
  assert.ok(cycle.heatIn > 0);
  assert.equal(cycle.series.values.length, 4);
  assert.ok(cycle.curve.every((segment) => segment.points.every((point) => Number.isFinite(point.p))));
  const invalid = thermoCycle({ hot: Number.POSITIVE_INFINITY, cold: Number.NaN, compression: -5 });
  assert.ok(Number.isFinite(invalid.efficiency));
});
