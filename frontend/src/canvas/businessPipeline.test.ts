import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateAbTest,
  calculateBreakeven,
  calculateCpm,
  calculateFunnel,
} from './businessModels.ts';
import { buildBusinessPipeline, evaluateBusinessStage } from './businessPipeline.ts';
import type { BusinessTemplateKind } from './businessPipelineTypes.ts';
import type { PortValue } from './types.ts';

function approx(actual: number, expected: number, tolerance = 1e-8): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${expected} ± ${tolerance}, received ${actual}`);
}

test('breakeven is the revenue and cost intersection and cumulative profit determines payback', () => {
  const model = calculateBreakeven();
  const q = model.breakEvenSales;
  approx(99 * q, 250_000 + .35 * 99 * q);
  assert.equal(model.months.length, 24);
  approx(model.months[0]!.profit, -89_125);
  for (const [i, month] of model.months.entries()) {
    const prior = model.months[i - 1]?.cumulativeProfit ?? 0;
    approx(month.cumulativeProfit, prior + month.profit);
  }
  assert.equal(model.paybackMonth, model.months.find((month) => month.cumulativeProfit >= 0)?.month);
  assert.equal(calculateBreakeven({ growthRate: -.1 }).paybackMonth, undefined);
  assert.equal(calculateBreakeven({ price: 500, adBudget: 0 }).paybackMonth, 1);
  const exact = calculateBreakeven({ price: 500, varRate: .8, fixedCost: 50_000, adBudget: 0, monthlySales: 500 });
  assert.equal(Math.ceil(exact.breakEvenSales), 500);
  assert.equal(exact.months[0]?.profit, 0);
  assert.equal(exact.paybackMonth, 1);
});

test('funnel conversion multiplies through each layer and retained cohorts build up over time', () => {
  const model = calculateFunnel();
  assert.deepEqual(model.funnel.slice(0, 4), [200_000, 10_000, 2_500, 200]);
  assert.equal(model.funnel[4], 130);
  assert.equal(model.weeks.length, 12);
  approx(model.weeks[2]!.cohort, 200 * .65 ** 2);
  approx(model.weeks[2]!.active, 200 * (1 + .65 + .65 ** 2));
  assert.ok(model.weeks[11]!.improvedActive > model.weeks[11]!.active);
  approx(model.weeks[0]!.revenue, 24_000);
  approx(model.ltv, 120 / (1 - .65));
});

test('CPM identifies critical paths, absorbs slack, and accounts for ties', () => {
  const baseline = calculateCpm();
  assert.equal(baseline.totalDays, 16);
  assert.deepEqual(baseline.paths, [['T1', 'T3', 'T5', 'T6']]);
  assert.deepEqual(baseline.tasks.map(({ slack }) => slack), [0, 1, 0, 3, 0, 0]);
  const tied = calculateCpm({ delayT2: 1, delayT4: 3 });
  assert.equal(tied.totalDays, 16);
  assert.deepEqual(tied.paths.map((path) => path[1]), ['T2', 'T3', 'T4']);
  const delayed = calculateCpm({ delayT2: 3 });
  assert.equal(delayed.totalDays, 18);
  assert.equal(delayed.tasks.find(({ id }) => id === 'T5')?.es, 12);
  assert.equal(baseline.load[3], 3);
  assert.ok(calculateCpm({ devBoost: 1.5 }).totalDays < baseline.totalDays);
});

test('A/B expected p-value falls with samples, while power and fixed 95% CI behave as expected', () => {
  const model = calculateAbTest();
  assert.equal(model.days.length, 30);
  assert.equal(model.days[0]?.samples, 2000);
  approx(model.days[0]!.pValue, .21769, .001);
  assert.ok(model.days[0]!.power < .8);
  assert.ok(model.days[29]!.power > .99);
  assert.deepEqual(calculateAbTest({ alpha: .01 }).days[0]?.confidenceInterval, model.days[0]?.confidenceInterval);
  assert.ok(calculateAbTest({ alpha: .01 }).requiredSamples > model.requiredSamples);
  assert.ok(calculateAbTest({ alpha: .10 }).requiredSamples < model.requiredSamples);
  for (const [i, day] of model.days.entries()) {
    const prior = model.days[i - 1];
    assert.ok(day.pValue >= 0 && day.pValue <= 1 && day.power >= 0 && day.power <= 1);
    if (prior) {
      assert.ok(day.pValue < prior.pValue);
      assert.ok(day.power >= prior.power);
      assert.ok(day.confidenceInterval[0] > prior.confidenceInterval[0]);
      assert.ok(day.confidenceInterval[1] < prior.confidenceInterval[1]);
    }
  }
});

test('invalid parameters normalize and all 4 pipeline documents produce linked frames', () => {
  assert.deepEqual(calculateBreakeven({ price: NaN }), calculateBreakeven());
  assert.deepEqual(calculateFunnel({ retention: Infinity }), calculateFunnel());
  assert.deepEqual(calculateCpm({ devBoost: 0 }), calculateCpm({ devBoost: .5 }));
  assert.deepEqual(calculateAbTest({ alpha: .06 }), calculateAbTest());
  assert.equal(evaluateBusinessStage({
    id: 'invalid', type: 'businessStage', payload: 'constructor/main', params: {}, x: 0, y: 0,
  }, () => null), null);
  const kinds: BusinessTemplateKind[] = ['biz-breakeven', 'biz-funnel', 'biz-cpm', 'biz-abtest'];
  const frameCounts = [24, 12, 17, 30];
  for (const [index, kind] of kinds.entries()) {
    const doc = buildBusinessPipeline(kind, kind, '测试');
    const outputs = new Map<string, PortValue>();
    assert.equal(doc.panel?.view_node_ids.length, 1);
    const inputs = doc.nodes.filter(({ type }) => type === 'businessStage');
    assert.equal(inputs.length, 4);
    for (const node of inputs) {
      const value = evaluateBusinessStage(node, (port) => {
        const wire = doc.wires.find(({ to, toPort }) => to === node.id && toPort === port);
        return wire ? outputs.get(wire.from) ?? null : null;
      });
      assert.ok(value && !value.error, value?.error);
      outputs.set(node.id, value);
      assert.equal(value.result.frames.length, value.stage === 'source' ? 1 : frameCounts[index]);
      assert.ok(value.result.frames.every((frame) => frame.scene.ariaLabel && frame.metrics?.length));
    }
  }
});

