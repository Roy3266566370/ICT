import { compileExpression } from '../labs/expr.ts';
import {
  antiderivativeSamples,
  approachLimit,
  compileFunction,
  derivativeAt,
  epsilonDeltaBand,
  finiteAt,
  fourierPartialSum,
  fourierSamples,
  fourierSpectrum,
  integrate,
  integrateOdeRK4,
  slopeFieldGrid,
  taylorPolynomial,
  type RealFunction,
  type Waveform,
} from './calculus.ts';
import type { CalculusPipelineStage } from './calculusPipelineTypes.ts';
import type { PipelineControl } from './lab408PipelineTypes.ts';
import type {
  ScienceData,
  ScienceFrame,
  ScienceMetric,
  SciencePath,
  SciencePipelineMap,
  SciencePoint,
  SciencePreset,
  ScienceResult,
  ScienceScene,
  ScienceVector,
} from './sciencePipelineTypes.ts';

const FRAME_COUNT = 61;
const BLUE = '#4f7cff';
const CYAN = '#24b8c7';
const ORANGE = '#f59e5b';
const RED = '#ef6461';
const GREEN = '#4db6ac';
const PURPLE = '#9b7ede';
const GRAY = '#8391a7';

interface PlotPoint {
  x: number;
  y: number | null;
}

interface PlotSeries {
  points: PlotPoint[];
  stroke: string;
  label: string;
  dashed?: boolean;
}

interface PlotMarker {
  x: number;
  y: number;
  color?: string;
  label?: string;
  hollow?: boolean;
}

function control(
  key: string,
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  options?: { value: number; label: string }[],
): PipelineControl {
  return { key, label, value, min, max, step, ...(options ? { options } : {}) };
}

const coefficientControls = [
  control('a', '系数 a', 1, -5, 5, 0.1),
  control('b', '系数 b', 0, -5, 5, 0.1),
  control('c', '系数 c', 0, -5, 5, 0.1),
];

function effectiveParams(params: Record<string, number>, defaults: Record<string, number>): Record<string, number> {
  const result = { ...defaults };
  for (const [key, value] of Object.entries(params)) {
    if (Number.isFinite(value)) result[key] = value;
  }
  return result;
}

function compileRealFunction(text: string, params: Record<string, number>): RealFunction {
  try {
    return compileFunction({
      kind: 'function',
      expression: text,
      a: params.a ?? 1,
      b: params.b ?? 0,
      c: params.c ?? 0,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`函数表达式无效：${reason}`);
  }
}

function formatNumber(value: number | null | undefined, digits = 6): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  return Number(value.toPrecision(digits)).toString();
}

function metric(label: string, value: string, emphasis = false): ScienceMetric {
  return { label, value, ...(emphasis ? { emphasis } : {}) };
}

function makeFrames(build: (index: number) => ScienceFrame): ScienceFrame[] {
  return Array.from({ length: FRAME_COUNT }, (_, index) => build(index));
}

function makeResult(
  text: string,
  parameters: Record<string, number>,
  frames: ScienceFrame[],
  extra: Record<string, unknown> = {},
): ScienceResult {
  const data: ScienceData = { parameters: { ...parameters }, text, ...extra };
  return { data, frames };
}

function sampleFunction(f: RealFunction, lower: number, upper: number, count = 161): PlotPoint[] {
  return Array.from({ length: count }, (_, index) => {
    const x = lower + ((upper - lower) * index) / (count - 1);
    const value = f(x);
    return { x, y: value !== null && Number.isFinite(value) ? value : null };
  });
}

function plotScene(
  ariaLabel: string,
  plotSeries: PlotSeries[],
  markers: PlotMarker[] = [],
  xDomain?: readonly [number, number],
): ScienceScene {
  const allX = plotSeries.flatMap((item) => item.points.map((point) => point.x)).filter(Number.isFinite);
  const allY = plotSeries.flatMap((item) => item.points.map((point) => point.y))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const fallbackX = xDomain ?? [0, 1];
  let xMin = xDomain?.[0] ?? (allX.length > 0 ? Math.min(...allX) : fallbackX[0]);
  let xMax = xDomain?.[1] ?? (allX.length > 0 ? Math.max(...allX) : fallbackX[1]);
  if (xMax === xMin) {
    xMin -= 1;
    xMax += 1;
  }
  let yMin = allY.length > 0 ? Math.min(...allY) : -1;
  let yMax = allY.length > 0 ? Math.max(...allY) : 1;
  const yPadding = yMax === yMin ? Math.max(1, Math.abs(yMin) * 0.1) : (yMax - yMin) * 0.1;
  yMin -= yPadding;
  yMax += yPadding;
  const project = (x: number, y: number): [number, number] => [
    35 + ((x - xMin) / (xMax - xMin)) * 345,
    205 - ((y - yMin) / (yMax - yMin)) * 170,
  ];
  const paths: SciencePath[] = [];
  for (const item of plotSeries) {
    let current: [number, number][] = [];
    const flush = () => {
      if (current.length > 1) {
        paths.push({
          points: current,
          stroke: item.stroke,
          strokeWidth: 2,
          label: item.label,
          ...(item.dashed ? { dashed: true } : {}),
        });
      }
      current = [];
    };
    for (const point of item.points) {
      if (point.y === null || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        flush();
      } else {
        current.push(project(point.x, point.y));
      }
    }
    flush();
  }
  const points: SciencePoint[] = markers
    .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y))
    .map((item) => {
      const [x, y] = project(item.x, item.y);
      return {
        x,
        y,
        radius: 4,
        color: item.color ?? RED,
        ...(item.label ? { label: item.label } : {}),
        ...(item.hollow ? { hollow: true } : {}),
      };
    });
  return {
    ariaLabel,
    grid: true,
    axes: true,
    paths,
    points,
    labels: plotSeries.map((item, index) => ({
      x: 42 + index * 112,
      y: 18,
      text: item.label,
      color: item.stroke,
      size: 11,
    })),
  };
}

function sampledLine(
  lower: number,
  upper: number,
  value: (x: number) => number,
  stroke: string,
  label: string,
  dashed = false,
): PlotSeries {
  return {
    points: Array.from({ length: 81 }, (_, index) => {
      const x = lower + ((upper - lower) * index) / 80;
      return { x, y: value(x) };
    }),
    stroke,
    label,
    ...(dashed ? { dashed } : {}),
  };
}

interface FunctionSourceOptions {
  expression: string;
  defaults: Record<string, number>;
  controls: PipelineControl[];
  presets: SciencePreset[];
  domain: (params: Record<string, number>) => readonly [number, number];
  probe: (params: Record<string, number>) => number;
}

function functionSourceStage(options: FunctionSourceOptions): CalculusPipelineStage {
  return {
    id: 'function-source',
    title: '函数源与扫描',
    diagram: 'source',
    text: options.expression,
    textLabel: 'f(x) 表达式（可用 x、a、b、c）',
    controls: [...coefficientControls, ...options.controls],
    presets: options.presets,
    run: ({ text, params }) => {
      const values = effectiveParams(params, options.defaults);
      const f = compileRealFunction(text, values);
      const [lower, upper] = options.domain(values);
      if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower === upper) {
        throw new Error('函数扫描区间必须为不同的有限端点');
      }
      const samples = sampleFunction(f, lower, upper);
      const probe = options.probe(values);
      const frames = makeFrames((index) => {
        const x = lower + ((upper - lower) * index) / (FRAME_COUNT - 1);
        const y = f(x);
        const finiteY = y !== null && Number.isFinite(y) ? y : null;
        return {
          title: '函数源与定义域扫描',
          summary: finiteY === null ? '当前扫描点无有限实数值，请检查定义域' : `f(${formatNumber(x)}) = ${formatNumber(finiteY)}`,
          scene: plotScene('函数图像与当前扫描点', [{ points: samples, stroke: BLUE, label: 'f(x)' }],
            finiteY === null ? [] : [{ x, y: finiteY, color: RED, label: '扫描点' }], [lower, upper]),
          metrics: [
            metric('扫描 x', formatNumber(x)),
            metric('f(x)', formatNumber(finiteY), true),
            metric('观察点', formatNumber(probe)),
          ],
          columns: ['x', 'f(x)'],
          rows: [[x, finiteY ?? '无定义']],
        };
      });
      return makeResult(text, values, frames, { expression: text, domain: [lower, upper] });
    },
  };
}

function safeDerivative(f: RealFunction, x: number): number | null {
  try {
    const value = derivativeAt(f, x);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function secondDerivativeAt(f: RealFunction, x: number): number {
  finiteAt(f, x);
  if (!f.series) throw new Error('请使用函数源进行二阶自动微分');
  const value = 2 * f.series(x, 2)[2]!;
  if (!Number.isFinite(value)) throw new Error(`x=${formatNumber(x)} 处二阶导数无有限值`);
  return value;
}

function derivativeSamples(f: RealFunction, lower: number, upper: number, order: 1 | 2): PlotPoint[] {
  return Array.from({ length: 161 }, (_, index) => {
    const x = lower + ((upper - lower) * index) / 160;
    if (order === 1) return { x, y: safeDerivative(f, x) };
    try {
      return { x, y: secondDerivativeAt(f, x) };
    } catch {
      return { x, y: null };
    }
  });
}

function findRoots(g: (x: number) => number | null, lower: number, upper: number, samples = 320): number[] {
  const roots: number[] = [];
  const addRoot = (root: number) => {
    if (Number.isFinite(root) && !roots.some((item) => Math.abs(item - root) < 1e-5)) roots.push(root);
  };
  let previousX = lower;
  let previousY = g(previousX);
  for (let index = 1; index <= samples; index += 1) {
    const x = lower + ((upper - lower) * index) / samples;
    const y = g(x);
    if (y !== null && Math.abs(y) < 1e-8) addRoot(x);
    if (previousY !== null && y !== null && previousY * y < 0) {
      let left = previousX;
      let right = x;
      let leftY = previousY;
      for (let iteration = 0; iteration < 48; iteration += 1) {
        const middle = (left + right) / 2;
        const middleY = g(middle);
        if (middleY === null) break;
        if (Math.abs(middleY) < 1e-11) {
          left = middle;
          right = middle;
          break;
        }
        if (leftY * middleY <= 0) {
          right = middle;
        } else {
          left = middle;
          leftY = middleY;
        }
      }
      addRoot((left + right) / 2);
    }
    previousX = x;
    previousY = y;
  }
  return roots.sort((a, b) => a - b);
}

const limitDefaults = { a: 1, b: 0, c: 0, x0: 0, epsilon: 0.2 };
const limitDomain = (params: Record<string, number>) => [params.x0! - 1, params.x0! + 1] as const;

const limitEpsilonStages: CalculusPipelineStage[] = [
  functionSourceStage({
    expression: 'sin(x)/x',
    defaults: limitDefaults,
    controls: [control('x0', '趋近点 x₀', 0, -3, 3, 0.1), control('epsilon', 'ε', 0.2, 0.01, 2, 0.01)],
    presets: [
      { label: 'sin(x)/x 在 0', params: { x0: 0, epsilon: 0.2 }, text: 'sin(x)/x' },
      { label: '可去间断', params: { x0: 1, epsilon: 0.1 }, text: '(x^2-1)/(x-1)' },
      { label: '无穷间断', params: { x0: 0, epsilon: 0.2 }, text: '1/x' },
    ],
    domain: limitDomain,
    probe: (params) => params.x0!,
  }),
  {
    id: 'two-sided-limit',
    title: '左右趋近样本',
    diagram: 'limit',
    inputs: ['function-source'],
    run: ({ text, params }) => {
      const values = effectiveParams(params, limitDefaults);
      const f = compileRealFunction(text, values);
      const x0 = values.x0!;
      const [lower, upper] = limitDomain(values);
      const curve = sampleFunction(f, lower, upper);
      const observation = approachLimit(f, x0);
      const frames = makeFrames((index) => {
        const h = 10 ** (-0.25 - (5.75 * index) / (FRAME_COUNT - 1));
        const left = f(x0 - h);
        const right = f(x0 + h);
        const markers: PlotMarker[] = [];
        if (left !== null && Number.isFinite(left)) markers.push({ x: x0 - h, y: left, color: CYAN, label: '左样本' });
        if (right !== null && Number.isFinite(right)) markers.push({ x: x0 + h, y: right, color: ORANGE, label: '右样本' });
        return {
          title: '左右趋近：h 逐帧收缩',
          summary: observation.message,
          scene: plotScene('左右趋近样本与函数图像', [{ points: curve, stroke: BLUE, label: 'f(x)' }], markers, [lower, upper]),
          metrics: [
            metric('h', formatNumber(h)),
            metric('f(x₀−h)', formatNumber(left)),
            metric('f(x₀+h)', formatNumber(right)),
            metric('双侧候选 L', formatNumber(observation.candidate), true),
          ],
          columns: ['h', '左侧 f(x₀−h)', '右侧 f(x₀+h)'],
          rows: observation.rows.map((row) => [row.h, row.left ?? '无定义', row.right ?? '无定义']),
        };
      });
      return makeResult(text, values, frames, { limitCandidate: observation.candidate, approachRows: observation.rows });
    },
  },
  {
    id: 'epsilon-band',
    title: 'ε–δ 邻域带',
    diagram: 'limit',
    inputs: ['two-sided-limit'],
    run: ({ text, params }) => {
      const values = effectiveParams(params, limitDefaults);
      const f = compileRealFunction(text, values);
      const x0 = values.x0!;
      const epsilon = values.epsilon!;
      const [lower, upper] = limitDomain(values);
      const band = epsilonDeltaBand(f, x0, epsilon, [lower, upper]);
      const curve = sampleFunction(f, lower, upper);
      const frames = makeFrames((index) => {
        const h = band.delta === null ? 10 ** (-index / 10) : band.delta * (1 - 0.8 * index / (FRAME_COUNT - 1));
        const lines: PlotSeries[] = [{ points: curve, stroke: BLUE, label: 'f(x)' }];
        if (band.level !== null) {
          lines.push(sampledLine(lower, upper, () => band.level! + epsilon, ORANGE, 'L+ε', true));
          lines.push(sampledLine(lower, upper, () => band.level! - epsilon, ORANGE, 'L−ε', true));
        }
        const markers: PlotMarker[] = [];
        if (band.level !== null) markers.push({ x: x0, y: band.level, color: PURPLE, label: 'L', hollow: true });
        return {
          title: 'ε 管道与候选 δ',
          summary: band.message,
          scene: plotScene('ε–δ 邻域带数值检验', lines, markers, [lower, upper]),
          metrics: [
            metric('ε', formatNumber(epsilon)),
            metric('L', formatNumber(band.level)),
            metric('候选 δ', formatNumber(band.delta), true),
            metric('当前观察半径', formatNumber(h)),
          ],
          columns: ['x', 'f(x)', '是否落入 L±ε'],
          rows: band.samples.filter((_, rowIndex) => rowIndex % 10 === 0)
            .map((row) => [row.x, row.value ?? '无定义', row.inside ? '是' : '否']),
        };
      });
      return makeResult(text, values, frames, { epsilonDelta: band });
    },
  },
  {
    id: 'continuity-check',
    title: '连续与间断类型',
    diagram: 'summary',
    inputs: ['epsilon-band'],
    run: ({ text, params }) => {
      const values = effectiveParams(params, limitDefaults);
      const f = compileRealFunction(text, values);
      const x0 = values.x0!;
      const leftResult = approachLimit(f, x0, -1);
      const rightResult = approachLimit(f, x0, 1);
      const atPoint = f(x0);
      const tolerance = 0.003 * Math.max(1, Math.abs(leftResult.candidate ?? 0), Math.abs(rightResult.candidate ?? 0));
      let classification = '双侧极限候选不稳定：可能发散、振荡或存在定义域断点';
      if (leftResult.candidate !== null && rightResult.candidate !== null) {
        if (Math.abs(leftResult.candidate - rightResult.candidate) > tolerance) {
          classification = '左右候选不同：跳跃间断的数值证据';
        } else if (atPoint === null || !Number.isFinite(atPoint)) {
          classification = '左右候选相同但 f(x₀) 无定义：可去间断的数值证据';
        } else if (Math.abs(atPoint - leftResult.candidate) > tolerance) {
          classification = '函数值偏离双侧候选：可去间断的数值证据';
        } else {
          classification = '函数值与双侧候选一致：连续性的数值证据（非解析证明）';
        }
      }
      const [lower, upper] = limitDomain(values);
      const curve = sampleFunction(f, lower, upper);
      const frames = makeFrames((index) => {
        const h = 10 ** (-1 - (5 * index) / (FRAME_COUNT - 1));
        return {
          title: '连续性数值判别',
          summary: classification,
          scene: plotScene('连续性与间断类型观察', [{ points: curve, stroke: BLUE, label: 'f(x)' }],
            atPoint !== null && Number.isFinite(atPoint) ? [{ x: x0, y: atPoint, color: RED, label: 'f(x₀)' }] : [], [lower, upper]),
          metrics: [
            metric('左极限候选', formatNumber(leftResult.candidate)),
            metric('右极限候选', formatNumber(rightResult.candidate)),
            metric('f(x₀)', formatNumber(atPoint)),
            metric('当前 h', formatNumber(h)),
          ],
          columns: ['判据', '数值结果'],
          rows: [
            ['左趋近信息', leftResult.message],
            ['右趋近信息', rightResult.message],
            ['类型提示', classification],
          ],
        };
      });
      return makeResult(text, values, frames, { classification });
    },
  },
];

const derivativeDefaults = { a: 1, b: 0, c: 0, x0: 0.5, h: 0.5, lower: -2, upper: 2 };
const derivativeDomain = (params: Record<string, number>) =>
  [Math.min(params.lower!, params.upper!), Math.max(params.lower!, params.upper!)] as const;

function derivativeSecantFrames(text: string, values: Record<string, number>, includeDerivative: boolean): ScienceResult {
  const f = compileRealFunction(text, values);
  const [lower, upper] = derivativeDomain(values);
  const x0 = values.x0!;
  const curve = sampleFunction(f, lower, upper);
  const exact = derivativeAt(f, x0);
  const frames = makeFrames((index) => {
    const h = 10 ** (Math.log10(values.h!) - (2.5 * index) / (FRAME_COUNT - 1));
    const x1 = x0 + h;
    const y0 = finiteAt(f, x0);
    const y1 = finiteAt(f, x1);
    const slope = (y1 - y0) / h;
    const secant = (x: number) => y0 + slope * (x - x0);
    const tangent = (x: number) => y0 + exact * (x - x0);
    const lines: PlotSeries[] = [
      { points: curve, stroke: BLUE, label: 'f(x)' },
      sampledLine(lower, upper, secant, ORANGE, '割线', true),
    ];
    if (includeDerivative) lines.push(sampledLine(lower, upper, tangent, GREEN, '切线', true));
    return {
      title: includeDerivative ? '割线向切线收缩' : '割线斜率',
      summary: `h=${formatNumber(h)}，割线斜率与自动微分结果并列显示`,
      scene: plotScene('割线步长与切线构造', lines, [
        { x: x0, y: y0, color: RED, label: 'x₀' },
        { x: x1, y: y1, color: CYAN, label: 'x₀+h' },
      ], [lower, upper]),
      metrics: [
        metric('h', formatNumber(h)),
        metric('割线斜率', formatNumber(slope), true),
        metric("f'(x₀)", formatNumber(exact)),
        metric('斜率差', formatNumber(Math.abs(slope - exact))),
      ],
      columns: ['h', 'f(x₀)', 'f(x₀+h)', '割线斜率', "f'(x₀)"],
      rows: [[h, y0, y1, slope, exact]],
    };
  });
  return makeResult(text, values, frames, { derivativeAtX0: exact });
}

const derivativeTriptychStages: CalculusPipelineStage[] = [
  functionSourceStage({
    expression: 'x^3-3*x',
    defaults: derivativeDefaults,
    controls: [
      control('x0', '切点 x₀', 0.5, -2, 2, 0.05),
      control('h', '初始割线步长 h', 0.5, 0.01, 1, 0.01),
      control('lower', '区间左端', -2, -5, 0, 0.1),
      control('upper', '区间右端', 2, 0, 5, 0.1),
    ],
    presets: [
      { label: '三次函数', params: { x0: 0.5, h: 0.5, lower: -2, upper: 2 }, text: 'x^3-3*x' },
      { label: '抛物线', params: { x0: 0, h: 0.5, lower: -2, upper: 2 }, text: 'a*x^2+b*x+c' },
      { label: '绝对值不可导点', params: { x0: 0, h: 0.5, lower: -2, upper: 2 }, text: 'abs(x)' },
    ],
    domain: derivativeDomain,
    probe: (params) => params.x0!,
  }),
  {
    id: 'secant-slope',
    title: '割线构造',
    diagram: 'derivative',
    inputs: ['function-source'],
    run: ({ text, params }) => derivativeSecantFrames(text, effectiveParams(params, derivativeDefaults), false),
  },
  {
    id: 'first-derivative',
    title: '一阶导数与切线',
    diagram: 'derivative',
    inputs: ['secant-slope'],
    run: ({ text, params }) => derivativeSecantFrames(text, effectiveParams(params, derivativeDefaults), true),
  },
  {
    id: 'second-derivative',
    title: '二阶导数三联图',
    diagram: 'derivative',
    inputs: ['first-derivative'],
    run: ({ text, params }) => {
      const values = effectiveParams(params, derivativeDefaults);
      const f = compileRealFunction(text, values);
      const [lower, upper] = derivativeDomain(values);
      const x0 = values.x0!;
      const fSamples = sampleFunction(f, lower, upper);
      const firstSamples = derivativeSamples(f, lower, upper, 1);
      const secondSamples = derivativeSamples(f, lower, upper, 2);
      const firstAt = derivativeAt(f, x0);
      const secondAt = secondDerivativeAt(f, x0);
      const frames = makeFrames((index) => {
        const h = 10 ** (-0.25 - (2.5 * index) / (FRAME_COUNT - 1));
        const difference = (finiteAt(f, x0 + h) - finiteAt(f, x0 - h)) / (2 * h);
        const markers: PlotMarker[] = [
          { x: x0, y: finiteAt(f, x0), color: BLUE, label: 'f' },
          { x: x0, y: firstAt, color: ORANGE, label: "f′" },
          { x: x0, y: secondAt, color: GREEN, label: "f″" },
        ];
        return {
          title: '共享 x 轴的 f、f′、f″ 三联构造',
          summary: '三条曲线使用相同横坐标；中心差分仅作自动微分的数值对照',
          scene: plotScene('函数与一二阶导数三联图', [
            { points: fSamples, stroke: BLUE, label: 'f' },
            { points: firstSamples, stroke: ORANGE, label: 'f′' },
            { points: secondSamples, stroke: GREEN, label: 'f″' },
          ], markers, [lower, upper]),
          metrics: [
            metric('h', formatNumber(h)),
            metric('中心差分', formatNumber(difference)),
            metric("f′(x₀)", formatNumber(firstAt), true),
            metric("f″(x₀)", formatNumber(secondAt)),
          ],
          columns: ['x₀', 'f(x₀)', "f′(x₀)", "f″(x₀)"],
          rows: [[x0, finiteAt(f, x0), firstAt, secondAt]],
        };
      });
      return makeResult(text, values, frames, { firstAt, secondAt });
    },
  },
  {
    id: 'critical-points',
    title: '驻点、极值与拐点',
    diagram: 'summary',
    inputs: ['second-derivative'],
    run: ({ text, params }) => {
      const values = effectiveParams(params, derivativeDefaults);
      const f = compileRealFunction(text, values);
      const [lower, upper] = derivativeDomain(values);
      const stationary = findRoots((x) => safeDerivative(f, x), lower, upper);
      const inflection = findRoots((x) => {
        try {
          return secondDerivativeAt(f, x);
        } catch {
          return null;
        }
      }, lower, upper);
      const criticalRows = stationary.map((x) => {
        const second = secondDerivativeAt(f, x);
        const type = second > 1e-7 ? '极小值候选' : second < -1e-7 ? '极大值候选' : '二阶导数为零，需进一步判别';
        return { x, value: finiteAt(f, x), second, type };
      });
      const fSamples = sampleFunction(f, lower, upper);
      const firstSamples = derivativeSamples(f, lower, upper, 1);
      const secondSamples = derivativeSamples(f, lower, upper, 2);
      const frames = makeFrames((index) => {
        const activeIndex = criticalRows.length === 0 ? -1 : Math.min(criticalRows.length - 1,
          Math.floor((index / FRAME_COUNT) * criticalRows.length));
        const active = activeIndex >= 0 ? criticalRows[activeIndex]! : null;
        const markers: PlotMarker[] = criticalRows.map((row, rowIndex) => ({
          x: row.x,
          y: row.value,
          color: rowIndex === activeIndex ? RED : PURPLE,
          label: row.type,
        }));
        return {
          title: '临界点与拐点扫描',
          summary: criticalRows.length === 0 ? '未找到有限驻点；请检查定义域或可微性' : '极值分类来自自动微分，拐点需结合二阶导数符号变化理解',
          scene: plotScene('驻点极值点与拐点标记', [
            { points: fSamples, stroke: BLUE, label: 'f' },
            { points: firstSamples, stroke: ORANGE, label: 'f′' },
            { points: secondSamples, stroke: GREEN, label: 'f″' },
          ], markers, [lower, upper]),
          metrics: [
            metric('驻点数', String(criticalRows.length)),
            metric('拐点候选数', String(inflection.length)),
            metric('当前切点', formatNumber(active?.x)),
            metric('当前类型', active?.type ?? '—', true),
          ],
          columns: ['类型', 'x', 'f(x)', "f″(x)"],
          rows: [
            ...criticalRows.map((row) => [row.type, row.x, row.value, row.second] as (string | number)[]),
            ...inflection.map((x) => ['拐点候选', x, finiteAt(f, x), secondDerivativeAt(f, x)] as (string | number)[]),
          ],
        };
      });
      return makeResult(text, values, frames, { criticalPoints: criticalRows, inflectionPoints: inflection });
    },
  },
];

const meanValueDefaults = { a: 1, b: 0, c: 0, lower: -1, upper: 2 };
const meanValueDomain = (params: Record<string, number>) =>
  [Math.min(params.lower!, params.upper!), Math.max(params.lower!, params.upper!)] as const;

function meanValueData(text: string, values: Record<string, number>) {
  const f = compileRealFunction(text, values);
  const lower = values.lower!;
  const upper = values.upper!;
  if (lower === upper) throw new Error('中值定理区间端点必须不同');
  const lowerValue = finiteAt(f, lower);
  const upperValue = finiteAt(f, upper);
  const secantSlope = (upperValue - lowerValue) / (upper - lower);
  const points = findRoots((x) => {
    const derivative = safeDerivative(f, x);
    return derivative === null ? null : derivative - secantSlope;
  }, Math.min(lower, upper), Math.max(lower, upper));
  return { f, lower, upper, lowerValue, upperValue, secantSlope, points };
}

const meanValueStages: CalculusPipelineStage[] = [
  functionSourceStage({
    expression: 'x^2',
    defaults: meanValueDefaults,
    controls: [control('lower', '区间 a', -1, -4, 4, 0.1), control('upper', '区间 b', 2, -4, 4, 0.1)],
    presets: [
      { label: '抛物线割线', params: { lower: -1, upper: 2 }, text: 'x^2' },
      { label: '三次函数', params: { lower: -2, upper: 2 }, text: 'x^3-3*x' },
      { label: '对称绝对值（无切点）', params: { lower: -1, upper: 1 }, text: 'abs(x)' },
    ],
    domain: meanValueDomain,
    probe: (params) => (params.lower! + params.upper!) / 2,
  }),
  {
    id: 'secant-line',
    title: '端点与割线',
    diagram: 'function',
    inputs: ['function-source'],
    run: ({ text, params }) => {
      const values = effectiveParams(params, meanValueDefaults);
      const data = meanValueData(text, values);
      const domain = meanValueDomain(values);
      const curve = sampleFunction(data.f, domain[0], domain[1]);
      const secant = (x: number) => data.lowerValue + data.secantSlope * (x - data.lower);
      const frames = makeFrames((index) => {
        const x = data.lower + ((data.upper - data.lower) * index) / (FRAME_COUNT - 1);
        return {
          title: '拉格朗日中值定理：端点割线',
          summary: '割线斜率由两个端点的真实函数值计算',
          scene: plotScene('区间端点与割线', [
            { points: curve, stroke: BLUE, label: 'f(x)' },
            sampledLine(domain[0], domain[1], secant, ORANGE, '割线', true),
          ], [
            { x: data.lower, y: data.lowerValue, color: RED, label: 'a' },
            { x: data.upper, y: data.upperValue, color: RED, label: 'b' },
            { x, y: finiteAt(data.f, x), color: CYAN, label: '扫描点' },
          ], domain),
          metrics: [
            metric('f(b)−f(a)', formatNumber(data.upperValue - data.lowerValue)),
            metric('b−a', formatNumber(data.upper - data.lower)),
            metric('割线斜率', formatNumber(data.secantSlope), true),
          ],
          columns: ['a', 'b', 'f(a)', 'f(b)', '割线斜率'],
          rows: [[data.lower, data.upper, data.lowerValue, data.upperValue, data.secantSlope]],
        };
      });
      return makeResult(text, values, frames, { secantSlope: data.secantSlope });
    },
  },
  {
    id: 'tangent-search',
    title: '中值切点搜索',
    diagram: 'derivative',
    inputs: ['secant-line'],
    run: ({ text, params }) => {
      const values = effectiveParams(params, meanValueDefaults);
      const data = meanValueData(text, values);
      const domain = meanValueDomain(values);
      const curve = sampleFunction(data.f, domain[0], domain[1]);
      const secant = (x: number) => data.lowerValue + data.secantSlope * (x - data.lower);
      const rows = data.points.map((x) => ({
        x,
        value: finiteAt(data.f, x),
        slope: derivativeAt(data.f, x),
        error: Math.abs(derivativeAt(data.f, x) - data.secantSlope),
      }));
      const frames = makeFrames((index) => {
        const active = rows.length === 0 ? null : rows[Math.min(rows.length - 1, Math.floor(index * rows.length / FRAME_COUNT))]!;
        const lines: PlotSeries[] = [
          { points: curve, stroke: BLUE, label: 'f(x)' },
          sampledLine(domain[0], domain[1], secant, ORANGE, '割线', true),
        ];
        const markers: PlotMarker[] = [];
        if (active) {
          lines.push(sampledLine(domain[0], domain[1],
            (x) => active.value + active.slope * (x - active.x), GREEN, '平行切线', true));
          markers.push({ x: active.x, y: active.value, color: RED, label: '中值切点 ξ' });
        }
        return {
          title: '搜索 f′(ξ) 等于割线斜率的切点',
          summary: rows.length === 0 ? '未找到满足条件且可微的实切点；不伪造切线' : '切点由导数方程的符号变化与二分细化得到，属于数值证据',
          scene: plotScene('中值切点及平行切线', lines, markers, domain),
          metrics: [
            metric('切点数量', String(rows.length)),
            metric('当前 ξ', formatNumber(active?.x)),
            metric("f′(ξ)", formatNumber(active?.slope), true),
            metric('斜率误差', formatNumber(active?.error)),
          ],
          columns: ['ξ', 'f(ξ)', "f′(ξ)", '与割线斜率误差'],
          rows: rows.map((row) => [row.x, row.value, row.slope, row.error]),
        };
      });
      return makeResult(text, values, frames, { meanValuePoints: rows, secantSlope: data.secantSlope });
    },
  },
  {
    id: 'slope-comparison',
    title: '割线与切线对照表',
    diagram: 'summary',
    inputs: ['tangent-search'],
    run: ({ text, params }) => {
      const values = effectiveParams(params, meanValueDefaults);
      const data = meanValueData(text, values);
      const domain = meanValueDomain(values);
      const curve = sampleFunction(data.f, domain[0], domain[1]);
      const roots = data.points.map((x) => ({ x, y: finiteAt(data.f, x), slope: derivativeAt(data.f, x) }));
      const frames = makeFrames((index) => {
        const progress = (index + 1) / FRAME_COUNT;
        const visible = roots.slice(0, Math.ceil(roots.length * progress));
        const maxError = roots.reduce((largest, row) => Math.max(largest, Math.abs(row.slope - data.secantSlope)), 0);
        return {
          title: '中值定理数值对照',
          summary: roots.length > 0 ? '数值切点满足平行斜率条件；结论仍以定理连续/可微条件为前提' : '当前样本未给出中值切点，请检查连续性与可微性',
          scene: plotScene('割线斜率与切线斜率对照', [
            { points: curve, stroke: BLUE, label: 'f(x)' },
            sampledLine(domain[0], domain[1],
              (x) => data.lowerValue + data.secantSlope * (x - data.lower), ORANGE, '割线', true),
          ], visible.map((row) => ({ x: row.x, y: row.y, color: RED, label: 'ξ' })), domain),
          metrics: [
            metric('割线斜率', formatNumber(data.secantSlope)),
            metric('切点数', String(roots.length)),
            metric('最大斜率误差', formatNumber(roots.length > 0 ? maxError : null), true),
          ],
          columns: ['量', '数值'],
          rows: [
            ['割线斜率', data.secantSlope],
            ...roots.map((row, rowIndex) => [`切点 ${rowIndex + 1}：ξ / f′(ξ)`, `${formatNumber(row.x)} / ${formatNumber(row.slope)}`]),
          ],
        };
      });
      return makeResult(text, values, frames, { meanValuePoints: roots });
    },
  },
];

const ftcDefaults = { a: 1, b: 0, c: 0, base: 0, upper: Math.PI };
const ftcDomain = (params: Record<string, number>) =>
  [Math.min(params.base!, params.upper!), Math.max(params.base!, params.upper!)] as const;

function compositeSimpson(f: RealFunction, lower: number, upper: number, segments: number): number {
  if (lower === upper) return 0;
  const evenSegments = Math.max(2, Math.round(segments) + (Math.round(segments) % 2));
  const h = (upper - lower) / evenSegments;
  let sum = 0;
  for (let index = 0; index <= evenSegments; index += 1) {
    const weight = index === 0 || index === evenSegments ? 1 : index % 2 === 1 ? 4 : 2;
    sum += weight * finiteAt(f, lower + index * h);
  }
  const result = sum * h / 3;
  if (!Number.isFinite(result)) throw new Error('积分结果超出有限数范围');
  return result;
}

const ftcStages: CalculusPipelineStage[] = [
  functionSourceStage({
    expression: 'sin(x)',
    defaults: ftcDefaults,
    controls: [control('base', '固定下限 a', 0, -4, 4, 0.1), control('upper', '扫描终点 b', Math.PI, -4, 4, 0.1)],
    presets: [
      { label: '正弦面积', params: { base: 0, upper: Math.PI }, text: 'sin(x)' },
      { label: '抛物线累计量', params: { base: -1, upper: 2 }, text: 'x^2' },
      { label: '反向积分', params: { base: 1, upper: -1 }, text: 'x' },
    ],
    domain: ftcDomain,
    probe: (params) => params.upper!,
  }),
  {
    id: 'accumulated-area',
    title: '变上限累计面积',
    diagram: 'integral',
    inputs: ['function-source'],
    run: ({ text, params }) => {
      const values = effectiveParams(params, ftcDefaults);
      const f = compileRealFunction(text, values);
      const base = values.base!;
      const upper = values.upper!;
      if (base === upper) throw new Error('请设置不同的积分下限与扫描终点');
      const [lower, upperDomain] = ftcDomain(values);
      const samples = antiderivativeSamples(f, base, lower, upperDomain, FRAME_COUNT);
      if (samples.some((row) => row.integral === null)) throw new Error('扫描区间含无定义样本，无法构造有限变上限积分');
      const fSamples = sampleFunction(f, lower, upperDomain, FRAME_COUNT);
      const integralSamples: PlotPoint[] = samples.map((row) => ({ x: row.x, y: row.integral }));
      const frames = makeFrames((index) => {
        const current = samples[index]!;
        const x = base + ((upper - base) * index) / (FRAME_COUNT - 1);
        const nearest = samples.reduce((best, row) => Math.abs(row.x - x) < Math.abs(best.x - x) ? row : best, current);
        const areaPoints = samples.slice(0, index + 1).map((row) => ({ x: row.x, y: row.integral }));
        return {
          title: 'F(x)=∫ₐˣ f(t)dt 的逐帧描点',
          summary: '累计积分由复合 Simpson 数值计算；有向区间保留正负号',
          scene: plotScene('被积函数与变上限累计积分', [
            { points: fSamples, stroke: BLUE, label: 'f(x)' },
            { points: areaPoints, stroke: ORANGE, label: 'F(x)' },
          ], nearest.integral === null ? [] : [{ x: nearest.x, y: nearest.integral, color: RED, label: 'F 当前点' }], [lower, upperDomain]),
          metrics: [
            metric('当前上限 x', formatNumber(nearest.x)),
            metric('f(x)', formatNumber(nearest.f)),
            metric('F(x)', formatNumber(nearest.integral), true),
          ],
          columns: ['x', 'f(x)', 'F(x)=∫ₐˣf'],
          rows: samples.filter((_, rowIndex) => rowIndex % 10 === 0)
            .map((row) => [row.x, row.f ?? '无定义', row.integral ?? '不可算']),
        };
      });
      return makeResult(text, values, frames, { antiderivativeSamples: samples, fullIntegralCurve: integralSamples });
    },
  },
  {
    id: 'ftc-slope-check',
    title: 'F′(x)=f(x) 斜率验证',
    diagram: 'derivative',
    inputs: ['accumulated-area'],
    run: ({ text, params }) => {
      const values = effectiveParams(params, ftcDefaults);
      const f = compileRealFunction(text, values);
      const base = values.base!;
      const upper = values.upper!;
      if (base === upper) throw new Error('请设置不同的积分下限与扫描终点');
      const [lower, upperDomain] = ftcDomain(values);
      const samples = antiderivativeSamples(f, base, lower, upperDomain, FRAME_COUNT);
      const h = Math.max(1e-5, Math.abs(upper - base) * 1e-4);
      const checks = samples.map((row) => {
        if (row.f === null || row.integral === null) return { ...row, approximateSlope: null };
        const left = compositeSimpson(f, base, row.x - h, 32);
        const right = compositeSimpson(f, base, row.x + h, 32);
        return { ...row, approximateSlope: (right - left) / (2 * h) };
      });
      const fSamples = sampleFunction(f, lower, upperDomain, FRAME_COUNT);
      const slopeSamples: PlotPoint[] = checks.map((row) => ({ x: row.x, y: row.approximateSlope }));
      const frames = makeFrames((index) => {
        const row = checks[index]!;
        const error = row.approximateSlope === null || row.f === null ? null : Math.abs(row.approximateSlope - row.f);
        return {
          title: '累计函数的差分斜率对照',
          summary: 'F′ 的数值差分与 f 分列，误差不是解析证明',
          scene: plotScene('f(x) 与累计函数数值斜率', [
            { points: fSamples, stroke: BLUE, label: 'f(x)' },
            { points: slopeSamples, stroke: GREEN, label: '数值 F′(x)', dashed: true },
          ], row.f === null ? [] : [{ x: row.x, y: row.f, color: RED, label: '验证点' }], [lower, upperDomain]),
          metrics: [
            metric('x', formatNumber(row.x)),
            metric('数值 F′(x)', formatNumber(row.approximateSlope)),
            metric('f(x)', formatNumber(row.f)),
            metric('绝对误差', formatNumber(error), true),
          ],
          columns: ['x', '数值 F′(x)', 'f(x)', '绝对误差'],
          rows: checks.filter((_, rowIndex) => rowIndex % 10 === 0).map((item) => [
            item.x,
            item.approximateSlope ?? '不可算',
            item.f ?? '无定义',
            item.approximateSlope === null || item.f === null ? '不可算' : Math.abs(item.approximateSlope - item.f),
          ]),
        };
      });
      return makeResult(text, values, frames, { ftcChecks: checks });
    },
  },
  {
    id: 'ftc-summary',
    title: '微积分基本定理总表',
    diagram: 'summary',
    inputs: ['ftc-slope-check'],
    run: ({ text, params }) => {
      const values = effectiveParams(params, ftcDefaults);
      const f = compileRealFunction(text, values);
      const base = values.base!;
      const upper = values.upper!;
      const exactNumeric = integrate(f, base, upper, 128, 1).reference;
      const midpoint = (base + upper) / 2;
      const h = 1e-4;
      const slope = (compositeSimpson(f, base, midpoint + h, 64) - compositeSimpson(f, base, midpoint - h, 64)) / (2 * h);
      const midpointValue = finiteAt(f, midpoint);
      const [lower, upperDomain] = ftcDomain(values);
      const samples = antiderivativeSamples(f, base, lower, upperDomain, FRAME_COUNT);
      const frames = makeFrames((index) => {
        const row = samples[index]!;
        return {
          title: '面积、原函数与斜率验证汇总',
          summary: '高精度 Simpson 数值参考与近似量分列，不将数值一致表述为解析证明',
          scene: plotScene('微积分基本定理累计曲线', [
            { points: sampleFunction(f, lower, upperDomain, FRAME_COUNT), stroke: BLUE, label: 'f(x)' },
            { points: samples.map((item) => ({ x: item.x, y: item.integral })), stroke: ORANGE, label: 'F(x)' },
          ], row.integral === null ? [] : [{ x: row.x, y: row.integral, color: RED, label: 'F' }], [lower, upperDomain]),
          metrics: [
            metric('区间积分数值参考', formatNumber(exactNumeric)),
            metric('中点数值 F′', formatNumber(slope)),
            metric('中点 f', formatNumber(midpointValue)),
            metric('中点斜率误差', formatNumber(Math.abs(slope - midpointValue)), true),
          ],
          columns: ['检验项', '数值'],
          rows: [
            [`∫${formatNumber(base)}^${formatNumber(upper)} f(x)dx`, exactNumeric],
            ['中点 x', midpoint],
            ['中点数值 F′', slope],
            ['中点 f(x)', midpointValue],
          ],
        };
      });
      return makeResult(text, values, frames, { referenceIntegral: exactNumeric, midpointSlope: slope, midpointValue });
    },
  },
];

interface IntegrationMethodRow {
  n: number;
  left: number;
  midpoint: number;
  trapezoid: number;
  simpson: number;
  reference: number;
  leftError: number;
  midpointError: number;
  trapezoidError: number;
  simpsonError: number;
}

const integrationDefaults = { a: 1, b: 0, c: 0, lower: 0, upper: 1, n: 4 };
const integrationDomain = (params: Record<string, number>) =>
  [Math.min(params.lower!, params.upper!), Math.max(params.lower!, params.upper!)] as const;

function integrationMethodRow(f: RealFunction, lower: number, upper: number, count: number): IntegrationMethodRow {
  const n = Math.max(1, Math.min(256, Math.round(count)));
  const h = (upper - lower) / n;
  let left = 0;
  let midpoint = 0;
  let trapezoid = 0;
  for (let index = 0; index < n; index += 1) {
    const x = lower + index * h;
    left += finiteAt(f, x);
    midpoint += finiteAt(f, x + h / 2);
    trapezoid += (finiteAt(f, x) + finiteAt(f, x + h)) / 2;
  }
  left *= h;
  midpoint *= h;
  trapezoid *= h;
  const simpson = compositeSimpson(f, lower, upper, n);
  const reference = integrate(f, lower, upper, 128, 1).reference;
  return {
    n,
    left,
    midpoint,
    trapezoid,
    simpson,
    reference,
    leftError: Math.abs(left - reference),
    midpointError: Math.abs(midpoint - reference),
    trapezoidError: Math.abs(trapezoid - reference),
    simpsonError: Math.abs(simpson - reference),
  };
}

const convergenceCounts = [2, 4, 8, 16, 32, 64];

function observedOrder(previous: number, current: number): number | null {
  if (previous <= 0 || current <= 0 || !Number.isFinite(previous) || !Number.isFinite(current)) return null;
  return Math.log2(previous / current);
}

const integrationRaceStages: CalculusPipelineStage[] = [
  functionSourceStage({
    expression: 'x^2',
    defaults: integrationDefaults,
    controls: [
      control('lower', '积分下限 a', 0, -4, 4, 0.1),
      control('upper', '积分上限 b', 1, -4, 4, 0.1),
      control('n', '分割数 n', 4, 1, 64, 1),
    ],
    presets: [
      { label: 'x² 在 [0,1]', params: { lower: 0, upper: 1, n: 4 }, text: 'x^2' },
      { label: '正弦在 [0,π]', params: { lower: 0, upper: Math.PI, n: 8 }, text: 'sin(x)' },
      { label: '指数在 [0,1]', params: { lower: 0, upper: 1, n: 4 }, text: 'exp(x)' },
    ],
    domain: integrationDomain,
    probe: (params) => (params.lower! + params.upper!) / 2,
  }),
  {
    id: 'method-race',
    title: '四种积分方法对照',
    diagram: 'integral',
    inputs: ['function-source'],
    run: ({ text, params }) => {
      const values = effectiveParams(params, integrationDefaults);
      const f = compileRealFunction(text, values);
      const lower = values.lower!;
      const upper = values.upper!;
      if (lower === upper) throw new Error('积分上下限必须不同');
      const domain = integrationDomain(values);
      const curve = sampleFunction(f, domain[0], domain[1]);
      const frames = makeFrames((index) => {
        const n = convergenceCounts[Math.min(convergenceCounts.length - 1,
          Math.floor(index * convergenceCounts.length / FRAME_COUNT))]!;
        const row = integrationMethodRow(f, lower, upper, n);
        const leftIntegral = integrate(f, lower, upper, n, 0);
        const rectangles = leftIntegral.rectangles.map((rect) => ({
          x: rect.x,
          y: rect.y,
        }));
        return {
          title: '左和、中点和、梯形与 Simpson 同场竞赛',
          summary: `当前 n=${n}；Simpson 若遇奇数分割则自动增加一段，参考值为高精度数值积分`,
          scene: plotScene('积分分割与函数图像', [
            { points: curve, stroke: BLUE, label: 'f(x)' },
            { points: rectangles, stroke: ORANGE, label: '左和采样', dashed: true },
          ], rectangles.map((rect) => ({ x: rect.x, y: rect.y, color: ORANGE })), domain),
          metrics: [
            metric('n', String(n)),
            metric('左和', formatNumber(row.left)),
            metric('中点和', formatNumber(row.midpoint)),
            metric('梯形', formatNumber(row.trapezoid)),
            metric('Simpson', formatNumber(row.simpson), true),
          ],
          columns: ['方法', '近似值', '相对数值参考的绝对误差'],
          rows: [
            ['左黎曼和', row.left, row.leftError],
            ['中点黎曼和', row.midpoint, row.midpointError],
            ['梯形', row.trapezoid, row.trapezoidError],
            ['Simpson', row.simpson, row.simpsonError],
            ['高精度数值参考', row.reference, 0],
          ],
        };
      });
      return makeResult(text, values, frames);
    },
  },
  {
    id: 'convergence-order',
    title: '误差收敛阶',
    diagram: 'series',
    inputs: ['method-race'],
    run: ({ text, params }) => {
      const values = effectiveParams(params, integrationDefaults);
      const f = compileRealFunction(text, values);
      const rows = convergenceCounts.map((n) => integrationMethodRow(f, values.lower!, values.upper!, n));
      const methods = [
        { key: 'leftError', label: '左和', color: RED },
        { key: 'midpointError', label: '中点', color: ORANGE },
        { key: 'trapezoidError', label: '梯形', color: CYAN },
        { key: 'simpsonError', label: 'Simpson', color: GREEN },
      ] as const;
      const frames = makeFrames((index) => {
        const rowIndex = Math.min(rows.length - 1, Math.floor(index * rows.length / FRAME_COUNT));
        const row = rows[rowIndex]!;
        const previous = rowIndex > 0 ? rows[rowIndex - 1]! : null;
        const errorSeries: PlotSeries[] = methods.map((method) => ({
          points: rows.map((item) => ({
            x: Math.log2(item.n),
            y: item[method.key] > 0 ? Math.log10(item[method.key]) : null,
          })),
          stroke: method.color,
          label: `${method.label} log₁₀误差`,
        }));
        return {
          title: '步长减半时的误差收敛',
          summary: '收敛阶 p=log₂(Eₙ/E₂ₙ)；零误差或机器精度附近不报告伪阶数',
          scene: plotScene('分割数与积分误差对数图', errorSeries, [], [1, 6]),
          metrics: methods.map((method) => metric(
            `${method.label} 当前误差 / 阶`,
            `${formatNumber(row[method.key])} / ${formatNumber(previous ? observedOrder(previous[method.key], row[method.key]) : null)}`,
            method.key === 'simpsonError',
          )),
          columns: ['n', '左和误差', '中点误差', '梯形误差', 'Simpson 误差'],
          rows: rows.map((item) => [item.n, item.leftError, item.midpointError, item.trapezoidError, item.simpsonError]),
        };
      });
      return makeResult(text, values, frames, { convergence: rows });
    },
  },
  {
    id: 'integration-summary',
    title: '积分方法精度汇总',
    diagram: 'summary',
    inputs: ['convergence-order'],
    run: ({ text, params }) => {
      const values = effectiveParams(params, integrationDefaults);
      const f = compileRealFunction(text, values);
      const rows = convergenceCounts.map((n) => integrationMethodRow(f, values.lower!, values.upper!, n));
      const frames = makeFrames((index) => {
        const rowIndex = Math.min(rows.length - 1, Math.floor(index * rows.length / FRAME_COUNT));
        const current = rows[rowIndex]!;
        const previous = rowIndex > 0 ? rows[rowIndex - 1]! : null;
        return {
          title: '积分近似值与数值参考汇总',
          summary: '参考值来自既有 integrate 的 1024 段 Simpson；所有误差均相对该数值参考',
          scene: plotScene('四种方法误差随分割数变化', [
            { points: rows.map((row) => ({ x: Math.log2(row.n), y: Math.log10(Math.max(row.leftError, 1e-16)) })), stroke: RED, label: '左和' },
            { points: rows.map((row) => ({ x: Math.log2(row.n), y: Math.log10(Math.max(row.midpointError, 1e-16)) })), stroke: ORANGE, label: '中点' },
            { points: rows.map((row) => ({ x: Math.log2(row.n), y: Math.log10(Math.max(row.trapezoidError, 1e-16)) })), stroke: CYAN, label: '梯形' },
            { points: rows.map((row) => ({ x: Math.log2(row.n), y: Math.log10(Math.max(row.simpsonError, 1e-16)) })), stroke: GREEN, label: 'Simpson' },
          ], [], [1, 6]),
          metrics: [
            metric('当前 n', String(current.n)),
            metric('数值参考', formatNumber(current.reference)),
            metric('Simpson 误差', formatNumber(current.simpsonError), true),
            metric('Simpson 收敛阶', formatNumber(previous ? observedOrder(previous.simpsonError, current.simpsonError) : null)),
          ],
          columns: ['n', '参考值', '左和', '中点', '梯形', 'Simpson'],
          rows: rows.map((row) => [row.n, row.reference, row.left, row.midpoint, row.trapezoid, row.simpson]),
        };
      });
      return makeResult(text, values, frames, { convergence: rows });
    },
  },
];

const taylorDefaults = { a: 1, b: 0, c: 0, center: 0, x: 1, degree: 5 };
const taylorDomain = (params: Record<string, number>) => [params.center! - 2, params.center! + 2] as const;

function polynomialValue(coefficients: number[], center: number, x: number, degree = coefficients.length - 1): number {
  let value = 0;
  for (let order = Math.min(degree, coefficients.length - 1); order >= 0; order -= 1) {
    value = value * (x - center) + coefficients[order]!;
  }
  return value;
}

const taylorStages: CalculusPipelineStage[] = [
  functionSourceStage({
    expression: 'exp(x)',
    defaults: taylorDefaults,
    controls: [
      control('center', '展开中心 x₀', 0, -2, 2, 0.1),
      control('x', '求值点 x', 1, -3, 3, 0.1),
      control('degree', '最高阶数 N', 5, 1, 5, 1),
    ],
    presets: [
      { label: 'exp(x) 在 0', params: { center: 0, x: 1, degree: 5 }, text: 'exp(x)' },
      { label: 'sin(x) 在 0', params: { center: 0, x: 1, degree: 5 }, text: 'sin(x)' },
      { label: 'cos(x) 在 0', params: { center: 0, x: 2, degree: 5 }, text: 'cos(x)' },
    ],
    domain: taylorDomain,
    probe: (params) => params.x!,
  }),
  {
    id: 'taylor-polynomial',
    title: 'Taylor 多项式逐阶构造',
    diagram: 'series',
    inputs: ['function-source'],
    run: ({ text, params }) => {
      const values = effectiveParams(params, taylorDefaults);
      const f = compileRealFunction(text, values);
      const center = values.center!;
      const x = values.x!;
      const degree = Math.max(1, Math.min(5, Math.round(values.degree!)));
      const expansion = taylorPolynomial(f, center, degree);
      const [lower, upper] = taylorDomain(values);
      const original = sampleFunction(f, lower, upper);
      const exact = finiteAt(f, x);
      const frames = makeFrames((index) => {
        const currentDegree = Math.min(degree, Math.floor(index * (degree + 1) / FRAME_COUNT));
        const approximation = polynomialValue(expansion.coefficients, center, x, currentDegree);
        const polynomial = sampleFunction((probe) => polynomialValue(expansion.coefficients, center, probe, currentDegree), lower, upper);
        return {
          title: 'Taylor 部分和随阶数增长',
          summary: '系数由受限表达式的局部自动微分幂级数给出，最高五阶',
          scene: plotScene('原函数与 Taylor 多项式', [
            { points: original, stroke: BLUE, label: 'f(x)' },
            { points: polynomial, stroke: ORANGE, label: `P${currentDegree}(x)` },
          ], [
            { x, y: exact, color: BLUE, label: 'f(x)' },
            { x, y: approximation, color: RED, label: `P${currentDegree}(x)` },
          ], [lower, upper]),
          metrics: [
            metric('当前阶数 N', String(currentDegree)),
            metric('f(x)', formatNumber(exact)),
            metric('Pₙ(x)', formatNumber(approximation)),
            metric('局部绝对余项', formatNumber(Math.abs(exact - approximation)), true),
          ],
          columns: ['k', '系数 f⁽ᵏ⁾(x₀)/k!'],
          rows: expansion.coefficients.slice(0, currentDegree + 1).map((coefficient, order) => [order, coefficient]),
        };
      });
      return makeResult(text, values, frames, { coefficients: expansion.coefficients });
    },
  },
  {
    id: 'taylor-remainder',
    title: '局部余项与误差曲线',
    diagram: 'series',
    inputs: ['taylor-polynomial'],
    run: ({ text, params }) => {
      const values = effectiveParams(params, taylorDefaults);
      const f = compileRealFunction(text, values);
      const center = values.center!;
      const degree = Math.max(1, Math.min(5, Math.round(values.degree!)));
      const coefficients = taylorPolynomial(f, center, degree).coefficients;
      const [lower, upper] = taylorDomain(values);
      const original = sampleFunction(f, lower, upper);
      const frames = makeFrames((index) => {
        const currentDegree = Math.min(degree, Math.floor(index * (degree + 1) / FRAME_COUNT));
        const remainder = original.map((point) => ({
          x: point.x,
          y: point.y === null ? null : Math.abs(point.y - polynomialValue(coefficients, center, point.x, currentDegree)),
        }));
        const atX = finiteAt(f, values.x!);
        const approximation = polynomialValue(coefficients, center, values.x!, currentDegree);
        const maxError = remainder.reduce((largest, point) => point.y === null ? largest : Math.max(largest, point.y), 0);
        return {
          title: 'Taylor 截断余项 |f(x)−Pₙ(x)|',
          summary: '图中为采样点的实际数值误差，不使用未经计算的余项上界',
          scene: plotScene('Taylor 局部余项曲线', [{ points: remainder, stroke: RED, label: `N=${currentDegree} 的 |余项|` }],
            [{ x: values.x!, y: Math.abs(atX - approximation), color: PURPLE, label: '求值点误差' }], [lower, upper]),
          metrics: [
            metric('阶数 N', String(currentDegree)),
            metric('求值点误差', formatNumber(Math.abs(atX - approximation)), true),
            metric('区间采样最大误差', formatNumber(maxError)),
            metric('近似值', formatNumber(approximation)),
          ],
          columns: ['x', 'f(x)', 'Pₙ(x)', '|余项|'],
          rows: original.filter((_, rowIndex) => rowIndex % 20 === 0).map((point) => {
            const approximationAtPoint = polynomialValue(coefficients, center, point.x, currentDegree);
            return [point.x, point.y ?? '无定义', approximationAtPoint,
              point.y === null ? '不可算' : Math.abs(point.y - approximationAtPoint)];
          }),
        };
      });
      return makeResult(text, values, frames, { coefficients });
    },
  },
  {
    id: 'taylor-coefficients',
    title: '系数与逐项贡献',
    diagram: 'summary',
    inputs: ['taylor-remainder'],
    run: ({ text, params }) => {
      const values = effectiveParams(params, taylorDefaults);
      const f = compileRealFunction(text, values);
      const center = values.center!;
      const x = values.x!;
      const degree = Math.max(1, Math.min(5, Math.round(values.degree!)));
      const coefficients = taylorPolynomial(f, center, degree).coefficients;
      const exact = finiteAt(f, x);
      const frames = makeFrames((index) => {
        const currentDegree = Math.min(degree, Math.floor(index * (degree + 1) / FRAME_COUNT));
        const partial = polynomialValue(coefficients, center, x, currentDegree);
        const points = coefficients.slice(0, currentDegree + 1).map((_, order) => ({
          x: order,
          y: coefficients[order]! * (x - center) ** order,
        }));
        return {
          title: 'Taylor 各项对部分和的贡献',
          summary: '每项读数为 aₖ(x−x₀)ᵏ，可与系数表逐项复算',
          scene: plotScene('Taylor 逐项贡献', [{ points, stroke: PURPLE, label: '第 k 项贡献' }],
            points.map((point, order) => ({ x: point.x, y: point.y, color: order === currentDegree ? RED : PURPLE, label: `k=${order}` })), [0, Math.max(1, degree)]),
          metrics: [
            metric('当前部分和', formatNumber(partial)),
            metric('f(x)', formatNumber(exact)),
            metric('当前误差', formatNumber(Math.abs(exact - partial)), true),
          ],
          columns: ['k', '系数 aₖ', '第 k 项', '截至 k 的部分和'],
          rows: coefficients.slice(0, currentDegree + 1).map((coefficient, order) => [
            order,
            coefficient,
            coefficient * (x - center) ** order,
            polynomialValue(coefficients, center, x, order),
          ]),
        };
      });
      return makeResult(text, values, frames, { coefficients, exactAtX: exact });
    },
  },
];

const fourierDefaults = { waveform: 0, harmonics: 9 };
const waveformOptions = [
  { value: 0, label: '方波' },
  { value: 1, label: '三角波' },
  { value: 2, label: '锯齿波' },
];

function waveformFrom(params: Record<string, number>): Waveform {
  const value = Math.max(0, Math.min(2, Math.round(params.waveform ?? 0)));
  return value === 0 ? 'square' : value === 1 ? 'triangle' : 'sawtooth';
}

function waveformLabel(waveform: Waveform): string {
  return waveform === 'square' ? '方波' : waveform === 'triangle' ? '三角波' : '锯齿波';
}

function waveformTarget(waveform: Waveform, x: number): number {
  if (waveform === 'square') return Math.sign(Math.sin(x));
  if (waveform === 'triangle') return (2 / Math.PI) * Math.asin(Math.sin(x));
  const wrapped = ((x + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return wrapped / Math.PI;
}

function waveformSourceStage(): CalculusPipelineStage {
  return {
    id: 'waveform-source',
    title: '周期波形与谐波源',
    diagram: 'source',
    text: 'square',
    controls: [control('waveform', '目标波形', 0, 0, 2, 1, waveformOptions), control('harmonics', '最高谐波 N', 9, 1, 40, 1)],
    presets: [
      { label: '方波 Gibbs', params: { waveform: 0, harmonics: 9 }, text: 'square' },
      { label: '三角波频谱', params: { waveform: 1, harmonics: 9 }, text: 'triangle' },
      { label: '锯齿波', params: { waveform: 2, harmonics: 12 }, text: 'sawtooth' },
    ],
    run: ({ params }) => {
      const values = effectiveParams(params, fourierDefaults);
      const waveform = waveformFrom(values);
      const text = waveform;
      const harmonics = Math.max(1, Math.round(values.harmonics!));
      const target = Array.from({ length: 241 }, (_, index) => {
        const x = -Math.PI + (2 * Math.PI * index) / 240;
        return { x, y: waveformTarget(waveform, x) };
      });
      const frames = makeFrames((index) => {
        const n = Math.max(1, Math.round(1 + ((harmonics - 1) * index) / (FRAME_COUNT - 1)));
        const partial = fourierSamples(waveform, n, -Math.PI, Math.PI, 241);
        return {
          title: `${waveformLabel(waveform)}与 Fourier 部分和`,
          summary: '游标增加最高谐波次数；目标与近似分别绘制',
          scene: plotScene('目标周期波形与 Fourier 部分和', [
            { points: target, stroke: GRAY, label: '目标波形', dashed: true },
            { points: partial, stroke: BLUE, label: `S${n}(x)` },
          ], [], [-Math.PI, Math.PI]),
          metrics: [
            metric('波形', waveformLabel(waveform)),
            metric('当前 N', String(n), true),
            metric('f(π/2) 目标', formatNumber(waveformTarget(waveform, Math.PI / 2))),
            metric('Sₙ(π/2)', formatNumber(fourierPartialSum(waveform, n, Math.PI / 2))),
          ],
          columns: ['参数', '值'],
          rows: [['波形', waveformLabel(waveform)], ['最高谐波', harmonics], ['周期', 2 * Math.PI]],
        };
      });
      return makeResult(text, values, frames, { waveform });
    },
  };
}

const fourierStages: CalculusPipelineStage[] = [
  waveformSourceStage(),
  {
    id: 'partial-sum',
    title: 'Fourier 部分和',
    diagram: 'series',
    inputs: ['waveform-source'],
    run: ({ params }) => {
      const values = effectiveParams(params, fourierDefaults);
      const waveform = waveformFrom(values);
      const text = waveform;
      const harmonics = Math.max(1, Math.round(values.harmonics!));
      const target = Array.from({ length: 241 }, (_, index) => {
        const x = -Math.PI + (2 * Math.PI * index) / 240;
        return { x, y: waveformTarget(waveform, x) };
      });
      const frames = makeFrames((index) => {
        const n = Math.max(1, Math.round(1 + ((harmonics - 1) * index) / (FRAME_COUNT - 1)));
        const partial = fourierSamples(waveform, n, -Math.PI, Math.PI, 241);
        const squaredError = partial.reduce((sum, point) => {
          const difference = point.y - waveformTarget(waveform, point.x);
          return sum + difference * difference;
        }, 0) / partial.length;
        return {
          title: '谐波逐项叠加',
          summary: '部分和复用既有 Fourier 系数与采样函数',
          scene: plotScene('Fourier 部分和逼近目标波形', [
            { points: target, stroke: GRAY, label: '目标', dashed: true },
            { points: partial, stroke: BLUE, label: `N=${n}` },
          ], [], [-Math.PI, Math.PI]),
          metrics: [
            metric('N', String(n)),
            metric('采样 RMSE', formatNumber(Math.sqrt(squaredError)), true),
            metric('Sₙ(0.5)', formatNumber(fourierPartialSum(waveform, n, 0.5))),
            metric('目标 f(0.5)', formatNumber(waveformTarget(waveform, 0.5))),
          ],
          columns: ['x', '目标', '部分和'],
          rows: partial.filter((_, rowIndex) => rowIndex % 30 === 0)
            .map((point) => [point.x, waveformTarget(waveform, point.x), point.y]),
        };
      });
      return makeResult(text, values, frames, { waveform });
    },
  },
  {
    id: 'frequency-spectrum',
    title: '谐波频谱',
    diagram: 'series',
    inputs: ['partial-sum'],
    run: ({ params }) => {
      const values = effectiveParams(params, fourierDefaults);
      const waveform = waveformFrom(values);
      const text = waveform;
      const harmonics = Math.max(1, Math.round(values.harmonics!));
      const spectrum = fourierSpectrum(waveform, harmonics);
      const frames = makeFrames((index) => {
        const n = Math.max(1, Math.round(1 + ((harmonics - 1) * index) / (FRAME_COUNT - 1)));
        const visible = spectrum.filter((item) => item.harmonic <= n);
        const points = visible.map((item) => ({ x: item.harmonic, y: item.amplitude }));
        return {
          title: '谐波次数与正弦项振幅',
          summary: waveform === 'sawtooth' ? '锯齿波含全部整数谐波' : '方波与三角波仅含奇次谐波',
          scene: plotScene('Fourier 谐波频谱', [{ points, stroke: PURPLE, label: '振幅 |bₖ|' }],
            points.map((point) => ({ x: point.x, y: point.y, color: PURPLE, label: `k=${point.x}` })), [0, Math.max(2, harmonics)]),
          metrics: [
            metric('当前最高谐波', String(n)),
            metric('非零谱线数', String(visible.length)),
            metric('基波振幅', formatNumber(spectrum[0]?.amplitude), true),
          ],
          columns: ['谐波 k', '振幅 |bₖ|'],
          rows: visible.map((item) => [item.harmonic, item.amplitude]),
        };
      });
      return makeResult(text, values, frames, { spectrum });
    },
  },
  {
    id: 'gibbs-error',
    title: 'Gibbs 过冲与误差',
    diagram: 'summary',
    inputs: ['frequency-spectrum'],
    run: ({ params }) => {
      const values = effectiveParams(params, fourierDefaults);
      const waveform = waveformFrom(values);
      const text = waveform;
      const harmonics = Math.max(1, Math.round(values.harmonics!));
      const target = Array.from({ length: 241 }, (_, index) => {
        const x = -Math.PI + (2 * Math.PI * index) / 240;
        return { x, y: waveformTarget(waveform, x) };
      });
      const frames = makeFrames((index) => {
        const n = Math.max(1, Math.round(1 + ((harmonics - 1) * index) / (FRAME_COUNT - 1)));
        const partial = fourierSamples(waveform, n, -Math.PI, Math.PI, 241);
        const maximum = Math.max(...partial.map((point) => point.y));
        const minimum = Math.min(...partial.map((point) => point.y));
        const overshoot = waveform === 'triangle' ? 0 : Math.max(maximum - 1, -1 - minimum, 0);
        const errors = partial.map((point) => Math.abs(point.y - waveformTarget(waveform, point.x)));
        const rmse = Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length);
        return {
          title: '间断附近的 Gibbs 现象',
          summary: waveform === 'triangle'
            ? '三角波连续，无跳跃型 Gibbs 过冲；仍以 RMSE 和最大误差衡量逼近'
            : '过冲按部分和超出目标 [−1,1] 的幅度计算，不把振铃误差隐藏为拟合误差',
          scene: plotScene('Gibbs 过冲与目标波形', [
            { points: target, stroke: GRAY, label: '目标', dashed: true },
            { points: partial, stroke: RED, label: `N=${n} 部分和` },
          ], [], [-Math.PI, Math.PI]),
          metrics: [
            metric('N', String(n)),
            metric('Gibbs 过冲', formatNumber(overshoot), true),
            metric('最大绝对误差', formatNumber(Math.max(...errors))),
            metric('RMSE', formatNumber(rmse)),
          ],
          columns: ['指标', '数值'],
          rows: [
            ['最高谐波', n],
            ['最大值', maximum],
            ['最小值', minimum],
            ['过冲', overshoot],
            ['RMSE', rmse],
          ],
        };
      });
      return makeResult(text, values, frames, { waveform });
    },
  },
];

const odeDefaults = { x0: 0, y0: 1, step: 0.1, steps: 20 };

interface OdePoint {
  x: number;
  y: number;
}

function odeSettings(params: Record<string, number>) {
  const values = effectiveParams(params, odeDefaults);
  return {
    values,
    x0: values.x0!,
    y0: values.y0!,
    step: Math.min(0.5, Math.max(1e-4, values.step!)),
    steps: Math.max(1, Math.min(80, Math.round(values.steps!))),
  };
}

function compileOde(text: string) {
  try {
    const compiled = compileExpression(text, ['x', 'y']);
    return (x: number, y: number): number => {
      const value = compiled.evalOrNull({ x, y });
      if (value === null || !Number.isFinite(value)) {
        throw new Error(`微分方程在 x=${formatNumber(x)}、y=${formatNumber(y)} 处无有限实数值`);
      }
      return value;
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('微分方程在')) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`微分方程表达式无效：${reason}`);
  }
}

function eulerOde(text: string, x0: number, y0: number, step: number, steps: number): OdePoint[] {
  const derivative = compileOde(text);
  const points = [{ x: x0, y: y0 }];
  let y = y0;
  for (let index = 0; index < steps; index += 1) {
    const x = x0 + index * step;
    y += step * derivative(x, y);
    if (!Number.isFinite(y)) throw new Error('Euler 轨迹超出有限数范围，请减小步长或调整方程');
    points.push({ x: x + step, y });
  }
  return points;
}

function checkedRk4(text: string, x0: number, y0: number, step: number, steps: number): OdePoint[] {
  const points = integrateOdeRK4(text, x0, y0, step, steps);
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error('RK4 轨迹出现非有限值，请减小步长或检查方程定义域');
  }
  return points;
}

function slopeFieldScene(text: string, x0: number, y0: number, step: number, steps: number): ScienceScene {
  const end = x0 + step * steps;
  const min = Math.min(x0, end, y0) - 1;
  const max = Math.max(x0, end, y0) + 1;
  const grid = slopeFieldGrid(text, min, max, 11);
  const project = (x: number, y: number): [number, number] => [
    35 + ((x - min) / (max - min)) * 345,
    205 - ((y - min) / (max - min)) * 170,
  ];
  const vectors: ScienceVector[] = [];
  grid.xs.forEach((x, xIndex) => {
    grid.ys.forEach((y, yIndex) => {
      const slope = grid.slopes[xIndex]?.[yIndex];
      if (slope === null || slope === undefined || !Number.isFinite(slope)) return;
      const [sx, sy] = project(x, y);
      const length = 7 / Math.sqrt(1 + slope * slope);
      vectors.push({ x: sx - length, y: sy + slope * length, dx: 2 * length, dy: -2 * slope * length, color: CYAN });
    });
  });
  const [initialX, initialY] = project(x0, y0);
  return {
    ariaLabel: '微分方程斜率场与初值点',
    grid: true,
    axes: true,
    vectors,
    points: [{ x: initialX, y: initialY, radius: 4, color: RED, label: '初值' }],
  };
}

function odeSolutions(text: string, params: Record<string, number>) {
  const settings = odeSettings(params);
  const { x0, y0, step, steps } = settings;
  compileOde(text)(x0, y0);
  const euler = eulerOde(text, x0, y0, step, steps);
  const rk4 = checkedRk4(text, x0, y0, step, steps);
  const refinement = 4;
  const fine = checkedRk4(text, x0, y0, step / refinement, steps * refinement);
  const reference = euler.map((_, index) => fine[index * refinement]!);
  return { ...settings, euler, rk4, reference };
}

const odeStages: CalculusPipelineStage[] = [
  {
    id: 'ode-source',
    title: '微分方程与初值源',
    diagram: 'source',
    text: 'y',
    textLabel: "dy/dx = f(x,y)，例如 y 或 x+y",
    controls: [
      control('x0', '初值 x₀', 0, -5, 5, 0.1),
      control('y0', '初值 y₀', 1, -5, 5, 0.1),
      control('step', '步长 h', 0.1, 0.01, 0.5, 0.01),
      control('steps', '步数', 20, 1, 80, 1),
    ],
    presets: [
      { label: '指数增长 y′=y', params: { x0: 0, y0: 1, step: 0.1, steps: 20 }, text: 'y' },
      { label: ' logistic 方程', params: { x0: 0, y0: 0.1, step: 0.1, steps: 40 }, text: 'y*(1-y)' },
      { label: '阻尼振荡一阶系统', params: { x0: 0, y0: 2, step: 0.05, steps: 40 }, text: '-y+sin(x)' },
    ],
    run: ({ text, params }) => {
      const { values, x0, y0, step, steps } = odeSettings(params);
      const derivative = compileOde(text);
      const initialSlope = derivative(x0, y0);
      const scene = slopeFieldScene(text, x0, y0, step, steps);
      const frames = makeFrames((index) => {
        const currentStep = Math.max(1, Math.round(((index + 1) / FRAME_COUNT) * steps));
        const x = x0 + currentStep * step;
        return {
          title: '斜率场与初值条件',
          summary: '向量方向来自 f(x,y)，当前游标表示将要积分到的步数',
          scene,
          metrics: [
            metric('初值 (x₀,y₀)', `(${formatNumber(x0)}, ${formatNumber(y0)})`),
            metric('初始斜率', formatNumber(initialSlope), true),
            metric('当前步数', String(currentStep)),
            metric('当前终点 x', formatNumber(x)),
          ],
          columns: ['参数', '值'],
          rows: [['步长 h', step], ['总步数', steps], ['初值斜率', initialSlope]],
        };
      });
      return makeResult(text, values, frames, { initialSlope });
    },
  },
  {
    id: 'slope-field',
    title: '斜率场与逐步推进',
    diagram: 'ode',
    inputs: ['ode-source'],
    run: ({ text, params }) => {
      const solution = odeSolutions(text, params);
      const { values, x0, y0, step, steps, rk4 } = solution;
      const field = slopeFieldScene(text, x0, y0, step, steps);
      const frames = makeFrames((index) => {
        const currentStep = Math.max(1, Math.round(((index + 1) / FRAME_COUNT) * steps));
        const current = rk4[currentStep]!;
        return {
          title: '沿斜率场推进 RK4 轨迹',
          summary: '每一帧对应一个实际积分步，轨迹读数在方法对照环节给出',
          scene: {
            ...field,
            labels: [...(field.labels ?? []), { x: 45, y: 20, text: `RK4 第 ${currentStep} 步`, color: BLUE, size: 12 }],
          },
          metrics: [
            metric('步数 k', String(currentStep)),
            metric('xₖ', formatNumber(current.x)),
            metric('RK4 yₖ', formatNumber(current.y), true),
            metric('f(xₖ,yₖ)', formatNumber(compileOde(text)(current.x, current.y))),
          ],
          columns: ['k', 'x', 'RK4 y'],
          rows: rk4.slice(0, currentStep + 1).filter((_, rowIndex) => rowIndex % Math.max(1, Math.floor(steps / 8)) === 0)
            .map((point, rowIndex) => [rowIndex, point.x, point.y]),
        };
      });
      return makeResult(text, values, frames, { rk4 });
    },
  },
  {
    id: 'euler-rk4',
    title: 'Euler 与 RK4 轨迹',
    diagram: 'ode',
    inputs: ['slope-field'],
    run: ({ text, params }) => {
      const { values, steps, euler, rk4, reference } = odeSolutions(text, params);
      const toPlot = (points: OdePoint[]): PlotPoint[] => points.map((point) => ({ x: point.x, y: point.y }));
      const frames = makeFrames((index) => {
        const currentStep = Math.max(1, Math.round(((index + 1) / FRAME_COUNT) * steps));
        const eulerPoint = euler[currentStep]!;
        const rk4Point = rk4[currentStep]!;
        const referencePoint = reference[currentStep]!;
        return {
          title: '同一步长下 Euler 与 RK4 对照',
          summary: '细 4 倍步长的 RK4 仅作数值参考，不冒充解析解',
          scene: plotScene('Euler RK4 与细步数值参考轨迹', [
            { points: toPlot(euler.slice(0, currentStep + 1)), stroke: ORANGE, label: 'Euler' },
            { points: toPlot(rk4.slice(0, currentStep + 1)), stroke: BLUE, label: 'RK4' },
            { points: toPlot(reference.slice(0, currentStep + 1)), stroke: GREEN, label: '细步 RK4 参考', dashed: true },
          ], [
            { x: eulerPoint.x, y: eulerPoint.y, color: ORANGE, label: 'Euler' },
            { x: rk4Point.x, y: rk4Point.y, color: BLUE, label: 'RK4' },
          ]),
          metrics: [
            metric('当前步数', String(currentStep)),
            metric('Euler y', formatNumber(eulerPoint.y)),
            metric('RK4 y', formatNumber(rk4Point.y), true),
            metric('数值参考 y', formatNumber(referencePoint.y)),
          ],
          columns: ['k', 'x', 'Euler', 'RK4', '细步 RK4 参考'],
          rows: euler.slice(0, currentStep + 1).map((point, rowIndex) => [
            rowIndex,
            point.x,
            point.y,
            rk4[rowIndex]!.y,
            reference[rowIndex]!.y,
          ]),
        };
      });
      return makeResult(text, values, frames, { euler, rk4, reference });
    },
  },
  {
    id: 'ode-error',
    title: 'ODE 方法误差表',
    diagram: 'summary',
    inputs: ['euler-rk4'],
    run: ({ text, params }) => {
      const { values, steps, euler, rk4, reference } = odeSolutions(text, params);
      const eulerErrors = euler.map((point, index) => Math.abs(point.y - reference[index]!.y));
      const rk4Errors = rk4.map((point, index) => Math.abs(point.y - reference[index]!.y));
      const frames = makeFrames((index) => {
        const currentStep = Math.max(1, Math.round(((index + 1) / FRAME_COUNT) * steps));
        return {
          title: 'Euler 与 RK4 的数值参考误差',
          summary: '误差相对细 4 倍步长 RK4；它是数值对照，不是全局误差严格上界',
          scene: plotScene('ODE 两种方法绝对误差随 x 变化', [
            { points: euler.map((point, rowIndex) => ({ x: point.x, y: eulerErrors[rowIndex]! })), stroke: ORANGE, label: 'Euler 绝对误差' },
            { points: rk4.map((point, rowIndex) => ({ x: point.x, y: rk4Errors[rowIndex]! })), stroke: BLUE, label: 'RK4 绝对误差' },
          ], [
            { x: euler[currentStep]!.x, y: eulerErrors[currentStep]!, color: ORANGE, label: 'Euler' },
            { x: rk4[currentStep]!.x, y: rk4Errors[currentStep]!, color: BLUE, label: 'RK4' },
          ]),
          metrics: [
            metric('Euler 终点误差', formatNumber(eulerErrors[currentStep])),
            metric('RK4 终点误差', formatNumber(rk4Errors[currentStep]), true),
            metric('Euler 最大误差', formatNumber(Math.max(...eulerErrors.slice(0, currentStep + 1)))),
            metric('RK4 最大误差', formatNumber(Math.max(...rk4Errors.slice(0, currentStep + 1)))),
          ],
          columns: ['k', 'x', 'Euler 误差', 'RK4 误差', '数值参考 y'],
          rows: euler.slice(0, currentStep + 1).map((point, rowIndex) => [
            rowIndex,
            point.x,
            eulerErrors[rowIndex]!,
            rk4Errors[rowIndex]!,
            reference[rowIndex]!.y,
          ]),
        };
      });
      return makeResult(text, values, frames, { eulerErrors, rk4Errors, reference });
    },
  },
];

export const calculusSinglePipelines: SciencePipelineMap = {
  'limit-epsilon': { stages: limitEpsilonStages },
  'derivative-triptych': { stages: derivativeTriptychStages },
  'mean-value': { stages: meanValueStages },
  'ftc-sweep': { stages: ftcStages },
  'integration-race': { stages: integrationRaceStages },
  'taylor-error': { stages: taylorStages },
  'fourier-gibbs': { stages: fourierStages },
  'ode-methods': { stages: odeStages },
};