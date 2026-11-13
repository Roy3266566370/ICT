/**
 * Pure geometry for the dual-path order experiment.
 *
 * Kept independent of React and of the iSpec evaluator so the same functions
 * are used by the online deck, the offline export and unit tests.
 */
export type Vec2 = readonly [number, number];
export type Mat2 = [[number, number], [number, number]];
export type DualPathOrder = 'A' | 'B';
export type StartShape = 'rectangle' | 'basis';

export const RECTANGLE: readonly Vec2[] = [
  [-1, -0.6],
  [1, -0.6],
  [1, 0.6],
  [-1, 0.6],
];

export function rotationMatrix(angleDegrees: number): Mat2 {
  const radians = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    [cos, -sin],
    [sin, cos],
  ];
}

export function scaleMatrix(sx: number, sy: number): Mat2 {
  return [
    [sx, 0],
    [0, sy],
  ];
}

export function multiplyMatrices(left: Mat2, right: Mat2): Mat2 {
  return [
    [
      left[0][0] * right[0][0] + left[0][1] * right[1][0],
      left[0][0] * right[0][1] + left[0][1] * right[1][1],
    ],
    [
      left[1][0] * right[0][0] + left[1][1] * right[1][0],
      left[1][0] * right[0][1] + left[1][1] * right[1][1],
    ],
  ];
}

export function applyMat(matrix: Mat2, point: Vec2): Vec2 {
  return [
    matrix[0][0] * point[0] + matrix[0][1] * point[1],
    matrix[1][0] * point[0] + matrix[1][1] * point[1],
  ];
}

export function matrixFor(order: DualPathOrder, angle: number, sx: number, sy: number): Mat2 {
  const rotation = rotationMatrix(angle);
  const scale = scaleMatrix(sx, sy);
  return order === 'A' ? multiplyMatrices(scale, rotation) : multiplyMatrices(rotation, scale);
}

export interface DualPathResult {
  order: DualPathOrder;
  matrix: Mat2;
  input: Vec2;
  middle: Vec2;
  final: Vec2;
}

export function dualPath(order: DualPathOrder, angle: number, sx: number, sy: number, input: Vec2): DualPathResult {
  const rotation = rotationMatrix(angle);
  const scale = scaleMatrix(sx, sy);
  const middle = applyMat(order === 'A' ? rotation : scale, input);
  const final = applyMat(order === 'A' ? scale : rotation, middle);
  return {order, matrix: matrixFor(order, angle, sx, sy), input, middle, final};
}

export function transformPolygon(matrix: Mat2, points: readonly Vec2[]): Vec2[] {
  return points.map(point => applyMat(matrix, point));
}

export function polygonArea(points: readonly Vec2[]): number {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    total += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(total) / 2;
}

export function maxVertexDeviation(first: readonly Vec2[], second: readonly Vec2[]): number {
  let maximum = 0;
  for (let index = 0; index < Math.min(first.length, second.length); index += 1) {
    const a = first[index]!;
    const b = second[index]!;
    maximum = Math.max(maximum, Math.hypot(a[0] - b[0], a[1] - b[1]));
  }
  return maximum;
}

export function interpolateDualPath(
  order: DualPathOrder,
  angle: number,
  sx: number,
  sy: number,
  input: Vec2,
  progress: number,
): DualPathResult {
  const t = Math.max(0, Math.min(1, progress));
  const first = order === 'A' ? rotationMatrix(angle * Math.min(1, t * 2)) : scaleMatrix(1 + (sx - 1) * Math.min(1, t * 2), 1 + (sy - 1) * Math.min(1, t * 2));
  const second = order === 'A' ? scaleMatrix(1 + (sx - 1) * Math.max(0, t * 2 - 1), 1 + (sy - 1) * Math.max(0, t * 2 - 1)) : rotationMatrix(angle * Math.max(0, t * 2 - 1));
  const middle = applyMat(first, input);
  const final = applyMat(second, middle);
  return {order, matrix: multiplyMatrices(second, first), input, middle, final};
}

export function formatPoint(point: Vec2): string {
  const format = (value: number) => {
    const snapped = Math.abs(value) < 1e-9 ? 0 : value;
    return Number(snapped.toFixed(4)).toString();
  };
  return `(${format(point[0])}, ${format(point[1])})`;
}

export function formatMatrix(matrix: Mat2): string {
  return `[[${matrix[0].map(value => Number(value.toFixed(4))).join(', ')}], [${matrix[1].map(value => Number(value.toFixed(4))).join(', ')}]]`;
}

export interface SymmetricEigen {
  values: [number, number];
  vectors: [Vec2, Vec2];
}

/** Closed-form symmetric 2×2 eigen-decomposition, descending. */
export function symmetricEigen(matrix: Mat2): SymmetricEigen {
  const [[p, q], [, r]] = matrix;
  const angle = 0.5 * Math.atan2(2 * q, p - r);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const first: Vec2 = [c, s];
  const second: Vec2 = [-s, c];
  const valueFor = (vector: Vec2) =>
    vector[0] * (p * vector[0] + q * vector[1]) + vector[1] * (q * vector[0] + r * vector[1]);
  const firstValue = valueFor(first);
  const secondValue = valueFor(second);
  return firstValue >= secondValue
    ? {values: [firstValue, secondValue], vectors: [first, second]}
    : {values: [secondValue, firstValue], vectors: [second, first]};
}

export interface Svd2 {
  u: Mat2;
  sigma: [number, number];
  v: Mat2;
  rank: 0 | 1 | 2;
}

/** A = U Σ Vᵀ for a real 2×2 matrix. */
export function svd2(matrix: Mat2): Svd2 {
  const [[a, b], [c, d]] = matrix;
  const ata: Mat2 = [
    [a * a + c * c, a * b + c * d],
    [a * b + c * d, b * b + d * d],
  ];
  const eigen = symmetricEigen(ata);
  const s1 = Math.sqrt(Math.max(0, eigen.values[0]));
  const s2 = Math.sqrt(Math.max(0, eigen.values[1]));
  const v1 = eigen.vectors[0];
  const v2 = eigen.vectors[1];
  let u1: Vec2;
  let u2: Vec2;
  if (s1 > 1e-12) {
    u1 = [(a * v1[0] + b * v1[1]) / s1, (c * v1[0] + d * v1[1]) / s1];
  } else {
    u1 = [1, 0];
  }
  if (s2 > 1e-12) {
    u2 = [(a * v2[0] + b * v2[1]) / s2, (c * v2[0] + d * v2[1]) / s2];
  } else {
    u2 = [-u1[1], u1[0]];
  }
  const rank = (s1 > 1e-9 ? 1 : 0) + (s2 > 1e-9 ? 1 : 0);
  return {
    u: [[u1[0], u2[0]], [u1[1], u2[1]]],
    sigma: [s1, s2],
    v: [[v1[0], v2[0]], [v1[1], v2[1]]],
    rank: rank as 0 | 1 | 2,
  };
}

export function multiplyVecMatrix(vector: Vec2, matrix: Mat2): Vec2 {
  return [
    vector[0] * matrix[0][0] + vector[1] * matrix[1][0],
    vector[0] * matrix[0][1] + vector[1] * matrix[1][1],
  ];
}

export function inverse2(matrix: Mat2): Mat2 | null {
  const det = matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
  if (Math.abs(det) < 1e-12) return null;
  return [
    [matrix[1][1] / det, -matrix[0][1] / det],
    [-matrix[1][0] / det, matrix[0][0] / det],
  ];
}

export function lerpMat(from: Mat2, to: Mat2, t: number): Mat2 {
  const mix = (a: number, b: number) => a + (b - a) * Math.max(0, Math.min(1, t));
  return [
    [mix(from[0][0], to[0][0]), mix(from[0][1], to[0][1])],
    [mix(from[1][0], to[1][0]), mix(from[1][1], to[1][1])],
  ];
}

export function transpose(matrix: Mat2): Mat2 {
  return [
    [matrix[0][0], matrix[1][0]],
    [matrix[0][1], matrix[1][1]],
  ];
}
