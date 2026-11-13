import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { CompiledNode, InteractionBundle } from '../types.ts';
import {
  evaluateBundle,
  evaluateBundleIncremental,
  evaluateNode,
  type CanonicalValues,
} from './evaluate.ts';
import {
  conceptCatalog,
  effectiveConceptValue,
  pagesForNodes,
} from './linking.ts';

const golden = JSON.parse(
  readFileSync(
    new URL('../../../../fixtures/ppt-ai/linking/golden_bundle.json', import.meta.url),
    'utf8',
  ),
) as InteractionBundle;

function initialValues(): CanonicalValues {
  return { ...golden.seed_values };
}

test('黄金 bundle：三页派生值按手算公式传播', () => {
  const first = evaluateBundle(golden, initialValues());
  assert.equal(first.derivedValues['out:ain_page1:det'], 6);
  assert.equal(first.derivedValues['out:ain_page5:det'], 6);
  assert.equal(first.derivedValues['out:ain_page9:det'], 6);

  const values = initialValues();
  values.cpt_p1_a11 = 4;
  const second = evaluateBundle(golden, values);
  assert.equal(second.derivedValues['out:ain_page1:det'], 12);
  assert.equal(second.derivedValues['out:ain_page5:det'], 12);
  assert.equal(second.derivedValues['out:ain_page9:det'], 12);
});

test('增量求值与全量求值结果一致', () => {
  const values = initialValues();
  const previous = evaluateBundle(golden, values);
  values.cpt_p1_a11 = 5;
  const incremental = evaluateBundleIncremental(golden, values, previous, ['cpt_p1_a11']);
  const full = evaluateBundle(golden, values);
  assert.deepEqual(incremental.evaluation.derivedValues, full.derivedValues);
  assert.equal(incremental.evaluation.evaluationHash, full.evaluationHash);
  assert.deepEqual([...incremental.affected].sort(), ['ain_page1', 'ain_page5', 'ain_page9']);
  assert.deepEqual(pagesForNodes(golden, incremental.changed), [1, 5, 9]);
});

test('概念目录按出现位置聚合，派生输出只读', () => {
  const evaluation = evaluateBundle(golden, initialValues());
  const catalog = conceptCatalog(golden, evaluation, initialValues());
  const derived = catalog.find((item) => item.concept_id === 'out:ain_page1:det');
  assert.ok(derived);
  assert.equal(derived.role, 'derived');
  assert.equal(derived.editable, false);
  assert.equal(derived.value, 6);
  const input = catalog.find((item) => item.concept_id === 'cpt_p1_a11');
  assert.ok(input);
  assert.equal(input.role, 'input');
  assert.equal(input.editable, true);
  assert.ok(input.occurrences.some((item) => item.page === 1));
});

test('B2：linked 参数的本地概念只读，展示派生值而不是被忽略的本地值', () => {
  const evaluation = evaluateBundle(golden, initialValues());
  const values = { ...initialValues(), cpt_p5_a11: 42 };
  const catalog = conceptCatalog(golden, evaluation, values);
  const linkedLocal = catalog.find((item) => item.concept_id === 'cpt_p5_a11');
  assert.ok(linkedLocal);
  // 改本地值不生效：面板必须禁编辑（读取走派生值）。
  assert.equal(linkedLocal.editable, false);
  assert.equal(linkedLocal.value, 6);
});

test('B3：effectiveConceptValue 取派生值作为“本页独立”的基准', () => {
  const evaluation = evaluateBundle(golden, initialValues());
  const values = { ...initialValues(), cpt_p5_a11: 42 };
  // linked 参数：当前生效值是派生值 6，而不是 values 里的本地旧值 42。
  assert.equal(
    effectiveConceptValue(golden, evaluation, values, 'ain_page5', 'cpt_p5_a11'),
    6,
  );
  // 自由参数：仍读共享值。
  assert.equal(
    effectiveConceptValue(golden, evaluation, values, 'ain_page1', 'cpt_p1_a11'),
    2,
  );
  assert.equal(
    effectiveConceptValue(golden, evaluation, values, 'ain_page5', 'cpt_p5_a22'),
    1,
  );
});

test('A5：已确认的页面声明在运行时持续对照，偏离时报警', () => {
  const bundle: InteractionBundle = JSON.parse(JSON.stringify(golden));
  bundle.graph.nodes.push({
    concept_id: 'decl_det_page1',
    name: 'det 的页面声明',
    type: 'number',
    unit: '',
    dimension: 'scalar',
    domain: {},
    default: 6,
    source: bundle.compiled.nodes[0]!.source,
    semantic_role: 'declaration',
    provenance: bundle.compiled.nodes[0]!.parameters[0]!.provenance,
  });
  bundle.graph.relations.push({
    relation_id: 'rel_decl_det',
    type: 'derived_from',
    inputs: ['out:ain_page1:det'],
    outputs: ['decl_det_page1'],
    expression: null,
    operator_id: null,
    source: [],
    review_status: 'confirmed',
    note: '页面声明对照',
  });
  const matched = evaluateBundle(bundle, initialValues());
  assert.equal(matched.declarationChecks.length, 1);
  assert.equal(matched.declarationChecks[0]!.status, 'pass');

  const driftedValues = initialValues();
  driftedValues.cpt_p1_a11 = 4;
  const drifted = evaluateBundle(bundle, driftedValues);
  assert.equal(drifted.declarationChecks[0]!.status, 'fail');
  assert.match(drifted.declarationChecks[0]!.detail, /偏离/);

  // 调参后增量求值同样按最终派生值重新比对。
  const incremental = evaluateBundleIncremental(
    bundle, driftedValues, matched, ['cpt_p1_a11'],
  );
  assert.equal(incremental.evaluation.declarationChecks[0]!.status, 'fail');
});

test('A4：模板节点按 OutputSpec 填 outputs，与后端 declared_output_value 同键', () => {
  const node: CompiledNode = {
    node_id: 'ain_taylor_probe',
    option_id: 'opt_probe',
    region_id: 'rgn_probe',
    operator_id: 'calculus.taylor',
    title: '泰勒近似',
    parameters: [],
    outputs: [
      { key: 'approx', concept_id: 'out:probe:approx', name: '近似值', type: 'number', unit: '' },
      { key: 'error', concept_id: 'out:probe:error', name: '误差', type: 'number', unit: '' },
    ],
    views: [],
    provider: { kind: 'taylor', expression: 'sin(x)', taylor_meta: { family: 'sin', base_x0: 0 } },
    checks: [],
    offline_supported: true,
    source: golden.compiled.nodes[0]!.source,
  };
  const evaluation = evaluateNode(node, { expression: 'sin(x)', x0: 0, order: 5, x_eval: 0.5 });
  // 顶层键按 OutputSpec 进 evaluation.outputs：不再依赖指标名兜底。
  assert.ok(Math.abs((evaluation.outputs.approx as number) - 0.4794270833) < 1e-8);
  assert.ok(typeof evaluation.outputs.error === 'number');
});
