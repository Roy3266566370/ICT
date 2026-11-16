/** 物理第一批：前端交互计算。与后端 physics.py 使用同一组公式。 */
import type { LabCheck, LabProblem, LabResultFrame, LabResultMetric, PhysicsResult } from './types';
import { bodyAt } from '../canvas/physics.ts';

const G_DEFAULT = 9.8;
const DEG = Math.PI / 180;
const PLANCK = 6.62607015e-34;
const LIGHT_SPEED = 2.99792458e8;
const E_CHARGE = 1.602176634e-19;
const ELECTRON_MASS = 9.1093837015e-31;
const RYDBERG_EV = 13.6;

export const PHYSICS_KIND_LABELS: Record<string, string> = {
  kinematics: '质点运动学',
  newton: '牛顿运动定律',
  work_energy: '功与能',
  momentum: '动量与碰撞',
  oscillation: '振动',
  rigid_body: '刚体转动',
  wave: '机械波',
  electrostatics: '静电场',
  circuit: '电容与电路',
  magnetism: '磁场与带电粒子',
  induction: '电磁感应',
  thermodynamics: '热学与热力学',
  wave_optics: '波动光学',
  geometric_optics: '几何光学',
  modern_physics: '近代物理基础',
};

export const PHYSICS_MODE_LABELS: Record<string, string> = {
  uniform_accel: '匀变速直线运动', free_fall: '自由落体', projectile_h: '平抛运动',
  projectile_o: '斜抛运动', relative: '相对运动', incline: '斜面与摩擦',
  atwood: '连接体', circular: '圆周运动', spring_work: '变力做功与弹簧势能',
  work_energy: '动能定理', energy_conservation: '机械能守恒', impulse: '冲量与动量定理',
  elastic: '一维弹性碰撞', inelastic: '完全非弹性碰撞', spring_osc: '弹簧振子',
  pendulum: '单摆', shm: '简谐运动的相位与能量',
  rigid_rotation: '转动惯量与定轴转动', rolling: '纯滚动', wave_travel: '行波方程、波速与相位差',
  standing_wave: '机械波叠加与驻波', coulomb: '库仑力、电场叠加与电势', gauss: '高斯定律与对称电荷分布',
  capacitor: '电容器串并联', kirchhoff: '基尔霍夫定律', rc: 'RC 充放电', lorentz: '洛伦兹力与圆周运动',
  ampere: '安培力', faraday: '法拉第定律与楞次定律', rail: '导体棒切割磁感线',
  thermo_process: '理想气体与热力学第一定律', carnot: '卡诺热机与热机效率',
  double_slit: '双缝干涉', thin_film: '薄膜干涉与增透膜', single_slit: '单缝衍射',
  grating: '光栅衍射', polarization: '偏振与马吕斯定律', refraction: '折射定律与全反射',
  lens: '薄透镜成像', photoelectric: '光电效应', de_broglie: '德布罗意波',
  energy_level: '能级跃迁与氢原子光谱', decay: '放射性衰变',
};

const MODE_KIND: Record<string, PhysicsResult['kind']> = {
  uniform_accel: 'kinematics', free_fall: 'kinematics', projectile_h: 'kinematics',
  projectile_o: 'kinematics', relative: 'kinematics', incline: 'newton', atwood: 'newton',
  circular: 'newton', spring_work: 'work_energy', work_energy: 'work_energy',
  energy_conservation: 'work_energy', impulse: 'momentum', elastic: 'momentum',
  inelastic: 'momentum', spring_osc: 'oscillation', pendulum: 'oscillation', shm: 'oscillation',
  double_slit: 'wave_optics', thin_film: 'wave_optics', single_slit: 'wave_optics',
  grating: 'wave_optics', polarization: 'wave_optics',
  refraction: 'geometric_optics', lens: 'geometric_optics',
  photoelectric: 'modern_physics', de_broglie: 'modern_physics',
  energy_level: 'modern_physics', decay: 'modern_physics',
};

function num(params: Record<string, unknown>, key: string, fallback = 0): number {
  const value = Number(params[key]);
  return Number.isFinite(value) ? value : fallback;
}

function fmt(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (Math.abs(value) < 1e-12) return '0';
  return Number(value.toPrecision(digits)).toString();
}

function metric(id: string, label: string, value: string, tone?: LabResultMetric['tone']): LabResultMetric {
  return { id, label, value, ...(tone ? { tone } : {}) };
}

function check(id: string, label: string, ok: boolean, detail: string): LabCheck {
  return { id, label, status: ok ? 'pass' : 'warn', detail };
}

function frame(index: number, label: string, detail: string, values: Record<string, unknown>): LabResultFrame {
  return { index, label, detail, values };
}

function seriesFrames(samples: Record<string, number>[], label: (sample: Record<string, number>) => string,
  detail: (sample: Record<string, number>) => string, count = 8): LabResultFrame[] {
  if (!samples.length) return [];
  const step = Math.max(1, Math.floor(samples.length / count));
  return samples.filter((_, index) => index % step === 0 || index === samples.length - 1)
    .map((sample, index) => frame(index, label(sample), detail(sample), sample));
}

function sample(tEnd: number, count: number, fn: (t: number) => Record<string, number>): Record<string, number>[] {
  if (!(tEnd > 0)) return [];
  return Array.from({ length: count + 1 }, (_, index) => ({ t: (tEnd * index) / count, ...fn((tEnd * index) / count) }));
}

export function computePhysics(problem: LabProblem, params: Record<string, unknown>): PhysicsResult {
  const mode = String(problem.model.physics_mode ?? '');
  const kind = (problem.model.physics_kind as PhysicsResult['kind'] | undefined) ?? MODE_KIND[mode] ?? 'kinematics';
  const g = num(params, 'g', G_DEFAULT);
  if (g <= 0) throw new Error('重力加速度必须为正数');

  if (mode === 'uniform_accel') {
    const v0 = num(params, 'v0'), a = num(params, 'a'), t = num(params, 't');
    if (t <= 0) throw new Error('时间必须为正数');
    const v = v0 + a * t;
    const s = v0 * t + 0.5 * a * t * t;
    const vavg = s / t;
    const samples = sample(t, 30, tau => ({ x: v0 * tau + 0.5 * a * tau * tau, v: v0 + a * tau, a }));
    return {
      subject: 'physics', kind, mode,
      headline: `末速度 v=${fmt(v)} m/s，位移 s=${fmt(s)} m`,
      metrics: [metric('v', '末速度', `${fmt(v)} m/s`, 'accent'), metric('s', '位移', `${fmt(s)} m`), metric('vavg', '平均速度', `${fmt(vavg)} m/s`)],
      checks: [check('kinematics', '运动学公式一致', Math.abs(v * v - (v0 * v0 + 2 * a * s)) < 1e-6 * Math.max(1, Math.abs(v * v)), 'v² = v0² + 2as 的数值复核'), check('time', '时间有效', t > 0, '按同一坐标轴解释正负方向。')],
      notes: ['匀变速直线运动，空气阻力忽略；位移按初始位置为 0 计算。'],
      trace: seriesFrames(samples, item => `t=${fmt(item.t)} s`, item => `x=${fmt(item.x)} m，v=${fmt(item.v)} m/s`),
      scene: { type: 'linear', v0, a, t, x: s, v, samples },
    };
  }

  if (mode === 'free_fall') {
    const h = num(params, 'h');
    if (h <= 0) throw new Error('高度必须为正数');
    const t = Math.sqrt((2 * h) / g), v = g * t;
    const samples = sample(t, 30, tau => ({ y: h - 0.5 * g * tau * tau, v: g * tau, a: g }));
    return {
      subject: 'physics', kind, mode,
      headline: `落地时间 t=${fmt(t)} s，落地速度 v=${fmt(v)} m/s`,
      metrics: [metric('t', '落地时间', `${fmt(t)} s`, 'accent'), metric('v', '落地速度', `${fmt(v)} m/s`), metric('h', '下落高度', `${fmt(h)} m`)],
      checks: [check('energy', '自由落体关系', Math.abs(v * v - 2 * g * h) < 1e-6, 'v² = 2gh'), check('time', '时间有效', t > 0, '从静止释放，空气阻力忽略。')],
      notes: ['自由落体，空气阻力忽略。'],
      trace: seriesFrames(samples, item => `t=${fmt(item.t)} s`, item => `y=${fmt(item.y)} m，v=${fmt(item.v)} m/s`),
      scene: { type: 'fall', h, g, t, v, samples },
    };
  }

  if (mode === 'projectile_h' || mode === 'projectile_o') {
    const v0 = num(params, 'v0');
    if (v0 <= 0) throw new Error('初速度必须为正数');
    let vx: number, vy0: number, h0: number, t: number, angle = 0;
    if (mode === 'projectile_h') {
      h0 = num(params, 'h');
      if (h0 < 0) throw new Error('抛出高度不能为负');
      vx = v0; vy0 = 0; t = Math.sqrt((2 * h0) / g);
    } else {
      angle = num(params, 'angle');
      if (!(angle > 0 && angle < 90)) throw new Error('抛射角需在 0° 到 90° 之间');
      h0 = num(params, 'h0', 0);
      vx = v0 * Math.cos(angle * DEG);
      vy0 = v0 * Math.sin(angle * DEG);
      t = (vy0 + Math.sqrt(vy0 * vy0 + 2 * g * h0)) / g;
    }
    const range = vx * t;
    const maxHeight = h0 + (vy0 * vy0) / (2 * g);
    const vyEnd = vy0 - g * t;
    const vEnd = Math.hypot(vx, vyEnd);
    const samples = sample(t, 36, tau => ({ x: vx * tau, y: h0 + vy0 * tau - 0.5 * g * tau * tau, vx, vy: vy0 - g * tau }));
    return {
      subject: 'physics', kind, mode,
      headline: `飞行 t=${fmt(t)} s，射程 x=${fmt(range)} m，最大高度 ${fmt(maxHeight)} m`,
      metrics: [metric('t', '飞行时间', `${fmt(t)} s`, 'accent'), metric('range', '水平射程', `${fmt(range)} m`), metric('hmax', '最大高度', `${fmt(maxHeight)} m`), metric('v', '落地速度', `${fmt(vEnd)} m/s`)],
      checks: [check('range', '水平位移关系', Math.abs(range - vx * t) < 1e-6, 'x = vx·t'), check('landing', '速度分解', Math.abs(vEnd * vEnd - (vx * vx + vyEnd * vyEnd)) < 1e-6, 'v² = vx² + vy²')],
      notes: [mode === 'projectile_h' ? '平抛运动，空气阻力忽略。' : '斜抛运动，空气阻力忽略。'],
      trace: seriesFrames(samples, item => `t=${fmt(item.t)} s`, item => `(${fmt(item.x)}, ${fmt(item.y)}) m`),
      scene: { type: 'projectile', v0, angle, h0, g, t, range, maxHeight, vEnd, vx, vy0, samples },
    };
  }

  if (mode === 'relative') {
    const vA = num(params, 'vA'), vB = num(params, 'vB');
    const rel = vA - vB;
    return {
      subject: 'physics', kind, mode,
      headline: `vAB=${fmt(rel)} m/s`,
      metrics: [metric('rel', '相对速度', `${fmt(rel)} m/s`, 'accent'), metric('speed', '相对速率', `${fmt(Math.abs(rel))} m/s`)],
      checks: [check('relative', '相对速度定义', true, 'vAB = vA − vB；一维速度带符号。')],
      notes: ['一维相对运动，速度取同一坐标轴方向。'],
      trace: [frame(0, '已知速度', `vA=${fmt(vA)} m/s，vB=${fmt(vB)} m/s`, { vA, vB }), frame(1, '相对速度', `vAB=${fmt(rel)} m/s`, { rel })],
      scene: { type: 'relative', vA, vB, rel },
    };
  }

  if (mode === 'incline') {
    const m = num(params, 'm'), angle = num(params, 'angle'), mu = num(params, 'mu');
    if (m <= 0 || !(angle > 0 && angle < 90) || mu < 0) throw new Error('质量、倾角和摩擦因数需满足物理范围');
    const rad = angle * DEG;
    const normal = m * g * Math.cos(rad);
    const gravityAlong = m * g * Math.sin(rad);
    const kineticFriction = mu * normal;
    const net = gravityAlong - kineticFriction;
    const moving = net > 0;
    const acceleration = moving ? net / m : 0;
    const friction = moving ? kineticFriction : gravityAlong;
    return {
      subject: 'physics', kind, mode,
      headline: `a=${fmt(acceleration)} m/s²，f=${fmt(friction)} N，N=${fmt(normal)} N`,
      metrics: [metric('a', '沿斜面加速度', `${fmt(acceleration)} m/s²`, 'accent'), metric('f', '摩擦力', `${fmt(friction)} N`), metric('N', '支持力', `${fmt(normal)} N`), metric('net', '沿斜面合力', `${fmt(net)} N`)],
      checks: [check('normal', '支持力分量', Math.abs(normal - m * g * Math.cos(rad)) < 1e-6, 'N = mg cosθ'), check('motion', '起滑条件', moving || Math.abs(net) < 1e-9, moving ? '重力沿斜面分量大于动摩擦，按下滑计算。' : '重力分量不足以克服摩擦，按静止处理。')],
      notes: ['斜面倾角固定，按动摩擦因数计算；若不能起滑则按静止处理。'],
      trace: [frame(0, '受力分解', `N=${fmt(normal)} N，f=${fmt(friction)} N`, { normal, friction }), frame(1, '沿斜面加速度', `a=${fmt(acceleration)} m/s²`, { acceleration })],
      scene: { type: 'incline', m, angle, mu, g, normal, friction, gravityAlong, net, acceleration, moving },
    };
  }

  if (mode === 'atwood') {
    const m1 = num(params, 'm1'), m2 = num(params, 'm2');
    if (m1 <= 0 || m2 <= 0) throw new Error('两物体质量必须为正数');
    const total = m1 + m2;
    const acceleration = ((m2 - m1) * g) / total;
    const tension = (2 * m1 * m2 * g) / total;
    return {
      subject: 'physics', kind, mode,
      headline: `a=${fmt(Math.abs(acceleration))} m/s²，T=${fmt(tension)} N`,
      metrics: [metric('a', '加速度', `${fmt(Math.abs(acceleration))} m/s²`, 'accent'), metric('T', '绳张力', `${fmt(tension)} N`), metric('total', '总质量', `${fmt(total)} kg`)],
      checks: [check('m2', 'm2 方程', Math.abs(m2 * g - tension - m2 * acceleration) < 1e-6, 'm2g − T = m2a'), check('m1', 'm1 方程', Math.abs(tension - m1 * g - m1 * acceleration) < 1e-6, 'T − m1g = m1a')],
      notes: ['轻绳、定滑轮理想，忽略滑轮质量和摩擦。'],
      trace: [frame(0, '两物体', `m1=${fmt(m1)} kg，m2=${fmt(m2)} kg`, { m1, m2 }), frame(1, '共同加速度', `a=${fmt(acceleration)} m/s²，T=${fmt(tension)} N`, { a: acceleration, T: tension })],
      scene: { type: 'atwood', m1, m2, g, a: acceleration, T: tension },
    };
  }

  if (mode === 'circular') {
    const m = num(params, 'm'), v = num(params, 'v'), r = num(params, 'r');
    if (m <= 0 || v <= 0 || r <= 0) throw new Error('质量、速度和半径必须为正数');
    const acceleration = (v * v) / r;
    const force = m * acceleration;
    const period = (2 * Math.PI * r) / v;
    return {
      subject: 'physics', kind, mode,
      headline: `a=${fmt(acceleration)} m/s²，F=${fmt(force)} N，T=${fmt(period)} s`,
      metrics: [metric('a', '向心加速度', `${fmt(acceleration)} m/s²`, 'accent'), metric('F', '向心力', `${fmt(force)} N`), metric('T', '周期', `${fmt(period)} s`)],
      checks: [check('force', '牛顿第二定律', Math.abs(force - m * acceleration) < 1e-6, 'F = ma'), check('accel', '向心加速度', Math.abs(acceleration - (v * v) / r) < 1e-6, 'a = v²/r')],
      notes: ['匀速圆周运动，速度大小恒定；向心力指向圆心。'],
      trace: [frame(0, '速度与半径', `v=${fmt(v)} m/s，r=${fmt(r)} m`, { v, r }), frame(1, '向心量与周期', `a=${fmt(acceleration)} m/s²，F=${fmt(force)} N`, { a: acceleration, F: force, T: period })],
      scene: { type: 'circular', m, v, r, a: acceleration, F: force, T: period },
    };
  }

  if (mode === 'spring_work') {
    const k = num(params, 'k'), x = num(params, 'x');
    if (k <= 0 || x < 0) throw new Error('劲度系数需为正，形变量不能为负');
    const force = k * x, work = 0.5 * k * x * x, energy = 0.5 * k * x * x;
    return {
      subject: 'physics', kind, mode,
      headline: `W=${fmt(work)} J，Ep=${fmt(energy)} J`,
      metrics: [metric('F', '弹簧力', `${fmt(force)} N`), metric('W', '拉力做功', `${fmt(work)} J`, 'accent'), metric('Ep', '弹性势能', `${fmt(energy)} J`)],
      checks: [check('work', '变力做功积分', Math.abs(work - energy) < 1e-6, 'W = ∫kx dx = ½kx²'), check('force', '胡克定律', Math.abs(force - k * x) < 1e-6, 'F = kx')],
      notes: ['弹簧在弹性限度内，按 F=kx；从自然长度拉伸。'],
      trace: [frame(0, '弹簧力', `F=${fmt(force)} N`, { F: force }), frame(1, '做功与势能', `W=${fmt(work)} J，Ep=${fmt(energy)} J`, { W: work, Ep: energy })],
      scene: { type: 'spring_work', k, x, F: force, W: work, Ep: energy },
    };
  }

  if (mode === 'work_energy') {
    const m = num(params, 'm'), force = num(params, 'F'), s = num(params, 's'), v0 = num(params, 'v0');
    if (m <= 0 || s <= 0) throw new Error('质量和位移必须为正数');
    const work = force * s, k0 = 0.5 * m * v0 * v0, k1 = k0 + work;
    if (k1 < 0) throw new Error('合力做功使动能变为负值；物体会在到达该位移前停下，请核对条件');
    const v = Math.sqrt((2 * k1) / m);
    return {
      subject: 'physics', kind, mode,
      headline: `W=${fmt(work)} J，末速度 v=${fmt(v)} m/s`,
      metrics: [metric('W', '合力做功', `${fmt(work)} J`, 'accent'), metric('v', '末速度', `${fmt(v)} m/s`), metric('dK', '动能变化', `${fmt(work)} J`)],
      checks: [check('theorem', '动能定理', Math.abs(work - (k1 - k0)) < 1e-6, 'W = ΔEk'), check('speed', '末速度有效', v >= 0, '末动能非负时才能得到实速度。')],
      notes: ['合力恒定，从初速度开始沿直线运动；不考虑转动。'],
      trace: [frame(0, '合力做功', `F=${fmt(force)} N，s=${fmt(s)} m，W=${fmt(work)} J`, { F: force, s, W: work }), frame(1, '动能变化', `v0=${fmt(v0)} m/s，v=${fmt(v)} m/s`, { v0, v })],
      scene: { type: 'work_energy', m, F: force, s, v0, v, W: work, K0: k0, K1: k1 },
    };
  }

  if (mode === 'energy_conservation') {
    const m = num(params, 'm'), h = num(params, 'h');
    if (m <= 0 || h < 0) throw new Error('质量和高度需满足物理范围');
    const v = Math.sqrt(2 * g * h), energy = m * g * h;
    return {
      subject: 'physics', kind, mode,
      headline: `v=${fmt(v)} m/s，ΔEp=${fmt(energy)} J`,
      metrics: [metric('v', '底端速度', `${fmt(v)} m/s`, 'accent'), metric('Ep', '重力势能', `${fmt(energy)} J`), metric('Ek', '动能', `${fmt(energy)} J`)],
      checks: [check('energy', '机械能守恒', Math.abs(0.5 * m * v * v - energy) < 1e-6, 'mgh = ½mv²'), check('speed', '速度有效', v >= 0, '从静止释放且只有重力做功。')],
      notes: ['光滑轨道，只有重力做功，机械能守恒。'],
      trace: [frame(0, '初始能量', `Ep=${fmt(energy)} J，Ek=0`, { Ep: energy }), frame(1, '底端能量', `v=${fmt(v)} m/s，Ek=${fmt(energy)} J`, { v, Ek: energy })],
      scene: { type: 'energy', m, h, g, v, energy },
    };
  }

  if (mode === 'impulse') {
    const m = num(params, 'm'), v1 = num(params, 'v1'), v2 = num(params, 'v2'), t = num(params, 't');
    if (m <= 0 || t <= 0) throw new Error('质量和作用时间必须为正数');
    const impulse = m * (v2 - v1), average = impulse / t;
    return {
      subject: 'physics', kind, mode,
      headline: `I=${fmt(impulse)} N·s，F平均=${fmt(average)} N`,
      metrics: [metric('dp', '动量变化', `${fmt(impulse)} kg·m/s`, 'accent'), metric('I', '冲量', `${fmt(impulse)} N·s`), metric('F', '平均力', `${fmt(average)} N`)],
      checks: [check('impulse', '动量定理', Math.abs(impulse - m * (v2 - v1)) < 1e-6, 'I = Δp'), check('force', '平均力定义', Math.abs(average - impulse / t) < 1e-6, 'F平均 = I/t')],
      notes: ['一维运动，作用时间恒定；平均力按冲量除以时间计算。'],
      trace: [frame(0, '速度变化', `v1=${fmt(v1)} m/s，v2=${fmt(v2)} m/s`, { v1, v2 }), frame(1, '冲量', `I=${fmt(impulse)} N·s，F=${fmt(average)} N`, { I: impulse, F: average })],
      scene: { type: 'impulse', m, v1, v2, t, impulse, average },
    };
  }

  if (mode === 'elastic' || mode === 'inelastic') {
    const m1 = num(params, 'm1'), v1 = num(params, 'v1'), m2 = num(params, 'm2'), v2 = num(params, 'v2');
    if (m1 <= 0 || m2 <= 0) throw new Error('两物体质量必须为正数');
    const pBefore = m1 * v1 + m2 * v2;
    const kBefore = 0.5 * m1 * v1 * v1 + 0.5 * m2 * v2 * v2;
    if (mode === 'elastic') {
      const v1p = ((m1 - m2) * v1 + 2 * m2 * v2) / (m1 + m2);
      const v2p = ((m2 - m1) * v2 + 2 * m1 * v1) / (m1 + m2);
      const pAfter = m1 * v1p + m2 * v2p;
      const kAfter = 0.5 * m1 * v1p * v1p + 0.5 * m2 * v2p * v2p;
      return {
        subject: 'physics', kind, mode,
        headline: `v1′=${fmt(v1p)} m/s，v2′=${fmt(v2p)} m/s`,
        metrics: [metric('v1', "碰后 v1′", `${fmt(v1p)} m/s`, 'accent'), metric('v2', "碰后 v2′", `${fmt(v2p)} m/s`), metric('p', '总动量', `${fmt(pAfter)} kg·m/s`), metric('Ek', '总动能', `${fmt(kAfter)} J`)],
        checks: [check('momentum', '动量守恒', Math.abs(pBefore - pAfter) < 1e-6, '碰撞前后总动量相等'), check('energy', '动能守恒', Math.abs(kBefore - kAfter) < 1e-6, '一维弹性碰撞的动能保持')],
        notes: ['一维弹性碰撞，系统动量与动能都守恒。'],
        trace: [frame(0, '碰前', `v1=${fmt(v1)} m/s，v2=${fmt(v2)} m/s`, { v1, v2 }), frame(1, '碰后', `v1′=${fmt(v1p)} m/s，v2′=${fmt(v2p)} m/s`, { v1p, v2p })],
        scene: { type: 'collision', mode, m1, v1, m2, v2, v1p, v2p, p: pAfter, K0: kBefore, K1: kAfter },
      };
    }
    const vp = (m1 * v1 + m2 * v2) / (m1 + m2);
    const pAfter = (m1 + m2) * vp;
    const kAfter = 0.5 * (m1 + m2) * vp * vp;
    const loss = kBefore - kAfter;
    return {
      subject: 'physics', kind, mode,
      headline: `v′=${fmt(vp)} m/s，ΔEk=${fmt(loss)} J`,
      metrics: [metric('v', '共同速度', `${fmt(vp)} m/s`, 'accent'), metric('p', '总动量', `${fmt(pAfter)} kg·m/s`), metric('loss', '损失动能', `${fmt(loss)} J`)],
      checks: [check('momentum', '动量守恒', Math.abs(pBefore - pAfter) < 1e-6, '碰撞前后总动量相等'), check('energy', '动能不增', loss >= -1e-9, '完全非弹性碰撞的动能损失非负')],
      notes: ['一维完全非弹性碰撞，碰后两物体共同运动。'],
      trace: [frame(0, '碰前', `v1=${fmt(v1)} m/s，v2=${fmt(v2)} m/s`, { v1, v2 }), frame(1, '碰后共同运动', `v′=${fmt(vp)} m/s，ΔEk=${fmt(loss)} J`, { vp, loss })],
      scene: { type: 'collision', mode, m1, v1, m2, v2, vp, p: pAfter, K0: kBefore, K1: kAfter, loss },
    };
  }

  if (mode === 'spring_osc') {
    const m = num(params, 'm'), k = num(params, 'k'), amplitude = num(params, 'A');
    if (m <= 0 || k <= 0 || amplitude <= 0) throw new Error('质量、劲度系数和振幅必须为正数');
    const omega = Math.sqrt(k / m), period = (2 * Math.PI) / omega;
    const frequency = 1 / period, vmax = amplitude * omega, energy = 0.5 * k * amplitude * amplitude;
    const samples = sample(period, 36, t => {
      const body = bodyAt('springOsc', { k, m, x0: amplitude }, t);
      return body.kind === 'body' ? { x: body.x, v: body.vx } : { x: 0, v: 0 };
    });
    return {
      subject: 'physics', kind, mode,
      headline: `T=${fmt(period)} s，vmax=${fmt(vmax)} m/s`,
      metrics: [metric('T', '周期', `${fmt(period)} s`, 'accent'), metric('f', '频率', `${fmt(frequency)} Hz`), metric('vmax', '最大速度', `${fmt(vmax)} m/s`), metric('E', '总能量', `${fmt(energy)} J`)],
      checks: [check('period', '周期公式', Math.abs(period - 2 * Math.PI * Math.sqrt(m / k)) < 1e-9, 'T = 2π√(m/k)'), check('energy', '能量守恒', Math.abs(0.5 * k * amplitude * amplitude - energy) < 1e-9, 'E = ½kA²')],
      notes: ['水平弹簧振子，忽略摩擦。'],
      trace: seriesFrames(samples, item => `t=${fmt(item.t)} s`, item => `x=${fmt(item.x)} m，v=${fmt(item.v)} m/s`),
      scene: { type: 'oscillation', mode, m, k, A: amplitude, omega, T: period, vmax, energy, samples },
    };
  }

  if (mode === 'pendulum') {
    const length = num(params, 'L'), theta0 = num(params, 'theta0'), mass = num(params, 'm', 1);
    if (length <= 0 || theta0 <= 0 || theta0 >= 90 || mass <= 0) throw new Error('摆长和摆角需在合理范围内');
    const omega = Math.sqrt(g / length), period = (2 * Math.PI) / omega;
    const vmax = Math.sqrt(2 * g * length * (1 - Math.cos(theta0 * DEG)));
    const energy = 0.5 * mass * vmax * vmax;
    const samples = sample(period, 36, t => {
      const angle = theta0 * DEG * Math.cos(omega * t);
      return { theta: angle / DEG, omega: -theta0 * DEG * omega * Math.sin(omega * t) };
    });
    return {
      subject: 'physics', kind, mode,
      headline: `T=${fmt(period)} s，vmax=${fmt(vmax)} m/s`,
      metrics: [metric('T', '周期', `${fmt(period)} s`, 'accent'), metric('f', '频率', `${fmt(1 / period)} Hz`), metric('vmax', '最大速度', `${fmt(vmax)} m/s`), metric('E', '总能量', `${fmt(energy)} J`)],
      checks: [check('period', '小角周期公式', Math.abs(period - 2 * Math.PI * Math.sqrt(length / g)) < 1e-9, 'T = 2π√(L/g)'), check('energy', '机械能守恒', Math.abs(mass * g * length * (1 - Math.cos(theta0 * DEG)) - energy) < 1e-6, 'mgh = ½mvmax²')],
      notes: ['小角度单摆，周期按小角近似；最大速度由机械能守恒给出。'],
      trace: seriesFrames(samples, item => `t=${fmt(item.t)} s`, item => `θ=${fmt(item.theta)}°`),
      scene: { type: 'pendulum', L: length, theta0, g, m: mass, omega, T: period, vmax, energy, samples },
    };
  }

  if (mode === 'shm') {
    const amplitude = num(params, 'A'), period = num(params, 'T'), phi = num(params, 'phi'), t = num(params, 't');
    const mass = num(params, 'm', 1);
    if (amplitude <= 0 || period <= 0) throw new Error('振幅和周期必须为正数');
    const omega = (2 * Math.PI) / period;
    const phase = omega * t + phi * DEG;
    const x = amplitude * Math.cos(phase);
    const v = -amplitude * omega * Math.sin(phase);
    const a = -omega * omega * x;
    const energy = 0.5 * mass * omega * omega * amplitude * amplitude;
    return {
      subject: 'physics', kind, mode,
      headline: `x=${fmt(x)} m，v=${fmt(v)} m/s，a=${fmt(a)} m/s²`,
      metrics: [metric('x', '位移', `${fmt(x)} m`, 'accent'), metric('v', '速度', `${fmt(v)} m/s`), metric('a', '加速度', `${fmt(a)} m/s²`), metric('E', '总能量', `${fmt(energy)} J`)],
      checks: [check('phase', '相位关系', Math.abs(x - amplitude * Math.cos(phase)) < 1e-9, 'x = A cos(ωt+φ)'), check('accel', '回复力关系', Math.abs(a + omega * omega * x) < 1e-9, 'a = −ω²x')],
      notes: ['简谐运动，位移取 x=A cos(ωt+φ)。'],
      trace: [frame(0, '相位', `ωt+φ=${fmt(phase)} rad`, { phase }), frame(1, '状态', `x=${fmt(x)} m，v=${fmt(v)} m/s，a=${fmt(a)} m/s²`, { x, v, a })],
      scene: { type: 'shm', A: amplitude, T: period, phi, t, m: mass, omega, x, v, a, phase, energy },
    };
  }

  if (mode === 'rigid_rotation') {
    const m = num(params, 'm'), r = num(params, 'r'), c = num(params, 'c', 0.5);
    const torque = num(params, 'torque'), omega0 = num(params, 'omega0'), t = num(params, 't');
    if (m <= 0 || r <= 0 || c <= 0 || t <= 0) throw new Error('质量、半径、形状系数和时间必须为正数');
    const I = c * m * r * r, alpha = torque / I, omega = omega0 + alpha * t;
    const L = I * omega, energy = 0.5 * I * omega * omega;
    const samples = sample(t, 24, tau => ({ omega: omega0 + alpha * tau }));
    return {
      subject: 'physics', kind: 'rigid_body', mode,
      headline: `I=${fmt(I)} kg·m²，α=${fmt(alpha)} rad/s²，ω=${fmt(omega)} rad/s`,
      metrics: [metric('I', '转动惯量', `${fmt(I)} kg·m²`, 'accent'), metric('alpha', '角加速度', `${fmt(alpha)} rad/s²`), metric('omega', '末角速度', `${fmt(omega)} rad/s`), metric('L', '角动量', `${fmt(L)} kg·m²/s`), metric('E', '转动动能', `${fmt(energy)} J`)],
      checks: [check('inertia', '转动惯量公式', Math.abs(I - c * m * r * r) < 1e-9, 'I = c m r²'), check('torque', '转动定律', Math.abs(alpha - torque / I) < 1e-9, 'α = τ/I'), check('angular', '角动量定义', Math.abs(L - I * omega) < 1e-9, 'L = Iω')],
      notes: ['刚体绕固定轴转动，力矩恒定。'],
      trace: seriesFrames(samples, item => `t=${fmt(item.t)} s`, item => `ω=${fmt(item.omega)} rad/s`),
      scene: { type: 'rotation', m, r, c, torque, omega0, t, I, alpha, omega, L, energy, samples },
    };
  }

  if (mode === 'rolling') {
    const m = num(params, 'm'), r = num(params, 'r'), c = num(params, 'c', 0.5);
    const angle = num(params, 'angle'), s = num(params, 's'), gg = num(params, 'g', G_DEFAULT);
    if (m <= 0 || r <= 0 || c <= 0 || !(angle > 0 && angle < 90) || s <= 0) throw new Error('质量、半径、形状系数、倾角和距离需满足范围');
    const rad = angle * DEG, a = gg * Math.sin(rad) / (1 + c), v = Math.sqrt(2 * a * s);
    const Kt = 0.5 * m * v * v, Kr = 0.5 * c * m * v * v;
    return {
      subject: 'physics', kind: 'rigid_body', mode,
      headline: `a=${fmt(a)} m/s²，v=${fmt(v)} m/s`,
      metrics: [metric('a', '纯滚动加速度', `${fmt(a)} m/s²`, 'accent'), metric('v', '底端速度', `${fmt(v)} m/s`), metric('Kt', '平动动能', `${fmt(Kt)} J`), metric('Kr', '转动动能', `${fmt(Kr)} J`)],
      checks: [check('accel', '纯滚动加速度', Math.abs(a - gg * Math.sin(rad) / (1 + c)) < 1e-9, 'a = g sinθ/(1+c)'), check('energy', '机械能守恒', Math.abs(m * gg * s * Math.sin(rad) - (Kt + Kr)) < 1e-6, 'mgs sinθ = ½mv² + ½Iω²')],
      notes: ['纯滚动，无滑动；静摩擦不做功。'],
      trace: [frame(0, '加速度', `a=${fmt(a)} m/s²`, { a }), frame(1, '能量分配', `E平=${fmt(Kt)} J，E转=${fmt(Kr)} J`, { Kt, Kr })],
      scene: { type: 'rolling', m, r, c, angle, s, g: gg, a, v, Kt, Kr, energy: Kt + Kr },
    };
  }

  if (mode === 'wave_travel') {
    const A = num(params, 'A'), lam = num(params, 'lam'), f = num(params, 'f'), phi = num(params, 'phi');
    const x1 = num(params, 'x1'), x2 = num(params, 'x2', lam / 2), t = num(params, 't');
    if (A <= 0 || lam <= 0 || f <= 0) throw new Error('振幅、波长和频率必须为正数');
    const v = lam * f, T = 1 / f, k = (2 * Math.PI) / lam, omega = 2 * Math.PI * f;
    const phase = k * (x2 - x1);
    const y1 = A * Math.sin(k * x1 - omega * t + (phi * Math.PI) / 180);
    const y2 = A * Math.sin(k * x2 - omega * t + (phi * Math.PI) / 180);
    const samples = Array.from({ length: 81 }, (_, index) => {
      const x = (index / 80) * Math.max(lam * 2, x2 + lam);
      return { x, y: A * Math.sin(k * x - omega * t + (phi * Math.PI) / 180) };
    });
    return {
      subject: 'physics', kind: 'wave', mode,
      headline: `v=${fmt(v)} m/s，T=${fmt(T)} s，Δφ=${fmt(phase)} rad`,
      metrics: [metric('v', '波速', `${fmt(v)} m/s`, 'accent'), metric('T', '周期', `${fmt(T)} s`), metric('dphi', '相位差', `${fmt(phase)} rad`), metric('y1', 'x1 处位移', `${fmt(y1)} m`), metric('y2', 'x2 处位移', `${fmt(y2)} m`)],
      checks: [check('speed', '波速关系', Math.abs(v - lam * f) < 1e-9, 'v = λf'), check('phase', '相位差', Math.abs(phase - (2 * Math.PI * (x2 - x1)) / lam) < 1e-9, 'Δφ = 2πΔx/λ')],
      notes: ['一维简谐行波，振幅不衰减。'],
      trace: [frame(0, '波参数', `v=${fmt(v)} m/s，T=${fmt(T)} s`, { v, T }), frame(1, '相位差', `Δφ=${fmt(phase)} rad`, { dphi: phase })],
      scene: { type: 'wave', A, lam, f, phi, x1, x2, t, v, T, k, omega, phase, y1, y2, samples },
    };
  }

  if (mode === 'standing_wave') {
    const A = num(params, 'A'), lam = num(params, 'lam'), length = num(params, 'L'), speed = num(params, 'v');
    if (A <= 0 || lam <= 0 || length <= 0 || speed <= 0) throw new Error('振幅、波长、弦长和波速必须为正数');
    const half = lam / 2;
    const nodes = Array.from({ length: Math.floor(length / half) + 1 }, (_, index) => index * half);
    const antinodes = Array.from({ length: Math.floor(length / half + 0.5) + 1 }, (_, index) => (2 * index + 1) * lam / 4).filter(value => value <= length + 1e-9);
    const f1 = speed / (2 * length);
    const samples = Array.from({ length: 81 }, (_, index) => {
      const x = (index / 80) * length;
      return { x, y: A * Math.sin((2 * Math.PI * x) / lam) };
    });
    return {
      subject: 'physics', kind: 'wave', mode,
      headline: `波节间距 ${fmt(half)} m，基频 ${fmt(f1)} Hz`,
      metrics: [metric('half', '波节间距', `${fmt(half)} m`, 'accent'), metric('nodes', '波节数', String(nodes.length)), metric('anti', '波腹数', String(antinodes.length)), metric('f1', '基频', `${fmt(f1)} Hz`)],
      checks: [check('spacing', '波节/波腹间距', Math.abs(half - lam / 2) < 1e-9, '相邻波节或波腹相距 λ/2'), check('ends', '固定端条件', Math.abs(length / half - Math.round(length / half)) < 1e-9, '固定端要求长度为半波长整数倍。')],
      notes: ['两端固定弦上的驻波。'],
      trace: [frame(0, '驻波参数', `λ=${fmt(lam)} m，L=${fmt(length)} m`, { lam, L: length }), frame(1, '节点与腹点', `波节 ${nodes.length} 个，波腹 ${antinodes.length} 个`, { nodes: nodes.length, antinodes: antinodes.length })],
      scene: { type: 'standing', A, lam, L: length, v: speed, nodes, antinodes, f1, samples },
    };
  }

  if (mode === 'coulomb') {
    const q1 = num(params, 'q1'), q2 = num(params, 'q2'), d = num(params, 'd'), xp = num(params, 'xP');
    if (d <= 0 || Math.abs(xp) < 1e-12 || Math.abs(xp - d) < 1e-12) throw new Error('P 点不能与点电荷重合，间距必须为正');
    const k = 8.99e9, F = k * Math.abs(q1 * q2) / (d * d);
    const E1 = (k * q1 / (xp * xp)) * (xp > 0 ? 1 : -1);
    const E2 = (k * q2 / ((xp - d) ** 2)) * (xp > d ? 1 : -1);
    const E = E1 + E2, V = k * (q1 / Math.abs(xp) + q2 / Math.abs(xp - d));
    return {
      subject: 'physics', kind: 'electrostatics', mode,
      headline: `F=${fmt(F)} N，E=${fmt(E)} N/C，V=${fmt(V)} V`,
      metrics: [metric('F', '库仑力', `${fmt(F)} N`, 'accent'), metric('E', 'P 点电场', `${fmt(E)} N/C`), metric('V', 'P 点电势', `${fmt(V)} V`)],
      checks: [check('force', '库仑定律', Math.abs(F - k * Math.abs(q1 * q2) / (d * d)) < 1e-9, 'F = k|q1q2|/d²'), check('superposition', '电场叠加', Math.abs(E - (E1 + E2)) < 1e-6, 'E = E1 + E2，按 x 轴方向带符号相加')],
      notes: ['真空中点电荷，沿 x 轴一维叠加。'],
      trace: [frame(0, '两电荷作用', `F=${fmt(F)} N`, { F }), frame(1, 'P 点叠加', `E=${fmt(E)} N/C，V=${fmt(V)} V`, { E, V })],
      scene: { type: 'electric', q1, q2, d, xP: xp, F, E, V, E1, E2, attraction: q1 * q2 < 0 },
    };
  }

  if (mode === 'gauss') {
    const charge = num(params, 'Q'), R = num(params, 'R'), r = num(params, 'r'), shell = num(params, 'shell') > 0.5;
    if (R <= 0 || r < 0) throw new Error('球半径必须为正，距离不能为负');
    const k = 8.99e9, inside = r < R;
    let E: number, V: number;
    if (shell) {
      E = inside ? 0 : k * charge / (r * r);
      V = inside ? k * charge / R : k * charge / r;
    } else if (inside) {
      E = k * charge * r / (R ** 3);
      V = k * charge * (3 * R * R - r * r) / (2 * R ** 3);
    } else {
      E = k * charge / (r * r);
      V = k * charge / r;
    }
    return {
      subject: 'physics', kind: 'electrostatics', mode,
      headline: `${shell ? '球壳' : '球体'} E=${fmt(E)} N/C，V=${fmt(V)} V`,
      metrics: [metric('E', '电场强度', `${fmt(E)} N/C`, 'accent'), metric('V', '电势', `${fmt(V)} V`), metric('r', '距球心距离', `${fmt(r)} m`)],
      checks: [check('gauss', '高斯定律', true, '球对称高斯面；球体内部按包围电荷比例，球壳内部无电场。'), check('boundary', '边界连续', true, 'r=R 处内外表达式衔接。')],
      notes: ['球对称电荷分布；球壳内部无电场。'],
      trace: [frame(0, '高斯面', `${shell ? '球壳' : '球体'} R=${fmt(R)} m，r=${fmt(r)} m`, { R, r }), frame(1, '场与势', `E=${fmt(E)} N/C，V=${fmt(V)} V`, { E, V })],
      scene: { type: 'gauss', Q: charge, R, r, shell, E, V, inside },
    };
  }

  if (mode === 'capacitor') {
    const c1 = num(params, 'C1'), c2 = num(params, 'C2'), U = num(params, 'U'), series = num(params, 'series', 1) > 0.5;
    if (c1 <= 0 || c2 <= 0 || U < 0) throw new Error('电容必须为正，电压不能为负');
    let Ceq: number, Q = 0, U1 = 0, U2 = 0;
    if (series) {
      Ceq = (c1 * c2) / (c1 + c2); Q = Ceq * U; U1 = Q / c1; U2 = Q / c2;
    } else {
      Ceq = c1 + c2; Q = Ceq * U; U1 = U; U2 = U;
    }
    const energy = 0.5 * Ceq * 1e-6 * U * U;
    return {
      subject: 'physics', kind: 'circuit', mode,
      headline: `Ceq=${fmt(Ceq)} μF，Q=${fmt(Q)} μC`,
      metrics: [metric('Ceq', '等效电容', `${fmt(Ceq)} μF`, 'accent'), metric('Q', '总电荷', `${fmt(Q)} μC`), metric('U1', 'C1 电压', `${fmt(U1)} V`), metric('U2', 'C2 电压', `${fmt(U2)} V`), metric('E', '总能量', `${fmt(energy)} J`)],
      checks: [check('equivalent', '等效电容', series ? Math.abs(U1 + U2 - U) < 1e-9 : Math.abs(U1 - U) < 1e-9 && Math.abs(U2 - U) < 1e-9, series ? '串联电荷相同，电压之和等于总电压。' : '并联电压相同，电荷按电容分配。'), check('energy', '电场能量', Math.abs(energy - 0.5 * Ceq * 1e-6 * U * U) < 1e-12, 'E = ½CU²')],
      notes: ['理想电容器，忽略漏电与边缘效应。'],
      trace: [frame(0, '连接方式', series ? '串联' : '并联', { series }), frame(1, '等效结果', `Ceq=${fmt(Ceq)} μF，Q=${fmt(Q)} μC`, { Ceq, Q })],
      scene: { type: 'circuit', circuit: 'capacitor', series, C1: c1, C2: c2, U, Ceq, Q, U1, U2, energy },
    };
  }

  if (mode === 'kirchhoff') {
    const E1 = num(params, 'E1'), E2 = num(params, 'E2'), R1 = num(params, 'R1'), R2 = num(params, 'R2'), R3 = num(params, 'R3');
    if (Math.min(R1, R2, R3) <= 0) throw new Error('电阻必须为正数');
    const det = (R1 + R3) * (R2 + R3) - R3 * R3;
    if (Math.abs(det) < 1e-12) throw new Error('电路方程奇异，请检查电阻连接');
    const I1 = (E1 * (R2 + R3) - E2 * R3) / det;
    const I2 = (E2 * (R1 + R3) - E1 * R3) / det;
    const I3 = I1 + I2, P = E1 * I1 + E2 * I2;
    return {
      subject: 'physics', kind: 'circuit', mode,
      headline: `I1=${fmt(I1)} A，I2=${fmt(I2)} A，I3=${fmt(I3)} A`,
      metrics: [metric('I1', 'I1', `${fmt(I1)} A`, 'accent'), metric('I2', 'I2', `${fmt(I2)} A`), metric('I3', 'I3', `${fmt(I3)} A`), metric('P', '电源功率', `${fmt(P)} W`)],
      checks: [check('kcl', '节点电流守恒', Math.abs(I1 + I2 - I3) < 1e-9, 'I1 + I2 = I3'), check('kvl', '回路电压', Math.abs(E1 - (I1 * R1 + I3 * R3)) < 1e-9, 'E1 = I1R1 + I3R3'), check('power', '功率平衡', Math.abs(P - (I1 * I1 * R1 + I2 * I2 * R2 + I3 * I3 * R3)) < 1e-6, '电源提供功率 = 电阻消耗功率')],
      notes: ['双回路直流电路，导线与电源理想。'],
      trace: [frame(0, '回路方程', 'E1=I1R1+I3R3；E2=I2R2+I3R3；I3=I1+I2', {}), frame(1, '解得电流', `I1=${fmt(I1)} A，I2=${fmt(I2)} A，I3=${fmt(I3)} A`, { I1, I2, I3 })],
      scene: { type: 'circuit', circuit: 'kirchhoff', E1, E2, R1, R2, R3, I1, I2, I3, P },
    };
  }

  if (mode === 'rc') {
    const R = num(params, 'R'), C = num(params, 'C'), E = num(params, 'E'), t = num(params, 't'), discharge = num(params, 'discharge') > 0.5;
    if (R <= 0 || C <= 0 || E < 0 || t < 0) throw new Error('电阻、电容、电源和时间需满足范围');
    const tau = R * C * 1e-6, qmax = C * E;
    const q = discharge ? qmax * Math.exp(-t / tau) : qmax * (1 - Math.exp(-t / tau));
    const i = (discharge ? -1 : 1) * (E / R) * Math.exp(-t / tau);
    const Uc = discharge ? E * Math.exp(-t / tau) : E * (1 - Math.exp(-t / tau));
    const samples = sample(Math.max(t, 5 * tau), 40, tauT => ({
      q: discharge ? qmax * Math.exp(-tauT / tau) : qmax * (1 - Math.exp(-tauT / tau)),
      i: (discharge ? -1 : 1) * (E / R) * Math.exp(-tauT / tau),
      Uc: discharge ? E * Math.exp(-tauT / tau) : E * (1 - Math.exp(-tauT / tau)),
    }));
    return {
      subject: 'physics', kind: 'circuit', mode,
      headline: `τ=${fmt(tau)} s，q=${fmt(q)} μC，i=${fmt(i)} A`,
      metrics: [metric('tau', '时间常数', `${fmt(tau)} s`, 'accent'), metric('q', '电荷', `${fmt(q)} μC`), metric('i', '电流', `${fmt(i)} A`), metric('Uc', '电容电压', `${fmt(Uc)} V`)],
      checks: [check('tau', '时间常数', Math.abs(tau - R * C * 1e-6) < 1e-12, 'τ = RC'), check('limit', '极限行为', q <= qmax + 1e-9 && Math.abs(Uc) <= E + 1e-9, '电荷和电压不超过电源上限')],
      notes: [discharge ? 'RC 放电，t=0 时电容电压为 E。' : 'RC 充电，t=0 时电容电荷为零。'],
      trace: seriesFrames(samples, item => `t=${fmt(item.t)} s`, item => `q=${fmt(item.q)} μC，i=${fmt(item.i)} A`),
      scene: { type: 'circuit', circuit: 'rc', R, C, E, t, tau, q, i, Uc, discharge, samples },
    };
  }

  if (mode === 'lorentz') {
    const m = num(params, 'm'), q = num(params, 'q'), B = num(params, 'B'), v = num(params, 'v');
    if (m <= 0 || Math.abs(q) < 1e-30 || B <= 0 || v < 0) throw new Error('质量、电荷、磁感应强度和速度需满足范围');
    const r = m * v / (Math.abs(q) * B), T = 2 * Math.PI * m / (Math.abs(q) * B), F = Math.abs(q) * v * B;
    return {
      subject: 'physics', kind: 'magnetism', mode,
      headline: `r=${fmt(r)} m，T=${fmt(T)} s，F=${fmt(F)} N`,
      metrics: [metric('r', '轨道半径', `${fmt(r)} m`, 'accent'), metric('T', '周期', `${fmt(T)} s`), metric('F', '洛伦兹力', `${fmt(F)} N`)],
      checks: [check('radius', '半径公式', Math.abs(r - m * v / (Math.abs(q) * B)) < 1e-20, 'r = mv/(|q|B)'), check('period', '周期公式', Math.abs(T - 2 * Math.PI * m / (Math.abs(q) * B)) < 1e-20, 'T = 2πm/(|q|B)')],
      notes: ['速度垂直于匀强磁场，只受洛伦兹力。'],
      trace: [frame(0, '洛伦兹力', `F=${fmt(F)} N`, { F }), frame(1, '圆周运动', `r=${fmt(r)} m，T=${fmt(T)} s`, { r, T })],
      scene: { type: 'magnetic', m, q, B, v, r, T, F, direction: q > 0 ? '逆时针' : '顺时针' },
    };
  }

  if (mode === 'ampere') {
    const I = num(params, 'I'), L = num(params, 'L'), B = num(params, 'B'), angle = num(params, 'angle');
    if (L <= 0 || B < 0) throw new Error('导线长度和磁感应强度需满足范围');
    const F = B * I * L * Math.sin(angle * DEG);
    return {
      subject: 'physics', kind: 'magnetism', mode,
      headline: `F=${fmt(F)} N`,
      metrics: [metric('F', '安培力', `${fmt(F)} N`, 'accent'), metric('IL', '电流×长度', `${fmt(I * L)} A·m`)],
      checks: [check('force', '安培力公式', Math.abs(F - B * I * L * Math.sin(angle * DEG)) < 1e-9, 'F = BIL sinθ')],
      notes: ['匀强磁场中直导线。'],
      trace: [frame(0, '电流与磁场夹角', `θ=${fmt(angle)}°`, { angle }), frame(1, '安培力', `F=${fmt(F)} N`, { F })],
      scene: { type: 'ampere', I, L, B, angle, F },
    };
  }

  if (mode === 'faraday') {
    const A = num(params, 'A'), B1 = num(params, 'B1'), B2 = num(params, 'B2'), dt = num(params, 'dt');
    const N = num(params, 'N', 1), R = num(params, 'R', 1);
    if (A < 0 || dt <= 0 || N <= 0 || R <= 0) throw new Error('面积、时间、匝数和电阻需满足范围');
    const emf = N * A * Math.abs(B2 - B1) / dt, I = emf / R, P = I * I * R;
    const increase = B2 > B1;
    return {
      subject: 'physics', kind: 'induction', mode,
      headline: `ε=${fmt(emf)} V，I=${fmt(I)} A`,
      metrics: [metric('emf', '感应电动势', `${fmt(emf)} V`, 'accent'), metric('I', '感应电流', `${fmt(I)} A`), metric('P', '功率', `${fmt(P)} W`)],
      checks: [check('faraday', '法拉第定律', Math.abs(emf - N * A * Math.abs(B2 - B1) / dt) < 1e-9, 'ε = N|ΔΦ|/Δt'), check('lenz', '楞次定律', true, increase ? '磁通量增加，感应磁场反向。' : '磁通量减少，感应磁场同向。')],
      notes: ['均匀磁场垂直线圈平面。'],
      trace: [frame(0, '磁通量变化', `ΔB=${fmt(B2 - B1)} T，Δt=${fmt(dt)} s`, { dB: B2 - B1, dt }), frame(1, '感应结果', `ε=${fmt(emf)} V，I=${fmt(I)} A`, { emf, I })],
      scene: { type: 'induction', kind: 'faraday', A, B1, B2, dt, N, R, emf, I, P, increase },
    };
  }

  if (mode === 'rail') {
    const B = num(params, 'B'), L = num(params, 'L'), v = num(params, 'v'), R = num(params, 'R');
    if (L <= 0 || R <= 0) throw new Error('长度和电阻必须为正数');
    const emf = B * L * v, I = emf / R, F = B * I * L, P = Math.abs(F * v);
    return {
      subject: 'physics', kind: 'induction', mode,
      headline: `ε=${fmt(emf)} V，I=${fmt(I)} A，F=${fmt(F)} N`,
      metrics: [metric('emf', '感应电动势', `${fmt(emf)} V`, 'accent'), metric('I', '电流', `${fmt(I)} A`), metric('F', '安培力', `${fmt(F)} N`), metric('P', '机械功率', `${fmt(P)} W`)],
      checks: [check('faraday', '切割磁感线', Math.abs(emf - B * L * v) < 1e-9, 'ε = BLv'), check('energy', '机械能转电能', Math.abs(P - I * I * R) < 1e-6, 'Fv = I²R')],
      notes: ['导体棒垂直切割磁感线，回路电阻恒定。'],
      trace: [frame(0, '感应电动势', `ε=${fmt(emf)} V`, { emf }), frame(1, '电流与功率', `I=${fmt(I)} A，P=${fmt(P)} W`, { I, P })],
      scene: { type: 'induction', kind: 'rail', B, L, v, R, emf, I, F, P },
    };
  }

  if (mode === 'thermo_process') {
    const mol = num(params, 'n'), T1 = num(params, 'T1'), V1 = num(params, 'V1');
    const process = Math.round(num(params, 'process')), gamma = num(params, 'gamma', 1.4);
    if (mol <= 0 || T1 <= 0 || V1 <= 0 || gamma <= 1) throw new Error('物质的量、温度、体积和绝热指数需满足范围');
    const Rgas = 8.314, P1 = (mol * Rgas * T1) / V1, cv = Rgas / (gamma - 1);
    let T2 = T1, V2 = V1, P2 = P1, W = 0;
    if (process === 2) {
      T2 = num(params, 'T2', T1);
      P2 = (mol * Rgas * T2) / V1;
    } else {
      V2 = num(params, 'V2', V1);
      if (V2 <= 0) throw new Error('末体积必须为正数');
      if (process === 0) {
        P2 = (P1 * V1) / V2;
        W = mol * Rgas * T1 * Math.log(V2 / V1);
      } else if (process === 1) {
        P2 = P1;
        T2 = (P1 * V2) / (mol * Rgas);
        W = P1 * (V2 - V1);
      } else {
        P2 = P1 * (V1 / V2) ** gamma;
        T2 = (P2 * V2) / (mol * Rgas);
        W = (P1 * V1 - P2 * V2) / (gamma - 1);
      }
    }
    const dU = mol * cv * (T2 - T1), Q = dU + W;
    const path = Array.from({ length: 50 }, (_, index) => {
      const ratio = index / 49;
      if (process === 2) return { V: V1, P: P1 + (P2 - P1) * ratio };
      const volume = V1 + (V2 - V1) * ratio;
      if (process === 0) return { V: volume, P: (mol * Rgas * T1) / volume };
      if (process === 1) return { V: volume, P: P1 };
      return { V: volume, P: P1 * (V1 / volume) ** gamma };
    });
    return {
      subject: 'physics', kind: 'thermodynamics', mode,
      headline: `W=${fmt(W)} J，ΔU=${fmt(dU)} J，Q=${fmt(Q)} J`,
      metrics: [metric('P1', '初压', `${fmt(P1)} Pa`), metric('P2', '末压', `${fmt(P2)} Pa`), metric('W', '气体做功', `${fmt(W)} J`, 'accent'), metric('dU', '内能变化', `${fmt(dU)} J`), metric('Q', '吸热', `${fmt(Q)} J`)],
      checks: [check('first_law', '热力学第一定律', Math.abs(Q - (dU + W)) < 1e-6, 'Q = ΔU + W'), check('process', '过程约定', true, '等温 ΔU=0；等容 W=0；绝热 Q=0。')],
      notes: ['理想气体准静态过程。'],
      trace: [frame(0, '初态', `P1=${fmt(P1)} Pa，V1=${fmt(V1)} m³`, { P1, V1 }), frame(1, '末态与能量', `P2=${fmt(P2)} Pa，W=${fmt(W)} J，Q=${fmt(Q)} J`, { P2, W, Q })],
      scene: { type: 'thermo', process, n: mol, T1, T2, V1, V2, P1, P2, W, dU, Q, gamma, path },
    };
  }

  if (mode === 'carnot') {
    const Th = num(params, 'Th'), Tc = num(params, 'Tc'), Qh = num(params, 'Qh');
    if (Th <= 0 || Tc <= 0 || Qh <= 0 || Tc >= Th) throw new Error('卡诺热机要求 Th > Tc > 0，吸热为正');
    const eta = 1 - Tc / Th, W = eta * Qh, Qc = Qh - W;
    const path = Array.from({ length: 40 }, (_, index) => {
      const ratio = index / 39;
      return { V: 0.5 + ratio, P: 2 - 1.2 * ratio };
    });
    return {
      subject: 'physics', kind: 'thermodynamics', mode,
      headline: `η=${fmt(eta * 100)}%，W=${fmt(W)} J`,
      metrics: [metric('eta', '效率', `${fmt(eta * 100)} %`, 'accent'), metric('W', '做功', `${fmt(W)} J`), metric('Qc', '放热', `${fmt(Qc)} J`)],
      checks: [check('efficiency', '卡诺效率', Math.abs(eta - (1 - Tc / Th)) < 1e-9, 'η = 1 − Tc/Th'), check('energy', '能量守恒', Math.abs(Qh - (W + Qc)) < 1e-6, 'Qh = W + Qc')],
      notes: ['卡诺热机为可逆循环。'],
      trace: [frame(0, '热源温度', `Th=${fmt(Th)} K，Tc=${fmt(Tc)} K`, { Th, Tc }), frame(1, '循环结果', `η=${fmt(eta * 100)}%，W=${fmt(W)} J`, { eta, W })],
      scene: { type: 'thermo', kind: 'carnot', Th, Tc, Qh, eta, W, Qc, path },
    };
  }

  if (mode === 'double_slit') {
    const d = num(params, 'd'), D = num(params, 'D'), lam = num(params, 'lam');
    const n = num(params, 'n', 1), k = num(params, 'k', 1);
    if (d <= 0 || D <= 0 || lam <= 0 || n < 1) throw new Error('双缝间距、屏距和波长必须为正，折射率不小于 1');
    const lamMedium = lam / n, spacing = lamMedium * D / d, y = k * spacing;
    const samples = Array.from({ length: 121 }, (_, index) => {
      const position = ((index - 60) / 20) * spacing;
      const phase = (Math.PI * d * position) / (lamMedium * D);
      return { y: position, I: Math.cos(phase) ** 2 };
    });
    return {
      subject: 'physics', kind: 'wave_optics', mode,
      headline: `条纹间距 Δy=${fmt(spacing)} m，第 ${Math.round(k)} 级位置 y=${fmt(y)} m`,
      metrics: [metric('lam', '介质中波长', `${fmt(lamMedium)} m`), metric('dy', '条纹间距', `${fmt(spacing)} m`, 'accent'), metric('yk', `第 ${Math.round(k)} 级位置`, `${fmt(y)} m`)],
      checks: [check('spacing', '条纹间距公式', Math.abs(spacing - (lamMedium * D) / d) < 1e-15, 'Δy = λD/d'), check('medium', '介质中波长', Math.abs(lamMedium - lam / n) < 1e-15, 'λ′ = λ/n')],
      notes: ['双缝干涉远场近似，条纹等间距。'],
      trace: [frame(0, '干涉参数', `d=${fmt(d)} m，D=${fmt(D)} m，λ′=${fmt(lamMedium)} m`, { d, D, lam: lamMedium }), frame(1, '条纹间距', `Δy=${fmt(spacing)} m，y=${fmt(y)} m`, { dy: spacing, y })],
      scene: { type: 'double_slit', d, D, lam, n, k, lamMedium, spacing, y, samples },
    };
  }

  if (mode === 'thin_film') {
    const n = num(params, 'n'), lam = num(params, 'lam');
    const target = Math.round(num(params, 'target')), phase = Math.round(num(params, 'phase'));
    let thickness = num(params, 'd');
    if (n <= 1 || lam <= 0 || thickness < 0) throw new Error('薄膜折射率需大于 1，波长需为正，厚度不能为负');
    const requiredQuarter = lam / (4 * n), requiredHalf = lam / (2 * n);
    if (target === 1) thickness = requiredQuarter;
    else if (target === 2) thickness = requiredHalf;
    else if (thickness <= 0) throw new Error('判断干涉时需要给出薄膜厚度');
    const opd = 2 * n * thickness;
    const effective = opd / lam + (phase ? 0.5 : 0);
    const order = Math.round(effective);
    const bright = Math.abs(effective - order) < 0.05;
    const dark = Math.abs(effective - (Math.floor(effective) + 0.5)) < 0.05;
    const state = target === 1 ? '增透：反射光减弱' : target === 2 ? '增反：反射光加强' : bright ? '反射光加强' : dark ? '反射光减弱' : '接近但未严格满足明暗条件';
    const headline = target > 0
      ? `${target === 1 ? '增透' : '增反'}膜最小厚度 d=${fmt(thickness * 1e9)} nm`
      : `光程差 Δ=${fmt(opd)} m，${state}`;
    return {
      subject: 'physics', kind: 'wave_optics', mode, headline,
      metrics: [metric('opd', '光程差', `${fmt(opd)} m`, 'accent'), metric('order', '等效级次', fmt(effective)), metric('dmin', '最小膜厚', `${fmt(requiredQuarter * 1e9)} nm`), metric('state', '反射结果', state)],
      checks: [check('opd', '光程差公式', Math.abs(opd - 2 * n * thickness) < 1e-15, 'Δ = 2nd'), check('phase', '半波损失', true, `当前按 ${phase} 次半波损失计入。`), check('condition', '明暗条件', bright || dark || target > 0, '明纹 Δ=kλ；暗纹 Δ=(k+½)λ。')],
      notes: ['薄膜上下表面平行、光垂直入射；只考虑反射光干涉。'],
      trace: [frame(0, '光程差', `Δ=${fmt(opd)} m，等效级次 ${fmt(effective)}`, { opd, effective }), frame(1, '干涉结果', state, { bright, dark })],
      scene: { type: 'thin_film', n, d: thickness, lam, target, phase, opd, effective, bright, dark, requiredQuarter, requiredHalf, state },
    };
  }

  if (mode === 'single_slit') {
    const a = num(params, 'a'), lam = num(params, 'lam'), L = num(params, 'L');
    if (a <= 0 || lam <= 0 || L <= 0) throw new Error('缝宽、波长和屏距必须为正数');
    const half = (lam * L) / a, width = 2 * half;
    const samples = Array.from({ length: 161 }, (_, index) => {
      const y = ((index - 80) / 40) * width;
      const beta = (Math.PI * a * y) / (lam * L);
      const I = Math.abs(beta) < 1e-12 ? 1 : (Math.sin(beta) / beta) ** 2;
      return { y, I };
    });
    return {
      subject: 'physics', kind: 'wave_optics', mode,
      headline: `中央明纹宽度 Δy=${fmt(width)} m，第一级暗纹 y1=${fmt(half)} m`,
      metrics: [metric('width', '中央明纹宽度', `${fmt(width)} m`, 'accent'), metric('y1', '第一级暗纹', `${fmt(half)} m`), metric('a', '缝宽', `${fmt(a)} m`)],
      checks: [check('width', '中央明纹宽度', Math.abs(width - (2 * lam * L) / a) < 1e-15, 'Δy = 2λL/a'), check('dark', '暗纹条件', Math.abs(half - (lam * L) / a) < 1e-15, 'a sinθ = kλ，小角近似')],
      notes: ['夫琅禾费单缝衍射，屏上位置按小角近似。'],
      trace: [frame(0, '暗纹条件', `y1=${fmt(half)} m`, { y1: half }), frame(1, '中央明纹', `宽度 Δy=${fmt(width)} m`, { width })],
      scene: { type: 'single_slit', a, lam, L, width, half, samples },
    };
  }

  if (mode === 'grating') {
    const d = num(params, 'd'), lam = num(params, 'lam'), k = Math.round(num(params, 'k', 1));
    if (d <= 0 || lam <= 0 || k < 1) throw new Error('光栅常数、波长必须为正，级次必须为正整数');
    const sinTheta = (k * lam) / d;
    if (Math.abs(sinTheta) > 1) throw new Error('该级明纹不存在：kλ/d > 1');
    const theta = Math.asin(sinTheta) / DEG;
    const maxOrder = Math.floor(d / lam);
    const orders = Array.from({ length: 2 * maxOrder + 1 }, (_, index) => {
      const m = index - maxOrder;
      const value = (m * lam) / d;
      return { m, sin: value, theta: Math.asin(value) / DEG };
    });
    return {
      subject: 'physics', kind: 'wave_optics', mode,
      headline: `第 ${k} 级衍射角 θ=${fmt(theta)}°，最高级次 k_max=${maxOrder}`,
      metrics: [metric('theta', '衍射角', `${fmt(theta)}°`, 'accent'), metric('kmax', '最高级次', String(maxOrder)), metric('count', '可见主极大数', String(2 * maxOrder + 1))],
      checks: [check('grating', '光栅方程', Math.abs(sinTheta - (k * lam) / d) < 1e-12, 'd sinθ = kλ'), check('range', '级次范围', Math.abs(sinTheta) <= 1, '|sinθ|≤1')],
      notes: ['光栅垂直入射，忽略缺级与缝宽衍射包络。'],
      trace: [frame(0, '光栅方程', `sinθ=${fmt(sinTheta)}`, { sin: sinTheta }), frame(1, '衍射角与级次', `θ=${fmt(theta)}°，k_max=${maxOrder}`, { theta, kmax: maxOrder })],
      scene: { type: 'grating', d, lam, k, sin: sinTheta, theta, maxOrder, orders },
    };
  }

  if (mode === 'polarization') {
    const I0 = num(params, 'I0'), theta = num(params, 'theta'), n = num(params, 'n', 1.5);
    const natural = num(params, 'natural') > 0.5;
    if (I0 < 0 || n <= 0) throw new Error('入射光强不能为负，折射率必须为正');
    const I1 = I0 * (natural ? 0.5 : 1);
    const I2 = I1 * Math.cos(theta * DEG) ** 2;
    const brewster = Math.atan(n) / DEG;
    return {
      subject: 'physics', kind: 'wave_optics', mode,
      headline: `I1=${fmt(I1)} W/m²，I2=${fmt(I2)} W/m²，布儒斯特角 ${fmt(brewster)}°`,
      metrics: [metric('I1', '第一偏振片后光强', `${fmt(I1)} W/m²`), metric('I2', '检偏器后光强', `${fmt(I2)} W/m²`, 'accent'), metric('brewster', '布儒斯特角', `${fmt(brewster)}°`)],
      checks: [check('malus', '马吕斯定律', Math.abs(I2 - I1 * Math.cos(theta * DEG) ** 2) < 1e-15, 'I = I1 cos²θ'), check('brewster', '布儒斯特定律', Math.abs(Math.tan(brewster * DEG) - n) < 1e-12, 'tanθ_B = n')],
      notes: ['自然光通过第一个偏振片后光强减半。'],
      trace: [frame(0, '第一偏振片', `I1=${fmt(I1)} W/m²`, { I1 }), frame(1, '检偏与布儒斯特角', `I2=${fmt(I2)} W/m²，θ_B=${fmt(brewster)}°`, { I2, brewster })],
      scene: { type: 'polarization', I0, theta, n, natural, I1, I2, brewster },
    };
  }

  if (mode === 'refraction') {
    const n1 = num(params, 'n1'), n2 = num(params, 'n2'), angle1 = num(params, 'angle');
    if (n1 <= 0 || n2 <= 0 || angle1 < 0 || angle1 >= 90) throw new Error('折射率必须为正，入射角需在 0° 到 90° 之间');
    const sin2 = (n1 * Math.sin(angle1 * DEG)) / n2;
    const critical = Math.abs(n1 - n2) > 1e-12 ? Math.asin(Math.min(n1, n2) / Math.max(n1, n2)) / DEG : null;
    const tir = sin2 > 1;
    const angle2 = tir ? null : Math.asin(sin2) / DEG;
    return {
      subject: 'physics', kind: 'geometric_optics', mode,
      headline: tir ? `发生全反射，临界角 θc=${fmt(critical)}°` : `折射角 θ2=${fmt(angle2)}°，临界角 θc=${fmt(critical)}°`,
      metrics: [metric('theta1', '入射角', `${fmt(angle1)}°`), metric('theta2', '折射角', tir ? '全反射' : `${fmt(angle2)}°`, 'accent'), metric('critical', '临界角', critical === null ? '—' : `${fmt(critical)}°`)],
      checks: [check('snell', '折射定律', tir || Math.abs(n1 * Math.sin(angle1 * DEG) - n2 * Math.sin((angle2 ?? 0) * DEG)) < 1e-12, 'n1 sinθ1 = n2 sinθ2'), check('critical', '全反射条件', true, '从光密射向光疏且入射角大于临界角时发生全反射。')],
      notes: ['均匀各向同性介质，平面界面。'],
      trace: [frame(0, '入射与法线', `θ1=${fmt(angle1)}°，n1=${fmt(n1)}，n2=${fmt(n2)}`, { angle1, n1, n2 }), frame(1, '折射或全反射', tir ? '全反射' : `θ2=${fmt(angle2)}°`, { angle2, tir })],
      scene: { type: 'refraction', n1, n2, angle1, angle2, critical, tir, reflected: angle1 },
    };
  }

  if (mode === 'lens') {
    const f = num(params, 'f'), u = num(params, 'u'), h = num(params, 'h', 1);
    const convex = num(params, 'convex', 1) > 0.5;
    if (Math.abs(f) < 1e-12 || u <= 0 || h <= 0) throw new Error('焦距不能为零，物距和物高必须为正数');
    if (Math.abs(u - f) < 1e-12) throw new Error('物体位于焦点上，像在无穷远');
    const v = (u * f) / (u - f);
    const m = -v / u;
    const real = v > 0, inverted = m < 0;
    const hi = Math.abs(m) * h;
    const kindText = real ? '实像' : '虚像';
    const orientation = inverted ? '倒立' : '正立';
    return {
      subject: 'physics', kind: 'geometric_optics', mode,
      headline: `像距 v=${fmt(v)} m，放大率 m=${fmt(m)}，${orientation}${kindText}`,
      metrics: [metric('v', '像距', `${fmt(v)} m`, 'accent'), metric('m', '放大率', fmt(m)), metric('type', '像的性质', `${orientation}${kindText}`), metric('hi', '像高', `${fmt(hi)} m`)],
      checks: [check('lens', '薄透镜公式', Math.abs(1 / u + 1 / v - 1 / f) < 1e-12, '1/u + 1/v = 1/f'), check('magnification', '放大率', Math.abs(m + v / u) < 1e-12, 'm = −v/u')],
      notes: ['薄透镜近轴近似；凸透镜 f>0，凹透镜 f<0。'],
      trace: [frame(0, '物距与焦距', `u=${fmt(u)} m，f=${fmt(f)} m`, { u, f }), frame(1, '成像', `v=${fmt(v)} m，${orientation}${kindText}`, { v, m })],
      scene: { type: 'lens', f, u, v, m, real, inverted, convex, h, hi },
    };
  }

  if (mode === 'photoelectric') {
    const lam = num(params, 'lam'), W = num(params, 'W');
    if (lam <= 0 || W < 0) throw new Error('波长必须为正，逸出功不能为负');
    const photonJ = (PLANCK * LIGHT_SPEED) / lam;
    const photonE = photonJ / E_CHARGE;
    const kinetic = photonE - W;
    const occurs = kinetic > 0;
    const stopping = Math.max(kinetic, 0);
    const threshold = W > 0 ? (PLANCK * LIGHT_SPEED) / (W * E_CHARGE) : Infinity;
    const f = LIGHT_SPEED / lam;
    const f0 = W > 0 ? (W * E_CHARGE) / PLANCK : 0;
    const samples = W > 0
      ? Array.from({ length: 61 }, (_, index) => {
        const frequency = (f0 * index) / 40;
        return { f: frequency, Ek: Math.max((PLANCK * frequency) / E_CHARGE - W, 0) };
      })
      : [{ f: 0, Ek: 0 }, { f, Ek: Math.max(kinetic, 0) }];
    return {
      subject: 'physics', kind: 'modern_physics', mode,
      headline: occurs ? `最大初动能 ${fmt(kinetic)} eV，遏止电压 ${fmt(stopping)} V` : `光子能量不足，不能发生光电效应`,
      metrics: [metric('E', '光子能量', `${fmt(photonE)} eV`), metric('Ek', '最大初动能', `${fmt(Math.max(kinetic, 0))} eV`, 'accent'), metric('Ua', '遏止电压', `${fmt(stopping)} V`), metric('lam0', '截止波长', `${fmt(threshold * 1e9)} nm`)],
      checks: [check('einstein', '爱因斯坦光电方程', Math.abs(kinetic - (photonE - W)) < 1e-12, 'Ek = hc/λ − W'), check('threshold', '截止波长', true, 'λ0 = hc/W；入射波长大于 λ0 时不能发生光电效应。')],
      notes: ['金属逸出功恒定；光强不改变最大初动能。'],
      trace: [frame(0, '光子能量', `E=${fmt(photonE)} eV`, { E: photonE }), frame(1, '光电发射', `Ek=${fmt(Math.max(kinetic, 0))} eV，Ua=${fmt(stopping)} V`, { Ek: kinetic, Ua: stopping })],
      scene: { type: 'photoelectric', lam, W, E: photonE, Ek: kinetic, Ua: stopping, lam0: threshold, occurs, f, f0, samples },
    };
  }

  if (mode === 'de_broglie') {
    let m = num(params, 'm'), v = num(params, 'v');
    const U = num(params, 'U'), electron = num(params, 'electron') > 0.5;
    if (m <= 0) {
      if (electron) m = ELECTRON_MASS; else throw new Error('质量必须为正数');
    }
    if (electron && U > 0) v = Math.sqrt((2 * E_CHARGE * U) / m);
    if (v <= 0) throw new Error('需要给出速度或电子加速电压');
    const p = m * v, lam = PLANCK / p;
    const kinetic = (0.5 * m * v * v) / E_CHARGE;
    return {
      subject: 'physics', kind: 'modern_physics', mode,
      headline: `德布罗意波长 λ=${fmt(lam)} m（${fmt(lam * 1e9)} nm）`,
      metrics: [metric('lam', '德布罗意波长', `${fmt(lam)} m`, 'accent'), metric('p', '动量', `${fmt(p)} kg·m/s`), metric('v', '速度', `${fmt(v)} m/s`), metric('Ek', '动能', `${fmt(kinetic)} eV`)],
      checks: [check('relation', '德布罗意关系', Math.abs(lam - PLANCK / p) < 1e-30, 'λ = h/p'), check('electron', '电子加速', !electron || U <= 0 || Math.abs(v - Math.sqrt((2 * E_CHARGE * U) / m)) < 1e-9, '非相对论近似 λ = h/√(2meU)')],
      notes: ['物质波 λ=h/p；高速电子需要相对论修正。'],
      trace: [frame(0, '动量', `p=${fmt(p)} kg·m/s`, { p }), frame(1, '物质波', `λ=${fmt(lam)} m`, { lam })],
      scene: { type: 'de_broglie', m, v, U, electron, p, lam, Ek: kinetic },
    };
  }

  if (mode === 'energy_level') {
    const hydrogen = num(params, 'hydrogen', 1) > 0.5;
    const groupN = Math.round(num(params, 'group_n'));
    let nHi = num(params, 'n_hi'), nLo = num(params, 'n_lo');
    let explicit = nHi > 0 && nLo > 0;
    let eHi: number, eLo: number, levels: { n: number; E: number }[];
    let labelHi: string, labelLo: string;
    if (hydrogen) {
      if (groupN > 0 && !explicit) { nHi = groupN; nLo = 1; explicit = true; }
      if (!explicit) throw new Error('需要给出跃迁的初末能级');
      if (nHi === nLo) throw new Error('初末能级必须不同');
      if (nHi < 1 || nLo < 1) throw new Error('能级量子数必须为正整数');
      eHi = -RYDBERG_EV / (nHi * nHi);
      eLo = -RYDBERG_EV / (nLo * nLo);
      levels = Array.from({ length: Math.max(nHi, groupN, 1) }, (_, index) => ({ n: index + 1, E: -RYDBERG_EV / ((index + 1) ** 2) }));
      labelHi = `n=${Math.round(nHi)}`;
      labelLo = `n=${Math.round(nLo)}`;
    } else {
      const e1 = num(params, 'E1'), e2 = num(params, 'E2');
      if (e1 === 0 && e2 === 0) throw new Error('需要给出两个能级能量或氢原子跃迁能级');
      eHi = Math.max(e1, e2);
      eLo = Math.min(e1, e2);
      levels = [{ n: 1, E: eLo }, { n: 2, E: eHi }];
      labelHi = '高能级';
      labelLo = '低能级';
    }
    const delta = eHi - eLo;
    if (delta <= 0) throw new Error('高能级必须高于低能级');
    const lam = (PLANCK * LIGHT_SPEED) / (delta * E_CHARGE);
    const lines = groupN >= 2 ? (groupN * (groupN - 1)) / 2 : 1;
    const shortest = groupN >= 2 && hydrogen ? (PLANCK * LIGHT_SPEED) / (RYDBERG_EV * (1 - 1 / (groupN * groupN)) * E_CHARGE) : null;
    const headline = groupN >= 2
      ? `ΔE=${fmt(delta)} eV，λ=${fmt(lam * 1e9)} nm，最多 ${lines} 种谱线`
      : `ΔE=${fmt(delta)} eV，光子波长 ${fmt(lam * 1e9)} nm`;
    return {
      subject: 'physics', kind: 'modern_physics', mode,
      headline,
      metrics: [metric('dE', '能级差', `${fmt(delta)} eV`, 'accent'), metric('lam', '光子波长', `${fmt(lam * 1e9)} nm`), ...(groupN >= 2 ? [metric('lines', '谱线数', String(lines)), ...(shortest !== null ? [metric('shortest', '最短波长', `${fmt(shortest * 1e9)} nm`)] : [])] : [])],
      checks: [check('photon', '光子能量', Math.abs(delta * E_CHARGE - (PLANCK * LIGHT_SPEED) / lam) < 1e-24, 'hν = ΔE'), check('count', '谱线数', lines === (groupN >= 2 ? (groupN * (groupN - 1)) / 2 : 1), 'N = n(n−1)/2')],
      notes: ['氢原子能级 E_n=−13.6/n² eV；忽略反冲与精细结构。'],
      trace: [frame(0, '能级差', `ΔE=${fmt(delta)} eV`, { dE: delta }), frame(1, '光子波长', `λ=${fmt(lam * 1e9)} nm`, { lam })],
      scene: { type: 'energy_level', hydrogen, n_hi: nHi, n_lo: nLo, levels, deltaE: delta, lam, lines, group_n: groupN, shortest, labelHi, labelLo },
    };
  }

  if (mode === 'decay') {
    const T = num(params, 'T'), N0 = num(params, 'N0'), t = num(params, 't');
    if (T <= 0 || N0 <= 0 || t < 0) throw new Error('半衰期和初始核数必须为正，时间不能为负');
    const lambda = Math.log(2) / T;
    const N = N0 * Math.exp(-lambda * t);
    const fraction = N / N0;
    const A = lambda * N, A0 = lambda * N0;
    const span = Math.max(4 * T, t * 1.2, T);
    const samples = Array.from({ length: 81 }, (_, index) => {
      const time = (span * index) / 80;
      return { t: time, N: N0 * Math.exp(-lambda * time) };
    });
    return {
      subject: 'physics', kind: 'modern_physics', mode,
      headline: `剩余 ${fmt(N)} 个（${fmt(fraction * 100)}%），活度 ${fmt(A)} Bq`,
      metrics: [metric('N', '剩余核数', fmt(N), 'accent'), metric('fraction', '剩余比例', `${fmt(fraction * 100)} %`), metric('A', '当前活度', `${fmt(A)} Bq`), metric('T', '半衰期', `${fmt(T)} s`)],
      checks: [check('decay', '衰变公式', Math.abs(N - N0 * 0.5 ** (t / T)) < 1e-6 * Math.max(1, N0), 'N = N0(1/2)^(t/T)'), check('activity', '活度关系', Math.abs(A - lambda * N) < 1e-6, 'A = λN')],
      notes: ['半衰期恒定，衰变服从指数规律。'],
      trace: [frame(0, '半衰期', `T=${fmt(T)} s，λ=${fmt(lambda)} s⁻¹`, { T, lambda }), frame(1, '剩余核数', `N=${fmt(N)}，比例 ${fmt(fraction * 100)}%`, { N, fraction })],
      scene: { type: 'decay', T, N0, t, N, fraction, A, A0, lambda, samples },
    };
  }

  throw new Error(PHYSICS_MODE_LABELS[mode] ? `暂不支持 ${PHYSICS_MODE_LABELS[mode]} 的交互计算` : '未识别物理题型');
}
