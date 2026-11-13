import test from 'node:test';
import assert from 'node:assert/strict';
import { exactCumulative, exactIntegral, riemannBands } from './surfaceMath.ts';
import { normalizeInput, runTransformer, vectorStats } from './transformerMath.ts';
import { DEFAULT_INPUTS, SCENARIOS, evaluateOffice, sensitivity } from './officeMath.ts';

function close(actual: number, expected: number, tolerance = 1e-6): void {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}

test('球面第一类积分：z² 的精确值为 4πR⁴/3，离散累加收敛', () => {
  close(exactIntegral('scalar', 'z2', 'axial', 1, 1), (4 * Math.PI) / 3);
  const bands = riemannBands('scalar', 'z2', 'axial', 1, 2000, 1);
  close(bands[bands.length - 1]?.cumulative ?? 0, (4 * Math.PI) / 3, 1e-4);
  close(exactCumulative('scalar', 'z2', 'axial', 1, 1, 1), (4 * Math.PI) / 3);
});

test('球面第二类积分：轴向场通量 4πR³/3，内法向变号，常场净通量为 0', () => {
  close(exactIntegral('flux', 'one', 'axial', 1, 1), (4 * Math.PI) / 3);
  close(exactIntegral('flux', 'one', 'axial', 1, -1), (-4 * Math.PI) / 3);
  close(exactIntegral('flux', 'one', 'constant', 1, 1), 0);
});

test('Transformer：注意力行归一化、因果遮罩、LayerNorm 与输出分布', () => {
  const trace = runTransformer('我喜欢学习');
  assert.equal(trace.tokens.length, 5);
  for (const head of trace.heads) {
    for (const row of head.weights) close(row.reduce((sum, value) => sum + value, 0), 1);
    head.weights.forEach((row, index) => {
      row.slice(index + 1).forEach((value) => close(value, 0));
    });
  }
  const lastX2 = trace.x2[trace.x2.length - 1] ?? [];
  const stats = vectorStats(lastX2);
  close(stats.mean, 0, 1e-9);
  close(stats.std, 1, 1e-3);
  close(trace.probs.reduce((sum, value) => sum + value, 0), 1, 1e-9);
  assert.equal(normalizeInput('0123456789').chars.length, 8);
});

test('经营沙盘：默认方案与最优定价', () => {
  const result = evaluateOffice(DEFAULT_INPUTS);
  close(result.demand, 10000);
  close(result.sales, 10000);
  close(result.profit, 30000);
  close(result.breakEvenPrice ?? 0, 92.1572, 1e-3);
  assert.equal(result.optimalPrice, 165);
  close(result.optimalProfit, 98999.296, 1e-3);
});

test('经营沙盘：情景利润与敏感性方向', () => {
  const cost = SCENARIOS.find((scenario) => scenario.id === 'cost');
  const expand = SCENARIOS.find((scenario) => scenario.id === 'expand');
  assert.ok(cost && expand);
  close(evaluateOffice(cost.inputs).profit, 170000);
  close(evaluateOffice(expand.inputs).profit, -40704.71, 0.1);

  const rows = sensitivity(DEFAULT_INPUTS);
  const variableCost = rows.find((row) => row.key === 'variableCost');
  const price = rows.find((row) => row.key === 'price');
  assert.ok(variableCost && price);
  assert.ok(variableCost.lowProfit > 30000);
  assert.ok(variableCost.highProfit < 30000);
  assert.ok(price.highProfit > 30000);
});
