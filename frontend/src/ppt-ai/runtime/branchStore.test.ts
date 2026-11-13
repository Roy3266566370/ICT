import assert from 'node:assert/strict';
import test from 'node:test';

import { BranchStore } from './branchStore.ts';

test('本地修改标记 dirty，保存后回到 clean', () => {
  const store = new BranchStore({ branchId: 'brn_1', revision: 1, values: { a: 1 } });
  store.setValue('a', 2);
  assert.equal(store.getSnapshot().status, 'dirty');
  assert.equal(store.getSnapshot().values.a, 2);
  store.markSaving();
  store.markSaved(2);
  assert.equal(store.getSnapshot().status, 'clean');
  assert.equal(store.getSnapshot().revision, 2);
});

test('服务端新 revision 覆盖干净状态，但保留脏草稿并报告冲突', () => {
  const store = new BranchStore({ branchId: 'brn_1', revision: 1, values: { a: 1 } });
  assert.equal(store.replaceFromServer({ branchId: 'brn_1', revision: 2, values: { a: 3 } }), true);
  assert.equal(store.getSnapshot().values.a, 3);
  assert.equal(store.getSnapshot().revision, 2);

  store.setValue('a', 9);
  assert.equal(store.replaceFromServer({ branchId: 'brn_1', revision: 3, values: { a: 4 } }), false);
  assert.equal(store.getSnapshot().status, 'conflict');
  assert.equal(store.getSnapshot().values.a, 9);
});

test('旧 revision 不会被反向覆盖', () => {
  const store = new BranchStore({ branchId: 'brn_1', revision: 5, values: { a: 1 } });
  assert.equal(store.replaceFromServer({ branchId: 'brn_1', revision: 4, values: { a: 9 } }), false);
  assert.equal(store.getSnapshot().revision, 5);
  assert.equal(store.getSnapshot().values.a, 1);
});
