/** 大学物理自由积木的确定性内核：静电场、粒子轨迹、RLC、光学与卡诺循环。 */

import type { PortValue } from './types.ts';
import { clampNumber, makeSeries, type SeriesValue } from './officeBlocks.ts';

export type Field2D = Extract<PortValue, { kind: 'field2d' }>;
export type FieldSource = Field2D['sources'][number];

const MAX_FIELD = 1e6;

function finite(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-MAX_FIELD, Math.min(MAX_FIELD, value));
}

function source(x: number, y: number, strength: number, kind: string, radius?: number): FieldSource {
  return {
    kind,
    x: finite(x),
    y: finite(y),
    strength: finite(strength),
    ...(radius === undefined ? {} : { radius: Math.max(0, finite(radius)) }),
  };
}

export function emFieldFromParams(params: Record<string, number>): Field2D {
  const modeIndex = Math.round(clampNumber(params.mode ?? 0, 0, 0, 2));
  const mode = modeIndex === 1 ? 'magnetic' : modeIndex === 2 ? 'optics' : 'electric';
  if (mode === 'optics') {
    const count = Math.round(clampNumber(params.count ?? 1, 1, 1, 3));
    const sources: FieldSource[] = [];
    for (let index = 0; index < count; index += 1) {
      const suffix = index + 1;
      sources.push(source(
        params[`x${suffix}`] ?? 40 + index * 50,
        params[`y${suffix}`] ?? 65,
        params[`s${suffix}`] ?? 550,
        params[`k${suffix}`] === 1 ? 'lens' : params[`k${suffix}`] === 2 ? 'slit' : 'source',
        params[`r${suffix}`] ?? 45,
      ));
    }
    return { kind: 'field2d', mode, sources };
  }
  if (params.uniform) {
    return {
      kind: 'field2d',
      mode,
      sources: [source(params.ux ?? 0.6, params.uy ?? 0, params.uStrength ?? 1.2, 'uniform')],
    };
  }
  const count = Math.round(clampNumber(params.count ?? 2, 1, 1, 3));
  const sources = Array.from({ length: count }, (_, index) => {
    const suffix = index + 1;
    return source(
      params[`x${suffix}`] ?? 55 + index * 45,
      params[`y${suffix}`] ?? 65,
      params[`s${suffix}`] ?? (index % 2 === 0 ? 1.5 : -1.2),
      'charge',
      params[`r${suffix}`] ?? 9,
    );
  });
  return { kind: 'field2d', mode, sources };
}

function uniformSource(field: Field2D): FieldSource | undefined {
  return field.sources.find((item) => item.kind === 'uniform');
}

export function electricFieldAt(field: Field2D, x: number, y: number): { ex: number; ey: number } {
  if (field.mode === 'optics') return { ex: 0, ey: 0 };
  const uniform = uniformSource(field);
  if (uniform) {
    const scale = field.mode === 'magnetic' ? 26 : 42;
    return { ex: finite(uniform.x * uniform.strength * scale), ey: finite(uniform.y * uniform.strength * scale) };
  }
  let ex = 0;
  let ey = 0;
  for (const item of field.sources) {
    if (item.kind !== 'charge') continue;
    const dx = x - item.x;
    const dy = y - item.y;
    const distance = Math.max(3, Math.hypot(dx, dy));
    const strength = item.strength * 1800 / distance ** 3;
    ex += dx * strength;
    ey += dy * strength;
  }
  return { ex: finite(ex), ey: finite(ey) };
}

export function potentialAt(field: Field2D, x: number, y: number): number {
  if (field.mode !== 'electric') return 0;
  const uniform = uniformSource(field);
  if (uniform) return finite(-(uniform.x * uniform.strength * 42 * x + uniform.y * uniform.strength * 42 * y));
  let value = 0;
  for (const item of field.sources) {
    if (item.kind !== 'charge') continue;
    value += item.strength * 180 / Math.max(4, Math.hypot(x - item.x, y - item.y));
  }
  return finite(value);
}

export function magneticStrength(field: Field2D): number {
  const uniform = uniformSource(field);
  if (uniform) return finite(uniform.strength);
  return finite(field.sources.filter((item) => item.kind === 'charge').reduce((sum, item) => sum + item.strength, 0) * 0.4);
}

export interface ParticleParams {
  px: number;
  py: number;
  vx: number;
  vy: number;
  charge: number;
  mass: number;
}

export function traceParticle(field: Field2D, params: ParticleParams, samples = 48): { x: number; y: number }[] {
  const count = Math.round(clampNumber(samples, 48, 2, 120));
  const charge = clampNumber(params.charge, 1, -3, 3);
  const mass = clampNumber(params.mass, 1, 0.1, 10);
  const ratio = charge / mass;
  let x = clampNumber(params.px, 45, -200, 400);
  let y = clampNumber(params.py, 65, -200, 400);
  let vx = clampNumber(params.vx, 0.8, -8, 8);
  let vy = clampNumber(params.vy, 0.2, -8, 8);
  const b = magneticStrength(field);
  const dt = 0.035;
  const points = [{ x, y }];
  const acceleration = (px: number, py: number): { ax: number; ay: number } => {
    const electric = field.mode === 'electric' ? electricFieldAt(field, px, py) : { ex: 0, ey: 0 };
    const magneticX = field.mode === 'magnetic' ? vy * b * 0.009 : 0;
    const magneticY = field.mode === 'magnetic' ? -vx * b * 0.009 : 0;
    return { ax: finite((electric.ex * 0.0025 + magneticX) * ratio), ay: finite((electric.ey * 0.0025 + magneticY) * ratio) };
  };
  for (let index = 1; index < count; index += 1) {
    const a = acceleration(x, y);
    vx = finite(vx + a.ax * dt);
    vy = finite(vy + a.ay * dt);
    x = finite(x + vx * dt);
    y = finite(y + vy * dt);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 600 || Math.abs(y) > 400) break;
    points.push({ x, y });
  }
  return points;
}

export interface RlcParams {
  r: number;
  l: number;
  c: number;
  freq: number;
  amplitude: number;
  seconds: number;
  drive: number;
}

export interface RlcResult {
  series: SeriesValue;
  resonance: number;
  damping: number;
  peakCurrent: number;
}

export function rlcWaveform(params: Partial<RlcParams>, fixedFrequency?: number): RlcResult {
  const r = clampNumber(params.r ?? 20, 20, 0.1, 200);
  const l = clampNumber(params.l ?? 0.08, 0.08, 0, 2);
  const c = clampNumber(params.c ?? 0.002, 0.002, 1e-4, 1);
  const freq = clampNumber(fixedFrequency ?? params.freq ?? 3, 3, 0.05, 20);
  const amplitude = clampNumber(params.amplitude ?? 12, 12, 0.1, 100);
  const seconds = clampNumber(params.seconds ?? 2.4, 2.4, 0.2, 6);
  const drive = Math.round(clampNumber(params.drive ?? 0, 0, 0, 1));
  const steps = 60;
  const dt = seconds / steps;
  let q = 0;
  let i = 0;
  let peakCurrent = 0;
  const voltages: number[] = [];
  const currents: number[] = [];
  const input = (t: number): number => drive === 1 ? (t > seconds * 0.08 ? amplitude : 0) : amplitude * Math.sin(2 * Math.PI * freq * t);
  const derivative = (t: number, qv: number, iv: number): { dq: number; di: number } => {
    if (l < 1e-6) return { dq: iv, di: 0 };
    const di = (input(t) - r * iv - qv / c) / l;
    return { dq: iv, di };
  };
  for (let index = 0; index <= steps; index += 1) {
    const t = index * dt;
    const voltageNow = l < 1e-6 ? input(t) - r * (input(t) - q / c) / r : q / c;
    voltages.push(finite(voltageNow));
    currents.push(finite(i));
    peakCurrent = Math.max(peakCurrent, Math.abs(i));
    if (index === steps) break;
    if (l < 1e-6) {
      i = finite((input(t) - q / c) / r);
      q = finite(q + i * dt);
    } else {
      const k1 = derivative(t, q, i);
      const k2 = derivative(t + dt / 2, q + k1.dq * dt / 2, i + k1.di * dt / 2);
      const k3 = derivative(t + dt / 2, q + k2.dq * dt / 2, i + k2.di * dt / 2);
      const k4 = derivative(t + dt, q + k3.dq * dt, i + k3.di * dt);
      q = finite(q + dt * (k1.dq + 2 * k2.dq + 2 * k3.dq + k4.dq) / 6);
      i = finite(i + dt * (k1.di + 2 * k2.di + 2 * k3.di + k4.di) / 6);
    }
  }
  const labels = Array.from({ length: steps + 1 }, (_, index) => (index * dt).toFixed(2) + 's');
  const series = makeSeries('RLC 暂态', labels, voltages, [{ name: '电流 ×10', values: currents.map((value) => finite(value * 10)) }]);
  return {
    series,
    resonance: l > 1e-6 ? finite(1 / (2 * Math.PI * Math.sqrt(l * c))) : 0,
    damping: l > 1e-6 ? finite(r / (2 * Math.sqrt(l / c))) : finite(r * Math.sqrt(c)),
    peakCurrent: finite(peakCurrent),
  };
}

export interface OpticsParams {
  mode: number;
  wavelength: number;
  focal: number;
  objectDistance: number;
  slitSpacing: number;
  screenDistance: number;
  n1: number;
  n2: number;
}

export function opticsField(params: Partial<OpticsParams>): Field2D {
  const mode = Math.round(clampNumber(params.mode ?? 0, 0, 0, 2));
  const wavelength = clampNumber(params.wavelength ?? 550, 550, 380, 750);
  const focal = clampNumber(params.focal ?? 45, 45, 10, 100);
  const objectDistance = clampNumber(params.objectDistance ?? 70, 70, 10, 180);
  const slitSpacing = clampNumber(params.slitSpacing ?? 0.35, 0.35, 0.05, 2);
  const screenDistance = clampNumber(params.screenDistance ?? 120, 120, 20, 240);
  const n1 = clampNumber(params.n1 ?? 1, 1, 1, 3);
  const n2 = clampNumber(params.n2 ?? 1.5, 1.5, 1, 3);
  return {
    kind: 'field2d',
    mode: 'optics',
    sources: [
      { kind: 'source', x: 30, y: 65, strength: wavelength },
      ...(mode === 0 ? [{ kind: 'lens', x: 120, y: 65, strength: focal, radius: focal }] : []),
      ...(mode === 1 ? [{ kind: 'slit', x: 100, y: 65, strength: slitSpacing, radius: screenDistance }] : []),
      ...(mode === 2 ? [{ kind: 'interface', x: 110, y: 65, strength: n1, radius: n2 }] : []),
    ],
  };
}

export function opticsFringes(params: Partial<OpticsParams>, samples = 120): number[] {
  const count = Math.round(clampNumber(samples, 120, 8, 240));
  const wavelength = clampNumber(params.wavelength ?? 550, 550, 380, 750) * 1e-9;
  const slit = clampNumber(params.slitSpacing ?? 0.35, 0.35, 0.05, 2) * 1e-3;
  const screen = clampNumber(params.screenDistance ?? 120, 120, 20, 240) * 1e-2;
  return Array.from({ length: count }, (_, index) => {
    const position = (index / (count - 1) - 0.5) * 0.08;
    const phase = Math.PI * slit * position / (wavelength * screen);
    const value = Math.cos(phase) ** 2;
    return finite(value);
  });
}

export interface ThermoParams {
  hot: number;
  cold: number;
  compression: number;
  gamma: number;
}

export interface ThermoState {
  v: number;
  p: number;
  t: number;
}

export interface ThermoResult {
  states: [ThermoState, ThermoState, ThermoState, ThermoState];
  curve: { label: string; points: ThermoState[] }[];
  series: SeriesValue;
  efficiency: number;
  netWork: number;
  heatIn: number;
}

export function thermoCycle(params: Partial<ThermoParams>): ThermoResult {
  const hot = clampNumber(params.hot ?? 600, 600, 250, 900);
  const cold = clampNumber(params.cold ?? 300, 300, 150, hot - 1);
  const compression = clampNumber(params.compression ?? 3, 3, 1.2, 6);
  const gamma = clampNumber(params.gamma ?? 1.4, 1.4, 1.1, 1.8);
  const nR = 1;
  const t1 = hot;
  const t2 = hot;
  const t3 = cold;
  const t4 = cold;
  const v1 = 1;
  const v2 = v1 * compression;
  const exponent = 1 / (gamma - 1);
  const v3 = v2 * (t2 / t3) ** exponent;
  const v4 = v1 * (t1 / t4) ** exponent;
  const state = (v: number, t: number): ThermoState => ({ v: finite(v), p: finite(nR * t / v), t });
  const states: [ThermoState, ThermoState, ThermoState, ThermoState] = [state(v1, t1), state(v2, t2), state(v3, t3), state(v4, t4)];
  const work12 = finite(nR * t1 * Math.log(v2 / v1));
  const work23 = finite(nR * (t2 - t3) / (gamma - 1));
  const work34 = finite(nR * t3 * Math.log(v4 / v3));
  const work41 = finite(nR * (t4 - t1) / (gamma - 1));
  const netWork = finite(work12 + work23 + work34 + work41);
  const heatIn = finite(work12);
  const sampleSegment = (from: ThermoState, to: ThermoState, isothermal: boolean): ThermoState[] =>
    Array.from({ length: 25 }, (_, index) => {
      const ratio = index / 24;
      const v = from.v + (to.v - from.v) * ratio;
      const p = isothermal
        ? from.p * from.v / v
        : from.p * (from.v / v) ** gamma;
      return { v: finite(v), p: finite(p), t: finite(isothermal ? from.t : from.t * (from.v / v) ** (gamma - 1)) };
    });
  const curve = [
    { label: '等温膨胀', points: sampleSegment(states[0], states[1], true) },
    { label: '绝热膨胀', points: sampleSegment(states[1], states[2], false) },
    { label: '等温压缩', points: sampleSegment(states[2], states[3], true) },
    { label: '绝热压缩', points: sampleSegment(states[3], states[0], false) },
  ];
  return {
    states,
    curve,
    series: makeSeries('卡诺循环分段功', ['等温膨胀', '绝热膨胀', '等温压缩', '绝热压缩'], [work12, work23, work34, work41]),
    efficiency: finite(1 - t3 / t1),
    netWork,
    heatIn,
  };
}

export function formatPhysics(value: number, unit?: string, digits = 4): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const text = abs >= 1e5 || (abs > 0 && abs < 1e-3) ? value.toExponential(2) : Number(value.toPrecision(digits)).toString();
  return unit ? `${text} ${unit}` : text;
}
