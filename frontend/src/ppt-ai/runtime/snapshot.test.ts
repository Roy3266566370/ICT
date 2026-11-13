import assert from 'node:assert/strict';
import test from 'node:test';

import { fromFrozen, nodesForPage, valuesForNode } from './snapshot.ts';

const bundle = {
  bundle_id: 'bnd_1', bundle_revision: 1, schema_version: 'ppt-ai.1',
  source_revision: 0, source_hash: 'a'.repeat(64), registry_version: 'r1', status: 'active',
  content_hash: 'h'.repeat(64), plans: [],
  graph: { nodes: [], relations: [], candidates: [], conflicts: [], graph_revision: 1 },
  compiled: {
    nodes: [
      {
        node_id: 'ain_1', option_id: 'opt_1', region_id: 'rgn_1', operator_id: 'lab.calculus.integral',
        title: '积分', parameters: [{ concept_id: 'cpt_x', id: 'upper', label: '上限', default: 1 }],
        views: [], provider: {}, checks: [], offline_supported: true,
        source: { page: 2, excerpt: '', bbox: { x: 0, y: 0, w: 1, h: 1 } },
      },
    ],
    order: [], ispecs: [], checks: [], resources: [], view_contract_version: 'v1',
  },
  seed_values: { cpt_x: 1 }, created_at: '',
};

test('冻结快照恢复 bundle/branch/artifacts', () => {
  const runtime = fromFrozen({
    bundle,
    branch: { branch_id: 'brn_1', revision: 3, canonical_values: { cpt_x: 2 }, evaluation: { evaluation_hash: 'e' } },
    artifacts: [{ artifact_id: 'art_1', acceptance_status: 'accepted' }],
  });
  assert.equal(runtime.bundle?.bundle_id, 'bnd_1');
  assert.equal(runtime.branch?.revision, 3);
  assert.equal(runtime.frozen, true);
  assert.equal(runtime.artifacts.length, 1);
});

test('按页筛选节点并使用分支值', () => {
  const runtime = fromFrozen({ bundle, branch: { branch_id: 'b', revision: 1, canonical_values: { cpt_x: 2 } } });
  assert.equal(nodesForPage(runtime.bundle, 2).length, 1);
  assert.equal(nodesForPage(runtime.bundle, 1).length, 0);
  const values = valuesForNode(runtime.bundle, runtime.branch, 'ain_1');
  assert.equal(values.cpt_x, 2);
});

test('缺字段的旧快照安全降级', () => {
  const runtime = fromFrozen({});
  assert.equal(runtime.bundle, null);
  assert.equal(runtime.branch, null);
  assert.deepEqual(runtime.artifacts, []);
});

test('冻结快照传递学习描述、能力与分支用途', () => {
  const runtime = fromFrozen({
    bundle,
    branch: { branch_id: 'brn_1', revision: 3, kind: 'baseline', title: '课件基准', canonical_values: { cpt_x: 2 }, evaluation: { evaluation_hash: 'e' } },
    artifacts: [],
    learning: [{ template_id: 'generic.registered', node_id: 'ain_1' }],
    capabilities: { can_explore_locally: true, can_ask_online: false },
  });
  assert.equal(runtime.learning?.length, 1);
  assert.equal(runtime.capabilities?.can_ask_online, false);
  assert.equal(runtime.branch?.kind, 'baseline');
});
