/**
 * 登录页右侧曲面、轨迹与观察点的纯数学实现（契约 `C-SURFACEMATH@1`）。
 *
 * 约束：
 * - 不依赖 `three`、React 或任何 DOM API，可被 Node 直接单测；
 * - 所有数值的唯一来源是同目录的 `surfaceParams.json`，本文件只做公式组装；
 * - 对有限输入返回有限数，对 `NaN`/`Infinity` 输入返回 `NaN`（不抛异常），
 *   由调用方（三维模块 / 海报脚本）负责过滤。
 *
 * 坐标约定：数学坐标 `x`、`y` 为底面，`z` 为高度（向上）。
 */
import surfaceParams from './surfaceParams.json' with {type: 'json'};

export interface Vec2 {
  x: number;
  y: number;
}

export interface SurfacePoint {
  x: number;
  y: number;
  z: number;
}

export interface SurfaceNormal {
  x: number;
  y: number;
  z: number;
}

/** 曲面相位周期：24 秒一轮。 */
export const SURFACE_PHASE_PERIOD_SECONDS: number = surfaceParams.surfacePhasePeriodSeconds;
/** 活动观察点往返周期：18 秒一轮。 */
export const OBSERVATION_PATH_PERIOD_SECONDS: number = surfaceParams.observationPathPeriodSeconds;
/** 轨迹相对曲面的微小抬高，避免线与面共面闪烁。 */
export const CURVE_HEIGHT_OFFSET: number = surfaceParams.curveHeightOffset;
/** 轨迹采样点数（含首尾）。 */
export const CURVE_SAMPLE_COUNT: number = surfaceParams.curveSampleCount;
/**
 * 两个参照点的路径参数 `s`：低端与高端。
 * 低端数值读取 `surfaceParams.json` 的 `observationMindS` 键；该键名由契约
 * `C-SURFACEMATH@1` 逐字给定（语义为 observation min s），此处照抄以保持数值来源一致。
 */
export const REFERENCE_S: readonly [number, number] = [
  surfaceParams.observationMindS,
  surfaceParams.observationMaxS,
];

/**
 * 曲面定义域（契约外追加的便利导出，数值同样来自 `surfaceParams.json`）。
 * 供三维模块与海报脚本生成网格时取边界，避免第二处写死数值。
 */
export const SURFACE_X_RANGE: readonly [number, number] = [
  surfaceParams.xRange.min,
  surfaceParams.xRange.max,
];
export const SURFACE_Y_RANGE: readonly [number, number] = [
  surfaceParams.yRange.min,
  surfaceParams.yRange.max,
];
/** 行波脉冲在一个相位周期内的活动比例；其余时间曲面近乎静止。 */
export const PULSE_ACTIVE_FRACTION: number = surfaceParams.pulseActiveFraction;
/** 高斯包沿 x 方向的宽度（世界单位）。 */
export const PULSE_SIGMA: number = surfaceParams.pulseSigma;

/** 等距投影：水平方向余弦分量（30°）。 */
const ISO_COSINE = Math.cos(Math.PI / 6);
/** 等距投影：深度方向正弦分量（30°）。 */
const ISO_SINE = Math.sin(Math.PI / 6);
/** 归一化屏幕横轴缩放：让 `x∈[-3,3]`、`y∈[-1.7,1.7]` 的极端组合落入 `[-1,1]`。 */
const SCREEN_SCALE_X = 1 / 4.4;
/** 归一化屏幕纵轴缩放：覆盖 `z` 最大值约 2.15 与底面极端组合。 */
const SCREEN_SCALE_Y = 1 / 4.6;

/** 把数值夹到 `[-1,1]`；`NaN` 会继续传播为 `NaN`。 */
function clampToUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

/** 把路径参数 `s` 夹到 `[0,1]`；`NaN` 会继续传播为 `NaN`。 */
function clampPathParameter(s: number): number {
  return Math.min(1, Math.max(0, s));
}

/**
 * φ = 2π · activeTime / 24（弧度）。
 * `activeTime` 是累计播放秒数，暂停时由调用方停止增长。
 */
export function phaseAt(activeTime: number): number {
  return (Math.PI * 2 * activeTime) / SURFACE_PHASE_PERIOD_SECONDS;
}

interface PulseState {
  active: number;
  center: number;
  envelope: number;
}

/**
 * 行波脉冲：相位周期前 35% 内，一个高斯包从左向右扫过；其余时间包络为 0。
 * 返回 ``active``（是否在扫过）、``center``（波包中心 x）和 ``envelope``（平滑窗）。
 */
export function pulseStateAt(phase: number): PulseState {
  const cycle = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
  if (!(cycle < PULSE_ACTIVE_FRACTION)) {
    return {active: 0, center: SURFACE_X_RANGE[1] + PULSE_SIGMA, envelope: 0};
  }
  const travel = cycle / PULSE_ACTIVE_FRACTION;
  const center = SURFACE_X_RANGE[0] + (SURFACE_X_RANGE[1] - SURFACE_X_RANGE[0]) * travel;
  return {
    active: 1,
    center,
    envelope: Math.sin(Math.PI * travel),
  };
}

/**
 * z = 0.23x² − 0.11y² + 0.12·G(x−c(t))·cos(0.9x + 0.6y)，
 * 其中 G 为高斯包、c(t) 为从左向右扫过的中心；其余时间只剩二次曲面。
 */
export function evaluateSurface(x: number, y: number, phase: number): number {
  const quadratic =
    surfaceParams.quadraticXCoefficient * x * x + surfaceParams.quadraticYCoefficient * y * y;
  const pulse = pulseStateAt(phase);
  if (pulse.active === 0) return quadratic;
  const gaussian = Math.exp(-((x - pulse.center) ** 2) / (2 * PULSE_SIGMA * PULSE_SIGMA));
  const carrier = Math.cos(surfaceParams.waveXFreq * x + surfaceParams.waveYFreq * y);
  return quadratic + surfaceParams.waveAmplitude * pulse.envelope * gaussian * carrier;
}

/**
 * 解析法线：n = normalize(−∂f/∂x, −∂f/∂y, 1)。
 *
 * 与位置在同一个顶点循环里写入，避免 computeVertexNormals() 的额外分配。
 */
export function surfaceNormal(x: number, y: number, phase: number): SurfaceNormal {
  const pulse = pulseStateAt(phase);
  let dfdx = 2 * surfaceParams.quadraticXCoefficient * x;
  let dfdy = 2 * surfaceParams.quadraticYCoefficient * y;
  if (pulse.active !== 0) {
    const offset = x - pulse.center;
    const sigmaSq = PULSE_SIGMA * PULSE_SIGMA;
    const gaussian = Math.exp(-(offset * offset) / (2 * sigmaSq));
    const dgdx = (-offset / sigmaSq) * gaussian;
    const theta = surfaceParams.waveXFreq * x + surfaceParams.waveYFreq * y;
    const carrier = Math.cos(theta);
    const sine = Math.sin(theta);
    const scale = surfaceParams.waveAmplitude * pulse.envelope;
    dfdx += scale * (dgdx * carrier - gaussian * surfaceParams.waveXFreq * sine);
    dfdy += scale * (-gaussian * surfaceParams.waveYFreq * sine);
  }
  const length = Math.hypot(dfdx, dfdy, 1);
  return {x: -dfdx / length, y: -dfdy / length, z: 1 / length};
}

/**
 * 轨迹点：x = −2.6 + 5.2s，y = 0.30·sin(πs)，z = f(x,y,φ) + 0.018。
 * `s` 会被夹到 `[0,1]`。
 */
export function pointOnSurfacePath(s: number, phase: number): SurfacePoint {
  const clampedS = clampPathParameter(s);
  const x = surfaceParams.pathXStart + surfaceParams.pathXSpan * clampedS;
  const y = surfaceParams.pathYAmplitude * Math.sin(Math.PI * clampedS);
  const z = evaluateSurface(x, y, phase) + surfaceParams.curveHeightOffset;
  return {x, y, z};
}

/** s(t) = 0.50 − 0.35·cos(2π·t/18)，值域 `[0.15, 0.85]`，两端自然减速折返。 */
export function movingObservationS(activeTime: number): number {
  const angle = (Math.PI * 2 * activeTime) / OBSERVATION_PATH_PERIOD_SECONDS;
  return surfaceParams.movingCenterS - surfaceParams.movingAmplitudeS * Math.cos(angle);
}

/** 网格分段数：'standard' → 64×48，'low' → 40×30。 */
export function sampleSurfaceGrid(quality: 'standard' | 'low'): {
  columns: number;
  rows: number;
} {
  const grid = quality === 'low' ? surfaceParams.gridLow : surfaceParams.gridStandard;
  return {columns: grid.columns, rows: grid.rows};
}

/**
 * 固定等距投影：世界 (x,y,z) → 归一化屏幕 `Vec2`，输出落在 `[-1,1]`。
 *
 * 只用于静态海报与坐标字母定位，不参与 WebGL 相机矩阵。
 * 海报采用固定等距投影，实时场景使用透视相机，二者共享曲面公式与配色，
 * 但不逐像素对齐；海报相位取行波扫过中段的 3s。
 * 屏幕 `y` 轴向上为正（与 `normalizePointer` 的方向约定一致）。
 */
export function projectToScreen(point: SurfacePoint): Vec2 {
  const planarX = (point.x - point.y) * ISO_COSINE;
  const planarY = (point.x + point.y) * ISO_SINE + point.z;
  return {
    x: clampToUnit(planarX * SCREEN_SCALE_X),
    y: clampToUnit(planarY * SCREEN_SCALE_Y),
  };
}