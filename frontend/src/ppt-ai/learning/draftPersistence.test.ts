import assert from 'node:assert/strict';
import test from 'node:test';

import { clearLearningDrafts, draftKey, LearningDraftPersistence, type StorageLike } from './draftPersistence.ts';

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>();
  get length(): number { return this.data.size; }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
}

const scope = {
  viewerKey: 'ses_a',
  materialKey: 'mat_1',
  sourceHash: 'a'.repeat(64),
  nodeId: 'ain_1',
  pageNo: 6,
};

test('不同账号、材料、快照与节点使用不同键', () => {
  const keys = [
    draftKey(scope),
    draftKey({ ...scope, viewerKey: 'ses_b' }),
    draftKey({ ...scope, materialKey: 'mat_2' }),
    draftKey({ ...scope, sourceHash: 'b'.repeat(64) }),
    draftKey({ ...scope, nodeId: 'ain_2' }),
    draftKey({ ...scope, pageNo: 7 }),
  ];
  assert.equal(new Set(keys).size, keys.length);
});

test('保存/恢复草稿，来源或节点变化后不自动套用', () => {
  const storage = new MemoryStorage();
  const persistence = new LearningDraftPersistence(scope, storage);
  persistence.save({ a11: 2.5, v1: 1, bad: Number.NaN }, 3);
  const loaded = new LearningDraftPersistence(scope, storage).load();
  assert.equal(loaded?.draftRevision, 3);
  assert.equal(loaded?.values.a11, 2.5);
  assert.equal('bad' in (loaded?.values ?? {}), false);
  const otherSource = new LearningDraftPersistence({ ...scope, sourceHash: 'c'.repeat(64) }, storage);
  assert.equal(otherSource.load(), null);
  const otherNode = new LearningDraftPersistence({ ...scope, nodeId: 'ain_2' }, storage);
  assert.equal(otherNode.load(), null);
});

test('存储不可用时退回内存并标记不能持久恢复', () => {
  const persistence = new LearningDraftPersistence(scope, null);
  assert.equal(persistence.persistent, false);
  persistence.save({ v1: 2 }, 1);
  assert.equal(persistence.load()?.values.v1, 2);
  persistence.clear();
  assert.equal(persistence.load(), null);
});

test('清理指定身份的草稿不影响其他身份', () => {
  const storage = new MemoryStorage();
  const a = new LearningDraftPersistence(scope, storage);
  const b = new LearningDraftPersistence({ ...scope, viewerKey: 'ses_b' }, storage);
  a.save({ v1: 2 }, 1);
  b.save({ v1: 3 }, 1);
  const removed = clearLearningDrafts('ses_a', storage);
  assert.ok(removed >= 1);
  assert.equal(a.load(), null);
  assert.equal(b.load()?.values.v1, 3);
});
