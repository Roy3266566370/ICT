import type { CanvasNode, PortValue, DatasetPoint } from './types.ts';
export type Matrix = number[][];
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : lo));
export function rng(seed = 1) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
export function valid(a: Matrix): boolean { return a.length > 0 && a.length <= 16 && a[0]!.length > 0 && a[0]!.length <= 16 && a.every(r => r.length === a[0]!.length && r.every(Number.isFinite)); }
export function tensor(data: Matrix): PortValue | null { return valid(data) ? { kind: 'tensor2d', data } : null; }
const matrix = (v: PortValue | null): Matrix | null => v?.kind === 'tensor2d' && valid(v.data) ? v.data : null;
export function dataset(kind = 0, count = 100, noise = .08, seed = 7): DatasetPoint[] {
    const random = rng(seed), n = Math.round(clamp(count, 8, 120));
    const points: DatasetPoint[] = Array.from({ length: n }, (_, i) => {
        const label = i % 2, t = random(), a = t * Math.PI * 2;
        let x: number, y: number;
        if (kind === 1) {
            x = Math.cos(t * Math.PI) + label - .5;
            y = Math.sin(t * Math.PI) * (label ? -1 : 1) + (label ? .25 : -.25);
        }
        else if (kind === 2) {
            const r = label ? .45 : 1;
            x = r * Math.cos(a);
            y = r * Math.sin(a);
        }
        else if (kind === 3) {
            const angle = t * Math.PI * 3 + label * Math.PI;
            x = t * Math.cos(angle);
            y = t * Math.sin(angle);
        }
        else {
            x = (random() * .85 + .1) * (random() > .5 ? 1 : -1);
            y = (random() * .85 + .1) * (label ? -Math.sign(x) : Math.sign(x));
        }
        return { x: x + (random() * 2 - 1) * clamp(noise, 0, 1), y: y + (random() * 2 - 1) * clamp(noise, 0, 1), label, split: 'train' };
    });
    // Stratified seeded holdout; membership never changes during optimization.
    for (const label of [0, 1]) {
        const indices = points.map((p, i) => p.label === label ? i : -1).filter(i => i >= 0);
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [indices[i], indices[j]] = [indices[j]!, indices[i]!];
        }
        indices.slice(0, Math.max(1, Math.floor(indices.length * .25))).forEach(i => { points[i]!.split = 'validation'; });
    }
    return points;
}
export function activation(x: number, kind = 3): [
    number,
    number
] {
    if (kind === 0)
        return [Math.max(0, x), x > 0 ? 1 : 0];
    if (kind === 1)
        return [x > 0 ? x : .01 * x, x > 0 ? 1 : .01];
    if (kind === 2) {
        const s = 1 / (1 + Math.exp(-clamp(x, -700, 700)));
        return [s, s * (1 - s)];
    }
    if (kind === 4) {
        const k = Math.sqrt(2 / Math.PI), t = Math.tanh(k * (x + .044715 * x ** 3));
        return [.5 * x * (1 + t), .5 * (1 + t) + .5 * x * (1 - t * t) * k * (1 + .134145 * x * x)];
    }
    const t = Math.tanh(x);
    return [t, 1 - t * t];
}
export function normalize(a: Matrix, mode: number): Matrix {
    if (!valid(a))
        return [];
    if (!mode)
        return a.map(r => [...r]);
    const stats = (v: number[]): [number, number] => { const mean = v.reduce((s, x) => s + x, 0) / v.length; return [mean, Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length + 1e-5)]; };
    return a.map((row, i) => row.map((x, j) => { const [mean, sd] = stats(mode === 1 ? a.map(r => r[j]!) : a[i]!); return (x - mean) / sd; }));
}
export function weights(rows: number, cols: number, seed: number, orthogonal = false): Matrix {
    const random = rng(seed);
    const w = Array.from({ length: rows }, () => Array.from({ length: cols }, () => (random() * 2 - 1) * Math.sqrt(6 / (rows + cols))));
    if (orthogonal) { // Orthogonal columns when tall, rows when wide.
        const vectors = rows >= cols ? Array.from({ length: cols }, (_, j) => w.map(r => r[j]!)) : w;
        vectors.forEach((v, i) => { for (let k = 0; k < i; k++) {
            const dot = v.reduce((s, x, j) => s + x * vectors[k]![j]!, 0);
            v.forEach((_, j) => { v[j]! -= dot * vectors[k]![j]!; });
        } const norm = Math.hypot(...v) || 1; v.forEach((_, j) => { v[j]! /= norm; }); });
        return rows >= cols ? w.map((r, i) => r.map((_, j) => vectors[j]![i]!)) : vectors;
    }
    return w;
}
export interface Trace {
    row: number;
    col: number;
    value: number;
    expression: string;
    children: Trace[];
    sources: string[];
}
export const traces = new WeakMap<Matrix, Trace[][]>();
export function convolution(a: Matrix, kernel: Matrix, stride = 1, padding = 0, pool = false): Matrix {
    if (!valid(a) || kernel.length !== 3 || kernel.some(r => r.length !== 3 || !r.every(Number.isFinite)))
        return [];
    stride = Math.round(clamp(stride, 1, 2));
    padding = padding ? 1 : 0;
    const h = Math.floor((a.length + 2 * padding - 3) / stride) + 1, w = Math.floor((a[0]!.length + 2 * padding - 3) / stride) + 1;
    if (h < 1 || w < 1)
        return [];
    const previous = traces.get(a), trace: Trace[][] = [];
    const result = Array.from({ length: h }, (_, i) => {
        trace[i]! = [];
        return Array.from({ length: w }, (_, j) => {
            let sum = 0;
            const terms: string[] = [], children: Trace[] = [], sources = new Set<string>();
            for (let u = 0; u < 3; u++)
                for (let v = 0; v < 3; v++) {
                    const r = i * stride + u - padding, c = j * stride + v - padding, x = a[r]!?.[c] ?? 0;
                    sum += x * kernel[u]![v]!;
                    terms.push(`(${r},${c}) ${x.toFixed(3)} × ${kernel[u]![v]!.toFixed(3)}`);
                    if (a[r]!?.[c] !== undefined) {
                        const child = previous?.[r]?.[c];
                        if (child) {
                            children.push(child);
                            child.sources.forEach(s => sources.add(s));
                        }
                        else
                            sources.add(`${r},${c}`);
                    }
                }
            trace[i]![j]! = { row: i, col: j, value: sum, expression: terms.join(' + ') + ` = ${sum.toFixed(4)}`, children, sources: [...sources] };
            return sum;
        });
    });
    if (!pool) {
        traces.set(result, trace);
        return result;
    }
    const pt: Trace[][] = [];
    const pooled = Array.from({ length: Math.floor(h / 2) }, (_, i) => { pt[i]! = []; return Array.from({ length: Math.floor(w / 2) }, (_, j) => { const children = [trace[i * 2]![j * 2]!, trace[i * 2]![j * 2 + 1]!, trace[i * 2 + 1]![j * 2]!, trace[i * 2 + 1]![j * 2 + 1]!], value = Math.max(...children.map(c => c.value)); pt[i]![j]! = { row: i, col: j, value, expression: `max(${children.map(c => c.value.toFixed(3)).join(', ')}) = ${value.toFixed(3)}`, children, sources: [...new Set(children.flatMap(c => c.sources))] }; return value; }); });
    traces.set(pooled, pt);
    return pooled;
}
export interface Model {
    w: Matrix[];
    b: number[][];
    epoch: number;
    seed: number;
    grad: Matrix;
    history: [
        number,
        number
    ][];
}
export function createModel(width = 6, seed = 7): Model { const dims = [2, Math.round(clamp(width, 1, 8)), 2, 1]; return { w: dims.slice(1).map((d, i) => weights(dims[i]!, d, seed + i * 41)), b: dims.slice(1).map(d => Array(d).fill(0)), epoch: 0, seed, grad: [[0, 0, 0]], history: [] }; }
export function forward(m: Model, x: number[], dropout = 0, random = rng(1)) {
    const acts = [x], raw: number[][] = [], masks: number[][] = [];
    m.w.forEach((w, l) => { const z = m.b[l]!.map((b, j) => b + acts[l]!.reduce((s, a, i) => s + a * w[i]![j]!, 0)); const mask = z.map(() => l < 2 && dropout ? (random() >= dropout ? 1 / (1 - dropout) : 0) : 1); raw.push(z); masks.push(mask); acts.push(z.map((v, j) => activation(v, l === 2 ? 2 : 3)[0]! * mask[j]!)); });
    return { acts, raw, masks, probability: acts[3]![0]! };
}
export function gradients(m: Model, points: DatasetPoint[], l1 = 0, l2 = 0, dropout = 0, random = rng(1)) {
    const w = m.w.map(a => a.map(r => r.map(() => 0))), b = m.b.map(r => r.map(() => 0));
    let loss = 0;
    for (const p of points) {
        const f = forward(m, [p.x, p.y], dropout, random), z = f.raw[2]![0]!;
        loss += Math.max(z, 0) - z * p.label + Math.log1p(Math.exp(-Math.abs(z)));
        let delta = [f.probability - p.label];
        for (let l = 2; l >= 0; l--) {
            delta.forEach((d, j) => { b[l]![j]! += d / points.length; f.acts[l]!.forEach((a, i) => { w[l]![i]![j]! += a * d / points.length; }); });
            if (l)
                delta = m.w[l]!.map((r, i) => r.reduce((s, v, j) => s + v * delta[j]!, 0) * activation(f.raw[l - 1]![i]!, 3)[1]! * f.masks[l - 1]![i]!);
        }
    }
    loss /= Math.max(1, points.length);
    m.w.forEach((a, l) => a.forEach((r, i) => r.forEach((v, j) => { loss += l1 * Math.abs(v) + .5 * l2 * v * v; w[l]![i]![j]! += l1 * Math.sign(v) + l2 * v; })));
    return { w, b, loss };
}
export function trainEpoch(m: Model, points: DatasetPoint[], params: Record<string, number> = {}): Model {
    if (m.epoch >= 2000)
        return m;
    const train = points.filter(p => p.split === 'train' && [p.x, p.y, p.label].every(Number.isFinite)).slice(0, 120);
    if (!train.length)
        return m;
    const next: Model = { ...m, w: m.w.map(a => a.map(r => [...r])), b: m.b.map(r => [...r]), epoch: m.epoch + 1 };
    const random = rng(m.seed + m.epoch * 7919);
    for (let i = train.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [train[i], train[j]] = [train[j]!, train[i]!];
    }
    const size = Math.round(clamp(params.batch ?? 16, 1, 16)), lr = clamp(params.lr ?? .08, .0001, .5);
    for (let i = 0; i < train.length; i += size) {
        const g = gradients(next, train.slice(i, i + size), clamp(params.l1 ?? 0, 0, 1), clamp(params.l2 ?? 0, 0, 1), clamp(params.dropout ?? 0, 0, .8), random);
        next.grad = [g.w.map(a => Math.hypot(...a.flat()))];
        next.w.forEach((a, l) => a.forEach((r, u) => r.forEach((v, j) => { next.w[l]![u]![j]! = clamp(v - lr * clamp(g.w[l]![u]![j]!, -10, 10), -30, 30); })));
        next.b.forEach((r, l) => r.forEach((v, j) => { next.b[l]![j]! = clamp(v - lr * clamp(g.b[l]![j]!, -10, 10), -30, 30); }));
    }
    const validation = points.filter(p => p.split === 'validation').slice(0, 120);
    next.history = [...m.history.slice(-199), [gradients(next, train).loss, gradients(next, validation).loss]];
    return next;
}
export const boundaryModels = new WeakMap<object, Model>();
export function trainingOutputs(m: Model, points: DatasetPoint[]): Record<'boundary' | 'probability' | 'loss' | 'validationLoss' | 'grad', PortValue> {
    const boundary: PortValue = { kind: 'dataset2d', points: points.slice(0, 120).map(p => ({ ...p })) };
    boundaryModels.set(boundary, m);
    const probabilities: PortValue = { kind: 'dataset2d', points: points.slice(0, 120).map(p => ({ ...p, label: forward(m, [p.x, p.y]).probability })) };
    return { boundary, probability: probabilities, loss: { kind: 'scalar', v: gradients(m, points.filter(p => p.split === 'train')).loss }, validationLoss: { kind: 'scalar', v: gradients(m, points.filter(p => p.split === 'validation')).loss }, grad: { kind: 'tensor2d', data: m.grad } };
}
export function pixelData(p: Record<string, number>): Matrix { return Array.from({ length: 12 }, (_, i) => Array.from({ length: 12 }, (_, j) => clamp(p[`pixel_${i}_${j}`]! ?? (p.preset === 1 ? (Math.hypot(i - 5.5, j - 5.5) < 4 ? 1 : 0) : p.preset === 2 ? (i === j || i + j === 11 ? 1 : 0) : (j >= 5 && j <= 6 ? 1 : 0)), 0, 1))); }
export function kernelData(p: Record<string, number>): Matrix { const presets = [[0, -1, 0, -1, 4, -1, 0, -1, 0], [0, -1, 0, -1, 5, -1, 0, -1, 0], Array(9).fill(1 / 9)]; return Array.from({ length: 3 }, (_, i) => Array.from({ length: 3 }, (_, j) => clamp(p[`k${i}${j}`]! ?? presets[Math.round(clamp(p.kernel ?? 0, 0, 2))]![i * 3 + j]!, -10, 10))); }
export function deepCoreOutput(node: CanvasNode, input: (port: string) => PortValue | null, portId: string): PortValue | null {
    const p = node.params, a = matrix(input('in'));
    if (node.type === 'dataset2dSource')
        return portId === 'out' ? { kind: 'dataset2d', points: dataset(p.kind, p.samples, p.noise, p.seed) } : null;
    if (node.type === 'pixelGridSource')
        return portId === 'out' ? tensor(pixelData(p)) : null;
    if (node.type === 'tokenSeqSource') {
        const words = (node.text || '我 爱 学习 深度 网络').trim().split(/\s+/).slice(0, 6);
        while (words.length < 4)
            words.push('[pad]');
        return portId === 'out' ? tensor(words.map(word => { let hash = p.seed ?? 7; for (const ch of word)
            hash = Math.imul(hash, 31) + ch.codePointAt(0)!; const random = rng(hash); return Array.from({ length: 4 }, () => random() * 2 - 1); })) : null;
    }
    if (node.type === 'mlpTrainer') {
        const d = input('in');
        return d?.kind === 'dataset2d' ? (trainingOutputs(createModel(p.width, p.seed), d.points) as Record<string, PortValue>)[portId] ?? null : null;
    }
    if (node.type === 'residualJoin') {
        const x = matrix(input('A')), y = matrix(input('B'));
        return portId === 'out' && x && y && x.length === y.length && x[0]!.length === y[0]!.length ? tensor(x.map((r, i) => r.map((v, j) => v + y[i]![j]!))) : null;
    }
    if (!a)
        return null;
    if (node.type === 'activationOp' && ['out', 'derivative'].includes(portId))
        return tensor(a.map(r => r.map(v => activation(v, p.kind)[portId === 'out' ? 0 : 1]!)));
    if (node.type === 'normOp' && portId === 'out')
        return tensor(normalize(a, p.mode ?? 1));
    if (node.type === 'conv2dOp' && portId === 'out') {
        let result = convolution(a, kernelData(p), p.stride, p.padding, !!p.pool);
        if (p.second)
            result = convolution(result, kernelData(p), 1, p.padding, false);
        return tensor(result);
    }
    if (node.type === 'linearOp') {
        const n = Math.round(clamp(p.width ?? 2, 1, 8)), w = weights(a[0]!.length, n, p.seed ?? 7, !!p.orthogonal).map((r, i) => r.map((v, j) => clamp(p[`w${i}_${j}`]! ?? v, -10, 10)));
        if (portId === 'weights')
            return tensor(w);
        return portId === 'out' ? tensor(a.map(r => Array.from({ length: n }, (_, j) => r.reduce((s, v, i) => s + v * w[i]![j]!, p[`b${j}`]! ?? 0)))) : null;
    }
    if (node.type === 'attentionOp' && ['out', 'weights'].includes(portId)) {
        if (a.length > 8)
            return null;
        const d = a[0]!.length, temperature = clamp(p.temperature ?? 1, .05, 5);
        const scores = a.map((q, i) => { const logits = a.map((k, j) => p.causal && j > i ? -Infinity : q.reduce((s, v, u) => s + v * k[u]!, 0) / (p.scaled === 0 ? 1 : Math.sqrt(d)) / temperature); const max = Math.max(...logits), e = logits.map(v => Math.exp(v - max)), sum = e.reduce((s, v) => s + v, 0); return e.map(v => v / sum); });
        return tensor(portId === 'weights' ? scores : scores.map(r => Array.from({ length: d }, (_, j) => r.reduce((s, v, i) => s + v * a[i]![j]!, 0))));
    }
    return null;
}
