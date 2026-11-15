/**
 * dataStructures.ts —— 数据结构题型（ds_* 引擎）的前端回放。
 *
 * 这些题型的执行记录由后端确定性内核生成并嵌入题目模型（model.ds_result），
 * 题目本身不含可调参数，前端直接回放同一条轨迹，动画与结论保持一致。
 * 后端字段为 snake_case（ds_kind），此处统一为前端协议的 dsKind；
 * 否则画布分流（'dsKind' in result）失效，会误走 BFS 展示分支。
 */
import type { DsResult, DsResultFrame, LabProblem } from './types.ts';

export function replayDs(problem: LabProblem): DsResult {
  const embedded = (problem.model as unknown as { ds_result?: Record<string, unknown> }).ds_result;
  if (!embedded || !Array.isArray(embedded.frames) || embedded.frames.length === 0) {
    throw new Error('该题型的执行记录尚未生成，请重新打开或重建题目。');
  }
  const raw = embedded as { ds_kind?: unknown; dsKind?: unknown };
  const dsKind = typeof raw.dsKind === 'string' && raw.dsKind ? raw.dsKind
    : (typeof raw.ds_kind === 'string' ? raw.ds_kind : '');
  return {
    ...(embedded as unknown as DsResult),
    dsKind,
    trace: embedded.frames as DsResultFrame[],
  };
}
