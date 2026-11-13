/**
 * matrix.ts —— `matrix_2d` 的前端确定性派生实现（C-MX@1，plan §2.2.3）
 *
 * 约束：
 *  - 纯函数、无 I/O、不修改入参。
 *  - 全程 IEEE-754 double，结果按 `round(v, 10)` 归一以消除 `-0` 与浮点尾差。
 *  - 后端 `backend/app/engines/linear.py`（T8）是独立实现，两者必须数值一致；
 *    本文件不参与任何真值判定，仅用于界面即时派生。
 */
import type {
  KnowledgeObject,
  Matrix2,
  Matrix2dResult,
  MatrixComposition,
  MatrixEigenvalues,
  MatrixStep1,
  MatrixStep2,
  Parameter,
  Vector2,
} from '@/api/types';
import { isMatrix2, isVector2 } from '@/api/types';
import { EPSILON, RANK_EPSILON, round } from './format';

/** 模板参数允许范围（§2.2.3 规则 7） */
export const MATRIX_PARAM_MIN = -3;
export const MATRIX_PARAM_MAX = 3;
export const MATRIX_PARAM_STEP = 0.1;

/** 判别式 < 0 时的固定提示（§2.2.3 规则 4，文案与契约一致） */
export const NO_REAL_EIGENVALUE_REASON =
  '判别式小于 0，该矩阵没有实特征值（对应纯旋转/螺旋型变换）';

/** det=0 时的固定提示（§2.2.3 规则 5，文案与契约一致） */
export const SINGULAR_REASON =
  '矩阵奇异（det=0），零空间非平凡，无法把每个点送回原位';

/**
 * 领域层返回值：不抛异常，越界/非法输入统一走 `ok:false`。
 * 组件可把 `error` 直接交给 `TemplateProps.resultError` 展示。
 */
export type DomainOutcome<T> =
  | { ok: true; result: T; error: null }
  | { ok: false; result: null; error: string };

export function domainOk<T>(result: T): DomainOutcome<T> {
  return { ok: true, result, error: null };
}

export function domainFail<T>(error: string): DomainOutcome<T> {
  return { ok: false, result: null, error };
}

/* -------------------------------------------------------------------------- */
/* 基础线性代数                                                               */
/* -------------------------------------------------------------------------- */

export const IDENTITY_MATRIX: Matrix2 = [
  [1, 0],
  [0, 1],
];

export const ZERO_VECTOR: Vector2 = [0, 0];

/** 2×2 矩阵乘向量：A·x，按 `(a11·x1 + a12·x2, a21·x1 + a22·x2)` 计算。 */
export function applyMatrix(matrix: Matrix2, vector: Vector2): Vector2 {
  const [[a11, a12], [a21, a22]] = matrix;
  const [x1, x2] = vector;
  return [round(a11 * x1 + a12 * x2), round(a21 * x1 + a22 * x2)];
}

/** 2×2 矩阵乘：`multiplyMatrices(A, B)` 得到 `AB`，语义是「先执行 B」（§2.3.6）。 */
export function multiplyMatrices(a: Matrix2, b: Matrix2): Matrix2 {
  const [[a11, a12], [a21, a22]] = a;
  const [[b11, b12], [b21, b22]] = b;
  return [
    [round(a11 * b11 + a12 * b21), round(a11 * b12 + a12 * b22)],
    [round(a21 * b11 + a22 * b21), round(a21 * b12 + a22 * b22)],
  ];
}

export function matrixDet(matrix: Matrix2): number {
  const [[a11, a12], [a21, a22]] = matrix;
  return round(a11 * a22 - a12 * a21);
}

export function matrixTrace(matrix: Matrix2): number {
  const [[a11], [, a22]] = matrix;
  return round(a11 + a22);
}

/** rank：|det| > 1e-12 → 2；否则任一分量绝对值 > 1e-12 → 1；否则 0。 */
export function matrixRank(matrix: Matrix2): 0 | 1 | 2 {
  if (Math.abs(matrixDet(matrix)) > RANK_EPSILON) return 2;
  const flat = [matrix[0][0], matrix[0][1], matrix[1][0], matrix[1][1]];
  return flat.some((value) => Math.abs(value) > RANK_EPSILON) ? 1 : 0;
}

/**
 * 特征值：`disc = trace² − 4·det`。
 * disc ≥ 0 返回两个实特征值（升序）；否则 `real:false` + 原因文案。
 */
export function matrixEigenvalues(matrix: Matrix2): MatrixEigenvalues {
  const trace = matrixTrace(matrix);
  const det = matrixDet(matrix);
  const disc = trace * trace - 4 * det;
  if (disc < 0) {
    return { real: false, reason: NO_REAL_EIGENVALUE_REASON };
  }
  const root = Math.sqrt(disc);
  return { real: true, values: [round((trace - root) / 2), round((trace + root) / 2)] };
}

export type InverseOutcome =
  | { ok: true; inverse: Matrix2 }
  | { ok: false; reason: string };

/** 求逆：det=0 时拒绝，绝不返回伪造逆矩阵（R6-AC10）。 */
export function invertMatrix(matrix: Matrix2): InverseOutcome {
  const det = matrixDet(matrix);
  if (Math.abs(det) <= RANK_EPSILON) {
    return { ok: false, reason: SINGULAR_REASON };
  }
  const [[a11, a12], [a21, a22]] = matrix;
  return {
    ok: true,
    inverse: [
      [round(a22 / det), round(-a12 / det)],
      [round(-a21 / det), round(a11 / det)],
    ],
  };
}

/**
 * 2×2 奇异值（手写闭式，避免引入线性代数库）：
 * 奇异值是 `AᵀA` 特征值的平方根，返回 [σmax, σmin]。
 */
export function singularValues(matrix: Matrix2): [number, number] {
  const [[a11, a12], [a21, a22]] = matrix;
  // AᵀA 是对称矩阵 [[p, q], [q, r]]
  const p = a11 * a11 + a21 * a21;
  const q = a11 * a12 + a21 * a22;
  const r = a12 * a12 + a22 * a22;
  const trace = p + r;
  const det = p * r - q * q;
  const disc = Math.max(0, trace * trace - 4 * det);
  const root = Math.sqrt(disc);
  const lambdaMax = Math.max(0, (trace + root) / 2);
  const lambdaMin = Math.max(0, (trace - root) / 2);
  return [round(Math.sqrt(lambdaMax)), round(Math.sqrt(lambdaMin))];
}

/** 单位圆的像：半轴长 = 奇异值；rank < 2 时按契约返回 null（§2.2.3 规则 6）。 */
export function matrixEllipse(matrix: Matrix2): { a: number; b: number } | null {
  if (matrixRank(matrix) < 2) return null;
  const [max, min] = singularValues(matrix);
  return { a: max, b: min };
}

/**
 * 组合变换：同时给出 `AB`、`BA`、`ABx`、`BAx` 与是否交换。
 * 注意 `AB = A·B` 表示「先执行 B」（§2.3.6），界面上必须写清顺序。
 */
export function composeMatrices(
  a: Matrix2,
  b: Matrix2,
  vector: Vector2,
  order: 'A_then_B' | 'B_then_A' = 'A_then_B',
): MatrixComposition {
  const ab = multiplyMatrices(a, b);
  const ba = multiplyMatrices(b, a);
  const abx = applyMatrix(ab, vector);
  const bax = applyMatrix(ba, vector);
  const commutes =
    Math.abs(abx[0] - bax[0]) <= EPSILON && Math.abs(abx[1] - bax[1]) <= EPSILON;
  return { order, ab, ba, abx, bax, commutes };
}

/* -------------------------------------------------------------------------- */
/* 几何采样：单位正方形 / 单位圆 → 变换后的点列                               */
/* -------------------------------------------------------------------------- */

/** 单位正方形（四角闭合）采样点，坐标为 [-1, 1] 或 [0,1]？这里用以原点为中心的单位正方形。 */
export function sampleUnitSquare(): Vector2[] {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ];
}

/** 单位圆采样点（圆周，闭合），samples 至少为 8。 */
export function sampleUnitCircle(samples = 64): Vector2[] {
  const count = Math.max(8, Math.floor(samples));
  const points: Vector2[] = [];
  for (let index = 0; index <= count; index += 1) {
    const theta = (index / count) * Math.PI * 2;
    points.push([round(Math.cos(theta), 10), round(Math.sin(theta), 10)]);
  }
  return points;
}

/** 把任意点列按矩阵变换，返回新点列（不修改入参）。 */
export function applyMatrixToPolygon(
  matrix: Matrix2,
  points: readonly Vector2[],
): Vector2[] {
  return points.map((point) => applyMatrix(matrix, point));
}

/* -------------------------------------------------------------------------- */
/* 参数读取与校验                                                             */
/* -------------------------------------------------------------------------- */

function parameterById(object: KnowledgeObject, id: string): Parameter | null {
  return object.parameters.find((parameter) => parameter.id === id) ?? null;
}

function firstParameterOfType(object: KnowledgeObject, type: Parameter['type']): Parameter | null {
  return object.parameters.find((parameter) => parameter.type === type) ?? null;
}

/** 矩阵类参数允许的 fallback id（当 config 未指明时使用） */
const MATRIX_FALLBACK_IDS = ['matrix_A', 'matrix_a', 'matrix', 'A'] as const;
const SECOND_MATRIX_FALLBACK_IDS = ['matrix_B', 'matrix_b', 'second_matrix', 'B'] as const;
const VECTOR_FALLBACK_IDS = ['vector_x', 'vector', 'x'] as const;

function pickParameter(
  object: KnowledgeObject,
  explicitId: string | null,
  fallbackIds: readonly string[],
  type: Parameter['type'],
): Parameter | null {
  if (explicitId !== null) {
    const explicit = parameterById(object, explicitId);
    if (explicit !== null) return explicit;
  }
  for (const id of fallbackIds) {
    const candidate = parameterById(object, id);
    if (candidate !== null && candidate.type === type) return candidate;
  }
  return firstParameterOfType(object, type);
}

function readConfigId(object: KnowledgeObject, key: string): string | null {
  const raw = object.config[key];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function checkMatrixRange(matrix: Matrix2, label: string): string | null {
  const values = [matrix[0][0], matrix[0][1], matrix[1][0], matrix[1][1]];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? 0;
    const row = index < 2 ? 0 : 1;
    const col = index % 2;
    if (!Number.isFinite(value)) {
      return `${label}[${row}][${col}] 不是有限数（NaN / Infinity 不被接受）`;
    }
    if (value < MATRIX_PARAM_MIN - EPSILON || value > MATRIX_PARAM_MAX + EPSILON) {
      return `${label}[${row}][${col}] = ${value} 超出允许范围 ${MATRIX_PARAM_MIN} ~ ${MATRIX_PARAM_MAX}`;
    }
  }
  return null;
}

function checkVectorRange(vector: Vector2, label: string): string | null {
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index] ?? 0;
    if (!Number.isFinite(value)) {
      return `${label}[${index}] 不是有限数（NaN / Infinity 不被接受）`;
    }
    if (value < MATRIX_PARAM_MIN - EPSILON || value > MATRIX_PARAM_MAX + EPSILON) {
      return `${label}[${index}] = ${value} 超出允许范围 ${MATRIX_PARAM_MIN} ~ ${MATRIX_PARAM_MAX}`;
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* 结果组装                                                                   */
/* -------------------------------------------------------------------------- */

export interface Matrix2dInput {
  matrix: Matrix2;
  vector: Vector2;
  /** operation=matrix_compose 时必填 */
  secondMatrix?: Matrix2 | null;
  operation?: 'matrix_apply' | 'matrix_compose';
  composeOrder?: 'A_then_B' | 'B_then_A';
}

/**
 * 由矩阵/向量直接算出完整 `Matrix2dResult`（契约 §2.2.3）。
 * `steps[1].partial` 取「累加完第一项后的部分和」，与 `mx_zero_vector` 黄金用例一致。
 */
export function computeMatrix2dResult(input: Matrix2dInput): DomainOutcome<Matrix2dResult> {
  const { matrix, vector, secondMatrix = null, operation = 'matrix_apply' } = input;
  const matrixError = checkMatrixRange(matrix, 'matrix_A');
  const vectorError = checkVectorRange(vector, 'vector_x');
  if (matrixError !== null) return domainFail(matrixError);
  if (vectorError !== null) return domainFail(vectorError);

  if (secondMatrix !== null) {
    const secondError = checkMatrixRange(secondMatrix, 'matrix_B');
    if (secondError !== null) return domainFail(secondError);
  }
  if (operation === 'matrix_compose' && secondMatrix === null) {
    return domainFail('组合变换需要第二个矩阵 matrix_B，当前缺失');
  }

  const [[a11, a12], [a21, a22]] = matrix;
  const [x1, x2] = vector;

  const ax = applyMatrix(matrix, vector);
  const det = matrixDet(matrix);
  const trace = matrixTrace(matrix);
  const rank = matrixRank(matrix);
  const eigenvalues = matrixEigenvalues(matrix);
  const inverseOutcome = invertMatrix(matrix);
  const ellipse = matrixEllipse(matrix);

  const columns: [Vector2, Vector2] = [
    [a11, a21],
    [a12, a22],
  ];

  const step1: MatrixStep1 = {
    step: 1,
    title: '取输入坐标当倍数',
    terms: [
      { coefficient: x1, column_index: 0, column: columns[0] },
      { coefficient: x2, column_index: 1, column: columns[1] },
    ],
  };

  // 累加完第一项后的部分和；只有一项时与最终结果相同
  const partial: Vector2 = [round(x1 * columns[0][0]), round(x1 * columns[0][1])];

  const step2: MatrixStep2 = {
    step: 2,
    title: '组合各列',
    partial,
    result: ax,
  };

  const composition =
    secondMatrix !== null
      ? composeMatrices(matrix, secondMatrix, vector, input.composeOrder ?? 'A_then_B')
      : null;

  return domainOk({
    ax,
    columns,
    det,
    trace,
    rank,
    eigenvalues,
    invertible: inverseOutcome.ok,
    inverse: inverseOutcome.ok ? inverseOutcome.inverse : null,
    singular_reason: inverseOutcome.ok ? null : inverseOutcome.reason,
    steps: [step1, step2],
    composition,
    ellipse,
  });
}

/**
 * 从 `KnowledgeObject` 派生 `matrix_2d` 结果。
 * 参数按 `config.matrix_parameter_id` / `second_matrix_parameter_id` 定位，
 * 未指定时回退到常见 id（matrix_A / matrix_B / vector_x），最后按 type 兜底。
 */
export function deriveMatrix2d(object: KnowledgeObject): DomainOutcome<Matrix2dResult> {
  const matrixParam = pickParameter(
    object,
    readConfigId(object, 'matrix_parameter_id'),
    MATRIX_FALLBACK_IDS,
    'matrix2',
  );
  const vectorParam = pickParameter(object, null, VECTOR_FALLBACK_IDS, 'vector2');
  const secondParam = pickParameter(
    object,
    readConfigId(object, 'second_matrix_parameter_id'),
    SECOND_MATRIX_FALLBACK_IDS,
    'matrix2',
  );

  if (matrixParam === null) return domainFail('缺少矩阵参数（type="matrix2"）');
  if (vectorParam === null) return domainFail('缺少向量参数（type="vector2"）');
  if (!isMatrix2(matrixParam.value)) {
    return domainFail(`参数 ${matrixParam.name}（${matrixParam.id}）不是合法的 2×2 矩阵`);
  }
  if (!isVector2(vectorParam.value)) {
    return domainFail(`参数 ${vectorParam.name}（${vectorParam.id}）不是合法的二维向量`);
  }

  let secondMatrix: Matrix2 | null = null;
  if (
    secondParam !== null &&
    secondParam.id !== matrixParam.id &&
    isMatrix2(secondParam.value)
  ) {
    secondMatrix = secondParam.value;
  }

  const rawOrder = object.config['compose_order'];
  const composeOrder = rawOrder === 'B_then_A' ? 'B_then_A' : 'A_then_B';
  const rawOperation = object.config['operation'];
  const operation = rawOperation === 'matrix_compose' ? 'matrix_compose' : 'matrix_apply';

  return computeMatrix2dResult({
    matrix: matrixParam.value,
    vector: vectorParam.value,
    secondMatrix,
    operation,
    composeOrder,
  });
}

/** 模板初始矩阵/向量（重置时回到此处；与示例对象一致） */
export const MATRIX_TEMPLATE_DEFAULTS = {
  matrix: [
    [1, 1],
    [0, 1],
  ] as Matrix2,
  vector: [1, 1] as Vector2,
} as const;
/* -------------------------------------------------------------------------- */
/* C-UI@1 P1 澄清的冻结签名（§2.2.11，T5/T6 直接 import）                     */
/* -------------------------------------------------------------------------- */

/** 非法输入时的安全降级结果：保证 `result` 的每个字段都可读，避免消费方读到 undefined。 */
function emptyMatrix2dResult(): Matrix2dResult {
  const zero: Vector2 = [0, 0];
  return {
    ax: zero,
    columns: [zero, zero],
    det: 0,
    trace: 0,
    rank: 0,
    eigenvalues: { real: true, values: [0, 0] },
    invertible: false,
    inverse: null,
    singular_reason: SINGULAR_REASON,
    steps: [
      {
        step: 1,
        title: '取输入坐标当倍数',
        terms: [
          { coefficient: 0, column_index: 0, column: zero },
          { coefficient: 0, column_index: 1, column: zero },
        ],
      },
      { step: 2, title: '组合各列', partial: zero, result: zero },
    ],
    composition: null,
    ellipse: null,
  };
}

/**
 * `matrix_2d` 派生（签名冻结于 §2.2.11 P1 澄清）。
 * `error` 非空表示输入非法（含参数名与允许范围，符合 C-ERR@1 的 MISSING_FIELD 文案规则）；
 * 此时 `result` 仍是一份结构完整的安全降级值，调用方应先看 `error` 再渲染。
 */
export function calcMatrix2d(object: KnowledgeObject): {
  result: Matrix2dResult;
  error: string | null;
} {
  const outcome = deriveMatrix2d(object);
  if (outcome.ok) return { result: outcome.result, error: null };
  const fallback = computeMatrix2dResult({ matrix: IDENTITY_MATRIX, vector: ZERO_VECTOR });
  return {
    result: fallback.ok ? fallback.result : emptyMatrix2dResult(),
    error: outcome.error,
  };
}
