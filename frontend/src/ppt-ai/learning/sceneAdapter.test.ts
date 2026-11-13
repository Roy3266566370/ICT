import assert from 'node:assert/strict';
import test from 'node:test';

import type { CompiledNode, PlanParameter } from '../types.ts';
import type { LearningDescriptor, LearningItem } from './types.ts';
import { adaptLearningScene } from './sceneAdapter.ts';

const anchor = {
  material_id: 'mat_1', page: 6, node_id: null, element_id: null,
  bbox: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 }, excerpt: '', source_version: 0,
  semantic_content_hash: 'a'.repeat(64),
};
const provenance = { origin_type: 'native' as const, evidence: 'x', inference: '', user_checks: [], method: 't' };

function param(id: string, value: number): PlanParameter {
  return {
    concept_id: `cpt_${id}`, id, label: id, type: 'number', unit: '', default: value,
    min: -5, max: 5, step: 0.1, options: [], source: anchor, provenance,
  } as PlanParameter;
}

function node(operator_id: string, provider: Record<string, unknown>, parameters: PlanParameter[]): CompiledNode {
  return {
    node_id: 'ain_1', option_id: 'opt_1', region_id: 'rgn_1', operator_id, title: 't',
    parameters, views: [], provider, checks: [], offline_supported: true, source: anchor,
  } as CompiledNode;
}

function descriptor(overrides: Partial<LearningDescriptor>): LearningDescriptor {
  return {
    contract_version: 'ppt-learning.1', goal_id: 'eigen_direction', title: '特征方向',
    objective: '观察共线', source_refs: [], template_id: 'matrix.eigen_probe',
    bindings: {}, fixed_roles: ['matrix'], editable_roles: ['vector'], controls: [],
    suggested_actions: [], review_items: [], notes: [], ...overrides,
  };
}

function item(descriptorValue: LearningDescriptor): LearningItem {
  return {
    item_id: 'ain_1', node_id: 'ain_1', region_id: 'rgn_1', title: descriptorValue.title,
    state: 'ready', support_status: 'supported', descriptor: descriptorValue,
    baseline_values: {}, explanation_ready: true, experiment_ready: true, manual_review_reason: '',
  };
}

test('特征方向：v=(1,1) 与 Av=(3,3) 共线，倍率 3', () => {
  const parameters = [param('a11', 2), param('a12', 1), param('a21', 1), param('a22', 2), param('v1', 1), param('v2', 1)];
  const scene = adaptLearningScene(item(descriptor({})), node('matrix.transform', {
    kind: 'matrix', matrix: [[2, 1], [1, 2]], vector: [1, 1],
  }, parameters), { cpt_a11: 2, cpt_a12: 1, cpt_a21: 1, cpt_a22: 2, cpt_v1: 1, cpt_v2: 1 });
  assert.equal(scene.kind, 'eigen');
  if (scene.kind !== 'eigen') return;
  assert.equal(scene.collinear, true);
  assert.ok(Math.abs((scene.ratio ?? 0) - 3) < 1e-9);
  assert.deepEqual(scene.product, [3, 3]);
});

test('没有 v 参数时使用教学探针，并明确不是原稿向量', () => {
  const parameters = [param('a11', 2), param('a12', 1), param('a21', 1), param('a22', 2)];
  const scene = adaptLearningScene(
    item(descriptor({
      bindings: { 'vector.v1': 'teaching.v1', 'vector.v2': 'teaching.v2' },
      controls: [
        { concept_id: 'teaching.v1', label: '探针 v1', role: 'editable', min: -5, max: 5, step: 0.1, precision: 3, unit: '', reason: '教学探针' },
        { concept_id: 'teaching.v2', label: '探针 v2', role: 'editable', min: -5, max: 5, step: 0.1, precision: 3, unit: '', reason: '教学探针' },
      ],
      notes: ['教学探针由系统创建'],
    })),
    node('matrix.transform', { kind: 'matrix', matrix: [[2, 1], [1, 2]], vector: [1, 1] }, parameters),
    { 'teaching.v1': 1, 'teaching.v2': -1 },
  );
  assert.equal(scene.kind, 'eigen');
  if (scene.kind !== 'eigen') return;
  assert.ok(Math.abs((scene.ratio ?? 0) - 1) < 1e-9);
  assert.deepEqual(scene.vector, [1, -1]);
});

test('换基 -45° 得到 B=[[2.5,-0.5],[-0.5,2.5]] 与迹/行列式不变量', () => {
  const parameters = [param('a11', 2), param('a12', 0), param('a21', 0), param('a22', 3), param('basis_angle_deg', 0)];
  const scene = adaptLearningScene(
    item(descriptor({
      goal_id: 'change_of_basis', template_id: 'matrix.change_of_basis',
      editable_roles: ['basis'], controls: [
        { concept_id: 'cpt_basis_angle_deg', label: '角度', role: 'editable', min: -180, max: 180, step: 15, precision: 1, unit: '°', reason: '' },
      ],
    })),
    node('matrix.change_of_basis', { kind: 'change_of_basis', matrix: [[2, 0], [0, 3]], basis_angle_deg: 0, vector: [1, 2] }, parameters),
    { cpt_a11: 2, cpt_a12: 0, cpt_a21: 0, cpt_a22: 3, cpt_basis_angle_deg: -45 },
  );
  assert.equal(scene.kind, 'change_of_basis');
  if (scene.kind !== 'change_of_basis') return;
  assert.deepEqual(scene.transformed?.flat().map((value) => Math.round(value * 1e8) / 1e8), [2.5, -0.5, -0.5, 2.5]);
  assert.equal(scene.invariants.trace, 5);
  assert.equal(scene.invariants.det, 6);
});

test('未知模板降级为 generic，不伪装成可操作实验', () => {
  const scene = adaptLearningScene(
    item(descriptor({ template_id: 'text.explain', goal_id: 'explain', editable_roles: [] })),
    node('explain.text', { kind: 'explain', text: '原文说明' }, []),
    {},
  );
  assert.equal(scene.kind, 'generic');
});
