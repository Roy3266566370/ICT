import test from 'node:test';
import assert from 'node:assert/strict';
import { inferCockpitWeight, planCockpitLayout } from './cockpitLayout.ts';
import type { CockpitView } from './cockpitLayout.ts';
import type { CanvasNode } from './types.ts';
import { defaultAiRulePayload } from './aiRuleBlock.ts';

const view = (id: string, weight: CockpitView['weight'] = 'standard', type?: CanvasNode['type']): CockpitView =>
  ({ id, weight, type });

test('Bento fills every view slot from one card through five', () => {
  const views = ['a', 'b', 'c', 'd', 'e'].map(id => view(id));
  const modes = ['single', 'pair', 'bento-3', 'quad', 'grid'];
  for (let count = 1; count <= 5; count++) {
    const plan = planCockpitLayout(views.slice(0, count));
    assert.equal(plan.mode, modes[count - 1]);
    assert.deepEqual(plan.slots, views.slice(0, count).map(({ id }) => id));
  }
  assert.equal(planCockpitLayout(views.slice(0, 3)).variant, 'columns');
  assert.equal(planCockpitLayout([view('a'), view('b'), view('c', 'compact')]).variant, 'wide-bottom');
  assert.equal(planCockpitLayout([view('a'), view('b'), view('c', 'standard', 'aiRuleBlock')].map(item =>
    item.id === 'c' ? { ...item, chart: true } : item)).variant, 'wide-bottom');
  assert.equal(planCockpitLayout([view('a', 'compact', 'studyTokenView'), ...views.slice(1, 4)]).variant, 'wide-top');
});

test('A single hero leads a stack, and explicit panel layouts take precedence', () => {
  const views = [view('a'), view('hero', 'hero'), view('b', 'compact'), view('c')];
  for (let count = 2; count <= 4; count++) {
    const plan = planCockpitLayout(views.slice(0, count));
    assert.equal(plan.mode, 'hero-stack');
    assert.equal(plan.hero, 'hero');
    assert.deepEqual(plan.stack, views.slice(0, count).filter(item => item.id !== 'hero').map(item => item.id));
  }
  assert.equal(planCockpitLayout(views, 'grid').mode, 'grid');
  assert.equal(planCockpitLayout(views.slice(0, 3), 'bento-3').variant, 'left-hero');
  assert.equal(planCockpitLayout([view('a'), view('b')], 'hero-stack').hero, 'a');
});

test('Heatmap dimensions and detached trainer outputs determine card weight', () => {
  const node: CanvasNode = { id: 'm', type: 'matrixHeatmapView', x: 0, y: 0, params: {} };
  assert.equal(inferCockpitWeight(node, { values: { in: { kind: 'tensor2d', data: [[1, 2, 3]] } } }), 'compact');
  assert.equal(inferCockpitWeight(node, { values: { in: { kind: 'tensor2d', data: [[1], [2], [3]] } } }), 'standard');
  const trainer = { ...node, type: 'mlpTrainer' } as const;
  assert.equal(inferCockpitWeight(trainer, { wiredOutputs: new Set(['boundary', 'loss']) }), 'compact');
  assert.equal(inferCockpitWeight(trainer, { wiredOutputs: new Set(['loss']) }), 'hero');
});

test('AI rule shapes lead the stage while charts and grids remain regular cards', () => {
  for (const [preferredView, weight] of [
    ['shapes', 'hero'], ['canvas', 'hero'], ['chart', 'standard'], ['grid', 'standard'],
  ] as const) {
    const node: CanvasNode = { id: 'rule', type: 'aiRuleBlock', x: 0, y: 0, params: {},
      payload: JSON.stringify({ ...defaultAiRulePayload(), preferredView }) };
    assert.equal(inferCockpitWeight(node, {}, { badge: '实验' }), weight);
  }
});
