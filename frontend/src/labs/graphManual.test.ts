import test from 'node:test';
import assert from 'node:assert/strict';
import { auditManualSiftDown, auditManualTraversal, expectedTraversal } from './graphManual.ts';

/* 与 compute.ts 的 computeBfs/computeDfs 同源的小图：
 * A--B, A--C, B--D；邻居按编号升序。BFS: A,B,C,D；DFS: A,B,D,C。 */
const ADJ: Record<string, string[]> = { A: ['B', 'C'], B: ['A', 'D'], C: ['A'], D: ['B'] };
const NODES = ['A', 'B', 'C', 'D'];
const EDGE_ADJ: Record<string, string[]> = { A: ['B'], B: [], C: ['B'], D: [] };

test('expectedTraversal reproduces the kernel visit orders', () => {
  assert.deepEqual(expectedTraversal(ADJ, 'A', 'bfs').order, ['A', 'B', 'C', 'D']);
  assert.deepEqual(expectedTraversal(ADJ, 'A', 'dfs').order, ['A', 'B', 'D', 'C']);
});

test('auditManualTraversal accepts the exact BFS order and marks unreachable nodes', () => {
  const audit = auditManualTraversal(EDGE_ADJ, ['A', 'B', 'C', 'D'], 'A', ['A', 'B'], 'bfs');
  assert.equal(audit.complete, true);
  assert.equal(audit.matchesKernel, true);
  assert.equal(audit.divergence, null);
  assert.deepEqual(audit.unreachable, ['C', 'D']);
});

test('auditManualTraversal flags a queue-jumping pick with the real queue snapshot', () => {
  const audit = auditManualTraversal(ADJ, NODES, 'A', ['A', 'C'], 'bfs');
  assert.equal(audit.complete, false);
  const step = audit.steps[1]!;
  assert.equal(step.ok, false);
  assert.deepEqual(step.container, ['B', 'C']);
  assert.match(step.error!, /BFS 必须先出队队首 B/);
  assert.equal(audit.divergence?.index, 1);
  assert.equal(audit.divergence?.expected, 'B');
});

test('auditManualTraversal distinguishes undiscovered, visited and repeated picks', () => {
  // BFS 期望 A,B,C,D：错一个后面逐个错位（期望序列是固定置换）
  const audit = auditManualTraversal(ADJ, NODES, 'A', ['A', 'D', 'B', 'C', 'A'], 'bfs');
  assert.match(audit.steps[1]!.error!, /还没有被发现/);          // D 未入队，容器 [B,C]
  assert.match(audit.steps[2]!.error!, /已经访问过/);            // B 在第 1 步已访问
  assert.match(audit.steps[3]!.error!, /已经访问过/);            // C 在第 2 步已访问
  assert.match(audit.steps[4]!.error!, /多余/);                  // 4 个可达节点后仍有点选
  assert.equal(audit.complete, true);                            // 已给足 4 个选择，只是中间有错
  assert.equal(audit.matchesKernel, false);
  assert.equal(audit.divergence?.index, 1);
});

test('auditManualTraversal DFS flags not-yet-pushed picks and duplicates', () => {
  // DFS 期望 A,B,D,C
  const audit = auditManualTraversal(ADJ, NODES, 'A', ['A', 'B', 'C', 'D', 'A'], 'dfs');
  const step = audit.steps[2]!;
  assert.equal(step.ok, false);
  assert.match(step.error!, /还没有被发现（未压栈）/);            // C 不在栈 [A,B,D] 中
  assert.match(step.error!, /应先访问栈顶 D/);
  assert.match(audit.steps[3]!.error!, /已经访问过/);            // D 在第 2 步已访问
  assert.match(audit.steps[4]!.error!, /多余/);
  assert.equal(audit.matchesKernel, false);
  const dup = auditManualTraversal(ADJ, NODES, 'A', ['A', 'B', 'A', 'D', 'C'], 'dfs');
  assert.match(dup.steps[2]!.error!, /已经访问过/);
  assert.match(dup.steps[4]!.error!, /多余/);
});

test('auditManualSiftDown replays a correct deletion identically to the kernel', () => {
  // max heap [9,7,5,6,1]：删 9 → 1 补根 → [1,7,5,6]；left 7 优先 → 交换；再 left 6 → 交换 → [7,6,5,1]
  const audit = auditManualSiftDown([9, 7, 5, 6, 1], 'max', 1, ['left', 'left']);
  assert.equal(audit.complete, true);
  assert.equal(audit.matchesKernel, true);
  assert.deepEqual(audit.array, [7, 6, 5, 1]);
  assert.equal(audit.deletions[0]!.valid, true);
  assert.equal(audit.pending, null);
});

test('auditManualSiftDown picks the higher-priority right child', () => {
  // min heap [2,5,9,8,6,10]：删 2 → 10 补根 → [10,5,9,8,6]；孩子 5,9 → left；
  // 交换后 [5,10,9,8,6]，节点在下标 1，孩子 8,6 → 右孩子 6 更优 → 'right'
  const audit = auditManualSiftDown([2, 5, 9, 8, 6, 10], 'min', 1, ['left', 'right']);
  assert.equal(audit.matchesKernel, true);
  assert.deepEqual(audit.array, [5, 6, 9, 8, 10]);
});

test('auditManualSiftDown records an early stop and keeps the broken heap visible', () => {
  const audit = auditManualSiftDown([9, 7, 5, 6, 1], 'max', 1, ['stop']);
  assert.equal(audit.complete, true); // 学生喊停即收尾，只是收尾得不对
  assert.equal(audit.matchesKernel, false);
  assert.match(audit.steps[0]!.error!, /停止下滤/);
  assert.equal(audit.deletions[0]!.valid, false);
  assert.deepEqual(audit.array, [1, 7, 5, 6]); // 1 仍在根上，堆坏着
});

test('auditManualSiftDown applies a worse-child swap anyway and marks it', () => {
  // 应选左孩子 7，学生选了右孩子 5 → 错误标记但仍执行交换，下滤沿右支继续
  const audit = auditManualSiftDown([9, 7, 5, 6, 1], 'max', 1, ['right', 'left']);
  assert.equal(audit.steps[0]!.ok, false);
  assert.match(audit.steps[0]!.error!, /左孩子 7 才是优先级更高/);
  // 交换 1↔5 后 [5,7,1,6]，下标 2 无孩子 → 删除结束，堆序不成立
  assert.equal(audit.steps[1], undefined);
  assert.deepEqual(audit.array, [5, 7, 1, 6]);
  assert.equal(audit.deletions[0]!.valid, false);
});

test('auditManualSiftDown rejects swapping with a non-existent child without state change', () => {
  // [9,7,5,6] 删后 [1,7,5,6]——下标 0 左右都有；先到下标 1 后其右孩子下标 4 不存在
  const audit = auditManualSiftDown([9, 7, 5, 6, 1], 'max', 1, ['left', 'right']);
  assert.equal(audit.steps[1]!.ok, false);
  assert.match(audit.steps[1]!.error!, /没有右孩子/);
  // 无效选择不改数组；停在下标 1 等下一个选择
  assert.deepEqual(audit.steps[1]!.array, [7, 1, 5, 6]);
  assert.equal(audit.pending?.index, 1);
  assert.equal(audit.complete, false);
});

test('auditManualSiftDown reports the pending decision point when picks run out', () => {
  const audit = auditManualSiftDown([9, 7, 5, 6, 1], 'max', 2, ['left']);
  assert.equal(audit.complete, false);
  assert.equal(audit.pending?.deletion, 1);
  assert.equal(audit.pending?.index, 1);
  assert.match(audit.warnings[0]!, /下滤还没走完/);
  const next = auditManualSiftDown([9, 7, 5, 6, 1], 'max', 2, ['left', 'left']);
  assert.equal(next.pending?.deletion, 2);
  assert.equal(next.pending?.index, 0);
  // 下一次删除：堆顶 7 删除、末位 1 补到根 → [1,6,5]
  assert.deepEqual(next.pending?.array, [1, 6, 5]);
  assert.equal(next.pending?.deleted, 7);
});
