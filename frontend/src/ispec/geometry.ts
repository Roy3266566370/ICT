/**
 * geometry.ts —— 几何视图（figure）用到的 2×2 线性变换数学（纯函数）。
 *
 * 约定（与 `regions/detArea` 一致，避免两套真相）：
 *  - 矩阵 A = [[a, b], [c, d]]，列向量分别是 A·e1 = (a, c)、A·e2 = (b, d)；
 *  - det = ad − bc，几何上等于两列围成的有向面积倍率；
 *  - 参数缺失时按单位矩阵兜底，并把缺失字段回传给调用方用于显示说明（不静默伪造）。
 */
import type { Vec2 } from './chart';
import type { SpecCell } from './format';

export interface Matrix2 {
  a: number;
  b: number;
  c: number;
  d: number;
}

export const IDENTITY_MATRIX: Matrix2 = { a: 1, b: 0, c: 0, d: 1 };

const MATRIX_FIELDS = ['a', 'b', 'c', 'd'] as const;
type MatrixField = (typeof MATRIX_FIELDS)[number];

/**
 * 矩阵分量的参数别名。
 *
 * iSpec 迁移保留原文的矩阵索引（`a11..a22`，行优先），而几何模板沿用
 * `a / b / c / d`（列优先命名）。这里只做**读取别名**，不改变参数契约：
 * `A = [[a, b], [c, d]] = [[a11, a12], [a21, a22]]`。
 */
const MATRIX_FIELD_ALIASES: Readonly<Record<MatrixField, readonly string[]>> = {
  a: ['a', 'a11'],
  b: ['b', 'a12'],
  c: ['c', 'a21'],
  d: ['d', 'a22'],
};

function readMatrixField(scope: Record<string, SpecCell>, field: MatrixField): number | null {
  for (const id of MATRIX_FIELD_ALIASES[field]) {
    const value = readNumber(scope, id);
    if (value !== null) return value;
  }
  return null;
}

/** 从取值作用域里读一个有限数值；文本必须是可解析数字。 */
export function readNumber(scope: Record<string, SpecCell>, id: string): number | null {
  const value = scope[id];
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 返回缺失的矩阵字段（用于「按单位矩阵绘制」的提示）。 */
export function missingMatrixFields(scope: Record<string, SpecCell>): string[] {
  return MATRIX_FIELDS.filter((field) => readMatrixField(scope, field) === null);
}

/** 读 2×2 矩阵；缺失字段按单位矩阵对应分量补齐，保证几何永远可画。 */
export function matrixFromScope(scope: Record<string, SpecCell>): Matrix2 {
  return {
    a: readMatrixField(scope, 'a') ?? IDENTITY_MATRIX.a,
    b: readMatrixField(scope, 'b') ?? IDENTITY_MATRIX.b,
    c: readMatrixField(scope, 'c') ?? IDENTITY_MATRIX.c,
    d: readMatrixField(scope, 'd') ?? IDENTITY_MATRIX.d,
  };
}

/** A·v */
export function applyMatrix(matrix: Matrix2, point: Vec2): Vec2 {
  return [matrix.a * point[0] + matrix.b * point[1], matrix.c * point[0] + matrix.d * point[1]];
}

/** 有向面积倍率 det(A)。 */
export function determinant(matrix: Matrix2): number {
  return matrix.a * matrix.d - matrix.b * matrix.c;
}

/** 两列的模长，用于给椭圆补一句尺寸说明。 */
export function columnLengths(matrix: Matrix2): { first: number; second: number } {
  return {
    first: Math.hypot(matrix.a, matrix.c),
    second: Math.hypot(matrix.b, matrix.d),
  };
}

/** 单位圆经 A 变换后的像（按角度采样，闭合曲线）。 */
export function ellipsePoints(matrix: Matrix2, segments = 96): Vec2[] {
  const safeSegments = Math.max(8, Math.floor(segments));
  const points: Vec2[] = [];
  for (let index = 0; index < safeSegments; index += 1) {
    const angle = (index / safeSegments) * Math.PI * 2;
    const unit: Vec2 = [Math.cos(angle), Math.sin(angle)];
    points.push(applyMatrix(matrix, unit));
  }
  return points;
}

/** 单位网格（[min, max) 的每个单元格）经 A 变换后的四边形列表。 */
export function transformedGridCells(matrix: Matrix2, min: number, max: number): Vec2[][] {
  const cells: Vec2[][] = [];
  for (let i = min; i < max; i += 1) {
    for (let j = min; j < max; j += 1) {
      cells.push([
        applyMatrix(matrix, [i, j]),
        applyMatrix(matrix, [i + 1, j]),
        applyMatrix(matrix, [i + 1, j + 1]),
        applyMatrix(matrix, [i, j + 1]),
      ]);
    }
  }
  return cells;
}

/** 判定一个值是否约等于目标（用于判断"未偏离默认值"）。 */
export function approximately(value: number, target: number, epsilon = 1e-9): boolean {
  return Math.abs(value - target) <= epsilon;
}
/* -------------------------------------------------------------------------- */
/* 特征方向 / 固定向量 / 向量列表                                              */
/* -------------------------------------------------------------------------- */

/**
 * 方向归一：除以最大分量，并把首个非零分量取正。
 * 整数矩阵的特征向量因此得到 (1,1) / (1,-1) 这类可读坐标，而不是 0.707…。
 */
export function normalizeDirection(vector: Vec2): Vec2 | null {
  const scale = Math.max(Math.abs(vector[0]), Math.abs(vector[1]));
  if (!Number.isFinite(scale) || scale < 1e-12) return null;
  let x = vector[0] / scale;
  let y = vector[1] / scale;
  const firstNonZero = Math.abs(x) > 1e-12 ? x : y;
  if (firstNonZero < 0) {
    x = -x;
    y = -y;
  }
  return [x, y];
}

/** 两个方向是否平行（同向或反向）——用于特征向量去重。 */
export function sameDirection(first: Vec2, second: Vec2): boolean {
  return Math.abs(first[0] * second[1] - first[1] * second[0]) <= 1e-9;
}

export interface EigenPair {
  lambda: number;
  direction: Vec2;
}

/**
 * 2×2 实矩阵的实特征对（方向归一化、去重）。
 * 判别式 < 0（旋转类）或退化时返回空数组，调用方自行回退。
 */
export function realEigenpairs(matrix: Matrix2): EigenPair[] {
  const trace = matrix.a + matrix.d;
  const det = determinant(matrix);
  const discriminant = trace * trace - 4 * det;
  if (discriminant < -1e-9) return [];

  const root = Math.sqrt(Math.max(0, discriminant));
  const eigenvalues = root <= 1e-9 ? [trace / 2] : [(trace + root) / 2, (trace - root) / 2];
  const pairs: EigenPair[] = [];

  for (const lambda of eigenvalues) {
    // 解 (A − λI)v = 0：优先用非零的 b / c 行，避免选到零向量。
    let candidate: Vec2;
    if (Math.abs(matrix.b) > 1e-9) {
      candidate = [matrix.b, lambda - matrix.a];
    } else if (Math.abs(matrix.c) > 1e-9) {
      candidate = [lambda - matrix.d, matrix.c];
    } else {
      candidate = Math.abs(matrix.a - lambda) <= Math.abs(matrix.d - lambda) ? [1, 0] : [0, 1];
    }
    const normalized = normalizeDirection(candidate);
    if (normalized === null) continue;
    if (pairs.some((existing) => sameDirection(existing.direction, normalized))) continue;
    pairs.push({ lambda, direction: normalized });
  }
  return pairs;
}

/** 2×2 实矩阵的实特征方向（兼容旧调用）。 */
export function realEigenvectors(matrix: Matrix2): Vec2[] {
  return realEigenpairs(matrix).map((pair) => pair.direction);
}

/**
 * 2×2 矩阵的两个奇异值（降序）。闭式解，不依赖迭代。
 * σ₁σ₂ = |det A|；det=0 时 σ₂=0。
 */
export function singularValues(matrix: Matrix2): [number, number] {
  const frobeniusHalf =
    (matrix.a * matrix.a + matrix.b * matrix.b + matrix.c * matrix.c + matrix.d * matrix.d) / 2;
  const det = determinant(matrix);
  const root = Math.sqrt(Math.max(0, frobeniusHalf * frobeniusHalf - det * det));
  return [
    Math.sqrt(Math.max(0, frobeniusHalf + root)),
    Math.sqrt(Math.max(0, frobeniusHalf - root)),
  ];
}

/** 数值秩：按最大元素设定相对容差，避免浮点尾巴被算成独立方向。 */
export function matrixRank(matrix: Matrix2, tolerance = 1e-9): 0 | 1 | 2 {
  const scale = Math.max(1, Math.abs(matrix.a), Math.abs(matrix.b), Math.abs(matrix.c), Math.abs(matrix.d));
  const eps = tolerance * scale;
  const det = determinant(matrix);
  if (Math.abs(det) > eps * scale) return 2;
  const hasEntry = [matrix.a, matrix.b, matrix.c, matrix.d].some((value) => Math.abs(value) > eps);
  return hasEntry ? 1 : 0;
}

/** 逆矩阵；不可逆（|det| 低于相对容差）返回 null，不伪造结果。 */
export function inverseMatrix(matrix: Matrix2, tolerance = 1e-9): Matrix2 | null {
  const det = determinant(matrix);
  const scale = Math.max(1, Math.abs(matrix.a), Math.abs(matrix.b), Math.abs(matrix.c), Math.abs(matrix.d));
  if (Math.abs(det) <= tolerance * scale * scale) return null;
  return {
    a: matrix.d / det,
    b: -matrix.b / det,
    c: -matrix.c / det,
    d: matrix.a / det,
  };
}

export function transposeMatrix(matrix: Matrix2): Matrix2 {
  return { a: matrix.a, b: matrix.c, c: matrix.b, d: matrix.d };
}

export function swapMatrixColumns(matrix: Matrix2): Matrix2 {
  return { a: matrix.b, b: matrix.a, c: matrix.d, d: matrix.c };
}

/** 两个矩阵的线性插值：动画从原像过渡到当前变换。 */
export function lerpMatrix(from: Matrix2, to: Matrix2, t: number): Matrix2 {
  const clamped = Math.min(1, Math.max(0, t));
  return {
    a: from.a + (to.a - from.a) * clamped,
    b: from.b + (to.b - from.b) * clamped,
    c: from.c + (to.c - from.c) * clamped,
    d: from.d + (to.d - from.d) * clamped,
  };
}

/**
 * 若 `A·v` 与 `v` 共线，返回特征倍数 λ（`A·v = λv`）；否则返回 null。
 * λ = 0（压到原点）也是合法结果，用 0 表示而不是 null。
 */
export function eigenScale(matrix: Matrix2, vector: Vec2): number | null {
  const lengthSquared = vector[0] * vector[0] + vector[1] * vector[1];
  if (lengthSquared < 1e-12) return null;
  const image = applyMatrix(matrix, vector);
  const imageLength = Math.hypot(image[0], image[1]);
  if (imageLength < 1e-9) return 0;
  const cross = image[0] * vector[1] - image[1] * vector[0];
  const tolerance = 1e-6 * Math.sqrt(lengthSquared) * imageLength;
  if (Math.abs(cross) > tolerance) return null;
  return (image[0] * vector[0] + image[1] * vector[1]) / lengthSquared;
}

/** `A·v ≈ v`：原像与像重合，画面上只保留一条线并合并标注。 */
export function isFixedVector(matrix: Matrix2, vector: Vec2, epsilon = 1e-6): boolean {
  const length = Math.hypot(vector[0], vector[1]);
  if (length < 1e-9) return false;
  const image = applyMatrix(matrix, vector);
  const distance = Math.hypot(image[0] - vector[0], image[1] - vector[1]);
  return distance <= epsilon * Math.max(1, length);
}

/**
 * 从作用域里读取显式向量列表（最多 8 条）。
 *
 * 支持的参数命名（iSpec 只允许标量，因此数组会被宿主扁平化）：
 *  - `x1 / y1 … x8 / y8`（推荐）；
 *  - 旧约定 `x / y`（第一条）、`x2 / y2 …`；
 *  - `v1x / v1y … v8x / v8y`。
 *
 * 找不到任何一对分量时返回空数组，由模板决定默认探针向量。
 */
export function readVectorList(scope: Record<string, SpecCell>): Vec2[] {
  const indexed: Vec2[] = [];
  for (let index = 1; index <= 8; index += 1) {
    const x = readNumber(scope, `x${index}`);
    const y = readNumber(scope, `y${index}`);
    if (x !== null && y !== null) indexed.push([x, y]);
  }
  if (indexed.length > 0) return indexed;

  const legacy: Vec2[] = [];
  const firstX = readNumber(scope, 'x');
  const firstY = readNumber(scope, 'y');
  if (firstX !== null && firstY !== null) legacy.push([firstX, firstY]);
  for (let index = 2; index <= 8; index += 1) {
    const x = readNumber(scope, `x${index}`);
    const y = readNumber(scope, `y${index}`);
    if (x !== null && y !== null) legacy.push([x, y]);
  }
  if (legacy.length > 0) return legacy;

  const flattened: Vec2[] = [];
  for (let index = 1; index <= 8; index += 1) {
    const x = readNumber(scope, `v${index}x`);
    const y = readNumber(scope, `v${index}y`);
    if (x !== null && y !== null) flattened.push([x, y]);
  }
  return flattened;
}

/**
 * 未提供向量参数时的三条探针向量：基向量 e₁ + 两个实特征方向。
 *
 * 矩阵值全部来自 iSpec 参数（不硬编码）；S6 的 A=[[2,1],[1,2]] 会得到
 * (1,0)、(1,1)、(1,-1)，与原页三条向量一致。若特征方向不足两条，
 * 依次用 e₂、(1,1) 补齐，保证画面永远是三条。
 */
export function defaultProbeVectors(matrix: Matrix2): Vec2[] {
  const vectors: Vec2[] = [[1, 0]];
  for (const eigen of realEigenvectors(matrix)) {
    if (vectors.some((existing) => sameDirection(existing, eigen))) continue;
    vectors.push(eigen);
    if (vectors.length === 3) return vectors;
  }
  const fallbacks: Vec2[] = [
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  for (const fallback of fallbacks) {
    if (vectors.some((existing) => sameDirection(existing, fallback))) continue;
    vectors.push(fallback);
    if (vectors.length === 3) break;
  }
  return vectors;
}