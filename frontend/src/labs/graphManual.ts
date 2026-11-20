/**
 * 图遍历与堆下滤的「手动接管」审计器。
 * 与 opsys.ts 的手动审计同一套约定：只读审计、非法选择如实标注不替学生修正、
 * 本地确定性计算、不触发模型调用。
 *
 * BFS/DFS：内核访问序是确定性的（邻居按编号升序），学生的任务是预测/复现它；
 * 每个选择与期望逐步对照，错选给出当时队列/栈的真实内容来解释为什么轮到别的节点。
 * 堆下滤：每次删除后学生逐步决定「与左孩子交换 / 与右孩子交换 / 停止」，
 * 合法性按学生自己当前堆状态上的堆序规则判定——错选照样执行，让后果可见。
 */

export interface ManualTraversalStep {
  index: number;
  pick: string;
  expected: string;
  ok: boolean;
  error: string | null;
  /** 此步之前容器内容：BFS 是队列（队首在左），DFS 是栈（栈顶在右）。 */
  container: string[];
  visited: string[];
}

export interface ManualTraversalAudit {
  kind: 'bfs' | 'dfs';
  /** 学生实际点选（保留原始顺序与长度）。 */
  picks: string[];
  /** 内核的确定访问序。 */
  expected: string[];
  steps: ManualTraversalStep[];
  errors: string[];
  warnings: string[];
  /** 学生已给出 expected.length 个选择（含错误选择）。 */
  complete: boolean;
  /** 完成且逐步正确——访问序与内核完全一致。 */
  matchesKernel: boolean;
  /** 第一个错误位置，含解释；全对为 null。 */
  divergence: { index: number; pick: string; expected: string; reason: string } | null;
  /** 遍历结束后仍不可达的节点。 */
  unreachable: string[];
}

/** 重放内核 BFS：入队即标记，邻居按 adjacency 给出的顺序。返回访问序与每步出队前的队列快照。 */
function expectedBfs(adjacency: Record<string, string[]>, start: string): { order: string[]; containers: string[][] } {
  const order: string[] = [];
  const containers: string[][] = [];
  if (!start || !(start in adjacency)) return { order, containers };
  const visited = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    containers.push([...queue]);
    const current = queue.shift()!;
    order.push(current);
    for (const neighbor of adjacency[current] ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }
  return { order, containers };
}

/** 重放内核 DFS：栈顶首次访问后尝试最小未访问邻居，否则回溯。返回访问序与每步访问前的栈快照。 */
function expectedDfs(adjacency: Record<string, string[]>, start: string): { order: string[]; containers: string[][] } {
  const order: string[] = [];
  const containers: string[][] = [];
  if (!start || !(start in adjacency)) return { order, containers };
  const visited = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const current = stack[stack.length - 1]!;
    if (!visited.has(current)) {
      visited.add(current);
      order.push(current);
      containers.push([...stack]);
    }
    const next = (adjacency[current] ?? []).find((neighbor) => !visited.has(neighbor) && !stack.includes(neighbor));
    if (next === undefined) stack.pop();
    else stack.push(next);
  }
  return { order, containers };
}

export function expectedTraversal(
  adjacency: Record<string, string[]>,
  start: string,
  kind: 'bfs' | 'dfs',
): { order: string[]; containers: string[][] } {
  return kind === 'dfs' ? expectedDfs(adjacency, start) : expectedBfs(adjacency, start);
}

/**
 * 审计学生点选的访问序列。
 * adjacency 必须是内核已经排好序的邻接表（result.adjacency），遍历规则与之完全同源。
 * 每一步把学生选择与期望节点对照并给出当时容器的真实快照——
 * 队列中但不是队首、尚未被发现、已访问过、不可达，分别给出不同解释。
 */
export function auditManualTraversal(
  adjacency: Record<string, string[]>,
  nodeIds: string[],
  start: string,
  picks: string[],
  kind: 'bfs' | 'dfs',
): ManualTraversalAudit {
  const { order, containers } = expectedTraversal(adjacency, start, kind);
  const steps: ManualTraversalStep[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let divergence: ManualTraversalAudit['divergence'] = null;
  const containerWord = kind === 'dfs' ? '栈' : '队列';
  const topWord = kind === 'dfs' ? '栈顶' : '队首';
  for (let index = 0; index < picks.length; index += 1) {
    const pick = picks[index]!;
    if (index >= order.length) {
      const reason = `第 ${index + 1} 个选择 ${pick} 多余：${order.length ? '遍历已在所有可达节点访问完后结束。' : '没有任何可达节点。'}`;
      errors.push(reason);
      if (!divergence) divergence = { index, pick, expected: '', reason };
      steps.push({ index, pick, expected: '', ok: false, error: reason, container: [], visited: [...order] });
      continue;
    }
    const expected = order[index]!;
    const container = containers[index] ?? [];
    const visitedSoFar = order.slice(0, index);
    if (pick === expected) {
      steps.push({ index, pick, expected, ok: true, error: null, container, visited: visitedSoFar });
      continue;
    }
    const inContainer = container.includes(pick);
    const visitedBefore = visitedSoFar.includes(pick);
    const inGraph = nodeIds.includes(pick);
    let reason: string;
    if (!inGraph) {
      reason = `第 ${index + 1} 个选择 ${pick} 不在本题的节点集合里。`;
    } else if (visitedBefore) {
      reason = `第 ${index + 1} 个选择 ${pick} 在第 ${visitedSoFar.indexOf(pick) + 1} 步已经访问过，遍历不会重复访问同一节点。`;
    } else if (inContainer) {
      const pos = container.indexOf(pick);
      reason = kind === 'dfs'
        ? `第 ${index + 1} 步：${pick} 在栈中但不在栈顶（它下面还压着 ${container.length - pos - 1} 个节点）；DFS 必须先访问栈顶 ${expected}。`
        : `第 ${index + 1} 步：${pick} 已入队但前面还排着 ${pos} 个节点；BFS 必须先出队队首 ${expected}。`;
    } else {
      reason = `第 ${index + 1} 个选择 ${pick} 此刻还没有被发现${kind === 'dfs' ? '（未压栈）' : '（未入队）'}，${containerWord}里只有 [${container.join('、')}]，应先访问${topWord} ${expected}。`;
    }
    errors.push(reason);
    if (!divergence) divergence = { index, pick, expected, reason };
    steps.push({ index, pick, expected, ok: false, error: reason, container, visited: visitedSoFar });
  }
  if (picks.length < order.length) {
    warnings.push(`访问序列还没走完：已给出 ${picks.length} / ${order.length} 个节点。`);
  }
  const reachable = new Set(order);
  const unreachable = nodeIds.filter((id) => !reachable.has(id));
  const complete = picks.length >= order.length;
  const matchesKernel = complete && errors.length === 0;
  return { kind, picks, expected: order, steps, errors, warnings, complete, matchesKernel, divergence, unreachable };
}

/* ------------------------------------------------------------------ */
/* 堆下滤                                                               */
/* ------------------------------------------------------------------ */

export type SiftPick = 'left' | 'right' | 'stop';

/**
 * 在 array[index] 处按堆序规则应做的动作：
 * 有更高优先级孩子且父节点劣于它 → 返回 'left'/'right'；否则 'stop'。
 * 与 heap.ts 内核同一规则：右孩子仅在严格更好时入选，平局取左。
 * 节点没有孩子返回 null（下滤自然结束，不需要选择）。
 */
export function siftExpected(array: number[], index: number, heapType: 'max' | 'min'): SiftPick | null {
  const left = index * 2 + 1;
  if (left >= array.length) return null;
  const right = left + 1;
  const preferRight = right < array.length
    && (heapType === 'max' ? array[right]! > array[left]! : array[right]! < array[left]!);
  const child = preferRight ? right : left;
  const holds = heapType === 'max' ? array[index]! >= array[child]! : array[index]! <= array[child]!;
  return holds ? 'stop' : preferRight ? 'right' : 'left';
}

export interface ManualSiftStep {
  deletion: number;
  index: number;
  pick: SiftPick;
  /** 按学生当前数组状态，堆序规则在此处的正确动作。 */
  expected: SiftPick;
  ok: boolean;
  error: string | null;
  /** 该选择生效后的堆数组（无效选择状态不变）。 */
  array: number[];
}

export interface ManualSiftAudit {
  steps: ManualSiftStep[];
  /** 每次删除后的数组快照；finished 表示这次删除的下滤走到了收尾。 */
  deletions: { deleted: number; array: number[]; valid: boolean; finished: boolean }[];
  /** 下一个选择将被判定的位置（array 已是补位后的状态）；全部完成为 null。 */
  pending: { deletion: number; index: number; array: number[]; deleted: number } | null;
  /** 处理完全部选择后的堆数组（中断时也是当前态）。 */
  array: number[];
  errors: string[];
  warnings: string[];
  /** 全部 deletionCount 次删除都走到了收尾（不论对错）。 */
  complete: boolean;
  /** 完成且没有任何错误——轨迹与内核确定一致。 */
  matchesKernel: boolean;
}

function heapHolds(array: number[], heapType: 'max' | 'min'): boolean {
  return array.every((value, index) => index === 0 || (heapType === 'max'
    ? array[Math.floor((index - 1) / 2)]! >= value
    : array[Math.floor((index - 1) / 2)]! <= value));
}

/**
 * 审计学生的手动堆删除。每次删除：堆顶被末位元素替换，然后学生逐步决定
 * 与左/右孩子交换或停止。选择按学生自己的数组判定——
 * 选非最优孩子也照样交换，把堆弄坏的后果留在行里供观察；
 * 选不存在的孩子不生效；该停而停、该换而换才算正确。
 */
export function auditManualSiftDown(
  initialHeap: number[],
  heapType: 'max' | 'min',
  deletionCount: number,
  picks: SiftPick[],
): ManualSiftAudit {
  const steps: ManualSiftStep[] = [];
  const deletions: ManualSiftAudit['deletions'] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const array = [...initialHeap];
  let cursor = 0;
  let pending: ManualSiftAudit['pending'] = null;
  outer:
  for (let deletion = 1; deletion <= deletionCount; deletion += 1) {
    const deleted = array[0]!;
    const last = array.pop()!;
    if (array.length) array[0] = last;
    let index = 0;
    // 下滤：只在节点有孩子时消耗一个选择；无孩子时删除自动收尾。
    while (index * 2 + 1 < array.length) {
      if (cursor >= picks.length) {
        pending = { deletion, index, array: [...array], deleted };
        deletions.push({ deleted, array: [...array], valid: heapHolds(array, heapType), finished: false });
        warnings.push(`第 ${deletion} 次删除的下滤还没走完：值 ${array[index]} 停在下标 ${index} 等待判断。`);
        break outer;
      }
      const expected = siftExpected(array, index, heapType)!;
      const pick = picks[cursor]!;
      cursor += 1;
      const left = index * 2 + 1;
      const right = left + 1;
      let error: string | null = null;
      if (pick === 'stop') {
        if (expected !== 'stop') {
          const child = expected === 'right' ? right : left;
          error = `第 ${deletion} 次删除：下标 ${index} 的值 ${array[index]} 仍劣于${expected === 'right' ? '右' : '左'}孩子 ${array[child]}，此时停止下滤会让堆序停在未恢复状态。`;
          errors.push(error);
        }
        steps.push({ deletion, index, pick, expected, ok: error === null, error, array: [...array] });
        index = array.length; // 学生喊停就停——无论对错，这次删除收尾
      } else {
        const target = pick === 'left' ? left : right;
        if (target >= array.length) {
          error = `第 ${deletion} 次删除：下标 ${index} 没有${pick === 'left' ? '左' : '右'}孩子，不能与空气交换。`;
          errors.push(error);
          steps.push({ deletion, index, pick, expected, ok: false, error, array: [...array] });
          // index 不变：无效选择不生效，下一个选择仍在原节点判定
        } else {
          if (pick !== expected) {
            const better = expected === 'right' ? right : left;
            error = expected === 'stop'
              ? `第 ${deletion} 次删除：下标 ${index} 的值 ${array[index]} 已不劣于孩子 ${array[better]}，堆序成立，交换反而把堆弄坏。`
              : `第 ${deletion} 次删除：${expected === 'right' ? '右' : '左'}孩子 ${array[better]} 才是优先级更高的那个，应与其交换而不是与${pick === 'right' ? '右' : '左'}孩子 ${array[target]}。`;
            errors.push(error);
          }
          [array[index], array[target]] = [array[target]!, array[index]!];
          steps.push({ deletion, index, pick, expected, ok: error === null, error, array: [...array] });
          index = target;
        }
      }
    }
    deletions.push({ deleted, array: [...array], valid: heapHolds(array, heapType), finished: true });
    if (deletion < deletionCount && cursor >= picks.length) {
      // 这次删除做完了，但剩下的删除还没有选择可用——预告下一次删除后的决策点。
      const preview = [...array];
      const root = preview[0]!;
      const tail = preview.pop()!;
      if (preview.length) preview[0] = tail;
      pending = { deletion: deletion + 1, index: 0, array: preview, deleted: root };
      warnings.push(`第 ${deletion} 次删除已完成；还剩 ${deletionCount - deletion} 次删除没有选择。`);
      break;
    }
  }
  if (cursor < picks.length && deletions.length >= deletionCount) {
    warnings.push(`全部 ${deletionCount} 次删除已经完成，剩余 ${picks.length - cursor} 个选择被忽略。`);
  }
  const complete = deletions.length === deletionCount && deletions.every((row) => row.finished);
  return { steps, deletions, pending, array, errors, warnings, complete, matchesKernel: complete && errors.length === 0 };
}
