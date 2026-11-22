/**
 * physicsPipelineMech.ts —— 力学四条管线内核（C-PHYSICS-KERNELS@1 力学部分）。
 *
 * 管线键：projectile-drag / incline-friction / collision-momentum / oscillation-wave。
 * 每条管线 4–5 个环节，源环节提供控件与预设，下游按合并后的 params 纯函数重算；
 * 时间帧统一表示运动时刻或扫描进度，同参数重复求值逐值一致。
 *
 * 数值来源：抛体用理想/线性阻力闭式解；斜面、碰撞、单摆、受迫振动与波场
 * 复用既有 physics.ts 的确定性内核，不引入任何伪数值。
 */
import type { PipelineControl } from './lab408PipelineTypes.ts';
import type {
  ScienceData,
  ScienceFrame,
  ScienceLabel,
  ScienceMetric,
  SciencePath,
  SciencePoint,
  SciencePipelineMap,

  ScienceResult,
  ScienceScene,
  ScienceStage,
  ScienceVector,
} from './sciencePipelineTypes.ts';
import {
  collision1DAt,
  forcedSpringAt,
  inclineBodyAt,
  pendulumNonlinearAt,
  pendulumPeriod,
  resonanceCurve,
  waveSamples,
} from './physics.ts';

const DEG = Math.PI / 180;
const FRAMES = 61;

const COLOR = {
  ideal: '#2563eb',
  drag: '#ea580c',
  gravity: '#dc2626',
  normal: '#059669',
  friction: '#d97706',
  velocity: '#7c3aed',
  energy: '#0f766e',
  kinetic: '#2563eb',
  potential: '#9333ea',
  heat: '#ea580c',
  grid: '#cbd5e1',
  axis: '#64748b',
  body1: '#2563eb',
  body2: '#ea580c',
  small: '#0891b2',
  big: '#ea580c',
  curve: '#0f172a',
} as const;

function num(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function atLeast(value: number | undefined, fallback: number, min: number): number {
  return Math.max(min, num(value, fallback));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function fmt(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function metric(label: string, value: string, emphasis = false): ScienceMetric {
  return emphasis ? { label, value, emphasis: true } : { label, value };
}

function pathOf(points: [number, number][], stroke: string, dashed = false, strokeWidth = 2): SciencePath {
  return { points, stroke, strokeWidth, dashed };
}

function line(x1: number, y1: number, x2: number, y2: number, stroke: string, dashed = false): SciencePath {
  return { points: [[x1, y1], [x2, y2]], stroke, strokeWidth: 1.5, dashed };
}

function labelAt(x: number, y: number, text: string, color = '#334155', size = 11): ScienceLabel {
  return { x, y, text, color, size };
}

function vec(x: number, y: number, dx: number, dy: number, color: string, label?: string): ScienceVector {
  return label === undefined ? { x, y, dx, dy, color } : { x, y, dx, dy, color, label };
}

function dot(x: number, y: number, color: string, radius = 5, label?: string): SciencePoint {
  return label === undefined ? { x, y, color, radius } : { x, y, color, radius, label };
}

function frame(title: string, scene: ScienceScene, metrics: ScienceMetric[], rows?: (string | number)[][]): ScienceFrame {
  return rows === undefined ? { title, scene, metrics } : { title, scene, metrics, rows };
}

function scienceResult(text: string, params: Record<string, number>, frames: ScienceFrame[]): ScienceResult {
  const data: ScienceData = { parameters: { ...params }, text };
  return { data, frames };
}

function times(end: number, count = FRAMES): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push((i / (count - 1)) * end);
  return out;
}

function axes(scene: ScienceScene): ScienceScene {
  return { ...scene, axes: true };
}

// ---------------------------------------------------------------------------
// projectile-drag：理想 / 线性阻力抛体
// ---------------------------------------------------------------------------

export interface ProjectileState { x: number; y: number; vx: number; vy: number }
export interface ProjectileFlight { time: number; range: number; height: number }

interface ProjectileParams { v0: number; angle: number; g: number; m: number; k: number }

function projectileParams(p: Record<string, number>): ProjectileParams {
  return {
    v0: atLeast(p.v0, 18, 0.5),
    angle: clamp(num(p.angle, 55), 1, 89),
    g: atLeast(p.g, 9.8, 0.1),
    m: atLeast(p.m, 1, 0.01),
    k: Math.max(0, num(p.k, 0.12)),
  };
}

/** 理想抛体：t 时刻位置与速度，y 向上为正，不夹持（落地判定由调用方处理）。 */
export function projectileIdealAt(v0: number, angleDeg: number, g: number, t: number): ProjectileState {
  const speed = atLeast(v0, 18, 0.5);
  const grav = atLeast(g, 9.8, 0.1);
  const theta = clamp(num(angleDeg, 55), 1, 89) * DEG;
  const tt = Math.max(0, num(t, 0));
  const vx = speed * Math.cos(theta);
  return {
    x: vx * tt,
    y: speed * Math.sin(theta) * tt - 0.5 * grav * tt * tt,
    vx,
    vy: speed * Math.sin(theta) - grav * tt,
  };
}

export function projectileIdealFlight(v0: number, angleDeg: number, g: number): ProjectileFlight {
  const speed = atLeast(v0, 18, 0.5);
  const grav = atLeast(g, 9.8, 0.1);
  const theta = clamp(num(angleDeg, 55), 1, 89) * DEG;
  const vy0 = speed * Math.sin(theta);
  return {
    time: (2 * vy0) / grav,
    range: (speed * speed * Math.sin(2 * theta)) / grav,
    height: (vy0 * vy0) / (2 * grav),
  };
}

/**
 * 线性阻力抛体（阻力 −k·v）闭式解，τ=m/k：
 * vx=v0x·e^(−t/τ)，vy=(v0y+gτ)e^(−t/τ)−gτ；
 * x=v0x·τ(1−e^(−t/τ))，y=(v0y+gτ)τ(1−e^(−t/τ))−gτ·t。
 * k→0 时退化为理想解，避免除零。
 */
export function projectileDragAt(
  v0: number,
  angleDeg: number,
  g: number,
  m: number,
  k: number,
  t: number,
): ProjectileState {
  const mass = atLeast(m, 1, 0.01);
  const coef = Math.max(0, num(k, 0));
  if (coef <= 1e-9) return projectileIdealAt(v0, angleDeg, g, t);
  const speed = atLeast(v0, 18, 0.5);
  const grav = atLeast(g, 9.8, 0.1);
  const theta = clamp(num(angleDeg, 55), 1, 89) * DEG;
  const tt = Math.max(0, num(t, 0));
  const tau = mass / coef;
  const decay = Math.exp(-tt / tau);
  const vx0 = speed * Math.cos(theta);
  const vy0 = speed * Math.sin(theta);
  return {
    x: vx0 * tau * (1 - decay),
    y: (vy0 + grav * tau) * tau * (1 - decay) - grav * tau * tt,
    vx: vx0 * decay,
    vy: (vy0 + grav * tau) * decay - grav * tau,
  };
}

/** 阻力弹道飞行时间：y(t) 单调越过零点后用 60 次二分求根，确定性射程/最高点。 */
export function projectileDragFlight(v0: number, angleDeg: number, g: number, m: number, k: number): ProjectileFlight {
  const coef = Math.max(0, num(k, 0));
  if (coef <= 1e-9) return projectileIdealFlight(v0, angleDeg, g);
  const grav = atLeast(g, 9.8, 0.1);
  const mass = atLeast(m, 1, 0.01);
  const speed = atLeast(v0, 18, 0.5);
  const theta = clamp(num(angleDeg, 55), 1, 89) * DEG;
  const tau = mass / coef;
  const vy0 = speed * Math.sin(theta);
  const apexTime = tau * Math.log(1 + vy0 / (grav * tau));
  const apex = projectileDragAt(v0, angleDeg, g, m, k, apexTime);
  let lo = apexTime;
  let hi = Math.max(apexTime * 2, 0.5);
  for (let i = 0; i < 80; i++) {
    if (projectileDragAt(v0, angleDeg, g, m, k, hi).y < 0) break;
    hi *= 2;
  }
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (projectileDragAt(v0, angleDeg, g, m, k, mid).y > 0) lo = mid;
    else hi = mid;
  }
  const time = (lo + hi) / 2;
  return { time, range: projectileDragAt(v0, angleDeg, g, m, k, time).x, height: apex.y };
}

/** 落地前返回真实状态，落地后夹持在落点（速度归零），不绘制地下伪轨迹。 */
function airborneState(state: ProjectileState, flight: ProjectileFlight, t: number): ProjectileState {
  if (t < flight.time) return state;
  return { x: flight.range, y: 0, vx: 0, vy: 0 };
}

function projectileEnergy(state: ProjectileState, m: number, g: number): { ke: number; pe: number; total: number } {
  const ke = 0.5 * m * (state.vx * state.vx + state.vy * state.vy);
  const pe = m * g * Math.max(0, state.y);
  return { ke, pe, total: ke + pe };
}

interface ProjectileView {
  toPoint: (state: ProjectileState) => [number, number];
  ground: SciencePath;
}

function projectileView(p: ProjectileParams): ProjectileView {
  const ideal = projectileIdealFlight(p.v0, p.angle, p.g);
  const drag = projectileDragFlight(p.v0, p.angle, p.g, p.m, p.k);
  const xMax = Math.max(ideal.range, drag.range, 1) * 1.08;
  const yMax = Math.max(ideal.height, drag.height, 0.5) * 1.25;
  const scale = Math.min(320 / xMax, 150 / yMax);
  return {
    toPoint: (state) => [40 + state.x * scale, 200 - Math.max(0, state.y) * scale],
    ground: line(24, 200, 384, 200, COLOR.axis),
  };
}

function speedVector(state: ProjectileState, color: string, scale: number): ScienceVector | null {
  const speed = Math.hypot(state.vx, state.vy);
  if (speed < 1e-9) return null;
  return { x: 0, y: 0, dx: (state.vx / speed) * scale, dy: (-state.vy / speed) * scale, color };
}

const projectileSourceControls: PipelineControl[] = [
  { key: 'v0', label: '初速率 v₀ (m/s)', value: 18, min: 1, max: 60, step: 0.5 },
  { key: 'angle', label: '发射角 θ (°)', value: 55, min: 5, max: 85, step: 1 },
  { key: 'g', label: '重力加速度 g (m/s²)', value: 9.8, min: 1, max: 25, step: 0.1 },
  { key: 'm', label: '质量 m (kg)', value: 1, min: 0.1, max: 10, step: 0.1 },
  { key: 'k', label: '线性阻力系数 k (N·s/m)', value: 0.12, min: 0, max: 2, step: 0.01 },
];

const projectileSource: ScienceStage = {
  id: 'source',
  title: '发射参数',
  diagram: 'source',
  controls: projectileSourceControls,
  presets: [
    { label: '标准抛体', params: { v0: 18, angle: 55, g: 9.8, m: 1, k: 0.12 } },
    { label: '无阻力对照', params: { v0: 18, angle: 55, g: 9.8, m: 1, k: 0 } },
    { label: '强阻力短程', params: { v0: 22, angle: 45, g: 9.8, m: 1, k: 0.8 } },
  ],
  run: ({ text, params }) => {
    const p = projectileParams(params);
    const ideal = projectileIdealFlight(p.v0, p.angle, p.g);
    const drag = projectileDragFlight(p.v0, p.angle, p.g, p.m, p.k);
    const launch = vec(40, 200, 60 * Math.cos(p.angle * DEG), -60 * Math.sin(p.angle * DEG), COLOR.velocity, 'v₀');
    const scene: ScienceScene = {
      ariaLabel: '抛体发射参数示意',
      paths: [line(24, 200, 384, 200, COLOR.axis), line(40, 200, 110, 200, COLOR.grid, true)],
      vectors: [launch],
      points: [dot(40, 200, COLOR.curve, 5)],
      labels: [
        labelAt(30, 222, '发射点'),
        labelAt(200, 30, `理想射程 ${fmt(ideal.range)} m / 阻力射程 ${fmt(drag.range)} m`),
      ],
    };
    const rows: (string | number)[][] = [
      ['初速率 v₀', fmt(p.v0), 'm/s'],
      ['发射角 θ', fmt(p.angle, 1), '°'],
      ['阻力系数 k', fmt(p.k), 'N·s/m'],
      ['理想飞行时间', fmt(ideal.time), 's'],
      ['阻力飞行时间', fmt(drag.time), 's'],
    ];
    return scienceResult(text, params, [frame('发射参数', scene, [
      metric('理想射程', `${fmt(ideal.range)} m`),
      metric('阻力射程', `${fmt(drag.range)} m`, true),
      metric('理想最高点', `${fmt(ideal.height)} m`),
      metric('阻力最高点', `${fmt(drag.height)} m`),
    ], rows)]);
  },
};

const projectileIdealStage: ScienceStage = {
  id: 'ideal',
  title: '理想弹道',
  diagram: 'motion',
  inputs: ['source'],
  run: ({ text, params }) => {
    const p = projectileParams(params);
    const flight = projectileIdealFlight(p.v0, p.angle, p.g);
    const view = projectileView(p);
    const states = times(flight.time).map((t) => projectileIdealAt(p.v0, p.angle, p.g, t));
    const frames = states.map((state, i) => {
      const t = (i / (FRAMES - 1)) * flight.time;
      const track = states.slice(0, i + 1).map(view.toPoint);
      const [cx, cy] = view.toPoint(state);
      const speed = Math.hypot(state.vx, state.vy);
      const v = speedVector(state, COLOR.velocity, 34);
      const vectors: ScienceVector[] = [vec(cx, cy, 0, 30, COLOR.gravity, 'mg')];
      if (v) vectors.push({ ...v, x: cx, y: cy, label: 'v' });
      const scene: ScienceScene = {
        ariaLabel: '理想抛体弹道',
        paths: [view.ground, pathOf(states.map(view.toPoint), COLOR.grid, true), pathOf(track, COLOR.ideal)],
        vectors,
        points: [dot(cx, cy, COLOR.ideal, 6)],
        labels: [labelAt(200, 26, `t = ${fmt(t)} s`)],
      };
      return frame(`理想弹道 t=${fmt(t)}s`, axes(scene), [
        metric('时刻 t', `${fmt(t)} s`),
        metric('位置 (x, y)', `(${fmt(state.x)}, ${fmt(state.y)}) m`),
        metric('速率 |v|', `${fmt(speed)} m/s`),
        metric('理论射程', `${fmt(flight.range)} m`, true),
      ]);
    });
    return scienceResult(text, params, frames);
  },
};

const projectileDragStage: ScienceStage = {
  id: 'drag',
  title: '线性阻力弹道',
  diagram: 'force',
  inputs: ['source'],
  run: ({ text, params }) => {
    const p = projectileParams(params);
    const flight = projectileDragFlight(p.v0, p.angle, p.g, p.m, p.k);
    const view = projectileView(p);
    const states = times(flight.time).map((t) => projectileDragAt(p.v0, p.angle, p.g, p.m, p.k, t));
    const frames = states.map((state, i) => {
      const t = (i / (FRAMES - 1)) * flight.time;
      const shown = airborneState(state, flight, t);
      const [cx, cy] = view.toPoint(shown);
      const speed = Math.hypot(shown.vx, shown.vy);
      const dragForce = p.k * speed;
      const vectors: ScienceVector[] = [vec(cx, cy, 0, 30, COLOR.gravity, 'mg')];
      const v = speedVector(shown, COLOR.velocity, 34);
      if (v) {
        vectors.push({ ...v, x: cx, y: cy, label: 'v' });
        vectors.push(vec(cx, cy, -v.dx * 0.8, -v.dy * 0.8, COLOR.drag, 'f=kv'));
      }
      const scene: ScienceScene = {
        ariaLabel: '线性阻力抛体弹道与受力',
        paths: [view.ground, pathOf(states.map(view.toPoint), COLOR.grid, true), pathOf(states.slice(0, i + 1).map(view.toPoint), COLOR.drag)],
        vectors,
        points: [dot(cx, cy, COLOR.drag, 6)],
        labels: [labelAt(200, 26, `t = ${fmt(t)} s`)],
      };
      return frame(`阻力弹道 t=${fmt(t)}s`, axes(scene), [
        metric('时刻 t', `${fmt(t)} s`),
        metric('位置 (x, y)', `(${fmt(shown.x)}, ${fmt(shown.y)}) m`),
        metric('速率 |v|', `${fmt(speed)} m/s`),
        metric('阻力大小 kv', `${fmt(dragForce)} N`),
        metric('阻力射程', `${fmt(flight.range)} m`, true),
      ]);
    });
    return scienceResult(text, params, frames);
  },
};

const projectileEnergyStage: ScienceStage = {
  id: 'energy',
  title: '机械能损耗',
  diagram: 'energy',
  inputs: ['drag'],
  run: ({ text, params }) => {
    const p = projectileParams(params);
    const flight = projectileDragFlight(p.v0, p.angle, p.g, p.m, p.k);
    const initial = 0.5 * p.m * p.v0 * p.v0;
    const samples = times(flight.time).map((t) => {
      const state = airborneState(projectileDragAt(p.v0, p.angle, p.g, p.m, p.k, t), flight, t);
      return projectileEnergy(state, p.m, p.g);
    });
    const yMax = Math.max(initial, 1e-6) * 1.1;
    const toPoint = (i: number, value: number): [number, number] => [
      40 + (i / (FRAMES - 1)) * 320,
      200 - (value / yMax) * 160,
    ];
    const frames = samples.map((energy, i) => {
      const t = (i / (FRAMES - 1)) * flight.time;
      const take = (pick: (e: { ke: number; pe: number; total: number }) => number): [number, number][] =>
        samples.slice(0, i + 1).map((e, j) => toPoint(j, pick(e)));
      const scene: ScienceScene = {
        ariaLabel: '阻力抛体机械能随时间变化',
        paths: [
          line(40, 200, 370, 200, COLOR.axis),
          line(40, 200 - (initial / yMax) * 160, 370, 200 - (initial / yMax) * 160, COLOR.grid, true),
          pathOf(take((e) => e.total), COLOR.energy),
          pathOf(take((e) => e.ke), COLOR.kinetic),
          pathOf(take((e) => e.pe), COLOR.potential),
        ],
        points: [
          dot(...toPoint(i, energy.total), COLOR.energy, 4),
          dot(...toPoint(i, energy.ke), COLOR.kinetic, 4),
          dot(...toPoint(i, energy.pe), COLOR.potential, 4),
        ],
        labels: [
          labelAt(46, 30, 'E 总'),
          labelAt(110, 30, 'KE', COLOR.kinetic),
          labelAt(160, 30, 'PE', COLOR.potential),
          labelAt(280, 200 - (initial / yMax) * 160 - 8, '初始机械能 E₀'),
        ],
      };
      const loss = initial - energy.total;
      return frame(`机械能 t=${fmt(t)}s`, axes(scene), [
        metric('时刻 t', `${fmt(t)} s`),
        metric('动能 KE', `${fmt(energy.ke)} J`),
        metric('势能 PE', `${fmt(energy.pe)} J`),
        metric('机械能 E', `${fmt(energy.total)} J`, true),
        metric('累计损耗 E₀−E', `${fmt(loss)} J（${fmt((loss / Math.max(initial, 1e-9)) * 100, 1)}%）`),
      ]);
    });
    return scienceResult(text, params, frames);
  },
};

const projectileCompareStage: ScienceStage = {
  id: 'compare',
  title: '理想 / 阻力对照',
  diagram: 'summary',
  inputs: ['ideal', 'drag'],
  run: ({ text, params }) => {
    const p = projectileParams(params);
    const ideal = projectileIdealFlight(p.v0, p.angle, p.g);
    const drag = projectileDragFlight(p.v0, p.angle, p.g, p.m, p.k);
    const view = projectileView(p);
    const end = Math.max(ideal.time, drag.time);
    const idealStates = times(end).map((t) =>
      airborneState(projectileIdealAt(p.v0, p.angle, p.g, t), ideal, t));
    const dragStates = times(end).map((t) =>
      airborneState(projectileDragAt(p.v0, p.angle, p.g, p.m, p.k, t), drag, t));
    const idealLand = idealStates[idealStates.length - 1] as ProjectileState;
    const dragLand = dragStates[dragStates.length - 1] as ProjectileState;
    const idealEnergy = projectileEnergy(idealLand, p.m, p.g).total;
    const dragEnergy = projectileEnergy(dragLand, p.m, p.g).total;
    const initial = 0.5 * p.m * p.v0 * p.v0;
    const rows: (string | number)[][] = [
      ['物理量', '理想弹道', '线性阻力弹道'],
      ['射程 R (m)', fmt(ideal.range), fmt(drag.range)],
      ['飞行时间 T (s)', fmt(ideal.time), fmt(drag.time)],
      ['最高点 H (m)', fmt(ideal.height), fmt(drag.height)],
      ['落地速率 (m/s)', fmt(Math.hypot(idealLand.vx, idealLand.vy)), fmt(Math.hypot(dragLand.vx, dragLand.vy))],
      ['落地机械能 (J)', fmt(idealEnergy), fmt(dragEnergy)],
      ['机械能损耗 (J)', '0.00', fmt(initial - dragEnergy)],
    ];
    const frames = idealStates.map((state, i) => {
      const t = (i / (FRAMES - 1)) * end;
      const other = dragStates[i] as ProjectileState;
      const [ix, iy] = view.toPoint(state);
      const [dx, dy] = view.toPoint(other);
      const scene: ScienceScene = {
        ariaLabel: '理想与阻力弹道对照',
        paths: [
          view.ground,
          pathOf(idealStates.map(view.toPoint), COLOR.grid, true),
          pathOf(dragStates.map(view.toPoint), COLOR.grid, true),
          pathOf(idealStates.slice(0, i + 1).map(view.toPoint), COLOR.ideal),
          pathOf(dragStates.slice(0, i + 1).map(view.toPoint), COLOR.drag),
        ],
        points: [dot(ix, iy, COLOR.ideal, 6, '理想'), dot(dx, dy, COLOR.drag, 6, '阻力')],
        labels: [
          labelAt(40, 26, `t = ${fmt(t)} s`),
          labelAt(250, 26, `射程比 ${fmt(drag.range / Math.max(ideal.range, 1e-9), 3)}`),
        ],
      };
      return frame(`对照 t=${fmt(t)}s`, axes(scene), [
        metric('理想射程', `${fmt(ideal.range)} m`),
        metric('阻力射程', `${fmt(drag.range)} m`, true),
        metric('射程缩减', `${fmt((1 - drag.range / Math.max(ideal.range, 1e-9)) * 100, 1)}%`),
        metric('阻力机械能损耗', `${fmt(initial - dragEnergy)} J`),
      ], rows);
    });
    return scienceResult(text, params, frames);
  },
};

// ---------------------------------------------------------------------------
// incline-friction：斜面静 / 动摩擦
// ---------------------------------------------------------------------------

interface InclineParams { alpha: number; mu: number; g: number; m: number; L: number }

function inclineParams(p: Record<string, number>): InclineParams {
  return {
    alpha: clamp(num(p.alpha, 30), 0, 75),
    mu: Math.max(0, num(p.mu, 0.3)),
    g: atLeast(p.g, 9.8, 0.1),
    m: atLeast(p.m, 1, 0.01),
    L: atLeast(p.L, 2.4, 0.05),
  };
}

/** 静摩擦自锁的临界倾角：tanαc = μ。 */
export function inclineCriticalAngleDeg(mu: number): number {
  return Math.atan(Math.max(0, num(mu, 0))) / DEG;
}

function inclineSlideTime(p: InclineParams): number {
  const rad = p.alpha * DEG;
  if (Math.tan(rad) <= p.mu) return 1.5;
  const a = Math.max(1e-6, p.g * (Math.sin(rad) - p.mu * Math.cos(rad)));
  return Math.sqrt((2 * p.L) / a);
}

interface InclineView {
  origin: [number, number];
  along: (s: number) => [number, number];
  base: SciencePath[];
}

function inclineView(params: InclineParams): InclineView {
  const rad = params.alpha * DEG;
  const px = 110 / Math.max(params.L, 0.05);
  const ox = 80;
  const oy = 190;
  const topX = ox + params.L * Math.cos(rad) * px;
  const topY = oy - params.L * Math.sin(rad) * px;
  return {
    origin: [ox, oy],
    along: (s) => [topX - s * Math.cos(rad) * px, topY + s * Math.sin(rad) * px],
    base: [
      pathOf([[ox, oy], [ox + params.L * Math.cos(rad) * px + 60, oy], [topX, topY], [ox, oy]], COLOR.axis, false, 1.5),
      line(topX, topY, ox, oy, COLOR.curve),
    ],
  };
}

const inclineSource: ScienceStage = {
  id: 'source',
  title: '斜面参数',
  diagram: 'source',
  controls: [
    { key: 'alpha', label: '倾角 α (°)', value: 30, min: 0, max: 60, step: 1 },
    { key: 'mu', label: '摩擦系数 μ', value: 0.3, min: 0, max: 1.2, step: 0.01 },
    { key: 'm', label: '质量 m (kg)', value: 1, min: 0.1, max: 10, step: 0.1 },
    { key: 'g', label: '重力加速度 g (m/s²)', value: 9.8, min: 1, max: 25, step: 0.1 },
    { key: 'L', label: '斜面长度 L (m)', value: 2.4, min: 0.2, max: 10, step: 0.1 },
  ],
  presets: [
    { label: '加速下滑', params: { alpha: 40, mu: 0.2, m: 1, g: 9.8, L: 2.4 } },
    { label: '临界平衡 tanα=μ', params: { alpha: 30, mu: Math.tan(30 * DEG), m: 1, g: 9.8, L: 2.4 } },
    { label: '静摩擦自锁', params: { alpha: 20, mu: 0.6, m: 1, g: 9.8, L: 2.4 } },
  ],
  run: ({ text, params }) => {
    const p = inclineParams(params);
    const critical = inclineCriticalAngleDeg(p.mu);
    const sliding = Math.tan(p.alpha * DEG) > p.mu;
    const view = inclineView(p);
    const [bx, by] = view.along(0);
    const scene: ScienceScene = {
      ariaLabel: '斜面参数示意',
      paths: view.base,
      rects: [{ x: bx - 12, y: by - 24, width: 24, height: 24, fill: '#bfdbfe', stroke: COLOR.ideal }],
      labels: [
        labelAt(200, 30, sliding ? 'tanα > μ：将加速下滑' : 'tanα ≤ μ：静摩擦自锁'),
        labelAt(200, 50, `临界倾角 αc = ${fmt(critical, 2)}°`),
      ],
    };
    return scienceResult(text, params, [frame('斜面参数', scene, [
      metric('tanα', fmt(Math.tan(p.alpha * DEG), 3)),
      metric('μ', fmt(p.mu, 3)),
      metric('临界倾角 αc', `${fmt(critical, 2)}°`, true),
      metric('当前状态', sliding ? '加速下滑' : '静摩擦平衡'),
    ], [
      ['倾角 α', fmt(p.alpha, 1), '°'],
      ['摩擦系数 μ', fmt(p.mu, 3), ''],
      ['斜面长度 L', fmt(p.L), 'm'],
      ['质量 m', fmt(p.m), 'kg'],
    ])]);
  },
};

const inclineForces: ScienceStage = {
  id: 'forces',
  title: '受力与临界判定',
  diagram: 'force',
  inputs: ['source'],
  run: ({ text, params }) => {
    const p = inclineParams(params);
    const state = inclineBodyAt(p.alpha, p.mu, p.g, p.m, p.L, 0);
    const rad = p.alpha * DEG;
    const view = inclineView(p);
    const [bx, by] = view.along(0);
    const cx = bx;
    const cy = by - 12;
    const critical = inclineCriticalAngleDeg(p.mu);
    const scene: ScienceScene = {
      ariaLabel: '斜面受力分析',
      paths: view.base,
      rects: [{ x: bx - 12, y: by - 24, width: 24, height: 24, fill: '#bfdbfe', stroke: COLOR.ideal }],
      vectors: [
        vec(cx, cy, 0, 46, COLOR.gravity, 'mg'),
        vec(cx, cy, 40 * Math.cos(rad), -40 * Math.sin(rad), COLOR.normal, 'N'),
        vec(cx, cy, -34 * Math.cos(rad), 34 * Math.sin(rad), COLOR.friction, 'f'),
        vec(cx, cy, 30 * Math.sin(rad), 30 * Math.cos(rad), COLOR.gravity, 'mg·sinα 分量'),
      ],
      labels: [
        labelAt(200, 24, `tanα = ${fmt(Math.tan(rad), 3)}，μ = ${fmt(p.mu, 3)}`),
        labelAt(200, 42, state.sliding ? '滑动：f = μN（动摩擦）' : '静止：f = mg·sinα ≤ μN（静摩擦）', state.sliding ? COLOR.drag : COLOR.normal),
      ],
    };
    return scienceResult(text, params, [frame('受力分析', scene, [
      metric('重力分量 mg·sinα', `${fmt(state.gravityAlong)} N`),
      metric('法向力 N', `${fmt(state.normal)} N`),
      metric('摩擦力 f', `${fmt(state.friction)} N`, true),
      metric('最大静摩擦 μN', `${fmt(p.mu * state.normal)} N`),
      metric('状态', state.sliding ? '加速下滑' : '静摩擦平衡'),
      metric('临界倾角', `${fmt(critical, 2)}°`),
    ], [
      ['力', '大小 (N)', '说明'],
      ['重力分量 mg·sinα', fmt(state.gravityAlong), '沿斜面向下'],
      ['法向力 N = mg·cosα', fmt(state.normal), '垂直斜面'],
      ['摩擦力 f', fmt(state.friction), state.sliding ? 'μN，沿斜面向上' : '与重力分量平衡'],
      ['净力', fmt(Math.max(0, state.gravityAlong - state.friction)), state.sliding ? '产生加速度' : '为零'],
    ])]);
  },
};

const inclineSlide: ScienceStage = {
  id: 'slide',
  title: '滑动过程',
  diagram: 'motion',
  inputs: ['forces'],
  run: ({ text, params }) => {
    const p = inclineParams(params);
    const end = inclineSlideTime(p);
    const view = inclineView(p);
    const sliding = Math.tan(p.alpha * DEG) > p.mu;
    const states = times(end).map((t) => inclineBodyAt(p.alpha, p.mu, p.g, p.m, p.L, t));
    const frames = states.map((state, i) => {
      const t = (i / (FRAMES - 1)) * end;
      const [bx, by] = view.along(state.s);
      const rad = p.alpha * DEG;
      const track = states.slice(0, i + 1).map((s, j): [number, number] => [
        230 + (j / (FRAMES - 1)) * 140,
        150 - (s.s / Math.max(p.L, 1e-6)) * 100,
      ]);
      const scene: ScienceScene = {
        ariaLabel: '斜面滑动过程与位移曲线',
        paths: [...view.base, line(230, 150, 380, 150, COLOR.axis), line(230, 150, 230, 40, COLOR.axis), pathOf(track, COLOR.ideal)],
        rects: [{ x: bx - 12, y: by - 24, width: 24, height: 24, fill: '#bfdbfe', stroke: COLOR.ideal }],
        vectors: state.v > 1e-9
          ? [vec(bx, by - 12, 30 * Math.cos(rad) * Math.sign(state.v), -30 * Math.sin(rad) * Math.sign(state.v), COLOR.velocity, 'v')]
          : [],
        points: [dot(230 + (i / (FRAMES - 1)) * 140, 150 - (state.s / Math.max(p.L, 1e-6)) * 100, COLOR.ideal, 4)],
        labels: [
          labelAt(60, 24, `t = ${fmt(t)} s`),
          labelAt(290, 40, 's–t'),
          labelAt(60, 220, sliding ? `a = g(sinα−μcosα) = ${fmt(state.a)} m/s²` : '静摩擦自锁：位移恒为 0'),
        ],
      };
      return frame(`滑动 t=${fmt(t)}s`, scene, [
        metric('时刻 t', `${fmt(t)} s`),
        metric('位移 s', `${fmt(state.s)} m`, true),
        metric('速度 v', `${fmt(state.v)} m/s`),
        metric('加速度 a', `${fmt(state.a)} m/s²`),
        metric('状态', state.sliding ? (state.s >= p.L - 1e-9 ? '已到达底端' : '滑动中') : '静止'),
      ]);
    });
    return scienceResult(text, params, frames);
  },
};

const inclineEnergy: ScienceStage = {
  id: 'energy',
  title: '功与热耗散',
  diagram: 'energy',
  inputs: ['slide'],
  run: ({ text, params }) => {
    const p = inclineParams(params);
    const end = inclineSlideTime(p);
    const rad = p.alpha * DEG;
    const samples = times(end).map((t) => {
      const state = inclineBodyAt(p.alpha, p.mu, p.g, p.m, p.L, t);
      const wg = p.m * p.g * state.s * Math.sin(rad);
      const heat = state.sliding ? state.friction * state.s : 0;
      const ke = 0.5 * p.m * state.v * state.v;
      return { state, wg, heat, ke };
    });
    const yMax = Math.max(p.m * p.g * p.L * Math.sin(rad), 1e-6) * 1.1;
    const toPoint = (i: number, value: number): [number, number] => [
      40 + (i / (FRAMES - 1)) * 320,
      200 - (value / yMax) * 160,
    ];
    const frames = samples.map((sample, i) => {
      const t = (i / (FRAMES - 1)) * end;
      const take = (pick: (s: { wg: number; heat: number; ke: number }) => number): [number, number][] =>
        samples.slice(0, i + 1).map((s, j) => toPoint(j, pick(s)));
      const scene: ScienceScene = {
        ariaLabel: '斜面重力做功、摩擦热与动能',
        paths: [
          line(40, 200, 370, 200, COLOR.axis),
          pathOf(take((s) => s.wg), COLOR.gravity),
          pathOf(take((s) => s.ke), COLOR.kinetic),
          pathOf(take((s) => s.heat), COLOR.heat),
        ],
        points: [
          dot(...toPoint(i, sample.wg), COLOR.gravity, 4),
          dot(...toPoint(i, sample.ke), COLOR.kinetic, 4),
          dot(...toPoint(i, sample.heat), COLOR.heat, 4),
        ],
        labels: [
          labelAt(46, 30, 'W_g', COLOR.gravity),
          labelAt(110, 30, 'KE', COLOR.kinetic),
          labelAt(160, 30, 'Q 热', COLOR.heat),
          labelAt(40, 224, '滑动时恒有 W_g = KE + Q；静止时三者均为 0'),
        ],
      };
      return frame(`能量 t=${fmt(t)}s`, axes(scene), [
        metric('时刻 t', `${fmt(t)} s`),
        metric('重力做功 W_g', `${fmt(sample.wg)} J`),
        metric('摩擦热 Q', `${fmt(sample.heat)} J`, true),
        metric('动能 KE', `${fmt(sample.ke)} J`),
        metric('能量校验 W_g−KE−Q', fmt(sample.wg - sample.ke - sample.heat, 6)),
      ]);
    });
    return scienceResult(text, params, frames);
  },
};

// ---------------------------------------------------------------------------
// collision-momentum：一维碰撞守恒
// ---------------------------------------------------------------------------

interface CollisionParams { m1: number; v1: number; m2: number; v2: number; e: number }

function collisionParams(p: Record<string, number>): CollisionParams {
  return {
    m1: atLeast(p.m1, 1, 0.01),
    v1: num(p.v1, 3),
    m2: atLeast(p.m2, 2, 0.01),
    v2: num(p.v2, -1),
    e: clamp(num(p.e, 0.8), 0, 1),
  };
}

/** 碰后结果；v1≤v2 时两体不会相撞，返回 null 由场景显式表达。 */
function collisionOutcome(p: CollisionParams): ReturnType<typeof collision1DAt> | null {
  if (!(p.v1 - p.v2 > 0)) return null;
  const tc = 2 / (p.v1 - p.v2);
  return collision1DAt(p.m1, p.v1, p.m2, p.v2, p.e, tc + 1);
}

function collisionKinetic0(p: CollisionParams): number {
  return 0.5 * p.m1 * p.v1 * p.v1 + 0.5 * p.m2 * p.v2 * p.v2;
}

function collisionTrackX(x: number): number {
  return 200 + clamp(x, -3, 3) * 56;
}

const collisionSource: ScienceStage = {
  id: 'source',
  title: '碰撞参数',
  diagram: 'source',
  controls: [
    { key: 'm1', label: '质量 m₁ (kg)', value: 1, min: 0.1, max: 10, step: 0.1 },
    { key: 'v1', label: '初速度 v₁ (m/s)', value: 3, min: -10, max: 10, step: 0.1 },
    { key: 'm2', label: '质量 m₂ (kg)', value: 2, min: 0.1, max: 10, step: 0.1 },
    { key: 'v2', label: '初速度 v₂ (m/s)', value: -1, min: -10, max: 10, step: 0.1 },
    { key: 'e', label: '恢复系数 e', value: 0.8, min: 0, max: 1, step: 0.01 },
  ],
  presets: [
    { label: '完全弹性碰撞', params: { m1: 1, v1: 3, m2: 2, v2: -1, e: 1 } },
    { label: '完全非弹性碰撞', params: { m1: 1, v1: 3, m2: 2, v2: -1, e: 0 } },
    { label: '一般非弹性碰撞', params: { m1: 1, v1: 3, m2: 2, v2: -1, e: 0.5 } },
  ],
  run: ({ text, params }) => {
    const p = collisionParams(params);
    const p0 = p.m1 * p.v1 + p.m2 * p.v2;
    const ke0 = collisionKinetic0(p);
    const approaching = p.v1 - p.v2 > 0;
    const scene: ScienceScene = {
      ariaLabel: '碰撞初始条件',
      paths: [line(30, 150, 380, 150, COLOR.axis)],
      rects: [
        { x: collisionTrackX(-1) - 18, y: 126, width: 36, height: 24, fill: '#bfdbfe', stroke: COLOR.body1, label: 'm₁' },
        { x: collisionTrackX(1) - 18, y: 126, width: 36, height: 24, fill: '#fed7aa', stroke: COLOR.body2, label: 'm₂' },
      ],
      vectors: [
        vec(collisionTrackX(-1), 110, clamp(p.v1, -8, 8) * 8, 0, COLOR.body1, 'v₁'),
        vec(collisionTrackX(1), 96, clamp(p.v2, -8, 8) * 8, 0, COLOR.body2, 'v₂'),
      ],
      labels: [labelAt(200, 30, approaching ? `初始动量 P = ${fmt(p0)} kg·m/s` : 'v₁ ≤ v₂：两体不会相撞')],
    };
    return scienceResult(text, params, [frame('碰撞参数', scene, [
      metric('初始总动量', `${fmt(p0)} kg·m/s`, true),
      metric('初始总动能', `${fmt(ke0)} J`),
      metric('恢复系数 e', fmt(p.e, 2)),
      metric('是否相撞', approaching ? '是' : '否（v₁≤v₂）'),
    ], [
      ['物体', '质量 (kg)', '初速度 (m/s)'],
      ['m₁', fmt(p.m1), fmt(p.v1)],
      ['m₂', fmt(p.m2), fmt(p.v2)],
    ])]);
  },
};

const collisionMotion: ScienceStage = {
  id: 'collide',
  title: '慢动作碰撞',
  diagram: 'collision',
  inputs: ['source'],
  run: ({ text, params }) => {
    const p = collisionParams(params);
    const approaching = p.v1 - p.v2 > 0;
    const tc = approaching ? 2 / (p.v1 - p.v2) : 0;
    const end = approaching ? tc * 2 : 2;
    const states = times(end).map((t) => collision1DAt(p.m1, p.v1, p.m2, p.v2, p.e, t));
    const ke0 = collisionKinetic0(p);
    const frames = states.map((state, i) => {
      const t = (i / (FRAMES - 1)) * end;
      const x1 = collisionTrackX(state.x1);
      const x2 = collisionTrackX(state.x2);
      const scene: ScienceScene = {
        ariaLabel: '一维碰撞慢动作',
        paths: [line(30, 150, 380, 150, COLOR.axis), ...(approaching ? [line(collisionTrackX(-1 + p.v1 * tc), 60, collisionTrackX(-1 + p.v1 * tc), 190, COLOR.grid, true)] : [])],
        rects: [
          { x: x1 - 18, y: 126, width: 36, height: 24, fill: '#bfdbfe', stroke: COLOR.body1, label: 'm₁' },
          { x: x2 - 18, y: 126, width: 36, height: 24, fill: '#fed7aa', stroke: COLOR.body2, label: 'm₂' },
        ],
        vectors: [
          vec(x1, 112, clamp(state.v1, -8, 8) * 8, 0, COLOR.body1, 'v₁'),
          vec(x2, 96, clamp(state.v2, -8, 8) * 8, 0, COLOR.body2, 'v₂'),
        ],
        points: state.collided ? [dot((x1 + x2) / 2, 150, '#facc15', 9)] : [],
        labels: [labelAt(200, 30, approaching
          ? `t = ${fmt(t)} s（碰撞时刻 tc = ${fmt(tc)} s）`
          : 'v₁ ≤ v₂：始终匀速、不会相撞')],
      };
      return frame(`碰撞 t=${fmt(t)}s`, scene, [
        metric('时刻 t', `${fmt(t)} s`),
        metric('阶段', !approaching ? '不相撞' : state.collided ? '碰撞后' : '碰撞前'),
        metric('总动量 P', `${fmt(state.momentum)} kg·m/s`, true),
        metric('总动能 KE', `${fmt(state.kinetic)} J`),
        metric('动能保留', `${fmt((state.kinetic / Math.max(ke0, 1e-9)) * 100, 1)}%`),
        metric('冲量 J', state.collided ? `${fmt(state.impulse)} N·s` : '—'),
      ]);
    });
    return scienceResult(text, params, frames);
  },
};

const collisionConserve: ScienceStage = {
  id: 'conserve',
  title: '动量守恒与能量损失',
  diagram: 'summary',
  inputs: ['collide'],
  run: ({ text, params }) => {
    const p = collisionParams(params);
    const outcome = collisionOutcome(p);
    const ke0 = collisionKinetic0(p);
    const p0 = p.m1 * p.v1 + p.m2 * p.v2;
    const ke1 = outcome ? outcome.kinetic : ke0;
    const loss = ke0 - ke1;
    const barMax = Math.max(ke0, ke1, 1e-9);
    const rows: (string | number)[][] = outcome
      ? [
        ['物理量', '碰撞前', '碰撞后'],
        ['v₁ (m/s)', fmt(p.v1), fmt(outcome.v1)],
        ['v₂ (m/s)', fmt(p.v2), fmt(outcome.v2)],
        ['总动量 P (kg·m/s)', fmt(p0), fmt(outcome.momentum)],
        ['总动能 KE (J)', fmt(ke0), fmt(ke1)],
        ['动能损失 ΔKE (J)', '—', fmt(loss)],
        ['冲量 J (N·s)', '—', fmt(outcome.impulse)],
      ]
      : [
        ['物理量', '数值'],
        ['状态', 'v₁≤v₂，不会相撞'],
        ['总动量 P (kg·m/s)', fmt(p0)],
        ['总动能 KE (J)', fmt(ke0)],
      ];
    const scene: ScienceScene = {
      ariaLabel: '碰撞前后动量与动能对照',
      rects: [
        { x: 70, y: 200 - (ke0 / barMax) * 140, width: 60, height: (ke0 / barMax) * 140, fill: '#93c5fd', label: '碰前 KE' },
        { x: 170, y: 200 - (ke1 / barMax) * 140, width: 60, height: (ke1 / barMax) * 140, fill: '#fdba74', label: '碰后 KE' },
        { x: 290, y: 200 - (loss / barMax) * 140, width: 60, height: (loss / barMax) * 140, fill: '#fca5a5', label: '损失 ΔKE' },
      ],
      paths: [line(40, 200, 380, 200, COLOR.axis)],
      labels: [
        labelAt(100, 222, '碰前 KE'),
        labelAt(200, 222, '碰后 KE'),
        labelAt(320, 222, '损失 ΔKE'),
        labelAt(200, 30, outcome ? `动量守恒：P 前 = P 后 = ${fmt(p0)} kg·m/s` : '不相撞：动量动能均不变'),
        labelAt(200, 48, outcome ? `动能损失率 ${fmt((loss / Math.max(ke0, 1e-9)) * 100, 1)}%（e = ${fmt(p.e, 2)}）` : '—'),
      ],
    };
    return scienceResult(text, params, [frame('守恒分析', scene, [
      metric('动量是否守恒', outcome ? '守恒' : '无碰撞', true),
      metric('碰前动能', `${fmt(ke0)} J`),
      metric('碰后动能', `${fmt(ke1)} J`),
      metric('动能损失', `${fmt(loss)} J`),
      metric('冲量', outcome ? `${fmt(outcome.impulse)} N·s` : '—'),
    ], rows)]);
  },
};

const collisionSweep: ScienceStage = {
  id: 'sweep',
  title: '恢复系数扫描',
  diagram: 'energy',
  inputs: ['source'],
  run: ({ text, params }) => {
    const base = collisionParams(params);
    const ke0 = collisionKinetic0(base);
    const approaching = base.v1 - base.v2 > 0;
    const samples: { e: number; ratio: number; v1: number; v2: number }[] = [];
    for (let i = 0; i < FRAMES; i++) {
      const e = i / (FRAMES - 1);
      const outcome = collisionOutcome({ ...base, e });
      samples.push({
        e,
        ratio: outcome ? outcome.kinetic / Math.max(ke0, 1e-9) : 1,
        v1: outcome ? outcome.v1 : base.v1,
        v2: outcome ? outcome.v2 : base.v2,
      });
    }
    const vMax = Math.max(1e-6, ...samples.map((s) => Math.max(Math.abs(s.v1), Math.abs(s.v2))));
    const ratioPoint = (i: number, ratio: number): [number, number] => [50 + (i / (FRAMES - 1)) * 310, 190 - ratio * 130];
    const velocityPoint = (i: number, v: number): [number, number] => [50 + (i / (FRAMES - 1)) * 310, 120 - (v / vMax) * 60];
    const frames = samples.map((sample, i) => {
      const t = sample.e;
      const scene: ScienceScene = {
        ariaLabel: '恢复系数对动能保留率与碰后速度的影响',
        paths: [
          line(50, 190, 370, 190, COLOR.axis),
          line(50, 60, 50, 190, COLOR.axis),
          line(50, 60, 370, 60, COLOR.grid, true),
          ...(approaching ? [
            pathOf(samples.slice(0, i + 1).map((s, j) => ratioPoint(j, s.ratio)), COLOR.energy),
            pathOf(samples.slice(0, i + 1).map((s, j) => velocityPoint(j, s.v1)), COLOR.body1, true),
            pathOf(samples.slice(0, i + 1).map((s, j) => velocityPoint(j, s.v2)), COLOR.body2, true),
          ] : []),
        ],
        points: approaching ? [dot(...ratioPoint(i, sample.ratio), COLOR.energy, 5)] : [],
        labels: [
          labelAt(60, 30, 'KE 保留率（实线）', COLOR.energy),
          labelAt(230, 30, 'v₁′ / v₂′（虚线）'),
          labelAt(50, 212, 'e = 0（完全非弹性）'),
          labelAt(290, 212, 'e = 1（弹性）'),
          labelAt(200, 232, approaching ? `当前 e = ${fmt(sample.e, 2)}` : 'v₁≤v₂：不会相撞，扫描无意义'),
        ],
      };
      return frame(`扫描 e=${fmt(t, 2)}`, scene, [
        metric('恢复系数 e', fmt(sample.e, 2), true),
        metric('动能保留率', approaching ? `${fmt(sample.ratio * 100, 1)}%` : '—'),
        metric('动能损失率', approaching ? `${fmt((1 - sample.ratio) * 100, 1)}%` : '—'),
        metric('碰后 v₁′', approaching ? `${fmt(sample.v1)} m/s` : '—'),
        metric('碰后 v₂′', approaching ? `${fmt(sample.v2)} m/s` : '—'),
      ]);
    });
    return scienceResult(text, params, frames);
  },
};

// ---------------------------------------------------------------------------
// oscillation-wave：单摆对照 / 相空间 / 受迫共振 / 行波驻波
// ---------------------------------------------------------------------------

interface OscParams {
  L: number; theta0: number; g: number; m: number;
  k: number; c: number; f0: number; wd: number;
  amp: number; freq: number; lambda: number; mode: number;
}

function oscParams(p: Record<string, number>): OscParams {
  return {
    L: atLeast(p.L, 1.5, 0.05),
    theta0: clamp(num(p.theta0, 40), 1, 150),
    g: atLeast(p.g, 9.8, 0.1),
    m: atLeast(p.m, 1, 0.01),
    k: atLeast(p.k, 10, 0.01),
    c: Math.max(0, num(p.c, 0.5)),
    f0: Math.max(0, num(p.f0, 1.2)),
    wd: Math.max(0.05, num(p.wd, 3.2)),
    amp: atLeast(p.amp, 0.8, 0.01),
    freq: atLeast(p.freq, 1, 0.01),
    lambda: atLeast(p.lambda, 2, 0.05),
    mode: num(p.mode, 0) >= 0.5 ? 1 : 0,
  };
}

const oscillationSource: ScienceStage = {
  id: 'source',
  title: '振动与波动参数',
  diagram: 'source',
  controls: [
    { key: 'L', label: '摆长 L (m)', value: 1.5, min: 0.2, max: 5, step: 0.05 },
    { key: 'theta0', label: '初始摆角 θ₀ (°)', value: 40, min: 1, max: 150, step: 1 },
    { key: 'g', label: '重力加速度 g (m/s²)', value: 9.8, min: 1, max: 25, step: 0.1 },
    { key: 'm', label: '质量 m (kg)', value: 1, min: 0.1, max: 10, step: 0.1 },
    { key: 'k', label: '弹簧刚度 k (N/m)', value: 10, min: 0.5, max: 100, step: 0.5 },
    { key: 'c', label: '阻尼系数 c (N·s/m)', value: 0.5, min: 0, max: 5, step: 0.05 },
    { key: 'f0', label: '驱动力幅值 F₀ (N)', value: 1.2, min: 0, max: 10, step: 0.1 },
    { key: 'wd', label: '驱动角频率 ωd (rad/s)', value: 3.2, min: 0.1, max: 20, step: 0.05 },
    { key: 'amp', label: '波幅 A (m)', value: 0.8, min: 0.1, max: 2, step: 0.05 },
    { key: 'freq', label: '波频率 f (Hz)', value: 1, min: 0.1, max: 5, step: 0.05 },
    { key: 'lambda', label: '波长 λ (m)', value: 2, min: 0.2, max: 6, step: 0.1 },
    { key: 'mode', label: '波形模式', value: 0, min: 0, max: 1, step: 1, options: [{ value: 0, label: '行波' }, { value: 1, label: '驻波' }] },
  ],
  presets: [
    { label: '小角近似', params: { theta0: 8, L: 1.5, g: 9.8 } },
    { label: '大摆角 100°', params: { theta0: 100, L: 1.5, g: 9.8 } },
    { label: '受迫共振 ωd=ω₀', params: { k: 10, m: 1, c: 0.5, f0: 1.2, wd: Math.sqrt(10) } },
    { label: '驻波演示', params: { mode: 1, amp: 0.8, freq: 1, lambda: 2 } },
  ],
  run: ({ text, params }) => {
    const p = oscParams(params);
    const periodBig = pendulumPeriod(p.L, p.theta0, p.g);
    const periodSmall = 2 * Math.PI * Math.sqrt(p.L / p.g);
    const w0 = Math.sqrt(p.k / p.m);
    const scene: ScienceScene = {
      ariaLabel: '振动与波动参数概览',
      paths: [
        line(200, 40, 200, 70, COLOR.axis),
        line(200, 40, 200 + 80 * Math.sin(p.theta0 * DEG), 40 + 80 * Math.cos(p.theta0 * DEG), COLOR.big),
        line(200, 40, 200 + 80 * Math.sin(8 * DEG), 40 + 80 * Math.cos(8 * DEG), COLOR.small, true),
      ],
      points: [
        dot(200 + 80 * Math.sin(p.theta0 * DEG), 40 + 80 * Math.cos(p.theta0 * DEG), COLOR.big, 7),
        dot(200 + 80 * Math.sin(8 * DEG), 40 + 80 * Math.cos(8 * DEG), COLOR.small, 5),
      ],
      labels: [
        labelAt(200, 190, `单摆周期：大摆角 ${fmt(periodBig)} s / 小角 ${fmt(periodSmall)} s`),
        labelAt(200, 210, `弹簧固有角频率 ω₀ = √（k/m）= ${fmt(w0)} rad/s`),
      ],
    };
    return scienceResult(text, params, [frame('振动波动参数', scene, [
      metric('大摆角周期', `${fmt(periodBig)} s`, true),
      metric('小角周期 T₀', `${fmt(periodSmall)} s`),
      metric('周期比 T/T₀', fmt(periodBig / periodSmall, 4)),
      metric('固有角频率 ω₀', `${fmt(w0)} rad/s`),
      metric('波速 v = fλ', `${fmt(p.freq * p.lambda)} m/s`),
    ])]);
  },
};

const oscillationPendulum: ScienceStage = {
  id: 'pendulum',
  title: '大摆角 / 小角对照',
  diagram: 'oscillation',
  inputs: ['source'],
  run: ({ text, params }) => {
    const p = oscParams(params);
    const period = pendulumPeriod(p.L, p.theta0, p.g);
    const w0 = Math.sqrt(p.g / p.L);
    const th0 = p.theta0 * DEG;
    const samples = times(period).map((t) => {
      const big = pendulumNonlinearAt(p.L, p.theta0, p.g, p.m, t);
      return { t, big, small: th0 * Math.cos(w0 * t) };
    });
    const pivotX = 120;
    const pivotY = 40;
    const pl = 110;
    const toBob = (theta: number): [number, number] => [pivotX + pl * Math.sin(theta), pivotY + pl * Math.cos(theta)];
    const frames = samples.map((sample, i) => {
      const [bx, by] = toBob(sample.big.theta);
      const [sx, sy] = toBob(sample.small);
      const trace = samples.slice(0, i + 1).map((s, j): [number, number] => [
        250 + (j / (FRAMES - 1)) * 130,
        130 - (s.big.theta / Math.max(th0, 1e-6)) * 80,
      ]);
      const traceSmall = samples.slice(0, i + 1).map((s, j): [number, number] => [
        250 + (j / (FRAMES - 1)) * 130,
        130 - (s.small / Math.max(th0, 1e-6)) * 80,
      ]);
      const scene: ScienceScene = {
        ariaLabel: '大摆角与小角单摆对照',
        paths: [
          line(pivotX, pivotY, pivotX, pivotY + pl, COLOR.grid, true),
          line(pivotX, pivotY, bx, by, COLOR.big),
          line(pivotX, pivotY, sx, sy, COLOR.small, true),
          line(250, 130, 385, 130, COLOR.axis),
          pathOf(trace, COLOR.big),
          pathOf(traceSmall, COLOR.small, true),
        ],
        points: [dot(bx, by, COLOR.big, 7), dot(sx, sy, COLOR.small, 5)],
        labels: [
          labelAt(40, 24, `t = ${fmt(sample.t)} s`),
          labelAt(255, 40, 'θ–t：实线大摆角 / 虚线小角'),
          labelAt(40, 210, `大摆角周期 ${fmt(period)} s，小角周期 ${fmt(2 * Math.PI / w0)} s`),
        ],
      };
      const deviation = sample.big.theta - sample.small;
      return frame(`单摆 t=${fmt(sample.t)}s`, scene, [
        metric('时刻 t', `${fmt(sample.t)} s`),
        metric('大摆角 θ', `${fmt(sample.big.theta / DEG, 2)}°`, true),
        metric('小角近似 θ', `${fmt(sample.small / DEG, 2)}°`),
        metric('角度偏差', `${fmt(deviation / DEG, 3)}°`),
        metric('大摆角角速度', `${fmt(sample.big.omega)} rad/s`),
      ]);
    });
    return scienceResult(text, params, frames);
  },
};

const oscillationPhase: ScienceStage = {
  id: 'phase',
  title: '相空间轨迹',
  diagram: 'oscillation',
  inputs: ['pendulum'],
  run: ({ text, params }) => {
    const p = oscParams(params);
    const period = pendulumPeriod(p.L, p.theta0, p.g);
    const w0 = Math.sqrt(p.g / p.L);
    const th0 = p.theta0 * DEG;
    const omegaMax = Math.sqrt((2 * p.g / p.L) * Math.max(1e-6, 1 - Math.cos(th0)));
    const samples = times(period).map((t) => {
      const big = pendulumNonlinearAt(p.L, p.theta0, p.g, p.m, t);
      const small = th0 * Math.cos(w0 * t);
      return { big, small, smallOmega: -th0 * w0 * Math.sin(w0 * t) };
    });
    const thRange = th0 * 1.15;
    const omRange = Math.max(omegaMax, th0 * w0) * 1.15;
    const toPoint = (theta: number, omega: number): [number, number] => [
      200 + (theta / thRange) * 150,
      120 - (omega / omRange) * 90,
    ];
    const frames = samples.map((sample, i) => {
      const bigTrack = samples.slice(0, i + 1).map((s) => toPoint(s.big.theta, s.big.omega));
      const smallTrack = samples.slice(0, i + 1).map((s) => toPoint(s.small, s.smallOmega));
      const scene: ScienceScene = {
        ariaLabel: '单摆相空间轨迹',
        paths: [
          line(40, 120, 365, 120, COLOR.axis),
          line(200, 20, 200, 222, COLOR.axis),
          pathOf(bigTrack, COLOR.big),
          pathOf(smallTrack, COLOR.small, true),
        ],
        points: [
          dot(...toPoint(sample.big.theta, sample.big.omega), COLOR.big, 6),
          dot(...toPoint(sample.small, sample.smallOmega), COLOR.small, 5),
        ],
        labels: [
          labelAt(340, 110, 'θ'),
          labelAt(208, 32, 'ω'),
          labelAt(40, 232, '实线：大摆角闭合相轨（非椭圆）；虚线：小角简谐椭圆'),
        ],
      };
      return frame(`相空间 ${i + 1}/${FRAMES}`, scene, [
        metric('大摆角 θ', `${fmt(sample.big.theta / DEG, 2)}°`),
        metric('大摆角 ω', `${fmt(sample.big.omega)} rad/s`, true),
        metric('小角 ω', `${fmt(sample.smallOmega)} rad/s`),
        metric('最大角速度（能量法）', `${fmt(omegaMax)} rad/s`),
      ]);
    });
    return scienceResult(text, params, frames);
  },
};

const oscillationResonance: ScienceStage = {
  id: 'resonance',
  title: '受迫共振与幅频谱',
  diagram: 'oscillation',
  inputs: ['source'],
  run: ({ text, params }) => {
    const p = oscParams(params);
    const end = (4 * Math.PI) / p.wd;
    const w0 = Math.sqrt(p.k / p.m);
    const steady = forcedSpringAt(p.k, p.m, p.c, p.f0, p.wd, 0);
    const curve = resonanceCurve(p.k, p.m, p.c, p.f0);
    const curveMax = Math.max(1e-6, ...curve.map((c) => c.amplitude));
    const wdHi = curve[curve.length - 1]?.wd ?? 1;
    const samples = times(end).map((t) => forcedSpringAt(p.k, p.m, p.c, p.f0, p.wd, t));
    const xMax = Math.max(1e-6, ...samples.map((s) => Math.abs(s.x)));
    const timePoint = (i: number, x: number): [number, number] => [30 + (i / (FRAMES - 1)) * 160, 130 - (x / xMax) * 80];
    const curvePoint = (wd: number, amplitude: number): [number, number] => [
      230 + ((wd - 0.1) / Math.max(wdHi - 0.1, 1e-6)) * 140,
      200 - (amplitude / curveMax) * 150,
    ];
    const wdX = 230 + ((p.wd - 0.1) / Math.max(wdHi - 0.1, 1e-6)) * 140;
    const frames = samples.map((sample, i) => {
      const trace = samples.slice(0, i + 1).map((s, j) => timePoint(j, s.x));
      const drive = samples.slice(0, i + 1).map((s, j) => timePoint(j, (s.drive / Math.max(p.f0, 1e-6)) * xMax));
      const scene: ScienceScene = {
        ariaLabel: '受迫振动位移与幅频特性曲线',
        paths: [
          line(30, 130, 195, 130, COLOR.axis),
          pathOf(trace, COLOR.big),
          pathOf(drive, COLOR.grid, true),
          line(230, 200, 380, 200, COLOR.axis),
          pathOf(curve.map((c) => curvePoint(c.wd, c.amplitude)), COLOR.energy),
          line(wdX, 40, wdX, 200, COLOR.drag, true),
        ],
        points: [
          dot(...timePoint(i, sample.x), COLOR.big, 4),
          dot(...curvePoint(p.wd, steady.amplitude), COLOR.drag, 5),
        ],
        labels: [
          labelAt(30, 24, 'x–t（灰虚线为驱动力）'),
          labelAt(230, 24, 'A–ωd 幅频谱'),
          labelAt(230, 222, `ω₀ = ${fmt(w0)} rad/s`),
          labelAt(30, 222, `稳态振幅 A = ${fmt(steady.amplitude)} m`),
        ],
      };
      return frame(`受迫振动 t=${fmt((i / (FRAMES - 1)) * end)}s`, scene, [
        metric('时刻 t', `${fmt((i / (FRAMES - 1)) * end)} s`),
        metric('位移 x', `${fmt(sample.x)} m`),
        metric('稳态振幅 A', `${fmt(steady.amplitude)} m`, true),
        metric('频率比 ωd/ω₀', fmt(p.wd / w0, 3)),
        metric('相位差 φ', `${fmt(Math.atan2(p.c * p.wd, p.k - p.m * p.wd * p.wd) / DEG, 1)}°`),
        metric('谱峰振幅', `${fmt(curveMax)} m`),
      ]);
    });
    return scienceResult(text, params, frames);
  },
};

const oscillationWave: ScienceStage = {
  id: 'wave',
  title: '行波 / 驻波',
  diagram: 'oscillation',
  inputs: ['source'],
  run: ({ text, params }) => {
    const p = oscParams(params);
    const mode = p.mode === 1 ? 'standing' as const : 'travel' as const;
    const end = 1 / p.freq;
    const n = 96;
    const amplitude = mode === 'standing' ? 2 * p.amp : p.amp;
    const frames = times(end).map((t) => {
      const samples = waveSamples(p.amp, p.freq, p.lambda, mode, t, n);
      const points = samples.map((value, i): [number, number] => [
        40 + (i / (n - 1)) * 320,
        120 - (value / Math.max(amplitude, 1e-6)) * 70,
      ]);
      const nodePoints: SciencePoint[] = [];
      if (mode === 'standing') {
        samples.forEach((value, i) => {
          if (Math.abs(value) < 1e-9) nodePoints.push(dot(40 + (i / (n - 1)) * 320, 120, COLOR.gravity, 3, '波节'));
        });
      }
      const paths: SciencePath[] = [
        line(40, 120, 370, 120, COLOR.axis),
        pathOf(points, mode === 'standing' ? COLOR.big : COLOR.ideal),
      ];
      if (mode === 'standing') {
        paths.push(line(40, 120 - 70, 370, 120 - 70, COLOR.grid, true));
        paths.push(line(40, 120 + 70, 370, 120 + 70, COLOR.grid, true));
      }
      const scene: ScienceScene = {
        ariaLabel: mode === 'standing' ? '驻波波形与波节' : '行波波形',
        paths,
        points: nodePoints,
        labels: [
          labelAt(40, 24, mode === 'standing' ? '驻波：y = 2A·sin(2πx/λ)·cos(2πft)' : '行波：y = A·sin(2π(ft−x/λ))'),
          labelAt(40, 222, `t = ${fmt(t)} s；显示两个波长（2λ = ${fmt(2 * p.lambda)} m）`),
        ],
      };
      return frame(`${mode === 'standing' ? '驻波' : '行波'} t=${fmt(t)}s`, scene, [
        metric('时刻 t', `${fmt(t)} s`),
        metric('模式', mode === 'standing' ? '驻波' : '行波', true),
        metric('波长 λ', `${fmt(p.lambda)} m`),
        metric('频率 f', `${fmt(p.freq)} Hz`),
        metric('波速 v = fλ', `${fmt(p.freq * p.lambda)} m/s`),
        metric('当前最大位移', `${fmt(Math.max(...samples.map((v) => Math.abs(v))))} m`),
      ]);
    });
    return scienceResult(text, params, frames);
  },
};

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------

export const physicsMechPipelines: SciencePipelineMap = {
  'projectile-drag': {
    stages: [projectileSource, projectileIdealStage, projectileDragStage, projectileEnergyStage, projectileCompareStage],
  },
  'incline-friction': {
    stages: [inclineSource, inclineForces, inclineSlide, inclineEnergy],
  },
  'collision-momentum': {
    stages: [collisionSource, collisionMotion, collisionConserve, collisionSweep],
  },
  'oscillation-wave': {
    stages: [oscillationSource, oscillationPendulum, oscillationPhase, oscillationResonance, oscillationWave],
  },
};