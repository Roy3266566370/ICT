import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheTraceFrames,
  dsTraversalFrames,
  graphDijkstraFrames,
  ieee754Decode,
  kmpFrames,
  parseHexList,
  parseInstructionList,
  pipelineFrames,
  sortFrames,
} from './lab408Sim.ts';

const last = <T>(list: readonly T[]): T => {
  assert.ok(list.length > 0, '帧列表不应为空');
  return list[list.length - 1]!;
};

const traversalText = (order: number): string =>
  dsTraversalFrames(order).frames.map(frame => frame.activeId).join(' ');

test('二叉树四种遍历的帧序列与契约一致', () => {
  assert.equal(traversalText(0), 'A B D E C F');
  assert.equal(traversalText(1), 'D B E A C F');
  assert.equal(traversalText(2), 'D E B F C A');
  assert.equal(traversalText(3), 'A B C D E F');

  const preorder = dsTraversalFrames(0);
  assert.equal(preorder.frames.length, 6);
  assert.deepEqual(preorder.frames[0]!.stackOrQueue, ['A']);
  assert.deepEqual(preorder.frames[2]!.visited, ['A', 'B', 'D']);

  const level = dsTraversalFrames(3);
  assert.deepEqual(level.frames[0]!.stackOrQueue, ['B', 'C']);
  assert.deepEqual(last(level.frames).visited, ['A', 'B', 'C', 'D', 'E', 'F']);
});

test('KMP 前缀函数与命中位置', () => {
  const player = kmpFrames('ABABABC', 'ABABC');
  const hit = last(player.frames);
  assert.equal(hit.matched, true);
  assert.equal(hit.i, 7);
  assert.equal(hit.j, 5);
  assert.equal(hit.shiftedBy, 2);
  assert.deepEqual(hit.next, [0, 0, 1, 2, 0]);

  const miss = kmpFrames('ABABABX', 'ABABC');
  assert.equal(last(miss.frames).matched, false);
  assert.deepEqual(last(miss.frames).next, [0, 0, 1, 2, 0]);

  assert.ok(kmpFrames('', '').frames.length > 0);
});

test('快速排序与堆排序的终态、比较与交换帧', () => {
  for (const algo of ['quicksort', 'heapsort'] as const) {
    const player = sortFrames([5, 2, 9, 1, 5, 6], algo);
    const final = last(player.frames);
    assert.deepEqual(final.values, [1, 2, 5, 5, 6, 9], `${algo} 终态`);
    assert.deepEqual(final.sorted, [0, 1, 2, 3, 4, 5], `${algo} 已定位索引`);
    assert.ok(player.frames.some(frame => frame.compare !== null), `${algo} 至少一次比较`);
    assert.ok(player.frames.some(frame => frame.swap !== null), `${algo} 至少一次交换`);
  }

  const empty = sortFrames([], 'quicksort');
  assert.deepEqual(last(empty.frames).values, [1, 2, 5, 5, 6, 9]);
});

test('Dijkstra 的最终距离与前驱', () => {
  const graph = {
    nodes: 6,
    edges: [
      [0, 1, 7], [0, 2, 9], [0, 5, 14], [1, 2, 10], [1, 3, 15],
      [2, 3, 11], [2, 5, 2], [3, 4, 6], [4, 5, 9],
    ] as const,
  };
  const player = graphDijkstraFrames(graph, 0);
  const final = last(player.frames);
  assert.deepEqual(final.dist, [0, 7, 9, 20, 26, 11]);
  assert.equal(final.prev[4], 3);
  assert.ok(player.frames.length >= 6);

  const fallback = graphDijkstraFrames({ nodes: 6, edges: [] }, 0);
  assert.deepEqual(last(fallback.frames).dist, [0, 7, 9, 20, 26, 11]);
});

test('Cache 组相联访存的位宽、命中与缺失', () => {
  assert.deepEqual(parseHexList('0x0, 0x40, 0x1000'), [0, 64, 4096]);
  assert.deepEqual(parseHexList(''), []);

  const player = cacheTraceFrames(32, 64, 64, 4, '0x0, 0x40, 0x0, 0x1000');
  assert.equal(player.frames.length, 4);
  const first = player.frames[0]!;
  assert.equal(first.tag, 18);
  assert.equal(first.index, 8);
  assert.equal(first.offset, 6);
  assert.equal(first.tag + first.index + first.offset, 32);
  assert.equal(first.hit, false);
  assert.equal(player.frames[1]!.hit, false);
  assert.equal(player.frames[2]!.hit, true);
  assert.equal(player.frames[3]!.hit, false);
  assert.equal(player.frames[3]!.evictedWay, null);

  const final = last(player.frames);
  assert.equal(final.hits + final.misses, player.frames.length);

  // ways=1 时组 0 的块跨距为 sets * blockBytes = 1024 * 64 = 0x10000，必然替换。
  const evicted = cacheTraceFrames(32, 64, 64, 1, '0x0, 0x10000');
  assert.equal(last(evicted.frames).evictedWay, 0);

  const invalid = cacheTraceFrames(8, 48, 64, 4, '0x0');
  assert.deepEqual(invalid.frames, []);
  assert.ok(invalid.summary.length > 0);
});

test('IEEE754 位段解码覆盖五类', () => {
  const one = ieee754Decode('0x3f800000');
  assert.equal(one.category, 'normal');
  assert.equal(one.actualValue, 1);
  assert.equal(one.error, 0);
  assert.equal(one.bits, 0x3f800000);

  const half = ieee754Decode('1.5');
  assert.equal(half.bits, 0x3fc00000);
  assert.equal(half.actualValue, 1.5);

  const inf = ieee754Decode('0x7f800000');
  assert.equal(inf.category, 'inf');
  const nan = ieee754Decode('0x7fc00000');
  assert.equal(nan.category, 'nan');
  const zero = ieee754Decode('0x0');
  assert.equal(zero.category, 'zero');
  const denorm = ieee754Decode('0x00000001');
  assert.equal(denorm.category, 'denorm');

  assert.equal(ieee754Decode('0x3ff0000000000000').actualValue, 1);
  assert.equal(ieee754Decode('1.5', 64).bits, 0x3ff8000000000000);
});

test('五级流水线的数据冒险、load-use 停顿与时空图', () => {
  const instructions = ['ADD R1,R2,R3', 'SUB R4,R1,R5', 'LW R6,0(R7)', 'ADD R8,R6,R9'];
  const noForward = pipelineFrames(instructions, false);
  const wideConflicts = noForward.frames[0]!.conflicts;
  assert.ok(wideConflicts.some(item => item.a === 0 && item.b === 1 && item.register === 'R1'));
  assert.ok(wideConflicts.some(item => item.a === 2 && item.b === 3 && item.register === 'R6'));

  const forwarded = pipelineFrames(instructions, true);
  assert.deepEqual(forwarded.frames[0]!.conflicts, []);
  assert.equal(forwarded.frames[0]!.stalls.length, 1);
  assert.equal(forwarded.frames[0]!.stalls[0]!.instruction, 3);
  for (const frame of forwarded.frames) {
    assert.equal(frame.stages[frame.cycle]!.length, instructions.length);
  }

  assert.deepEqual(parseInstructionList('ADD R1,R2,R3\nSUB R4,R1,R5'), ['ADD R1,R2,R3', 'SUB R4,R1,R5']);
  assert.equal(parseInstructionList('').length, 4);
});