import test from 'node:test';
import assert from 'node:assert/strict';
import { computePhysics } from './physics.ts';
import { MANUAL_PHYSICS_SUBJECT } from './manualPhysics.ts';
import type { LabProblem } from './types.ts';

function problem(mode: string, kind: string, defaults: Record<string, number>): LabProblem {
  return {
    subject: 'physics',
    model: { engine: 'physics_v1', subject: 'physics', physics_mode: mode, physics_kind: kind, defaults },
  } as unknown as LabProblem;
}

test('physics manual catalog covers all three batches', () => {
  assert.equal(MANUAL_PHYSICS_SUBJECT.id, 'physics');
  assert.equal(MANUAL_PHYSICS_SUBJECT.groups.length, 15);
  const types = MANUAL_PHYSICS_SUBJECT.groups.flatMap(group => group.types);
  assert.equal(types.length, 56);
  assert.equal(new Set(types.map(item => item.id)).size, 56);
  assert.ok(types.every(item => item.template.length > 8 && item.mode));
});

test('kinematics interactive scenes and checks', () => {
  const uniform = computePhysics(problem('uniform_accel', 'kinematics', { v0: 2, a: 3, t: 4 }), { v0: 2, a: 3, t: 4 });
  assert.equal(uniform.kind, 'kinematics');
  assert.match(uniform.headline, /14/);
  assert.equal(uniform.scene.type, 'linear');
  assert.equal((uniform.scene as Record<string, any>).x, 32);
  assert.ok(uniform.checks.every(item => item.status === 'pass'));

  const projectile = computePhysics(problem('projectile_h', 'kinematics', { v0: 10, h: 20, g: 9.8 }), { v0: 10, h: 20, g: 9.8 });
  assert.equal(projectile.scene.type, 'projectile');
  assert.ok((projectile.scene as Record<string, any>).range > 20);
  assert.ok(projectile.trace.length > 2);
});

test('newton, energy and collision scenes update with params', () => {
  const incline = computePhysics(problem('incline', 'newton', { m: 2, angle: 30, mu: 0.2, g: 9.8 }), { m: 2, angle: 30, mu: 0.2, g: 9.8 });
  assert.equal(incline.scene.type, 'incline');
  assert.ok((incline.scene as Record<string, any>).acceleration > 3);
  const steep = computePhysics(problem('incline', 'newton', { m: 2, angle: 10, mu: 0.8, g: 9.8 }), { m: 2, angle: 10, mu: 0.8, g: 9.8 });
  assert.equal((steep.scene as Record<string, any>).moving, false);

  const collision = computePhysics(problem('inelastic', 'momentum', { m1: 2, v1: 3, m2: 1, v2: 0 }), { m1: 2, v1: 3, m2: 1, v2: 0 });
  assert.equal(collision.scene.type, 'collision');
  assert.equal((collision.scene as Record<string, any>).vp, 2);
  assert.equal((collision.scene as Record<string, any>).loss, 3);
  assert.ok(collision.checks.every(item => item.status === 'pass'));
});

test('oscillation and shm reuse the deterministic formulas', () => {
  const spring = computePhysics(problem('spring_osc', 'oscillation', { m: 0.5, k: 50, A: 0.1 }), { m: 0.5, k: 50, A: 0.1 });
  assert.equal(spring.scene.type, 'oscillation');
  assert.ok((spring.scene as Record<string, any>).T > 0.6);
  assert.equal((spring.scene as Record<string, any>).energy, 0.25);

  const pendulum = computePhysics(problem('pendulum', 'oscillation', { L: 1, theta0: 5, g: 9.8, m: 1 }), { L: 1, theta0: 5, g: 9.8, m: 1 });
  assert.equal(pendulum.scene.type, 'pendulum');
  assert.ok((pendulum.scene as Record<string, any>).T > 1.9);

  const shm = computePhysics(problem('shm', 'oscillation', { A: 0.2, T: 2, phi: 0, t: 0.5, m: 1 }), { A: 0.2, T: 2, phi: 0, t: 0.5, m: 1 });
  assert.equal(shm.scene.type, 'shm');
  assert.ok(Math.abs((shm.scene as Record<string, any>).x) < 1e-12);
  assert.ok((shm.scene as Record<string, any>).v < 0);
});

test('all manual physics modes can be computed', () => {
  const cases: [string, string, Record<string, number>][] = [
    ['uniform_accel', 'kinematics', { v0: 2, a: 3, t: 4 }],
    ['free_fall', 'kinematics', { h: 20, g: 9.8 }],
    ['projectile_h', 'kinematics', { v0: 10, h: 20, g: 9.8 }],
    ['projectile_o', 'kinematics', { v0: 20, angle: 30, h0: 0, g: 9.8 }],
    ['relative', 'kinematics', { vA: 5, vB: 2 }],
    ['incline', 'newton', { m: 2, angle: 30, mu: 0.2, g: 9.8 }],
    ['atwood', 'newton', { m1: 1, m2: 3, g: 9.8 }],
    ['circular', 'newton', { m: 0.5, v: 4, r: 2 }],
    ['spring_work', 'work_energy', { k: 200, x: 0.1 }],
    ['work_energy', 'work_energy', { m: 2, F: 10, s: 5, v0: 0 }],
    ['energy_conservation', 'work_energy', { m: 1, h: 5, g: 9.8 }],
    ['impulse', 'momentum', { m: 0.5, v1: 2, v2: 6, t: 0.2 }],
    ['elastic', 'momentum', { m1: 2, v1: 3, m2: 1, v2: 0 }],
    ['inelastic', 'momentum', { m1: 2, v1: 3, m2: 1, v2: 0 }],
    ['spring_osc', 'oscillation', { m: 0.5, k: 50, A: 0.1 }],
    ['pendulum', 'oscillation', { L: 1, theta0: 5, g: 9.8, m: 1 }],
    ['shm', 'oscillation', { A: 0.2, T: 2, phi: 0, t: 0.5, m: 1 }],
    ['rigid_rotation', 'rigid_body', { m: 2, r: 0.5, c: 0.5, torque: 4, omega0: 0, t: 3 }],
    ['rolling', 'rigid_body', { m: 2, r: 0.2, c: 0.5, angle: 30, s: 3, g: 9.8 }],
    ['wave_travel', 'wave', { A: 0.05, lam: 2, f: 5, phi: 0, x1: 0.2, x2: 0.7, t: 0 }],
    ['standing_wave', 'wave', { A: 0.02, lam: 1, L: 1.5, v: 10 }],
    ['coulomb', 'electrostatics', { q1: 2e-6, q2: -1e-6, d: 0.3, xP: 0.1 }],
    ['gauss', 'electrostatics', { Q: 1e-6, R: 0.1, r: 0.05, shell: 0 }],
    ['capacitor', 'circuit', { C1: 2, C2: 3, U: 12, series: 1 }],
    ['kirchhoff', 'circuit', { E1: 12, E2: 6, R1: 2, R2: 4, R3: 3 }],
    ['rc', 'circuit', { R: 1000, C: 100, E: 12, t: 0.2, discharge: 0 }],
    ['lorentz', 'magnetism', { m: 9.1e-31, q: 1.6e-19, B: 0.1, v: 1e6 }],
    ['ampere', 'magnetism', { I: 2, L: 0.5, B: 0.4, angle: 30 }],
    ['faraday', 'induction', { A: 0.2, B1: 0.1, B2: 0.5, dt: 0.5, N: 100, R: 10 }],
    ['rail', 'induction', { B: 0.4, L: 0.5, v: 2, R: 0.5 }],
    ['thermo_process', 'thermodynamics', { n: 1, T1: 300, V1: 0.02, V2: 0.04, process: 0, gamma: 1.4 }],
    ['carnot', 'thermodynamics', { Th: 600, Tc: 300, Qh: 1000 }],
    ['double_slit', 'wave_optics', { d: 2e-4, D: 1, lam: 6e-7, n: 1, k: 1 }],
    ['thin_film', 'wave_optics', { n: 1.33, d: 2.25e-7, lam: 6e-7, target: 0, phase: 1 }],
    ['single_slit', 'wave_optics', { a: 1e-4, lam: 6e-7, L: 1 }],
    ['grating', 'wave_optics', { d: 2e-6, lam: 6e-7, k: 1 }],
    ['polarization', 'wave_optics', { I0: 10, theta: 60, n: 1.5, natural: 1 }],
    ['refraction', 'geometric_optics', { n1: 1, n2: 1.5, angle: 45 }],
    ['lens', 'geometric_optics', { f: 0.1, u: 0.3, h: 1, convex: 1 }],
    ['photoelectric', 'modern_physics', { lam: 4e-7, W: 2.2 }],
    ['de_broglie', 'modern_physics', { m: 9.1e-31, v: 0, U: 100, electron: 1 }],
    ['energy_level', 'modern_physics', { n_hi: 3, n_lo: 2, group_n: 0, hydrogen: 1 }],
    ['decay', 'modern_physics', { T: 432000, N0: 1e20, t: 1296000 }],
  ];
  for (const [mode, kind, defaults] of cases) {
    const result = computePhysics(problem(mode, kind, defaults), defaults);
    assert.equal(result.subject, 'physics', mode);
    assert.equal(result.mode, mode);
    assert.ok(result.headline.length > 0, mode);
    assert.ok(result.trace.length > 0, mode);
    assert.ok(result.checks.length > 0, mode);
    assert.ok(typeof (result.scene as Record<string, any>).type === 'string', mode);
  }
});
test('second-batch physics formulas and checks', () => {
  const rotation = computePhysics(problem('rigid_rotation', 'rigid_body', { m: 2, r: 0.5, c: 0.5, torque: 4, omega0: 0, t: 3 }), { m: 2, r: 0.5, c: 0.5, torque: 4, omega0: 0, t: 3 });
  assert.equal((rotation.scene as Record<string, any>).I, 0.25);
  assert.equal((rotation.scene as Record<string, any>).alpha, 16);
  const wave = computePhysics(problem('wave_travel', 'wave', { A: 0.05, lam: 2, f: 5, phi: 0, x1: 0.2, x2: 0.7, t: 0 }), { A: 0.05, lam: 2, f: 5, phi: 0, x1: 0.2, x2: 0.7, t: 0 });
  assert.equal((wave.scene as Record<string, any>).v, 10);
  assert.ok(Math.abs((wave.scene as Record<string, any>).phase - Math.PI / 2) < 1e-9);
  const coulomb = computePhysics(problem('coulomb', 'electrostatics', { q1: 2e-6, q2: -1e-6, d: 0.3, xP: 0.1 }), { q1: 2e-6, q2: -1e-6, d: 0.3, xP: 0.1 });
  assert.ok(Math.abs((coulomb.scene as Record<string, any>).F - 0.1998) < 0.001);
  const capacitor = computePhysics(problem('capacitor', 'circuit', { C1: 2, C2: 3, U: 12, series: 1 }), { C1: 2, C2: 3, U: 12, series: 1 });
  assert.ok(Math.abs((capacitor.scene as Record<string, any>).Ceq - 1.2) < 1e-9);
  const rc = computePhysics(problem('rc', 'circuit', { R: 1000, C: 100, E: 12, t: 0.2, discharge: 0 }), { R: 1000, C: 100, E: 12, t: 0.2, discharge: 0 });
  assert.ok(Math.abs((rc.scene as Record<string, any>).tau - 0.1) < 1e-12);
  const lorentz = computePhysics(problem('lorentz', 'magnetism', { m: 9.1e-31, q: 1.6e-19, B: 0.1, v: 1e6 }), { m: 9.1e-31, q: 1.6e-19, B: 0.1, v: 1e6 });
  assert.ok((lorentz.scene as Record<string, any>).r > 5e-5);
  const faraday = computePhysics(problem('faraday', 'induction', { A: 0.2, B1: 0.1, B2: 0.5, dt: 0.5, N: 100, R: 10 }), { A: 0.2, B1: 0.1, B2: 0.5, dt: 0.5, N: 100, R: 10 });
  assert.ok(Math.abs((faraday.scene as Record<string, any>).emf - 16) < 1e-9);
  const rail = computePhysics(problem('rail', 'induction', { B: 0.4, L: 0.5, v: 2, R: 0.5 }), { B: 0.4, L: 0.5, v: 2, R: 0.5 });
  assert.ok(Math.abs((rail.scene as Record<string, any>).emf - 0.4) < 1e-9);
  const thermo = computePhysics(problem('thermo_process', 'thermodynamics', { n: 1, T1: 300, V1: 0.02, V2: 0.04, process: 0, gamma: 1.4 }), { n: 1, T1: 300, V1: 0.02, V2: 0.04, process: 0, gamma: 1.4 });
  assert.ok((thermo.scene as Record<string, any>).W > 1700);
  const carnot = computePhysics(problem('carnot', 'thermodynamics', { Th: 600, Tc: 300, Qh: 1000 }), { Th: 600, Tc: 300, Qh: 1000 });
  assert.ok(Math.abs((carnot.scene as Record<string, any>).eta - 0.5) < 1e-9);
});

test('third-batch optics and modern formulas', () => {
  const double = computePhysics(problem('double_slit', 'wave_optics', { d: 2e-4, D: 1, lam: 6e-7, n: 1, k: 1 }), { d: 2e-4, D: 1, lam: 6e-7, n: 1, k: 1 });
  assert.ok(Math.abs((double.scene as Record<string, any>).spacing - 0.003) < 1e-12);
  const soap = computePhysics(problem('thin_film', 'wave_optics', { n: 1.33, d: 2.25e-7, lam: 6e-7, target: 0, phase: 1 }), { n: 1.33, d: 2.25e-7, lam: 6e-7, target: 0, phase: 1 });
  assert.equal((soap.scene as Record<string, any>).dark, true);
  const coating = computePhysics(problem('thin_film', 'wave_optics', { n: 1.38, d: 0, lam: 5.5e-7, target: 1, phase: 0 }), { n: 1.38, d: 0, lam: 5.5e-7, target: 1, phase: 0 });
  assert.ok(Math.abs((coating.scene as Record<string, any>).d - 5.5e-7 / (4 * 1.38)) < 1e-18);
  const slit = computePhysics(problem('single_slit', 'wave_optics', { a: 1e-4, lam: 6e-7, L: 1 }), { a: 1e-4, lam: 6e-7, L: 1 });
  assert.ok(Math.abs((slit.scene as Record<string, any>).width - 0.012) < 1e-12);
  const grating = computePhysics(problem('grating', 'wave_optics', { d: 2e-6, lam: 6e-7, k: 1 }), { d: 2e-6, lam: 6e-7, k: 1 });
  assert.ok(Math.abs((grating.scene as Record<string, any>).theta - Math.asin(0.3) * 180 / Math.PI) < 1e-9);
  assert.equal((grating.scene as Record<string, any>).maxOrder, 3);
  const polarization = computePhysics(problem('polarization', 'wave_optics', { I0: 10, theta: 60, n: 1.5, natural: 1 }), { I0: 10, theta: 60, n: 1.5, natural: 1 });
  assert.ok(Math.abs((polarization.scene as Record<string, any>).I2 - 1.25) < 1e-12);
  const refraction = computePhysics(problem('refraction', 'geometric_optics', { n1: 1, n2: 1.5, angle: 45 }), { n1: 1, n2: 1.5, angle: 45 });
  assert.ok(Math.abs((refraction.scene as Record<string, any>).angle2 - 28.1255) < 1e-3);
  const tir = computePhysics(problem('refraction', 'geometric_optics', { n1: 1.5, n2: 1, angle: 50 }), { n1: 1.5, n2: 1, angle: 50 });
  assert.equal((tir.scene as Record<string, any>).tir, true);
  const lens = computePhysics(problem('lens', 'geometric_optics', { f: 0.1, u: 0.3, h: 1, convex: 1 }), { f: 0.1, u: 0.3, h: 1, convex: 1 });
  assert.ok(Math.abs((lens.scene as Record<string, any>).v - 0.15) < 1e-12);
  assert.ok(Math.abs((lens.scene as Record<string, any>).m + 0.5) < 1e-12);
  const photoelectric = computePhysics(problem('photoelectric', 'modern_physics', { lam: 4e-7, W: 2.2 }), { lam: 4e-7, W: 2.2 });
  assert.ok(Math.abs((photoelectric.scene as Record<string, any>).Ek - 0.8996) < 1e-3);
  const electron = computePhysics(problem('de_broglie', 'modern_physics', { m: 9.1e-31, v: 0, U: 100, electron: 1 }), { m: 9.1e-31, v: 0, U: 100, electron: 1 });
  assert.ok((electron.scene as Record<string, any>).lam > 1e-10 && (electron.scene as Record<string, any>).lam < 1.5e-10);
  const transition = computePhysics(problem('energy_level', 'modern_physics', { n_hi: 3, n_lo: 2, group_n: 0, hydrogen: 1 }), { n_hi: 3, n_lo: 2, group_n: 0, hydrogen: 1 });
  assert.ok(Math.abs((transition.scene as Record<string, any>).deltaE - 1.8889) < 1e-3);
  const spectrum = computePhysics(problem('energy_level', 'modern_physics', { n_hi: 0, n_lo: 0, group_n: 4, hydrogen: 1 }), { n_hi: 0, n_lo: 0, group_n: 4, hydrogen: 1 });
  assert.equal((spectrum.scene as Record<string, any>).lines, 6);
  const decay = computePhysics(problem('decay', 'modern_physics', { T: 432000, N0: 1e20, t: 1296000 }), { T: 432000, N0: 1e20, t: 1296000 });
  assert.ok(Math.abs((decay.scene as Record<string, any>).N - 1.25e19) < 1e6);
  assert.ok(Math.abs((decay.scene as Record<string, any>).fraction - 0.125) < 1e-12);
});
