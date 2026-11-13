/**
 * 单支点重对称陀螺的纯动力学（无 three / DOM 依赖，可 Node 单测）。
 *
 * 坐标与角度约定：
 * - 世界 z 轴竖直向上，支点 O 在原点；
 * - θ 是转轴与竖直方向的夹角（章动角），φ 是绕竖直轴的方位角（进动角），
 *   ψ 是绕自身对称轴的自转角；
 * - 重心 C 在转轴上距 O 为 ℓ 处，重力矩 τ = r × m g 是唯一的力矩。
 *
 * 运动方程取固定点 O 的欧拉—拉格朗日形式：
 *   φ̇ = (p_φ − I₃ ω₃ cosθ) / (I₁ sin²θ)
 *   θ̈ = sinθ / I₁ · (I₁ φ̇² cosθ − I₃ φ̇ ω₃ + m g ℓ)
 * 其中 p_φ 是竖直方向角动量（守恒量），ω₃ 是绕自身轴的自转（重力矩沿轴分量为 0，亦守恒）。
 *
 * I₁ 与 I₃ 均为**绕支点 O** 的转动惯量：I₁ = I_cm⊥ + mℓ²，I₃ = I_cm∥。
 * 数值积分采用固定步长 RK4；调用方负责按帧累积时间，本模块不包含任何渲染或计时。
 */

export const GRAVITY = 9.81;
/** 允许的最大倾角（约 70°）：再往下转子会碰到支架/台面。 */
export const MAX_TILT = 1.22;
/** 避免 θ→0 时 sin²θ 奇异的下限。 */
export const MIN_TILT = 0.045;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface GyroPhysicalParams {
  /** 转子+轴的质量，kg。 */
  mass: number;
  /** 转子半径，m。 */
  rotorRadius: number;
  /** 转子厚度，m。 */
  rotorThickness: number;
}

export interface GyroSetup {
  /** 初始自转角速度 ω_s，rad/s。 */
  spin: number;
  /** 初始倾角 θ，rad。 */
  tilt: number;
  /** 支点到重心的距离 ℓ，m。 */
  comDistance: number;
  /** 启动方式：按平稳进动条件启动，或倾斜后直接释放。 */
  release: 'steady' | 'tilt';
}

export interface GyroConstants {
  I1: number;
  I3: number;
  mgL: number;
  omega3: number;
  pPhi: number;
  pPsi: number;
}

export interface GyroState {
  theta: number;
  thetaDot: number;
  phi: number;
  psi: number;
  time: number;
  contact: boolean;
}

export interface GyroRun {
  setup: GyroSetup;
  params: GyroPhysicalParams;
  constants: GyroConstants;
  state: GyroState;
  /** 初始化时采用的进动角速度（平稳启动时是慢根）。 */
  initialPrecession: number;
  /** 当前参数下是否存在平稳进动解。 */
  steadyPossible: boolean;
}

export interface SteadyPrecessionRoots {
  /** 慢进动根：快速自转的陀螺实际表现出的进动。 */
  slow: number;
  /** 快进动根：另一个数学解，通常对应明显的章动。 */
  fast: number;
}

export const DEFAULT_PHYSICAL: GyroPhysicalParams = {
  mass: 0.72,
  rotorRadius: 0.105,
  rotorThickness: 0.028,
};

export const DEFAULT_SETUP: GyroSetup = {
  spin: 42,
  tilt: (28 * Math.PI) / 180,
  comDistance: 0.075,
  release: 'steady',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

export function momentsAboutPivot(
  params: GyroPhysicalParams,
  comDistance: number,
): {I1: number; I3: number} {
  const r = params.rotorRadius;
  const t = params.rotorThickness;
  const mass = params.mass;
  const iCmParallel = 0.5 * mass * r * r;
  const iCmPerpendicular = 0.25 * mass * r * r + (1 / 12) * mass * t * t;
  return {
    I1: iCmPerpendicular + mass * comDistance * comDistance,
    I3: iCmParallel,
  };
}

/** 平稳进动的二次方程 I₁ cosθ φ̇² − I₃ω₃ φ̇ + mgℓ = 0 的两个根。 */
export function steadyPrecessionRates(
  theta: number,
  spin: number,
  I1: number,
  I3: number,
  mgL: number,
): SteadyPrecessionRoots | null {
  const cosine = Math.cos(theta);
  if (!(cosine > 1e-4)) return null;
  if (!(spin > 0)) return null;
  const a = I1 * cosine;
  const b = -I3 * spin;
  const discriminant = b * b - 4 * a * mgL;
  if (!(discriminant >= 0)) return null;
  const root = Math.sqrt(discriminant);
  return {
    slow: (I3 * spin - root) / (2 * a),
    fast: (I3 * spin + root) / (2 * a),
  };
}

/** 快速自转、慢进动近似 Ω_p ≈ mgℓ / (I₃ω_s)。 */
export function precessionApproximation(
  mgL: number,
  I3: number,
  spin: number,
): number {
  if (!(spin > 1e-6)) return Number.POSITIVE_INFINITY;
  return mgL / (I3 * spin);
}

export function axisOf(theta: number, phi: number): Vec3 {
  const sine = Math.sin(theta);
  return {
    x: sine * Math.cos(phi),
    y: sine * Math.sin(phi),
    z: Math.cos(theta),
  };
}

/** ∂e/∂θ，沿角度增大的切向单位向量。 */
export function tiltTangentOf(theta: number, phi: number): Vec3 {
  const cosine = Math.cos(theta);
  return {
    x: cosine * Math.cos(phi),
    y: cosine * Math.sin(phi),
    z: -Math.sin(theta),
  };
}

function precessionRate(theta: number, constants: GyroConstants): number {
  const sine = Math.sin(theta);
  const denominator = constants.I1 * sine * sine;
  if (!(denominator > 1e-7)) return 0;
  return (constants.pPhi - constants.I3 * constants.omega3 * Math.cos(theta)) / denominator;
}

function acceleration(theta: number, constants: GyroConstants): number {
  const sine = Math.sin(theta);
  if (Math.abs(sine) < 1e-7) return 0;
  const phiDot = precessionRate(theta, constants);
  return (
    (sine / constants.I1) *
    (constants.I1 * phiDot * phiDot * Math.cos(theta) -
      constants.I3 * phiDot * constants.omega3 +
      constants.mgL)
  );
}

interface Derivative {
  dTheta: number;
  dThetaDot: number;
  dPhi: number;
  dPsi: number;
}

function derivative(state: GyroState, constants: GyroConstants): Derivative {
  const theta = clamp(finite(state.theta), MIN_TILT, MAX_TILT);
  const phiDot = precessionRate(theta, constants);
  const psiDot = constants.omega3 - phiDot * Math.cos(theta);
  return {
    dTheta: finite(state.thetaDot),
    dThetaDot: acceleration(theta, constants),
    dPhi: phiDot,
    dPsi: psiDot,
  };
}

function addDerivative(
  state: GyroState,
  derivativeValue: Derivative,
  factor: number,
): GyroState {
  return {
    ...state,
    theta: state.theta + derivativeValue.dTheta * factor,
    thetaDot: state.thetaDot + derivativeValue.dThetaDot * factor,
    phi: state.phi + derivativeValue.dPhi * factor,
    psi: state.psi + derivativeValue.dPsi * factor,
  };
}

/** 单步 RK4；dt 由调用方按物理时间给出。 */
export function stepGyro(
  state: GyroState,
  constants: GyroConstants,
  dt: number,
): GyroState {
  if (!(dt > 0) || !Number.isFinite(dt)) return state;

  const k1 = derivative(state, constants);
  const k2 = derivative(addDerivative(state, k1, dt / 2), constants);
  const k3 = derivative(addDerivative(state, k2, dt / 2), constants);
  const k4 = derivative(addDerivative(state, k3, dt), constants);
  const next: GyroState = {
    theta: state.theta + (dt / 6) * (k1.dTheta + 2 * k2.dTheta + 2 * k3.dTheta + k4.dTheta),
    thetaDot:
      state.thetaDot +
      (dt / 6) * (k1.dThetaDot + 2 * k2.dThetaDot + 2 * k3.dThetaDot + k4.dThetaDot),
    phi: state.phi + (dt / 6) * (k1.dPhi + 2 * k2.dPhi + 2 * k3.dPhi + k4.dPhi),
    psi: state.psi + (dt / 6) * (k1.dPsi + 2 * k2.dPsi + 2 * k3.dPsi + k4.dPsi),
    time: state.time + dt,
    contact: state.contact,
  };

  if (next.theta >= MAX_TILT) {
    return {...next, theta: MAX_TILT, thetaDot: 0, contact: true};
  }
  if (next.theta <= MIN_TILT) {
    return {...next, theta: MIN_TILT, thetaDot: Math.max(0, next.thetaDot)};
  }
  return next;
}

export function createRun(
  setup: GyroSetup,
  params: GyroPhysicalParams = DEFAULT_PHYSICAL,
): GyroRun {
  const tilt = clamp(finite(setup.tilt, DEFAULT_SETUP.tilt), MIN_TILT, MAX_TILT);
  const spin = Math.max(0, finite(setup.spin));
  const comDistance = clamp(finite(setup.comDistance, DEFAULT_SETUP.comDistance), 0.035, 0.12);
  const moments = momentsAboutPivot(params, comDistance);
  const mgL = params.mass * GRAVITY * comDistance;
  const roots =
    setup.release === 'steady'
      ? steadyPrecessionRates(tilt, spin, moments.I1, moments.I3, mgL)
      : null;
  const initialPrecession = roots === null ? 0 : roots.slow;
  const pPhi =
    moments.I1 * initialPrecession * Math.sin(tilt) * Math.sin(tilt) +
    moments.I3 * spin * Math.cos(tilt);
  const constants: GyroConstants = {
    I1: moments.I1,
    I3: moments.I3,
    mgL,
    omega3: spin,
    pPhi,
    pPsi: moments.I3 * spin,
  };
  return {
    setup: {...setup, tilt, spin, comDistance},
    params,
    constants,
    state: {
      theta: tilt,
      thetaDot: 0,
      phi: 0,
      psi: 0,
      time: 0,
      contact: false,
    },
    initialPrecession,
    steadyPossible: roots !== null,
  };
}

export function precessionOf(state: GyroState, constants: GyroConstants): number {
  return precessionRate(state.theta, constants);
}

export function angularMomentumOf(
  state: GyroState,
  constants: GyroConstants,
): Vec3 {
  const axis = axisOf(state.theta, state.phi);
  const phiDot = precessionOf(state, constants);
  const psiDot = constants.omega3 - phiDot * Math.cos(state.theta);
  // 章动的瞬时转轴是水平节线 n = (−sinφ, cosφ, 0)，不是轴端运动的 e_θ。
  const node: Vec3 = {x: -Math.sin(state.phi), y: Math.cos(state.phi), z: 0};
  // ω = φ̇ ẑ + θ̇ n + ψ̇ e；对对称陀螺 L = I₁ω + (I₃−I₁)ω₃e。
  const omega: Vec3 = {
    x: state.thetaDot * node.x + psiDot * axis.x,
    y: state.thetaDot * node.y + psiDot * axis.y,
    z: phiDot + psiDot * axis.z,
  };
  return {
    x:
      constants.I1 * omega.x +
      (constants.I3 - constants.I1) * constants.omega3 * axis.x,
    y:
      constants.I1 * omega.y +
      (constants.I3 - constants.I1) * constants.omega3 * axis.y,
    z:
      constants.I1 * omega.z +
      (constants.I3 - constants.I1) * constants.omega3 * axis.z,
  };
}

export function torqueOf(state: GyroState, constants: GyroConstants): Vec3 {
  const axis = axisOf(state.theta, state.phi);
  // r = ℓ e，mg = (0, 0, −mg)，所以 r × mg = mgℓ(−e_y, e_x, 0)。
  const weight = constants.mgL;
  return {x: -weight * axis.y, y: weight * axis.x, z: 0};
}

export function energyOf(
  state: GyroState,
  constants: GyroConstants,
): number {
  const phiDot = precessionOf(state, constants);
  const sine = Math.sin(state.theta);
  const kinetic =
    0.5 * constants.I1 * (state.thetaDot * state.thetaDot + phiDot * phiDot * sine * sine) +
    0.5 * constants.I3 * constants.omega3 * constants.omega3;
  return kinetic + constants.mgL * Math.cos(state.theta);
}

/** 竖直方向角动量 L·ẑ，应恒等于 p_φ。 */
export function verticalAngularMomentumOf(
  state: GyroState,
  constants: GyroConstants,
): number {
  return angularMomentumOf(state, constants).z;
}

export interface SimulationSample {
  time: number;
  theta: number;
  thetaDot: number;
  phi: number;
  psi: number;
  contact: boolean;
}

/** 纯数值积分（用于测试与步长校验），返回等间隔样本。 */
export function simulate(
  run: GyroRun,
  duration: number,
  step = 1 / 480,
  recordEvery = step,
): SimulationSample[] {
  const samples: SimulationSample[] = [];
  let state = run.state;
  let nextRecord = 0;
  const steps = Math.max(0, Math.ceil(duration / step));
  for (let index = 0; index <= steps; index += 1) {
    if (state.time + 1e-9 >= nextRecord || index === steps) {
      samples.push({
        time: state.time,
        theta: state.theta,
        thetaDot: state.thetaDot,
        phi: state.phi,
        psi: state.psi,
        contact: state.contact,
      });
      nextRecord = state.time + recordEvery;
    }
    if (index === steps) break;
    state = stepGyro(state, run.constants, step);
    if (state.contact) {
      const previous = samples[samples.length - 1];
      if (previous === undefined || previous.time !== state.time) {
        samples.push({
          time: state.time,
          theta: state.theta,
          thetaDot: state.thetaDot,
          phi: state.phi,
          psi: state.psi,
          contact: state.contact,
        });
      }
      break;
    }
  }
  return samples;
}

/** 平稳启动时，θ 在 duration 内的最大偏差（rad）。 */
export function steadyTiltDeviation(run: GyroRun, duration = 3, step = 1 / 480): number {
  const samples = simulate(run, duration, step, step);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    min = Math.min(min, sample.theta);
    max = Math.max(max, sample.theta);
  }
  return max - min;
}

/** 时间步减半后同一时刻 θ 的差异（rad），用于数值稳定性检查。 */
export function stepHalvingDeviation(
  run: GyroRun,
  duration = 2,
  step = 1 / 480,
): number {
  const coarse = simulate(run, duration, step, duration);
  const fine = simulate(run, duration, step / 2, duration);
  const lastCoarse = coarse[coarse.length - 1];
  const lastFine = fine[fine.length - 1];
  if (lastCoarse === undefined || lastFine === undefined) return 0;
  return Math.abs(lastCoarse.theta - lastFine.theta);
}

/** 样本中的倾角范围（rad）。 */
export function thetaRange(samples: readonly SimulationSample[]): {min: number; max: number} {
  if (samples.length === 0) return {min: 0, max: 0};
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    min = Math.min(min, sample.theta);
    max = Math.max(max, sample.theta);
  }
  return {min, max};
}

/** 从样本测量平均进动角速度（rad/s）；φ 必须是未取模的累计值。 */
export function measurePrecession(
  samples: readonly SimulationSample[],
  fromTime = 0,
): number {
  const filtered = samples.filter((sample) => sample.time >= fromTime);
  if (filtered.length < 2) return 0;
  const first = filtered[0];
  const last = filtered[filtered.length - 1];
  if (first === undefined || last === undefined) return 0;
  const dt = last.time - first.time;
  if (!(dt > 1e-6)) return 0;
  return (last.phi - first.phi) / dt;
}

export function radToDeg(value: number): number {
  return (value * 180) / Math.PI;
}

export function degToRad(value: number): number {
  return (value * Math.PI) / 180;
}
