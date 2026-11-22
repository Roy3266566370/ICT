import {
  compileFunction2d,
  directionDerivative,
  function2dValue,
  gradient2d,
  polarSandbox,
  type RealFunction2d,
} from './calculus.ts';
import { det, eigen, fmt, type M2 } from './math.ts';
import type {
  ScienceFrame,
  ScienceMetric,
  SciencePipelineMap,
  ScienceResult,
  ScienceScene,
} from './sciencePipelineTypes.ts';

type Vector2 = { x: number; y: number };
type FrameExtras = Partial<Pick<ScienceFrame, 'columns' | 'rows' | 'series' | 'highlightRows'>>;

const TAU = Math.PI * 2;

function parameter(params: Record<string, number>, key: string, fallback: number): number {
  const value = params[key];
  return value === undefined || !Number.isFinite(value) ? fallback : value;
}

function integerParameter(params: Record<string, number>, key: string, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(parameter(params, key, fallback))));
}

function makeFrame(
  title: string,
  summary: string,
  scene: ScienceScene,
  metrics: ScienceMetric[] = [],
  extras: FrameExtras = {},
): ScienceFrame {
  return { title, summary, scene, metrics, ...extras };
}

function makeResult(
  text: string,
  params: Record<string, number>,
  frames: ScienceFrame[],
  computed: Record<string, number> = {},
): ScienceResult {
  const parameters = { ...params, ...computed };
  if (Object.values(parameters).some((value) => !Number.isFinite(value))) {
    throw new Error('计算结果包含非有限数，请调整输入或定义域');
  }
  return { data: { parameters, text }, frames };
}

function compile2d(expression: string, params: Record<string, number>): RealFunction2d {
  return compileFunction2d(function2dValue(expression, params));
}

function finite2d(f: RealFunction2d, x: number, y: number): number {
  const value = f(x, y);
  if (value === null || !Number.isFinite(value)) {
    throw new Error(`点 (${fmt(x, 3)}, ${fmt(y, 3)}) 不在函数的有限实数定义域内`);
  }
  return value;
}

function plotPoint(x: number, y: number, scale = 36): [number, number] {
  return [200 + x * scale, 120 - y * scale];
}

function plotVector(origin: Vector2, delta: Vector2, scale: number, color: string, label?: string) {
  const start = plotPoint(origin.x, origin.y, scale);
  const end = plotPoint(origin.x + delta.x, origin.y + delta.y, scale);
  return {
    x: start[0], y: start[1], dx: end[0] - start[0], dy: end[1] - start[1], color,
    ...(label === undefined ? {} : { label }),
  };
}

function normalized(vector: Vector2): Vector2 {
  const length = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(length) || length < 1e-14) throw new Error('零向量不能作为方向');
  return { x: vector.x / length, y: vector.y / length };
}

function matrixVector(matrix: M2, vector: Vector2): Vector2 {
  return {
    x: matrix.a * vector.x + matrix.b * vector.y,
    y: matrix.c * vector.x + matrix.d * vector.y,
  };
}

function matrixProduct(left: M2, right: M2): M2 {
  return {
    a: left.a * right.a + left.b * right.c,
    b: left.a * right.b + left.b * right.d,
    c: left.c * right.a + left.d * right.c,
    d: left.c * right.b + left.d * right.d,
  };
}

function parseNumber(token: string, label: string): number {
  if (!token.trim()) throw new Error(`${label}存在空项`);
  const value = Number(token);
  if (!Number.isFinite(value)) throw new Error(`${label}必须是有限实数`);
  return value;
}

function parseMatrix(text: string): M2 {
  const matrixText = text.split('|')[0]?.trim() ?? '';
  const rows = matrixText.split(';').map((row) => row.split(','));
  if (rows.length !== 2 || rows.some((row) => row.length !== 2)) {
    throw new Error('矩阵请写成 a,b;c,d 的 2×2 形式');
  }
  return {
    a: parseNumber(rows[0]![0]!, '矩阵元素'),
    b: parseNumber(rows[0]![1]!, '矩阵元素'),
    c: parseNumber(rows[1]![0]!, '矩阵元素'),
    d: parseNumber(rows[1]![1]!, '矩阵元素'),
  };
}

function parseMatrixAndVector(text: string): { matrix: M2; vector: Vector2 } {
  const parts = text.split('|');
  if (parts.length !== 2 || !parts[1]?.trim()) {
    throw new Error('矩阵与向量请写成 a,b;c,d | x,y');
  }
  const coordinates = parts[1]!.split(',');
  if (coordinates.length !== 2) throw new Error('向量请写成 x,y');
  return {
    matrix: parseMatrix(parts[0]!),
    vector: {
      x: parseNumber(coordinates[0]!, '向量分量'),
      y: parseNumber(coordinates[1]!, '向量分量'),
    },
  };
}

function matrixTable(matrix: M2, label: string): (string | number)[][] {
  return [
    [label, fmt(matrix.a, 6), fmt(matrix.b, 6)],
    ['', fmt(matrix.c, 6), fmt(matrix.d, 6)],
  ];
}

function matrixScene(matrix: M2, label: string, summary?: string): ScienceScene {
  const labels = [
    { x: 200, y: 34, text: label, size: 16, anchor: 'middle' as const },
    { x: 165, y: 94, text: fmt(matrix.a, 5), size: 18, anchor: 'middle' as const },
    { x: 235, y: 94, text: fmt(matrix.b, 5), size: 18, anchor: 'middle' as const },
    { x: 165, y: 145, text: fmt(matrix.c, 5), size: 18, anchor: 'middle' as const },
    { x: 235, y: 145, text: fmt(matrix.d, 5), size: 18, anchor: 'middle' as const },
  ];
  if (summary) labels.push({ x: 200, y: 196, text: summary, size: 12, anchor: 'middle' });
  return {
    ariaLabel: `${label}矩阵`,
    labels,
    paths: [
      { points: [[135, 62], [125, 62], [125, 165], [135, 165]], stroke: '#64748b' },
      { points: [[265, 62], [275, 62], [275, 165], [265, 165]], stroke: '#64748b' },
    ],
  };
}

function scalarFieldScene(
  f: RealFunction2d,
  point: Vector2,
  gradient?: Vector2,
  direction?: Vector2,
): ScienceScene {
  const columns = 14;
  const rows = 10;
  const values: (number | null)[] = [];
  let maximum = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = -3 + (6 * (column + 0.5)) / columns;
      const y = 2.5 - (5 * (row + 0.5)) / rows;
      const raw = f(x, y);
      const value = raw === null || !Number.isFinite(raw) ? null : raw;
      values.push(value);
      if (value !== null) maximum = Math.max(maximum, Math.abs(value));
    }
  }
  const rects: NonNullable<ScienceScene['rects']> = [];
  values.forEach((value, index) => {
    if (value === null) return;
    const column = index % columns;
    const row = Math.floor(index / columns);
    rects.push({
      x: 54 + column * 21,
      y: 15 + row * 21,
      width: 21,
      height: 21,
      fill: value >= 0 ? '#2563eb' : '#dc2626',
      opacity: 0.08 + (0.48 * Math.abs(value)) / Math.max(maximum, 1e-12),
    });
  });
  const vectors: NonNullable<ScienceScene['vectors']> = [];
  if (gradient && Math.hypot(gradient.x, gradient.y) > 1e-12) {
    const unit = normalized(gradient);
    vectors.push(plotVector(point, { x: unit.x * 1.35, y: unit.y * 1.35 }, 36, '#dc2626', '∇f'));
  }
  if (direction) vectors.push(plotVector(point, { x: direction.x * 1.15, y: direction.y * 1.15 }, 36, '#059669', 'u'));
  return {
    ariaLabel: '二元函数标量场、梯度与方向',
    grid: true,
    axes: true,
    rects,
    vectors,
    points: [{ x: plotPoint(point.x, point.y)[0], y: plotPoint(point.x, point.y)[1], radius: 5, color: '#111827' }],
    labels: [{ x: 200, y: 234, text: '蓝色为正、红色为负；颜色深浅表示 |f| 的相对大小', size: 11, anchor: 'middle' }],
  };
}

function gradientAt(text: string, params: Record<string, number>) {
  const f = compile2d(text, params);
  const point = { x: parameter(params, 'x0', 1), y: parameter(params, 'y0', 0.5) };
  const value = gradient2d(f, point.x, point.y);
  if (![value.value, value.fx, value.fy].every(Number.isFinite)) {
    throw new Error('该点及其差分邻域必须位于函数的有限实数定义域内');
  }
  return { f, point, value };
}

function lagrangeExpressions(text: string): { objective: string; constraint: string } {
  const parts = text.split(';').map((part) => part.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('请用分号分隔目标函数与约束：f(x,y); g(x,y)');
  }
  return { objective: parts[0]!, constraint: parts[1]! };
}

interface LagrangeState {
  x: number;
  y: number;
  lambda: number;
  residual: number;
  constraint: number;
}

function lagrangeResidual(
  f: RealFunction2d,
  g: RealFunction2d,
  x: number,
  y: number,
  lambda: number,
): [number, number, number] {
  const df = gradient2d(f, x, y);
  const dg = gradient2d(g, x, y);
  const constraint = g(x, y);
  if (![df.fx, df.fy, dg.fx, dg.fy].every(Number.isFinite) || constraint === null || !Number.isFinite(constraint)) {
    throw new Error('拉格朗日方程在当前点无有限实数值');
  }
  return [df.fx - lambda * dg.fx, df.fy - lambda * dg.fy, constraint];
}

function residualNorm(residual: [number, number, number]): number {
  return Math.hypot(...residual);
}

function solve3(matrix: number[][], rhs: number[]): [number, number, number] {
  const augmented = matrix.map((row, index) => [...row, rhs[index]!]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const divisor = augmented[column]![column]!;
    if (!Number.isFinite(divisor) || Math.abs(divisor) < 1e-12) throw new Error('拉格朗日 Newton 方程奇异，请更换初值');
    for (let row = column + 1; row < 3; row += 1) {
      const factor = augmented[row]![column]! / divisor;
      for (let k = column; k < 4; k += 1) augmented[row]![k] = augmented[row]![k]! - factor * augmented[column]![k]!;
    }
  }
  const solution = [0, 0, 0];
  for (let row = 2; row >= 0; row -= 1) {
    let value = augmented[row]![3]!;
    for (let column = row + 1; column < 3; column += 1) value -= augmented[row]![column]! * solution[column]!;
    solution[row] = value / augmented[row]![row]!;
  }
  if (!solution.every(Number.isFinite)) throw new Error('拉格朗日 Newton 迭代产生非有限数');
  return solution as [number, number, number];
}

function solveLagrange(text: string, params: Record<string, number>) {
  const { objective, constraint } = lagrangeExpressions(text);
  const f = compile2d(objective, params);
  const g = compile2d(constraint, params);
  let x = parameter(params, 'x0', 0.8);
  let y = parameter(params, 'y0', 0.6);
  let lambda = parameter(params, 'lambda0', 0.5);
  const history: LagrangeState[] = [];
  for (let iteration = 0; iteration <= 40; iteration += 1) {
    const residual = lagrangeResidual(f, g, x, y, lambda);
    const norm = residualNorm(residual);
    const constraintValue = finite2d(g, x, y);
    history.push({ x, y, lambda, residual: norm, constraint: constraintValue });
    if (norm < 1e-8) return { f, g, history, solution: history[history.length - 1]! };
    const h = 1e-5;
    const jacobian = [0, 1, 2].map((column) => {
      const shift = [0, 0, 0];
      shift[column] = h;
      const plus = lagrangeResidual(f, g, x + shift[0]!, y + shift[1]!, lambda + shift[2]!);
      const minus = lagrangeResidual(f, g, x - shift[0]!, y - shift[1]!, lambda - shift[2]!);
      return plus.map((value, row) => (value - minus[row]!) / (2 * h));
    });
    const matrix = [0, 1, 2].map((row) => [0, 1, 2].map((column) => jacobian[column]![row]!));
    const delta = solve3(matrix, residual.map((value) => -value));
    let step = 1;
    let accepted = false;
    while (step >= 1 / 64) {
      const next = [x + step * delta[0], y + step * delta[1], lambda + step * delta[2]];
      try {
        if (residualNorm(lagrangeResidual(f, g, next[0]!, next[1]!, next[2]!)) < norm) {
          x = next[0]!;
          y = next[1]!;
          lambda = next[2]!;
          accepted = true;
          break;
        }
      } catch {
        // 回溯到有限定义域内；若所有步长都失败则报告初值问题。
      }
      step /= 2;
    }
    if (!accepted) throw new Error('拉格朗日 Newton 迭代无法继续，请更换初值或约束');
  }
  throw new Error('拉格朗日 Newton 迭代在 40 步内未收敛，请更换初值');
}

function zeroContour(f: RealFunction2d): NonNullable<ScienceScene['paths']> {
  const paths: NonNullable<ScienceScene['paths']> = [];
  const columns = 22;
  const rows = 16;
  const sample = (column: number, row: number): Vector2 & { value: number | null } => {
    const x = -2.5 + (5 * column) / columns;
    const y = -2 + (4 * row) / rows;
    const raw = f(x, y);
    return { x, y, value: raw === null || !Number.isFinite(raw) ? null : raw };
  };
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const corners = [sample(column, row), sample(column + 1, row), sample(column + 1, row + 1), sample(column, row + 1)];
      const crossings: [number, number][] = [];
      for (let edge = 0; edge < 4; edge += 1) {
        const start = corners[edge]!;
        const end = corners[(edge + 1) % 4]!;
        if (start.value === null || end.value === null || start.value * end.value >= 0) continue;
        const ratio = start.value / (start.value - end.value);
        crossings.push(plotPoint(start.x + ratio * (end.x - start.x), start.y + ratio * (end.y - start.y)));
      }
      for (let index = 0; index + 1 < crossings.length; index += 2) {
        paths.push({ points: [crossings[index]!, crossings[index + 1]!], stroke: '#2563eb', strokeWidth: 1.4 });
      }
    }
  }
  return paths;
}

function lagrangeScene(g: RealFunction2d, state: LagrangeState): ScienceScene {
  const point = plotPoint(state.x, state.y);
  return {
    ariaLabel: '约束曲线与拉格朗日迭代点',
    grid: true,
    axes: true,
    paths: zeroContour(g),
    points: [{ x: point[0], y: point[1], radius: 5, color: Math.abs(state.constraint) < 1e-6 ? '#059669' : '#dc2626' }],
    labels: [
      { x: 12, y: 18, text: '蓝线：g(x,y)=0', size: 12 },
      { x: 200, y: 232, text: `λ=${fmt(state.lambda, 5)}，残差=${fmt(state.residual, 5)}`, size: 12, anchor: 'middle' },
    ],
  };
}

interface PolarSettings {
  theta0: number;
  theta1: number;
  radius: number;
  n: number;
}

function polarSettings(params: Record<string, number>): PolarSettings {
  const theta0 = parameter(params, 'theta0', 0);
  const theta1 = parameter(params, 'theta1', TAU);
  const radius = parameter(params, 'radius', 2);
  if (!(theta1 > theta0) || theta1 - theta0 > TAU + 1e-8) throw new Error('极角区间须递增且长度不超过 2π');
  if (!(radius > 0) || !Number.isFinite(radius)) throw new Error('极坐标外半径必须是正有限数');
  return { theta0, theta1, radius, n: integerParameter(params, 'n', 24, 4, 80) };
}

function doubleGreenExpressions(text: string): { integrand: string; p: string; q: string } {
  const parts = text.split(';').map((part) => part.trim());
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error('请依次填写 f(x,y); P(x,y); Q(x,y)，用分号分隔');
  }
  return { integrand: parts[0]!, p: parts[1]!, q: parts[2]! };
}

function polarIntegrand(expression: string): string {
  const transformed = expression
    .replace(/\bx\b/g, '(r*cos(theta))')
    .replace(/\by\b/g, '(r*sin(theta))');
  return `(${transformed})*r`;
}

function computePolarIntegral(text: string, params: Record<string, number>, theta1?: number) {
  const settings = polarSettings(params);
  const upper = theta1 ?? settings.theta1;
  const { integrand } = doubleGreenExpressions(text);
  return polarSandbox(
    polarIntegrand(integrand),
    settings.n,
    settings.theta0 + (upper - settings.theta0) * 0.5,
    { theta0: settings.theta0, theta1: upper, rMax: settings.radius },
  );
}

function sectorScene(settings: PolarSettings, field?: { p: RealFunction2d; q: RealFunction2d }): ScienceScene {
  const scale = 78 / settings.radius;
  const arc = Array.from({ length: 65 }, (_, index) => {
    const theta = settings.theta0 + ((settings.theta1 - settings.theta0) * index) / 64;
    return plotPoint(settings.radius * Math.cos(theta), settings.radius * Math.sin(theta), scale);
  });
  const origin = plotPoint(0, 0, scale);
  const paths: NonNullable<ScienceScene['paths']> = [
    { points: [origin, arc[0]!, ...arc.slice(1), origin], stroke: '#2563eb', fill: '#dbeafe', closed: true },
  ];
  const vectors: NonNullable<ScienceScene['vectors']> = [];
  if (field) {
    for (let xIndex = -2; xIndex <= 2; xIndex += 1) {
      for (let yIndex = -2; yIndex <= 2; yIndex += 1) {
        const x = (settings.radius * xIndex) / 2.5;
        const y = (settings.radius * yIndex) / 2.5;
        let theta = Math.atan2(y, x);
        while (theta < settings.theta0) theta += TAU;
        if (Math.hypot(x, y) > settings.radius || theta > settings.theta1 + 1e-10) continue;
        const px = finite2d(field.p, x, y);
        const qx = finite2d(field.q, x, y);
        const magnitude = Math.hypot(px, qx);
        if (magnitude < 1e-12) continue;
        const length = (settings.radius * 0.34) / magnitude;
        vectors.push(plotVector({ x, y }, { x: px * length, y: qx * length }, scale, '#059669'));
      }
    }
  }
  return {
    ariaLabel: '极坐标扇形区域与向量场',
    grid: true,
    axes: true,
    paths,
    vectors,
    labels: [
      { x: 200, y: 230, text: `θ∈[${fmt(settings.theta0, 3)}, ${fmt(settings.theta1, 3)}]，0≤r≤${fmt(settings.radius, 3)}`, size: 12, anchor: 'middle' },
      { x: 12, y: 18, text: '面积元 dA = r dr dθ', size: 12 },
    ],
  };
}

function simpson(integrand: (value: number) => number, lower: number, upper: number, segments: number): number {
  const n = segments % 2 === 0 ? segments : segments + 1;
  const h = (upper - lower) / n;
  let sum = 0;
  for (let index = 0; index <= n; index += 1) {
    const value = integrand(lower + index * h);
    if (!Number.isFinite(value)) throw new Error('边界积分出现非有限数，请检查向量场定义域');
    sum += (index === 0 || index === n ? 1 : index % 2 === 1 ? 4 : 2) * value;
  }
  return (sum * h) / 3;
}

function circulationGreen(text: string, params: Record<string, number>): number {
  const settings = polarSettings(params);
  const { p, q } = doubleGreenExpressions(text);
  const pf = compile2d(p, params);
  const qf = compile2d(q, params);
  const arc = simpson((theta) => {
    const x = settings.radius * Math.cos(theta);
    const y = settings.radius * Math.sin(theta);
    return -finite2d(pf, x, y) * settings.radius * Math.sin(theta)
      + finite2d(qf, x, y) * settings.radius * Math.cos(theta);
  }, settings.theta0, settings.theta1, 360);
  if (Math.abs(settings.theta1 - settings.theta0 - TAU) < 1e-7) return arc;
  const radial = (theta: number, from: number, to: number) => simpson((r) => {
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    return finite2d(pf, x, y) * Math.cos(theta) + finite2d(qf, x, y) * Math.sin(theta);
  }, from, to, 120);
  return arc + radial(settings.theta0, 0, settings.radius) + radial(settings.theta1, settings.radius, 0);
}

function curlIntegralGreen(text: string, params: Record<string, number>): number {
  const settings = polarSettings(params);
  const { p, q } = doubleGreenExpressions(text);
  const pf = compile2d(p, params);
  const qf = compile2d(q, params);
  const h = 1e-5;
  let total = 0;
  for (let i = 0; i < settings.n; i += 1) {
    const theta = settings.theta0 + ((i + 0.5) * (settings.theta1 - settings.theta0)) / settings.n;
    for (let j = 0; j < settings.n; j += 1) {
      const r = ((j + 0.5) * settings.radius) / settings.n;
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      const qx = (finite2d(qf, x + h, y) - finite2d(qf, x - h, y)) / (2 * h);
      const py = (finite2d(pf, x, y + h) - finite2d(pf, x, y - h)) / (2 * h);
      total += (qx - py) * r * settings.radius * (settings.theta1 - settings.theta0) / settings.n ** 2;
    }
  }
  if (!Number.isFinite(total)) throw new Error('旋度面积分出现非有限数');
  return total;
}

function basisCoordinates(text: string) {
  const { matrix, vector } = parseMatrixAndVector(text);
  const determinant = det(matrix);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) {
    throw new Error('基矩阵行列式为零，两个列向量不能构成基');
  }
  const coordinates = {
    x: (matrix.d * vector.x - matrix.b * vector.y) / determinant,
    y: (-matrix.c * vector.x + matrix.a * vector.y) / determinant,
  };
  const reconstructed = matrixVector(matrix, coordinates);
  return { matrix, vector, determinant, coordinates, reconstructed };
}

function basisScene(text: string, components = false): ScienceScene {
  const model = basisCoordinates(text);
  const { matrix, vector, coordinates } = model;
  const scale = 34;
  const b1 = { x: matrix.a, y: matrix.c };
  const b2 = { x: matrix.b, y: matrix.d };
  const paths: NonNullable<ScienceScene['paths']> = [];
  for (let index = -3; index <= 3; index += 1) {
    const offset1 = { x: b2.x * index, y: b2.y * index };
    const offset2 = { x: b1.x * index, y: b1.y * index };
    paths.push({
      points: [
        plotPoint(offset1.x - 4 * b1.x, offset1.y - 4 * b1.y, scale),
        plotPoint(offset1.x + 4 * b1.x, offset1.y + 4 * b1.y, scale),
      ],
      stroke: '#bfdbfe', dashed: true,
    });
    paths.push({
      points: [
        plotPoint(offset2.x - 4 * b2.x, offset2.y - 4 * b2.y, scale),
        plotPoint(offset2.x + 4 * b2.x, offset2.y + 4 * b2.y, scale),
      ],
      stroke: '#bfdbfe', dashed: true,
    });
  }
  const vectors = [
    plotVector({ x: 0, y: 0 }, b1, scale, '#2563eb', 'b₁'),
    plotVector({ x: 0, y: 0 }, b2, scale, '#8b5cf6', 'b₂'),
    plotVector({ x: 0, y: 0 }, vector, scale, '#dc2626', 'v'),
  ];
  if (components) {
    const first = { x: b1.x * coordinates.x, y: b1.y * coordinates.x };
    const second = { x: b2.x * coordinates.y, y: b2.y * coordinates.y };
    paths.push({ points: [plotPoint(0, 0, scale), plotPoint(first.x, first.y, scale), plotPoint(vector.x, vector.y, scale)], stroke: '#059669', dashed: true });
    vectors.push(plotVector({ x: 0, y: 0 }, second, scale, '#8b5cf6', '[v]B 的第二分量'));
  }
  const point = plotPoint(vector.x, vector.y, scale);
  return {
    ariaLabel: '标准坐标系与给定基坐标系',
    grid: true,
    axes: true,
    paths,
    vectors,
    points: [{ x: point[0], y: point[1], radius: 4, color: '#dc2626' }],
    labels: [{ x: 200, y: 232, text: `灰色：标准网格；蓝色斜网格：B 坐标系；[v]B=(${fmt(coordinates.x, 4)}, ${fmt(coordinates.y, 4)})`, size: 11, anchor: 'middle' }],
  };
}

interface EigenDirection {
  lambda: number;
  vector: Vector2;
  residual: number;
}

function eigenDirection(matrix: M2, lambda: number): EigenDirection {
  const first = { x: -matrix.b, y: matrix.a - lambda };
  const second = { x: matrix.d - lambda, y: -matrix.c };
  let vector = Math.hypot(first.x, first.y) >= Math.hypot(second.x, second.y) ? first : second;
  if (Math.hypot(vector.x, vector.y) < 1e-9) vector = { x: 1, y: 0 };
  vector = normalized(vector);
  const transformed = matrixVector(matrix, vector);
  return {
    lambda,
    vector,
    residual: Math.hypot(transformed.x - lambda * vector.x, transformed.y - lambda * vector.y),
  };
}

function eigenDirections(matrix: M2): EigenDirection[] {
  const info = eigen(matrix);
  if (!info.real) throw new Error('该实矩阵无实特征向量：特征值为共轭复数，请更换矩阵');
  if (Math.abs(info.l1 - info.l2) < 1e-9
      && Math.abs(matrix.b) < 1e-10 && Math.abs(matrix.c) < 1e-10
      && Math.abs(matrix.a - matrix.d) < 1e-10) {
    return [
      { lambda: info.l1, vector: { x: 1, y: 0 }, residual: 0 },
      { lambda: info.l2, vector: { x: 0, y: 1 }, residual: 0 },
    ];
  }
  const candidates = [eigenDirection(matrix, info.l1), eigenDirection(matrix, info.l2)];
  if (Math.abs(info.l1 - info.l2) < 1e-8
      || Math.abs(candidates[0]!.vector.x * candidates[1]!.vector.x + candidates[0]!.vector.y * candidates[1]!.vector.y) > 1 - 1e-7) {
    return [candidates[0]!];
  }
  return candidates;
}

function eigenScene(matrix: M2, vector: Vector2, directions: EigenDirection[], scale = 45): ScienceScene {
  const transformed = matrixVector(matrix, vector);
  return {
    ariaLabel: '矩阵变换与实特征方向',
    grid: true,
    axes: true,
    vectors: [
      ...directions.map((direction, index) => plotVector(
        { x: -direction.vector.x * 2, y: -direction.vector.y * 2 },
        { x: direction.vector.x * 4, y: direction.vector.y * 4 },
        scale,
        index === 0 ? '#2563eb' : '#8b5cf6',
        `λ=${fmt(direction.lambda, 3)}`,
      )),
      plotVector({ x: 0, y: 0 }, vector, scale, '#059669', 'v'),
      plotVector({ x: 0, y: 0 }, transformed, scale, '#dc2626', 'Av'),
    ],
  };
}

interface Svd2 {
  u: M2;
  sigma: M2;
  vt: M2;
  v1: Vector2;
  v2: Vector2;
  u1: Vector2;
  u2: Vector2;
  sigma1: number;
  sigma2: number;
}

function symmetricEigenvector(p: number, r: number, q: number, lambda: number): Vector2 {
  const first = { x: -r, y: p - lambda };
  const second = { x: q - lambda, y: -r };
  const candidate = Math.hypot(first.x, first.y) >= Math.hypot(second.x, second.y) ? first : second;
  if (Math.hypot(candidate.x, candidate.y) < 1e-12) return { x: 1, y: 0 };
  return normalized(candidate);
}

function computeSvd(matrix: M2): Svd2 {
  const p = matrix.a ** 2 + matrix.c ** 2;
  const r = matrix.a * matrix.b + matrix.c * matrix.d;
  const q = matrix.b ** 2 + matrix.d ** 2;
  const trace = p + q;
  const difference = Math.sqrt((p - q) ** 2 + 4 * r ** 2);
  const lambda1 = Math.max(0, (trace + difference) / 2);
  const lambda2 = Math.max(0, (trace - difference) / 2);
  const sigma1 = Math.sqrt(lambda1);
  let sigma2 = Math.sqrt(lambda2);
  const v1 = symmetricEigenvector(p, r, q, lambda1);
  const v2 = { x: -v1.y, y: v1.x };
  let u1: Vector2;
  let u2: Vector2;
  if (sigma1 > 1e-12) {
    const av1 = matrixVector(matrix, v1);
    u1 = { x: av1.x / sigma1, y: av1.y / sigma1 };
  } else {
    u1 = { x: 1, y: 0 };
  }
  if (sigma2 > 1e-12 * Math.max(1, sigma1)) {
    const av2 = matrixVector(matrix, v2);
    u2 = { x: av2.x / sigma2, y: av2.y / sigma2 };
  } else {
    sigma2 = 0;
    u2 = { x: -u1.y, y: u1.x };
  }
  return {
    u: { a: u1.x, b: u2.x, c: u1.y, d: u2.y },
    sigma: { a: sigma1, b: 0, c: 0, d: sigma2 },
    vt: { a: v1.x, b: v1.y, c: v2.x, d: v2.y },
    v1, v2, u1, u2, sigma1, sigma2,
  };
}

function lowRankMatrix(svd: Svd2, rank: number): M2 {
  const first = {
    a: svd.sigma1 * svd.u1.x * svd.v1.x,
    b: svd.sigma1 * svd.u1.x * svd.v1.y,
    c: svd.sigma1 * svd.u1.y * svd.v1.x,
    d: svd.sigma1 * svd.u1.y * svd.v1.y,
  };
  if (rank === 1) return first;
  return {
    a: first.a + svd.sigma2 * svd.u2.x * svd.v2.x,
    b: first.b + svd.sigma2 * svd.u2.x * svd.v2.y,
    c: first.c + svd.sigma2 * svd.u2.y * svd.v2.x,
    d: first.d + svd.sigma2 * svd.u2.y * svd.v2.y,
  };
}

function frobeniusDifference(left: M2, right: M2): number {
  return Math.hypot(left.a - right.a, left.b - right.b, left.c - right.c, left.d - right.d);
}

function svdComputed(matrix: M2, svd: Svd2, rank: number): Record<string, number> {
  const approximation = lowRankMatrix(svd, rank);
  return {
    sigma1: svd.sigma1,
    sigma2: svd.sigma2,
    u11: svd.u.a, u12: svd.u.b, u21: svd.u.c, u22: svd.u.d,
    vt11: svd.vt.a, vt12: svd.vt.b, vt21: svd.vt.c, vt22: svd.vt.d,
    rank,
    approximation11: approximation.a,
    approximation12: approximation.b,
    approximation21: approximation.c,
    approximation22: approximation.d,
    reconstructionError: frobeniusDifference(matrix, matrixProduct(matrixProduct(svd.u, svd.sigma), svd.vt)),
    lowRankError: frobeniusDifference(matrix, approximation),
  };
}

function svdScene(matrix: M2, svd: Svd2, rank: number, step: number): ScienceScene {
  const scale = 66 / Math.max(1, svd.sigma1);
  const circle = Array.from({ length: 65 }, (_, index) => {
    const theta = (TAU * index) / 64;
    return { x: Math.cos(theta), y: Math.sin(theta) };
  });
  const mapPath = (transform: M2, stroke: string, dashed = false) => ({
    points: circle.map((point) => {
      const mapped = matrixVector(transform, point);
      return plotPoint(mapped.x, mapped.y, scale);
    }),
    stroke,
    dashed,
    closed: true,
  });
  const approximation = lowRankMatrix(svd, rank);
  const paths: NonNullable<ScienceScene['paths']> = [];
  const vectors: NonNullable<ScienceScene['vectors']> = [];
  if (step === 0) {
    paths.push(mapPath({ a: 1, b: 0, c: 0, d: 1 }, '#2563eb'));
    vectors.push(
      plotVector({ x: 0, y: 0 }, svd.v1, scale, '#dc2626', 'v₁'),
      plotVector({ x: 0, y: 0 }, svd.v2, scale, '#8b5cf6', 'v₂'),
    );
  } else {
    paths.push(mapPath(matrix, '#2563eb', step === 2));
    if (step === 1) {
      vectors.push(
        plotVector({ x: 0, y: 0 }, { x: svd.sigma1 * svd.u1.x, y: svd.sigma1 * svd.u1.y }, scale, '#dc2626', 'σ₁u₁'),
        plotVector({ x: 0, y: 0 }, { x: svd.sigma2 * svd.u2.x, y: svd.sigma2 * svd.u2.y }, scale, '#8b5cf6', 'σ₂u₂'),
      );
    } else {
      paths.push(mapPath(approximation, '#059669'));
    }
  }
  return {
    ariaLabel: `SVD 第 ${step + 1} 步几何变换`,
    grid: true,
    axes: true,
    paths,
    vectors,
    labels: [{
      x: 200, y: 230,
      text: step === 0 ? '第 1 步：AᵀA 的特征向量构成 V' : step === 1 ? '第 2 步：Avᵢ=σᵢuᵢ，复原 A=UΣVᵀ' : `第 3 步：保留 rank=${rank} 项，绿色为低秩重构`,
      size: 12, anchor: 'middle',
    }],
  };
}

function svdFrames(text: string, params: Record<string, number>): { frames: ScienceFrame[]; computed: Record<string, number> } {
  const matrix = parseMatrix(text);
  const svd = computeSvd(matrix);
  const rank = integerParameter(params, 'rank', 1, 1, 2);
  const ata = matrixProduct(
    { a: matrix.a, b: matrix.c, c: matrix.b, d: matrix.d },
    matrix,
  );
  const approximation = lowRankMatrix(svd, rank);
  const fullError = frobeniusDifference(matrix, matrixProduct(matrixProduct(svd.u, svd.sigma), svd.vt));
  const lowRankError = frobeniusDifference(matrix, approximation);
  const rows: (string | number)[][] = [
    ...matrixTable(ata, 'AᵀA'),
    ...matrixTable(svd.u, 'U'),
    ...matrixTable(svd.sigma, 'Σ'),
    ...matrixTable(svd.vt, 'Vᵀ'),
    ...matrixTable(approximation, `A_${rank}`),
  ];
  const titles = ['第 1 步：求 V 与奇异值', '第 2 步：求 U 并复原 A', `第 3 步：rank ${rank} 低秩重构`];
  const summaries = [
    `AᵀA 的特征值为 ${fmt(svd.sigma1 ** 2, 6)}、${fmt(svd.sigma2 ** 2, 6)}，奇异值为其非负平方根`,
    `UΣVᵀ 与 A 的 Frobenius 误差为 ${fmt(fullError, 8)}`,
    `‖A-A_${rank}‖F=${fmt(lowRankError, 8)}；rank 1 理论误差应等于 σ₂=${fmt(svd.sigma2, 8)}`,
  ];
  const frames = titles.map((title, step) => makeFrame(
    title,
    summaries[step]!,
    svdScene(matrix, svd, rank, step),
    [
      { label: 'σ₁', value: fmt(svd.sigma1, 6), emphasis: true },
      { label: 'σ₂', value: fmt(svd.sigma2, 6) },
      { label: step === 2 ? '低秩误差' : '复原误差', value: fmt(step === 2 ? lowRankError : fullError, 8) },
    ],
    { columns: ['矩阵', '第一列', '第二列'], rows, highlightRows: step === 0 ? [0, 1, 8, 9] : step === 1 ? [4, 5, 6, 7, 8, 9] : [10, 11] },
  ));
  return { frames, computed: svdComputed(matrix, svd, rank) };
}

export const calculusMultiPipelines: SciencePipelineMap = {
  'gradient-direction': {
    stages: [
      {
        id: 'function', title: '二元函数与观察点', diagram: 'function', text: 'x^2+x*y+y^2', textLabel: 'f(x,y)',
        controls: [
          { key: 'x0', label: 'x₀', value: 1, min: -2, max: 2, step: 0.1 },
          { key: 'y0', label: 'y₀', value: 0.5, min: -2, max: 2, step: 0.1 },
          { key: 'theta', label: '方向角 θ（度）', value: 30, min: 0, max: 360, step: 5 },
        ],
        presets: [
          { label: '旋转抛物面', params: { x0: 1, y0: 0.5, theta: 30 }, text: 'x^2+x*y+y^2' },
          { label: '双曲抛物面', params: { x0: 1, y0: 1, theta: 45 }, text: 'x^2-y^2' },
        ],
        run: ({ text, params }) => {
          const { f, point, value } = gradientAt(text, params);
          return makeResult(text, params, [makeFrame(
            '标量场与观察点', `f(${fmt(point.x, 3)}, ${fmt(point.y, 3)})=${fmt(value.value, 6)}`,
            scalarFieldScene(f, point), [{ label: 'f(x₀,y₀)', value: fmt(value.value, 6), emphasis: true }],
          )]);
        },
      },
      {
        id: 'gradient', title: '中心差分梯度', diagram: 'contour', inputs: ['function'],
        run: ({ text, params }) => {
          const { f, point, value } = gradientAt(text, params);
          const gradient = { x: value.fx, y: value.fy };
          const magnitude = Math.hypot(value.fx, value.fy);
          return makeResult(text, params, [makeFrame(
            '梯度指向最陡上升方向', '中心差分分别估计 ∂f/∂x 与 ∂f/∂y；定义域断点不会被替换为零',
            scalarFieldScene(f, point, gradient),
            [{ label: '∂f/∂x', value: fmt(value.fx, 6) }, { label: '∂f/∂y', value: fmt(value.fy, 6) }, { label: '‖∇f‖', value: fmt(magnitude, 6), emphasis: true }],
          )], { gradientFx: value.fx, gradientFy: value.fy, gradientNorm: magnitude });
        },
      },
      {
        id: 'direction', title: '单位方向导数', diagram: 'derivative', inputs: ['gradient'],
        run: ({ text, params }) => {
          const { f, point, value } = gradientAt(text, params);
          const selected = (parameter(params, 'theta', 30) * Math.PI) / 180;
          const frames = Array.from({ length: 25 }, (_, index) => {
            const theta = selected + (TAU * index) / 24;
            const direction = { x: Math.cos(theta), y: Math.sin(theta) };
            const derivative = directionDerivative(value, theta);
            return makeFrame(
              `θ=${fmt((theta * 180) / Math.PI, 3)}°`, `Dᵤf=fx cosθ+fy sinθ=${fmt(derivative, 6)}`,
              scalarFieldScene(f, point, { x: value.fx, y: value.fy }, direction),
              [{ label: 'Dᵤf', value: fmt(derivative, 6), emphasis: true }, { label: 'cosθ', value: fmt(direction.x, 4) }, { label: 'sinθ', value: fmt(direction.y, 4) }],
            );
          });
          const derivative = directionDerivative(value, selected);
          return makeResult(text, params, frames, { directionDerivative: derivative });
        },
      },
      {
        id: 'scan', title: '方向扫描与最值对照', diagram: 'summary', inputs: ['direction'],
        run: ({ text, params }) => {
          const { point, value } = gradientAt(text, params);
          const rows = Array.from({ length: 13 }, (_, index) => {
            const theta = (TAU * index) / 12;
            return [fmt((theta * 180) / Math.PI, 2), fmt(directionDerivative(value, theta), 6)];
          });
          const derivatives = Array.from({ length: 73 }, (_, index) => directionDerivative(value, (TAU * index) / 72));
          const magnitude = Math.hypot(value.fx, value.fy);
          const maximum = Math.max(...derivatives);
          const minimum = Math.min(...derivatives);
          return makeResult(text, params, [makeFrame(
            '方向导数的余弦曲线', '数值扫描的最大/最小值分别对照 ‖∇f‖ 与 -‖∇f‖，不构成解析证明',
            scalarFieldScene(compile2d(text, params), point, { x: value.fx, y: value.fy }),
            [{ label: '扫描最大值', value: fmt(maximum, 6) }, { label: '‖∇f‖', value: fmt(magnitude, 6) }, { label: '扫描最小值', value: fmt(minimum, 6) }],
            { columns: ['θ（度）', 'Dᵤf'], rows, series: [{ label: 'Dᵤf(θ)', values: derivatives }] },
          )], { maxDirectionDerivative: maximum, minDirectionDerivative: minimum });
        },
      },
    ],
  },

  'lagrange-multiplier': {
    stages: [
      {
        id: 'functions', title: '目标、约束与初值', diagram: 'function', text: 'x*y;x^2+y^2-1', textLabel: 'f(x,y); g(x,y)',
        controls: [
          { key: 'x0', label: 'Newton 初值 x₀', value: 0.8, min: -3, max: 3, step: 0.1 },
          { key: 'y0', label: 'Newton 初值 y₀', value: 0.6, min: -3, max: 3, step: 0.1 },
          { key: 'lambda0', label: '乘子初值 λ₀', value: 0.5, min: -5, max: 5, step: 0.1 },
        ],
        presets: [
          { label: '单位圆正象限', params: { x0: 0.8, y0: 0.6, lambda0: 0.5 }, text: 'x*y;x^2+y^2-1' },
          { label: '单位圆负分支', params: { x0: -0.8, y0: 0.6, lambda0: -0.5 }, text: 'x*y;x^2+y^2-1' },
          { label: '椭圆上的线性目标', params: { x0: 1.5, y0: 0.8, lambda0: 0.4 }, text: 'x+y;x^2+4*y^2-4' },
        ],
        run: ({ text, params }) => {
          const { constraint } = lagrangeExpressions(text);
          const g = compile2d(constraint, params);
          const state: LagrangeState = {
            x: parameter(params, 'x0', 0.8), y: parameter(params, 'y0', 0.6), lambda: parameter(params, 'lambda0', 0.5),
            residual: residualNorm(lagrangeResidual(compile2d(lagrangeExpressions(text).objective, params), g, parameter(params, 'x0', 0.8), parameter(params, 'y0', 0.6), parameter(params, 'lambda0', 0.5))),
            constraint: 0,
          };
          state.constraint = finite2d(g, state.x, state.y);
          return makeResult(text, params, [makeFrame(
            '从初值求解 ∇f=λ∇g 与 g=0', '初值不必满足约束；后续 Newton 帧展示真实迭代路径',
            lagrangeScene(g, state), [{ label: '初始约束 g', value: fmt(state.constraint, 6) }, { label: '初始方程残差', value: fmt(state.residual, 6) }],
          )]);
        },
      },
      {
        id: 'newton', title: '三元 Newton 迭代', diagram: 'contour', inputs: ['functions'],
        run: ({ text, params }) => {
          const { g, history, solution } = solveLagrange(text, params);
          const frames = history.map((state, index) => makeFrame(
            `Newton 第 ${index} 步`, `x=${fmt(state.x, 7)}，y=${fmt(state.y, 7)}，λ=${fmt(state.lambda, 7)}`,
            lagrangeScene(g, state),
            [{ label: '约束 g', value: fmt(state.constraint, 7) }, { label: '方程残差', value: fmt(state.residual, 7), emphasis: true }],
          ));
          return makeResult(text, params, frames, {
            solutionX: solution.x, solutionY: solution.y, lagrangeLambda: solution.lambda,
            lagrangeResidual: solution.residual, iterations: history.length - 1,
          });
        },
      },
      {
        id: 'stationary', title: '约束驻点与乘子', diagram: 'derivative', inputs: ['newton'],
        run: ({ text, params }) => {
          const { objective } = lagrangeExpressions(text);
          const { f, g, solution } = solveLagrange(text, params);
          const objectiveValue = finite2d(f, solution.x, solution.y);
          const df = gradient2d(f, solution.x, solution.y);
          const dg = gradient2d(g, solution.x, solution.y);
          const rows = [
            ['∇f', fmt(df.fx, 7), fmt(df.fy, 7)],
            ['λ∇g', fmt(solution.lambda * dg.fx, 7), fmt(solution.lambda * dg.fy, 7)],
            ['差值', fmt(df.fx - solution.lambda * dg.fx, 7), fmt(df.fy - solution.lambda * dg.fy, 7)],
          ];
          return makeResult(text, params, [makeFrame(
            '约束曲线上的驻点', `目标函数值 ${objective} = ${fmt(objectiveValue, 8)}；局部驻点不自动等同于全局最值`,
            lagrangeScene(g, solution),
            [{ label: 'f(x*,y*)', value: fmt(objectiveValue, 8), emphasis: true }, { label: 'λ*', value: fmt(solution.lambda, 8) }, { label: 'g(x*,y*)', value: fmt(solution.constraint, 8) }],
            { columns: ['向量', 'x 分量', 'y 分量'], rows, highlightRows: [2] },
          )], {
            solutionX: solution.x, solutionY: solution.y, lagrangeLambda: solution.lambda,
            lagrangeResidual: solution.residual, objectiveValue,
          });
        },
      },
      {
        id: 'verify', title: 'KKT 残差复算', diagram: 'summary', inputs: ['stationary'],
        run: ({ text, params }) => {
          const { objective, constraint } = lagrangeExpressions(text);
          const f = compile2d(objective, params);
          const g = compile2d(constraint, params);
          const { solution } = solveLagrange(text, params);
          const df = gradient2d(f, solution.x, solution.y);
          const dg = gradient2d(g, solution.x, solution.y);
          const residuals = [df.fx - solution.lambda * dg.fx, df.fy - solution.lambda * dg.fy, finite2d(g, solution.x, solution.y)];
          return makeResult(text, params, [makeFrame(
            '三项方程独立复算', '数值残差用于检查驻点方程；它不提供全局最优性或二阶充分条件的证明',
            lagrangeScene(g, solution),
            [{ label: '最大绝对残差', value: fmt(Math.max(...residuals.map(Math.abs)), 8), emphasis: true }],
            {
              columns: ['方程', '数值残差'],
              rows: [['fₓ-λgₓ', fmt(residuals[0]!, 8)], ['fᵧ-λgᵧ', fmt(residuals[1]!, 8)], ['g(x,y)', fmt(residuals[2]!, 8)]],
            },
          )], { kktResidual: Math.max(...residuals.map(Math.abs)) });
        },
      },
    ],
  },

  'double-green': {
    stages: [
      {
        id: 'region', title: '极坐标区域与向量场', diagram: 'integral', text: 'x^2+y^2;-y;x', textLabel: 'f(x,y); P(x,y); Q(x,y)',
        controls: [
          { key: 'theta0', label: 'θ 下界（弧度）', value: 0, min: -Math.PI, max: Math.PI, step: Math.PI / 12 },
          { key: 'theta1', label: 'θ 上界（弧度）', value: TAU, min: 0, max: TAU, step: Math.PI / 12 },
          { key: 'radius', label: '外半径 R', value: 2, min: 0.2, max: 3, step: 0.2 },
          { key: 'n', label: '每维中点数', value: 24, min: 4, max: 60, step: 2 },
        ],
        presets: [
          { label: '圆盘旋转场', params: { theta0: 0, theta1: TAU, radius: 2, n: 24 }, text: 'x^2+y^2;-y;x' },
          { label: '半圆保守场', params: { theta0: 0, theta1: Math.PI, radius: 2, n: 28 }, text: '1;x;y' },
          { label: '四分之一圆', params: { theta0: 0, theta1: Math.PI / 2, radius: 1.5, n: 28 }, text: 'x+y;-y;x' },
        ],
        run: ({ text, params }) => {
          const settings = polarSettings(params);
          const { p, q } = doubleGreenExpressions(text);
          const field = { p: compile2d(p, params), q: compile2d(q, params) };
          return makeResult(text, params, [makeFrame(
            '真实 θ、r bounds 与面积元', '区域边界、极坐标积分和 Green 对照共享同一组 θ₀、θ₁、R',
            sectorScene(settings, field),
            [{ label: 'Jacobian', value: 'r', emphasis: true }, { label: 'θ 区间', value: `${fmt(settings.theta0, 4)} … ${fmt(settings.theta1, 4)}` }, { label: 'r 区间', value: `0 … ${fmt(settings.radius, 4)}` }],
          )]);
        },
      },
      {
        id: 'polar', title: '极坐标二重积分', diagram: 'integral', inputs: ['region'],
        run: ({ text, params }) => {
          const settings = polarSettings(params);
          const frames = Array.from({ length: 12 }, (_, index) => {
            const upper = settings.theta0 + ((settings.theta1 - settings.theta0) * (index + 1)) / 12;
            const sample = computePolarIntegral(text, params, upper);
            return makeFrame(
              `积分上限 θ=${fmt(upper, 5)}`, `二维中点和累计到当前极角：${fmt(sample.approx, 8)}`,
              sectorScene({ ...settings, theta1: upper }),
              [{ label: '累计积分', value: fmt(sample.approx, 8), emphasis: true }, { label: '面积元', value: 'r dr dθ' }],
            );
          });
          const full = computePolarIntegral(text, params);
          const refined = polarSandbox(
            polarIntegrand(doubleGreenExpressions(text).integrand), Math.min(80, settings.n * 2), undefined,
            { theta0: settings.theta0, theta1: settings.theta1, rMax: settings.radius },
          ).approx;
          const last = frames[frames.length - 1]!;
          last.rows = [['n', settings.n, fmt(full.approx, 8)], ['2n（上限 80）', Math.min(80, settings.n * 2), fmt(refined, 8)]];
          last.columns = ['分割', '每维采样', '积分近似'];
          last.summary += `；细化对照 |I₂ₙ-Iₙ|=${fmt(Math.abs(refined - full.approx), 8)}`;
          return makeResult(text, params, frames, {
            doubleIntegral: full.approx, refinedDoubleIntegral: refined,
            polarRefinementDifference: Math.abs(refined - full.approx), jacobianWeight: 1,
          });
        },
      },
      {
        id: 'circulation', title: '正向边界环量', diagram: 'field', inputs: ['region'],
        run: ({ text, params }) => {
          const settings = polarSettings(params);
          const { p, q } = doubleGreenExpressions(text);
          const field = { p: compile2d(p, params), q: compile2d(q, params) };
          const circulation = circulationGreen(text, params);
          const fullCircle = Math.abs(settings.theta1 - settings.theta0 - TAU) < 1e-7;
          return makeResult(text, params, [makeFrame(
            '∮Pdx+Qdy 的 Simpson 复算', fullCircle ? '完整圆盘只取逆时针外圆；径向缝不重复计入' : '扇形边界包含出发径向边、逆向外弧和返回径向边',
            sectorScene(settings, field),
            [{ label: '边界环量', value: fmt(circulation, 8), emphasis: true }, { label: '方向', value: '正向 / 逆时针' }],
          )], { circulation });
        },
      },
      {
        id: 'green', title: 'Green 定理对照', diagram: 'summary', inputs: ['polar', 'circulation'],
        run: ({ text, params }) => {
          const settings = polarSettings(params);
          const circulation = params.circulation ?? circulationGreen(text, params);
          const curlIntegral = curlIntegralGreen(text, params);
          const residual = circulation - curlIntegral;
          const doubleIntegral = params.doubleIntegral ?? computePolarIntegral(text, params).approx;
          return makeResult(text, params, [makeFrame(
            '环量 = 旋度的二重积分', '两侧独立数值计算并列展示；残差是数值证据，不被当作解析恒等式证明',
            sectorScene(settings),
            [{ label: '边界环量', value: fmt(circulation, 8) }, { label: '∬(Qₓ-Pᵧ)dA', value: fmt(curlIntegral, 8) }, { label: 'Green 残差', value: fmt(residual, 8), emphasis: true }],
            {
              columns: ['计算项', '数值', '方法'],
              rows: [
                ['f 的极坐标二重积分', fmt(doubleIntegral, 8), 'r dr dθ 中点和'],
                ['边界环量', fmt(circulation, 8), '分段 Simpson'],
                ['旋度面积分', fmt(curlIntegral, 8), '差分旋度 + r 加权中点和'],
                ['环量 − 旋度积分', fmt(residual, 8), '独立结果之差'],
              ],
              highlightRows: [3],
            },
          )], { doubleIntegral, circulation, curlIntegral, greenResidual: residual });
        },
      },
    ],
  },

  'basis-change': {
    stages: [
      {
        id: 'basis', title: '基矩阵与原向量', diagram: 'matrix', text: '1,1;0,1 | 2,1', textLabel: 'B=a,b;c,d | v=x,y',
        controls: [{ key: 'steps', label: '分解动画步数', value: 12, min: 4, max: 30, step: 1 }],
        presets: [
          { label: '剪切基', params: { steps: 12 }, text: '1,1;0,1 | 2,1' },
          { label: '正交基', params: { steps: 8 }, text: '1,0;0,1 | 2,1' },
          { label: '缩放旋转基', params: { steps: 16 }, text: '0,-2;1,0 | 2,1' },
        ],
        run: ({ text, params }) => {
          const model = basisCoordinates(text);
          return makeResult(text, params, [makeFrame(
            'B 的列向量张成斜坐标系', `det(B)=${fmt(model.determinant, 6)}；非零行列式保证坐标表示唯一`,
            basisScene(text), [{ label: 'det(B)', value: fmt(model.determinant, 6), emphasis: true }],
            { columns: ['B', '第一列', '第二列'], rows: matrixTable(model.matrix, '') },
          )], { determinantB: model.determinant });
        },
      },
      {
        id: 'coordinates', title: '求 B 坐标', diagram: 'matrix', inputs: ['basis'],
        run: ({ text, params }) => {
          const model = basisCoordinates(text);
          return makeResult(text, params, [makeFrame(
            '[v]B=B⁻¹v', `v=(${fmt(model.coordinates.x, 6)})b₁+(${fmt(model.coordinates.y, 6)})b₂`,
            basisScene(text, true),
            [{ label: '[v]B 第一分量', value: fmt(model.coordinates.x, 6) }, { label: '[v]B 第二分量', value: fmt(model.coordinates.y, 6), emphasis: true }],
            {
              columns: ['坐标系', '第一分量', '第二分量'],
              rows: [['标准坐标 [v]E', fmt(model.vector.x, 6), fmt(model.vector.y, 6)], ['B 坐标 [v]B', fmt(model.coordinates.x, 6), fmt(model.coordinates.y, 6)]],
            },
          )], { basisU: model.coordinates.x, basisV: model.coordinates.y, determinantB: model.determinant });
        },
      },
      {
        id: 'reconstruct', title: '由坐标重构原向量', diagram: 'motion', inputs: ['coordinates'],
        run: ({ text, params }) => {
          const model = basisCoordinates(text);
          const steps = integerParameter(params, 'steps', 12, 4, 30);
          const first = {
            x: model.matrix.a * model.coordinates.x,
            y: model.matrix.c * model.coordinates.x,
          };
          const second = {
            x: model.matrix.b * model.coordinates.y,
            y: model.matrix.d * model.coordinates.y,
          };
          const frames = Array.from({ length: steps + 1 }, (_, index) => {
            const t = index / steps;
            const current = { x: first.x + t * second.x, y: first.y + t * second.y };
            const scale = 34;
            const scene: ScienceScene = {
              ariaLabel: '基向量分量逐步合成', grid: true, axes: true,
              vectors: [
                plotVector({ x: 0, y: 0 }, first, scale, '#2563eb', 'u b₁'),
                plotVector(first, { x: t * second.x, y: t * second.y }, scale, '#8b5cf6', 't·v b₂'),
                plotVector({ x: 0, y: 0 }, current, scale, '#dc2626', '当前和'),
              ],
            };
            return makeFrame(`分量合成 ${fmt(t * 100, 1)}%`, `u b₁+t·v b₂=(${fmt(current.x, 6)}, ${fmt(current.y, 6)})`, scene);
          });
          const error = Math.hypot(model.reconstructed.x - model.vector.x, model.reconstructed.y - model.vector.y);
          return makeResult(text, params, frames, {
            basisU: model.coordinates.x, basisV: model.coordinates.y,
            reconstructedX: model.reconstructed.x, reconstructedY: model.reconstructed.y, reconstructionError: error,
          });
        },
      },
      {
        id: 'compare', title: '双坐标系与逆矩阵对照', diagram: 'summary', inputs: ['reconstruct'],
        run: ({ text, params }) => {
          const model = basisCoordinates(text);
          const inverse = {
            a: model.matrix.d / model.determinant,
            b: -model.matrix.b / model.determinant,
            c: -model.matrix.c / model.determinant,
            d: model.matrix.a / model.determinant,
          };
          const error = Math.hypot(model.reconstructed.x - model.vector.x, model.reconstructed.y - model.vector.y);
          return makeResult(text, params, [makeFrame(
            'B[v]B=v 与 B⁻¹v=[v]B', '两组网格表示同一向量；坐标数值随基改变，几何向量不变',
            basisScene(text, true), [{ label: '重构误差', value: fmt(error, 8), emphasis: true }],
            {
              columns: ['矩阵 / 向量', '第一列', '第二列'],
              rows: [
                ...matrixTable(model.matrix, 'B'), ...matrixTable(inverse, 'B⁻¹'),
                ['[v]E', fmt(model.vector.x, 6), fmt(model.vector.y, 6)],
                ['[v]B', fmt(model.coordinates.x, 6), fmt(model.coordinates.y, 6)],
              ],
            },
          )], { reconstructionError: error });
        },
      },
    ],
  },

  'eigen-transform': {
    stages: [
      {
        id: 'matrix', title: '矩阵与初始向量', diagram: 'matrix', text: '2,1;1,2 | 1,0', textLabel: 'A=a,b;c,d | v=x,y',
        controls: [{ key: 'steps', label: '重复变换步数', value: 6, min: 1, max: 12, step: 1 }],
        presets: [
          { label: '对称拉伸', params: { steps: 6 }, text: '2,1;1,2 | 1,0' },
          { label: '剪切矩阵', params: { steps: 5 }, text: '1,1;0,1 | 0,1' },
          { label: '旋转（无实方向）', params: { steps: 4 }, text: '0,-1;1,0 | 1,0' },
        ],
        run: ({ text, params }) => {
          const { matrix, vector } = parseMatrixAndVector(text);
          const info = eigen(matrix);
          const metrics = info.real
            ? [{ label: 'λ₁', value: fmt(info.l1, 6) }, { label: 'λ₂', value: fmt(info.l2, 6) }]
            : [{ label: '复特征值', value: `${fmt(info.l1, 5)} ± ${fmt(info.imag, 5)}i`, emphasis: true }];
          return makeResult(text, params, [makeFrame(
            '线性变换作用在初始向量上', info.real ? '判别式非负，可继续求实特征方向' : '无实特征向量；旋转使向量方向持续改变，后续方向环节会明确拒绝伪造实解',
            matrixScene(matrix, 'A', `v=(${fmt(vector.x, 4)}, ${fmt(vector.y, 4)})`), metrics,
            { columns: ['A', '第一列', '第二列'], rows: matrixTable(matrix, '') },
          )], { lambda1: info.l1, lambda2: info.l2, eigenImaginary: info.imag });
        },
      },
      {
        id: 'spectrum', title: '特征方程与谱', diagram: 'matrix', inputs: ['matrix'],
        run: ({ text, params }) => {
          const matrix = parseMatrix(text);
          const info = eigen(matrix);
          const trace = matrix.a + matrix.d;
          const determinant = det(matrix);
          return makeResult(text, params, [makeFrame(
            'λ²-tr(A)λ+det(A)=0', info.real ? `判别式 ${fmt(info.disc, 6)}≥0，得到两个实特征值（可相同）` : `判别式 ${fmt(info.disc, 6)}<0：无实特征值，因而无实特征向量`,
            matrixScene(matrix, 'A', `tr=${fmt(trace, 5)}，det=${fmt(determinant, 5)}，Δ=${fmt(info.disc, 5)}`),
            [{ label: 'Δ', value: fmt(info.disc, 6), emphasis: true }, { label: '实谱', value: info.real ? '存在' : '不存在' }],
            {
              columns: ['特征值', '实部', '虚部'],
              rows: [['λ₁', fmt(info.l1, 6), fmt(info.imag, 6)], ['λ₂', fmt(info.l2, 6), fmt(-info.imag, 6)]],
            },
          )], { lambda1: info.l1, lambda2: info.l2, eigenImaginary: info.imag, eigenDiscriminant: info.disc });
        },
      },
      {
        id: 'directions', title: '实特征方向', diagram: 'field', inputs: ['spectrum'],
        run: ({ text, params }) => {
          const { matrix, vector } = parseMatrixAndVector(text);
          const directions = eigenDirections(matrix);
          return makeResult(text, params, [makeFrame(
            directions.length === 2 ? '两个独立实特征方向' : '仅一个独立实特征方向',
            directions.length === 2 ? '每个方向均复算 Av=λv；反向延长线表示整条不变直线' : '重复特征值不保证有两个独立特征向量；本例按实际秩只列出一个方向',
            eigenScene(matrix, vector, directions),
            directions.map((direction, index) => ({ label: `‖Av${index + 1}-λ${index + 1}v${index + 1}‖`, value: fmt(direction.residual, 8) })),
            {
              columns: ['λ', '单位特征向量 x', '单位特征向量 y', '残差'],
              rows: directions.map((direction) => [fmt(direction.lambda, 6), fmt(direction.vector.x, 6), fmt(direction.vector.y, 6), fmt(direction.residual, 8)]),
            },
          )], {
            eigenDirectionCount: directions.length,
            eigenvector1x: directions[0]!.vector.x, eigenvector1y: directions[0]!.vector.y,
            eigenResidual1: directions[0]!.residual,
          });
        },
      },
      {
        id: 'transform', title: '重复变换与方向对照', diagram: 'summary', inputs: ['directions'],
        run: ({ text, params }) => {
          const { matrix, vector } = parseMatrixAndVector(text);
          const directions = eigenDirections(matrix);
          const steps = integerParameter(params, 'steps', 6, 1, 12);
          const trajectory = [vector];
          for (let index = 0; index < steps; index += 1) {
            const next = matrixVector(matrix, trajectory[trajectory.length - 1]!);
            if (![next.x, next.y].every(Number.isFinite)) throw new Error('重复矩阵变换超出有限数范围，请减少步数');
            trajectory.push(next);
          }
          const maximum = Math.max(1, ...trajectory.flatMap((point) => [Math.abs(point.x), Math.abs(point.y)]));
          const scale = 72 / maximum;
          const frames = trajectory.map((current, index) => {
            const scene = eigenScene(matrix, current, directions, scale);
            scene.paths = [{ points: trajectory.slice(0, index + 1).map((point) => plotPoint(point.x, point.y, scale)), stroke: '#059669' }];
            scene.points = trajectory.slice(0, index + 1).map((point) => {
              const plotted = plotPoint(point.x, point.y, scale);
              return { x: plotted[0], y: plotted[1], radius: 3, color: '#059669' };
            });
            return makeFrame(
              `A^${index}v`, `当前向量 (${fmt(current.x, 6)}, ${fmt(current.y, 6)})；场景只统一缩放，读数保持原值`,
              scene,
              [{ label: '步数 k', value: String(index) }, { label: '向量模', value: fmt(Math.hypot(current.x, current.y), 6), emphasis: true }],
              { columns: ['k', 'x', 'y'], rows: trajectory.map((point, k) => [k, fmt(point.x, 6), fmt(point.y, 6)]), highlightRows: [index] },
            );
          });
          const last = trajectory[trajectory.length - 1]!;
          return makeResult(text, params, frames, {
            transformedX: last.x, transformedY: last.y,
            eigenvector1x: directions[0]!.vector.x, eigenvector1y: directions[0]!.vector.y,
          });
        },
      },
    ],
  },

  'svd-steps': {
    stages: [
      {
        id: 'matrix', title: '输入矩阵与低秩阶数', diagram: 'svd', text: '4,0;3,-2', textLabel: 'A=a,b;c,d',
        controls: [{ key: 'rank', label: '低秩保留项数', value: 1, options: [{ value: 1, label: 'rank 1' }, { value: 2, label: 'rank 2' }] }],
        presets: [
          { label: '一般满秩矩阵', params: { rank: 1 }, text: '4,0;3,-2' },
          { label: '秩一矩阵', params: { rank: 1 }, text: '1,2;2,4' },
          { label: '对角缩放', params: { rank: 2 }, text: '3,0;0,1' },
        ],
        run: ({ text, params }) => {
          const matrix = parseMatrix(text);
          const svd = computeSvd(matrix);
          const rank = integerParameter(params, 'rank', 1, 1, 2);
          return makeResult(text, params, [makeFrame(
            '把 A 分解为旋转/反射、缩放、旋转/反射', `AᵀA 的两个特征值给出 σ₁=${fmt(svd.sigma1, 6)}、σ₂=${fmt(svd.sigma2, 6)}`,
            matrixScene(matrix, 'A', `rank 目标=${rank}`),
            [{ label: 'σ₁', value: fmt(svd.sigma1, 6), emphasis: true }, { label: 'σ₂', value: fmt(svd.sigma2, 6) }],
            { columns: ['A', '第一列', '第二列'], rows: matrixTable(matrix, '') },
          )], svdComputed(matrix, svd, rank));
        },
      },
      {
        id: 'factor', title: 'SVD 三步分解', diagram: 'svd', inputs: ['matrix'],
        run: ({ text, params }) => {
          const { frames, computed } = svdFrames(text, params);
          return makeResult(text, params, frames, computed);
        },
      },
      {
        id: 'reconstruct', title: 'UΣVᵀ 完整复原', diagram: 'svd', inputs: ['factor'],
        run: ({ text, params }) => {
          const matrix = parseMatrix(text);
          const svd = computeSvd(matrix);
          const { frames, computed } = svdFrames(text, { ...params, rank: 2 });
          const restored = matrixProduct(matrixProduct(svd.u, svd.sigma), svd.vt);
          frames[1]!.rows = [
            ...matrixTable(svd.u, 'U'), ...matrixTable(svd.sigma, 'Σ'), ...matrixTable(svd.vt, 'Vᵀ'),
            ...matrixTable(restored, 'UΣVᵀ'), ...matrixTable(matrix, '原 A'),
          ];
          frames[1]!.highlightRows = [6, 7, 8, 9];
          return makeResult(text, params, frames, { ...computed, ...svdComputed(matrix, svd, integerParameter(params, 'rank', 1, 1, 2)) });
        },
      },
      {
        id: 'low-rank', title: '低秩近似与误差复算', diagram: 'summary', inputs: ['reconstruct'],
        run: ({ text, params }) => {
          const matrix = parseMatrix(text);
          const svd = computeSvd(matrix);
          const rank = integerParameter(params, 'rank', 1, 1, 2);
          const approximation = lowRankMatrix(svd, rank);
          const error = frobeniusDifference(matrix, approximation);
          const { frames, computed } = svdFrames(text, params);
          frames[2]!.summary = rank === 1
            ? `A₁=σ₁u₁v₁ᵀ；实测误差 ${fmt(error, 8)}，理论误差 σ₂=${fmt(svd.sigma2, 8)}`
            : `A₂=σ₁u₁v₁ᵀ+σ₂u₂v₂ᵀ；实测误差 ${fmt(error, 8)}`;
          return makeResult(text, params, frames, computed);
        },
      },
    ],
  },
};