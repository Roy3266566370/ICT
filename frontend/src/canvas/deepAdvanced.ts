import type { CanvasNode, DatasetPoint, PortValue } from './types.ts';

export type Matrix = number[][];
// Internal matrices are rectangular after safeTensor; indices below follow their construction bounds.
export const bounded = (x: number | undefined, fallback = 0, lo = -20, hi = 20) => Math.max(lo, Math.min(hi, Number.isFinite(x) ? x! : fallback));
const size = (x: number, lo: number, hi: number) => Math.round(bounded(x, lo, lo, hi));
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0);
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / Math.max(1, x.length);
const variance = (x: number[]) => mean(x.map(v => (v - mean(x)) ** 2));
const norm = (x: number[]) => Math.sqrt(dot(x, x));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-bounded(x, 0, -60, 60)));
export function softmax(x: number[]): number[] { const m = Math.max(...x); const e = x.map(v => Math.exp(v - m)); const s = e.reduce((a, b) => a + b, 0); return e.map(v => v / s); }
export function seeded(seed = 7): () => number { let s = bounded(seed, 7, 0, 2147483647) >>> 0; return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return (s + 0.5) / 4294967296; }; }
const gaussian = (r: () => number) => Math.sqrt(-2 * Math.log(r())) * Math.cos(2 * Math.PI * r());
export function safeTensor(data: Matrix, rows = 16, cols = 8): Matrix {
  const n = Math.min(cols, Math.max(1, data[0]?.length ?? 1));
  return data.slice(0, rows).map(row => Array.from({ length: n }, (_, j) => bounded(row[j])));
}
export function toyPoints(seed = 7, rings = false): DatasetPoint[] {
  const r = seeded(seed);
  return Array.from({ length: 80 }, (_, i) => { const label = i % 2; const a = r() * Math.PI * 2; const radius = (label ? 1.5 : 0.5) + 0.08 * gaussian(r); return { x: rings ? radius * Math.cos(a) : (label ? 0.9 : -0.9) + 0.5 * gaussian(r), y: rings ? radius * Math.sin(a) : 0.6 * gaussian(r), label, split: i % 5 === 0 ? 'validation' : 'train' }; });
}
export function safePoints(points: DatasetPoint[]): DatasetPoint[] { return points.slice(0, 120).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.label)).map(p => ({ x: bounded(p.x), y: bounded(p.y), label: p.label > 0 ? 1 : 0, split: p.split === 'validation' ? 'validation' : 'train' })); }

// Explicit primal feature map; quadratic mode corresponds only to this fixed feature kernel.
export function svmFeatures(x: number, y: number, quadratic = false): number[] { return quadratic ? [x, y, x * x, Math.SQRT2 * x * y, y * y] : [x, y]; }
export function svmObjective(points: DatasetPoint[], w: number[], b: number, C: number, quadratic = false) {
  const train = points.filter(p => p.split === 'train'); const n = Math.max(1, train.length); const dw = [...w]; let db = 0, loss = dot(w, w) / 2;
  for (const p of train) { const f = svmFeatures(p.x, p.y, quadratic), y = p.label > 0 ? 1 : -1; const margin = y * (dot(w, f) + b); loss += C * Math.max(0, 1 - margin) / n; if (margin < 1) { f.forEach((v, i) => { dw[i] = dw[i]! - C * y * v / n; }); db -= C * y / n; } }
  return { loss, dw, db };
}
export function trainSVM(points: DatasetPoint[], C = 2, quadratic = false, steps = 100) {
  points = safePoints(points); C = bounded(C, 2, 0.01, 20); let w = Array(quadratic ? 5 : 2).fill(0) as number[], b = 0; const history: number[] = [];
  // Scale step by feature energy, so external datasets remain stable.
  const energy = Math.max(1, ...points.filter(p => p.split === 'train').map(p => dot(svmFeatures(p.x, p.y, quadratic), svmFeatures(p.x, p.y, quadratic))));
  for (let k = 0; k < size(steps, 0, 800); k++) { const g = svmObjective(points, w, b, C, quadratic); const lr = 0.4 / (Math.sqrt(1 + k / 20) * Math.max(1, Math.sqrt(energy))); w = w.map((v, i) => v - lr * g.dw[i]!); b -= lr * g.db; if (k % 10 === 0) history.push(g.loss); }
  const scores = points.map(p => dot(w, svmFeatures(p.x, p.y, quadratic)) + b);
  return { w, b, scores, history, loss: svmObjective(points, w, b, C, quadratic).loss, support: points.map((p, i) => p.split === 'train' && (p.label ? 1 : -1) * scores[i]! <= 1.05), accuracy: mean(points.filter(p => p.split === 'validation').map(p => Number((dot(w, svmFeatures(p.x, p.y, quadratic)) + b > 0) === (p.label > 0)))) };
}

export type NormMode = 'none' | 'BN' | 'LN';
/** BN reduces batch rows per feature; LN reduces features within each row. gamma=1,beta=0. */
export function normalize(x: Matrix, mode: NormMode) {
  const y = x.map(r => [...r]), groups: [number, number][][] = [];
  if (mode === 'BN') for (let j = 0; j < (x[0]?.length ?? 0); j++) groups.push(x.map((_, i) => [i, j]));
  if (mode === 'LN') for (let i = 0; i < x.length; i++) groups.push(x[i]!.map((_, j) => [i, j]));
  const inv = groups.map(g => { const v = g.map(([i, j]) => x[i]![j]!), m = mean(v), s = 1 / Math.sqrt(variance(v) + 1e-5); g.forEach(([i, j]) => { y[i]![j] = (x[i]![j]! - m) * s; }); return s; });
  return { y, backward: (dy: Matrix): Matrix => { const dx = dy.map(r => [...r]); groups.forEach((g, k) => { const mg = mean(g.map(([i, j]) => dy[i]![j]!)), mgy = mean(g.map(([i, j]) => dy[i]![j]! * y[i]![j]!)); g.forEach(([i, j]) => { dx[i]![j] = inv[k]! * (dy[i]![j]! - mg - y[i]![j]! * mgy); }); }); return dx; } };
}
export function residualNetwork(input: Matrix, depth = 6, residual = true, mode: NormMode = 'LN', gain = 0.65) {
  const x = safeTensor(input, 8, 8); if (!x.length) x.push([1, 0]); const width = x[0]!.length; depth = size(depth, 1, 12); gain = bounded(gain, 0.65, 0.05, 2);
  const W = Array.from({ length: width }, (_, i) => Array.from({ length: width }, (_, j) => gain * (i === j ? 0.8 : Math.sin((i + 1) * (j + 2)) * 0.2 / Math.sqrt(width))));
  const layers = [x]; const cache: { a: Matrix; bn: ReturnType<typeof normalize> }[] = [];
  for (let l = 0; l < depth; l++) { const prev = layers[l]!; const z = prev.map(row => W.map(w => dot(w, row))); const bn = normalize(z, mode); const a = bn.y.map(row => row.map(Math.tanh)); cache.push({ a, bn }); layers.push(a.map((row, i) => row.map((v, j) => v + (residual ? prev[i]![j]! : 0)))); }
  // Loss is mean squared distance to a deterministic nonconstant target (not fictitious gradients).
  const out = layers[depth]!; const target = out.map((row, i) => row.map((_, j) => 0.3 * Math.sin(i + 2 * j + 1))); const N = out.length * width;
  const loss = out.flatMap((row, i) => row.map((v, j) => (v - target[i]![j]!) ** 2 / (2 * N))).reduce((a, b) => a + b, 0);
  let g = out.map((row, i) => row.map((v, j) => (v - target[i]![j]!) / N)); const grads: Matrix[] = []; grads[depth] = g;
  for (let l = depth - 1; l >= 0; l--) { const { a, bn } = cache[l]!; const dz = bn.backward(g.map((row, i) => row.map((v, j) => v * (1 - a[i]![j]! ** 2)))); g = dz.map((row, i) => row.map((_, j) => row.reduce((s, v, k) => s + v * W[k]![j]!, 0) + (residual ? g[i]![j]! : 0))); grads[l] = g; }
  return { out, loss, inputGradient: g, layers, variances: layers.map(m => variance(m.flat())), gradients: grads.map(m => norm(m.flat())) };
}

export function sequenceModel(input: number[], recurrent = 0.7, forgetBias = 2) {
  const xs = input.slice(0, 8).map(v => bounded(v, 0, -5, 5)); recurrent = bounded(recurrent, 0.7, -1.5, 1.5); forgetBias = bounded(forgetBias, 2, -5, 5);
  let h = 0, c = 0, lh = 0, dr = 0, dc = 0, dl = 0;
  const rnn: number[] = [], lstm: number[] = [], cells: number[] = [], rnnSensitivity: number[] = [], lstmSensitivity: number[] = [], gates: Matrix = [];
  xs.forEach((x, t) => { h = Math.tanh(recurrent * h + x); dr = (1 - h * h) * (recurrent * dr + Number(t === 0));
    const f = sigmoid(forgetBias + 0.2 * lh), i = sigmoid(-0.3 + 0.2 * x), o = sigmoid(0.5 + 0.1 * lh), candidate = Math.tanh(x + 0.2 * lh);
    const df = f * (1 - f) * 0.2 * dl, di = i * (1 - i) * 0.2 * Number(t === 0), dCandidate = (1 - candidate ** 2) * (Number(t === 0) + 0.2 * dl), dO = o * (1 - o) * 0.1 * dl;
    dc = df * c + f * dc + di * candidate + i * dCandidate; c = f * c + i * candidate; dl = dO * Math.tanh(c) + o * (1 - Math.tanh(c) ** 2) * dc; lh = o * Math.tanh(c);
    rnn.push(h); lstm.push(lh); cells.push(c); gates.push([f, i, o, candidate]); rnnSensitivity.push(dr); lstmSensitivity.push(dl);
  });
  const attention = softmax(xs.map(x => (xs.at(-1) ?? 1) * x));
  return { rnn, lstm, cells, gates, rnnSensitivity, lstmSensitivity, attention, context: dot(attention, xs) };
}

export function rope(x: number[], position: number): number[] {
  return x.map((v, j) => { const k = j - j % 2, angle = position / 10000 ** (k / x.length); return j % 2 === 0 ? v * Math.cos(angle) - (x[j + 1] ?? 0) * Math.sin(angle) : (x[j - 1] ?? 0) * Math.sin(angle) + v * Math.cos(angle); });
}
export const TOKEN_EMBEDDINGS = [[1, 0, 0.5, -0.5], [0, 1, -0.5, 0.5], [0.5, 0.5, 1, 0], [-0.5, 0.5, 0, 1]];
export function multihead(input = TOKEN_EMBEDDINGS, useRope = true, offset = 0) {
  const rows = safeTensor(input, 8, 4); const x = (rows.length ? rows : TOKEN_EMBEDDINGS).map(r => Array.from({ length: 4 }, (_, j) => r[j] ?? 0)); offset = bounded(offset, 0, -100, 100);
  // Head 0 selects dimensions (0,1), head 1 selects (2,3); K reverses each pair, V keeps it.
  const heads = [0, 1].map(head => { const Q: Matrix = [], K: Matrix = [], V: Matrix = [];
    x.forEach((row, i) => { const e = useRope ? row : row.map((v, j) => v + (j % 2 ? Math.cos((i + offset) / 10000 ** ((j - 1) / 4)) : Math.sin((i + offset) / 10000 ** (j / 4)))); const v = e.slice(head * 2, head * 2 + 2); Q.push(useRope ? rope(v, i + offset) : v); K.push(useRope ? rope([v[1]!, v[0]!], i + offset) : [v[1]!, v[0]!]); V.push(v); });
    const logits = Q.map(q => K.map(k => dot(q, k) / Math.SQRT2)); const weights = logits.map(softmax); const out = weights.map(a => [0, 1].map(j => a.reduce((s, v, i) => s + v * V[i]![j]!, 0))); return { logits, weights, out }; });
  // Same content at every position isolates positional effects from token content.
  const relative = x.map((_, i) => x.map((__, j) => useRope ? dot(rope([1, 0.5], i + offset), rope([0.2, 1], j + offset)) : dot([1 + Math.sin(i + offset), 0.5 + Math.cos(i + offset)], [0.2 + Math.sin(j + offset), 1 + Math.cos(j + offset)])));
  return { heads, out: heads[0]!.out.map((r, i) => [...r, ...heads[1]!.out[i]!]), relative };
}

/** Exact linear teaching autoencoder: orthonormal encoder basis, tied transpose decoder. No learned PCA claim. */
export function linearAutoencoder(input: Matrix, angle = 0) {
  const x = safeTensor(input, 16, 8); if (!x.length) x.push([1, 0, 1, 0]); const d = Math.max(2, x[0]!.length); const rows = x.map(r => Array.from({ length: d }, (_, j) => r[j] ?? 0));
  const a = Array.from({ length: d }, (_, j) => 1 / Math.sqrt(d)), raw = a.map((_, j) => j - (d - 1) / 2), b = raw.map(v => v / norm(raw));
  // Rotate one basis vector into the orthogonal complement, changing reconstruction when d>2.
  const rawC = a.map((_, j) => Math.cos(j * 1.7)); const ac = dot(a, rawC), bc = dot(b, rawC); const c0 = rawC.map((v, j) => v - ac * a[j]! - bc * b[j]!); const c = norm(c0) > 1e-8 ? c0.map(v => v / norm(c0)) : b;
  const u = a.map((v, j) => Math.cos(angle) * v + Math.sin(angle) * c[j]!); const v = d === 2 ? a.map((_, j) => j === 0 ? -u[1]! : u[0]!) : b;
  const latent = rows.map(r => [dot(r, u), dot(r, v)]), reconstruction = latent.map(z => u.map((q, j) => z[0]! * q + z[1]! * v[j]!)); const loss = mean(rows.flatMap((r, i) => r.map((q, j) => (q - reconstruction[i]![j]!) ** 2)));
  return { latent, reconstruction, loss, basis: [u, v] };
}
/** Dot-product InfoNCE, no hidden L2 normalization: candidate 0 is positive. */
export function infoNCE(anchor: number[], candidates: Matrix, temperature = 0.5) {
  const tau = bounded(temperature, 0.5, 0.05, 5); const logits = candidates.map(v => dot(anchor, v) / tau); const probabilities = softmax(logits); const m = Math.max(...logits); const loss = m + Math.log(logits.reduce((s, v) => s + Math.exp(v - m), 0)) - logits[0]!;
  const gradient = anchor.map((_, j) => candidates.reduce((s, v, i) => s + (probabilities[i]! - Number(i === 0)) * (v[j] ?? 0) / tau, 0)); const candidateGradients = candidates.map((_, i) => anchor.map(v => (probabilities[i]! - Number(i === 0)) * v / tau));
  return { loss, probabilities, gradient, candidateGradients };
}

export type GaussianMixture = { centers: Matrix; variance: number };
export function diffusionMixture(swiss = false, points?: DatasetPoint[]): GaussianMixture {
  if (points?.length) return { centers: safePoints(points).map(p => [p.x, p.y]), variance: 0.025 };
  return swiss ? { centers: Array.from({ length: 60 }, (_, i) => { const a = 1 + i / 59 * 3 * Math.PI; return [0.18 * a * Math.cos(a), 0.18 * a * Math.sin(a)]; }), variance: 0.025 } : { centers: [[-1.4, 0], [1.4, 0]], variance: 0.16 };
}
/** VP forward SDE beta=3: alphaBar=exp(-3t), p_t remains a Gaussian mixture. */
export function mixtureScore(point: number[], t: number, mixture: GaussianMixture) {
  t = bounded(t, 0, 0, 4); const alpha = Math.exp(-3 * t), s = alpha * mixture.variance + 1 - alpha; const centers = mixture.centers.length ? mixture.centers : [[0, 0]]; const means = centers.map(c => c.map(v => Math.sqrt(alpha) * v));
  const logs = means.map(c => -((point[0]! - c[0]!) ** 2 + (point[1]! - c[1]!) ** 2) / (2 * s)); const weights = softmax(logs), max = Math.max(...logs);
  const logDensity = max + Math.log(logs.reduce((sum, v) => sum + Math.exp(v - max), 0)) - Math.log(centers.length * 2 * Math.PI * s);
  return { score: [0, 1].map(j => means.reduce((sum, c, i) => sum + weights[i]! * (c[j]! - point[j]!) / s, 0)), logDensity };
}
export function diffusionForward(t: number, seed = 7, mixture = diffusionMixture()): Matrix {
  const r = seeded(seed), alpha = Math.exp(-3 * bounded(t, 0, 0, 4)); const centers = mixture.centers.length ? mixture.centers : [[0, 0]];
  return Array.from({ length: 80 }, () => { const c = centers[Math.floor(r() * centers.length)]!; return [0, 1].map(j => { const x0 = c[j]! + Math.sqrt(mixture.variance) * gaussian(r), eps = gaussian(r); return Math.sqrt(alpha) * x0 + Math.sqrt(1 - alpha) * eps; }); });
}
/** Backward Euler-in-time evaluation of probability-flow ODE, not a learned denoiser nor exact inverse. */
export function reverseDiffusionStep(x: number[], t: number, dt: number, mixture = diffusionMixture()): number[] { const h = Math.min(bounded(dt, 0.02, 0, 0.05), Math.max(0, t)); const score = mixtureScore(x, t, mixture).score; return x.map((v, j) => v + 1.5 * h * (v + score[j]!)); }

export const CLIFF_START = 30, CLIFF_GOAL = 35;
export function cliffTransition(state: number, action: number) {
  const row = Math.floor(state / 6), col = state % 6, offsets = [[-1, 0], [0, 1], [1, 0], [0, -1]]; const d = offsets[size(action, 0, 3)]!; const next = Math.max(0, Math.min(5, row + d[0]!)) * 6 + Math.max(0, Math.min(5, col + d[1]!));
  if (next > 30 && next < 35) return { next: CLIFF_START, reward: -100, done: false };
  return { next, reward: next === CLIFF_GOAL ? 20 : -1, done: next === CLIFF_GOAL };
}
export function qUpdate(q: number, reward: number, nextMax: number, alpha: number, gamma: number, terminal: boolean) { return q + alpha * (reward + (terminal ? 0 : gamma * nextMax) - q); }
export function reinforceGradient(probabilities: number[], action: number, discountedReturn: number) { return probabilities.map((p, i) => discountedReturn * (Number(i === action) - p)); }
export function trainCliff(episodes = 30, seed = 7, alpha = 0.15, gamma = 0.95, epsilon = 0.2, policyGradient = false) {
  const r = seeded(seed); alpha = bounded(alpha, 0.15, 0.001, 1); gamma = bounded(gamma, 0.95, 0, 1); epsilon = bounded(epsilon, 0.2, 0, 1);
  const table = Array.from({ length: 36 }, () => [0, 0, 0, 0]); const returns: number[] = [], steps: number[] = []; let lastPath = [CLIFF_START];
  const draw = (p: number[]) => { const u = r(); let c = 0; for (let a = 0; a < p.length; a++) { c += p[a]!; if (u < c) return a; } return p.length - 1; };
  for (let ep = 0; ep < size(episodes, 0, 200); ep++) { let state = CLIFF_START, total = 0; const path = [state]; const trajectory: { s: number; a: number; reward: number; p: number[] }[] = [];
    for (let k = 0; k < 200; k++) { const p = softmax(table[state]!); const max = Math.max(...table[state]!), ties = table[state]!.map((v, a) => v === max ? a : -1).filter(a => a >= 0); const a = policyGradient ? draw(p) : r() < epsilon ? Math.floor(r() * 4) : ties[Math.floor(r() * ties.length)]!; const tr = cliffTransition(state, a);
      trajectory.push({ s: state, a, reward: tr.reward, p }); if (!policyGradient) table[state]![a] = qUpdate(table[state]![a]!, tr.reward, Math.max(...table[tr.next]!), alpha, gamma, tr.done); total += tr.reward; state = tr.next; path.push(state); if (tr.done) break;
    }
    if (policyGradient) { let G = 0; const gradient = table.map(row => row.map(() => 0)); for (let k = trajectory.length - 1; k >= 0; k--) { const tr = trajectory[k]!; G = tr.reward + gamma * G; const g = reinforceGradient(tr.p, tr.a, G); g.forEach((v, a) => { gradient[tr.s]![a] = (gradient[tr.s]![a] ?? 0) + gamma ** k * v; }); } // exact episodic discounted-return score-function gradient, fixed reward scale 1/100
      table.forEach((row, s) => row.forEach((v, a) => { table[s]![a] = bounded(v + alpha * (gradient[s]?.[a] ?? 0) / 100, 0, -30, 30); })); }
    returns.push(total); steps.push(trajectory.length); lastPath = path;
  }
  const policy = table.map(row => policyGradient ? softmax(row) : row); return { table, policy, returns, steps, lastPath, values: Array.from({ length: 6 }, (_, y) => Array.from({ length: 6 }, (_, x) => Math.max(...policy[y * 6 + x]!))) };
}

export interface AdvancedSnapshot { outputs: Record<string, PortValue>; matrices: { label: string; data: Matrix }[]; curves: { label: string; data: number[] }[]; points?: Matrix; support?: boolean[]; vectors?: Matrix; note: string; grid?: ReturnType<typeof trainCliff> }
const tensor = (data: Matrix): PortValue => ({ kind: 'tensor2d', data: data.slice(0, 16).map(r => r.slice(0, 16)) });
const scalar = (v: number): PortValue => ({ kind: 'scalar', v: Number.isFinite(v) ? v : 0 });
export function advancedSnapshot(node: CanvasNode, input: (port: string) => PortValue | null, frame = 0): AdvancedSnapshot | null {
  const p = node.params, v = input('in'), control = input('control'); const cp = (key: string, fallback: number, lo: number, hi: number) => bounded(key === 'control' && control?.kind === 'scalar' ? control.v : p[key], fallback, lo, hi);
  const data = v?.kind === 'tensor2d' ? safeTensor(v.data) : TOKEN_EMBEDDINGS; const points = v?.kind === 'dataset2d' ? safePoints(v.points) : toyPoints(cp('seed', 7, 0, 10000), !!p.quadratic);
  const empty = { matrices: [], curves: [] }; frame = size(frame, 0, 700);
  switch (node.type) {
    case 'svmLab': { const m = trainSVM(points, cp('control', 2, 0.01, 20), !!p.quadratic, cp('steps', 100, 0, 800) + frame * 10); const boundary = Array.from({ length: 16 }, (_, i) => Array.from({ length: 16 }, (_, j) => dot(m.w, svmFeatures(-2 + j * 4 / 15, 2 - i * 4 / 15, !!p.quadratic)) + m.b)); return { outputs: { out: tensor([[...m.w, m.b]]), loss: scalar(m.loss), data: { kind: 'dataset2d', points: points.filter((_, i) => m.support[i]) } }, matrices: [{ label: '决策分数 f(x,y)，域 [-2,2]²', data: boundary }], curves: [{ label: '训练 primal objective', data: m.history }], points: points.map((p, i) => [p.x, p.y, p.label, m.scores[i]!]), support: m.support, note: `½‖w‖² + C·mean hinge；验证准确率 ${(m.accuracy * 100).toFixed(1)}%。圈：训练 margin≤1.05 的支持候选（数值近似，非对偶精确判定）。${p.quadratic ? 'φ=[x,y,x²,√2xy,y²]；固定 K=φ·φ，不是任意核。' : '线性软间隔；验证点不参与优化。'}` }; }
    case 'resnetLab': { const mode: NormMode = p.norm === 1 ? 'BN' : p.norm === 2 ? 'LN' : 'none'; const a = residualNetwork(data, cp('depth', 6, 1, 12), false, 'none', cp('control', 0.65, 0.05, 2)), b = residualNetwork(data, cp('depth', 6, 1, 12), true, mode, cp('control', 0.65, 0.05, 2)); return { outputs: { out: tensor(b.out), gradient: tensor(b.inputGradient), loss: scalar(b.loss) }, matrices: [{ label: '纯堆叠末层激活', data: a.out }, { label: '残差末层激活', data: b.out }], curves: [{ label: '纯堆叠逐层方差', data: a.variances }, { label: '残差逐层方差', data: b.variances }, { label: '纯堆叠梯度 L2', data: a.gradients }, { label: '残差梯度 L2', data: b.gradients }], note: `x→tanh(Norm(Wx)) + x；对照路无归一化、无残差。${mode}：BN 按列跨样本；LN 按行跨特征。γ=1 β=0，训练态统计；真实 MSE 反传，不保证任何参数下梯度都改善。` }; }
    case 'sequenceMemory': { const m = sequenceModel(v?.kind === 'tensor2d' ? data.flat().slice(0, 8) : [1, 0, 0, 0, 0, 0, 0, 0], cp('recurrent', 0.7, -1.5, 1.5), cp('control', 2, -5, 5)); return { outputs: { out: tensor([m.rnn, m.lstm, m.cells]), attention: tensor([m.attention]), loss: scalar(m.context) }, matrices: [{ label: '每步门 f / i / o / g', data: m.gates }, { label: '末 token 查询的直接 attention 权重', data: [m.attention] }], curves: [{ label: 'RNN h', data: m.rnn }, { label: 'LSTM h', data: m.lstm }, { label: 'cell c', data: m.cells }, { label: '∂RNN h_t/∂x₀', data: m.rnnSensitivity }, { label: '∂LSTM h_t/∂x₀', data: m.lstmSensitivity }], note: '标量 RNN h=tanh(wh+x)。LSTM f=σ(bf+.2h), i=σ(-.3+.2x), o=σ(.5+.1h), g=tanh(x+.2h), c=fc+ig。Attention softmax(x末·x)；跨距 O(1) ≠ 总复杂度 O(1)，全序列注意力通常 O(n²)。' }; }
    case 'multiheadLab': { const m = multihead(data, p.mode !== 0, cp('control', 0, -100, 100)); return { outputs: { out: tensor(m.out), attention: tensor(m.heads[size(p.head ?? 0, 0, 1)]!.weights), relative: tensor(m.relative) }, matrices: [{ label: 'Head 0 权重', data: m.heads[0]!.weights }, { label: 'Head 1 权重', data: m.heads[1]!.weights }, { label: '固定内容的位置内积（未 softmax）', data: m.relative }], curves: [], note: '默认 4 个固定教学向量，非语言语义。头0取维度0/1、头1取2/3；Q=V=该对，K=交换该对；RoPE 在投影后旋转。Sinusoid 在4维输入上相加。输出为两头拼接，无输出投影。位置内积图用同一对内容隔离相对位置。' }; }
    case 'autoencoderLab': { const m = linearAutoencoder(data, cp('angle', 0, -3.14, 3.14)), anchor = [cp('ax', 0.4, -3, 3), cp('ay', 0.3, -3, 3)], candidates = [[1, 0.5], [-1, 0], [0, -1]]; const nce = infoNCE(anchor, candidates, cp('control', 0.5, 0.05, 5)); const field = Array.from({ length: 49 }, (_, k) => { const x = -1.5 + k % 7 * 0.5, y = -1.5 + Math.floor(k / 7) * 0.5; return [x, y, ...infoNCE([x, y], candidates, cp('control', 0.5, 0.05, 5)).gradient.map(v => -v)]; }); return { outputs: { out: tensor(m.latent), reconstruction: tensor(m.reconstruction), loss: scalar(m.loss), contrastive: scalar(nce.loss), gradient: tensor([nce.gradient, ...nce.candidateGradients]) }, matrices: [{ label: '高维输入（行=样本）', data }, { label: '重建', data: m.reconstruction }, { label: '正/负候选概率', data: [nce.probabilities] }], curves: [], points: [...m.latent.map(z => [...z, 0]), [...anchor, 1], ...candidates.map((z, i) => [...z, i === 0 ? 2 : 3])], vectors: field, note: `精确线性教学 AE：固定正交二维子空间投影，非训练网络/PCA；angle 旋转子空间。MSE=${m.loss.toFixed(4)}。InfoNCE=${nce.loss.toFixed(4)}，未归一化点积；橙点 anchor，绿点正样本，其余负样本；箭头是 −∇anchor loss，点击平面移动 anchor。` }; }
    case 'diffusionLab': { const t = cp('control', 0.4, 0, 4), mix = diffusionMixture(!!p.swiss, v?.kind === 'dataset2d' ? points : undefined), forward = diffusionForward(t, cp('seed', 7, 0, 10000), mix), pts = p.reverse ? forward.map(x => reverseDiffusionStep(x, t, 0.02, mix)) : forward; const field = Array.from({ length: 49 }, (_, i) => { const x = -2 + i % 7 * 4 / 6, y = -2 + Math.floor(i / 7) * 4 / 6; return [x, y, ...mixtureScore([x, y], t, mix).score]; }); return { ...empty, outputs: { out: { kind: 'dataset2d', points: pts.map(x => ({ x: x[0]!, y: x[1]!, label: 0, split: 'train' })) }, score: tensor(field.slice(0, 16)), loss: scalar(mean(pts.map(x => -mixtureScore(x, t, mix).logDensity))) }, points: pts, vectors: field, note: `ᾱ=e^(−3t)，固定 seed 闭式加噪。${p.swiss || v?.kind === 'dataset2d' ? '经验 Gaussian mixture' : '双高斯 mixture'} 解析 score（非训练去噪网络）。箭头 ∇log p_t；反向按钮从当前快照做一次 probability-flow ODE Euler 步，dt=min(.02,t)，不是精确还原。` }; }
    case 'qLearningLab': { const m = trainCliff(cp('episodes', 30, 0, 200) + frame, cp('seed', 7, 0, 10000), cp('alpha', 0.15, 0.001, 1), cp('gamma', 0.95, 0, 1), cp('control', 0.2, 0, 1), !!p.mode); return { outputs: { out: tensor(m.values), policy: tensor(Array.from({ length: 6 }, (_, y) => Array.from({ length: 6 }, (_, x) => m.policy[y * 6 + x]!.indexOf(Math.max(...m.policy[y * 6 + x]!))))), loss: scalar(m.returns.at(-1) ?? 0) }, matrices: [], curves: [{ label: 'Episode return（原始奖励）', data: m.returns }, { label: 'Episode steps', data: m.steps }], grid: m, note: `${p.mode ? 'REINFORCE：softmax 策略，整回合 γ^t G_t∇logπ，奖励固定缩放1/100；ε不参与。logits限幅±30。' : 'Seeded ε-greedy，随机打破并列；真实 Bellman 更新。'} ↑→↓← 编码0/1/2/3。起点左下，终点右下+20；悬崖−100回起点，其余−1。200步截断（按有限回合目标）；颜色=${p.mode ? '最大策略概率' : 'max Q'}。` }; }
    default: return null;
  }
}
export function deepAdvancedOutput(node: CanvasNode, input: (port: string) => PortValue | null, portId: string): PortValue | null { return advancedSnapshot(node, input)?.outputs[portId] ?? null; }
