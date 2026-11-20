import { compileExpression } from './expr.ts';

export type BoundaryKind = 'affine' | 'quadratic' | 'sqrt' | 'sinusoid';

export interface BoundaryCurve {
  kind: BoundaryKind;
  source: string;
  /** 在 a、(a+b)/2、b 三处采样得到的值。 */
  samples: [number, number, number];
  /** 可拖拽控制点对应的采样下标；线性曲线只开放两个端点。 */
  handles: (0 | 1 | 2)[];
  /** sqrt 曲线族的平移量 a₀（y = c·sqrt(x-a₀)+d）。 */
  base?: number;
}

const TOLERANCE = 1e-7;

function clean(value: number, digits = 6): string {
  const rounded = Number(value.toFixed(digits));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** 小数系数改成有理数写法（1.5 → 3/2），避免符号内核把浮点系数当成病态输入。 */
function rational(value: number, maxDenominator = 1000): string {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-12) return '0';
  for (let denominator = 1; denominator <= maxDenominator; denominator += 1) {
    const numerator = Math.round(value * denominator);
    if (Math.abs(value - numerator / denominator) <= 1e-9) {
      const sign = numerator < 0 ? '-' : '';
      const absolute = Math.abs(numerator);
      return denominator === 1 ? `${sign}${absolute}` : `${sign}${absolute}/${denominator}`;
    }
  }
  return clean(value);
}

function formatPolynomial(variable: string, quadratic: number, linear: number, constant: number): string {
  let source = '';
  const push = (coefficient: number, body: (absolute: number) => string): void => {
    if (Math.abs(coefficient) < 1e-12) return;
    const absolute = Math.abs(coefficient);
    source += source ? (coefficient < 0 ? ' - ' : ' + ') : (coefficient < 0 ? '-' : '');
    source += body(absolute);
  };
  push(quadratic, (value) => `${rational(value)}*${variable}^2`);
  push(linear, (value) => `${rational(value)}*${variable}`);
  push(constant, (value) => rational(value));
  return source || '0';
}

/**
 * 只接受可判定族的边界：线性/二次/根式/正弦族（A·cos+B·sin+C，覆盖 r=a·cosθ 圆）。
 * 任意像素曲线反推初等函数是病态问题，对无法解释的边界明确返回 null。
 */
export function analyzeBoundary(
  source: string,
  variable: string,
  a: number,
  b: number,
): BoundaryCurve | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !(a < b)) return null;
  let compiled;
  try {
    compiled = compileExpression(source, [variable]);
  } catch {
    return null;
  }
  const span = b - a;
  const points = [a, a + span / 4, a + span / 2, a + span * 0.75, b];
  const values = points.map((point) => compiled.evalOrNull({ [variable]: point }));
  if (values.some((value) => value === null || !Number.isFinite(value))) return null;
  const v0 = values[0]!;
  const v1 = values[1]!;
  const vm = values[2]!;
  const v3 = values[3]!;
  const v4 = values[4]!;
  const scale = Math.max(1, Math.abs(v0), Math.abs(vm), Math.abs(v4));
  const tolerance = TOLERANCE * scale;

  const slope = (v4 - v0) / span;
  const intercept = v0 - slope * a;
  const line = (point: number): number => slope * point + intercept;
  if ([v1, vm, v3].every((value, index) => Math.abs(value - line(points[index + 1]!)) <= tolerance)) {
    return {
      kind: 'affine',
      source,
      samples: [v0, vm, v4],
      handles: [0, 2],
    };
  }

  const half = span / 2;
  const quadratic = (v0 + v4 - 2 * vm) / (2 * half * half);
  const linear = (v4 - v0) / (2 * half);
  const predict = (point: number): number => {
    const offset = point - (a + half);
    return quadratic * offset * offset + linear * offset + vm;
  };
  if ([v1, v3].every((value, index) => Math.abs(value - predict(points[index === 0 ? 1 : 3]!)) <= tolerance)) {
    return {
      kind: 'quadratic',
      source,
      samples: [v0, vm, v4],
      handles: [0, 1, 2],
    };
  }

  // 正弦族 r = A·cos + B·sin + C：极坐标圆的 r=a·cosθ、心形线族都可由它解释。
  const sinusoid = solveSinusoid(a, (a + b) / 2, b, v0, vm, v4);
  if (sinusoid) {
    const [A, B, C] = sinusoid;
    const wave = (point: number): number => A * Math.cos(point) + B * Math.sin(point) + C;
    if ([v1, v3].every((value, index) => Math.abs(value - wave(points[index === 0 ? 1 : 3]!)) <= tolerance)) {
      return {
        kind: 'sinusoid',
        source,
        samples: [v0, vm, v4],
        handles: [0, 1, 2],
      };
    }
  }

  // 根式边界 y = c·sqrt(x-a₀)+d：招牌题 D={y²≤x, x²≤y} 的上边界就是 sqrt(x)。
  const baseMatch = new RegExp(`sqrt\\s*\\(\\s*${variable}\\s*(?:-\\s*([+-]?\\d+(?:\\.\\d+)?))?\\s*\\)`).exec(source);
  const base = baseMatch?.[1] !== undefined ? Number(baseMatch[1]) : 0;
  if (Number.isFinite(base) && a >= base - 1e-12) {
    const denominator = Math.sqrt(b - base) - Math.sqrt(a - base);
    if (Math.abs(denominator) > 1e-9) {
      const scale = (v4 - v0) / denominator;
      const offset = v0 - scale * Math.sqrt(a - base);
      const root = (point: number): number => scale * Math.sqrt(point - base) + offset;
      if ([v1, vm, v3].every((value, index) => Math.abs(value - root(points[index + 1]!)) <= tolerance)) {
        return {
          kind: 'sqrt',
          source,
          samples: [v0, vm, v4],
          handles: [2],
          base,
        };
      }
    }
  }
  return null;
}

/** 解 r = A·cos t + B·sin t + C 过三点的 3×3 系统；奇异时返回 null。 */
function solveSinusoid(t0: number, t1: number, t2: number, v0: number, v1: number, v2: number): [number, number, number] | null {
  const rows = [t0, t1, t2].map((t) => [Math.cos(t), Math.sin(t), 1]);
  const rhs = [v0, v1, v2];
  const det =
    rows[0]![0]! * (rows[1]![1]! * rows[2]![2]! - rows[1]![2]! * rows[2]![1]!) -
    rows[0]![1]! * (rows[1]![0]! * rows[2]![2]! - rows[1]![2]! * rows[2]![0]!) +
    rows[0]![2]! * (rows[1]![0]! * rows[2]![1]! - rows[1]![1]! * rows[2]![0]!);
  if (Math.abs(det) < 1e-12) return null;
  // Cramer 法则：替换第 col 列为 rhs 后的行列式 / det。
  const replaceDet = (col: number): number => {
    const m = rows.map((row, ri) => row.map((value, ci) => (ci === col ? rhs[ri]! : value)));
    return (
      m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
      m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
      m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!)
    );
  };
  return [replaceDet(0) / det, replaceDet(1) / det, replaceDet(2) / det];
}

/** 用三个采样值重建边界表达式；调用方保证采样下标顺序为 a、中点、b。 */
export function buildBoundarySource(
  kind: BoundaryKind,
  variable: string,
  a: number,
  b: number,
  values: [number, number, number],
  base = 0,
): string {
  const span = b - a;
  const [v0, vm, v4] = values;
  if (kind === 'sinusoid') {
    const solved = solveSinusoid(a, (a + b) / 2, b, v0, vm, v4);
    if (!solved) return rational(v0);
    const [A, B, C] = solved;
    let source = '';
    const push = (coefficient: number, symbol: string): void => {
      if (Math.abs(coefficient) < 1e-10) return;
      const absolute = Math.abs(coefficient);
      const body = symbol ? (absolute === 1 ? symbol : `${rational(absolute)}*${symbol}`) : rational(absolute);
      source += source ? (coefficient < 0 ? ' - ' : ' + ') + body : (coefficient < 0 ? '-' : '') + body;
    };
    push(A, `cos(${variable})`);
    push(B, `sin(${variable})`);
    push(C, '');
    return source || '0';
  }
  if (kind === 'sqrt') {
    if (!Number.isFinite(base) || a < base - 1e-12) return '0';
    const denominator = Math.sqrt(b - base) - Math.sqrt(a - base);
    if (Math.abs(denominator) < 1e-12) return rational(v4);
    const scale = (v4 - v0) / denominator;
    const offset = v0 - scale * Math.sqrt(a - base);
    const shift = base === 0 ? '' : base > 0 ? ` - ${clean(base)}` : ` + ${clean(-base)}`;
    const root = `sqrt(${variable}${shift})`;
    let source = '';
    if (Math.abs(scale) >= 1e-12) {
      const magnitude = Math.abs(scale);
      source += `${scale < 0 ? '-' : ''}${magnitude === 1 ? root : `${rational(magnitude)}*${root}`}`;
    }
    if (Math.abs(offset) >= 1e-12) {
      source += source ? (offset < 0 ? ' - ' : ' + ') + rational(Math.abs(offset)) : `${offset < 0 ? '-' : ''}${rational(Math.abs(offset))}`;
    }
    return source || '0';
  }
  if (kind === 'affine') {
    const slope = (v4 - v0) / span;
    const intercept = v0 - slope * a;
    return formatPolynomial(variable, 0, slope, intercept);
  }
  const half = span / 2;
  const middle = a + half;
  const quadratic = (v0 + v4 - 2 * vm) / (2 * half * half);
  const offsetLinear = (v4 - v0) / (2 * half);
  const linear = offsetLinear - 2 * quadratic * middle;
  const constant = quadratic * middle * middle - offsetLinear * middle + vm;
  return formatPolynomial(variable, quadratic, linear, constant);
}
