import test from 'node:test';
import assert from 'node:assert/strict';
import type { PortValue } from './types.ts';
import {
  PHYS_TYPES,
  physCycle,
  bodyAt,
  pendulumNonlinearAt,
  pendulumPeriod,
  inclineBodyAt,
  collision1DAt,
  forcedSpringAt,
  resonanceCurve,
  waveSamples,
  type PhysNodeType,
} from './physics.ts';

type Body = Extract<PortValue, { kind: 'body' }>;
const D = Math.PI / 180;
const close = (actual: number, expected: number, tolerance = 1e-9, msg?: string) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${msg ?? ''} ${actual} != ${expected}`);
const allFinite = (v: object) => {
  for (const x of Object.values(v)) if (typeof x === 'number') assert.ok(Number.isFinite(x), `非有限值：${x}`);
};
function body(type: PhysNodeType, params: Record<string, number>, t: number): Body {
  const v = bodyAt(type, params, t);
  assert.equal(v.kind, 'body');
  return v as Body;
}

test('PHYS_TYPES 覆盖 7 个力学类型，判别器与 PortValue 联合一致', () => {
  assert.deepEqual(
    [...PHYS_TYPES].sort(),
    ['collisionLab', 'inclineLab', 'pendulum', 'projectile', 'resonanceLab', 'springOsc', 'waveLab'],
  );
});

test('大摆角单摆：初值、负 t、确定性与能量守恒', () => {
  const L = 1, g = 9.8, th0 = 60;
  const at0 = pendulumNonlinearAt(L, th0, g, 1, 0);
  close(at0.theta, th0 * D);
  assert.equal(at0.omega, 0);
  close(at0.x, L * Math.sin(th0 * D));
  close(at0.y, -L * Math.cos(th0 * D));

  const neg = pendulumNonlinearAt(L, th0, g, 1, -3);
  assert.deepEqual(neg, at0, 't≤0 返回初始态');

  const a = pendulumNonlinearAt(L, th0, g, 1, 1.37);
  const b = pendulumNonlinearAt(L, th0, g, 1, 1.37);
  assert.deepEqual(a, b, '同参数同 t 逐位一致');

  const e0 = (g / L) * (1 - Math.cos(th0 * D));
  for (const t of [0.4, 1, 2.2, 3.7]) {
    const s = pendulumNonlinearAt(L, th0, g, 1, t);
    const e = 0.5 * s.omega * s.omega + (g / L) * (1 - Math.cos(s.theta));
    close(e, e0, 1e-6, `t=${t} 能量漂移`);
    close(s.x, L * Math.sin(s.theta));
    close(s.y, -L * Math.cos(s.theta));
  }
});

test('大摆角与线性近似在 T0/4 处明显分离', () => {
  const L = 1.5, g = 9.8, th0 = 60;
  const T0 = 2 * Math.PI * Math.sqrt(L / g);
  const nonlinear = pendulumNonlinearAt(L, th0, g, 1, T0 / 4).theta;
  const linear = th0 * D * Math.cos((T0 / 4) * Math.sqrt(g / L));
  assert.ok(Math.abs(linear) < 1e-9);
  assert.ok(Math.abs(nonlinear) > 0.01, `非线性解应偏离平衡点：${nonlinear}`);
});

test('单摆周期：θ0=0 精确等于 2π√(L/g)，在 [0°,90°] 严格单调递增', () => {
  const L = 1.5, g = 9.8;
  const T0 = 2 * Math.PI * Math.sqrt(L / g);
  assert.equal(pendulumPeriod(L, 0, g), T0);
  close(pendulumPeriod(L, 0, g), 2.4579, 1e-3);
  let prev = pendulumPeriod(L, 0, g);
  for (let deg = 1; deg <= 90; deg++) {
    const cur = pendulumPeriod(L, deg, g);
    assert.ok(cur > prev, `${deg}° 应大于 ${deg - 1}°`);
    prev = cur;
  }
  const s = (90 * D) ** 2;
  close(pendulumPeriod(L, 90, g), T0 * (1 + s / 16 + (11 * s * s) / 3072 + (173 * s ** 3) / 737280), 1e-12);
  close(pendulumPeriod(L, 90, g) / T0, 1.1803, 1e-3);
});

test('斜面：静摩擦临界、滑动加速、到底停住', () => {
  const g = 9.8, m = 1, L = 2;
  const stuck = inclineBodyAt(30, 0.6, g, m, L, 5);
  assert.equal(stuck.sliding, false);
  assert.equal(stuck.s, 0);
  assert.equal(stuck.v, 0);
  assert.equal(stuck.a, 0);
  close(stuck.gravityAlong, m * g * Math.sin(30 * D));
  close(stuck.normal, m * g * Math.cos(30 * D));
  close(stuck.friction, m * g * Math.sin(30 * D));

  assert.equal(inclineBodyAt(45, 1, g, m, L, 2).sliding, false);

  const a = g * (Math.sin(30 * D) - 0.3 * Math.cos(30 * D));
  const mid = inclineBodyAt(30, 0.3, g, m, L, 0.5);
  assert.equal(mid.sliding, true);
  close(mid.a, a);
  close(mid.s, 0.5 * a * 0.25);
  close(mid.v, a * 0.5);
  close(mid.friction, 0.3 * mid.normal);

  const done = inclineBodyAt(30, 0.3, g, m, L, 3);
  assert.equal(done.s, L);
  assert.equal(done.v, 0);
  assert.equal(done.a, 0);
});

test('一维碰撞：未碰撞匀速、弹性与完全非弹、动量守恒', () => {
  const free = collision1DAt(1, 2, 2, -1, 1, 0.2);
  assert.equal(free.collided, false);
  close(free.x1, -1 + 2 * 0.2);
  close(free.x2, 1 - 0.2);
  close(free.momentum, 0);
  close(free.kinetic, 3);
  assert.equal(free.impulse, 0);

  const apart = collision1DAt(1, -1, 1, 1, 1, 1);
  assert.equal(apart.collided, false, 'v1≤v2 永不碰撞');
  close(apart.x1, -2);
  close(apart.x2, 2);

  const elastic = collision1DAt(1, 2, 2, -1, 1, 1);
  assert.equal(elastic.collided, true);
  close(elastic.v1, -2);
  close(elastic.v2, 1);
  close(elastic.momentum, 0);
  close(elastic.kinetic, 3, 1e-12);
  close(elastic.impulse, 4);
  assert.ok(elastic.x1 < elastic.x2, '碰撞后两球仍保持左右次序');

  const plastic = collision1DAt(1, 2, 2, -1, 0, 1);
  close(plastic.v1, 0);
  close(plastic.v2, 0);
  close(plastic.kinetic, 0);
  close(plastic.impulse, 2);
  assert.equal(plastic.momentum, free.momentum);
});

test('受迫共振稳态：振幅公式、相位、能量与零驱动力', () => {
  const k = 10, m = 1, c = 0.5, f0 = 1, wd = 3.16;
  const A = f0 / Math.hypot(k - m * wd * wd, c * wd);
  const phi = Math.atan2(c * wd, k - m * wd * wd);
  for (const t of [0, 0.3, 1.7]) {
    const s = forcedSpringAt(k, m, c, f0, wd, t);
    close(s.amplitude, A);
    close(s.x, A * Math.cos(wd * t - phi));
    close(s.v, -A * wd * Math.sin(wd * t - phi));
    close(s.ke, 0.5 * m * s.v * s.v);
    close(s.pe, 0.5 * k * s.x * s.x);
    close(s.drive, f0 * Math.cos(wd * t));
  }

  const idle = forcedSpringAt(k, m, c, 0, wd, 1.2);
  assert.equal(idle.amplitude, 0);
  assert.equal(idle.x, 0);
  assert.equal(idle.v, 0);
  assert.equal(idle.drive, 0);

  const staticCase = forcedSpringAt(k, m, c, 1, 0, 0);
  close(staticCase.amplitude, 0.1);
  close(staticCase.x, 0.1);
  assert.equal(staticCase.v, 0);
});

test('幅频曲线：241 点等距、阻尼峰值落在固有频率 ±5% 内', () => {
  const curve = resonanceCurve(10, 1, 0.5, 1);
  assert.equal(curve.length, 241);
  close(curve[0]!.wd, 0.1);
  close(curve[240]!.wd, 3 * Math.sqrt(10), 1e-12);
  const w0 = Math.sqrt(10);
  let best = curve[0]!;
  for (const p of curve) if (p.amplitude > best.amplitude) best = p;
  assert.ok(Math.abs(best.wd - w0) <= 0.05 * w0, `峰值 ${best.wd} 偏离 ${w0}`);
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i]!.wd > curve[i - 1]!.wd, 'ωd 单调递增');
    assert.ok(Number.isFinite(curve[i]!.amplitude));
  }
  close(best.amplitude, 1 / (0.5 * best.wd), 0.2, '峰值附近振幅应接近 1/(cω)');
});

test('波场采样：行波与驻波波形、波节严格为零', () => {
  const amp = 0.6, freq = 1, lam = 2;
  const travel = waveSamples(amp, freq, lam, 'travel', 0);
  assert.equal(travel.length, 64);
  for (let i = 0; i < travel.length; i++) {
    close(travel[i]!, amp * Math.sin(2 * Math.PI * (0 - (i * 2 * lam) / 63) / lam), 1e-12);
    assert.ok(Math.abs(travel[i]!) <= amp + 1e-12);
  }
  const moved = waveSamples(amp, freq, lam, 'travel', 0.25);
  assert.ok(Math.abs(moved[10]! - travel[10]!) > 1e-6, '行波随时间平移');

  const standing5 = waveSamples(amp, freq, lam, 'standing', 1, 5);
  assert.equal(standing5.length, 5);
  assert.equal(standing5[0], 0);
  assert.equal(standing5[2], 0, 'λ/2 处为波节');
  assert.equal(standing5[4], 0, 'λ 处为波节');
  for (const v of standing5) assert.ok(Math.abs(v) <= 2 * amp + 1e-12);
  const standing = waveSamples(amp, freq, lam, 'standing', 0.3);
  assert.equal(standing.length, 64);
  for (let i = 0; i < standing.length; i++) {
    const node = Math.abs(Math.sin((2 * Math.PI * i * 2) / 63)) < 1e-12 ? 0 : Math.sin((2 * Math.PI * i * 2) / 63);
    close(standing[i]!, 2 * amp * node * Math.cos(2 * Math.PI * freq * 0.3), 1e-12);
  }
});

test('physCycle：旧公式保持、新类型周期与下限', () => {
  const proj = { v0: 8, angle: 55, g: 9.8 };
  close(physCycle('projectile', proj), (2 * 8 * Math.sin(55 * D)) / 9.8);
  close(physCycle('springOsc', { k: 6, m: 1 }), 2 * Math.PI * Math.sqrt(1 / 6));
  close(physCycle('pendulum', { L: 1.5, theta0: 25, g: 9.8 }), pendulumPeriod(1.5, 25, 9.8));

  assert.equal(physCycle('inclineLab', { alpha: 30, mu: 0.6, g: 9.8, L: 2 }), 3);
  const a = 9.8 * (Math.sin(30 * D) - 0.3 * Math.cos(30 * D));
  close(physCycle('inclineLab', { alpha: 30, mu: 0.3, g: 9.8, L: 2 }), Math.sqrt(4 / a));
  close(physCycle('collisionLab', { v1: 2, v2: -1 }), 4 / 3);
  assert.equal(physCycle('collisionLab', { v1: -1, v2: 1 }), 2);
  close(physCycle('resonanceLab', { wd: 3.16 }), (2 * Math.PI) / 3.16);
  close(physCycle('waveLab', { freq: 1 }), 1);
  assert.equal(physCycle('waveLab', { freq: 100 }), 0.5);

  for (const type of PHYS_TYPES as ReadonlySet<PhysNodeType>) assert.ok(physCycle(type, {}) >= 0.5, `${type} 周期下限`);
});

test('bodyAt：旧节点公式保持，新节点字段映射', () => {
  const proj = body('projectile', { v0: 8, angle: 55, g: 9.8, m: 1 }, 0.5);
  close(proj.x, 8 * Math.cos(55 * D) * 0.5);
  close(proj.y, 8 * Math.sin(55 * D) * 0.5 - 0.5 * 9.8 * 0.25);
  allFinite(proj);

  const spring = body('springOsc', { k: 6, m: 1, x0: 1 }, 0.4);
  const w = Math.sqrt(6);
  close(spring.x, Math.cos(w * 0.4));
  close(spring.vx, -w * Math.sin(w * 0.4));
  close(spring.ke, 0.5 * spring.vx ** 2);
  close(spring.pe, 0.5 * 6 * spring.x ** 2);

  const pend = body('pendulum', { L: 1.5, theta0: 25, g: 9.8, m: 1 }, 0.7);
  const st = pendulumNonlinearAt(1.5, 25, 9.8, 1, 0.7);
  close(pend.x, st.x);
  close(pend.y, st.y);
  close(pend.theta!, st.theta);
  close(pend.omega!, st.omega);
  const small = 25 * D * Math.cos(Math.sqrt(9.8 / 1.5) * 0.7);
  close(pend.altX!, 1.5 * Math.sin(small));
  close(pend.altY!, -1.5 * Math.cos(small));

  const inc = body('inclineLab', { alpha: 30, mu: 0.3, g: 9.8, m: 1, L: 2 }, 0.5);
  const incSt = inclineBodyAt(30, 0.3, 9.8, 1, 2, 0.5);
  close(inc.x, incSt.s);
  close(inc.vx, incSt.v);
  close(inc.ax!, incSt.a);
  close(inc.fx!, incSt.gravityAlong - incSt.friction);
  close(inc.fy!, 0, 1e-12);
  close(inc.ke!, 0.5 * incSt.v * incSt.v);
  close(inc.pe!, 9.8 * (2 - incSt.s) * Math.sin(30 * D));
  close(inc.theta!, 30 * D);

  const col = body('collisionLab', { m1: 1, v1: 2, m2: 2, v2: -1, e: 1 }, 1);
  const colSt = collision1DAt(1, 2, 2, -1, 1, 1);
  close(col.x, colSt.x1);
  close(col.vx, colSt.v1);
  close(col.altX!, colSt.x2);
  assert.equal(col.altY, 0);
  close(col.fx!, colSt.impulse);
  close(col.ke!, colSt.kinetic);
  assert.equal(col.pe, 0);

  const res = body('resonanceLab', { k: 10, m: 1, c: 0.5, f0: 1, wd: 3.16 }, 0.3);
  const resSt = forcedSpringAt(10, 1, 0.5, 1, 3.16, 0.3);
  close(res.x, resSt.x);
  close(res.vx, resSt.v);
  close(res.fx!, resSt.drive);
  close(res.ke!, resSt.ke);
  close(res.pe!, resSt.pe);
  close(res.ax!, (-10 * resSt.x - 0.5 * resSt.v + resSt.drive) / 1);

  for (const t of [0, 0.8, 2.5]) {
    const wave = body('waveLab', { amp: 0.6, freq: 1, lambda: 2, mode: 0 }, t);
    close(wave.x, t);
    close(wave.theta!, t);
    assert.equal(wave.vx, 0);
    assert.equal(wave.vy, 0);
  }
});

test('非有限输入与负 t 不抛异常，全部返回有限数', () => {
  const bad = Number.NaN;
  const huge = Number.POSITIVE_INFINITY;
  allFinite(pendulumNonlinearAt(bad, bad, bad, bad, bad));
  allFinite(pendulumNonlinearAt(0, 0, 0, 0, -5));
  allFinite({ v: pendulumPeriod(huge, huge, huge) });
  allFinite(inclineBodyAt(bad, bad, bad, bad, bad, bad));
  allFinite(collision1DAt(bad, bad, bad, bad, bad, bad));
  allFinite(forcedSpringAt(bad, bad, bad, bad, bad, bad));
  allFinite(forcedSpringAt(10, 1, 0, 1, Math.sqrt(10), 0));
  for (const p of resonanceCurve(bad, bad, bad, bad)) allFinite(p);
  for (const v of waveSamples(bad, bad, bad, 'travel', bad)) assert.ok(Number.isFinite(v));
  for (const v of waveSamples(1, 1, 1, 'standing', -1, 8)) assert.ok(Number.isFinite(v));
  for (const type of PHYS_TYPES as ReadonlySet<PhysNodeType>) allFinite(body(type, { a: bad, b: huge }, bad));
});