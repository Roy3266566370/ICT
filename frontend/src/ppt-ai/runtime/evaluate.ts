/**
 * PPT AI 前端确定性求值：与后端 evaluation.py 同源同口径。
 * 只消费登记算子；无法识别的 provider 明确报错，不伪造数值。
 */

import { compileExpression } from '../../labs/expr.ts';
import { computeLab } from '../../labs/compute.ts';
import type { LabProblem } from '../../labs/types.ts';
import type { CompiledNode, InteractionBundle, OutputSpec, PlanParameter } from '../types.ts';
import { evaluateTemplate, isTemplateKind } from '../templates/index.ts';
import type { TemplateEvaluation } from '../templates/types.ts';

export type CanonicalValue = number | boolean | string | number[] | number[][];
export type CanonicalValues = Record<string, CanonicalValue>;
export type OverrideValues = Record<string, CanonicalValues>;

export interface EvaluationMetric { id: string; label: string; value: string; tone?: string }
export interface EvaluationCheck {
  id: string; label: string; status: 'pass' | 'fail' | 'warn'; detail: string;
}
export interface SeriesPoint { x: number; y: number | null }
export interface RectPoint { x0: number; x1: number; mid?: number; height: number }

export interface PptAiEvaluation {
  nodeId: string;
  values: Record<string, unknown>;
  subject: string;
  metrics: EvaluationMetric[];
  series: SeriesPoint[];
  rects: RectPoint[];
  table: { headers: string[]; rows: (string | number)[][] } | null;
  chart: { categories: string[]; series: { name: string; values: number[] }[] } | null;
  text: string;
  trace: Record<string, unknown>[];
  checks: EvaluationCheck[];
  error: string | null;
  domain: { x_min: number; x_max: number } | null;
  tangent: { m: number; b: number } | null;
  geometry: Record<string, unknown> | null;
  outputs: Record<string, CanonicalValue>;
  overlaySeries: SeriesPoint[];
  overlayLabel: string;
  points: { x: number; y: number; label?: string }[];
  projection: {
    series: [number, number][];
    rects: RectPoint[];
    domain: { x_min: number; x_max: number };
    metrics: EvaluationMetric[];
  } | null;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function scaleValue(value: CanonicalValue, factor: number): CanonicalValue {
  if (factor === 1) return value;
  if (typeof value === 'number') return value * factor;
  if (Array.isArray(value)) {
    return value.map((item) => (Array.isArray(item) ? item.map((cell) => cell * factor) : item * factor)) as CanonicalValue;
  }
  return value;
}

export function parameterValue(
  parameter: PlanParameter,
  values: CanonicalValues,
  derived: CanonicalValues = {},
): unknown {
  const binding = parameter.binding;
  if (binding?.mode === 'linked' && binding.concept_id in derived) {
    const value = derived[binding.concept_id];
    return value === undefined ? parameter.default : scaleValue(value, binding.factor ?? 1);
  }
  return values[parameter.concept_id] ?? parameter.default;
}

export function inputValues(
  node: CompiledNode,
  values: CanonicalValues,
  derived: CanonicalValues = {},
  overrides: CanonicalValues = {},
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  node.parameters.forEach((parameter) => {
    result[parameter.id] = parameter.concept_id in overrides
      ? overrides[parameter.concept_id]
      : parameterValue(parameter, values, derived);
  });
  return result;
}

function baseEvaluation(node: CompiledNode, values: Record<string, unknown>): PptAiEvaluation {
  return {
    nodeId: node.node_id,
    values,
    subject: '',
    metrics: [],
    series: [],
    rects: [],
    table: null,
    chart: null,
    text: '',
    trace: [],
    checks: [],
    error: null,
    domain: null,
    tangent: null,
    geometry: null,
    outputs: {},
    overlaySeries: [],
    overlayLabel: '',
    points: [],
    projection: null,
  };
}

/**
 * 与后端 declared_output_value 同口径：按 OutputSpec 从内核原始结果取可引用值。
 * 模板/Lab 内核的顶层键（taylor 的 approx、integral 的 exact、newton 的 f_final…）
 * 必须进 evaluation.outputs，否则前端派生值会与落库快照系统性分叉。
 */
function declaredOutputValue(raw: Record<string, unknown>, output: OutputSpec): CanonicalValue | null {
  const value = raw[output.key];
  if (output.type === 'vector2' || output.type === 'number_list' || output.type === 'number_matrix' || output.type === 'matrix2') {
    if (Array.isArray(value) && value.length > 0) return value as CanonicalValue;
    return null;
  }
  if (output.type === 'number' || output.type === 'integer') {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return null;
  }
  if (output.type === 'boolean') return typeof value === 'boolean' ? value : null;
  if (output.type === 'string' || output.type === 'enum') return typeof value === 'string' ? value : null;
  return null;
}

function fillDeclaredOutputs(evaluation: PptAiEvaluation, node: CompiledNode, raw: Record<string, unknown>): void {
  (node.outputs ?? []).forEach((output) => {
    const value = declaredOutputValue(raw, output);
    if (value !== null) evaluation.outputs[output.key] = value;
  });
}

function templateEvaluation(node: CompiledNode, values: Record<string, unknown>, provider: Record<string, unknown>): PptAiEvaluation {
  const raw: TemplateEvaluation = evaluateTemplate(String(provider.kind ?? ''), values, provider);
  const evaluation = baseEvaluation(node, values);
  evaluation.subject = raw.subject;
  evaluation.metrics = metricsFrom({ metrics: raw.metrics });
  evaluation.checks = checksFrom({ checks: raw.checks });
  evaluation.series = raw.series;
  evaluation.overlaySeries = raw.overlaySeries ?? [];
  evaluation.overlayLabel = raw.overlayLabel ?? '';
  evaluation.points = raw.points ?? [];
  evaluation.table = raw.table
    ? { headers: raw.table.headers, rows: raw.table.rows }
    : null;
  evaluation.trace = raw.trace;
  evaluation.error = typeof raw.error === 'string' ? raw.error : null;
  // 按 OutputSpec 把内核顶层键写进 outputs，与后端 declared_output_value 对齐。
  fillDeclaredOutputs(evaluation, node, raw as Record<string, unknown>);
  const finitePoints = raw.series.filter((point) => point.y !== null);
  if (finitePoints.length > 0) {
    const min = Math.min(...finitePoints.map((point) => point.x));
    const max = Math.max(...finitePoints.map((point) => point.x));
    evaluation.domain = { x_min: min, x_max: max > min ? max : min + 1 };
    evaluation.projection = {
      series: finitePoints.map((point) => [point.x, point.y as number]),
      rects: [],
      domain: evaluation.domain,
      metrics: evaluation.metrics,
    };
  }
  if (typeof raw.text === 'string') evaluation.text = raw.text;
  return evaluation;
}

function metricsFrom(result: Record<string, unknown>): EvaluationMetric[] {
  const raw = result.metrics;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      id: String(item.id ?? ''),
      label: String(item.label ?? item.id ?? ''),
      value: String(item.value ?? '—'),
      tone: typeof item.tone === 'string' ? item.tone : undefined,
    }));
}

function checksFrom(result: Record<string, unknown>): EvaluationCheck[] {
  const raw = result.checks;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      id: String(item.id ?? ''),
      label: String(item.label ?? item.id ?? '检查'),
      status: item.status === 'fail' ? 'fail' : item.status === 'warn' ? 'warn' : 'pass',
      detail: String(item.detail ?? ''),
    }));
}

function evaluationFromLab(node: CompiledNode, values: Record<string, unknown>): PptAiEvaluation {
  const provider = node.provider as Record<string, unknown>;
  const subject = String(provider.subject ?? '');
  const model = provider.model as Record<string, unknown> | undefined;
  if (!model) throw new Error('缺少 Lab 模型');
  const problem = {
    subject,
    model,
    solution: { answer_value: null, answer_point: null },
  } as unknown as LabProblem;
  const result = computeLab(problem, values) as unknown as Record<string, unknown>;
  const evaluation = baseEvaluation(node, values);
  evaluation.subject = subject;
  evaluation.metrics = metricsFrom(result);
  evaluation.checks = checksFrom(result);
  evaluation.trace = Array.isArray(result.trace) ? (result.trace as Record<string, unknown>[]) : [];
  // 按 OutputSpec 把 Lab 结果顶层键写进 outputs，与后端 declared_output_value 对齐。
  fillDeclaredOutputs(evaluation, node, result);
  const series = Array.isArray(result.series) ? result.series : [];
  evaluation.series = series
    .filter((point): point is Record<string, unknown> => typeof point === 'object' && point !== null)
    .map((point) => ({ x: numberValue(point.x), y: typeof point.y === 'number' && Number.isFinite(point.y) ? point.y : null }));
  const rects = Array.isArray(result.rects) ? result.rects : [];
  evaluation.rects = rects
    .filter((rect): rect is Record<string, unknown> => typeof rect === 'object' && rect !== null)
    .map((rect) => ({
      x0: numberValue(rect.x0),
      x1: numberValue(rect.x1),
      mid: numberValue(rect.mid),
      height: numberValue(rect.height),
    }));
  const domain = result.domain as Record<string, unknown> | undefined;
  if (domain && typeof domain.x_min === 'number' && typeof domain.x_max === 'number') {
    evaluation.domain = { x_min: domain.x_min, x_max: domain.x_max };
  }
  const point = result.point as Record<string, unknown> | undefined;
  const tangent = point?.tangent as Record<string, unknown> | undefined;
  if (tangent && typeof tangent.m === 'number' && typeof tangent.b === 'number') {
    evaluation.tangent = { m: tangent.m, b: tangent.b };
  }
  evaluation.text = String(result.headline ?? '');
  if (evaluation.domain) {
    evaluation.projection = {
      series: evaluation.series
        .filter((point) => point.y !== null)
        .map((point) => [point.x, point.y as number]),
      rects: evaluation.rects,
      domain: evaluation.domain,
      metrics: evaluation.metrics,
    };
  }
  return evaluation;
}

function expressionEvaluation(node: CompiledNode, values: Record<string, unknown>): PptAiEvaluation {
  const provider = node.provider as Record<string, unknown>;
  const source = String(provider.expression ?? '');
  const variables = Array.isArray(provider.variables) ? provider.variables.map(String) : ['x'];
  const compiled = compileExpression(source, variables);
  const current = compiled.evalOrNull(values as Record<string, number>);
  const xName = variables.includes('x') ? 'x' : variables[0] ?? 'x';
  const parameter = node.parameters.find((item) => item.id === xName);
  const low = parameter?.min ?? -5;
  const high = parameter?.max ?? 5;
  const series: SeriesPoint[] = [];
  const pointValues = { ...values };
  for (let index = 0; index < 241; index += 1) {
    const x = low + (high - low) * index / 240;
    const y = compiled.evalOrNull({ ...pointValues, [xName]: x } as Record<string, number>);
    series.push({ x, y: y !== null && Number.isFinite(y) ? y : null });
  }
  const evaluation = baseEvaluation(node, values);
  evaluation.subject = 'calculus';
  evaluation.series = series;
  evaluation.domain = { x_min: low, x_max: high };
  evaluation.metrics = [
    { id: 'value', label: '当前值', value: current === null ? '—' : String(Math.round(current * 1e8) / 1e8) },
  ];
  evaluation.checks = [
    {
      id: 'finite',
      label: '表达式有有限值',
      status: current === null ? 'fail' : 'pass',
      detail: current === null ? '当前参数下没有有限值。' : '已按同一表达式求值。',
    },
  ];
  evaluation.text = source;
  evaluation.projection = {
    series: series.filter((point) => point.y !== null).map((point) => [point.x, point.y as number]),
    rects: [],
    domain: { x_min: low, x_max: high },
    metrics: evaluation.metrics,
  };
  return evaluation;
}

function chartEvaluation(node: CompiledNode, values: Record<string, unknown>): PptAiEvaluation {
  const provider = node.provider as Record<string, unknown>;
  const chart = provider.chart as Record<string, unknown> | undefined;
  const categories = Array.isArray(chart?.categories) ? chart!.categories.map(String) : [];
  const series = Array.isArray(chart?.series)
    ? (chart!.series as Record<string, unknown>[]).map((item) => ({
        name: String(item.name ?? ''),
        values: Array.isArray(item.values) ? item.values.map((value) => numberValue(value)) : [],
      }))
    : [];
  const selected = String(values.category ?? '全部');
  const rows: (string | number)[][] = [];
  series.forEach((item) => {
    item.values.forEach((value, index) => {
      if (index < categories.length && (selected === '全部' || categories[index] === selected)) {
        rows.push([categories[index] ?? '', item.name, value]);
      }
    });
  });
  const evaluation = baseEvaluation(node, values);
  evaluation.subject = 'chart';
  evaluation.chart = { categories, series };
  evaluation.table = { headers: ['分类', '系列', '数值'], rows };
  const numeric = rows.map((row) => row[2]).filter((value): value is number => typeof value === 'number');
  evaluation.metrics = [
    { id: 'rows', label: '数据点', value: String(rows.length) },
    { id: 'sum', label: '总计', value: numeric.length ? String(Math.round(numeric.reduce((a, b) => a + b, 0) * 1e8) / 1e8) : '—' },
    { id: 'max', label: '最大值', value: numeric.length ? String(Math.max(...numeric)) : '—' },
  ];
  evaluation.checks = [{ id: 'source_match', label: '数值来自原生图表', status: 'pass', detail: '未经视觉拟合。' }];
  return evaluation;
}

function tableEvaluation(node: CompiledNode, values: Record<string, unknown>): PptAiEvaluation {
  const provider = node.provider as Record<string, unknown>;
  const headers = Array.isArray(provider.headers) ? provider.headers.map(String) : [];
  const rows = Array.isArray(provider.rows)
    ? (provider.rows as unknown[][]).filter(Array.isArray).map((row) => row.map((cell) => String(cell)))
    : [];
  const evaluation = baseEvaluation(node, values);
  evaluation.subject = 'table';
  evaluation.table = { headers, rows };
  evaluation.metrics = [
    { id: 'columns', label: '列数', value: String(headers.length) },
    { id: 'rows', label: '行数', value: String(rows.length) },
  ];
  evaluation.checks = [{ id: 'source_match', label: '单元格来自原生表格', status: 'pass', detail: '未经视觉识别。' }];
  return evaluation;
}

export interface MatrixGeometry {
  matrix: number[][];
  vector: number[];
  product: number[];
  zero_vector: boolean;
  av_zero: boolean;
  collinear: boolean;
  ratio: number | null;
  eigenvalue: number | null;
  is_eigenvector: boolean;
  message: string;
}

export function matrixGeometry(matrix: number[][], vector: number[]): MatrixGeometry {
  const vx = vector[0] ?? 0;
  const vy = vector[1] ?? 0;
  const a11 = matrix[0]?.[0] ?? 1;
  const a12 = matrix[0]?.[1] ?? 0;
  const a21 = matrix[1]?.[0] ?? 0;
  const a22 = matrix[1]?.[1] ?? 1;
  const product = [a11 * vx + a12 * vy, a21 * vx + a22 * vy];
  const ax = product[0] ?? 0;
  const ay = product[1] ?? 0;
  const normV = Math.hypot(vx, vy);
  const normAv = Math.hypot(ax, ay);
  const cross = vx * ay - vy * ax;
  const dot = vx * ax + vy * ay;
  const zeroVector = normV <= 1e-12;
  const avZero = normAv <= 1e-12;
  let collinear = false;
  let ratio: number | null = null;
  let eigenvalue: number | null = null;
  if (!zeroVector) {
    if (avZero) {
      collinear = true;
      eigenvalue = 0;
    } else if (Math.abs(cross) <= 1e-9 * Math.max(1, normV * normAv)) {
      collinear = true;
      ratio = dot / (normV * normV);
      eigenvalue = ratio;
    }
  }
  return {
    matrix,
    vector,
    product,
    zero_vector: zeroVector,
    av_zero: avZero,
    collinear,
    ratio,
    eigenvalue,
    is_eigenvector: collinear,
    message: zeroVector
      ? '零向量不能作为特征向量。'
      : avZero
        ? 'Av=0：这是一个非零特征向量，特征值为 0。'
        : collinear && ratio !== null
          ? `共线，倍率 ${Math.round(ratio * 1e6) / 1e6}。`
          : 'Av 与 v 不共线，当前向量不是特征向量。',
  };
}

function matrixEvaluation(node: CompiledNode, values: Record<string, unknown>): PptAiEvaluation {
  const provider = node.provider as Record<string, unknown>;
  const base = Array.isArray(provider.matrix) ? (provider.matrix as number[][]) : [[1, 0], [0, 1]];
  const matrix = [[0, 0], [0, 0]];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      matrix[row]![column] = numberValue(values[`a${row + 1}${column + 1}`], numberValue(base[row]?.[column]));
    }
  }
  const baseVector = Array.isArray(provider.vector) ? (provider.vector as number[]) : null;
  const vector = baseVector
    ? [numberValue(values.v1, numberValue(baseVector[0])), numberValue(values.v2, numberValue(baseVector[1]))]
    : null;
  const det = matrix[0]![0]! * matrix[1]![1]! - matrix[0]![1]! * matrix[1]![0]!;
  const product = vector
    ? [
        Math.round((matrix[0]![0]! * vector[0]! + matrix[0]![1]! * vector[1]!) * 1e8) / 1e8,
        Math.round((matrix[1]![0]! * vector[0]! + matrix[1]![1]! * vector[1]!) * 1e8) / 1e8,
      ]
    : null;
  const inverse = Math.abs(det) > 1e-12
    ? [
        [Math.round((matrix[1]![1]! / det) * 1e8) / 1e8, Math.round((-matrix[0]![1]! / det) * 1e8) / 1e8],
        [Math.round((-matrix[1]![0]! / det) * 1e8) / 1e8, Math.round((matrix[0]![0]! / det) * 1e8) / 1e8],
      ]
    : null;
  const evaluation = baseEvaluation(node, values);
  evaluation.outputs = { det, product: product ?? [], inverse: inverse ?? [] };
  evaluation.subject = 'matrix';
  evaluation.table = {
    headers: ['矩阵 / 向量', '数值'],
    rows: [
      ['a11', matrix[0]![0]!], ['a12', matrix[0]![1]!], ['a21', matrix[1]![0]!], ['a22', matrix[1]![1]!],
      ...(vector ? [['v1', vector[0]!], ['v2', vector[1]!]] : []),
      ...(product ? [['Av', `(${product[0]}, ${product[1]})`]] : []),
    ],
  };
  if (vector && product) {
    evaluation.geometry = matrixGeometry(matrix, vector) as unknown as Record<string, unknown>;
  }
  evaluation.metrics = [
    { id: 'det', label: '行列式', value: String(Math.round(det * 1e8) / 1e8) },
    { id: 'invertible', label: '可逆', value: Math.abs(det) > 1e-12 ? '是' : '否' },
  ];
  const geometry = evaluation.geometry as
    | { collinear: boolean; ratio: number | null; is_eigenvector: boolean; zero_vector: boolean }
    | null;
  if (geometry) {
    evaluation.metrics.push({ id: 'collinear', label: '与 Av 共线', value: geometry.collinear ? '是' : '否' });
    if (geometry.ratio !== null) {
      evaluation.metrics.push({ id: 'ratio', label: '倍率', value: String(Math.round(geometry.ratio * 1e6) / 1e6) });
    }
  }
  evaluation.checks = [{
    id: 'invertible',
    label: '矩阵可逆性',
    status: Math.abs(det) > 1e-12 ? 'pass' : 'warn',
    detail: Math.abs(det) > 1e-12 ? '存在逆矩阵。' : '行列式为 0；不强行取逆。',
  }];
  if (geometry) {
    evaluation.checks.push({
      id: 'eigen_direction',
      label: '特征方向',
      status: geometry.is_eigenvector && !geometry.zero_vector ? 'pass' : 'warn',
      detail: String((evaluation.geometry as { message?: string }).message ?? ''),
    });
  }
  return evaluation;
}

function changeOfBasisEvaluation(node: CompiledNode, values: Record<string, unknown>): PptAiEvaluation {
  const provider = node.provider as Record<string, unknown>;
  const base = Array.isArray(provider.matrix) ? (provider.matrix as number[][]) : [[1, 0], [0, 1]];
  const matrix = [[0, 0], [0, 0]];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      matrix[row]![column] = numberValue(values[`a${row + 1}${column + 1}`], numberValue(base[row]?.[column]));
    }
  }
  const basisRaw = Array.isArray(provider.basis) ? (provider.basis as number[][]) : null;
  let basis: number[][];
  let angle: number | null = null;
  if (basisRaw && basisRaw.length === 2 && basisRaw.every((row) => Array.isArray(row) && row.length === 2)) {
    basis = basisRaw.map((row) => row.map((value) => numberValue(value)));
  } else {
    angle = numberValue(values.basis_angle_deg, numberValue(provider.basis_angle_deg, 0));
    const radians = (angle * Math.PI) / 180;
    basis = [
      [Math.cos(radians), -Math.sin(radians)],
      [Math.sin(radians), Math.cos(radians)],
    ];
  }
  const detP = basis[0]![0]! * basis[1]![1]! - basis[0]![1]! * basis[1]![0]!;
  const detA = matrix[0]![0]! * matrix[1]![1]! - matrix[0]![1]! * matrix[1]![0]!;
  const traceA = matrix[0]![0]! + matrix[1]![1]!;
  const invertible = Math.abs(detP) > 1e-12;
  const vector = Array.isArray(provider.vector) ? (provider.vector as number[]) : [1, 2];
  const xWorld = [numberValue(values.x1, numberValue(vector[0])), numberValue(values.x2, numberValue(vector[1]))];
  const axWorld = [
    matrix[0]![0]! * xWorld[0]! + matrix[0]![1]! * xWorld[1]!,
    matrix[1]![0]! * xWorld[0]! + matrix[1]![1]! * xWorld[1]!,
  ];
  const evaluation = baseEvaluation(node, values);
  evaluation.subject = 'matrix';
  evaluation.metrics = [
    { id: 'trace', label: '迹 tr(A)', value: String(Math.round(traceA * 1e8) / 1e8) },
    { id: 'det', label: '行列式 det(A)', value: String(Math.round(detA * 1e8) / 1e8) },
    { id: 'basis_det', label: 'det(P)', value: String(Math.round(detP * 1e8) / 1e8) },
    { id: 'invertible', label: '基可逆', value: invertible ? '是' : '否' },
  ];
  if (!invertible) {
    evaluation.table = {
      headers: ['对象', '数值'],
      rows: [['A', JSON.stringify(matrix)], ['P', JSON.stringify(basis)], ['P⁻¹', '不可逆，不显示']],
    };
    evaluation.checks = [{
      id: 'basis_invertible',
      label: '坐标基可逆',
      status: 'warn',
      detail: 'P 不可逆；不显示逆矩阵或伪造结果。',
    }];
    evaluation.geometry = { matrix, basis, invertible: false, detP, detA, traceA, angle };
    return evaluation;
  }
  const p11 = basis[1]![1]! / detP;
  const p12 = -basis[0]![1]! / detP;
  const p21 = -basis[1]![0]! / detP;
  const p22 = basis[0]![0]! / detP;
  const inverse = [[p11, p12], [p21, p22]];
  const transformed = [[0, 0], [0, 0]];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      transformed[row]![column] =
        inverse[row]![0]! * (matrix[0]![0]! * basis[0]![column]! + matrix[0]![1]! * basis[1]![column]!) +
        inverse[row]![1]! * (matrix[1]![0]! * basis[0]![column]! + matrix[1]![1]! * basis[1]![column]!);
    }
  }
  const coords = [
    inverse[0]![0]! * xWorld[0]! + inverse[0]![1]! * xWorld[1]!,
    inverse[1]![0]! * xWorld[0]! + inverse[1]![1]! * xWorld[1]!,
  ];
  const coordsAx = [
    inverse[0]![0]! * axWorld[0]! + inverse[0]![1]! * axWorld[1]!,
    inverse[1]![0]! * axWorld[0]! + inverse[1]![1]! * axWorld[1]!,
  ];
  const transformedTrace = transformed[0]![0]! + transformed[1]![1]!;
  const transformedDet = transformed[0]![0]! * transformed[1]![1]! - transformed[0]![1]! * transformed[1]![0]!;
  evaluation.table = {
    headers: ['对象', '数值'],
    rows: [
      ['A', JSON.stringify(matrix)],
      ['P', JSON.stringify(basis.map((row) => row.map((value) => Math.round(value * 1e8) / 1e8)))],
      ['P⁻¹', JSON.stringify(inverse.map((row) => row.map((value) => Math.round(value * 1e8) / 1e8)))],
      ['B = P⁻¹AP', JSON.stringify(transformed.map((row) => row.map((value) => Math.round(value * 1e8) / 1e8)))],
      ['x 的基坐标', JSON.stringify(coords.map((value) => Math.round(value * 1e8) / 1e8))],
      ['Ax 的基坐标', JSON.stringify(coordsAx.map((value) => Math.round(value * 1e8) / 1e8))],
    ],
  };
  const preserved = Math.abs(transformedTrace - traceA) <= 1e-8 && Math.abs(transformedDet - detA) <= 1e-8;
  evaluation.checks = [
    { id: 'basis_invertible', label: '坐标基可逆', status: 'pass', detail: 'P 可逆，存在坐标逆映射。' },
    {
      id: 'invariants_preserved',
      label: '迹与行列式保持不变',
      status: preserved ? 'pass' : 'fail',
      detail: `tr(B)=${Math.round(transformedTrace * 1e6) / 1e6}，det(B)=${Math.round(transformedDet * 1e6) / 1e6}。`,
    },
  ];
  evaluation.geometry = {
    matrix,
    basis,
    inverse,
    transformed,
    coordinates: { x: coords, Ax: coordsAx },
    world: { x: xWorld, Ax: axWorld },
    invariants: { trace: traceA, det: detA, transformedTrace, transformedDet },
    invertible: true,
    detP,
    detA,
    angle,
  };
  evaluation.outputs = { det: detA, trace: traceA, transformed };
  return evaluation;
}

export function evaluateNode(
  node: CompiledNode,
  values: CanonicalValues,
  derived: CanonicalValues = {},
  overrides: CanonicalValues = {},
): PptAiEvaluation {
  const provider = node.provider as Record<string, unknown>;
  const kind = String(provider.kind ?? '');
  const inputs = inputValues(node, values, derived, overrides);
  try {
    if (kind === 'lab') return evaluationFromLab(node, inputs);
    if (kind === 'expression') return expressionEvaluation(node, inputs);
    if (kind === 'chart') return chartEvaluation(node, inputs);
    if (kind === 'table') return tableEvaluation(node, inputs);
    if (kind === 'matrix') return matrixEvaluation(node, inputs);
    if (kind === 'change_of_basis') return changeOfBasisEvaluation(node, inputs);
    if (isTemplateKind(kind)) return templateEvaluation(node, inputs, provider);
    if (kind === 'explain') {
      const evaluation = baseEvaluation(node, inputs);
      evaluation.subject = 'explain';
      evaluation.text = String(provider.text ?? '');
      return evaluation;
    }
    throw new Error(`未登记的 provider：${kind}`);
  } catch (error) {
    const evaluation = baseEvaluation(node, inputs);
    evaluation.error = error instanceof Error ? error.message : '求值失败';
    return evaluation;
  }
}

export function nodeDefaults(node: CompiledNode): CanonicalValues {
  const values: CanonicalValues = {};
  node.parameters.forEach((parameter) => {
    values[parameter.concept_id] = parameter.default;
  });
  return values;
}

export function numericOutput(evaluation: PptAiEvaluation, output = ''): number | null {
  if (output) {
    const metric = evaluation.metrics.find((item) => item.id === output);
    if (metric) {
      const value = Number(metric.value.replace('−', '-'));
      if (Number.isFinite(value)) return value;
    }
  }
  const metric = evaluation.metrics.find((item) => !['rows', 'columns', 'count', 'data_points'].includes(item.id));
  if (metric) {
    const value = Number(metric.value.replace('−', '-'));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function formatValue(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—';
    return String(Math.round(value * 1e6) / 1e6);
  }
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value === null || value === undefined) return '—';
  return String(value);
}

// ---------------------------------------------------------------------------
// 全表联动：同一份拓扑 / 派生输出 / 增量求值（与后端 evaluation.py 对齐）
// ---------------------------------------------------------------------------

export interface BundleEvaluation {
  nodes: Record<string, PptAiEvaluation>;
  nodeHashes: Record<string, string>;
  derivedValues: CanonicalValues;
  order: string[];
  cycles: string[][];
  evaluationHash: string;
  /** 已确认页面声明的运行时对照结果（与后端 declaration_checks 同口径）。 */
  declarationChecks: EvaluationCheck[];
}

function valuesMatch(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(1e-9, Math.abs(left) * 1e-9);
}

function declarationChecks(
  bundle: InteractionBundle,
  derivedValues: CanonicalValues,
): EvaluationCheck[] {
  const declarations = new Map(
    bundle.graph.nodes
      .filter((node) => node.semantic_role === 'declaration')
      .map((node) => [node.concept_id, node]),
  );
  if (!declarations.size) return [];
  const checks: EvaluationCheck[] = [];
  bundle.graph.relations.forEach((relation) => {
    if (relation.type !== 'derived_from') return;
    const declarationId = (relation.outputs ?? []).find((id) => declarations.has(id));
    if (declarationId === undefined || !relation.inputs.length) return;
    const declaration = declarations.get(declarationId)!;
    const declared = typeof declaration.default === 'number' && Number.isFinite(declaration.default)
      ? declaration.default
      : null;
    const computedRaw = derivedValues[relation.inputs[0]!];
    const computed = typeof computedRaw === 'number' && Number.isFinite(computedRaw) ? computedRaw : null;
    if (declared === null || computed === null) return;
    const matched = valuesMatch(declared, computed);
    checks.push({
      id: `declaration_match_${relation.relation_id.slice(0, 24)}`,
      label: `页面声明对照：${declaration.name}`,
      status: matched ? 'pass' : 'fail',
      detail: matched
        ? `页面写 ${declared}，当前算出 ${computed}，一致。`
        : `页面写 ${declared}，当前算出 ${computed}；参数已使输出偏离原稿声明。`,
    });
  });
  return checks;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function stableHash(value: unknown): string {
  const text = typeof value === 'string' ? value : stableStringify(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

function nodeHash(evaluation: PptAiEvaluation): string {
  // 覆盖所有用户可见的结果通道：只改曲线/图表不改指标的更新也必须计入 changed。
  return stableHash({
    outputs: evaluation.outputs,
    metrics: evaluation.metrics,
    checks: evaluation.checks,
    text: evaluation.text,
    error: evaluation.error,
    table: evaluation.table,
    series: evaluation.series,
    rects: evaluation.rects,
    chart: evaluation.chart,
    points: evaluation.points,
    geometry: evaluation.geometry,
    overlaySeries: evaluation.overlaySeries,
    overlayLabel: evaluation.overlayLabel,
  });
}

export function outputValue(evaluation: PptAiEvaluation, output: OutputSpec): CanonicalValue | null {
  const direct = evaluation.outputs[output.key];
  if (direct !== undefined && !(Array.isArray(direct) && direct.length === 0)) return direct;
  const metric = evaluation.metrics.find((item) => item.id === output.key);
  if (!metric) return null;
  if (output.type === 'number' || output.type === 'integer') {
    const number = Number(metric.value.replace('−', '-'));
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

export function nodeEdges(bundle: InteractionBundle): Record<string, string[]> {
  const producers: Record<string, string> = {};
  bundle.compiled.nodes.forEach((node) => {
    (node.outputs ?? []).forEach((output) => { producers[output.concept_id] = node.node_id; });
  });
  const edges: Record<string, string[]> = {};
  bundle.compiled.nodes.forEach((node) => { edges[node.node_id] = []; });
  bundle.compiled.nodes.forEach((node) => {
    node.parameters.forEach((parameter) => {
      const binding = parameter.binding;
      if (binding?.mode !== 'linked') return;
      const producer = producers[binding.concept_id];
      if (producer && !edges[producer]!.includes(node.node_id)) {
        edges[producer]!.push(node.node_id);
      }
    });
  });
  return edges;
}

function tarjanCycles(edges: Record<string, string[]>): string[][] {
  let index = 0;
  const indexes = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const strongconnect = (vertex: string): void => {
    indexes.set(vertex, index);
    low.set(vertex, index);
    index += 1;
    stack.push(vertex);
    onStack.add(vertex);
    (edges[vertex] ?? []).forEach((neighbour) => {
      if (!indexes.has(neighbour)) {
        strongconnect(neighbour);
        low.set(vertex, Math.min(low.get(vertex)!, low.get(neighbour)!));
      } else if (onStack.has(neighbour)) {
        low.set(vertex, Math.min(low.get(vertex)!, indexes.get(neighbour)!));
      }
    });
    if (low.get(vertex) === indexes.get(vertex)) {
      const component: string[] = [];
      for (;;) {
        const item = stack.pop();
        if (item === undefined) break;
        onStack.delete(item);
        component.push(item);
        if (item === vertex) break;
      }
      components.push(component);
    }
  };
  Object.keys(edges).forEach((vertex) => { if (!indexes.has(vertex)) strongconnect(vertex); });
  const cycles = components.filter((component) => component.length > 1).map((component) => [...component].sort());
  Object.keys(edges).forEach((vertex) => {
    if ((edges[vertex] ?? []).includes(vertex)) cycles.push([vertex]);
  });
  return cycles;
}

export function bundleDependencyOrder(bundle: InteractionBundle): { order: string[]; cycles: string[][] } {
  const edges = nodeEdges(bundle);
  const cycles = tarjanCycles(edges);
  if (cycles.length) return { order: [], cycles };
  const indegree: Record<string, number> = {};
  Object.keys(edges).forEach((nodeId) => { indegree[nodeId] = 0; });
  Object.values(edges).forEach((targets) => targets.forEach((target) => {
    indegree[target] = (indegree[target] ?? 0) + 1;
  }));
  const rank: Record<string, number> = {};
  bundle.compiled.nodes.forEach((node, position) => { rank[node.node_id] = position; });
  const preferred = bundle.graph.dependency_order ?? [];
  const preferRank: Record<string, number> = {};
  preferred.forEach((nodeId, position) => { preferRank[nodeId] = position; });
  const ready = Object.keys(edges)
    .filter((nodeId) => indegree[nodeId] === 0)
    .sort((left, right) => (preferRank[left] ?? rank[left] ?? 0) - (preferRank[right] ?? rank[right] ?? 0));
  const order: string[] = [];
  while (ready.length) {
    const current = ready.shift()!;
    order.push(current);
    (edges[current] ?? []).forEach((target) => {
      indegree[target] = (indegree[target] ?? 0) - 1;
      if (indegree[target] === 0) ready.push(target);
    });
    ready.sort((left, right) => (preferRank[left] ?? rank[left] ?? 0) - (preferRank[right] ?? rank[right] ?? 0));
  }
  if (order.length !== Object.keys(edges).length) {
    return { order, cycles: [Object.keys(edges).filter((nodeId) => !order.includes(nodeId))] };
  }
  return { order, cycles: [] };
}

export function affectedNodeIds(bundle: InteractionBundle, changedConcepts: Iterable<string>): Set<string> {
  const consumers: Record<string, Set<string>> = {};
  const outputs: Record<string, string[]> = {};
  bundle.compiled.nodes.forEach((node) => {
    outputs[node.node_id] = (node.outputs ?? []).map((output) => output.concept_id);
    node.parameters.forEach((parameter) => {
      (consumers[parameter.concept_id] ??= new Set<string>()).add(node.node_id);
      if (parameter.binding?.mode === 'linked' && parameter.binding.concept_id) {
        (consumers[parameter.binding.concept_id] ??= new Set<string>()).add(node.node_id);
      }
    });
  });
  const affected = new Set<string>();
  const queue = [...changedConcepts];
  const seen = new Set(queue);
  while (queue.length) {
    const concept = queue.shift()!;
    (consumers[concept] ?? new Set<string>()).forEach((nodeId) => {
      if (affected.has(nodeId)) return;
      affected.add(nodeId);
      (outputs[nodeId] ?? []).forEach((output) => {
        if (!seen.has(output)) { seen.add(output); queue.push(output); }
      });
    });
  }
  return affected;
}

export function nodeInputValues(
  node: CompiledNode,
  values: CanonicalValues,
  evaluation: BundleEvaluation | null,
  overrides: CanonicalValues = {},
): CanonicalValues {
  const result: CanonicalValues = {};
  node.parameters.forEach((parameter) => {
    if (parameter.concept_id in overrides) {
      result[parameter.concept_id] = overrides[parameter.concept_id]!;
      return;
    }
    result[parameter.concept_id] = parameterValue(parameter, values, evaluation?.derivedValues ?? {}) as CanonicalValue;
  });
  return result;
}

function evaluateBundleNode(
  node: CompiledNode,
  values: CanonicalValues,
  derived: CanonicalValues,
  overrides: CanonicalValues,
): PptAiEvaluation {
  const evaluation = evaluateNode(node, values, derived, overrides);
  const missing = node.parameters.filter((parameter) =>
    parameter.binding?.mode === 'linked'
    && parameter.binding.concept_id
    && !(parameter.binding.concept_id in derived)
    && !(parameter.concept_id in overrides));
  if (missing.length) {
    evaluation.checks = [
      ...missing.map((parameter) => ({
        id: `link_${parameter.id}`,
        label: `${parameter.label} 的上游输出无可用值`,
        status: 'warn' as const,
        detail: `已使用本页默认值；上游 ${parameter.binding?.concept_id ?? ''} 需要先修复。`,
      })),
      ...evaluation.checks,
    ];
  }
  return evaluation;
}

export function evaluateBundle(
  bundle: InteractionBundle,
  values: CanonicalValues,
  overrides: OverrideValues = {},
): BundleEvaluation {
  const computed = bundleDependencyOrder(bundle);
  const order = computed.cycles.length
    ? bundle.compiled.nodes.map((node) => node.node_id)
    : computed.order;
  const derivedValues: CanonicalValues = {};
  const nodes: Record<string, PptAiEvaluation> = {};
  const nodeHashes: Record<string, string> = {};
  order.forEach((nodeId) => {
    const node = bundle.compiled.nodes.find((item) => item.node_id === nodeId);
    if (!node) return;
    const local = overrides[node.node_id] ?? {};
    const evaluation = evaluateBundleNode(node, values, derivedValues, local);
    nodes[nodeId] = evaluation;
    nodeHashes[nodeId] = nodeHash(evaluation);
    (node.outputs ?? []).forEach((output) => {
      const value = outputValue(evaluation, output);
      if (value !== null) derivedValues[output.concept_id] = value;
    });
  });
  return {
    nodes,
    nodeHashes,
    derivedValues,
    order,
    cycles: computed.cycles,
    evaluationHash: stableHash(order.map((nodeId) => nodeHashes[nodeId] ?? '')),
    declarationChecks: declarationChecks(bundle, derivedValues),
  };
}

export interface IncrementalEvaluation {
  evaluation: BundleEvaluation;
  affected: Set<string>;
  changed: Set<string>;
}

export function evaluateBundleIncremental(
  bundle: InteractionBundle,
  values: CanonicalValues,
  previous: BundleEvaluation | null,
  changedConcepts: Iterable<string>,
  overrides: OverrideValues = {},
  changedOverrideNodes: Iterable<string> = [],
): IncrementalEvaluation {
  if (!previous || previous.cycles.length) {
    const evaluation = evaluateBundle(bundle, values, overrides);
    return { evaluation, affected: new Set(evaluation.order), changed: new Set(evaluation.order) };
  }
  const affected = affectedNodeIds(bundle, changedConcepts);
  [...changedOverrideNodes].forEach((nodeId) => affected.add(nodeId));
  if (affected.size === 0) {
    return { evaluation: previous, affected, changed: new Set() };
  }
  const derivedValues: CanonicalValues = { ...previous.derivedValues };
  const nodes: Record<string, PptAiEvaluation> = {};
  const nodeHashes: Record<string, string> = {};
  previous.order.forEach((nodeId) => {
    const node = bundle.compiled.nodes.find((item) => item.node_id === nodeId);
    if (!node) return;
    if (!affected.has(nodeId)) {
      const cached = previous.nodes[nodeId];
      if (cached) { nodes[nodeId] = cached; nodeHashes[nodeId] = previous.nodeHashes[nodeId] ?? nodeHash(cached); }
      return;
    }
    const local = overrides[node.node_id] ?? {};
    const evaluation = evaluateBundleNode(node, values, derivedValues, local);
    nodes[nodeId] = evaluation;
    nodeHashes[nodeId] = nodeHash(evaluation);
    (node.outputs ?? []).forEach((output) => {
      const value = outputValue(evaluation, output);
      if (value === null) delete derivedValues[output.concept_id];
      else derivedValues[output.concept_id] = value;
    });
  });
  const order = previous.order;
  const changed = new Set<string>();
  affected.forEach((nodeId) => {
    if (previous.nodeHashes[nodeId] !== nodeHashes[nodeId]) changed.add(nodeId);
  });
  return {
    evaluation: {
      nodes,
      nodeHashes,
      derivedValues,
      order,
      cycles: previous.cycles,
      evaluationHash: stableHash(order.map((nodeId) => nodeHashes[nodeId] ?? '')),
      // 每次都按最终派生值重新比对，不随节点缓存漂移。
      declarationChecks: declarationChecks(bundle, derivedValues),
    },
    affected,
    changed,
  };
}
