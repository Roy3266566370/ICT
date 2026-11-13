import { evaluateDoubleIntegral, evaluateTaylor } from './calculus.ts';
import { evaluateSorting, evaluateStackQueue } from './dataStructures.ts';
import { evaluateActivation, evaluateConvPool } from './deepLearning.ts';
import { evaluateLeastSquares, evaluateNewton } from './optimization.ts';
import { evaluateProjectile, evaluateSpring } from './physics.ts';
import { empty, type TemplateEvaluation, type TemplateValues } from './types.ts';

export type TemplateKernel = (
  values: TemplateValues,
  provider: Record<string, unknown>,
) => TemplateEvaluation;

const KERNELS: Record<string, TemplateKernel> = {
  taylor: evaluateTaylor,
  double_integral: evaluateDoubleIntegral,
  newton_1d: evaluateNewton,
  least_squares: evaluateLeastSquares,
  stack_queue: evaluateStackQueue,
  sorting: evaluateSorting,
  activation: evaluateActivation,
  conv_pool: evaluateConvPool,
  projectile: evaluateProjectile,
  spring: evaluateSpring,
};

export function isTemplateKind(kind: string): boolean {
  return kind in KERNELS;
}

export function evaluateTemplate(
  kind: string,
  values: TemplateValues,
  provider: Record<string, unknown>,
): TemplateEvaluation {
  const kernel = KERNELS[kind];
  if (!kernel) return empty('template', `未登记的模板内核：${kind}`);
  try {
    return kernel(values, provider);
  } catch (error) {
    return empty('template', error instanceof Error ? error.message : '模板求值失败');
  }
}

export type { TemplateEvaluation, TemplateValues };
