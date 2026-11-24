import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAbTest, calculateBreakeven, calculateCpm, calculateFunnel } from './businessModels.ts';

test('breakeven uses exact prices and costs outside the slider range', () => {
  const model = calculateBreakeven({ price: 13.75, varRate: .1234, fixedCost: 1250.25, monthlySales: 124, adBudget: 5.55 });
  assert.equal(model.price, 13.75);
  assert.equal(model.varRate, .1234);
  assert.equal(model.fixed, 1255.8);
  assert.equal(model.months[0]?.revenue, 1705);

  const noCost = calculateBreakeven({ fixedCost: 0, adBudget: 0, varRate: 0, monthlySales: 0 });
  assert.equal(noCost.breakEvenSales, 0);
  assert.equal(noCost.months[0]?.profit, 0);
  assert.equal(noCost.months[0]?.roi, null);
});

test('funnel accepts exact ratios, low traffic and zero conversion', () => {
  const model = calculateFunnel({ impressions: 123, ctr: .1234, regRate: 1, payRate: 0, arpu: .8, retention: .98 });
  assert.equal(model.funnel[0], 123);
  assert.equal(model.funnel[1], 123 * .1234);
  assert.equal(model.funnel[3], 0);
  assert.equal(model.weeks[11]?.revenue, 0);
  assert.ok(Number.isFinite(model.ltv));
  assert.ok(calculateFunnel({ impressions: 0 }).funnel.every((count) => count === 0));
});

test('CPM accepts extended whole-day delays', () => {
  const model = calculateCpm({ delayT2: 20, devBoost: 1.125 });
  assert.equal(model.parameters.delayT2, 20);
  assert.equal(model.parameters.devBoost, 1.125);
  assert.equal(model.totalDays, 35);
});

test('A/B accepts precise rates and traffic above the slider range', () => {
  const model = calculateAbTest({ baseRate: .5678, lift: .1432, dailyTraffic: 50_001 });
  assert.equal(model.baseRate, .5678);
  assert.equal(model.experimentalRate, .5678 * (1 + .1432));
  assert.equal(model.days[0]?.samples, 25_000.5);
  const edge = calculateAbTest({ baseRate: .7, lift: .42, dailyTraffic: 1 });
  assert.ok(edge.experimentalRate < 1);
  assert.ok(Number.isFinite(edge.requiredSamples));
  assert.equal(edge.days[0]?.adequateCounts, false);
});
