/** 确定性目标结果 → 学生答案卡（不依赖 JSX，便于单元测试）。 */

import type { TargetResult, TargetSolution } from '@/ppt-ai/types';
import type { LearningResultCard, LearningVerification } from './types';

export const TARGET_STATUS_LABEL: Record<TargetResult['status'], string> = {
  found: '找到解',
  multiple: '存在多解',
  none_in_scope: '范围内未找到',
  unknown: '需要复核',
  timeout: '搜索超时',
  infeasible_proven: '已证无解',
};

function point(values: number[]): string {
  return `(${values.map((value) => Number(value.toFixed(6))).join(', ')})`;
}

function fallbackSolution(result: TargetResult): TargetSolution | null {
  const candidate = result.candidates[0];
  if (!candidate || candidate.solution) return candidate?.solution ?? null;
  const keys = Object.keys(candidate.values);
  const numeric = keys.filter((key) => typeof candidate.values[key] === 'number');
  if (numeric.length === 0) return null;
  return {
    unknowns: numeric,
    values: numeric.map((key) => Number(candidate.values[key])),
    classification: 'scalar_candidate',
    exact_values: [],
    free_variables: [],
    nullspace_basis: [],
    equations: [],
    verification: [
      {
        label: '旧结果缺少显式解；请重新求解以核对',
        expected: '',
        actual: String(candidate.residual ?? ''),
        residual: candidate.residual ?? null,
        status: 'not_checked',
      },
    ],
  };
}

export function buildLearningResultCard(
  result: TargetResult,
  options: { inputHash: string; requestHash?: string; taskId?: string } = { inputHash: '' },
): LearningResultCard {
  const solution = fallbackSolution(result);
  const label = TARGET_STATUS_LABEL[result.status] ?? result.status;
  const answer = solution ? `${solution.unknowns.join(', ')} = ${point(solution.values)}` : '';
  const conclusion =
    result.status === 'found'
      ? solution
        ? `在声明条件下找到解：${answer}，残差 ${result.residual ?? '—'}。`
        : '找到候选，但旧结果没有显式解；请重新求解。'
      : result.status === 'multiple'
        ? solution
          ? `存在多解；下面是一个可验证特解：${answer}。`
          : '存在多解，但缺少可验证特解；请重新求解。'
        : result.status === 'none_in_scope'
          ? '在声明的搜索范围或候选内没有找到目标；这不等于数学无解。'
          : result.status === 'infeasible_proven'
            ? '在明确的方程条件下验证为不相容；未把伪逆结果当作精确解。'
            : result.status === 'timeout'
              ? '搜索超时；未完成的搜索不被表述为无解。'
              : '当前状态没有给出确定答案；请检查条件、范围与容差。';
  const verification: LearningVerification[] = (solution?.verification ?? []).map((item) => ({
    label: item.label,
    expected: item.expected,
    actual: item.actual,
    residual: item.residual,
    status: item.status,
  }));
  return {
    card_id: `client_${result.status}`,
    title: `目标反求：${label}`,
    conclusion,
    solution,
    steps: [...(solution?.equations ?? [])],
    verification,
    source_refs: [],
    scope: {
      search_scope: result.search_scope,
      tolerance: result.tolerance,
      atol: result.atol,
      rtol: result.rtol,
      stop_reason: result.stop_reason,
    },
    limitations: [
      '有限搜索未发现不等于数学无解；多解只展示一个经过验证的特解。',
      '结果只对应当前输入哈希。',
    ],
    next_actions: ['用图验证', '保存这次探索'],
    input_hash: options.inputHash,
    request_hash: options.requestHash ?? options.inputHash,
    task_id: options.taskId ?? '',
    result_kind: 'target',
    stale: false,
  };
}
