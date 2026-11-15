import type { LabProblem, LabResultBase, LabResultFrame } from './types.ts';

/** 计算机组成原理题型（后端确定性内核生成，前端只回放同一份轨迹）。 */
export type CoKind =
  | 'performance' | 'data_repr' | 'fixed_point' | 'floating' | 'datapath'
  | 'memory' | 'cache' | 'virtual_memory' | 'instruction' | 'cpu_control' | 'pipeline' | 'bus_io';

export interface CoResultFrame extends LabResultFrame {
  pseudocodeLine?: number;
}

export interface CoResult extends LabResultBase {
  subject: 'computer_organization';
  engine: string;
  coKind: CoKind | string;
  status: 'ok' | 'blocked';
  reason?: string;
  answer: string;
  answerValue?: number | null;
  answerOrder?: string[] | null;
  pseudocode: string[];
  frames: CoResultFrame[];
  trace: CoResultFrame[];
}

export const CO_KIND_LABELS: Record<string, string> = {
  performance: '计算机性能',
  data_repr: '数据表示',
  fixed_point: '定点运算',
  floating: '浮点数',
  datapath: '运算器与数据通路',
  memory: '主存储器',
  cache: 'Cache',
  virtual_memory: '虚拟存储基础',
  instruction: '指令系统',
  cpu_control: 'CPU 与控制器',
  pipeline: '指令流水线',
  bus_io: '总线与输入输出',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function replayCompOrg(problem: LabProblem): CoResult {
  const embedded = (problem.model as unknown as { co_result?: Record<string, unknown> }).co_result;
  if (!isRecord(embedded) || !Array.isArray(embedded.frames) || embedded.frames.length === 0) {
    throw new Error('该计算机组成原理题型的执行记录尚未生成，请重新打开或重建题目。');
  }
  const coKind = typeof embedded.co_kind === 'string' ? embedded.co_kind
    : (typeof embedded.coKind === 'string' ? embedded.coKind : '');
  return {
    ...(embedded as unknown as CoResult),
    coKind,
    answerValue: typeof embedded.answer_value === 'number' ? embedded.answer_value
      : (typeof embedded.answerValue === 'number' ? embedded.answerValue : null),
    answerOrder: Array.isArray(embedded.answer_order) ? embedded.answer_order as string[]
      : (Array.isArray(embedded.answerOrder) ? embedded.answerOrder as string[] : null),
    trace: embedded.frames as CoResultFrame[],
  };
}
