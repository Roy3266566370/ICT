import type {
  ScienceFrame,
  ScienceMetric,
  SciencePath,
  SciencePipelineMap,
  SciencePoint,
  ScienceResult,
  ScienceScene,
  ScienceStage,
} from './sciencePipelineTypes.ts';

const SPEED_OF_LIGHT_M_PER_S = 299_792_458;
const PLANCK_CONSTANT_J_S = 6.626_070_15e-34;
const ELEMENTARY_CHARGE_C = 1.602_176_634e-19;
const IDEAL_GAS_CONSTANT_J_PER_MOL_K = 8.314_462_618_153_24;
const HC_EV_NM = PLANCK_CONSTANT_J_S * SPEED_OF_LIGHT_M_PER_S * 1e9 / ELEMENTARY_CHARGE_C;
const PROFILE_SAMPLES = 49;

type NumericParameters = Record<string, number>;
type FrameDetails = Partial<Omit<ScienceFrame, 'title' | 'scene'>>;

function finiteParameter(
  parameters: NumericParameters,
  key: string,
  fallback: number,
  minimum = -Number.MAX_VALUE,
  maximum = Number.MAX_VALUE,
): number {
  const candidate = parameters[key];
  const finite = typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback;
  return Math.min(maximum, Math.max(minimum, finite));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatNumber(value: number, digits = 3): string {
  const absolute = Math.abs(value);
  if ((absolute > 0 && absolute < 0.001) || absolute >= 100_000) return value.toExponential(2);
  return value.toFixed(digits).replace(/\.0+$|(?<=\.[0-9]*?)0+$/g, '');
}

function frame(title: string, scene: ScienceScene, details: FrameDetails = {}): ScienceFrame {
  return { title, scene, ...details };
}

function result(parameters: NumericParameters, text: string, frames: ScienceFrame[]): ScienceResult {
  return { data: { parameters, text }, frames };
}

function samplePoints(count: number, sample: (fraction: number, index: number) => [number, number]): [number, number][] {
  return Array.from({ length: count }, (_, index) => sample(index / Math.max(1, count - 1), index));
}

function pointAlongPath(points: [number, number][], fraction: number): [number, number] {
  const first = points[0];
  if (!first) return [0, 0];
  if (points.length === 1) return first;
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (!start || !end) continue;
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    lengths.push(length);
    total += length;
  }
  let remaining = clamp(fraction, 0, 1) * total;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = lengths[index - 1];
    if (!start || !end || length === undefined) continue;
    if (remaining <= length || index === points.length - 1) {
      const ratio = length > 0 ? clamp(remaining / length, 0, 1) : 0;
      return [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio];
    }
    remaining -= length;
  }
  return points[points.length - 1] ?? first;
}

function partialPath(points: [number, number][], fraction: number): [number, number][] {
  if (points.length < 2 || fraction >= 1) return points;
  const end = pointAlongPath(points, fraction);
  const partial: [number, number][] = [];
  const targetLength = fraction * points.reduce((sum, point, index) => {
    if (index === 0) return 0;
    const previous = points[index - 1];
    return previous ? sum + Math.hypot(point[0] - previous[0], point[1] - previous[1]) : sum;
  }, 0);
  let traversed = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const finish = points[index];
    if (!start || !finish) continue;
    if (partial.length === 0) partial.push(start);
    const length = Math.hypot(finish[0] - start[0], finish[1] - start[1]);
    if (traversed + length < targetLength) {
      partial.push(finish);
      traversed += length;
    } else {
      partial.push(end);
      break;
    }
  }
  return partial.length > 0 ? partial : [end];
}

export function wavelengthToRgbHex(wavelengthNm: number): string {
  const wavelength = clamp(wavelengthNm, 380, 780);
  let red = 0;
  let green = 0;
  let blue = 0;
  if (wavelength < 440) {
    red = (440 - wavelength) / 60;
    blue = 1;
  } else if (wavelength < 490) {
    green = (wavelength - 440) / 50;
    blue = 1;
  } else if (wavelength < 510) {
    green = 1;
    blue = (510 - wavelength) / 20;
  } else if (wavelength < 580) {
    red = (wavelength - 510) / 70;
    green = 1;
  } else if (wavelength < 645) {
    red = 1;
    green = (645 - wavelength) / 65;
  } else {
    red = 1;
  }
  let attenuation = 1;
  if (wavelength < 420) attenuation = 0.3 + 0.7 * (wavelength - 380) / 40;
  if (wavelength > 700) attenuation = 0.3 + 0.7 * (780 - wavelength) / 80;
  const channel = (value: number): string => Math.round(255 * Math.pow(clamp(value * attenuation, 0, 1), 0.8))
    .toString(16).padStart(2, '0');
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

interface DoubleSlitConfiguration extends NumericParameters {
  wavelengthNm: number;
  slitSeparationUm: number;
  slitWidthUm: number;
  slitCount: number;
  screenDistanceM: number;
}

function normalizeDoubleSlit(parameters: NumericParameters): DoubleSlitConfiguration {
  return {
    wavelengthNm: finiteParameter(parameters, 'wavelengthNm', 550, 380, 780),
    slitSeparationUm: finiteParameter(parameters, 'slitSeparationUm', 25, 1, 500),
    slitWidthUm: finiteParameter(parameters, 'slitWidthUm', 5, 0.1, 200),
    slitCount: Math.round(finiteParameter(parameters, 'slitCount', 2, 2, 12)),
    screenDistanceM: finiteParameter(parameters, 'screenDistanceM', 1.2, 0.05, 20),
  };
}

export function normalizedMultiSlitIntensity(
  angleRad: number,
  wavelengthNm: number,
  slitSeparationUm: number,
  slitWidthUm: number,
  slitCount: number,
): number {
  const wavelengthM = Math.max(1e-12, wavelengthNm * 1e-9);
  const separationM = Math.max(1e-12, slitSeparationUm * 1e-6);
  const widthM = Math.min(separationM, Math.max(1e-12, slitWidthUm * 1e-6));
  const count = Math.max(1, Math.round(slitCount));
  const sine = Math.sin(angleRad);
  const alpha = Math.PI * widthM * sine / wavelengthM;
  const beta = Math.PI * separationM * sine / wavelengthM;
  const sinc = Math.abs(alpha) < 1e-10 ? 1 : Math.sin(alpha) / alpha;
  const denominator = count * Math.sin(beta);
  const interference = Math.abs(denominator) < 1e-9 ? 1 : Math.sin(count * beta) / denominator;
  return clamp(sinc * sinc * interference * interference, 0, 1);
}

function doubleSlitIntensity(configuration: DoubleSlitConfiguration, screenPositionM: number): number {
  const angle = Math.atan(screenPositionM / configuration.screenDistanceM);
  return normalizedMultiSlitIntensity(
    angle,
    configuration.wavelengthNm,
    configuration.slitSeparationUm,
    Math.min(configuration.slitWidthUm, configuration.slitSeparationUm),
    configuration.slitCount,
  );
}

function doubleSlitProfile(configuration: DoubleSlitConfiguration, halfWidthM: number): { x: number; intensity: number }[] {
  return Array.from({ length: PROFILE_SAMPLES }, (_, index) => {
    const x = -halfWidthM + 2 * halfWidthM * index / (PROFILE_SAMPLES - 1);
    return { x, intensity: doubleSlitIntensity(configuration, x) };
  });
}

function intensityPath(profile: { x: number; intensity: number }[], color: string, dashed = false): SciencePath {
  return {
    points: profile.map((entry, index): [number, number] => [
      35 + index * 330 / Math.max(1, profile.length - 1),
      210 - entry.intensity * 170,
    ]),
    stroke: color,
    strokeWidth: 2,
    dashed,
  };
}

function doubleSlitMetrics(configuration: DoubleSlitConfiguration, spacingM: number): ScienceMetric[] {
  return [
    { label: '条纹间距 Δx', value: `${formatNumber(spacingM * 1e3)} mm`, emphasis: true },
    { label: '缝数 N', value: String(configuration.slitCount) },
    { label: '波长 λ', value: `${formatNumber(configuration.wavelengthNm, 1)} nm` },
  ];
}

type DoubleSlitView = 'source' | 'interference' | 'fringes' | 'comparison';

function runDoubleSlit(view: DoubleSlitView, parameters: NumericParameters, text: string): ScienceResult {
  const configuration = normalizeDoubleSlit(parameters);
  const wavelengthM = configuration.wavelengthNm * 1e-9;
  const separationM = configuration.slitSeparationUm * 1e-6;
  const spacingM = wavelengthM * configuration.screenDistanceM / separationM;
  const halfWidthM = Math.min(0.3 * configuration.screenDistanceM, 5 * spacingM);
  const profile = doubleSlitProfile(configuration, halfWidthM);
  const color = wavelengthToRgbHex(configuration.wavelengthNm);
  const metrics = doubleSlitMetrics(configuration, spacingM);

  if (view === 'fringes') {
    const orders = Array.from({ length: 9 }, (_, index) => index - 4)
      .filter((order) => Math.abs(order * spacingM) <= halfWidthM * 1.001);
    const rows = orders.map((order) => {
      const x = order * spacingM;
      return [order, formatNumber(x * 1e3, 3), formatNumber(Math.atan(x / configuration.screenDistanceM) * 180 / Math.PI, 3)];
    });
    const frames = orders.map((order, frameIndex) => {
      const x = order * spacingM;
      const screenX = 200 + x / halfWidthM * 155;
      const points: SciencePoint[] = orders.map((item) => ({
        x: 200 + item * spacingM / halfWidthM * 155,
        y: 112,
        radius: item === order ? 8 : 4 + 4 * doubleSlitIntensity(configuration, item * spacingM),
        color,
        hollow: item !== order,
        label: `m=${item}`,
      }));
      return frame(`第 ${order} 级主极大`, {
        ariaLabel: `双缝或光栅第 ${order} 级主极大位置`,
        paths: [{ points: [[45, 112], [355, 112]], stroke: '#64748b', strokeWidth: 2 }],
        points,
        labels: [
          { x: 200, y: 32, text: `xₘ = mλL/d，m = ${order}`, anchor: 'middle', size: 15 },
          { x: screenX, y: 170, text: `x = ${formatNumber(x * 1e3)} mm`, anchor: 'middle', color },
        ],
      }, {
        summary: `相邻主极大间距为 ${formatNumber(spacingM * 1e3)} mm。`,
        columns: ['级次 m', '屏上位置 x / mm', '角位置 θ / °'],
        rows,
        highlightRows: [frameIndex],
        metrics,
      });
    });
    return result(configuration, text, frames);
  }

  if (view === 'comparison') {
    const doubleConfiguration: DoubleSlitConfiguration = { ...configuration, slitCount: 2 };
    const doubleProfile = doubleSlitProfile(doubleConfiguration, halfWidthM);
    const principalWidthM = wavelengthM * configuration.screenDistanceM
      / (configuration.slitCount * separationM);
    const frames = profile.map((entry, index) => {
      const x = 35 + index * 330 / (profile.length - 1);
      return frame(`N=${configuration.slitCount} 与双缝对照 ${index + 1}/${profile.length}`, {
        ariaLabel: '多缝光栅与双缝归一化光强分布对照',
        grid: true,
        axes: true,
        paths: [intensityPath(profile, color), intensityPath(doubleProfile, '#94a3b8', true)],
        points: [
          { x, y: 210 - entry.intensity * 170, radius: 5, color },
          { x, y: 210 - (doubleProfile[index]?.intensity ?? 0) * 170, radius: 4, color: '#94a3b8' },
        ],
        labels: [
          { x: 42, y: 26, text: `实线：N=${configuration.slitCount}；虚线：N=2`, color },
          { x: 200, y: 232, text: '屏上位置（相同扫描区间）', anchor: 'middle' },
        ],
      }, {
        summary: '缝数增加时主极大更尖锐，但相邻主极大的间距不变。',
        metrics: [
          ...metrics,
          { label: '主极大半宽估计', value: `${formatNumber(principalWidthM * 1e3)} mm` },
        ],
        series: [
          { label: `N=${configuration.slitCount}`, values: profile.map((item) => item.intensity) },
          { label: 'N=2', values: doubleProfile.map((item) => item.intensity) },
        ],
      });
    });
    return result(configuration, text, frames);
  }

  const frames = profile.map((entry, index) => {
    const fraction = index / (profile.length - 1);
    const screenY = 30 + fraction * 180;
    if (view === 'source') {
      const stripes = profile.map((stripe, stripeIndex) => ({
        x: 329,
        y: 30 + stripeIndex * 180 / (profile.length - 1) - 2,
        width: 8,
        height: 180 / (profile.length - 1) + 2,
        fill: color,
        opacity: 0.04 + stripe.intensity * 0.96,
      }));
      return frame(`波长真实颜色条纹 ${index + 1}/${profile.length}`, {
        ariaLabel: `${configuration.wavelengthNm} nm 光经过 ${configuration.slitCount} 条狭缝形成的屏幕条纹`,
        rects: [
          { x: 108, y: 35, width: 8, height: 170, fill: '#334155' },
          { x: 328, y: 28, width: 10, height: 184, fill: '#e2e8f0', stroke: '#64748b' },
          ...stripes,
        ],
        paths: [
          { points: [[25, 120], [108, 120]], stroke: color, strokeWidth: 3 },
          { points: [[116, 120 - configuration.slitCount * 3], [330, screenY]], stroke: color, dashed: true },
          { points: [[116, 120 + configuration.slitCount * 3], [330, screenY]], stroke: color, dashed: true },
        ],
        points: [{ x: 338, y: screenY, radius: 5, color }],
        labels: [
          { x: 25, y: 95, text: `λ=${formatNumber(configuration.wavelengthNm)} nm`, color },
          { x: 112, y: 224, text: `${configuration.slitCount} 缝`, anchor: 'middle' },
          { x: 350, y: 224, text: `I=${formatNumber(entry.intensity, 3)}`, color },
        ],
      }, { summary: `屏上 x=${formatNumber(entry.x * 1e3)} mm，归一化光强 ${formatNumber(entry.intensity)}。`, metrics });
    }
    const rayStartY = Array.from({ length: configuration.slitCount }, (_, slitIndex) =>
      120 + (slitIndex - (configuration.slitCount - 1) / 2) * 9);
    return frame(`多缝干涉扫描 ${index + 1}/${profile.length}`, {
      ariaLabel: '多缝干涉光强曲线及当前屏幕采样点',
      grid: true,
      axes: true,
      paths: [
        intensityPath(profile, color),
        ...rayStartY.map((y): SciencePath => ({ points: [[15, y], [45, 210 - entry.intensity * 170]], stroke: color, dashed: true })),
      ],
      points: [{ x: 35 + fraction * 330, y: 210 - entry.intensity * 170, radius: 6, color }],
      labels: [
        { x: 42, y: 26, text: 'I/I₀ = [sin(Nβ)/(N sinβ)]² · [sinα/α]²', color },
        { x: 200, y: 232, text: `x=${formatNumber(entry.x * 1e3)} mm`, anchor: 'middle' },
      ],
    }, {
      summary: `单缝包络与 ${configuration.slitCount} 缝干涉因子共同决定光强。`,
      metrics,
      series: [{ label: '归一化光强', values: profile.map((item) => item.intensity) }],
    });
  });
  return result(configuration, text, frames);
}

export interface RefractionCalculation {
  incidentAngleRad: number;
  transmittedAngleRad: number | null;
  criticalAngleRad: number | null;
  totalInternalReflection: boolean;
}

export function calculateRefraction(n1: number, n2: number, incidentAngleDegrees: number): RefractionCalculation {
  const incidentIndex = Math.max(1e-6, n1);
  const transmittedIndex = Math.max(1e-6, n2);
  const incidentAngleRad = clamp(incidentAngleDegrees, 0, 89.999) * Math.PI / 180;
  const transmittedSine = incidentIndex * Math.sin(incidentAngleRad) / transmittedIndex;
  const totalInternalReflection = transmittedSine > 1;
  return {
    incidentAngleRad,
    transmittedAngleRad: totalInternalReflection ? null : Math.asin(clamp(transmittedSine, -1, 1)),
    criticalAngleRad: incidentIndex > transmittedIndex ? Math.asin(transmittedIndex / incidentIndex) : null,
    totalInternalReflection,
  };
}

interface RefractionConfiguration extends NumericParameters {
  n1: number;
  n2: number;
  incidentAngleDegrees: number;
  coreIndex: number;
  claddingIndex: number;
}

function normalizeRefraction(parameters: NumericParameters): RefractionConfiguration {
  return {
    n1: finiteParameter(parameters, 'n1', 1, 1, 3),
    n2: finiteParameter(parameters, 'n2', 1.5, 1, 3),
    incidentAngleDegrees: finiteParameter(parameters, 'incidentAngleDegrees', 35, 0, 89),
    coreIndex: finiteParameter(parameters, 'coreIndex', 1.5, 1.001, 3),
    claddingIndex: finiteParameter(parameters, 'claddingIndex', 1.46, 1, 2.999),
  };
}

function refractionScene(configuration: RefractionConfiguration, progress: number, angleOverride?: number): ScienceScene {
  const angle = angleOverride ?? configuration.incidentAngleDegrees;
  const calculation = calculateRefraction(configuration.n1, configuration.n2, angle);
  const origin: [number, number] = [200, 120];
  const incident: [number, number] = [
    origin[0] - Math.sin(calculation.incidentAngleRad) * 150,
    origin[1] - Math.cos(calculation.incidentAngleRad) * 105,
  ];
  const outgoingAngle = calculation.transmittedAngleRad ?? calculation.incidentAngleRad;
  const outgoing: [number, number] = calculation.totalInternalReflection
    ? [origin[0] + Math.sin(outgoingAngle) * 150, origin[1] - Math.cos(outgoingAngle) * 105]
    : [origin[0] + Math.sin(outgoingAngle) * 150, origin[1] + Math.cos(outgoingAngle) * 105];
  const pulse = pointAlongPath([incident, origin, outgoing], progress);
  const labels = [
    { x: 25, y: 22, text: `n₁=${formatNumber(configuration.n1)}，θ₁=${formatNumber(angle)}°` },
    { x: 25, y: 218, text: calculation.totalInternalReflection
      ? ' sinθ₂>1：发生全反射，无透射光'
      : `n₂=${formatNumber(configuration.n2)}，θ₂=${formatNumber((calculation.transmittedAngleRad ?? 0) * 180 / Math.PI)}°` },
  ];
  return {
    ariaLabel: calculation.totalInternalReflection ? '光在界面发生全反射' : '光在两种介质界面折射',
    paths: [
      { points: [[200, 15], [200, 225]], stroke: '#94a3b8', dashed: true },
      { points: [[25, 120], [375, 120]], stroke: '#334155', strokeWidth: 2 },
      { points: [incident, origin], stroke: '#f59e0b', strokeWidth: 3 },
      { points: [origin, outgoing], stroke: calculation.totalInternalReflection ? '#ef4444' : '#0ea5e9', strokeWidth: 3 },
    ],
    points: [{ x: pulse[0], y: pulse[1], radius: 5, color: '#f8fafc' }],
    labels,
  };
}

function fiberGeometry(configuration: RefractionConfiguration): {
  numericalAperture: number;
  acceptanceAngleRad: number | null;
  internalAngleRad: number | null;
  path: [number, number][];
} {
  if (configuration.coreIndex <= configuration.claddingIndex) {
    return { numericalAperture: 0, acceptanceAngleRad: null, internalAngleRad: null, path: [[35, 120], [365, 120]] };
  }
  const numericalAperture = Math.sqrt(configuration.coreIndex ** 2 - configuration.claddingIndex ** 2);
  const acceptanceAngleRad = numericalAperture >= 1 ? Math.PI / 2 : Math.asin(numericalAperture);
  const internalAngleRad = Math.asin(clamp(Math.sin(acceptanceAngleRad) / configuration.coreIndex, 0, 1));
  const bounceCount = clamp(Math.round(320 * Math.tan(internalAngleRad) / 70), 2, 12);
  const path: [number, number][] = [[35, 120]];
  for (let index = 0; index <= bounceCount; index += 1) {
    path.push([55 + index * 290 / bounceCount, index % 2 === 0 ? 85 : 155]);
  }
  path.push([365, 120]);
  return { numericalAperture, acceptanceAngleRad, internalAngleRad, path };
}

type RefractionView = 'source' | 'snell' | 'critical' | 'fiber';

function runRefraction(view: RefractionView, parameters: NumericParameters, text: string): ScienceResult {
  const configuration = normalizeRefraction(parameters);
  const calculation = calculateRefraction(configuration.n1, configuration.n2, configuration.incidentAngleDegrees);
  const baseMetrics: ScienceMetric[] = [
    { label: '折射状态', value: calculation.totalInternalReflection ? '全反射' : '有透射光', emphasis: true },
    { label: '斯涅尔不变量', value: formatNumber(configuration.n1 * Math.sin(calculation.incidentAngleRad)) },
  ];
  if (view === 'fiber') {
    const fiber = fiberGeometry(configuration);
    const valid = fiber.acceptanceAngleRad !== null && fiber.internalAngleRad !== null;
    const metrics: ScienceMetric[] = valid ? [
      { label: '数值孔径 NA', value: formatNumber(fiber.numericalAperture), emphasis: true },
      { label: '空气中接受角', value: `${formatNumber((fiber.acceptanceAngleRad ?? 0) * 180 / Math.PI)}°` },
      { label: '芯内轴向角上限', value: `${formatNumber((fiber.internalAngleRad ?? 0) * 180 / Math.PI)}°` },
    ] : [{ label: '导光状态', value: '纤芯折射率必须大于包层', emphasis: true }];
    const frames = samplePoints(PROFILE_SAMPLES, (fraction, index) => pointAlongPath(fiber.path, fraction))
      .map((pulse, index) => frame(valid ? `光纤全反射导光 ${index + 1}/${PROFILE_SAMPLES}` : '光纤结构不满足导光条件', {
        ariaLabel: valid ? '光在纤芯与包层界面连续全反射' : '纤芯折射率不大于包层，不能形成全反射导光',
        rects: [
          { x: 25, y: 65, width: 350, height: 110, fill: '#bae6fd', stroke: '#0284c7', opacity: 0.35, label: '包层' },
          { x: 25, y: 85, width: 350, height: 70, fill: '#fef3c7', stroke: '#d97706', opacity: 0.7, label: '纤芯' },
        ],
        paths: [{ points: fiber.path, stroke: valid ? '#f59e0b' : '#94a3b8', strokeWidth: 3, dashed: !valid }],
        points: valid ? [{ x: pulse[0], y: pulse[1], radius: 5, color: '#ef4444' }] : [],
        labels: [
          { x: 200, y: 28, text: `NA=√(n芯²-n包²)=${formatNumber(fiber.numericalAperture)}`, anchor: 'middle' },
          { x: 200, y: 215, text: valid ? '每次芯—包层界面入射角均大于临界角' : '不存在满足全反射的芯—包层结构', anchor: 'middle' },
        ],
      }, { summary: valid ? '接受角由数值孔径决定，光线路径按芯内轴向角生成。' : '请提高纤芯折射率或降低包层折射率。', metrics }));
    return result(configuration, text, frames);
  }
  if (view === 'critical') {
    const frames = Array.from({ length: 45 }, (_, index) => {
      const scanAngle = index * 2;
      const scanned = calculateRefraction(configuration.n1, configuration.n2, scanAngle);
      return frame(`入射角扫描 ${scanAngle}°`, refractionScene(configuration, 1, scanAngle), {
        summary: scanned.totalInternalReflection ? '当前角度发生全反射。' : '当前角度存在折射光。',
        metrics: [
          { label: '临界角', value: calculation.criticalAngleRad === null
            ? 'n₁≤n₂，无全反射临界角'
            : `${formatNumber(calculation.criticalAngleRad * 180 / Math.PI)}°`, emphasis: true },
          { label: '扫描状态', value: scanned.totalInternalReflection ? '全反射' : '折射' },
        ],
      });
    });
    return result(configuration, text, frames);
  }
  const frames = Array.from({ length: 31 }, (_, index) => {
    const progress = index / 30;
    return frame(view === 'source' ? `界面光路 ${index + 1}/31` : `斯涅尔定律 ${index + 1}/31`,
      refractionScene(configuration, progress), {
        summary: calculation.totalInternalReflection
          ? '折射角无实数解，能量转入反射光；不伪造折射角。'
          : 'n₁sinθ₁=n₂sinθ₂，折射角由实际折射率与入射角计算。',
        columns: ['入射角 θ₁ / °', '折射角 θ₂ / °', 'n₁sinθ₁', 'n₂sinθ₂'],
        rows: [[
          formatNumber(configuration.incidentAngleDegrees),
          calculation.transmittedAngleRad === null ? '无实数解' : formatNumber(calculation.transmittedAngleRad * 180 / Math.PI),
          formatNumber(configuration.n1 * Math.sin(calculation.incidentAngleRad)),
          calculation.transmittedAngleRad === null ? '—' : formatNumber(configuration.n2 * Math.sin(calculation.transmittedAngleRad)),
        ]],
        metrics: baseMetrics,
      });
  });
  return result(configuration, text, frames);
}

export interface ThinLensImageCalculation {
  imageDistanceMm: number | null;
  magnification: number | null;
  imageHeightMm: number | null;
  state: 'real' | 'virtual' | 'at-infinity';
}

export function calculateThinLensImage(
  focalLengthMm: number,
  objectDistanceMm: number,
  objectHeightMm: number,
): ThinLensImageCalculation {
  const focal = Math.max(1e-9, focalLengthMm);
  const object = Math.max(1e-9, objectDistanceMm);
  if (Math.abs(object - focal) <= 1e-8 * Math.max(object, focal)) {
    return { imageDistanceMm: null, magnification: null, imageHeightMm: null, state: 'at-infinity' };
  }
  const imageDistanceMm = focal * object / (object - focal);
  const magnification = -imageDistanceMm / object;
  return {
    imageDistanceMm,
    magnification,
    imageHeightMm: magnification * objectHeightMm,
    state: imageDistanceMm > 0 ? 'real' : 'virtual',
  };
}

interface ThinLensConfiguration extends NumericParameters {
  focalLengthMm: number;
  objectDistanceMm: number;
  objectHeightMm: number;
}

function normalizeThinLens(parameters: NumericParameters): ThinLensConfiguration {
  return {
    focalLengthMm: finiteParameter(parameters, 'focalLengthMm', 100, 5, 1000),
    objectDistanceMm: finiteParameter(parameters, 'objectDistanceMm', 180, 5.001, 2000),
    objectHeightMm: finiteParameter(parameters, 'objectHeightMm', 30, 0.1, 300),
  };
}

interface LensRayGeometry {
  paths: SciencePath[];
  backwardPaths: SciencePath[];
  imagePoint: SciencePoint | null;
  stateLabel: string;
}

function thinLensGeometry(configuration: ThinLensConfiguration, progress = 1): LensRayGeometry {
  const image = calculateThinLensImage(
    configuration.focalLengthMm,
    configuration.objectDistanceMm,
    configuration.objectHeightMm,
  );
  const focal = configuration.focalLengthMm;
  const object = configuration.objectDistanceMm;
  const height = configuration.objectHeightMm;
  const extent = Math.max(
    object * 1.2,
    focal * 1.5,
    Math.min(Math.abs(image.imageDistanceMm ?? focal) * 1.15, focal * 5 + object * 3),
  );
  const atFocus = image.state === 'at-infinity';
  const thirdLensHeight = atFocus ? height * 0.5 : height * focal / (focal - object);
  const lensHeights = [height, 0, thirdLensHeight];
  const rawPaths = lensHeights.map((lensHeight): [number, number][] => {
    const incomingSlope = (lensHeight - height) / object;
    const outgoingSlope = incomingSlope - lensHeight / focal;
    return [[-object, height], [0, lensHeight], [extent, lensHeight + outgoingSlope * extent]];
  });
  const yCandidates = [height, -height, ...rawPaths.flatMap((path) => path.map((point) => point[1]))];
  if (image.imageHeightMm !== null && Math.abs(image.imageDistanceMm ?? 0) <= extent) {
    yCandidates.push(image.imageHeightMm);
  }
  const yExtent = Math.max(1, ...yCandidates.map((value) => Math.abs(value))) * 1.12;
  const project = (point: [number, number]): [number, number] => [
    200 + point[0] / extent * 175,
    120 - point[1] / yExtent * 100,
  ];
  const colors = ['#ef4444', '#0ea5e9', '#f59e0b'];
  const paths = rawPaths.map((rawPath, index): SciencePath => ({
    points: partialPath(rawPath.map((point) => project(point)), progress),
    stroke: colors[index] ?? '#64748b',
    strokeWidth: 2,
  }));
  const backwardPaths: SciencePath[] = [];
  if (image.state === 'virtual' && image.imageDistanceMm !== null && image.imageHeightMm !== null) {
    rawPaths.forEach((rawPath, index) => {
      const lensPoint = rawPath[1];
      if (!lensPoint) return;
      const slope = (image.imageHeightMm as number - lensPoint[1]) / ((image.imageDistanceMm as number) - 0);
      const endX = Math.max(-extent, image.imageDistanceMm as number);
      backwardPaths.push({
        points: [project(lensPoint), project([endX, lensPoint[1] + slope * (endX - lensPoint[0])])],
        stroke: colors[index] ?? '#64748b',
        dashed: true,
      });
    });
  }
  const imagePoint = image.imageDistanceMm !== null && image.imageHeightMm !== null
    && Math.abs(image.imageDistanceMm) <= extent
    ? {
      ...(() => {
        const projected = project([image.imageDistanceMm as number, image.imageHeightMm as number]);
        return { x: projected[0], y: projected[1] };
      })(),
      radius: 6,
      color: image.state === 'real' ? '#16a34a' : '#8b5cf6',
      label: image.state === 'real' ? '实像' : '虚像',
    }
    : null;
  const stateLabel = image.state === 'real' ? '倒立实像，可在屏上承接'
    : image.state === 'virtual' ? '正立虚像，只能由出射光反向延长得到' : '物在焦平面，出射光平行，像在无穷远';
  return { paths, backwardPaths, imagePoint, stateLabel };
}

function thinLensScene(configuration: ThinLensConfiguration, progress: number, showRays: boolean): ScienceScene {
  const geometry = thinLensGeometry(configuration, progress);
  return {
    ariaLabel: `薄透镜成像，${geometry.stateLabel}`,
    paths: [
      { points: [[25, 120], [375, 120]], stroke: '#64748b' },
      { points: [[200, 20], [200, 220]], stroke: '#0ea5e9', strokeWidth: 3 },
      ...(showRays ? [...geometry.paths, ...geometry.backwardPaths] : []),
    ],
    points: geometry.imagePoint && showRays ? [geometry.imagePoint] : [],
    vectors: [{
      x: 200 - configuration.objectDistanceMm / Math.max(configuration.objectDistanceMm * 1.2, configuration.focalLengthMm * 1.5) * 175,
      y: 120,
      dx: 0,
      dy: -45,
      color: '#16a34a',
      label: '物',
    }],
    labels: [
      { x: 200, y: 16, text: `f=${formatNumber(configuration.focalLengthMm)} mm`, anchor: 'middle', color: '#0284c7' },
      { x: 200, y: 234, text: geometry.stateLabel, anchor: 'middle' },
      { x: 165, y: 112, text: 'F', anchor: 'middle' },
      { x: 235, y: 112, text: 'F′', anchor: 'middle' },
    ],
  };
}

function thinLensMetrics(configuration: ThinLensConfiguration): ScienceMetric[] {
  const image = calculateThinLensImage(
    configuration.focalLengthMm,
    configuration.objectDistanceMm,
    configuration.objectHeightMm,
  );
  return [
    { label: '像距 v', value: image.imageDistanceMm === null ? '无穷远' : `${formatNumber(image.imageDistanceMm)} mm`, emphasis: true },
    { label: '横向放大率 m', value: image.magnification === null ? '无有限像' : formatNumber(image.magnification) },
    { label: '像性质', value: image.state === 'real' ? '倒立实像' : image.state === 'virtual' ? '正立虚像' : '出射光平行' },
  ];
}

type ThinLensView = 'source' | 'imaging' | 'equation' | 'comparison';

function runThinLens(view: ThinLensView, parameters: NumericParameters, text: string): ScienceResult {
  const configuration = normalizeThinLens(parameters);
  const image = calculateThinLensImage(
    configuration.focalLengthMm,
    configuration.objectDistanceMm,
    configuration.objectHeightMm,
  );
  const metrics = thinLensMetrics(configuration);
  if (view === 'comparison') {
    const cases: { label: string; configuration: ThinLensConfiguration }[] = [
      { label: '当前物距', configuration },
      { label: '物距 0.5f', configuration: { ...configuration, objectDistanceMm: configuration.focalLengthMm * 0.5 } },
      { label: '物距 2f', configuration: { ...configuration, objectDistanceMm: configuration.focalLengthMm * 2 } },
    ];
    const rows = cases.map((item) => {
      const calculated = calculateThinLensImage(
        item.configuration.focalLengthMm,
        item.configuration.objectDistanceMm,
        item.configuration.objectHeightMm,
      );
      return [
        item.label,
        formatNumber(item.configuration.objectDistanceMm),
        calculated.imageDistanceMm === null ? '∞' : formatNumber(calculated.imageDistanceMm),
        calculated.magnification === null ? '—' : formatNumber(calculated.magnification),
        calculated.state === 'real' ? '实像' : calculated.state === 'virtual' ? '虚像' : '无穷远',
      ];
    });
    const frames = cases.map((item, index) => frame(item.label, thinLensScene(item.configuration, 1, true), {
      summary: '同一焦距下对照虚像、二倍焦距等大实像与当前物距。',
      columns: ['情形', 'u / mm', 'v / mm', 'm', '像性质'],
      rows,
      highlightRows: [index],
      metrics: thinLensMetrics(item.configuration),
    }));
    return result(configuration, text, frames);
  }
  if (view === 'equation') {
    const rows = [[
      formatNumber(configuration.focalLengthMm),
      formatNumber(configuration.objectDistanceMm),
      image.imageDistanceMm === null ? '∞' : formatNumber(image.imageDistanceMm),
      image.magnification === null ? '—' : formatNumber(image.magnification),
      image.imageHeightMm === null ? '—' : formatNumber(image.imageHeightMm),
    ]];
    const frames = Array.from({ length: 3 }, (_, index) => {
      const scene = thinLensScene(configuration, 1, true);
      return frame(['平行光—焦平面光线', '通过光心光线', '经过物方焦点光线'][index] ?? '薄透镜方程', {
        ...scene,
        labels: [...(scene.labels ?? []), { x: 200, y: 40, text: '1/f = 1/u + 1/v，m = -v/u', anchor: 'middle', size: 16 }],
      }, {
        summary: '三条光线均由同一薄透镜方程与光线传递关系确定。',
        columns: ['f / mm', 'u / mm', 'v / mm', 'm=-v/u', '像高 / mm'],
        rows,
        metrics,
      });
    });
    return result(configuration, text, frames);
  }
  const count = view === 'source' ? 12 : 37;
  const frames = Array.from({ length: count }, (_, index) => {
    const progress = view === 'source' ? 1 : index / (count - 1);
    return frame(view === 'source' ? `薄透镜装置 ${index + 1}/${count}` : `三光线成像 ${index + 1}/${count}`,
      thinLensScene(configuration, progress, view === 'imaging'), {
        summary: image.state === 'at-infinity'
          ? '物位于焦平面，出射光平行，因此不生成有限像距或伪放大率。'
          : '平行光、光心光线和焦平面光线共同确定像点。',
        metrics,
      });
  });
  return result(configuration, text, frames);
}

interface CarnotState {
  label: 'A' | 'B' | 'C' | 'D';
  volumeL: number;
  pressureKPa: number;
  temperatureK: number;
}

interface CarnotPoint {
  volumeL: number;
  pressureKPa: number;
  temperatureK: number;
  segment: 'A→B' | 'B→C' | 'C→D' | 'D→A';
}

export interface CarnotCycleCalculation {
  parameters: NumericParameters;
  states: CarnotState[];
  points: CarnotPoint[];
  efficiency: number;
  heatInputJ: number;
  heatRejectedJ: number;
  netWorkJ: number;
}

export function calculateCarnotCycle(parameters: NumericParameters): CarnotCycleCalculation {
  const normalized = {
    hotTemperatureK: finiteParameter(parameters, 'hotTemperatureK', 600, 2, 3000),
    coldTemperatureK: finiteParameter(parameters, 'coldTemperatureK', 300, 1, 2999),
    initialVolumeL: finiteParameter(parameters, 'initialVolumeL', 10, 0.1, 1000),
    isothermalExpansionRatio: finiteParameter(parameters, 'isothermalExpansionRatio', 2, 1.01, 20),
    amountMol: finiteParameter(parameters, 'amountMol', 1, 0.001, 100),
    referenceColdTemperatureK: finiteParameter(parameters, 'referenceColdTemperatureK', 300, 1, 2999),
  };
  if (normalized.hotTemperatureK <= normalized.coldTemperatureK) {
    throw new Error('卡诺循环要求高温热源温度严格高于低温热源温度');
  }
  const gamma = 1.4;
  const { hotTemperatureK: hot, coldTemperatureK: cold, initialVolumeL: va, amountMol: amount } = normalized;
  const expansion = normalized.isothermalExpansionRatio;
  const adiabaticExpansion = Math.pow(hot / cold, 1 / (gamma - 1));
  const vb = va * expansion;
  const vc = vb * adiabaticExpansion;
  const vd = va * adiabaticExpansion;
  const pressureKPa = (volumeL: number, temperatureK: number): number =>
    amount * IDEAL_GAS_CONSTANT_J_PER_MOL_K * temperatureK / (volumeL * 1e-3) / 1000;
  const states: CarnotState[] = [
    { label: 'A', volumeL: va, pressureKPa: pressureKPa(va, hot), temperatureK: hot },
    { label: 'B', volumeL: vb, pressureKPa: pressureKPa(vb, hot), temperatureK: hot },
    { label: 'C', volumeL: vc, pressureKPa: pressureKPa(vc, cold), temperatureK: cold },
    { label: 'D', volumeL: vd, pressureKPa: pressureKPa(vd, cold), temperatureK: cold },
  ];
  const points: CarnotPoint[] = [];
  const segmentLabels: CarnotPoint['segment'][] = ['A→B', 'B→C', 'C→D', 'D→A'];
  for (let segment = 0; segment < 4; segment += 1) {
    for (let index = 0; index < 12; index += 1) {
      const fraction = index / 12;
      let volumeL = va;
      let temperatureK = hot;
      if (segment === 0) {
        volumeL = va * Math.pow(expansion, fraction);
        temperatureK = hot;
      } else if (segment === 1) {
        volumeL = vb * Math.pow(adiabaticExpansion, fraction);
        temperatureK = hot * Math.pow(vb / volumeL, gamma - 1);
      } else if (segment === 2) {
        volumeL = vc * Math.pow(expansion, -fraction);
        temperatureK = cold;
      } else {
        volumeL = vd * Math.pow(adiabaticExpansion, -fraction);
        temperatureK = cold * Math.pow(vd / volumeL, gamma - 1);
      }
      points.push({
        volumeL,
        pressureKPa: pressureKPa(volumeL, temperatureK),
        temperatureK,
        segment: segmentLabels[segment] ?? 'A→B',
      });
    }
  }
  const stateA = states[0];
  if (stateA) points.push({ ...stateA, segment: 'D→A' });
  const heatInputJ = amount * IDEAL_GAS_CONSTANT_J_PER_MOL_K * hot * Math.log(expansion);
  const heatRejectedJ = amount * IDEAL_GAS_CONSTANT_J_PER_MOL_K * cold * Math.log(expansion);
  return {
    parameters: normalized,
    states,
    points,
    efficiency: 1 - cold / hot,
    heatInputJ,
    heatRejectedJ,
    netWorkJ: heatInputJ - heatRejectedJ,
  };
}

function carnotScene(cycle: CarnotCycleCalculation, fraction: number): ScienceScene {
  const projected = cycle.points.map((point): [number, number] => [point.volumeL, point.pressureKPa]);
  const firstVolume = cycle.points[0]?.volumeL ?? 1;
  const firstPressure = cycle.points[0]?.pressureKPa ?? 1;
  const minVolume = Math.min(...cycle.points.map((point) => point.volumeL));
  const maxVolume = Math.max(...cycle.points.map((point) => point.volumeL));
  const minPressure = Math.min(...cycle.points.map((point) => point.pressureKPa));
  const maxPressure = Math.max(...cycle.points.map((point) => point.pressureKPa));
  const project = (point: [number, number]): [number, number] => [
    45 + (point[0] - minVolume) / Math.max(1e-9, maxVolume - minVolume) * 315,
    205 - (point[1] - minPressure) / Math.max(1e-9, maxPressure - minPressure) * 165,
  ];
  const path = projected.map(project);
  const current = cycle.points[Math.min(cycle.points.length - 1, Math.round(fraction * (cycle.points.length - 1)))];
  const pulse = pointAlongPath(path, fraction);
  return {
    ariaLabel: '卡诺循环 P-V 图，包含两段等温过程和两段绝热过程',
    grid: true,
    axes: true,
    paths: [
      { points: [[45, 205], [370, 205]], stroke: '#64748b' },
      { points: [[45, 205], [45, 30]], stroke: '#64748b' },
      { points: partialPath(path, fraction), stroke: '#ef4444', strokeWidth: 3, closed: fraction >= 1 },
    ],
    points: [
      ...cycle.states.map((state) => ({
        ...(() => {
          const point = project([state.volumeL, state.pressureKPa]);
          return { x: point[0], y: point[1] };
        })(),
        radius: 5,
        color: '#0ea5e9',
        label: state.label,
      })),
      { x: pulse[0], y: pulse[1], radius: 6, color: '#f59e0b' },
    ],
    labels: [
      { x: 370, y: 224, text: 'V / L', anchor: 'end' },
      { x: 20, y: 32, text: 'P / kPa' },
      { x: 200, y: 22, text: current ? `${current.segment}，T=${formatNumber(current.temperatureK)} K` : 'P-V 循环', anchor: 'middle' },
      { x: 200, y: 232, text: `V:${formatNumber(firstVolume)} L 起，P:${formatNumber(firstPressure)} kPa 起`, anchor: 'middle', size: 10 },
    ],
  };
}

function carnotMetrics(cycle: CarnotCycleCalculation): ScienceMetric[] {
  return [
    { label: '卡诺效率 η', value: `${formatNumber(cycle.efficiency * 100, 2)}%`, emphasis: true },
    { label: '吸热 Qₕ', value: `${formatNumber(cycle.heatInputJ / 1000)} kJ` },
    { label: '净功 W', value: `${formatNumber(cycle.netWorkJ / 1000)} kJ` },
    { label: '放热 |Qc|', value: `${formatNumber(cycle.heatRejectedJ / 1000)} kJ` },
  ];
}

type CarnotView = 'source' | 'cycle' | 'energy' | 'efficiency';

function runCarnot(view: CarnotView, parameters: NumericParameters, text: string): ScienceResult {
  const cycle = calculateCarnotCycle(parameters);
  const configuration = cycle.parameters;
  const hot = finiteParameter(configuration, 'hotTemperatureK', 600);
  const cold = finiteParameter(configuration, 'coldTemperatureK', 300);
  const referenceCold = finiteParameter(configuration, 'referenceColdTemperatureK', 300);
  const metrics = carnotMetrics(cycle);
  if (view === 'efficiency') {
    const efficiencies = Array.from({ length: 41 }, (_, index) => {
      const scanCold = hot * (0.05 + index * 0.9 / 40);
      return { cold: scanCold, efficiency: 1 - scanCold / hot };
    });
    const path: SciencePath = {
      points: efficiencies.map((entry, index): [number, number] => [40 + index * 320 / 40, 205 - entry.efficiency * 165]),
      stroke: '#ef4444',
      strokeWidth: 3,
    };
    const frames = efficiencies.map((entry, index) => frame(`低温热源扫描 ${index + 1}/41`, {
      ariaLabel: '卡诺效率随低温热源温度变化曲线',
      grid: true,
      axes: true,
      paths: [path],
      points: [{ x: 40 + index * 8, y: 205 - entry.efficiency * 165, radius: 6, color: '#f59e0b' }],
      labels: [
        { x: 200, y: 25, text: 'η = 1 - Tc/Th', anchor: 'middle', size: 17 },
        { x: 360, y: 224, text: 'Tc/Th', anchor: 'end' },
        { x: 200, y: 232, text: `当前 Tc=${formatNumber(cold)} K；扫描 Tc=${formatNumber(entry.cold)} K`, anchor: 'middle' },
      ],
    }, {
      summary: referenceCold < hot
        ? `参考冷源 ${formatNumber(referenceCold)} K 时效率为 ${formatNumber((1 - referenceCold / hot) * 100, 2)}%。`
        : '参考冷源温度必须低于高温热源，未生成参考效率。',
      metrics: [
        ...metrics,
        { label: '参考冷源效率', value: referenceCold < hot ? `${formatNumber((1 - referenceCold / hot) * 100, 2)}%` : '定义域无效' },
      ],
      series: [{ label: '卡诺效率', values: efficiencies.map((item) => item.efficiency) }],
    }));
    return result(configuration, text, frames);
  }
  if (view === 'energy') {
    const rows = cycle.states.map((state) => [
      state.label,
      formatNumber(state.temperatureK),
      formatNumber(state.volumeL),
      formatNumber(state.pressureKPa),
    ]);
    const frames = cycle.states.map((state, index) => frame(`${state.label} 状态与能量收支`, {
      ariaLabel: '卡诺循环高温吸热、低温放热和净功关系',
      rects: [
        { x: 35, y: 30, width: 110, height: 55, fill: '#fecaca', stroke: '#ef4444', label: `高温 ${formatNumber(hot)} K` },
        { x: 35, y: 155, width: 110, height: 55, fill: '#bfdbfe', stroke: '#3b82f6', label: `低温 ${formatNumber(cold)} K` },
        { x: 250, y: 80, width: 110, height: 80, fill: '#fef3c7', stroke: '#f59e0b', label: `状态 ${state.label}` },
      ],
      vectors: [
        { x: 145, y: 58, dx: 100, dy: 45, color: '#ef4444', label: `Qₕ=${formatNumber(cycle.heatInputJ / 1000)} kJ` },
        { x: 250, y: 135, dx: -100, dy: 45, color: '#3b82f6', label: `Qc=${formatNumber(cycle.heatRejectedJ / 1000)} kJ` },
        { x: 305, y: 80, dx: 0, dy: -45, color: '#16a34a', label: `W=${formatNumber(cycle.netWorkJ / 1000)} kJ` },
      ],
      labels: [{ x: 200, y: 228, text: 'W = Qₕ - |Qc| = Qₕ(1 - Tc/Th)', anchor: 'middle', size: 16 }],
    }, {
      summary: '四个状态的压力均由理想气体状态方程计算，热量由等温过程积分得到。',
      columns: ['状态', 'T / K', 'V / L', 'P / kPa'],
      rows,
      highlightRows: [index],
      metrics,
    }));
    return result(configuration, text, frames);
  }
  if (view === 'cycle') {
    const frames = cycle.points.map((point, index) => frame(`${point.segment}：P-V 过程 ${index + 1}/${cycle.points.length}`,
      carnotScene(cycle, index / (cycle.points.length - 1)), {
        summary: 'A→B 等温膨胀，B→C 绝热膨胀，C→D 等温压缩，D→A 绝热压缩。',
        metrics,
        series: [
          { label: '体积 / L', values: cycle.points.map((item) => item.volumeL) },
          { label: '压强 / kPa', values: cycle.points.map((item) => item.pressureKPa) },
        ],
      }));
    return result(configuration, text, frames);
  }
  const frames = cycle.states.map((state, index) => {
    const scene = carnotScene(cycle, index / 4);
    return frame(`卡诺热源与状态 ${state.label}`, {
      ...scene,
      rects: [
        { x: 45, y: 25, width: 310, height: 22, fill: '#fecaca', opacity: 0.65, label: `高温热源 ${formatNumber(hot)} K` },
        { x: 45, y: 198, width: 310, height: 22, fill: '#bfdbfe', opacity: 0.65, label: `低温热源 ${formatNumber(cold)} K` },
      ],
    }, {
      summary: '仅由两个热源温度即可确定理想卡诺效率；循环体积决定具体吸热、放热和净功。',
      metrics,
    });
  });
  return result(configuration, text, frames);
}

export interface PhotoelectricCalculation {
  parameters: NumericParameters;
  photonEnergyEv: number;
  photonFrequencyHz: number;
  thresholdFrequencyHz: number;
  thresholdWavelengthNm: number;
  emitted: boolean;
  maximumKineticEnergyEv: number;
  stoppingVoltageV: number | null;
  photonFluxPerSecond: number;
  saturationCurrentA: number;
  currentA: number;
}

function normalizePhotoelectric(parameters: NumericParameters): NumericParameters {
  return {
    wavelengthNm: finiteParameter(parameters, 'wavelengthNm', 400, 50, 1200),
    workFunctionEv: finiteParameter(parameters, 'workFunctionEv', 2.2, 0.1, 8),
    opticalPowerMw: finiteParameter(parameters, 'opticalPowerMw', 2, 0.001, 1000),
    quantumEfficiencyPercent: finiteParameter(parameters, 'quantumEfficiencyPercent', 20, 0.01, 100),
    appliedVoltageV: finiteParameter(parameters, 'appliedVoltageV', 1, -50, 50),
    comparisonWavelengthNm: finiteParameter(parameters, 'comparisonWavelengthNm', 500, 50, 1200),
  };
}

export function photoelectricCurrentAtVoltage(
  appliedVoltageV: number,
  stoppingVoltageV: number | null,
  saturationCurrentA: number,
): number {
  if (stoppingVoltageV === null || stoppingVoltageV <= 0 || saturationCurrentA <= 0) return 0;
  if (appliedVoltageV <= -stoppingVoltageV) return 0;
  if (appliedVoltageV < 0) return saturationCurrentA * (1 + appliedVoltageV / stoppingVoltageV);
  return saturationCurrentA;
}

export function calculatePhotoelectric(parameters: NumericParameters): PhotoelectricCalculation {
  const normalized = normalizePhotoelectric(parameters);
  const wavelengthNm = finiteParameter(normalized, 'wavelengthNm', 400);
  const workFunctionEv = finiteParameter(normalized, 'workFunctionEv', 2.2);
  const opticalPowerMw = finiteParameter(normalized, 'opticalPowerMw', 2);
  const quantumEfficiencyPercent = finiteParameter(normalized, 'quantumEfficiencyPercent', 20);
  const appliedVoltageV = finiteParameter(normalized, 'appliedVoltageV', 1);
  const photonEnergyEv = HC_EV_NM / wavelengthNm;
  const photonFrequencyHz = SPEED_OF_LIGHT_M_PER_S / (wavelengthNm * 1e-9);
  const thresholdFrequencyHz = workFunctionEv * ELEMENTARY_CHARGE_C / PLANCK_CONSTANT_J_S;
  const thresholdWavelengthNm = HC_EV_NM / workFunctionEv;
  const emitted = photonEnergyEv > workFunctionEv;
  const maximumKineticEnergyEv = emitted ? photonEnergyEv - workFunctionEv : 0;
  const stoppingVoltageV = emitted ? maximumKineticEnergyEv : null;
  const photonEnergyJ = photonEnergyEv * ELEMENTARY_CHARGE_C;
  const photonFluxPerSecond = opticalPowerMw * 1e-3 / photonEnergyJ;
  const saturationCurrentA = emitted
    ? photonFluxPerSecond * ELEMENTARY_CHARGE_C * quantumEfficiencyPercent / 100
    : 0;
  return {
    parameters: normalized,
    photonEnergyEv,
    photonFrequencyHz,
    thresholdFrequencyHz,
    thresholdWavelengthNm,
    emitted,
    maximumKineticEnergyEv,
    stoppingVoltageV,
    photonFluxPerSecond,
    saturationCurrentA,
    currentA: photoelectricCurrentAtVoltage(appliedVoltageV, stoppingVoltageV, saturationCurrentA),
  };
}

function photoelectricMetrics(calculation: PhotoelectricCalculation): ScienceMetric[] {
  return [
    { label: '光子能量 Eγ', value: `${formatNumber(calculation.photonEnergyEv)} eV` },
    { label: '最大初动能', value: calculation.emitted ? `${formatNumber(calculation.maximumKineticEnergyEv)} eV` : '无光电子', emphasis: true },
    { label: '遏止电压 Us', value: calculation.stoppingVoltageV === null ? '低于截止频率' : `${formatNumber(calculation.stoppingVoltageV)} V` },
    { label: '当前光电流', value: `${formatNumber(calculation.currentA * 1e6)} μA` },
  ];
}

function photoelectricSourceScene(calculation: PhotoelectricCalculation, progress: number): ScienceScene {
  const color = wavelengthToRgbHex(finiteParameter(calculation.parameters, 'wavelengthNm', 400));
  const photonPath: [number, number][] = [[30, 55], [180, 120]];
  const electronPath: [number, number][] = [[195, 120], [350, 65]];
  const photon = pointAlongPath(photonPath, clamp(progress * 2, 0, 1));
  const electron = pointAlongPath(electronPath, clamp(progress * 2 - 1, 0, 1));
  return {
    ariaLabel: calculation.emitted ? '光子照射金属并逸出光电子' : '光子能量低于逸出功，没有光电子逸出',
    rects: [
      { x: 175, y: 55, width: 25, height: 130, fill: '#94a3b8', stroke: '#334155', label: '阴极' },
      { x: 345, y: 45, width: 20, height: 150, fill: '#bae6fd', stroke: '#0284c7', label: '阳极' },
    ],
    paths: [
      { points: photonPath, stroke: color, strokeWidth: 3 },
      { points: electronPath, stroke: calculation.emitted ? '#0ea5e9' : '#94a3b8', dashed: !calculation.emitted },
    ],
    points: [
      { x: photon[0], y: photon[1], radius: 6, color, label: '光子' },
      ...(calculation.emitted ? [{ x: electron[0], y: electron[1], radius: 4, color: '#0ea5e9', label: 'e⁻' }] : []),
    ],
    labels: [{
      x: 200,
      y: 222,
      text: calculation.emitted ? 'Eγ > φ：发生光电发射' : 'Eγ ≤ φ：增强光强也不会产生光电子',
      anchor: 'middle',
      color: calculation.emitted ? '#16a34a' : '#dc2626',
    }],
  };
}

type PhotoelectricView = 'source' | 'equation' | 'iu' | 'stopping';

function runPhotoelectric(view: PhotoelectricView, parameters: NumericParameters, text: string): ScienceResult {
  const calculation = calculatePhotoelectric(parameters);
  const configuration = calculation.parameters;
  const appliedVoltage = finiteParameter(configuration, 'appliedVoltageV', 1);
  const metrics = photoelectricMetrics(calculation);
  if (view === 'iu') {
    const stopping = calculation.stoppingVoltageV;
    const minimumVoltage = stopping === null ? -5 : Math.min(-2, -1.25 * stopping);
    const maximumVoltage = Math.max(2, appliedVoltage);
    const samples = Array.from({ length: PROFILE_SAMPLES }, (_, index) => {
      const voltage = minimumVoltage + (maximumVoltage - minimumVoltage) * index / (PROFILE_SAMPLES - 1);
      return { voltage, current: photoelectricCurrentAtVoltage(voltage, stopping, calculation.saturationCurrentA) };
    });
    const maximumCurrent = Math.max(calculation.saturationCurrentA, 1e-15);
    const toPoint = (voltage: number, current: number): [number, number] => [
      35 + (voltage - minimumVoltage) / (maximumVoltage - minimumVoltage) * 330,
      205 - current / maximumCurrent * 160,
    ];
    const path = samples.map((entry) => toPoint(entry.voltage, entry.current));
    const appliedPoint = toPoint(appliedVoltage, calculation.currentA);
    const frames = samples.map((entry, index) => frame(`I-U 扫描 ${index + 1}/${samples.length}`, {
      ariaLabel: calculation.emitted ? '光电效应光电流随外加电压变化曲线' : '低于截止频率时各电压光电流均为零',
      grid: true,
      axes: true,
      paths: [
        { points: [[35, 205], [375, 205]], stroke: '#64748b' },
        { points: partialPath(path, index / (samples.length - 1)), stroke: '#0ea5e9', strokeWidth: 3 },
      ],
      points: [
        { x: path[index]?.[0] ?? 35, y: path[index]?.[1] ?? 205, radius: 5, color: '#f59e0b' },
        { x: appliedPoint[0], y: appliedPoint[1], radius: 6, color: '#ef4444', hollow: true, label: '当前 U' },
      ],
      labels: [
        { x: 365, y: 225, text: 'U / V', anchor: 'end' },
        { x: 20, y: 32, text: 'I' },
        { x: 200, y: 24, text: calculation.emitted ? '理想收集模型：负电压减速，非负电压饱和' : '未发射：I(U)=0', anchor: 'middle' },
      ],
    }, {
      summary: calculation.emitted
        ? `扫描 U=${formatNumber(entry.voltage)} V，I=${formatNumber(entry.current * 1e6)} μA；U≤-Us 时电流严格为零。`
        : '光子能量不超过逸出功，不产生光电子，因此全电压范围光电流为零。',
      metrics,
      series: [{ label: '光电流 / A', values: samples.map((item) => item.current) }],
    }));
    return result(configuration, text, frames);
  }
  if (view === 'stopping') {
    const comparisonParameters: NumericParameters = {
      ...configuration,
      wavelengthNm: finiteParameter(configuration, 'comparisonWavelengthNm', 500),
    };
    const comparison = calculatePhotoelectric(comparisonParameters);
    const currentFrequency = calculation.photonFrequencyHz;
    const maximumFrequency = Math.max(currentFrequency, comparison.photonFrequencyHz, calculation.thresholdFrequencyHz * 1.2) * 1.05;
    const minimumFrequency = calculation.thresholdFrequencyHz * 0.75;
    const points = samplePoints(PROFILE_SAMPLES, (fraction) => {
      const frequency = minimumFrequency + (maximumFrequency - minimumFrequency) * fraction;
      const photonEv = PLANCK_CONSTANT_J_S * frequency / ELEMENTARY_CHARGE_C;
      const workFunction = finiteParameter(configuration, 'workFunctionEv', 2.2);
      const stoppingVoltage = Math.max(0, photonEv - workFunction);
      return [
        40 + fraction * 320,
        205 - stoppingVoltage / Math.max(1, HC_EV_NM / finiteParameter(configuration, 'wavelengthNm', 400)) * 120,
      ];
    });
    const rows = [calculation, comparison].map((item, index) => [
      index === 0 ? '当前波长' : '对照波长',
      formatNumber(finiteParameter(item.parameters, 'wavelengthNm', index === 0 ? 400 : 500)),
      formatNumber(item.photonFrequencyHz / 1e14),
      item.stoppingVoltageV === null ? '不发射' : formatNumber(item.stoppingVoltageV),
    ]);
    const frames = rows.map((row, index) => {
      const selected = index === 0 ? calculation : comparison;
      return frame(index === 0 ? '当前波长的遏止电压' : '对照波长的遏止电压', {
        ariaLabel: '遏止电压与光频率的线性关系及截止频率',
        grid: true,
        axes: true,
        paths: [{ points, stroke: '#8b5cf6', strokeWidth: 3 }],
        vectors: [{ x: 40 + (calculation.thresholdFrequencyHz - minimumFrequency) / (maximumFrequency - minimumFrequency) * 320, y: 205, dx: 0, dy: -170, color: '#ef4444', label: 'ν₀' }],
        labels: [
          { x: 200, y: 25, text: 'eUs = hν - φ', anchor: 'middle', size: 17 },
          { x: 360, y: 226, text: '频率 ν', anchor: 'end' },
          { x: 200, y: 232, text: selected.stoppingVoltageV !== null ? `Us=${formatNumber(selected.stoppingVoltageV)} V` : 'ν≤ν₀，无遏止电压可定义', anchor: 'middle' },
        ],
      }, {
        summary: '遏止电压只由频率和逸出功决定，与光强无关；低于截止频率时明确标记为不发射。',
        columns: ['情形', 'λ / nm', 'ν / 10¹⁴Hz', 'Us / V'],
        rows,
        highlightRows: [index],
        metrics: photoelectricMetrics(selected),
      });
    });
    return result(configuration, text, frames);
  }
  if (view === 'equation') {
    const workFunction = finiteParameter(configuration, 'workFunctionEv', 2.2);
    const energyScale = Math.max(calculation.photonEnergyEv, workFunction, 0.1);
    const frames = Array.from({ length: 21 }, (_, index) => frame(`爱因斯坦光电方程 ${index + 1}/21`, {
      ariaLabel: '光子能量、逸出功与最大初动能的能量守恒关系',
      rects: [
        { x: 55, y: 195 - calculation.photonEnergyEv / energyScale * 145, width: 70, height: calculation.photonEnergyEv / energyScale * 145, fill: '#a78bfa', label: 'Eγ=hν' },
        { x: 165, y: 195 - workFunction / energyScale * 145, width: 70, height: workFunction / energyScale * 145, fill: '#94a3b8', label: 'φ' },
        { x: 275, y: 195 - calculation.maximumKineticEnergyEv / energyScale * 145, width: 70, height: calculation.maximumKineticEnergyEv / energyScale * 145, fill: calculation.emitted ? '#22c55e' : '#e2e8f0', label: 'Kmax' },
      ],
      points: calculation.emitted ? [{ x: 275 + index / 20 * 70, y: 35 + index / 20 * 35, radius: 4, color: '#0ea5e9', label: 'e⁻' }] : [],
      labels: [
        { x: 200, y: 25, text: 'Kmax = hν - φ = eUs', anchor: 'middle', size: 17 },
        { x: 200, y: 224, text: calculation.emitted ? '能量差转化为光电子最大初动能' : 'Eγ≤φ，Kmax 不定义为负值，状态为不发射', anchor: 'middle' },
      ],
    }, {
      summary: `截止频率 ν₀=${formatNumber(calculation.thresholdFrequencyHz / 1e14)}×10¹⁴ Hz，截止波长 λ₀=${formatNumber(calculation.thresholdWavelengthNm)} nm。`,
      columns: ['Eγ / eV', 'φ / eV', 'Kmax / eV', 'ν₀ / Hz', 'λ₀ / nm'],
      rows: [[
        formatNumber(calculation.photonEnergyEv),
        formatNumber(workFunction),
        calculation.emitted ? formatNumber(calculation.maximumKineticEnergyEv) : '不发射',
        formatNumber(calculation.thresholdFrequencyHz),
        formatNumber(calculation.thresholdWavelengthNm),
      ]],
      metrics,
    }));
    return result(configuration, text, frames);
  }
  const frames = Array.from({ length: 31 }, (_, index) => frame(`光子入射与电子逸出 ${index + 1}/31`,
    photoelectricSourceScene(calculation, index / 30), {
      summary: calculation.emitted
        ? `光子通量 ${formatNumber(calculation.photonFluxPerSecond)} s⁻¹，饱和电流由通量和量子效率计算。`
        : '当前频率低于或等于截止频率；仅提高光功率不会伪造光电流。',
      metrics: [
        ...metrics,
        { label: '饱和光电流', value: `${formatNumber(calculation.saturationCurrentA * 1e6)} μA` },
      ],
    }));
  return result(configuration, text, frames);
}

const doubleSlitStages: ScienceStage[] = [
  {
    id: 'source',
    title: '相干光源与狭缝',
    diagram: 'source',
    controls: [
      { key: 'wavelengthNm', label: '波长 λ / nm', value: 550, min: 380, max: 780, step: 1 },
      { key: 'slitSeparationUm', label: '缝间距 d / μm', value: 25, min: 1, max: 500, step: 1 },
      { key: 'slitWidthUm', label: '单缝宽 a / μm', value: 5, min: 0.1, max: 200, step: 0.1 },
      { key: 'slitCount', label: '狭缝数 N', value: 2, min: 2, max: 12, step: 1 },
      { key: 'screenDistanceM', label: '屏距 L / m', value: 1.2, min: 0.05, max: 20, step: 0.05 },
    ],
    presets: [
      { label: '绿色双缝', params: { wavelengthNm: 550, slitCount: 2, slitSeparationUm: 25, slitWidthUm: 5 } },
      { label: '红色五缝光栅', params: { wavelengthNm: 650, slitCount: 5, slitSeparationUm: 40, slitWidthUm: 5 } },
    ],
    run: ({ params, text }) => runDoubleSlit('source', params, text),
  },
  {
    id: 'interference',
    title: '多缝干涉与单缝包络',
    diagram: 'optics',
    inputs: ['source'],
    run: ({ params, text }) => runDoubleSlit('interference', params, text),
  },
  {
    id: 'fringe-analysis',
    title: '条纹位置与间距',
    diagram: 'optics',
    inputs: ['interference'],
    run: ({ params, text }) => runDoubleSlit('fringes', params, text),
  },
  {
    id: 'grating-comparison',
    title: '双缝与光栅锐度对照',
    diagram: 'summary',
    inputs: ['fringe-analysis'],
    run: ({ params, text }) => runDoubleSlit('comparison', params, text),
  },
];

const refractionStages: ScienceStage[] = [
  {
    id: 'source',
    title: '两种介质与入射光',
    diagram: 'source',
    controls: [
      { key: 'n1', label: '入射介质折射率 n₁', value: 1, min: 1, max: 3, step: 0.01 },
      { key: 'n2', label: '透射介质折射率 n₂', value: 1.5, min: 1, max: 3, step: 0.01 },
      { key: 'incidentAngleDegrees', label: '入射角 θ₁ / °', value: 35, min: 0, max: 89, step: 1 },
      { key: 'coreIndex', label: '纤芯折射率', value: 1.5, min: 1.001, max: 3, step: 0.01 },
      { key: 'claddingIndex', label: '包层折射率', value: 1.46, min: 1, max: 2.999, step: 0.01 },
    ],
    presets: [
      { label: '空气射入玻璃', params: { n1: 1, n2: 1.5, incidentAngleDegrees: 35 } },
      { label: '玻璃到空气全反射', params: { n1: 1.5, n2: 1, incidentAngleDegrees: 50 } },
    ],
    run: ({ params, text }) => runRefraction('source', params, text),
  },
  {
    id: 'snell-law',
    title: '斯涅尔定律',
    diagram: 'optics',
    inputs: ['source'],
    run: ({ params, text }) => runRefraction('snell', params, text),
  },
  {
    id: 'critical-angle',
    title: '临界角与全反射扫描',
    diagram: 'optics',
    inputs: ['snell-law'],
    run: ({ params, text }) => runRefraction('critical', params, text),
  },
  {
    id: 'fiber-guidance',
    title: '光纤数值孔径与导光',
    diagram: 'summary',
    inputs: ['critical-angle'],
    run: ({ params, text }) => runRefraction('fiber', params, text),
  },
];

const thinLensStages: ScienceStage[] = [
  {
    id: 'source',
    title: '薄透镜与物体',
    diagram: 'source',
    controls: [
      { key: 'focalLengthMm', label: '焦距 f / mm', value: 100, min: 5, max: 1000, step: 1 },
      { key: 'objectDistanceMm', label: '物距 u / mm', value: 180, min: 5.001, max: 2000, step: 1 },
      { key: 'objectHeightMm', label: '物高 / mm', value: 30, min: 0.1, max: 300, step: 1 },
    ],
    presets: [
      { label: '倒立缩小实像', params: { focalLengthMm: 100, objectDistanceMm: 300, objectHeightMm: 30 } },
      { label: '二倍焦距等大实像', params: { focalLengthMm: 100, objectDistanceMm: 200, objectHeightMm: 30 } },
      { label: '放大镜虚像', params: { focalLengthMm: 100, objectDistanceMm: 50, objectHeightMm: 30 } },
    ],
    run: ({ params, text }) => runThinLens('source', params, text),
  },
  {
    id: 'three-rays',
    title: '三光线确定像点',
    diagram: 'optics',
    inputs: ['source'],
    run: ({ params, text }) => runThinLens('imaging', params, text),
  },
  {
    id: 'lens-equation',
    title: '透镜方程与放大率',
    diagram: 'optics',
    inputs: ['three-rays'],
    run: ({ params, text }) => runThinLens('equation', params, text),
  },
  {
    id: 'image-comparison',
    title: '实像、虚像与特殊位置',
    diagram: 'summary',
    inputs: ['lens-equation'],
    run: ({ params, text }) => runThinLens('comparison', params, text),
  },
];

const carnotStages: ScienceStage[] = [
  {
    id: 'source',
    title: '高低温热源与工作物质',
    diagram: 'source',
    controls: [
      { key: 'hotTemperatureK', label: '高温热源 Th / K', value: 600, min: 2, max: 3000, step: 1 },
      { key: 'coldTemperatureK', label: '低温热源 Tc / K', value: 300, min: 1, max: 2999, step: 1 },
      { key: 'initialVolumeL', label: 'A 点体积 / L', value: 10, min: 0.1, max: 1000, step: 0.1 },
      { key: 'isothermalExpansionRatio', label: '等温膨胀比 VB/VA', value: 2, min: 1.01, max: 20, step: 0.01 },
      { key: 'amountMol', label: '物质的量 / mol', value: 1, min: 0.001, max: 100, step: 0.1 },
    ],
    presets: [
      { label: '600 K / 300 K 卡诺机', params: { hotTemperatureK: 600, coldTemperatureK: 300, initialVolumeL: 10, isothermalExpansionRatio: 2 } },
      { label: '500 K / 250 K 小循环', params: { hotTemperatureK: 500, coldTemperatureK: 250, initialVolumeL: 5, isothermalExpansionRatio: 1.5 } },
    ],
    run: ({ params, text }) => runCarnot('source', params, text),
  },
  {
    id: 'pv-cycle',
    title: '两段等温与两段绝热',
    diagram: 'thermal',
    inputs: ['source'],
    run: ({ params, text }) => runCarnot('cycle', params, text),
  },
  {
    id: 'heat-work',
    title: '热量、净功与状态表',
    diagram: 'energy',
    inputs: ['pv-cycle'],
    run: ({ params, text }) => runCarnot('energy', params, text),
  },
  {
    id: 'efficiency-comparison',
    title: '卡诺效率温度对照',
    diagram: 'summary',
    inputs: ['heat-work'],
    controls: [
      { key: 'referenceColdTemperatureK', label: '参考冷源温度 / K', value: 300, min: 1, max: 2999, step: 1 },
    ],
    run: ({ params, text }) => runCarnot('efficiency', params, text),
  },
];

const photoelectricStages: ScienceStage[] = [
  {
    id: 'source',
    title: '光子、金属与光功率',
    diagram: 'source',
    controls: [
      { key: 'wavelengthNm', label: '入射波长 / nm', value: 400, min: 50, max: 1200, step: 1 },
      { key: 'workFunctionEv', label: '逸出功 φ / eV', value: 2.2, min: 0.1, max: 8, step: 0.05 },
      { key: 'opticalPowerMw', label: '光功率 / mW', value: 2, min: 0.001, max: 1000, step: 0.1 },
      { key: 'quantumEfficiencyPercent', label: '量子效率 / %', value: 20, min: 0.01, max: 100, step: 1 },
      { key: 'appliedVoltageV', label: '外加电压 U / V', value: 1, min: -50, max: 50, step: 0.1 },
    ],
    presets: [
      { label: '紫光照射金属钠', params: { wavelengthNm: 400, workFunctionEv: 2.28, opticalPowerMw: 2, appliedVoltageV: 1 } },
      { label: '低于截止频率', params: { wavelengthNm: 700, workFunctionEv: 2.28, opticalPowerMw: 20, appliedVoltageV: 5 } },
      { label: '遏止电压附近', params: { wavelengthNm: 350, workFunctionEv: 2.28, appliedVoltageV: -1.2 } },
    ],
    run: ({ params, text }) => runPhotoelectric('source', params, text),
  },
  {
    id: 'einstein-equation',
    title: '爱因斯坦光电方程',
    diagram: 'quantum',
    inputs: ['source'],
    run: ({ params, text }) => runPhotoelectric('equation', params, text),
  },
  {
    id: 'iu-characteristic',
    title: 'I-U 曲线与饱和电流',
    diagram: 'circuit',
    inputs: ['einstein-equation'],
    run: ({ params, text }) => runPhotoelectric('iu', params, text),
  },
  {
    id: 'stopping-voltage',
    title: '遏止电压与截止频率',
    diagram: 'summary',
    inputs: ['iu-characteristic'],
    controls: [
      { key: 'comparisonWavelengthNm', label: '对照波长 / nm', value: 500, min: 50, max: 1200, step: 1 },
    ],
    run: ({ params, text }) => runPhotoelectric('stopping', params, text),
  },
];

export const physicsOpticsPipelines: SciencePipelineMap = {
  'double-slit': { stages: doubleSlitStages },
  'refraction-fiber': { stages: refractionStages },
  'thin-lens': { stages: thinLensStages },
  'carnot-cycle': { stages: carnotStages },
  photoelectric: { stages: photoelectricStages },
};