/**
 * matrixOrder/math.ts —— 2×2 矩阵与"逐步执行"所需的纯函数（SSR 安全，无 DOM 依赖）。
 *
 * 为什么需要极分解：
 * rebuild-spec §9 要求播放语义为「旋转按角度、伸缩按倍率、组合变换分两步；**不得**把任意
 * 系数的插值解释成原文描述的运算过程」。因此从 stage 0 到 stage 1 的过渡不能直接对端点做
 * 线性插值，而必须让"部分执行"的矩阵本身是真实变换：
 *
 *   任一可逆 2×2 矩阵 M 可极分解为 M = R(θ)·S（R 旋转、S 对称正定）；
 *   部分执行 P(t) = R(t·θ) · ((1−t)·I + t·S)。
 *
 * 对纯旋转（S=I）退化为角度插值；对对角伸缩（θ=0，S 对角）退化为倍率插值——正是
 * S10 的默认参数（A=旋转 90°，B=横向拉伸 2 倍）所要求的两条语义。
 * 奇异或含反射（det<0，无法表示为旋转）的矩阵退化为线性过渡，并由组件在界面上标注。
 */

export type Vec2 = readonly [number, number];
export type Mat2 = readonly [readonly [number, number], readonly [number, number]];

export const IDENTITY: Mat2 = [
  [1, 0],
  [0, 1],
];

/** 默认矩阵：A = 逆时针 90° 旋转；B = 横向拉伸 2 倍（与 S10 原页「先转后拉 / 先拉后转」一致）。 */
export const DEFAULT_A: Mat2 = [
  [0, -1],
  [1, 0],
];
export const DEFAULT_B: Mat2 = [
  [2, 0],
  [0, 1],
];
export const DEFAULT_INPUT: Vec2 = [1, 0];

/** M·v */
export function matVec(m: Mat2, v: Vec2): Vec2 {
  return [m[0][0] * v[0] + m[0][1] * v[1], m[1][0] * v[0] + m[1][1] * v[1]];
}

/** A·B（先作用 B，再作用 A） */
export function matMul(a: Mat2, b: Mat2): Mat2 {
  return [
    [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1]],
    [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1]],
  ];
}

export function matDet(m: Mat2): number {
  return m[0][0] * m[1][1] - m[0][1] * m[1][0];
}

export function vecLength(v: Vec2): number {
  return Math.hypot(v[0], v[1]);
}

/** 向量方向（度，0° = x 正方向，逆时针为正）；零向量返回 null。 */
export function vecAngleDeg(v: Vec2): number | null {
  if (vecLength(v) < 1e-12) return null;
  const degrees = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

export function rotationMatrix(radians: number): Mat2 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    [cos, -sin],
    [sin, cos],
  ];
}

export function lerpMatrix(from: Mat2, to: Mat2, t: number): Mat2 {
  const k = clamp01(t);
  return [
    [from[0][0] + (to[0][0] - from[0][0]) * k, from[0][1] + (to[0][1] - from[0][1]) * k],
    [from[1][0] + (to[1][0] - from[1][0]) * k, from[1][1] + (to[1][1] - from[1][1]) * k],
  ];
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function isApproxIdentity(m: Mat2, epsilon = 1e-9): boolean {
  return (
    Math.abs(m[0][0] - 1) <= epsilon &&
    Math.abs(m[0][1]) <= epsilon &&
    Math.abs(m[1][0]) <= epsilon &&
    Math.abs(m[1][1] - 1) <= epsilon
  );
}

export interface PolarParts {
  /** R 的旋转角（弧度）；`decomposable=false` 时无意义。 */
  rotationRad: number;
  /** 对称正定拉伸部分 S（M = R·S）。 */
  stretch: Mat2;
  /** 能否用「旋转 × 对称拉伸」表示（奇异矩阵或含反射时为 false）。 */
  decomposable: boolean;
  /** S ≈ I：这段变换是纯旋转。 */
  pureRotation: boolean;
  /** R ≈ I 且 S 无交叉项：这段变换是沿坐标轴的纯伸缩。 */
  pureScale: boolean;
}

/**
 * 极分解 M = R(θ)·S，S = √(MᵀM) 对称正定。
 * 2×2 解析式：令 MᵀM = [[a,b],[b,c]]、d = |det M|，则
 * S = (MᵀM + d·I) / √(a + c + 2d)，R = M·S⁻¹，θ = atan2(R₁₀, R₀₀)。
 */
export function polarDecompose(m: Mat2): PolarParts {
  const m00 = m[0][0];
  const m01 = m[0][1];
  const m10 = m[1][0];
  const m11 = m[1][1];

  const a = m00 * m00 + m10 * m10;
  const b = m00 * m01 + m10 * m11;
  const c = m01 * m01 + m11 * m11;
  const absDet = Math.abs(m00 * m11 - m01 * m10);
  const denominator = Math.sqrt(Math.max(a + c + 2 * absDet, 1e-12));

  const s00 = (a + absDet) / denominator;
  const s01 = b / denominator;
  const s11 = (c + absDet) / denominator;
  const stretch: Mat2 = [
    [s00, s01],
    [s01, s11],
  ];

  const detS = s00 * s11 - s01 * s01;
  if (!(detS > 1e-12) || !Number.isFinite(detS)) {
    return {
      rotationRad: 0,
      stretch: IDENTITY,
      decomposable: false,
      pureRotation: false,
      pureScale: false,
    };
  }

  // R = M · S⁻¹（S 对称正定，逆矩阵解析可得）
  const inv00 = s11 / detS;
  const inv01 = -s01 / detS;
  const inv11 = s00 / detS;
  const r00 = m00 * inv00 + m01 * inv01;
  const r01 = m00 * inv01 + m01 * inv11;
  const r10 = m10 * inv00 + m11 * inv01;
  const r11 = m10 * inv01 + m11 * inv11;
  const rotationRad = Math.atan2(r10, r00);

  const finite = [r00, r01, r10, r11, s00, s01, s11].every((value) => Number.isFinite(value));
  // R 的行列式为负 ⇒ 含反射，无法只用"旋转"表达（旋转 det=+1）
  const decomposable = finite && r00 * r11 - r01 * r10 > 0;

  const pureRotation =
    decomposable &&
    Math.abs(s00 - 1) <= 1e-9 &&
    Math.abs(s01) <= 1e-9 &&
    Math.abs(s11 - 1) <= 1e-9;
  const pureScale =
    decomposable && Math.abs(rotationRad) <= 1e-9 && Math.abs(s01) <= 1e-9;

  return { rotationRad, stretch, decomposable, pureRotation, pureScale };
}

/**
 * 部分执行 P(t)：t=0 为恒等、t=1 为 M。
 * - 纯旋转 / 纯伸缩：分别按角度、倍率插值（spec §9 要求的播放语义）；
 * - 一般矩阵：先转 t·θ、再按 (1−t)I + tS 伸缩（组合变换分两步连续执行）；
 * - 奇异/含反射：退化为线性过渡（组件标注）。
 */
export function partialMatrix(m: Mat2, progress: number): Mat2 {
  const t = clamp01(progress);
  if (t <= 0) return IDENTITY;
  if (t >= 1) return m;

  const parts = polarDecompose(m);
  if (!parts.decomposable) return lerpMatrix(IDENTITY, m, t);

  const rotation = rotationMatrix(parts.rotationRad * t);
  const stretch = lerpMatrix(IDENTITY, parts.stretch, t);
  return matMul(rotation, stretch);
}

/** 该段变换在播放时属于哪种语义（用于界面提示"按角度 / 按倍率 / 组合"）。 */
export function describeTransform(m: Mat2): 'rotation' | 'scale' | 'composite' | 'linear-fallback' {
  const parts = polarDecompose(m);
  if (!parts.decomposable) return 'linear-fallback';
  if (parts.pureRotation) return 'rotation';
  if (parts.pureScale) return 'scale';
  return 'composite';
}

/** 去掉无意义尾零的数字文本（"2.000" → "2"、"1.618" → "1.618"、"100.000" → "100"）。 */
export function fmtNumber(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return '—';
  const fixed = value.toFixed(digits);
  if (!fixed.includes('.')) return fixed;
  const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}

/** `(1, 0)` 形式；零向量附近归一为 `(0, 0)`。 */
export function fmtVec(v: Vec2, digits = 3): string {
  const x = Math.abs(v[0]) < 5e-10 ? 0 : v[0];
  const y = Math.abs(v[1]) < 5e-10 ? 0 : v[1];
  return `(${fmtNumber(x, digits)}, ${fmtNumber(y, digits)})`;
}