import type { LabCheck, LabModel, LabProblem, LabResultBase, LabResultFrame, LabResultMetric } from './types.ts';
import { readArrayNumbers, readNumber, readString } from './types.ts';

export type LinAlgKind = 'linear_system' | 'determinant' | 'inverse' | 'matmul' | 'eigen';

export interface LinAlgFrame extends LabResultFrame {
  action: 'initial' | 'swap' | 'pivot' | 'scale' | 'eliminate' | 'eliminated' | 'back_sub' | 'rref' | 'singular' | 'result' | 'element';
  pseudocodeLine: number;
}

export interface LinAlgResult extends LabResultBase {
  subject: 'linear_algebra';
  engine: 'gauss_v1' | 'matmul_v1';
  laKind: LinAlgKind;
  status: 'ok' | 'blocked';
  reason?: string;
  method: string;
  pivoting: string;
  op: string;
  order: string;
  scalar: number;
  matrixA: number[][] | null;
  matrixAExact?: string[][] | null;
  matrixB: number[][] | null;
  vectorB: number[] | null;
  variables: string[];
  det: number | null;
  solution: (number | null)[];
  inverse: number[][] | null;
  resultMatrix: number[][] | null;
  answer: string;
  answerVector: number[] | null;
  stopReason: string | null;
  pseudocode: string[];
  frames: LinAlgFrame[];
  trace: LinAlgFrame[];
}

const EPS = 1e-9;
const MAX_DIM = 5;
const MAX_CELLS = 25;

export const LINALG_PSEUDOCODE = [
  '写出（增广）矩阵',
  '每列选取非零主元，必要时交换两行',
  '逐行消元：把主元下方（若尔当则上下）化为 0',
  '回代或化简后读出结果',
  '用代回 / 乘积核对结果',
];

const OP_LABELS: Record<string, string> = { mul: 'A·B', add: 'A+B', sub: 'A−B', scalar: 'kA' };

function fmt(value: number | null | undefined, digits = 5): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const rounded = Number(value.toPrecision(digits));
  return String(rounded);
}

function matText(matrix: (number | null)[][]): string {
  return `[${matrix.map((row) => row.map((v) => fmt(v)).join(', ')).join('; ')}]`;
}

function clone(matrix: number[][]): number[][] {
  return matrix.map((row) => [...row]);
}

function isMatrix(value: unknown): value is number[][] {
  return Array.isArray(value) && value.length > 0
    && value.every((row) => Array.isArray(row) && row.length > 0
      && row.every((item) => typeof item === 'number' && Number.isFinite(item)))
    && value.every((row) => row.length === (value[0] as number[]).length);
}

function isSquare(matrix: number[][] | null): matrix is number[][] {
  return !!matrix && matrix.every((row) => row.length === matrix.length);
}

function record(
  frames: LinAlgFrame[],
  w: (number | null)[][],
  action: LinAlgFrame['action'],
  label: string,
  detail: string,
  line: number,
  values: Record<string, unknown> = {},
): void {
  frames.push({
    index: frames.length,
    action,
    label,
    detail,
    values: { matrix: w.map((row) => [...row]), ...values },
    pseudocodeLine: line,
  });
}

function blocked(model: LabModel, engine: LinAlgResult['engine'], reason: string): LinAlgResult {
  return {
    subject: 'linear_algebra', engine, laKind: (model.la_kind as LinAlgKind) ?? 'linear_system',
    status: 'blocked', reason, headline: reason,
    method: '', pivoting: '', op: String(model.op ?? 'mul'), order: 'ab',
    scalar: readNumber(model.defaults.scalar, 2),
    matrixA: isMatrix(model.matrix_a) ? model.matrix_a : null,
    matrixB: isMatrix(model.matrix_b) ? model.matrix_b : null,
    vectorB: readArrayNumbers(model.vector_b),
    variables: [], det: null, solution: [], inverse: null, resultMatrix: null,
    answer: '', answerVector: null, stopReason: null,
    pseudocode: engine === 'gauss_v1' ? LINALG_PSEUDOCODE : [],
    metrics: [], checks: [], notes: [], frames: [], trace: [],
  };
}

/* ------------------------------------------------------------------ */
/* 高斯 / 高斯-若尔当消元轨迹                                            */
/* ------------------------------------------------------------------ */

function eliminate(
  w: number[][], n: number, method: string, pivoting: string, frames: LinAlgFrame[], aug = 0,
): { det: number; singular: boolean } {
  let det = 1;
  for (let col = 0; col < n; col += 1) {
    let pivotRow = -1;
    if (pivoting === 'partial') {
      pivotRow = col;
      for (let r = col + 1; r < n; r += 1) {
        if (Math.abs(w[r]![col]!) > Math.abs(w[pivotRow]![col]!)) pivotRow = r;
      }
    } else {
      for (let r = col; r < n; r += 1) {
        if (Math.abs(w[r]![col]!) > EPS) { pivotRow = r; break; }
      }
    }
    if (pivotRow < 0 || Math.abs(w[pivotRow]![col]!) <= EPS) {
      record(frames, w, 'singular', `第 ${col + 1} 列找不到非零主元`,
        '该列在主行及以下全为 0，矩阵奇异；方程组无唯一解，逆矩阵/行列式结论随之确定。',
        2, { pivot: { row: col, col }, aug });
      return { det, singular: true };
    }
    if (pivotRow !== col) {
      const tmp = w[col]!; w[col] = w[pivotRow]!; w[pivotRow] = tmp;
      det = -det;
      record(frames, w, 'swap', `交换 R${pivotRow + 1} ↔ R${col + 1}`,
        `把绝对值最大的主元 ${fmt(w[col]![col])} 换到第 ${col + 1} 行；行列式变号。`,
        2, { rows: [pivotRow, col], pivot: { row: col, col }, aug });
    }
    const pivot = w[col]![col]!;
    record(frames, w, 'pivot', `第 ${col + 1} 列主元 = ${fmt(pivot)}`,
      '以该元素为主元，把同列其它元素消为 0。',
      2, { pivot: { row: col, col }, aug });
    if (method === 'jordan' && Math.abs(pivot - 1) > EPS) {
      w[col] = w[col]!.map((v) => v / pivot);
      record(frames, w, 'scale', `R${col + 1} ← R${col + 1} ÷ ${fmt(pivot)}`,
        '若尔当法先把主元化为 1，再消上下两方向。',
        3, { rows: [col], pivot: { row: col, col }, aug });
    }
    det *= pivot;
    const targets: number[] = [];
    if (method === 'jordan') {
      for (let r = 0; r < n; r += 1) { if (r !== col) targets.push(r); }
    } else {
      for (let r = col + 1; r < n; r += 1) targets.push(r);
    }
    for (const r of targets) {
      if (Math.abs(w[r]![col]!) <= EPS) continue;
      const factor = w[r]![col]! / w[col]![col]!;
      w[r] = w[r]!.map((v, c) => v - factor * w[col]![c]!);
      record(frames, w, 'eliminate', `R${r + 1} ← R${r + 1} − (${fmt(factor)})·R${col + 1}`,
        `消去第 ${r + 1} 行第 ${col + 1} 列元素；行列式不变。`,
        3, { rows: [r], factor, pivot: { row: col, col }, aug });
    }
  }
  return { det, singular: false };
}

function evalGauss(model: LabModel, params: Record<string, unknown>): LinAlgResult {
  const kind = (model.la_kind ?? 'linear_system') as LinAlgKind;
  const a = isMatrix(model.matrix_a) ? model.matrix_a : null;
  const b = readArrayNumbers(model.vector_b);
  const method = readString(params.method ?? model.defaults.method, 'gauss') || 'gauss';
  const pivoting = readString(params.pivoting ?? model.defaults.pivoting, 'partial') || 'partial';
  const variables = Array.isArray(model.variables) ? model.variables.map(String) : [];

  let reason = '';
  if (!['linear_system', 'determinant', 'inverse'].includes(kind)) {
    return blocked(model, 'gauss_v1', '该任务不能使用高斯消元；特征值须读取已核验的精确内核结果。');
  }
  if ((kind === 'determinant' || kind === 'inverse') && !isSquare(a)) {
    reason = `${kind === 'determinant' ? '行列式' : '逆矩阵'}需要 n×n 方阵，请核对矩阵 A 的行数与列数。`;
  }
  if (kind === 'linear_system') {
    if (!a || !isSquare(a)) reason = '线性方程组的系数矩阵需要 n×n 方阵；可在条件中以增广矩阵补充最后一列。';
    else if (!b.length || b.length !== a.length) reason = '右端向量 b 的长度须与矩阵阶数一致。';
  }
  if (a && (a.length > MAX_DIM || a.some((row) => row.length > MAX_DIM + 1))) {
    reason = `首版仅支持 ${MAX_DIM} 阶以内的矩阵，保证逐步轨迹可读。`;
  }
  if (reason || !a) return blocked(model, 'gauss_v1', reason || '缺少矩阵数据');

  const n = a.length;
  let w: number[][];
  let aug: number;
  if (kind === 'linear_system') {
    w = a.map((row, i) => [...row, b[i]!]); aug = 1;
  } else if (kind === 'inverse') {
    w = a.map((row, i) => [...row, ...row.map((_, j) => (j === i ? 1 : 0))]); aug = n;
  } else {
    w = clone(a); aug = 0;
  }

  const frames: LinAlgFrame[] = [];
  const title = kind === 'linear_system' ? '增广矩阵 [A|b]' : kind === 'inverse' ? '增广矩阵 [A|I]' : '矩阵 A';
  record(frames, w, 'initial', `写出${title}`,
    '消元轨迹从此矩阵开始；每一步行变换都记录在内。', 1, { aug, det: 1 });

  const { det: detSigned, singular } = eliminate(
    w, n, kind === 'determinant' ? 'gauss' : method, pivoting, frames, aug,
  );
  const det = detSigned;
  const solution: (number | null)[] = new Array<number | null>(n).fill(null);
  let answer = '';
  let answerVector: number[] | null = null;
  let inverse: number[][] | null = null;
  let headline = '';
  let checks: LabCheck[] = [];

  if (singular) {
    record(frames, w, 'result', '无法继续',
      '矩阵在该主元策略下奇异；结论与轨迹均保留供核对。', 5, { aug, det, solution: [...solution] });
    headline = '矩阵奇异，无唯一解';
    checks = [{
      id: 'singular', label: '主元检查', status: 'fail',
      detail: '某列在主行及以下全为 0；可换主元策略或核对原题数据。',
    }];
  } else if (kind === 'determinant') {
    record(frames, w, 'eliminated', '已化为上三角矩阵',
      '行列式 = 换行次数的符号 × 主对角线主元乘积。', 4, { aug, det });
    answer = `det(A) = ${fmt(det)}`;
    headline = answer;
    checks = [{
      id: 'det_check', label: '行列式符号', status: 'pass',
      detail: '只统计换行次数；倍加行变换不改变行列式。',
    }];
  } else if (kind === 'inverse') {
    if (method === 'gauss') {
      record(frames, w, 'eliminated', '前向消元完成，继续向上消元',
        '高斯法：先化上三角，再从下到上消去主元上方元素并归一。', 4, { aug, det });
      for (let col = n - 1; col >= 0; col -= 1) {
        const pivot = w[col]![col]!;
        if (Math.abs(pivot - 1) > EPS) {
          w[col] = w[col]!.map((v) => v / pivot);
          record(frames, w, 'scale', `R${col + 1} ← R${col + 1} ÷ ${fmt(pivot)}`,
            '归一主行，使对角线主元为 1。', 4, { rows: [col], pivot: { row: col, col }, det, aug });
        }
        for (let r = 0; r < col; r += 1) {
          const factor = w[r]![col]!;
          if (Math.abs(factor) <= EPS) continue;
          w[r] = w[r]!.map((v, c) => v - factor * w[col]![c]!);
          record(frames, w, 'eliminate', `R${r + 1} ← R${r + 1} − (${fmt(factor)})·R${col + 1}`,
            '消去主元上方元素，左半向单位阵靠近。', 4, { rows: [r], factor, pivot: { row: col, col }, det, aug });
        }
      }
    } else {
      record(frames, w, 'eliminated', '已化为行最简形 [I|A⁻¹]',
        '若尔当法一次消完上下两个方向，右半即为逆矩阵。', 4, { aug, det });
    }
    inverse = w.map((row) => row.slice(n));
    answer = `A⁻¹ = ${matText(inverse)}`;
    answerVector = inverse.flat();
    headline = '右半矩阵即 A⁻¹';
    let deviation = 0;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        let sum = 0;
        for (let k = 0; k < n; k += 1) sum += a[i]![k]! * inverse[k]![j]!;
        deviation = Math.max(deviation, Math.abs(sum - (i === j ? 1 : 0)));
      }
    }
    checks = [{
      id: 'inverse', label: '乘积 A·A⁻¹≈I', status: deviation <= 1e-6 ? 'pass' : 'warn',
      detail: `最大偏差 ${fmt(deviation, 3)}。`,
    }];
  } else {
    if (method === 'gauss') {
      record(frames, w, 'eliminated', '上三角完成，开始回代',
        '自下而上逐个求解：xᵢ = (bᵢ − Σaᵢⱼxⱼ) / aᵢᵢ。', 4, { aug, det });
      for (let i = n - 1; i >= 0; i -= 1) {
        let rest = 0;
        for (let j = i + 1; j < n; j += 1) rest += w[i]![j]! * (solution[j] ?? 0);
        const value = (w[i]![n]! - rest) / w[i]![i]!;
        solution[i] = value;
        const name = variables[i] ?? `x${i + 1}`;
        record(frames, w, 'back_sub', `${name} = ${fmt(value)}`,
          `(${fmt(w[i]![n])} − ${fmt(rest)}) ÷ ${fmt(w[i]![i])}；已代入后行结果。`,
          4, { rows: [i], solution: [...solution], det, aug });
      }
    } else {
      for (let i = 0; i < n; i += 1) solution[i] = w[i]![n]!;
      record(frames, w, 'rref', '已化为行最简形，直接读出解',
        '左半为单位阵，最后一列即解向量。', 4, { aug, solution: [...solution], det });
    }
    answerVector = solution.map((v) => v ?? 0);
    const names = variables.length === n ? variables : solution.map((_, i) => `x${i + 1}`);
    answer = names.map((name, i) => `${name} = ${fmt(solution[i])}`).join('，');
    headline = `x = (${solution.map((v) => fmt(v)).join(', ')})`;
    let residual = 0;
    for (let i = 0; i < n; i += 1) {
      let sum = 0;
      for (let j = 0; j < n; j += 1) sum += a[i]![j]! * (solution[j] ?? 0);
      residual += (sum - b[i]!) ** 2;
    }
    residual = Math.sqrt(residual);
    checks = [{
      id: 'residual', label: '残差 ‖Ax−b‖', status: residual <= 1e-6 ? 'pass' : 'warn',
      detail: `把解代回原方程，最大残差 ${fmt(residual, 3)}。`,
    }];
  }
  if (!singular) {
    record(frames, w, 'result', '结果', answer || '计算完成。', 5, { aug, det, solution: [...solution] });
  }

  const metrics: LabResultMetric[] = [
    { id: 'size', label: '规模', value: `${n}×${n}` },
    { id: 'det', label: 'det(A)', value: fmt(det) },
    { id: 'method', label: '方法', value: method === 'jordan' && kind !== 'determinant' ? '高斯-若尔当' : '高斯消元' },
    { id: 'pivoting', label: '主元策略', value: pivoting === 'partial' ? '部分主元' : '不选主元' },
  ];
  return {
    subject: 'linear_algebra', engine: 'gauss_v1', laKind: kind, status: 'ok',
    method, pivoting, op: '', order: '', scalar: 0,
    matrixA: a, matrixB: null, vectorB: b, variables,
    det, solution, inverse, resultMatrix: null,
    answer, answerVector, headline, metrics, checks,
    stopReason: singular ? 'singular' : 'done',
    pseudocode: LINALG_PSEUDOCODE,
    notes: ['行号从 1 开始；换行使行列式变号，倍加变换不变。', '若尔当法把主元先归一，再消上下两个方向。'],
    frames, trace: frames,
  };
}

/* ------------------------------------------------------------------ */
/* 矩阵基本运算轨迹                                                     */
/* ------------------------------------------------------------------ */

function evalMatop(model: LabModel, params: Record<string, unknown>): LinAlgResult {
  const a = isMatrix(model.matrix_a) ? model.matrix_a : null;
  const b = isMatrix(model.matrix_b) ? model.matrix_b : null;
  const op = String(model.op ?? 'mul');
  const order = readString(params.order ?? model.defaults.order, 'ab') || 'ab';
  const scalar = readNumber(params.scalar ?? model.defaults.scalar, 2);

  let reason = '';
  if (op === 'mul') {
    if (!a || !b) reason = '矩阵乘法需要两个矩阵 A 与 B。';
    else if (a[0]!.length !== b.length) {
      reason = `维度不匹配：A 是 ${a.length}×${a[0]!.length}，B 是 ${b.length}×${b[0]!.length}；要求 A 的列数等于 B 的行数。`;
    } else if (a.length * b[0]!.length > MAX_CELLS) reason = `乘积超过 ${MAX_CELLS} 个元素；首版逐步演示只支持小型矩阵。`;
  } else if (op === 'add' || op === 'sub') {
    if (!a || !b) reason = '矩阵加减需要两个同形矩阵。';
    else if (a.length !== b.length || a[0]!.length !== b[0]!.length) reason = '矩阵加减要求 A 与 B 形状完全相同。';
    else if (a.length * a[0]!.length > MAX_CELLS) reason = `超过 ${MAX_CELLS} 个元素；首版逐步演示只支持小型矩阵。`;
  } else {
    if (!a) reason = '数乘需要一个矩阵 A。';
    else if (a.length * a[0]!.length > MAX_CELLS) reason = `超过 ${MAX_CELLS} 个元素；首版逐步演示只支持小型矩阵。`;
  }
  if (reason || !a) return blocked(model, 'matmul_v1', reason || '缺少矩阵数据');

  const left = order === 'ba' ? b! : a;
  const right = order === 'ba' ? a! : b!;
  const frames: LinAlgFrame[] = [];
  let answer = '';
  let headline = '';
  let c: (number | null)[][] = [];

  if (op === 'mul') {
    const rows = left.length; const inner = right.length; const cols = right[0]!.length;
    c = Array.from({ length: rows }, () => new Array<number | null>(cols).fill(null));
    record(frames, c, 'initial',
      `计算 ${order !== 'ba' ? 'A·B' : 'B·A'}：${left.length}×${left[0]!.length} · ${right.length}×${right[0]!.length}`,
      '结果每个元素 = 左矩阵一行与右矩阵一列逐项相乘再求和。',
      0, { a: left, b: right, cell: null, terms: [], op_label: '' });
    for (let i = 0; i < rows; i += 1) {
      for (let j = 0; j < cols; j += 1) {
        const terms = Array.from({ length: inner }, (_, k) => left[i]![k]! * right[k]![j]!);
        const value = terms.reduce((sum, item) => sum + item, 0);
        c[i]![j] = value;
        const opLabel = Array.from({ length: inner }, (_, k) => `${fmt(left[i]![k])}·${fmt(right[k]![j])}`).join(' + ');
        record(frames, c, 'element', `C[${i + 1},${j + 1}] = ${fmt(value)}`,
          `第 ${i + 1} 行 · 第 ${j + 1} 列：${opLabel} = ${fmt(value)}。`,
          0, { a: left, b: right, cell: { row: i, col: j }, terms, op_label: `${opLabel} = ${fmt(value)}` });
      }
    }
    answer = `${order !== 'ba' ? 'A·B' : 'B·A'} = ${matText(c)}`;
    headline = `乘积矩阵 ${left.length}×${right[0]!.length} 已算出`;
  } else {
    c = a.map(() => new Array<number | null>(a[0]!.length).fill(null));
    const titles: Record<string, string> = { add: 'A+B 逐元素相加', sub: 'A−B 逐元素相减', scalar: `${fmt(scalar)}·A 数乘` };
    record(frames, c, 'initial', titles[op] ?? '矩阵运算',
      '矩阵逐元素运算；每个元素独立计算。',
      0, { a, b: op === 'scalar' ? null : b, cell: null, terms: [], op_label: '' });
    for (let i = 0; i < a.length; i += 1) {
      for (let j = 0; j < a[0]!.length; j += 1) {
        let value = 0; let opLabel = ''; let terms: number[] = [];
        if (op === 'add') { value = a[i]![j]! + b![i]![j]!; opLabel = `${fmt(a[i]![j])} + ${fmt(b![i]![j])}`; terms = [a[i]![j]!, b![i]![j]!]; }
        else if (op === 'sub') { value = a[i]![j]! - b![i]![j]!; opLabel = `${fmt(a[i]![j])} − ${fmt(b![i]![j])}`; terms = [a[i]![j]!, b![i]![j]!]; }
        else { value = scalar * a[i]![j]!; opLabel = `${fmt(scalar)}·${fmt(a[i]![j])}`; terms = [scalar, a[i]![j]!]; }
        c[i]![j] = value;
        record(frames, c, 'element', `C[${i + 1},${j + 1}] = ${fmt(value)}`,
          `${opLabel} = ${fmt(value)}。`,
          0, { a, b: op === 'scalar' ? null : b, cell: { row: i, col: j }, terms, op_label: `${opLabel} = ${fmt(value)}` });
      }
    }
    answer = `${OP_LABELS[op] ?? 'C'} = ${matText(c)}`;
    headline = `${(titles[op] ?? '矩阵运算').split(' ')[0]} 已算出`;
  }
  record(frames, c, 'result', '结果', answer, 0, {
    a: op === 'mul' ? left : a,
    b: op === 'mul' ? right : (op === 'scalar' ? null : b),
    cell: null, terms: [], op_label: '',
  });

  const answerVector = c.flat().filter((v): v is number => v !== null);
  const metrics: LabResultMetric[] = [
    { id: 'op', label: '运算', value: OP_LABELS[op] + (op === 'mul' && order === 'ba' ? '（已交换为 B·A）' : '') },
    { id: 'shape', label: '结果形状', value: `${c.length}×${c[0]!.length}` },
    { id: 'cells', label: '元素步数', value: String(frames.length - 2) },
  ];
  const checks: LabCheck[] = [{
    id: 'shape', label: '维度核对', status: 'pass',
    detail: op === 'mul' ? '左矩阵列数 = 右矩阵行数，可乘。' : op === 'scalar' ? '标量逐元素相乘。' : '同形矩阵逐元素运算。',
  }];
  return {
    subject: 'linear_algebra', engine: 'matmul_v1', laKind: 'matmul', status: 'ok',
    method: '', pivoting: '', op, order, scalar,
    matrixA: a, matrixB: b, vectorB: [], variables: [],
    det: null, solution: [], inverse: null,
    resultMatrix: c.map((row) => row.map((v) => v ?? 0)),
    answer, answerVector, headline, metrics, checks,
    stopReason: 'done', pseudocode: [],
    notes: ['矩阵乘法不满足交换律：A·B 与 B·A 一般不同。', '逐步帧展示每个元素的乘积求和过程。'],
    frames, trace: frames,
  };
}

export function replayEigen(problem: LabProblem): LinAlgResult {
  const solution = problem.solution;
  const base = blocked(problem.model, 'gauss_v1', '请先核对公式与条件，再运行精确特征值内核。');
  if (problem.status !== 'ready' || !solution.answer || solution.solution_complete !== true
      || problem.recognition.ambiguities.some((item) => item.severity === 'blocking' && !item.resolved)) return base;
  const frames: LinAlgFrame[] = solution.steps.map((step, index) => ({
    index, action: 'result', label: step.title, detail: step.detail,
    values: {}, pseudocodeLine: index + 1,
  }));
  return {
    ...base, status: 'ok', reason: undefined, method: 'exact',
    matrixAExact: problem.model.matrix_a_exact,
    headline: solution.summary, answer: solution.answer, stopReason: 'done',
    pseudocode: solution.steps.map((step) => step.title), frames, trace: frames,
    checks: solution.checks ?? [], notes: solution.limitations ?? [],
    metrics: [{ id: 'method', label: '方法', value: '精确特征多项式与零空间' }],
  };
}

export function evaluateLinAlg(model: LabModel, params: Record<string, unknown>): LinAlgResult {
  if (model.la_kind === 'matmul') return evalMatop(model, params);
  return evalGauss(model, params);
}
