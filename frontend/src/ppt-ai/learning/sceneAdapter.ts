/**
 * 学习描述 + 当前值 → 现有场景可渲染的数据。
 *
 * 只按模板/算子与来源事实适配，不按页码、标题或文件名分派。未知模板返回
 * ``generic`` 降级，由调用方展示明确说明，不伪装成可操作实验。
 */

import { evaluateNode, matrixGeometry, type PptAiEvaluation } from '../runtime/evaluate.ts';
import type { CompiledNode } from '../types.ts';
import type { LearningDescriptor, LearningItem } from './types';

export type LearningValueMap = Record<string, number | boolean | string>;

export interface EigenScene {
  kind: 'eigen';
  matrix: number[][];
  vector: number[];
  product: number[];
  collinear: boolean;
  ratio: number | null;
  isEigenvector: boolean;
  zeroVector: boolean;
  avZero: boolean;
  message: string;
  evaluation: PptAiEvaluation;
  descriptor: LearningDescriptor;
}

export interface ChangeOfBasisScene {
  kind: 'change_of_basis';
  matrix: number[][];
  basis: number[][];
  inverseBasis: number[][] | null;
  transformed: number[][] | null;
  worldX: number[];
  worldAx: number[];
  coordinates: { x: number[]; Ax: number[] } | null;
  invariants: {
    trace: number;
    det: number;
    transformedTrace: number | null;
    transformedDet: number | null;
  };
  angle: number | null;
  invertible: boolean;
  evaluation: PptAiEvaluation;
  descriptor: LearningDescriptor;
}

export interface InverseScene {
  kind: 'inverse';
  matrix: number[][];
  det: number;
  invertible: boolean;
  vector: number[] | null;
  product: number[] | null;
  evaluation: PptAiEvaluation;
  descriptor: LearningDescriptor;
}

export interface GenericScene {
  kind: 'generic';
  evaluation: PptAiEvaluation;
  descriptor: LearningDescriptor;
}

export type LearningScene = EigenScene | ChangeOfBasisScene | InverseScene | GenericScene;

function numberAt(values: LearningValueMap, key: string, fallback: number): number {
  const value = values[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function matrixFromNode(node: CompiledNode, values: LearningValueMap): number[][] {
  const provider = node.provider as Record<string, unknown>;
  const base = Array.isArray(provider.matrix) ? (provider.matrix as number[][]) : [[1, 0], [0, 1]];
  const matrix = [[0, 0], [0, 0]];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      const parameter = node.parameters.find((item) => item.id === `a${row + 1}${column + 1}`);
      matrix[row]![column] = parameter
        ? numberAt(values, parameter.concept_id, Number(parameter.default))
        : Number(base[row]?.[column] ?? 0);
    }
  }
  return matrix;
}

export function vectorFromNode(
  node: CompiledNode,
  values: LearningValueMap,
  bindings?: Record<string, string>,
): number[] | null {
  const provider = node.provider as Record<string, unknown>;
  const result: number[] = [];
  for (let index = 0; index < 2; index += 1) {
    const parameter = node.parameters.find((item) => item.id === `v${index + 1}`);
    if (parameter) {
      result.push(numberAt(values, parameter.concept_id, Number(parameter.default)));
      continue;
    }
    const teachingKey = bindings?.[`vector.v${index + 1}`] ?? `teaching.v${index + 1}`;
    if (typeof values[teachingKey] === 'number') {
      result.push(Number(values[teachingKey]));
      continue;
    }
    const base = Array.isArray(provider.vector) ? (provider.vector as number[]) : null;
    if (base) {
      result.push(numberAt(values, `teaching.v${index + 1}`, Number(base[index] ?? 0)));
      continue;
    }
    return null;
  }
  return result;
}

function sceneForChangeOfBasis(
  item: LearningItem,
  node: CompiledNode,
  values: LearningValueMap,
  evaluation: PptAiEvaluation,
): ChangeOfBasisScene {
  const geometry = (evaluation.geometry ?? {}) as Record<string, unknown>;
  const matrix = matrixFromNode(node, values);
  const basis = Array.isArray(geometry.basis) ? (geometry.basis as number[][]) : [[1, 0], [0, 1]];
  const world = geometry.world as { x?: number[]; Ax?: number[] } | undefined;
  const coordinates = geometry.coordinates as { x: number[]; Ax: number[] } | undefined;
  const invariants = (geometry.invariants ?? {}) as Record<string, number>;
  const det = matrix[0]![0]! * matrix[1]![1]! - matrix[0]![1]! * matrix[1]![0]!;
  const trace = matrix[0]![0]! + matrix[1]![1]!;
  return {
    kind: 'change_of_basis',
    matrix,
    basis,
    inverseBasis: Array.isArray(geometry.inverse) ? (geometry.inverse as number[][]) : null,
    transformed: Array.isArray(geometry.transformed) ? (geometry.transformed as number[][]) : null,
    worldX: world?.x ?? [1, 2],
    worldAx: world?.Ax ?? [0, 0],
    coordinates: coordinates ?? null,
    invariants: {
      trace: Number(invariants.trace ?? trace),
      det: Number(invariants.det ?? det),
      transformedTrace: Number(geometry.invariants ? invariants.transformedTrace : NaN) || null,
      transformedDet: Number(geometry.invariants ? invariants.transformedDet : NaN) || null,
    },
    angle: typeof geometry.angle === 'number' ? geometry.angle : null,
    invertible: geometry.invertible !== false,
    evaluation,
    descriptor: item.descriptor,
  };
}

function sceneForInverse(
  item: LearningItem,
  node: CompiledNode,
  values: LearningValueMap,
  evaluation: PptAiEvaluation,
): InverseScene {
  const matrix = matrixFromNode(node, values);
  const det = matrix[0]![0]! * matrix[1]![1]! - matrix[0]![1]! * matrix[1]![0]!;
  const vector = vectorFromNode(node, values);
  const product = vector
    ? [
        matrix[0]![0]! * vector[0]! + matrix[0]![1]! * vector[1]!,
        matrix[1]![0]! * vector[0]! + matrix[1]![1]! * vector[1]!,
      ]
    : null;
  return {
    kind: 'inverse',
    matrix,
    det,
    invertible: Math.abs(det) > 1e-12,
    vector,
    product,
    evaluation,
    descriptor: item.descriptor,
  };
}

export function adaptLearningScene(
  item: LearningItem,
  node: CompiledNode,
  values: LearningValueMap,
): LearningScene {
  const evaluation = evaluateNode(node, values);
  const descriptor = item.descriptor;
  if (descriptor.template_id === 'matrix.eigen_probe') {
    const matrix = matrixFromNode(node, values);
    const vector = vectorFromNode(node, values, descriptor.bindings) ?? [1, 0];
    const geometry = matrixGeometry(matrix, vector);
    return {
      kind: 'eigen',
      matrix,
      vector,
      product: geometry.product,
      collinear: geometry.collinear,
      ratio: geometry.ratio,
      isEigenvector: geometry.is_eigenvector,
      zeroVector: geometry.zero_vector,
      avZero: geometry.av_zero,
      message: geometry.message,
      evaluation,
      descriptor,
    };
  }
  if (descriptor.template_id === 'matrix.change_of_basis') {
    return sceneForChangeOfBasis(item, node, values, evaluation);
  }
  if (descriptor.template_id === 'matrix.inverse') {
    return sceneForInverse(item, node, values, evaluation);
  }
  return { kind: 'generic', evaluation, descriptor };
}
