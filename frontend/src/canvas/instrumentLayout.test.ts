import assert from 'node:assert/strict';
import test from 'node:test';
import { instrumentViewItem, planInstrumentStage, visibleInstrumentOutputs, type InstrumentViewItem } from './instrumentLayout.ts';
import type { CanvasNode, Wire } from './types.ts';

const item = (type: CanvasNode['type'], badge: InstrumentViewItem['badge'] = '视图'): InstrumentViewItem =>
  instrumentViewItem({ id: type, type, x: 0, y: 0, params: {} }, {}, { badge });
const weights = item('matrixHeatmapView');
const curve = item('studyCurveView');
const spark = item('spark', '学习');
const svm = { ...item('svmLab', '实验'), id: 'svm' };
const cliff = { ...item('qLearningLab', '实验'), id: 'cliff' };

test('SVM, Q-learning and MLP keep a single main view and ordered diagnostics', () => {
  for (const hero of [svm, cliff]) {
    const views = [weights, hero, curve, { ...curve, id: 'second' }];
    assert.deepEqual(planInstrumentStage(views, { activeId: curve.id }), {
      mode: 'hero-with-minis', primaryId: hero.id, miniIds: [weights.id, curve.id, 'second'],
      showTabs: false, allowCompare: false,
    });
  }
  const trainer = instrumentViewItem({ id: 'trainer', type: 'mlpTrainer', x: 0, y: 0, params: {} },
    { wiredOutputs: new Set(['boundary', 'loss']) }, { badge: '实验' });
  const boundary = item('boundaryView');
  assert.equal(trainer.weight, 'compact');
  assert.deepEqual(planInstrumentStage([boundary, trainer, spark]).miniIds, ['trainer', spark.id]);
});

test('Diffusion and Attention keep tabs and use the selected lightweight view as primary', () => {
  const diffusion = [item('studyCloudPlot'), item('studyVectorPlot'), { ...item('studyCloudPlot'), id: 'reverse' }];
  const attention = [weights, { ...weights, id: 'masked' }, { ...weights, id: 'merged' }, curve];
  for (const views of [diffusion, attention]) {
    const plan = planInstrumentStage(views, { activeId: views[1]!.id });
    assert.equal(plan.mode, 'peer-with-minis');
    assert.equal(plan.primaryId, views[1]!.id);
    assert.deepEqual(plan.miniIds, views.filter(view => view.id !== plan.primaryId).map(view => view.id));
    assert.ok(plan.showTabs && plan.allowCompare);
    assert.equal(planInstrumentStage(views, { activeId: 'missing' }).primaryId, views[0]!.id);
  }
});

test('Process, slide, compact and stage-only modes bypass diagnostic cards', () => {
  for (const options of [{ hasProcess: true }, { slideInstrument: true },
    { displayMode: 'compact' }, { displayMode: 'stage_only' }] as const) {
    const plan = planInstrumentStage([svm, weights, curve], { ...options, activeId: curve.id });
    assert.equal(plan.mode, 'tabs-only');
    assert.equal(plan.primaryId, curve.id);
    assert.deepEqual(plan.miniIds, []);
    assert.equal(plan.allowCompare, 'hasProcess' in options);
  }
});

test('Heavy, single and large collections retain tabs-only behavior', () => {
  const rule = item('aiRuleBlock', '实验');
  for (const views of [[], [svm], [rule, { ...rule, id: 'rule2' }, { ...rule, id: 'rule3' }],
    [svm, item('composite', '实验'), curve], [svm, weights, curve, spark, item('studyStatsView')]]) {
    assert.equal(planInstrumentStage(views).mode, 'tabs-only');
    assert.deepEqual(planInstrumentStage(views).miniIds, []);
  }
});

test('Only outputs wired to visible observers are detached', () => {
  const wires: Wire[] = [
    { id: '1', from: svm.id, fromPort: 'field', to: weights.id },
    { id: '2', from: svm.id, fromPort: 'history', to: curve.id },
    { id: '3', from: svm.id, fromPort: 'data', to: cliff.id },
    { id: '4', from: cliff.id, to: weights.id },
  ];
  assert.deepEqual([...visibleInstrumentOutputs(svm.id, wires, [weights.id])], ['field']);
  assert.deepEqual([...visibleInstrumentOutputs(svm.id, wires, [])], []);
});
