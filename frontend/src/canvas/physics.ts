/**
 * physics.ts —— 力学实验台的确定性内核（state = f(params, t)）
 *
 * 物理源节点不接外部 ODE 求解器，只有两类确定解：
 *  - 闭式解：抛体、弹簧振子、受迫共振稳态、波场采样；
 *  - 固定子步积分：单摆大摆角（RK4，子步 0.002s），同参数同 t 结果逐位一致。
 *
 * t 为"周期内秒数"：节点自走钟由 CanvasBoard 的 rAF 按 `physCycle` 取模写入
 * live Map；外接标量（滑杆/ticker）时直接用输入值（ticker 0→1 会×周期换算）。
 * 所有入口对非有限输入做下限保护并返回有限数，负 t 按 0 处理。
 */

import type { NodeType, PortValue } from './types.ts';

export type PhysNodeType = Extract<
  NodeType,
  'projectile' | 'springOsc' | 'pendulum' | 'inclineLab' | 'collisionLab' | 'resonanceLab' | 'waveLab'
>;
export const PHYS_TYPES: ReadonlySet<string> = new Set([
  'projectile',
  'springOsc',
  'pendulum',
  'inclineLab',
  'collisionLab',
  'resonanceLab',
  'waveLab',
]);

const DEG = Math.PI / 180;
const PENDULUM_STEP = 0.002;

/** 非有限输入回退缺省值；下限保护交给调用方（不同量的量纲下限不同）。 */
function finite(v: number | undefined, fallback: number): number {
  return v !== undefined && Number.isFinite(v) ? v : fallback;
}

/** 带下限的正值保护（长度、质量、刚度、速率等）。 */
function pos(v: number | undefined, fallback: number, min: number): number {
  return Math.max(min, finite(v, fallback));
}

/** 时长保护：负值与 NaN 按 0 处理。 */
function timeAt(t: number): number {
  return Number.isFinite(t) && t > 0 ? t : 0;
}

export interface PendulumNonlinearState { theta: number; omega: number; x: number; y: number }

/**
 * 大摆角单摆：θ̈=−(g/L)sinθ 从 θ(0)=θ0、ω(0)=0 起用固定子步 RK4 积分到 t。
 * 返回角度/角速度与摆球坐标（悬点在原点，摆锤在下方）。
 */
export function pendulumNonlinearAt(
  L: number,
  theta0Deg: number,
  g: number,
  m: number,
  t: number,
): PendulumNonlinearState {
  const len = pos(L, 1.5, 0.05);
  const grav = pos(g, 9.8, 0.1);
  const th0 = finite(theta0Deg, 25) * DEG;
  const tt = timeAt(t);
  const k = grav / len;
  const accel = (angle: number) => -k * Math.sin(angle);
  const advance = (state: { th: number; om: number }, h: number) => {
    const k1 = state.om, a1 = accel(state.th);
    const k2 = state.om + (a1 * h) / 2, a2 = accel(state.th + (k1 * h) / 2);
    const k3 = state.om + (a2 * h) / 2, a3 = accel(state.th + (k2 * h) / 2);
    const k4 = state.om + a3 * h, a4 = accel(state.th + k3 * h);
    state.th += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    state.om += (h / 6) * (a1 + 2 * a2 + 2 * a3 + a4);
  };
  const state = { th: th0, om: 0 };
  if (tt > 0) {
    const steps = Math.floor(tt / PENDULUM_STEP);
    for (let i = 0; i < steps; i++) advance(state, PENDULUM_STEP);
    const rest = tt - steps * PENDULUM_STEP;
    if (rest > 0) advance(state, rest);
  }
  return { theta: state.th, omega: state.om, x: len * Math.sin(state.th), y: -len * Math.cos(state.th) };
}

/** 单摆周期：小角 T0 乘以六阶展开修正项（θ0 为弧度）。 */
export function pendulumPeriod(L: number, theta0Deg: number, g: number): number {
  const len = pos(L, 1.5, 0.05);
  const grav = pos(g, 9.8, 0.1);
  const th0 = finite(theta0Deg, 25) * DEG;
  const s = th0 * th0;
  const t0 = 2 * Math.PI * Math.sqrt(len / grav);
  return t0 * (1 + s / 16 + (11 * s * s) / 3072 + (173 * s * s * s) / 737280);
}

export interface InclineState {
  sliding: boolean;
  s: number;
  v: number;
  a: number;
  gravityAlong: number;
  normal: number;
  friction: number;
}

/** 斜面体：tanα ≤ μ 时静止（静摩擦恰好抵消重力分量），否则沿斜面加速到底并停住。 */
export function inclineBodyAt(
  alphaDeg: number,
  mu: number,
  g: number,
  m: number,
  L: number,
  t: number,
): InclineState {
  const alpha = finite(alphaDeg, 30) * DEG;
  const mass = pos(m, 1, 0.01);
  const grav = pos(g, 9.8, 0.1);
  const fric = Math.max(0, finite(mu, 0.3));
  const len = pos(L, 2, 0.01);
  const tt = timeAt(t);
  const sin = Math.sin(alpha);
  const cos = Math.cos(alpha);
  const gravityAlong = mass * grav * sin;
  const normal = mass * grav * cos;
  if (Math.tan(alpha) <= fric) {
    return { sliding: false, s: 0, v: 0, a: 0, gravityAlong, normal, friction: gravityAlong };
  }
  const a = grav * (sin - fric * cos);
  const travel = 0.5 * a * tt * tt;
  const atBottom = travel >= len;
  const s = Math.min(len, travel);
  return {
    sliding: true,
    s,
    v: atBottom ? 0 : a * tt,
    a: atBottom ? 0 : a,
    gravityAlong,
    normal,
    friction: fric * normal,
  };
}

export interface CollisionState {
  x1: number;
  v1: number;
  x2: number;
  v2: number;
  collided: boolean;
  momentum: number;
  kinetic: number;
  impulse: number;
}

/**
 * 一维碰撞：两体自 x1=−1、x2=1 匀速接近，tc=(x2−x1)/(v1−v2) 处按恢复系数交换速度，
 * 之后从碰撞点继续匀速。动量前后同值，动能与冲量按碰撞后速度计算。
 */
export function collision1DAt(
  m1: number,
  v1: number,
  m2: number,
  v2: number,
  e: number,
  t: number,
): CollisionState {
  const mass1 = pos(m1, 1, 0.01);
  const mass2 = pos(m2, 2, 0.01);
  const u1 = finite(v1, 2);
  const u2 = finite(v2, -1);
  const rest = Math.max(0, finite(e, 1));
  const tt = timeAt(t);
  const momentum = mass1 * u1 + mass2 * u2;
  const kinetic0 = 0.5 * mass1 * u1 * u1 + 0.5 * mass2 * u2 * u2;
  const rel = u1 - u2;
  if (!(rel > 0)) {
    return {
      x1: -1 + u1 * tt,
      x2: 1 + u2 * tt,
      v1: u1,
      v2: u2,
      collided: false,
      momentum,
      kinetic: kinetic0,
      impulse: 0,
    };
  }
  const tc = 2 / rel;
  if (tt < tc) {
    return {
      x1: -1 + u1 * tt,
      x2: 1 + u2 * tt,
      v1: u1,
      v2: u2,
      collided: false,
      momentum,
      kinetic: kinetic0,
      impulse: 0,
    };
  }
  const total = mass1 + mass2;
  const nv1 = ((mass1 - rest * mass2) * u1 + (1 + rest) * mass2 * u2) / total;
  const nv2 = ((mass2 - rest * mass1) * u2 + (1 + rest) * mass1 * u1) / total;
  const xc = -1 + u1 * tc;
  const dt = tt - tc;
  return {
    x1: xc + nv1 * dt,
    x2: xc + nv2 * dt,
    v1: nv1,
    v2: nv2,
    collided: true,
    momentum,
    kinetic: 0.5 * mass1 * nv1 * nv1 + 0.5 * mass2 * nv2 * nv2,
    impulse: Math.abs(mass1 * (nv1 - u1)),
  };
}

export interface ForcedSpringState {
  x: number;
  v: number;
  ke: number;
  pe: number;
  drive: number;
  amplitude: number;
}

/** 阻尼受迫振子的稳态解（暂态项已衰减）：A=f0/√((k−mωd²)²+(cωd)²)，φ=atan2(cωd, k−mωd²)。 */
export function forcedSpringAt(
  k: number,
  m: number,
  c: number,
  f0: number,
  wd: number,
  t: number,
): ForcedSpringState {
  const stiff = pos(k, 10, 0.01);
  const mass = pos(m, 1, 0.01);
  const damp = Math.max(0, finite(c, 0.5));
  const force = Math.max(0, finite(f0, 1));
  const omega = Math.max(0, finite(wd, 3.16));
  const tt = timeAt(t);
  const detune = stiff - mass * omega * omega;
  const den = Math.max(1e-9, Math.hypot(detune, damp * omega));
  const zero = (value: number): number => (value === 0 ? 0 : value); // 归一化 −0，供严格断言
  const amplitude = zero(force / den);
  const phi = Math.atan2(damp * omega, detune);
  const phase = omega * tt - phi;
  const x = zero(amplitude * Math.cos(phase));
  const v = zero(-amplitude * omega * Math.sin(phase));
  return { x, v, ke: zero(0.5 * mass * v * v), pe: zero(0.5 * stiff * x * x), drive: zero(force * Math.cos(omega * tt)), amplitude };
}

/** 幅频曲线：ωd ∈ [0.1, max(0.5, 3√(k/m))] 等距 241 点。 */
export function resonanceCurve(
  k: number,
  m: number,
  c: number,
  f0: number,
): { wd: number; amplitude: number }[] {
  const stiff = pos(k, 10, 0.01);
  const mass = pos(m, 1, 0.01);
  const hi = Math.max(0.5, 3 * Math.sqrt(stiff / mass));
  const out: { wd: number; amplitude: number }[] = [];
  for (let i = 0; i < 241; i++) {
    const wd = 0.1 + ((hi - 0.1) * i) / 240;
    out.push({ wd, amplitude: forcedSpringAt(stiff, mass, c, f0, wd, 0).amplitude });
  }
  return out;
}

/** 波场采样：x_i = i·2λ/(n−1)；行波 A·sin(2π(ft−x/λ))，驻波 2A·sin(2πx/λ)·cos(2πft)。 */
export function waveSamples(
  amp: number,
  freq: number,
  lambda: number,
  mode: 'travel' | 'standing',
  t: number,
  n = 64,
): number[] {
  const a = finite(amp, 0.6);
  const f = Math.max(0, finite(freq, 1));
  const lam = pos(lambda, 2, 0.05);
  const count = Math.max(2, Math.floor(Number.isFinite(n) ? n : 64));
  const tt = timeAt(t);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = (i * 2 * lam) / (count - 1);
    if (mode === 'standing') {
      const shape = Math.sin((2 * Math.PI * x) / lam);
      // 节点（x=0、λ/2、λ……）sin(π) 的浮点残差归零，保证驻波波节严格为 0
      const node = Math.abs(shape) < 1e-12 ? 0 : shape;
      out.push(2 * a * node * Math.cos(2 * Math.PI * f * tt));
    } else {
      out.push(a * Math.sin(2 * Math.PI * (f * tt - x / lam)));
    }
  }
  return out;
}

/** 节点自闭钟的一个周期（秒）——动画循环一轮的时长。 */
export function physCycle(type: PhysNodeType, params: Record<string, number>): number {
  if (type === 'projectile') {
    const v0 = Math.max(0.5, params.v0 ?? 8);
    const theta = (params.angle ?? 55) * DEG;
    const g = Math.max(0.1, params.g ?? 9.8);
    return Math.max(0.5, (2 * v0 * Math.sin(theta)) / g);
  }
  if (type === 'springOsc') {
    const k = Math.max(0.1, params.k ?? 6);
    const m = Math.max(0.05, params.m ?? 1);
    return Math.max(0.4, 2 * Math.PI * Math.sqrt(m / k));
  }
  if (type === 'pendulum') {
    const L = Math.max(0.2, params.L ?? 1.5);
    const g = Math.max(0.1, params.g ?? 9.8);
    return Math.max(0.5, pendulumPeriod(L, params.theta0 ?? 25, g));
  }
  if (type === 'inclineLab') {
    const alpha = (params.alpha ?? 30) * DEG;
    const mu = Math.max(0, params.mu ?? 0.3);
    const g = Math.max(0.1, params.g ?? 9.8);
    const L = Math.max(0.05, params.L ?? 2);
    if (Math.tan(alpha) <= mu) return Math.max(0.5, 3);
    const a = Math.max(1e-6, g * (Math.sin(alpha) - mu * Math.cos(alpha)));
    return Math.max(0.5, Math.sqrt((2 * L) / a));
  }
  if (type === 'collisionLab') {
    const rel = (params.v1 ?? 2) - (params.v2 ?? -1);
    return Math.max(0.5, rel > 0 ? 4 / rel : 2);
  }
  if (type === 'resonanceLab') {
    const wd = Math.max(0.1, params.wd ?? 3.16);
    return Math.max(0.5, (2 * Math.PI) / wd);
  }
  // waveLab
  const freq = Math.max(0.05, params.freq ?? 1);
  return Math.max(0.5, 1 / freq);
}

/** f(params, t) → body 状态（含能量、力与派生量，供能量表/轨迹仪/记录仪消费）。 */
export function bodyAt(type: PhysNodeType, params: Record<string, number>, t: number): PortValue {
  const tt = timeAt(t);
  if (type === 'projectile') {
    const v0 = params.v0 ?? 8;
    const theta = (params.angle ?? 55) * DEG;
    const g = params.g ?? 9.8;
    const m = params.m ?? 1;
    const x = v0 * Math.cos(theta) * tt;
    const y = Math.max(0, v0 * Math.sin(theta) * tt - 0.5 * g * tt * tt);
    const vx = v0 * Math.cos(theta);
    const vy = v0 * Math.sin(theta) - g * tt;
    return {
      kind: 'body', x, y, vx, vy,
      ke: 0.5 * m * (vx * vx + vy * vy),
      pe: m * g * y,
    };
  }
  if (type === 'springOsc') {
    const k = params.k ?? 6;
    const m = params.m ?? 1;
    const A = params.x0 ?? 1;
    const w = Math.sqrt(k / m);
    const x = A * Math.cos(w * tt);
    const vx = -A * w * Math.sin(w * tt);
    return {
      kind: 'body', x, y: 0, vx, vy: 0,
      ke: 0.5 * m * vx * vx,
      pe: 0.5 * k * x * x,
    };
  }
  if (type === 'pendulum') {
    const L = Math.max(0.2, params.L ?? 1.5);
    const g = Math.max(0.1, params.g ?? 9.8);
    const m = Math.max(0.01, params.m ?? 1);
    const th0 = (params.theta0 ?? 25) * DEG;
    const st = pendulumNonlinearAt(L, params.theta0 ?? 25, g, m, tt);
    const w = Math.sqrt(g / L);
    const small = th0 * Math.cos(w * tt);
    const vx = L * Math.cos(st.theta) * st.omega;
    const vy = L * Math.sin(st.theta) * st.omega;
    return {
      kind: 'body', x: st.x, y: st.y, vx, vy,
      theta: st.theta, omega: st.omega,
      altX: L * Math.sin(small), altY: -L * Math.cos(small),
      ke: 0.5 * m * (vx * vx + vy * vy),
      pe: m * g * L * (1 - Math.cos(st.theta)),
    };
  }
  if (type === 'inclineLab') {
    const alpha = params.alpha ?? 30;
    const m = Math.max(0.01, params.m ?? 1);
    const g = Math.max(0.1, params.g ?? 9.8);
    const L = Math.max(0.05, params.L ?? 2);
    const rad = alpha * DEG;
    const st = inclineBodyAt(alpha, params.mu ?? 0.3, g, m, L, tt);
    return {
      kind: 'body', x: st.s, y: 0, vx: st.v, vy: 0, ax: st.a,
      fx: st.gravityAlong - st.friction,
      fy: st.normal - m * g * Math.cos(rad),
      ke: 0.5 * m * st.v * st.v,
      pe: m * g * (L - st.s) * Math.sin(rad),
      theta: rad,
    };
  }
  if (type === 'collisionLab') {
    const st = collision1DAt(
      params.m1 ?? 1, params.v1 ?? 2, params.m2 ?? 2, params.v2 ?? -1, params.e ?? 1, tt,
    );
    return {
      kind: 'body', x: st.x1, y: 0, vx: st.v1, vy: 0,
      altX: st.x2, altY: 0,
      fx: st.impulse, ke: st.kinetic, pe: 0,
    };
  }
  if (type === 'resonanceLab') {
    const k = Math.max(0.01, params.k ?? 10);
    const m = Math.max(0.01, params.m ?? 1);
    const c = Math.max(0, params.c ?? 0.5);
    const st = forcedSpringAt(k, m, c, params.f0 ?? 1, params.wd ?? 3.16, tt);
    return {
      kind: 'body', x: st.x, y: 0, vx: st.v, vy: 0,
      ax: (-k * st.x - c * st.v + st.drive) / m,
      fx: st.drive, ke: st.ke, pe: st.pe,
    };
  }
  // waveLab：x 与 theta 只作时钟载体，Body 内调 waveSamples 采样
  return { kind: 'body', x: tt, y: 0, vx: 0, vy: 0, theta: tt };
}

/** 采样整条轨迹（供节点自绘预览路径）。n 个点、t ∈ [0, tEnd]。 */
export function samplePath(
  type: PhysNodeType,
  params: Record<string, number>,
  tEnd: number,
  n = 60,
): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const b = bodyAt(type, params, (i / n) * tEnd);
    if (b.kind === 'body') pts.push([b.x, b.y]);
  }
  return pts;
}

export function speed(b: Extract<PortValue, { kind: 'body' }>): number {
  return Math.hypot(b.vx, b.vy);
}