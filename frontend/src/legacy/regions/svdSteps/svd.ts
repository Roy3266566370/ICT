/**
 * svdSteps/svd.ts —— 2×2 矩阵的 SVD 解析解（SSR 安全，无 DOM 依赖）。
 *
 * 任务要求「对称 2×2 可用解析式；非对称需数值迭代，若实现成本高可只支持对称并注明」。
 * 实际上 2×2 的**非对称**矩阵也能闭式求解，不需要迭代：
 *
 *   AᵀA 对称正定 → 解析特征值 λ₁ ≥ λ₂ ≥ 0 → σᵢ = √λᵢ；
 *   V 的列 = AᵀA 的单位特征向量（λ₁ 对应 v₁，v₂ 取 v₁ 的逆时针法向，保证 det V = +1）；
 *   U 的列 = A·vᵢ / σᵢ（σᵢ > 0），再做一次正交化消除舍入误差。
 *
 * 因此本文件对任意 2×2 实矩阵都成立（含奇异、含反射），并在返回值里给出
 * `reconstructError` 以自检 UΣVᵀ 是否还原 A。
 */

export type Vec2 = readonly [number, number];
export type Mat2 = readonly [readonly [number, number], readonly [number, number]];

/** S14 原页的矩阵：斐波那契矩阵，奇异值恰为 φ ≈ 1.618034 与 1/φ ≈ 0.618034。 */
export const DEFAULT_SVD_MATRIX: Mat2 = [
  [1, 1],
  [1, 0],
];

/** 原页标注的两个奇异值（用于判断"是否已偏离原值"）。 */
export const ORIGINAL_SIGMAS: readonly [number, number] = [1.618034, 0.618034];

export interface Svd2x2Result {
  /** 奇异值（降序，σ₁ ≥ σ₂ ≥ 0） */
  sigma: readonly [number, number];
  /** V 的列 = 右奇异向量（正交，det=+1） */
  v: Mat2;
  /** U 的列 = 左奇异向量（正交） */
  u: Mat2;
  /** 面积倍率 = σ₁·σ₂ = |det A| */
  areaScale: number;
  /** |det A|（与 areaScale 数值一致，用十进制口径再给一次） */
  absDeterminant: number;
  /** σ₂ 是否可视为 0（矩阵奇异：椭圆退化为线段） */
  singular: boolean;
  /** 长轴方向（度，0° = x 正方向，逆时针为正），即 u₁ 的方向 */
  majorAngleDeg: number;
  /** 第一步 Vᵀ 之后标记点的方向（度）——「光画圆看不出第一步」正是这个角 */
  firstStepAngleDeg: number;
  /** 三步后的标记点位置（数学坐标）：p0 = Vᵀe₁、p1 = Σp0、p2 = A·e₁ */
  marker: readonly [Vec2, Vec2, Vec2];
  /** max |UΣVᵀ − A|，用于自检（正常应在 1e-12 量级） */
  reconstructError: number;
}

function round12(value: number): number {
  return Math.round(value * 1e12) / 1e12;
}

function normalize(v: Vec2): Vec2 {
  const length = Math.hypot(v[0], v[1]);
  if (length < 1e-12) return [1, 0];
  return [v[0] / length, v[1] / length];
}

/** 逆时针 90° 法向，保证 det([v, perp(v)]) = +1。 */
function perpendicular(v: Vec2): Vec2 {
  return [-v[1], v[0]];
}

function matVec(m: Mat2, v: Vec2): Vec2 {
  return [m[0][0] * v[0] + m[0][1] * v[1], m[1][0] * v[0] + m[1][1] * v[1]];
}

function matMul(a: Mat2, b: Mat2): Mat2 {
  return [
    [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1]],
    [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1]],
  ];
}

/** 转置：返回 [[m00, m10], [m01, m11]]（列变行）。 */
export function transpose(m: Mat2): Mat2 {
  return [
    [m[0][0], m[1][0]],
    [m[0][1], m[1][1]],
  ];
}

export function angleDeg(v: Vec2): number | null {
  if (Math.hypot(v[0], v[1]) < 1e-12) return null;
  const degrees = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

export function svd2x2(m: Mat2): Svd2x2Result {
  const m00 = m[0][0];
  const m01 = m[0][1];
  const m10 = m[1][0];
  const m11 = m[1][1];

  // AᵀA = [[a, b], [b, c]]
  const a = m00 * m00 + m10 * m10;
  const b = m00 * m01 + m10 * m11;
  const c = m01 * m01 + m11 * m11;

  const half = (a - c) / 2;
  const disc = Math.hypot(half, b);
  const lambda1 = (a + c) / 2 + disc;
  const lambda2 = (a + c) / 2 - disc;
  const sigma1 = Math.sqrt(Math.max(lambda1, 0));
  const sigma2 = Math.sqrt(Math.max(lambda2, 0));

  // v₁：λ₁ 对应的单位特征向量；v₂ 取其逆时针法向（与 v₁ 正交且 det V = +1）
  const v1: Vec2 =
    Math.abs(b) > 1e-12
      ? normalize([b, lambda1 - a] as const)
      : a >= c
        ? ([1, 0] as const)
        : ([0, 1] as const);
  const v2 = perpendicular(v1);
  const v: Mat2 = [
    [v1[0], v2[0]],
    [v1[1], v2[1]],
  ];

  // U：uᵢ = A·vᵢ / σᵢ；σᵢ ≈ 0 时退化处理
  const rawU1 = matVec(m, v1);
  const rawU2 = matVec(m, v2);
  const u1 = sigma1 > 1e-12 ? normalize([rawU1[0] / sigma1, rawU1[1] / sigma1] as const) : ([1, 0] as Vec2);
  let u2 = sigma2 > 1e-12 ? normalize([rawU2[0] / sigma2, rawU2[1] / sigma2]) : perpendicular(u1);

  // 正交化（消除舍入误差），保持 u₂ 与 u₁ 垂直
  const dot = u1[0] * u2[0] + u1[1] * u2[1];
  u2 = normalize([u2[0] - dot * u1[0], u2[1] - dot * u1[1]]);
  if (Math.hypot(u2[0], u2[1]) < 1e-9) u2 = perpendicular(u1);

  const u: Mat2 = [
    [u1[0], u2[0]],
    [u1[1], u2[1]],
  ];

  // 自检：U Σ Vᵀ 是否还原 A
  const sigmaMatrix: Mat2 = [
    [sigma1, 0],
    [0, sigma2],
  ];
  const reconstructed = matMul(matMul(u, sigmaMatrix), transpose(v));
  let reconstructError = 0;
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      reconstructError = Math.max(
        reconstructError,
        Math.abs((reconstructed[row]?.[column] ?? 0) - (m[row]?.[column] ?? 0)),
      );
    }
  }

  // 三步的标记点：p0 = Vᵀe₁、p1 = Σp0、p2 = A e₁
  const e1: Vec2 = [1, 0];
  const p0 = normalize(matVec(transpose(v), e1));
  const p1: Vec2 = [sigma1 * p0[0], sigma2 * p0[1]];
  const p2 = matVec(m, e1);

  const absDeterminant = Math.abs(m00 * m11 - m01 * m10);
  const singularThreshold = 1e-9 * Math.max(1, sigma1);

  return {
    sigma: [round12(sigma1), round12(sigma2)],
    v,
    u,
    areaScale: round12(sigma1 * sigma2),
    absDeterminant: round12(absDeterminant),
    singular: sigma2 <= singularThreshold,
    majorAngleDeg: angleDeg(u1) ?? 0,
    firstStepAngleDeg: angleDeg(p0) ?? 0,
    marker: [p0, [round12(p1[0]), round12(p1[1])], [round12(p2[0]), round12(p2[1])]],
    reconstructError,
  };
}

/** 去掉无意义尾零（"1.618034" → "1.618034"、"2.000" → "2"）。 */
export function fmtNumber(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return '—';
  const fixed = value.toFixed(digits);
  if (!fixed.includes('.')) return fixed;
  const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}

export function fmtVec(v: Vec2, digits = 3): string {
  const x = Math.abs(v[0]) < 5e-10 ? 0 : v[0];
  const y = Math.abs(v[1]) < 5e-10 ? 0 : v[1];
  return `(${fmtNumber(x, digits)}, ${fmtNumber(y, digits)})`;
}