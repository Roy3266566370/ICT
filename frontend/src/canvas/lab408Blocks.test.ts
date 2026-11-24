import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arrayFromParams,
  cacheMap,
  dijkstraSteps,
  graphFromText,
  graphOf,
  memoryAddressStream,
  parseGraph,
  parseNumberArray,
  primSteps,
  shortestPathSteps,
  sortRace,
  translateAddresses,
} from './lab408Blocks.ts';

test('数组源支持随机、有序、逆序和手动输入，并限制长度', () => {
  assert.deepEqual(parseNumberArray('3, 1，2 5'), [3, 1, 2, 5]);
  assert.throws(() => parseNumberArray(''));
  assert.throws(() => parseNumberArray('1, a'));
  const random = arrayFromParams({ mode: 0, length: 8, seed: 3 });
  assert.equal(random.mode, 'array');
  assert.equal(random.values?.length, 8);
  assert.deepEqual(random.values, arrayFromParams({ mode: 0, length: 8, seed: 3 }).values);
  assert.deepEqual(arrayFromParams({ mode: 1, length: 5 }).values, [1, 2, 3, 4, 5]);
  assert.deepEqual(arrayFromParams({ mode: 3, length: 5 }, '9 8 7').values, [9, 8, 7]);
  assert.ok((arrayFromParams({ mode: 0, length: 999 }).values?.length ?? 0) <= 60);
});

test('排序竞赛统计三种算法的比较、交换与步进序列', () => {
  const races = sortRace([5, 2, 9, 1, 3]);
  assert.equal(races.length, 3);
  for (const race of races) {
    assert.ok(race.comparisons > 0);
    assert.ok(race.swaps > 0);
    assert.ok(race.steps.length > 0);
    assert.ok(race.steps.every(Number.isFinite));
  }
  assert.equal(new Set(races.map((race) => race.name)).size, 3);
});

test('图源解析边表，Dijkstra 与 Prim 给出已知结果', () => {
  const graph = parseGraph('A B 4\nA C 2\nB C 1\nB D 5\nC D 8\nC E 10\nD E 2\nE F 3');
  const dijkstra = dijkstraSteps(graph, 'A');
  assert.equal(dijkstra.distances.F, 13);
  assert.equal(dijkstra.distances.D, 8);
  assert.equal(dijkstra.order[0], 'A');
  assert.ok(dijkstra.frames.length > 0);
  const prim = primSteps(graph, 'A');
  assert.equal(prim.totalWeight, 13);
  assert.equal(prim.edges.length, 5);
  const data = graphFromText('');
  assert.equal(graphOf(data)?.nodes.length, 6);
  assert.throws(() => parseGraph('A'));
  assert.throws(() => parseGraph('A B -1'));
  assert.equal(shortestPathSteps(graph, 1, 'A').algorithm, 'prim');
});

test('访存地址流可生成或手动输入，长度受限', () => {
  const generated = memoryAddressStream({ base: 4096, stride: 64, count: 5, seed: 7 });
  assert.equal(generated.mode, 'addrStream');
  assert.equal(generated.addresses?.length, 5);
  assert.ok(generated.addresses?.every((value) => value >= 4096));
  const manual = memoryAddressStream({ mode: 1, count: 3 }, '100 200 300');
  assert.deepEqual(manual.addresses, [100, 200, 300]);
});

test('TLB/页表翻译给出命中、走表与物理地址', () => {
  const result = translateAddresses([0, 64, 128, 64], { pageSize: 64, tlbEntries: 2, policy: 0 });
  assert.equal(result.rows.length, 4);
  assert.equal(result.tlbHits, 1);
  assert.equal(result.pageWalks, 3);
  assert.equal(result.rows[0]!.vpn, 0);
  assert.equal(result.rows[0]!.offset, 0);
  assert.ok(result.rows.every((row) => Number.isFinite(row.physical)));
  assert.deepEqual(result.tlb, [1, 2]);
});

test('Cache 映射统计命中、缺失与 LRU 替换', () => {
  const result = cacheMap([0, 64, 128, 0], { blockBytes: 64, cacheKB: 1, ways: 2, policy: 1 });
  assert.equal(result.hits, 1);
  assert.equal(result.misses, 3);
  assert.ok(Math.abs(result.hitRate - 0.25) < 1e-9);
  assert.equal(result.sets, 8);
  assert.ok(result.rows.every((row) => Number.isFinite(row.tag) && Number.isFinite(row.index)));
  const conflict = cacheMap([0, 512, 1024, 0], { blockBytes: 64, cacheKB: 1, ways: 1, policy: 0 });
  assert.equal(conflict.hits, 0);
  assert.ok(conflict.rows.some((row) => row.evictedTag !== null));
});
