import test from 'node:test';
import assert from 'node:assert/strict';
import { svmObjective, trainSVM, toyPoints, normalize, residualNetwork, sequenceModel, rope, multihead, linearAutoencoder, infoNCE, mixtureScore, diffusionMixture, diffusionForward, reverseDiffusionStep, qUpdate, cliffTransition, trainCliff, reinforceGradient, softmax, advancedSnapshot, deepAdvancedOutput, safeTensor } from './deepAdvanced.ts';
import type { CanvasNode, NodeType, PortValue } from './types.ts';
const near = (a: number, b: number, tol = 1e-5) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const derivative = (f: (x: number) => number, x: number) => (f(x + 1e-5) - f(x - 1e-5)) / 2e-5;

test('SVM primal gradients match finite differences away from hinge kink, C and quadratic features matter', () => {
  const pts = toyPoints(), w = [0.12, -0.17], b = 0.23, C = 2; const g = svmObjective(pts, w, b, C);
  w.forEach((v, i) => near(g.dw[i], derivative(t => svmObjective(pts, w.map((x, j) => i === j ? t : x), b, C).loss, v)));
  near(g.db, derivative(t => svmObjective(pts, w, t, C).loss, b));
  const trained = trainSVM(pts, C, false, 300); assert.ok(trained.loss < svmObjective(pts, [0, 0], 0, C).loss); assert.ok(trained.support.some(Boolean));
  assert.notDeepEqual(trainSVM(pts, 0.1).w, trained.w);
  const rings = toyPoints(7, true); assert.ok(trainSVM(rings, 8, true, 600).accuracy > 0.9);
  assert.deepEqual(trainSVM([...pts, { x: 10, y: 10, label: 0, split: 'validation' }]).w, trainSVM(pts).w);
});

test('BN/LN normalize correct axes and have exact backward Jacobian-vector products', () => {
  const x = [[0.2, -0.4, 0.7], [1.1, 0.3, -0.2]], g = [[0.4, -0.3, 0.2], [-0.2, 0.7, 0.1]];
  for (const mode of ['BN', 'LN'] as const) { const n = normalize(x, mode), dx = n.backward(g);
    x.forEach((row, i) => row.forEach((v, j) => near(dx[i][j], derivative(t => { const xx = x.map(r => [...r]); xx[i][j] = t; return normalize(xx, mode).y.flat().reduce((s, v, k) => s + v * g.flat()[k], 0); }, v), 2e-4)));
    if (mode === 'BN') for (let j = 0; j < 3; j++) near(n.y[0][j] + n.y[1][j], 0);
    else n.y.forEach(row => near(row.reduce((a, b) => a + b, 0), 0));
  }
});

test('Both residual routes propagate the actual MSE gradient through every layer', () => {
  const x = [[0.2, -0.3, 0.7], [0.6, 0.9, -0.2]];
  for (const residual of [false, true]) for (const mode of ['none', 'BN', 'LN'] as const) {
    const m = residualNetwork(x, 3, residual, mode);
    x.forEach((row, i) => row.forEach((v, j) => near(m.inputGradient[i][j], derivative(t => { const xx = x.map(r => [...r]); xx[i][j] = t; return residualNetwork(xx, 3, residual, mode).loss; }, v), 3e-4)));
    assert.equal(m.variances.length, 4); assert.equal(m.gradients.length, 4);
  }
});

test('RNN/LSTM sensitivities include gate and cell derivatives; attention sums to one', () => {
  const x = [0.8, -0.2, 0.1, 0, 0, 0, 0, 0], m = sequenceModel(x);
  for (let t = 0; t < 8; t++) { near(m.rnnSensitivity[t], derivative(v => sequenceModel([v, ...x.slice(1)]).rnn[t], x[0])); near(m.lstmSensitivity[t], derivative(v => sequenceModel([v, ...x.slice(1)]).lstm[t], x[0])); }
  near(m.attention.reduce((a, b) => a + b, 0), 1); near(m.context, m.attention.reduce((s, a, i) => s + a * x[i], 0)); assert.ok(sequenceModel(x, 0.7, 4).cells.at(-1)! > sequenceModel(x, 0.7, -4).cells.at(-1)!);
});

test('RoPE relative inner product invariant under common shifts; heads are row stochastic', () => {
  const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0), a = [0.2, 0.7, -0.3, 1], b = [-1, 0.3, 0.6, 0.2];
  near(dot(rope(a, 3), rope(b, 7)), dot(rope(a, 13), rope(b, 17))); near(dot(rope(a, 9), rope(a, 9)), dot(a, a));
  const m = multihead(), shifted = multihead(undefined, true, 7); m.relative.flat().forEach((v, i) => near(v, shifted.relative.flat()[i]));
  m.heads.forEach(h => h.weights.forEach(row => near(row.reduce((a, b) => a + b, 0), 1)));
  assert.notDeepEqual(multihead(undefined, false, 0).relative, multihead(undefined, false, 7).relative);
});

test('Linear AE is an orthogonal projector and reconstructs its basis exactly', () => {
  const m = linearAutoencoder([[1, 2, 3, 4], [0.1, -0.2, 0.6, 0.3]], 0.4);
  const basis = linearAutoencoder(m.basis, 0.4); near(basis.loss, 0); near(linearAutoencoder(m.reconstruction, 0.4).loss, 0);
  near(m.basis[0].reduce((s, v, i) => s + v * m.basis[1][i], 0), 0);
  const x = [[1, 2]]; near(linearAutoencoder(x, 0.8).loss, 0);
});

test('InfoNCE anchor and candidate forces match loss finite differences', () => {
  const a = [0.3, -0.2], c = [[0.5, 0.7], [-0.6, 0.3], [0.2, -0.5]], m = infoNCE(a, c, 0.4);
  a.forEach((v, j) => near(m.gradient[j], derivative(t => infoNCE(a.map((x, k) => j === k ? t : x), c, 0.4).loss, v)));
  c.forEach((row, i) => row.forEach((v, j) => near(m.candidateGradients[i][j], derivative(t => { const cc = c.map(r => [...r]); cc[i][j] = t; return infoNCE(a, cc, 0.4).loss; }, v))));
  const next = a.map((v, i) => v - 0.01 * m.gradient[i]); assert.ok(infoNCE(next, c, 0.4).loss < m.loss);
});

test('Analytic mixture score equals log-density gradient for bimodal and empirical Swiss mixture', () => {
  for (const swiss of [false, true]) for (const t of [0, 0.5, 4]) { const mix = diffusionMixture(swiss), x = [0.3, -0.7], m = mixtureScore(x, t, mix); x.forEach((v, j) => near(m.score[j], derivative(z => mixtureScore(x.map((a, i) => i === j ? z : a), t, mix).logDensity, v))); }
  const a = diffusionForward(0.5, 7); assert.deepEqual(a, diffusionForward(0.5, 7)); assert.notDeepEqual(a, diffusionForward(0.5, 8)); assert.deepEqual(reverseDiffusionStep([1, 2], 0, 0.02), [1, 2]);
  const x = [0.3, -0.7], s = mixtureScore(x, 0.5, diffusionMixture()).score, y = reverseDiffusionStep(x, 0.5, 0.02); near(y[0], x[0] + 0.03 * (x[0] + s[0]));
});

test('Bellman update, cliff reset and terminal reward are correct; seeded training reproducible', () => {
  near(qUpdate(2, -1, 4, 0.5, 0.9, false), 2.3); near(qUpdate(2, 20, 999, 0.5, 0.9, true), 11);
  assert.deepEqual(cliffTransition(30, 1), { next: 30, reward: -100, done: false }); assert.deepEqual(cliffTransition(29, 2), { next: 35, reward: 20, done: true });
  assert.deepEqual(trainCliff(20), trainCliff(20)); const m = trainCliff(200); assert.ok(m.steps.every(n => n <= 200)); assert.ok(m.returns.slice(-20).some(v => v > 0));
});

test('REINFORCE score function gradient finite differences and true return recording', () => {
  const logits = [0.1, -0.2, 0.5, 0.3], action = 2, G = -3, p = softmax(logits), g = reinforceGradient(p, action, G);
  logits.forEach((v, j) => near(g[j], derivative(t => G * Math.log(softmax(logits.map((x, k) => j === k ? t : x))[action]), v)));
  const m = trainCliff(8, 7, 0.15, 0.95, 0.2, true); assert.deepEqual(m, trainCliff(8, 7, 0.15, 0.95, 0.8, true)); assert.ok(m.table.flat().some(v => v !== 0));
  m.policy.forEach(row => near(row.reduce((a, b) => a + b, 0), 1)); assert.equal(m.returns.length, 8);
});

test('All seven nodes export finite bounded interoperable outputs and reject unknown ports', () => {
  const types: NodeType[] = ['svmLab', 'resnetLab', 'sequenceMemory', 'multiheadLab', 'autoencoderLab', 'diffusionLab', 'qLearningLab'];
  for (const type of types) {
    const node: CanvasNode = { id: 'test', type, x: 0, y: 0, params: { control: NaN, depth: Infinity, seed: NaN } };
    for (const value of [null, { kind: 'tensor2d', data: [[NaN, Infinity], [1, -Infinity]] }, { kind: 'dataset2d', points: [] }] as (PortValue | null)[]) {
      const snapshot = advancedSnapshot(node, port => port === 'in' ? value : null)!;
      assert.ok(snapshot); for (const out of Object.values(snapshot.outputs)) { if (out.kind === 'scalar') assert.ok(Number.isFinite(out.v)); if (out.kind === 'tensor2d') { assert.ok(out.data.length <= 16); assert.ok(out.data.every(row => row.length <= 16 && row.every(Number.isFinite))); } if (out.kind === 'dataset2d') { assert.ok(out.points.length <= 120); assert.ok(out.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))); } }
    }
    assert.equal(deepAdvancedOutput(node, () => null, 'unknown'), null);
  }
  assert.deepEqual(safeTensor([[NaN, Infinity, -Infinity]]), [[0, 0, 0]]);
});
