import type { LabProblem, LabResultBase, LabResultFrame } from './types.ts';

/** 计算机网络题型（后端确定性内核生成，前端只回放同一份轨迹）。 */
export type NetKind =
  | 'architecture' | 'performance' | 'physical'
  | 'error_control' | 'sliding_window' | 'mac'
  | 'ethernet' | 'ip' | 'network_layer' | 'transport' | 'tcp_control' | 'application';

export interface NetworkResultFrame extends LabResultFrame {
  action?: string;
  pseudocodeLine?: number;
}

export interface NetworkResult extends LabResultBase {
  subject: 'computer_network';
  engine: string;
  netKind: NetKind | string;
  status: 'ok' | 'blocked';
  reason?: string;
  answer: string;
  answerValue?: number | null;
  answerOrder?: string[] | null;
  pseudocode: string[];
  frames: NetworkResultFrame[];
  trace: NetworkResultFrame[];
}

export const NET_KIND_LABELS: Record<string, string> = {
  architecture: '网络体系结构',
  performance: '性能与交换',
  physical: '物理层',
  error_control: '差错检测与纠正',
  sliding_window: '可靠传输与滑动窗口',
  mac: '介质访问控制',
  ethernet: '以太网、交换机与 VLAN',
  ip: 'IPv4 与 IPv6',
  network_layer: '网络层协议与路由',
  transport: 'UDP 与 TCP 基础',
  tcp_control: 'TCP 流量与拥塞控制',
  application: '应用层与网络综合',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function replayNetwork(problem: LabProblem): NetworkResult {
  const embedded = (problem.model as unknown as { net_result?: Record<string, unknown> }).net_result;
  if (!isRecord(embedded) || !Array.isArray(embedded.frames) || embedded.frames.length === 0) {
    throw new Error('该计算机网络题型的执行记录尚未生成，请重新打开或重建题目。');
  }
  const netKind = typeof embedded.net_kind === 'string' ? embedded.net_kind
    : (typeof embedded.netKind === 'string' ? embedded.netKind : '');
  return {
    ...(embedded as unknown as NetworkResult),
    netKind,
    answerValue: typeof embedded.answer_value === 'number' ? embedded.answer_value
      : (typeof embedded.answerValue === 'number' ? embedded.answerValue : null),
    answerOrder: Array.isArray(embedded.answer_order) ? embedded.answer_order as string[]
      : (Array.isArray(embedded.answerOrder) ? embedded.answerOrder as string[] : null),
    trace: embedded.frames as NetworkResultFrame[],
  };
}
