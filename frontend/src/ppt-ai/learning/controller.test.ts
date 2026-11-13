import assert from 'node:assert/strict';
import test from 'node:test';

import { createLearningController } from './controller.ts';

const init = {
  documentRevision: 3,
  sourceHash: 'a'.repeat(64),
  bundleId: 'bnd_1',
  bundleRevision: 2,
  pageNo: 6,
  nodeId: 'ain_1',
  regionId: 'rgn_1',
  branchId: 'brn_1',
  branchRevision: 4,
  baselineValues: { a11: 2, a12: 1, a21: 1, a22: 2, v1: 1, v2: 1 },
};

test('保存后下一次请求使用服务器返回的新 revision', () => {
  const controller = createLearningController(init);
  controller.setValue('v1', 2);
  controller.markSaving();
  controller.acceptSavedBranch({
    branch_id: 'brn_1',
    revision: 5,
    canonical_values: { ...init.baselineValues, v1: 2 },
  });
  const context = controller.buildContext('req_2');
  assert.equal(context.branch_revision, 5);
  assert.equal(context.input_values.v1, 2);
  assert.equal(controller.getSnapshot().status, 'clean');
});

test('保存期间出现新修改时保留草稿，不使用服务器旧值覆盖', () => {
  const controller = createLearningController(init);
  controller.setValue('v1', 2);
  controller.markSaving();
  controller.setValue('v2', 3);
  controller.acceptSavedBranch({
    branch_id: 'brn_1',
    revision: 5,
    canonical_values: { ...init.baselineValues, v1: 2 },
  });
  assert.equal(controller.getSnapshot().branchRevision, 5);
  assert.equal(controller.getSnapshot().values.v2, 3);
  assert.equal(controller.getSnapshot().status, 'dirty');
});

test('旧请求、旧 draft revision 与切页后的慢响应都被拒绝', () => {
  const controller = createLearningController(init);
  const firstTicket = { clientRequestId: 'req_1', draftRevision: 0, nodeId: 'ain_1', pageNo: 6 };
  controller.beginRequest('req_1');
  assert.equal(controller.acceptTaskResult({ client_request_id: 'req_1', draft_revision: 0, page_no: 6, node_id: 'ain_1', input_hash: 'h1' }, firstTicket), true);
  controller.setValue('v1', 2);
  assert.equal(controller.acceptTaskResult({ client_request_id: 'req_1', draft_revision: 0, page_no: 6, node_id: 'ain_1' }, firstTicket), false);
  const secondTicket = { clientRequestId: 'req_2', draftRevision: 1, nodeId: 'ain_1', pageNo: 6 };
  controller.beginRequest('req_2');
  assert.equal(controller.acceptTaskResult({ client_request_id: 'req_1', draft_revision: 1, page_no: 6 }, secondTicket), false);
  assert.equal(controller.acceptTaskResult({ client_request_id: 'req_2', draft_revision: 1, page_no: 7 }, secondTicket), false);
  assert.equal(controller.acceptTaskResult({ client_request_id: 'req_2', draft_revision: 1, page_no: 6, node_id: 'ain_1' }, secondTicket), true);
});

test('恢复课件条件会递增 draft revision 并清空服务器哈希', () => {
  const controller = createLearningController(init);
  controller.setValue('v1', 4);
  const ticket = { clientRequestId: 'req_1', draftRevision: 1, nodeId: 'ain_1', pageNo: 6 };
  controller.beginRequest('req_1');
  controller.acceptTaskResult({ client_request_id: 'req_1', draft_revision: 1, page_no: 6, input_hash: 'server-hash' }, ticket);
  assert.equal(controller.buildContext('req_2').input_hash, 'server-hash');
  controller.resetToBaseline();
  assert.equal(controller.getSnapshot().values.v1, 1);
  assert.equal(controller.getSnapshot().draftRevision, 2);
  assert.equal(controller.buildContext('req_3').input_hash, null);
});

test('加载已保存探索后 revision 与值同步更新', () => {
  const controller = createLearningController(init);
  controller.loadBranch({ branch_id: 'brn_practice', revision: 9, canonical_values: { ...init.baselineValues, v1: 3 } });
  assert.equal(controller.getSnapshot().branchId, 'brn_practice');
  assert.equal(controller.getSnapshot().branchRevision, 9);
  assert.equal(controller.getSnapshot().values.v1, 3);
  assert.equal(controller.getSnapshot().status, 'clean');
});

test('保存为练习时接受更低 revision 的新分支，课件基准保持不变', () => {
  const controller = createLearningController({ ...init, branchRevision: 7 });
  controller.setValue('v1', 3);
  controller.markSaving();
  controller.acceptSavedBranch({
    branch_id: 'brn_practice', revision: 1, kind: 'practice',
    canonical_values: { ...init.baselineValues, v1: 3 },
  });
  assert.equal(controller.getSnapshot().branchId, 'brn_practice');
  assert.equal(controller.getSnapshot().branchRevision, 1);
  assert.equal(controller.getSnapshot().status, 'clean');
  controller.resetToBaseline();
  assert.equal(controller.getSnapshot().values.v1, init.baselineValues.v1);
});

test('只发送当前节点允许的参数，bundle 其他节点的值不混入上下文', () => {
  const controller = createLearningController({ ...init, allowedValueKeys: ['a11', 'a12', 'a21', 'a22', 'v1', 'v2'] });
  controller.loadBranch({
    branch_id: 'brn_practice', revision: 1, kind: 'practice',
    canonical_values: { ...init.baselineValues, other_node_value: 99 },
  }, { keepCourseBaseline: true });
  const context = controller.buildContext('req_x');
  assert.equal('other_node_value' in context.input_values, false);
  assert.equal(context.input_values.v1, init.baselineValues.v1);
});
