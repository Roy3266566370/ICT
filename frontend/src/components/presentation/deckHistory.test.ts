import test from 'node:test';
import assert from 'node:assert/strict';
import type { ISpec } from '../../ispec/types.ts';
import {
  changeDeckParameters,
  commitHistory,
  createHistory,
  sameDeckValues,
  sameObjectValues,
} from './deckHistory.ts';

function makeSpec(objectId: string, sharedKey?: string): ISpec {
  return {
    spec_version: '1.0',
    object_id: objectId,
    kind: 'geometric',
    parameters: [
      { id: 'a', label: 'a', type: 'number', default: 1, source: { page: 1, element_id: 'e1', excerpt: 'A' }, shared_key: sharedKey },
      { id: 'b', label: 'b', type: 'number', default: 0, source: { page: 1, element_id: 'e1', excerpt: 'B' } },
      { id: 'c', label: 'c', type: 'number', default: 0, source: { page: 1, element_id: 'e1', excerpt: 'C' } },
      { id: 'd', label: 'd', type: 'number', default: 1, source: { page: 1, element_id: 'e1', excerpt: 'D' } },
    ],
    expressions: [],
    views: [],
    constraints: [],
    checks: [],
  };
}

test('changeDeckParameters 一次批量更新多参数并同步 shared_key，未变更对象保持原引用', () => {
  const s1 = makeSpec('obj1', 'shared_a');
  const s2 = makeSpec('obj2', 'shared_a');
  const s3 = makeSpec('obj3');
  const initial = {
    obj1: { a: 1, b: 0, c: 0, d: 1 },
    obj2: { a: 1, b: 0, c: 0, d: 1 },
    obj3: { a: 1, b: 0, c: 0, d: 1 },
  };
  const next = changeDeckParameters([s1, s2, s3], initial, [
    { objectId: 'obj1', id: 'a', value: 2.5 },
    { objectId: 'obj1', id: 'c', value: -0.5 },
  ]);
  assert.equal(next.obj1?.a, 2.5);
  assert.equal(next.obj1?.c, -0.5);
  assert.equal(next.obj2?.a, 2.5);
  assert.equal(next.obj3, initial.obj3);
  assert.equal(sameObjectValues(initial.obj3, next.obj3), true);
  assert.equal(sameDeckValues(initial, next), false);
});

test('连续二维拖动按组合 key 合并为单条撤销记录，避免历史栈暴涨', () => {
  const s1 = makeSpec('obj1');
  const base = { obj1: { a: 1, b: 0, c: 0, d: 1 } };
  let h = createHistory(base);
  const groupKey = 'obj1.b|obj1.d';
  for (let i = 1; i <= 10; i += 1) {
    const next = changeDeckParameters([s1], h.present, [
      { objectId: 'obj1', id: 'b', value: i * 0.1 },
      { objectId: 'obj1', id: 'd', value: 1 + i * 0.05 },
    ]);
    h = commitHistory(h, next, groupKey, 1000 + i * 16);
  }
  assert.equal(h.past.length, 1);
  assert.deepEqual(h.past[0], base);
  assert.equal(h.present.obj1?.b, 1);
  assert.equal(h.present.obj1?.d, 1.5);
});
