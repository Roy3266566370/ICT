import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_PHYSICAL,
  MAX_TILT,
  angularMomentumOf,
  createRun,
  degToRad,
  energyOf,
  measurePrecession,
  momentsAboutPivot,
  precessionApproximation,
  simulate,
  steadyPrecessionRates,
  stepGyro,
  stepHalvingDeviation,
  thetaRange,
  verticalAngularMomentumOf,
} from './gyroMath.ts';

const steadySetup = {
  spin: 42,
  tilt: degToRad(28),
  comDistance: 0.075,
  release: 'steady' as const,
};

test('绕支点的横向转动惯量包含平行轴项，且小于轴向转动惯量', () => {
  const {I1, I3} = momentsAboutPivot(DEFAULT_PHYSICAL, 0.075);
  assert.ok(I1 > 0 && I3 > 0);
  assert.ok(Math.abs(I3 - 0.5 * DEFAULT_PHYSICAL.mass * DEFAULT_PHYSICAL.rotorRadius ** 2) < 1e-12);
  assert.ok(I1 > I3);
  const short = momentsAboutPivot(DEFAULT_PHYSICAL, 0.04);
  assert.ok(I1 > short.I1);
});

test('默认参数存在平稳进动，慢根小于快根且接近 mgℓ/(I₃ω_s)', () => {
  const run = createRun(steadySetup);
  assert.equal(run.steadyPossible, true);
  const roots = steadyPrecessionRates(
    steadySetup.tilt,
    steadySetup.spin,
    run.constants.I1,
    run.constants.I3,
    run.constants.mgL,
  );
  assert.ok(roots !== null);
  assert.ok(roots.slow > 0);
  assert.ok(roots.slow < roots.fast);
  assert.ok(Math.abs(run.initialPrecession - roots.slow) < 1e-12);
  const approximate = precessionApproximation(run.constants.mgL, run.constants.I3, steadySetup.spin);
  assert.ok(Math.abs(run.initialPrecession - approximate) / approximate < 0.2);
});

test('平稳进动：3 秒内倾角几乎不变，进动角速度与初始化一致', () => {
  const run = createRun(steadySetup);
  const samples = simulate(run, 3, 1 / 480, 1 / 60);
  const range = thetaRange(samples);
  assert.ok(range.max - range.min < 1e-3);
  const measured = measurePrecession(samples, 1);
  assert.ok(Math.abs(measured - run.initialPrecession) / run.initialPrecession < 0.01);
});

test('能量与竖直方向角动量守恒（RK4，相对漂移小于 1e-9）', () => {
  const run = createRun(steadySetup);
  const initialEnergy = energyOf(run.state, run.constants);
  const samples = simulate(run, 6, 1 / 480, 1 / 60);
  const last = samples[samples.length - 1];
  assert.ok(last !== undefined);
  const finalState = {
    theta: last.theta,
    thetaDot: last.thetaDot,
    phi: last.phi,
    psi: last.psi,
    time: last.time,
    contact: last.contact,
  };
  const drift = Math.abs(energyOf(finalState, run.constants) - initialEnergy) / Math.abs(initialEnergy);
  assert.ok(drift < 1e-9);
  const pz = verticalAngularMomentumOf(finalState, run.constants);
  assert.ok(Math.abs(pz - run.constants.pPhi) < 1e-9);
});

test('步长减半后同一时刻的倾角差小于 1e-6 rad', () => {
  const run = createRun(steadySetup);
  assert.ok(stepHalvingDeviation(run, 2, 1 / 480) < 1e-6);
});

test('转速越高，平稳进动的角速度越小', () => {
  const slowSpin = createRun({...steadySetup, spin: 42});
  const fastSpin = createRun({...steadySetup, spin: 63});
  assert.ok(fastSpin.initialPrecession < slowSpin.initialPrecession);
  assert.ok(
    precessionApproximation(fastSpin.constants.mgL, fastSpin.constants.I3, 63) <
      precessionApproximation(slowSpin.constants.mgL, slowSpin.constants.I3, 42),
  );
});

test('倾斜后直接释放会产生章动，倾角范围明显大于平稳进动', () => {
  const steady = createRun(steadySetup);
  const released = createRun({...steadySetup, release: 'tilt'});
  const steadyRange = thetaRange(simulate(steady, 3, 1 / 480, 1 / 60));
  const releasedRange = thetaRange(simulate(released, 3, 1 / 480, 1 / 60));
  assert.ok(releasedRange.max - releasedRange.min > 0.12);
  assert.ok(releasedRange.max - releasedRange.min > steadyRange.max - steadyRange.min + 0.1);
});

test('一次倾角扰动会激发章动，但角动量仍守恒', () => {
  const run = createRun(steadySetup);
  const perturbed = {...run.state, thetaDot: run.state.thetaDot + 1.4};
  let samples = [perturbed];
  let state = perturbed;
  for (let index = 0; index < 480; index += 1) {
    state = stepGyro(state, run.constants, 1 / 480);
    samples.push(state);
  }
  const range = thetaRange(samples.map((sample) => ({time: sample.time, theta: sample.theta, thetaDot: sample.thetaDot, phi: sample.phi, psi: sample.psi, contact: sample.contact})));
  assert.ok(range.max - range.min > 0.05);
  const pz = verticalAngularMomentumOf(state, run.constants);
  assert.ok(Math.abs(pz - run.constants.pPhi) < 1e-9);
});

test('不自转时会在重力矩下倾倒并接触支架', () => {
  const run = createRun({spin: 0, tilt: degToRad(32), comDistance: 0.075, release: 'tilt'});
  const samples = simulate(run, 2, 1 / 480, 1 / 60);
  const last = samples[samples.length - 1];
  assert.ok(last !== undefined);
  assert.equal(last.contact, true);
  assert.ok(last.theta >= MAX_TILT - 1e-6);
});

test('角动量向量与 p_φ 一致；平稳进动在 1 秒内保持倾角', () => {
  const run = createRun(steadySetup);
  const momentum = angularMomentumOf(run.state, run.constants);
  assert.ok(Math.abs(momentum.z - run.constants.pPhi) < 1e-12);
  const range = thetaRange(simulate(run, 1, 1 / 480, 1 / 120));
  assert.ok(range.max - range.min < 1e-6);
});
