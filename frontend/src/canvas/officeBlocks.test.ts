import test from 'node:test';
import assert from 'node:assert/strict';
import {
  businessSampleText,
  businessTableSeries,
  discountSeries,
  growthSeries,
  makeSeries,
  parseBusinessTable,
  scenarioSeries,
  waterfallData,
  weightedDecision,
} from './officeBlocks.ts';

test('业务表格支持 CSV、TSV、百分比与表头，拒绝空数据', () => {
  const csv = parseBusinessTable('月份,营收\n1月,128\n2月,136');
  assert.deepEqual(csv.labels, ['1月', '2月']);
  assert.deepEqual(csv.values, [128, 136]);
  const tsv = parseBusinessTable('项目\t金额\nA\t1.5\nB\t2.5');
  assert.deepEqual(tsv.values, [1.5, 2.5]);
  const percent = parseBusinessTable('月份,增长率\n1月,12.5%\n2月,-3%');
  assert.deepEqual(percent.values, [0.125, -0.03]);
  assert.throws(() => parseBusinessTable(''));
  assert.throws(() => parseBusinessTable('标签,数值\nA,abc'));
  assert.equal(businessTableSeries('', 0).values.length, 12);
  assert.match(businessSampleText(1), /研发/);
});

test('增长曲线按周期与季度波动生成有限序列', () => {
  const series = growthSeries({ initial: 100, monthlyRate: 0.1, months: 12, seasonality: 0 });
  assert.equal(series.values.length, 12);
  assert.ok(Math.abs(series.values[1]! - 110) < 1e-9);
  assert.ok(series.values.every(Number.isFinite));
  const capped = growthSeries({ initial: 100, monthlyRate: 0.1, months: 99, seasonality: 2 });
  assert.equal(capped.values.length, 24);
  assert.ok(capped.values.every(Number.isFinite));
});

test('情景分叉保持基准序列并生成乐观/悲观对比', () => {
  const base = makeSeries('测试', ['一', '二', '三'], [100, 110, 120]);
  const result = scenarioSeries(base, { spread: 0.2, drift: 0 });
  assert.deepEqual(result.values, [100, 110, 120]);
  assert.equal(result.secondary?.length, 2);
  assert.ok(Math.abs((result.secondary![0]!.values[0] ?? 0) - 120) < 1e-9);
  assert.ok(Math.abs((result.secondary![1]!.values[0] ?? 0) - 80) < 1e-9);
});

test('折现算子给出累计 NPV、回本点和零利率基准', () => {
  const base = makeSeries('现金流', Array.from({ length: 12 }, (_, index) => `M${index + 1}`), Array(12).fill(100));
  const zero = discountSeries(base, { annualRate: 0, initialInvestment: 0 });
  assert.ok(Math.abs(zero.npv - 1200) < 1e-9);
  assert.equal(zero.paybackIndex, 0);
  const discounted = discountSeries(base, { annualRate: 0.12, initialInvestment: 500 });
  assert.ok(discounted.npv < zero.npv);
  assert.ok(discounted.npv > 500);
  assert.ok(discounted.paybackIndex !== null);
});

test('加权评分随权重变化切换推荐方案', () => {
  const costFirst = weightedDecision([1, 0, 0, 0]);
  const benefitFirst = weightedDecision([0, 0, 0, 1]);
  assert.equal(costFirst.rows[0]!.name, '低成本方案');
  assert.equal(benefitFirst.rows[0]!.name, '增长方案');
  assert.ok(Math.abs(costFirst.weights.reduce((sum, value) => sum + value, 0) - 1) < 1e-9);
  assert.equal(costFirst.series.values.length, 4);
});

test('瀑布图返回增量、期末总量、峰值与增长率', () => {
  const series = makeSeries('月度', ['一月', '二月', '三月'], [100, 120, 110]);
  const result = waterfallData(series);
  assert.equal(result.bars.length, 3);
  assert.equal(result.bars[1]!.delta, 20);
  assert.equal(result.bars[2]!.delta, -10);
  assert.equal(result.total, 110);
  assert.equal(result.peak, 120);
  assert.ok(Math.abs((result.growth ?? 0) - 0.1) < 1e-9);
});

test('序列长度与数值上限有明确兜底', () => {
  const series = makeSeries('长序列', Array.from({ length: 90 }, (_, index) => `L${index}`), Array(90).fill(Number.POSITIVE_INFINITY));
  assert.equal(series.values.length, 60);
  assert.ok(series.values.every((value) => value === 0));
});
