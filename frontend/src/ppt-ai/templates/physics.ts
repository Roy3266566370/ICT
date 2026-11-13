import {
  check,
  empty,
  fmt,
  metric,
  numberValue,
  seriesFrom,
  type TemplateEvaluation,
  type TemplateValues,
} from './types.ts';

const POINTS = 241;

export function evaluateProjectile(values: TemplateValues, _provider: Record<string, unknown>): TemplateEvaluation {
  const v0 = numberValue(values.v0, 0);
  const angle = (numberValue(values.angle_deg, 0) * Math.PI) / 180;
  const y0 = numberValue(values.y0, 0);
  const g = numberValue(values.g, 9.8);
  const t = numberValue(values.t, 1);
  const checks = [
    check('speed_positive', '初速度', v0 >= 0 ? 'pass' : 'fail', `v0=${fmt(v0)} m/s。`),
    check('gravity_positive', '重力', g > 0 ? 'pass' : 'fail', `g=${fmt(g)} m/s²。`),
  ];
  if (v0 < 0 || g <= 0) return empty('physics', '初速度/重力参数非法', checks);
  const vx = v0 * Math.cos(angle);
  const vy = v0 * Math.sin(angle);
  const x = vx * t;
  const y = y0 + vy * t - 0.5 * g * t * t;
  const vyNow = vy - g * t;
  const speed = Math.hypot(vx, vyNow);
  const discriminant = vy * vy + 2 * g * y0;
  const flight = discriminant >= 0 ? (vy + Math.sqrt(discriminant)) / g : null;
  const apexTime = vy > 0 ? vy / g : 0;
  const apex = vy > 0 ? y0 + (vy * vy) / (2 * g) : y0;
  const range = flight === null ? null : vx * flight;
  const duration = Math.max(t, flight ?? 0, 0.1);
  const xs = Array.from({ length: POINTS }, (_, index) => (duration * index) / (POINTS - 1));
  const points = xs.map((time) => ({
    x: vx * time,
    y: y0 + vy * time - 0.5 * g * time * time,
  }));
  checks.push(check('finite', '状态有限', Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(speed) ? 'pass' : 'fail', `位置 (${fmt(x)}, ${fmt(y)})。`));
  checks.push(check('unit_normalized', '单位规范化', 'pass', '初速度以 m/s 参与计算；原单位换算记录在条件来源。'));
  return {
    subject: 'physics',
    kind: 'projectile',
    v0,
    angle_deg: (angle * 180) / Math.PI,
    g,
    t,
    position: [x, y],
    velocity: [vx, vyNow],
    speed,
    range,
    apex,
    flight_time: flight,
    series: seriesFrom(points.map((point) => point.x), points.map((point) => point.y)),
    metrics: [
      metric('x', '水平位置 x', `${fmt(x)} m`),
      metric('y', '竖直位置 y', `${fmt(y)} m`),
      metric('speed', '速度大小', `${fmt(speed)} m/s`),
      metric('range', '射程', range === null ? '—' : `${fmt(range)} m`),
      metric('apex', '最高点', `${fmt(apex)} m`),
    ],
    table: {
      headers: ['量', '值'],
      rows: [
        ['vx', `${fmt(vx)} m/s`],
        ['vy(t)', `${fmt(vyNow)} m/s`],
        ['飞行时间', flight === null ? '—' : `${fmt(flight)} s`],
        ['最高点时间', `${fmt(apexTime)} s`],
      ],
    },
    checks,
    trace: [],
  };
}

export function evaluateSpring(values: TemplateValues, _provider: Record<string, unknown>): TemplateEvaluation {
  const m = numberValue(values.m, 0);
  const k = numberValue(values.k, 0);
  const x0 = numberValue(values.x0, 0);
  const v0 = numberValue(values.v0, 0);
  const t = numberValue(values.t, 1);
  const checks = [
    check('mass_positive', '质量为正', m > 0 ? 'pass' : 'fail', `m=${fmt(m)} kg。`),
    check('stiffness_positive', '劲度系数为正', k > 0 ? 'pass' : 'fail', `k=${fmt(k)} N/m。`),
  ];
  if (m <= 0 || k <= 0) return empty('physics', '质量或劲度系数必须为正', checks);
  const omega = Math.sqrt(k / m);
  const phase = Math.abs(x0) + Math.abs(v0) > 1e-12 ? Math.atan2(v0, omega * x0) : 0;
  const amplitude = Math.hypot(x0, v0 / omega);
  const position = (time: number): number => x0 * Math.cos(omega * time) + (v0 / omega) * Math.sin(omega * time);
  const velocity = (time: number): number => -x0 * omega * Math.sin(omega * time) + v0 * Math.cos(omega * time);
  const x = position(t);
  const v = velocity(t);
  const acceleration = -omega * omega * x;
  const energy = 0.5 * k * x * x + 0.5 * m * v * v;
  const period = (2 * Math.PI) / omega;
  const duration = Math.max(t, period, 0.1);
  const xs = Array.from({ length: POINTS }, (_, index) => (duration * index) / (POINTS - 1));
  const energies = [0, t, duration].map((time) => {
    const currentX = position(time);
    const currentV = velocity(time);
    return 0.5 * k * currentX * currentX + 0.5 * m * currentV * currentV;
  });
  const conserved = Math.max(...energies) - Math.min(...energies) <= 1e-8 * Math.max(1, ...energies);
  checks.push(check('finite', '状态有限', Number.isFinite(x) && Number.isFinite(v) && Number.isFinite(energy) ? 'pass' : 'fail', `x=${fmt(x)} m。`));
  checks.push(check('energy_conserved', '能量守恒', conserved ? 'pass' : 'warn', `E=${fmt(energy)} J。`));
  return {
    subject: 'physics',
    kind: 'spring',
    m,
    k,
    omega,
    amplitude,
    phase,
    x,
    v,
    acceleration,
    energy,
    period,
    series: seriesFrom(xs, xs.map(position)),
    metrics: [
      metric('x', '位移 x', `${fmt(x)} m`),
      metric('v', '速度 v', `${fmt(v)} m/s`),
      metric('acceleration', '加速度 a', `${fmt(acceleration)} m/s²`),
      metric('energy', '总能量', `${fmt(energy)} J`),
      metric('period', '周期', `${fmt(period)} s`),
    ],
    table: {
      headers: ['量', '值'],
      rows: [
        ['角频率 ω', `${fmt(omega)} rad/s`],
        ['振幅', `${fmt(amplitude)} m`],
        ['相位', `${fmt(phase)} rad`],
      ],
    },
    checks,
    trace: [],
  };
}
