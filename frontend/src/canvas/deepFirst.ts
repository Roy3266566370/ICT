import type { CanvasNode, NodeType, PortValue } from './types.ts';

export const DF_ACTIVATIONS = ['ReLU', 'LeakyReLU', 'Sigmoid', 'Tanh', 'GELU'] as const;
export const DF_OPTIMIZERS = ['SGD', 'Momentum', 'RMSProp', 'Adam'] as const;
export type DFOptimizer = typeof DF_OPTIMIZERS[number];
export const dfFinite = (v: number | undefined, fallback: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(v) ? v! : fallback));
export function deepFirstDefaults(type: NodeType): Record<string, number> | null {
  switch (type) {
    case 'activationProbe': return { activation: 2, x: 1, mode: 0 };
    case 'optimizerArena': return { terrain: 0, x: -2, y: 2, lr: 0.05, steps: 40 };
    case 'attentionAB': return { dk: 16, query: 0, key: 0 };
    case 'kvCache': return { steps: 1, temperature: 1, topk: 10, topp: 1 };
    default: return null;
  }
}
export function dfParams(node: Pick<CanvasNode, 'type' | 'params'>): Record<string, number> {
  const p = node.params;
  switch (node.type) {
    case 'activationProbe': return { activation: Math.round(dfFinite(p.activation, 2, 0, 4)), x: dfFinite(p.x, 1, -8, 8), mode: Math.round(dfFinite(p.mode, 0, 0, 1)) };
    case 'optimizerArena': return { terrain: Math.round(dfFinite(p.terrain, 0, 0, 2)), x: dfFinite(p.x, -2, -4, 4), y: dfFinite(p.y, 2, -4, 4), lr: dfFinite(p.lr, 0.05, 0.001, 1), steps: Math.round(dfFinite(p.steps, 40, 0, 200)) };
    case 'attentionAB': return { dk: Math.round(dfFinite(p.dk, 16, 2, 64)), query: Math.round(dfFinite(p.query, 0, 0, 5)), key: Math.round(dfFinite(p.key, 0, 0, 5)) };
    case 'kvCache': return { steps: Math.round(dfFinite(p.steps, 1, 1, 8)), temperature: dfFinite(p.temperature, 1, 0.05, 3), topk: Math.round(dfFinite(p.topk, 10, 1, 10)), topp: dfFinite(p.topp, 1, 0.01, 1) };
    default: return {};
  }
}
export function dfActivation(kind: number, x: number): { value: number; derivative: number } {
  switch (kind) {
    case 0: return { value: Math.max(0, x), derivative: x > 0 ? 1 : 0 };
    case 1: return { value: x > 0 ? x : 0.01 * x, derivative: x > 0 ? 1 : 0.01 };
    case 2: { const s = x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)); return { value: s, derivative: s * (1 - s) }; }
    case 3: { const t = Math.tanh(x); return { value: t, derivative: 1 - t * t }; }
    default: {
      const c = Math.sqrt(2 / Math.PI), t = Math.tanh(c * (x + 0.044715 * x ** 3));
      return { value: 0.5 * x * (1 + t), derivative: 0.5 * (1 + t) + 0.5 * x * (1 - t * t) * c * (1 + 3 * 0.044715 * x * x) };
    }
  }
}
export function dfGradientChain(kind: number, x: number, forward: boolean): { z: number; value: number; derivative: number; gradient: number }[] {
  let h = x, gradient = 1;
  return Array.from({ length: 10 }, () => {
    const z = forward ? h : x, a = dfActivation(kind, z);
    h = a.value; gradient *= a.derivative;
    return { z, ...a, gradient };
  });
}
export function dfTerrain(kind: number, x: number, y: number): { loss: number; grad: [number, number] } {
  if (kind === 1) return { loss: (x * x - y * y) / 2, grad: [x, -y] };
  if (kind === 2) return { loss: (x * x + 40 * y * y) / 2, grad: [x, 40 * y] };
  return { loss: (x * x + y * y) / 2, grad: [x, y] };
}
export interface DFOptimState { x: number; y: number; m: [number, number]; v: [number, number]; step: number; stopped: boolean }
export function dfOptimStart(x: number, y: number): DFOptimState { return { x, y, m: [0, 0], v: [0, 0], step: 0, stopped: false }; }
export function dfOptimStep(state: DFOptimState, kind: DFOptimizer, terrain: number, lr: number): DFOptimState {
  if (state.stopped) return state;
  const t = state.step + 1, g = dfTerrain(terrain, state.x, state.y).grad;
  const m: [number, number] = [0, 0], v: [number, number] = [0, 0];
  const next = g.map((gradient, i) => {
    m[i] = 0.9 * state.m[i]! + (kind === 'Momentum' ? gradient : 0.1 * gradient);
    v[i] = (kind === 'Adam' ? 0.999 : 0.9) * state.v[i]! + (kind === 'Adam' ? 0.001 : 0.1) * gradient ** 2;
    const update = kind === 'SGD' ? gradient : kind === 'Momentum' ? m[i]! : kind === 'RMSProp' ? gradient / (Math.sqrt(v[i]!) + 1e-8) : (m[i]! / (1 - 0.9 ** t)) / (Math.sqrt(v[i]! / (1 - 0.999 ** t)) + 1e-8);
    return (i === 0 ? state.x : state.y) - lr * update;
  });
  if (next.some(n => !Number.isFinite(n) || Math.abs(n) > 1e4)) return { ...state, stopped: true };
  return { x: next[0]!, y: next[1]!, m, v, step: t, stopped: false };
}
export function dfOptimRun(p: Record<string, number>, steps = p.steps!): { kind: DFOptimizer; state: DFOptimState; path: DFOptimState[]; loss: number }[] {
  return DF_OPTIMIZERS.map(kind => {
    let state = dfOptimStart(p.x!, p.y!);
    const path = [state];
    for (let i = 0; i < Math.round(dfFinite(steps, 0, 0, 200)); i++) {
      state = dfOptimStep(state, kind, p.terrain!, p.lr!); path.push(state);
      if (state.stopped) break;
    }
    return { kind, state, path, loss: dfTerrain(p.terrain!, state.x, state.y).loss };
  });
}
export function dfSoftmax(logits: readonly number[]): number[] {
  if (!logits.length) return [];
  const positive = logits.filter(x => x === Infinity).length;
  if (positive) return logits.map(x => x === Infinity ? 1 / positive : 0);
  const safe = logits.map(x => Number.isNaN(x) ? -Infinity : x), max = Math.max(...safe);
  if (max === -Infinity) return safe.map(() => 1 / safe.length);
  const exps = safe.map(x => Math.exp(x - max)), sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(x => x / sum);
}
export function dfAttention(dimension: number) {
  const dk = Math.round(dfFinite(dimension, 16, 2, 64));
  let seed = 20261120;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed + 0.5) / 4294967296; };
  const normal = () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
  const q = Array.from({ length: 6 }, () => Array.from({ length: 64 }, normal));
  const k = Array.from({ length: 6 }, () => Array.from({ length: 64 }, normal));
  const scores = q.map(row => k.map(key => row.slice(0, dk).reduce((s, x, j) => s + x * key[j]!, 0)));
  return { q: q.map(r => r.slice(0, dk)), k: k.map(r => r.slice(0, dk)), scores, scaled: scores.map(r => dfSoftmax(r.map(x => x / Math.sqrt(dk)))), unscaled: scores.map(dfSoftmax) };
}
export function dfAttentionStats(p: number[]) {
  const jacobian = p.map((x, i) => p.map((y, j) => x * ((i === j ? 1 : 0) - y)));
  return { entropy: -p.reduce((s, x) => s + (x > 0 ? x * Math.log(x) : 0), 0), jacobian, norm: Math.sqrt(jacobian.flat().reduce((s, x) => s + x * x, 0)) };
}
export const DF_TOKENS = ['我', '在', '工坊', '学习', '注意力', '机制'];
export const DF_CANDIDATES = ['模型', '学习', '理解', '计算', '生成', '缓存', '词元', '概率', '矩阵', '结束'];
export function dfSampleDistribution(logits: number[], temperature: number, topk: number, topp: number) {
  const base = dfSoftmax(logits.map(x => x / dfFinite(temperature, 1, 0.05, 3)));
  const order = base.map((p, index) => ({ p, index })).sort((a, b) => b.p - a.p || a.index - b.index).slice(0, Math.round(dfFinite(topk, 10, 1, logits.length)));
  const ksum = order.reduce((s, x) => s + x.p, 0), threshold = dfFinite(topp, 1, 0.01, 1);
  let cumulative = 0;
  const kept: number[] = [];
  for (const item of order) { kept.push(item.index); cumulative += item.p / ksum; if (cumulative >= threshold) break; }
  const sum = kept.reduce((s, i) => s + base[i]!, 0);
  return { base, kept, probabilities: base.map((p, i) => kept.includes(i) ? p / sum : 0) };
}
export function dfCacheCounts(tokens: number, d = 8) {
  const n = Math.round(dfFinite(tokens, 1, 1, 8)), width = Math.round(dfFinite(d, 8, 1, 64));
  const prefix = n * (n + 1) / 2;
  const kvWithout = 2 * width * width * prefix, kvWith = 2 * width * width * n;
  const attention = 2 * width * prefix;
  return { n, kvWithout, kvWith, attentionWithout: attention, attentionWith: attention, totalWithout: kvWithout + attention, totalWith: kvWith + attention };
}
export function dfCacheLogits(step: number): number[] { return DF_CANDIDATES.map((_, i) => 2 * Math.sin((i + 1) * 1.7 + step * 0.6) - i * 0.14); }
export function dfCacheSequence(steps: number, temperature: number, topk: number, topp: number): string[] {
  let seed = 20261120;
  return Array.from({ length: Math.round(dfFinite(steps, 1, 1, 8)) }, (_, i) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const u = (seed + 0.5) / 4294967296;
    const p = dfSampleDistribution(dfCacheLogits(i + 1), temperature, topk, topp).probabilities;
    let cumulative = 0;
    const index = p.findIndex(x => { cumulative += x; return u < cumulative; });
    return DF_CANDIDATES[index < 0 ? p.length - 1 : index]!;
  });
}
export function deepFirstOutput(node: CanvasNode, input: (port: string) => PortValue | null, portId: string): PortValue | null {
  const p = dfParams(node), value = input('in');
  if (value?.kind === 'scalar' && Number.isFinite(value.v)) {
    if (node.type === 'activationProbe') p.x = dfFinite(value.v, 1, -8, 8);
    if (node.type === 'optimizerArena') p.steps = Math.round(dfFinite(value.v, 0, 0, 200));
    if (node.type === 'attentionAB') p.dk = Math.round(dfFinite(value.v, 16, 2, 64));
    if (node.type === 'kvCache') p.steps = Math.round(dfFinite(value.v, 1, 1, 8));
  }
  if (node.type === 'activationProbe') {
    const chain = dfGradientChain(p.activation!, p.x!, !!p.mode);
    if (portId === 'out') return { kind: 'scalar', v: chain[9]!.gradient };
    if (portId === 'layers') return { kind: 'tensor2d', data: chain.map(r => [r.z, r.value, r.derivative, r.gradient]) };
  }
  if (node.type === 'optimizerArena') {
    const runs = dfOptimRun(p);
    const index = ['sgd', 'momentum', 'rmsprop', 'out'].indexOf(portId);
    if (index >= 0) return { kind: 'scalar', v: runs[index]!.loss };
  }
  if (node.type === 'attentionAB') {
    const a = dfAttention(p.dk!);
    if (portId === 'out') return { kind: 'scalar', v: dfAttentionStats(a.scaled[p.query!]!).entropy };
    if (portId === 'weights') return { kind: 'tensor2d', data: a.scaled };
  }
  if (node.type === 'kvCache') {
    const counts = dfCacheCounts(p.steps!);
    if (portId === 'out') return { kind: 'scalar', v: counts.totalWithout - counts.totalWith };
    if (portId === 'probabilities') return { kind: 'tensor2d', data: [dfSampleDistribution(dfCacheLogits(p.steps!), p.temperature!, p.topk!, p.topp!).probabilities] };
  }
  return null;
}
