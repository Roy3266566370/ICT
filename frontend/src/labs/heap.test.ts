import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateHeap } from './heap.ts';
import type { LabModel } from './types.ts';

const model = { engine: 'heap_v1', subject: 'algorithm', algorithm: 'heap', heap_type: 'max', initial_heap: [28,22,20,19,8,12,15,5], defaults: { deletion_count: 2 }, params: [] } as LabModel;

test('heap root deletion records real sift-down and preserves source', () => {
  const result = evaluateHeap(model, {});
  assert.equal(result.algorithm, 'heap');
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.finalHeap, [20,19,15,5,8,12]);
  assert.deepEqual(result.deleted, [28,22]);
  assert.deepEqual(result.snapshots[1], [22,19,20,5,8,12,15]);
  const swap = result.frames.find(frame => frame.action === 'sift_down')!;
  assert.deepEqual(swap.array, [22,5,20,19,8,12,15]);
  assert.deepEqual(swap.swapped_indices, [0,1]);
  assert.equal(swap.heap_valid, false);
  assert.deepEqual(evaluateHeap(model, { deletion_count: 0 }).finalHeap, [28,22,20,19,8,12,15,5]);
});

test('heap supports min heaps, duplicate keys and deleting the last item', () => {
  const min = { ...model, heap_type: 'min', initial_heap: [1,3,2,7,4,5], defaults: { deletion_count: 1 } } as LabModel;
  assert.deepEqual(evaluateHeap(min, {}).finalHeap, [2,3,5,7,4]);
  const duplicates = { ...model, initial_heap: [9,9,8,4,4] } as LabModel;
  assert.deepEqual(evaluateHeap(duplicates, {}).finalHeap, [8,4,4]);
  const last = { ...model, initial_heap: [7], defaults: { deletion_count: 1 } } as LabModel;
  assert.deepEqual(evaluateHeap(last, {}).finalHeap, []);
});

test('invalid heaps and underflow do not produce an execution', () => {
  for (const count of [-1, 99, 1.5, 'garbage']) {
    const result = evaluateHeap(model, { deletion_count: count });
    assert.equal(result.status, 'blocked');
    assert.equal(result.frames.length, 0);
  }
  assert.equal(evaluateHeap({ ...model, initial_heap: [1,9,2] } as LabModel, {}).status, 'blocked');
  assert.equal(evaluateHeap({ ...model, initial_heap: [9,'bad',2] } as unknown as LabModel, {}).status, 'blocked');
});

test('heap trace budget is explicit instead of truncating replay', () => {
  const large = { ...model, initial_heap: Array.from({ length: 127 }, (_, i) => 127 - i) } as LabModel;
  assert.equal(evaluateHeap(large, { deletion_count: 1 }).status, 'ok');
  const result = evaluateHeap(large, { deletion_count: 127 });
  assert.equal(result.status, 'blocked');
  assert.match(result.reason!, /200.*减少/);
  assert.equal(result.frames.length, 0);
});
