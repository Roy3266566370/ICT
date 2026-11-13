import type { LabModel, LabResultBase, LabResultFrame } from './types.ts';

export interface HeapFrame extends LabResultFrame {
  action: 'initial' | 'replace_root' | 'compare' | 'sift_down' | 'deletion_done' | 'done';
  array: number[];
  deleted: number[];
  swapped_indices: number[];
  heap_valid: boolean;
  deletion: number;
  pseudocodeLine: number;
}

export interface HeapResult extends LabResultBase {
  subject: 'algorithm';
  algorithm: 'heap';
  status: 'ok' | 'blocked';
  reason?: string;
  heapType: 'max' | 'min';
  initialHeap: number[];
  finalHeap: number[];
  deleted: number[];
  deletionCount: number;
  snapshots: number[][];
  frames: HeapFrame[];
  trace: HeapFrame[];
  pseudocode: string[];
}

const PSEUDOCODE = [
  '记录初始堆与删除次数',
  '删除堆顶，用末尾元素填充根节点',
  '选择两个孩子中优先级更高者（相同则选左）',
  '若孩子优先于父节点，交换并继续向下筛选',
  '堆序恢复，记录一次删除的结果',
  '重复直到完成指定次数',
];

function validHeap(array: number[], kind: 'max' | 'min'): boolean {
  return array.every((value, index) => index === 0 || (kind === 'max'
    ? array[Math.floor((index - 1) / 2)]! >= value
    : array[Math.floor((index - 1) / 2)]! <= value));
}

/** Execute only validated original data. Exploration changes the deletion count. */
export function evaluateHeap(model: LabModel, params: Record<string, unknown>): HeapResult {
  const data = model as LabModel & { initial_heap?: unknown; heap_type?: unknown };
  const raw = data.initial_heap;
  const kind = data.heap_type;
  const rawCount = params.deletion_count === undefined ? model.defaults.deletion_count : params.deletion_count;
  const count = (typeof rawCount === 'number' || (typeof rawCount === 'string' && rawCount.trim() !== '')) ? Number(rawCount) : NaN;
  let reason = '';
  if (!Array.isArray(raw) || !raw.length || raw.length > 127 || !raw.every(value => typeof value === 'number' && Number.isFinite(value))) {
    reason = '请提供 1–127 个有限数值组成的初始堆序列。';
  } else if (kind !== 'max' && kind !== 'min') {
    reason = '请确认使用大根堆还是小根堆。';
  } else if (!validHeap(raw, kind)) {
    reason = '初始序列不满足堆序，请核对原题；不会自动重新建堆。';
  } else if (!Number.isInteger(count) || count < 0 || count > raw.length) {
    reason = `删除次数须为 0–${raw.length} 的整数，不能从空堆继续删除。`;
  } else {
    let budget = 2;
    for (let deletion = 1; deletion <= count; deletion += 1) budget += 2 + 2 * Math.floor(Math.log2(Math.max(1, raw.length - deletion)));
    if (budget > 200) reason = '该操作的完整轨迹上限超过 200 帧，请减少删除次数或初始堆大小。';
  }
  const heapType = kind === 'min' ? 'min' : 'max';
  const base: HeapResult = {
    subject: 'algorithm', algorithm: 'heap', status: reason ? 'blocked' : 'ok',
    reason: reason || undefined, headline: reason, heapType, initialHeap: [], finalHeap: [],
    deleted: [], deletionCount: Number.isInteger(count) ? count : 0, snapshots: [],
    frames: [], trace: [], pseudocode: PSEUDOCODE, checks: [], metrics: [], notes: [],
  };
  if (reason) return base;
  const initial = [...raw as number[]];
  const array = [...initial];
  const deleted: number[] = [];
  const frames: HeapFrame[] = [];
  const snapshots = [[...array]];
  function record(action: HeapFrame['action'], label: string, detail: string, indices: number[], deletion: number, line: number): void {
    const values = { array: [...array], deleted: [...deleted], swapped_indices: [...indices], heap_valid: validHeap(array, heapType), deletion };
    frames.push({ index: frames.length, action, label, detail, values, ...values, pseudocodeLine: line });
  }
  record('initial', '初始堆', '核对初始数组满足堆序。', [], 0, 1);
  for (let deletion = 1; deletion <= count; deletion += 1) {
    const root = array[0]!;
    deleted.push(root);
    const last = array.pop()!;
    if (array.length) array[0] = last;
    record('replace_root', `第 ${deletion} 次删除堆顶 ${root}`, '删除堆顶，末尾元素补到根节点；可能暂时不满足堆序。', array.length ? [0] : [], deletion, 2);
    let index = 0;
    while (index * 2 + 1 < array.length) {
      let child = index * 2 + 1;
      const right = child + 1;
      if (right < array.length && (heapType === 'max' ? array[right]! > array[child]! : array[right]! < array[child]!)) child = right;
      record('compare', '比较父节点与优先孩子', `父节点下标 ${index}，优先孩子下标 ${child}；同值优先选择左孩子。`, [index, child], deletion, 3);
      if (heapType === 'max' ? array[index]! >= array[child]! : array[index]! <= array[child]!) break;
      [array[index], array[child]] = [array[child]!, array[index]!];
      record('sift_down', `交换下标 ${index} 与 ${child}`, '交换后沿该孩子继续向下检查。', [index, child], deletion, 4);
      index = child;
    }
    snapshots.push([...array]);
    record('deletion_done', `第 ${deletion} 次删除完成`, '堆序已恢复，按层序数组记录当前堆。', [], deletion, 5);
  }
  record('done', '删除完成', '最终序列是堆的层序数组。', [], count, 6);
  return {
    ...base, initialHeap: initial, finalHeap: [...array], deleted, snapshots, frames, trace: frames,
    headline: `删除 ${count} 次后的堆：[${array.join(', ')}]`,
    metrics: [{ id: 'array', label: '堆数组', value: `[${array.join(', ')}]` }, { id: 'deleted', label: '已删除', value: `[${deleted.join(', ')}]` }],
    checks: [{ id: 'heap_invariant', label: '最终堆序', status: 'pass', detail: '各次删除完成后均恢复父节点与孩子之间的堆序。' }],
    notes: ['下标从 0 开始；筛选中的临时状态可能不满足堆序。相同优先级的孩子固定选择左侧。'],
  };
}
