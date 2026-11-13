import assert from 'node:assert/strict';
import test from 'node:test';

import type { PptAiRuntimeSnapshot } from '../runtime/snapshot.ts';
import { learningPageFromFrozen } from './fromSnapshot.ts';

const descriptor = {
  contract_version: 'ppt-learning.1' as const,
  goal_id: 'eigen_direction' as const,
  title: '特征方向',
  objective: '观察共线',
  source_refs: [],
  template_id: 'matrix.eigen_probe' as const,
  bindings: {},
  fixed_roles: ['matrix'],
  editable_roles: ['vector'],
  controls: [],
  suggested_actions: [],
  review_items: [],
  notes: [],
  node_id: 'ain_1',
  region_id: 'rgn_1',
};

const snapshot: PptAiRuntimeSnapshot = {
  frozen: true,
  bundle: {
    bundle_id: 'bnd_1', bundle_revision: 1, schema_version: 'ppt-ai.1', source_revision: 4,
    source_hash: 'a'.repeat(64), registry_version: 'r1', status: 'active', content_hash: 'h'.repeat(64),
    plans: [], graph: { nodes: [], relations: [], candidates: [], conflicts: [], graph_revision: 1 },
    compiled: {
      nodes: [{
        node_id: 'ain_1', option_id: 'opt_1', region_id: 'rgn_1', operator_id: 'matrix.transform',
        title: '矩阵', parameters: [{ concept_id: 'cpt_a11', id: 'a11', label: 'a11', type: 'number', unit: '', default: 2, min: -5, max: 5, step: 0.1, options: [], source: { page: 6 }, provenance: {} }],
        views: [], provider: { kind: 'matrix', matrix: [[2, 1], [1, 2]] }, checks: [], offline_supported: true,
        source: { page: 6, excerpt: '', bbox: { x: 0, y: 0, w: 1, h: 1 } },
      }],
      order: ['ain_1'], ispecs: [], checks: [], resources: [], view_contract_version: 'v1',
    },
    seed_values: {}, created_at: '',
  },
  branch: { branch_id: 'brn_1', revision: 2, kind: 'baseline', canonical_values: { cpt_a11: 2 } },
  artifacts: [],
  learning: [descriptor],
  capabilities: { can_explore_locally: true, can_ask_online: false },
};

test('冻结讲解投影出只读学习页，不声明联网能力', () => {
  const page = learningPageFromFrozen(snapshot, 6);
  assert.ok(page);
  assert.equal(page?.items.length, 1);
  assert.equal(page?.items[0]?.baseline_values.cpt_a11, 2);
  assert.equal(page?.capabilities.can_ask_online, false);
  assert.equal(page?.capabilities.can_explore_locally, true);
  assert.equal(page?.branch_kind, 'baseline');
  assert.equal(learningPageFromFrozen(snapshot, 7), null);
});
