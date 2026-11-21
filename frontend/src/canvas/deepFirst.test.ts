import test from 'node:test';
import assert from 'node:assert/strict';
import { dfActivation, dfGradientChain, dfTerrain, dfOptimStart, dfOptimStep, dfOptimRun, dfSoftmax, dfAttention, dfAttentionStats, dfSampleDistribution, dfCacheCounts, dfCacheSequence, dfParams, deepFirstDefaults, deepFirstOutput } from './deepFirst.ts';
import type { CanvasNode } from './types.ts';
const close = (actual: number, expected: number, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('five activation derivatives agree with central differences away from kinks', () => {
  for (let kind = 0; kind < 5; kind++) for (const x of [-5, -1, -0.1, 0.1, 1, 5]) {
    const h = 1e-5;
    close(dfActivation(kind, x).derivative, (dfActivation(kind, x + h).value - dfActivation(kind, x - h).value) / (2 * h));
  }
  assert.equal(dfActivation(0, 0).derivative, 0);
  assert.equal(dfActivation(1, -1).derivative, 0.01);
});
test('fixed derivative powers differ from forward chain; forward chain matches finite difference', () => {
  const fixed = dfGradientChain(2, 1, false), forward = dfGradientChain(2, 1, true);
  close(fixed[9]!.gradient, dfActivation(2, 1).derivative ** 10, 1e-16);
  assert.notEqual(fixed[9]!.gradient, forward[9]!.gradient);
  for (const kind of [0, 1, 2, 3, 4]) {
    const h = 1e-4, x = 0.8;
    const numerical = (dfGradientChain(kind, x + h, true)[9]!.value - dfGradientChain(kind, x - h, true)[9]!.value) / (2 * h);
    close(dfGradientChain(kind, x, true)[9]!.gradient, numerical, 1e-6);
  }
});
test('all terrain analytic gradients match finite differences', () => {
  for (const terrain of [0, 1, 2]) {
    const x = 1.3, y = -0.7, h = 1e-5, g = dfTerrain(terrain, x, y).grad;
    close(g[0], (dfTerrain(terrain, x + h, y).loss - dfTerrain(terrain, x - h, y).loss) / (2 * h));
    close(g[1], (dfTerrain(terrain, x, y + h).loss - dfTerrain(terrain, x, y - h).loss) / (2 * h));
  }
});
test('optimizer known first and second steps, Adam correction, shared start', () => {
  const s = dfOptimStart(1, 2);
  close(dfOptimStep(s, 'SGD', 0, 0.1).x, 0.9);
  const momentum = dfOptimStep(s, 'Momentum', 0, 0.1);
  close(momentum.x, 0.9);
  close(dfOptimStep(momentum, 'Momentum', 0, 0.1).x, 0.72);
  close(dfOptimStep(s, 'RMSProp', 0, 0.1).x, 1 - 0.1 / (Math.sqrt(0.1) + 1e-8));
  const adam = dfOptimStep(s, 'Adam', 0, 0.1);
  close(adam.x, 0.9); close(adam.y, 1.9);
  const m2 = 0.9 * 0.1 + 0.1 * adam.x, v2 = 0.999 * 0.001 + 0.001 * adam.x ** 2;
  close(dfOptimStep(adam, 'Adam', 0, 0.1).x, adam.x - 0.1 * (m2 / (1 - 0.9 ** 2)) / (Math.sqrt(v2 / (1 - 0.999 ** 2)) + 1e-8));
  const runs = dfOptimRun({ x: 1, y: 2, lr: 0.1, terrain: 0, steps: 2 });
  runs.forEach(r => assert.deepEqual(r.path[0], s));
});
test('divergent runs stop with finite last point', () => {
  const runs = dfOptimRun({ x: 2, y: 2, lr: 1, terrain: 2, steps: 200 });
  assert.equal(runs[0]!.state.stopped, true);
  assert.ok(runs[0]!.state.step < 200);
  runs.forEach(r => assert.ok(Number.isFinite(r.loss)));
});
test('stable softmax extremes, normalization and Jacobian finite difference', () => {
  assert.deepEqual(dfSoftmax([10000, 10000]), [0.5, 0.5]);
  assert.deepEqual(dfSoftmax([Infinity, 0, Infinity]), [0.5, 0, 0.5]);
  assert.deepEqual(dfSoftmax([-Infinity, -Infinity]), [0.5, 0.5]);
  const logits = [3, -1, 0.5], p = dfSoftmax(logits), stats = dfAttentionStats(p);
  close(p.reduce((a, b) => a + b, 0), 1);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const h = 1e-5, plus = [...logits], minus = [...logits]; plus[j]! += h; minus[j]! -= h;
    close(stats.jacobian[i]![j]!, (dfSoftmax(plus)[i]! - dfSoftmax(minus)[i]!) / (2 * h));
  }
  assert.ok(stats.entropy > 0 && stats.norm > 0);
});
test('attention reproducible nested dimensions and identical QK for A/B', () => {
  const a = dfAttention(64), b = dfAttention(2);
  assert.deepEqual(a, dfAttention(64));
  assert.deepEqual(a.q.map(row => row.slice(0, 2)), b.q);
  assert.deepEqual(a.k.map(row => row.slice(0, 2)), b.k);
  a.scores.forEach((row, i) => {
    assert.deepEqual(a.unscaled[i], dfSoftmax(row));
    assert.deepEqual(a.scaled[i], dfSoftmax(row.map(x => x / 8)));
    close(a.scaled[i]!.reduce((s, x) => s + x, 0), 1);
  });
});
test('top-p keeps minimal prefix after top-k renormalization', () => {
  const logits = [0.4, 0.3, 0.2, 0.1].map(Math.log);
  const dist = dfSampleDistribution(logits, 1, 4, 0.65);
  assert.deepEqual(dist.kept, [0, 1]); close(dist.probabilities[0]!, 4 / 7);
  assert.equal(dist.probabilities[2], 0);
  assert.deepEqual(dfSampleDistribution(logits, 1, 2, 0.55).kept, [0]);
  assert.equal(dfSampleDistribution(logits, 1, 4, 1).kept.length, 4);
  for (const temperature of [0.05, 1, 3]) close(dfSampleDistribution(logits, temperature, 3, 0.8).probabilities.reduce((s, x) => s + x, 0), 1);
});
test('cache MAC count distinguishes projection savings from unchanged attention', () => {
  const c = dfCacheCounts(3, 2);
  assert.deepEqual(c, { n: 3, kvWithout: 48, kvWith: 24, attentionWithout: 24, attentionWith: 24, totalWithout: 72, totalWith: 48 });
  const first = dfCacheCounts(1); assert.equal(first.totalWithout, first.totalWith);
});
test('toy token sampling is reproducible and extends the same prefix', () => {
  const sequence = dfCacheSequence(8, 1, 5, 0.8);
  assert.deepEqual(sequence, dfCacheSequence(8, 1, 5, 0.8));
  assert.deepEqual(sequence.slice(0, 3), dfCacheSequence(3, 1, 5, 0.8));
  assert.equal(sequence.length, 8);
});
test('defaults, finite boundaries and pure port evaluation', () => {
  for (const type of ['activationProbe', 'optimizerArena', 'attentionAB', 'kvCache'] as const) {
    const node: CanvasNode = { id: type, type, x: 0, y: 0, params: deepFirstDefaults(type)! };
    const out = deepFirstOutput(node, () => null, 'out');
    assert.ok(out?.kind === 'scalar' && Number.isFinite(out.v));
    assert.equal(deepFirstOutput(node, () => null, 'unknown'), null);
  }
  const node: CanvasNode = { id: 'a', type: 'attentionAB', x: 0, y: 0, params: { dk: Infinity, query: NaN } };
  assert.equal(dfParams(node).dk, 16);
  const out = deepFirstOutput(node, () => ({ kind: 'scalar', v: 999 }), 'weights');
  assert.deepEqual(out, { kind: 'tensor2d', data: dfAttention(64).scaled });
  assert.equal(deepFirstDefaults('slider'), null);
});
