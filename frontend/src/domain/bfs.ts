/**
 * bfs.ts —— `bfs_flow` 的前端确定性派生实现（C-BFS@1，plan §2.2.5）
 *
 * 关键行为：
 *  - 起点先入队并标记 enqueued；visited 在出队时标记（R8-AC1）。
 *  - 每次出队后按邻居 id 的 **Unicode 码点** 字典序升序遍历（规则 2）。
 *  - 邻居入队条件：既不在 visited 也不在队列中，否则记 skip 步并写明原因（R8-AC2）。
 *  - 有环图靠 visited / 队列判定自然终止，不因环死循环（R8-AC3）。
 *  - 不可达节点列入 unvisited，不伪造访问（R8-AC4）。
 *  - has_cycle 仅用于展示提示，不阻止执行（与预算模板的无环要求严格区分，R8-AC7）。
 *
 * 契约未提供参数通道的视图级配置（P1 说明，勿误解为缺陷）：
 *  - 起点由 config.start_node_id 决定；模板侧若提供「切换起点」的预览交互，
 *    属于纯视图预览，不改写 graph 参数、不推进 revision，也不影响已保存的运行快照。
 *  - max_steps 仅作防御上限，命中时 terminated_reason='max_steps_reached'。
 */
import type {
  BfsFlowConfig,
  BfsFlowResult,
  BfsRejectedEdge,
  BfsStep,
  GraphEdge,
  GraphNode,
  KnowledgeObject,
  Parameter,
} from '@/api/types';
import { isGraphValue } from '@/api/types';
import { domainFail, domainOk, type DomainOutcome } from './matrix';

/** 规模上限（§2.2.5 规则 6 / R8-AC6） */
export const BFS_MAX_NODES = 20;
export const BFS_MAX_EDGES = 40;
export const BFS_MAX_STEPS = 200;

export interface BfsInput {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  directed: boolean;
  startNodeId: string;
  neighborOrder?: 'lexicographic_by_id';
  maxSteps?: number;
}

/**
 * 按 Unicode 码点比较两个字符串，返回负数/0/正数。
 * JS 默认 `<` 比较的是 UTF-16 code unit，对 BMP 外字符与码点序不一致，这里显式按码点。
 */
export function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  const aPoints = Array.from(a, (char) => char.codePointAt(0) ?? 0);
  const bPoints = Array.from(b, (char) => char.codePointAt(0) ?? 0);
  const length = Math.min(aPoints.length, bPoints.length);
  for (let index = 0; index < length; index += 1) {
    const left = aPoints[index] ?? 0;
    const right = bPoints[index] ?? 0;
    if (left !== right) return left - right;
  }
  return aPoints.length - bPoints.length;
}

/**
 * 有向图环检测（DFS 三色标记）。无向图按「父子边不算回边」判定。
 * 只用于展示 `has_cycle`，不影响 BFS 执行（R8-AC7）。
 */
export function detectCycle(
  nodeIds: readonly string[],
  adjacency: ReadonlyMap<string, readonly string[]>,
  directed: boolean,
): boolean {
  if (directed) {
    const state = new Map<string, 0 | 1 | 2>();
    for (const id of nodeIds) state.set(id, 0);

    const visit = (id: string): boolean => {
      const current = state.get(id) ?? 0;
      if (current === 1) return true;
      if (current === 2) return false;
      state.set(id, 1);
      for (const next of adjacency.get(id) ?? []) {
        if (visit(next)) return true;
      }
      state.set(id, 2);
      return false;
    };

    for (const id of nodeIds) {
      if ((state.get(id) ?? 0) === 0 && visit(id)) return true;
    }
    return false;
  }

  // 无向图：DFS，跳过直接父节点，遇到已访问节点即为回边（环）
  const visited = new Set<string>();
  const walk = (id: string, parent: string | null): boolean => {
    visited.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (next === parent) continue;
      if (visited.has(next)) return true;
      if (walk(next, id)) return true;
    }
    return false;
  };
  for (const id of nodeIds) {
    if (!visited.has(id) && walk(id, null)) return true;
  }
  return false;
}

/** 执行 BFS 并产出完整轨迹；非法输入返回 `ok:false`（不抛异常）。 */
export function runBfs(input: BfsInput): DomainOutcome<BfsFlowResult> {
  const { nodes, edges, directed, startNodeId } = input;
  const maxSteps = input.maxSteps ?? BFS_MAX_STEPS;

  if (nodes.length > BFS_MAX_NODES) {
    return domainFail(`节点数为 ${nodes.length}，超出上限 ${BFS_MAX_NODES}（节点数超限）`);
  }
  if (edges.length > BFS_MAX_EDGES) {
    return domainFail(`边数为 ${edges.length}，超出上限 ${BFS_MAX_EDGES}（边数超限）`);
  }

  const nodeIds: string[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if (node.id === '') {
      return domainFail('存在 id 为空的节点，节点 id 不得为空');
    }
    if (seen.has(node.id)) {
      return domainFail(`节点 id 重复：${node.id}`);
    }
    seen.add(node.id);
    nodeIds.push(node.id);
  }

  if (nodeIds.length === 0) {
    return domainFail('图中没有节点，无法执行 BFS');
  }
  if (!seen.has(startNodeId)) {
    return domainFail(`起点 ${startNodeId} 不存在于 nodes[].id 中（起点缺失）`);
  }

  // 邻接表：有向图只加 from→to；无向图双向加入（自动去重）
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  const edgeKeys = new Set<string>();
  for (const edge of edges) {
    if (!seen.has(edge.from) || !seen.has(edge.to)) {
      return domainFail(`边 ${edge.from}→${edge.to} 引用了不存在的节点`);
    }
    const forwardKey = `${edge.from}\u0000${edge.to}`;
    if (!edgeKeys.has(forwardKey)) {
      edgeKeys.add(forwardKey);
      adjacency.get(edge.from)?.push(edge.to);
    }
    if (!directed) {
      const backwardKey = `${edge.to}\u0000${edge.from}`;
      if (!edgeKeys.has(backwardKey)) {
        edgeKeys.add(backwardKey);
        adjacency.get(edge.to)?.push(edge.from);
      }
    }
  }
  // 邻居按 id 的 Unicode 码点字典序升序（规则 2）
  for (const list of adjacency.values()) {
    list.sort(compareCodePoints);
  }

  const queue: string[] = [startNodeId];
  const enqueued = new Set<string>([startNodeId]);
  const visitedOrder: string[] = [];
  const visited = new Set<string>();
  const parent: Record<string, string | null> = {};
  const level: Record<string, number> = {};
  for (const id of nodeIds) {
    // parent 允许 null（契约 Record<string, string | null>）。
    // level 只在节点可达时写入：不可达节点**不写键**，避免用 -1 冒充层级
    // 与 schema 的 level: { minimum: 0 } 冲突（P0 修复 B）。
    parent[id] = null;
  }
  level[startNodeId] = 0;

  const enqueueOrder: string[] = [startNodeId];
  const spanningEdges: { from: string; to: string }[] = [];
  const rejectedEdges: BfsRejectedEdge[] = [];
  const trace: BfsStep[] = [];
  let terminatedReason: BfsFlowResult['terminated_reason'] = 'completed';

  while (queue.length > 0) {
    if (trace.length >= maxSteps) {
      terminatedReason = 'max_steps_reached';
      break;
    }
    const current = queue.shift();
    if (current === undefined) break;

    visited.add(current);
    visitedOrder.push(current);
    trace.push({
      index: trace.length,
      kind: 'dequeue',
      node: current,
      queue_after: [...queue],
      visited_after: [...visitedOrder],
    });

    for (const neighbor of adjacency.get(current) ?? []) {
      if (trace.length >= maxSteps) {
        terminatedReason = 'max_steps_reached';
        break;
      }

      if (visited.has(neighbor)) {
        const reason = `already_visited` as const;
        trace.push({
          index: trace.length,
          kind: 'skip',
          node: neighbor,
          from: current,
          reason,
        });
        rejectedEdges.push({ from: current, to: neighbor, reason: `${neighbor} 已访问` });
        continue;
      }
      if (enqueued.has(neighbor)) {
        const reason = `already_queued` as const;
        trace.push({
          index: trace.length,
          kind: 'skip',
          node: neighbor,
          from: current,
          reason,
        });
        rejectedEdges.push({ from: current, to: neighbor, reason: `${neighbor} 已在队列中` });
        continue;
      }

      queue.push(neighbor);
      enqueued.add(neighbor);
      enqueueOrder.push(neighbor);
      parent[neighbor] = current;
      level[neighbor] = (level[current] ?? 0) + 1;
      spanningEdges.push({ from: current, to: neighbor });
      trace.push({
        index: trace.length,
        kind: 'enqueue',
        node: neighbor,
        from: current,
        queue_after: [...queue],
      });
    }

    if (terminatedReason === 'max_steps_reached') break;
  }

  const unvisited = nodeIds.filter((id) => !visited.has(id));
  const hasCycle = detectCycle(nodeIds, adjacency, directed);

  return domainOk({
    order: visitedOrder,
    enqueue_order: enqueueOrder,
    visited: visitedOrder,
    unvisited,
    parent,
    level,
    edges_of_spanning_tree: spanningEdges,
    rejected_edges: rejectedEdges,
    trace,
    terminated_reason: terminatedReason,
    has_cycle: hasCycle,
  });
}

/** 从 `KnowledgeObject` 派生 `bfs_flow` 结果。 */
export function deriveBfsFlow(object: KnowledgeObject): DomainOutcome<BfsFlowResult> {
  const parameter: Parameter | null =
    object.parameters.find((item) => item.type === 'graph') ?? null;
  if (parameter === null) return domainFail('缺少图参数（type="graph"）');
  if (!isGraphValue(parameter.value)) {
    return domainFail(`参数 ${parameter.name}（${parameter.id}）不是合法的图结构`);
  }

  const config = object.config as Partial<BfsFlowConfig> & Record<string, unknown>;
  const startNodeId =
    typeof config.start_node_id === 'string' && config.start_node_id !== ''
      ? config.start_node_id
      : (object.parameters.find((item) => item.id === 'start_node_id')?.value as string | undefined) ??
        '';
  const directed = config.directed !== false;
  const maxSteps =
    typeof config.max_steps === 'number' && Number.isFinite(config.max_steps)
      ? Math.min(BFS_MAX_STEPS, Math.max(1, Math.floor(config.max_steps)))
      : BFS_MAX_STEPS;

  return runBfs({
    nodes: parameter.value.nodes,
    edges: parameter.value.edges,
    directed,
    startNodeId,
    maxSteps,
  });
}

/** 模板初始图（重置基线）：A→B、A→C、B→D、C→D，起点 A。 */
export const BFS_TEMPLATE_DEFAULTS = {
  nodes: [
    { id: 'A', label: 'A' },
    { id: 'B', label: 'B' },
    { id: 'C', label: 'C' },
    { id: 'D', label: 'D' },
  ],
  edges: [
    { from: 'A', to: 'B' },
    { from: 'A', to: 'C' },
    { from: 'B', to: 'D' },
    { from: 'C', to: 'D' },
  ],
  startNodeId: 'A',
  directed: true,
} as const;
/* -------------------------------------------------------------------------- */
/* C-UI@1 P1 澄清的冻结签名（§2.2.11，T6 直接 import）                        */
/* -------------------------------------------------------------------------- */

/** 非法输入时的安全降级结果。 */
function emptyBfsResult(): BfsFlowResult {
  return {
    order: [],
    enqueue_order: [],
    visited: [],
    unvisited: [],
    parent: {},
    level: {},
    edges_of_spanning_tree: [],
    rejected_edges: [],
    trace: [],
    terminated_reason: 'completed',
    has_cycle: false,
  };
}

/** `bfs_flow` 派生（签名冻结于 §2.2.11 P1 澄清）。 */
export function calcBfs(object: KnowledgeObject): {
  result: BfsFlowResult;
  error: string | null;
} {
  const outcome = deriveBfsFlow(object);
  if (outcome.ok) return { result: outcome.result, error: null };
  return { result: emptyBfsResult(), error: outcome.error };
}
