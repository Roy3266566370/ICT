export type Matrix = number[][];

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
export const finite = (value: number | undefined, fallback: number, min = -1e6, max = 1e6): number =>
  clamp(Number.isFinite(value) ? value! : fallback, min, max);
export const round = (value: number, digits = 3): number => Number(value.toFixed(digits));

export function seeded(seed = 7): () => number {
  let state = Math.max(1, Math.round(seed)) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
}

export function gaussian(random: () => number): number {
  const u = Math.max(1e-12, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

export function softmax(logits: readonly number[]): number[] {
  if (!logits.length) return [];
  const max = Math.max(...logits.map((v) => Number.isFinite(v) ? v : -Infinity));
  if (!Number.isFinite(max)) return logits.map(() => 1 / logits.length);
  const exps = logits.map((v) => Math.exp((Number.isFinite(v) ? v : -Infinity) - max));
  const sum = exps.reduce((total, value) => total + value, 0) || 1;
  return exps.map((value) => value / sum);
}

export function entropy(probabilities: readonly number[]): number {
  return -probabilities.reduce((sum, p) => sum + (p > 1e-12 ? p * Math.log(p) : 0), 0);
}

export function demoLoraMatrix(): Matrix {
  return Array.from({ length: 6 }, (_, row) => Array.from({ length: 6 }, (_, col) =>
    round(Math.sin((row + 1) * (col + 2) * 0.73) + 0.45 * Math.cos((row - col) * 1.1), 3)));
}

export interface DataPoint2D { x: number; y: number; label: 0 | 1; split: 'train' | 'validation' }

export function panoMlpDataset(scenario: number, count = 88, noise = 0.08, seed = 7): DataPoint2D[] {
  const random = seeded(seed + Math.round(scenario) * 977);
  const points: DataPoint2D[] = [];
  for (let i = 0; i < count; i += 1) {
    let x = 0;
    let y = 0;
    let label: 0 | 1 = 0;
    if (scenario === 1) {
      const arm = i % 2;
      const t = random() * Math.PI * 1.55 + 0.25;
      const r = 0.32 + t / (Math.PI * 1.8) + gaussian(random) * noise * 0.35;
      const sign = arm ? 1 : -1;
      x = sign * r * Math.cos(t) + gaussian(random) * noise * 0.35;
      y = sign * r * Math.sin(t) + gaussian(random) * noise * 0.35;
      label = arm as 0 | 1;
    } else {
      x = random() * 4 - 2;
      y = random() * 4 - 2;
      label = ((x > 0 ? 1 : 0) ^ (y > 0 ? 1 : 0)) as 0 | 1;
      if (scenario === 3 && random() < 0.12) label = (1 - label) as 0 | 1;
      x += gaussian(random) * noise;
      y += gaussian(random) * noise;
    }
    points.push({ x, y, label, split: i % 5 === 4 ? 'validation' : 'train' });
  }
  return points;
}

export type ActivationKind = 0 | 1 | 2 | 3;
export function activationValue(kind: number, x: number): { value: number; derivative: number } {
  if (kind === 0) return { value: Math.max(0, x), derivative: x > 0 ? 1 : 0 };
  if (kind === 1) {
    const c = Math.sqrt(2 / Math.PI);
    const t = Math.tanh(c * (x + 0.044715 * x ** 3));
    return { value: 0.5 * x * (1 + t), derivative: 0.5 * (1 + t) + 0.5 * x * (1 - t * t) * c * (1 + 3 * 0.044715 * x * x) };
  }
  if (kind === 2) {
    const value = Math.tanh(x);
    return { value, derivative: 1 - value * value };
  }
  const value = x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
  return { value, derivative: value * (1 - value) };
}

export interface MlpWeights {
  width: number;
  w1: Matrix;
  b1: number[];
  w2: Matrix;
  b2: number[];
  w3: number[];
  b3: number;
}

export interface MlpForward {
  z1: number[];
  a1: number[];
  z2: number[];
  a2: number[];
  z: number;
  probability: number;
}

export interface MlpSnapshot {
  weights: MlpWeights;
  losses: number[];
  validationLosses: number[];
  gradientNorms: number[][];
  accuracy: number;
  validationAccuracy: number;
  points: DataPoint2D[];
}

function initialMlp(width: number, seed: number): MlpWeights {
  const random = seeded(seed);
  const weight = () => gaussian(random) * 0.72;
  return {
    width,
    w1: Array.from({ length: width }, () => [weight(), weight()]),
    b1: Array.from({ length: width }, () => gaussian(random) * 0.08),
    w2: Array.from({ length: width }, () => Array.from({ length: width }, weight)),
    b2: Array.from({ length: width }, () => gaussian(random) * 0.08),
    w3: Array.from({ length: width }, weight),
    b3: 0,
  };
}

export function forwardMlp(weights: MlpWeights, x: number, y: number, activation: number): MlpForward {
  const z1 = weights.w1.map((row, i) => row[0]! * x + row[1]! * y + weights.b1[i]!);
  const a1 = z1.map((z) => activationValue(activation, z).value);
  const z2 = weights.w2.map((row, i) => row.reduce((sum, w, j) => sum + w * a1[j]!, weights.b2[i]!));
  const a2 = z2.map((z) => activationValue(activation, z).value);
  const z = weights.w3.reduce((sum, w, j) => sum + w * a2[j]!, weights.b3);
  return { z1, a1, z2, a2, z, probability: 1 / (1 + Math.exp(-clamp(z, -40, 40))) };
}

function mlpLoss(weights: MlpWeights, points: readonly DataPoint2D[], activation: number, l2: number): number {
  if (!points.length) return 0;
  const data = points.reduce((sum, point) => {
    const p = clamp(forwardMlp(weights, point.x, point.y, activation).probability, 1e-7, 1 - 1e-7);
    return sum - (point.label * Math.log(p) + (1 - point.label) * Math.log(1 - p));
  }, 0) / points.length;
  const squares = [...weights.w1.flat(), ...weights.w2.flat(), ...weights.w3].reduce((sum, value) => sum + value * value, 0);
  return data + l2 * squares / 2;
}

function mlpAccuracy(weights: MlpWeights, points: readonly DataPoint2D[], activation: number): number {
  if (!points.length) return 0;
  return points.filter((point) => (forwardMlp(weights, point.x, point.y, activation).probability >= 0.5 ? 1 : 0) === point.label).length / points.length;
}

function cloneMlp(weights: MlpWeights): MlpWeights {
  return {
    width: weights.width,
    w1: weights.w1.map((row) => [...row]),
    b1: [...weights.b1],
    w2: weights.w2.map((row) => [...row]),
    b2: [...weights.b2],
    w3: [...weights.w3],
    b3: weights.b3,
  };
}

export function trainMlpPanorama(options: {
  scenario: number;
  activation: number;
  width: number;
  lr: number;
  l2: number;
  dropout: number;
  steps: number;
  seed?: number;
}): MlpSnapshot {
  const width = Math.round(finite(options.width, 6, 2, 8));
  const activation = Math.round(finite(options.activation, 2, 0, 3));
  const lr = finite(options.lr, 0.08, 0.001, 0.5);
  const l2 = finite(options.l2, 0, 0, 0.05);
  const dropout = finite(options.dropout, 0, 0, 0.8);
  const steps = Math.round(finite(options.steps, 80, 0, 160));
  const seed = options.seed ?? 17;
  const points = panoMlpDataset(options.scenario, 88, options.scenario === 3 ? 0.12 : 0.07, seed);
  const train = points.filter((point) => point.split === 'train');
  const validation = points.filter((point) => point.split === 'validation');
  const weights = initialMlp(width, seed);
  const losses: number[] = [];
  const validationLosses: number[] = [];
  const gradientNorms: number[][] = [];
  const random = seeded(seed + 991);
  for (let step = 0; step <= steps; step += 1) {
    losses.push(mlpLoss(weights, train, activation, l2));
    validationLosses.push(mlpLoss(weights, validation, activation, 0));
    if (step === steps) break;
    const gW1 = weights.w1.map((row) => row.map(() => 0));
    const gB1 = weights.b1.map(() => 0);
    const gW2 = weights.w2.map((row) => row.map(() => 0));
    const gB2 = weights.b2.map(() => 0);
    const gW3 = weights.w3.map(() => 0);
    let gB3 = 0;
    for (const point of train) {
      const forward = forwardMlp(weights, point.x, point.y, activation);
      const keep1 = forward.a1.map(() => random() >= dropout ? 1 / (1 - dropout || 1) : 0);
      const keep2 = forward.a2.map(() => random() >= dropout ? 1 / (1 - dropout || 1) : 0);
      const a1 = forward.a1.map((value, i) => value * keep1[i]!);
      const a2 = forward.a2.map((value, i) => value * keep2[i]!);
      const delta3 = forward.probability - point.label;
      for (let j = 0; j < width; j += 1) {
        gW3[j]! += delta3 * a2[j]! / train.length;
        const delta2 = delta3 * weights.w3[j]! * activationValue(activation, forward.z2[j]!).derivative * keep2[j]!;
        gB2[j]! += delta2 / train.length;
        for (let k = 0; k < width; k += 1) gW2[j]![k]! += delta2 * a1[k]! / train.length;
      }
      gB3 += delta3 / train.length;
      for (let j = 0; j < width; j += 1) {
        let back = 0;
        for (let k = 0; k < width; k += 1) {
          const delta2 = delta3 * weights.w3[k]! * activationValue(activation, forward.z2[k]!).derivative * keep2[k]!;
          back += delta2 * weights.w2[k]![j]!;
        }
        const delta1 = back * activationValue(activation, forward.z1[j]!).derivative * keep1[j]!;
        gB1[j]! += delta1 / train.length;
        gW1[j]![0]! += delta1 * point.x / train.length;
        gW1[j]![1]! += delta1 * point.y / train.length;
      }
    }
    const norm = (values: number[]) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
    gradientNorms.push([norm(gW1.flat()), norm(gW2.flat()), norm(gW3)]);
    for (let j = 0; j < width; j += 1) {
      for (let k = 0; k < 2; k += 1) weights.w1[j]![k]! -= lr * (gW1[j]![k]! + l2 * weights.w1[j]![k]!);
      weights.b1[j]! -= lr * gB1[j]!;
      for (let k = 0; k < width; k += 1) weights.w2[j]![k]! -= lr * (gW2[j]![k]! + l2 * weights.w2[j]![k]!);
      weights.b2[j]! -= lr * gB2[j]!;
      weights.w3[j]! -= lr * (gW3[j]! + l2 * weights.w3[j]!);
    }
    weights.b3 -= lr * gB3;
  }
  const finalWeights = cloneMlp(weights);
  return {
    weights: finalWeights,
    losses,
    validationLosses,
    gradientNorms,
    accuracy: mlpAccuracy(finalWeights, train, activation),
    validationAccuracy: mlpAccuracy(finalWeights, validation, activation),
    points,
  };
}

export function transformMlpGrid(weights: MlpWeights, activation: number, layer: 1 | 2, resolution = 9): [number, number][][] {
  return Array.from({ length: resolution }, (_, row) => Array.from({ length: resolution }, (_, col) => {
    const x = -2 + col * 4 / (resolution - 1);
    const y = -2 + row * 4 / (resolution - 1);
    const forward = forwardMlp(weights, x, y, activation);
    if (layer === 1) return [forward.a1[0] ?? 0, forward.a1[1] ?? 0];
    return [forward.a2[0] ?? 0, forward.a2[1] ?? 0];
  }));
}

export function cnnInputMatrix(pattern: number): Matrix {
  const kind = Math.round(finite(pattern, 0, 0, 3));
  return Array.from({ length: 12 }, (_, y) => Array.from({ length: 12 }, (_, x) => {
    if (kind === 1) return x === y || x + y === 11 ? 1 : 0;
    if (kind === 2) return x === 2 || x === 9 || y === 2 || y === 9 ? 1 : 0;
    if (kind === 3) return (x >= 4 && x <= 7 && (y === 2 || y === 9)) || (x === 4 && y >= 3 && y <= 8) || (x === 7 && y >= 5 && y <= 8) || (y === 5 && x >= 4 && x <= 7) ? 1 : 0;
    return x >= 5 && x <= 6 ? 1 : 0;
  }));
}

export function conv2dPanorama(input: Matrix, kernel: Matrix, stride = 1, padding = 0): Matrix {
  const rows = input.length;
  const cols = input[0]?.length ?? 0;
  const size = kernel.length;
  const outRows = Math.floor((rows + 2 * padding - size) / stride) + 1;
  const outCols = Math.floor((cols + 2 * padding - size) / stride) + 1;
  if (outRows <= 0 || outCols <= 0) return [];
  return Array.from({ length: outRows }, (_, r) => Array.from({ length: outCols }, (_, c) => {
    let sum = 0;
    for (let u = 0; u < size; u += 1) {
      for (let v = 0; v < size; v += 1) {
        sum += (input[r * stride - padding + u]?.[c * stride - padding + v] ?? 0) * (kernel[u]?.[v] ?? 0);
      }
    }
    return round(sum, 6);
  }));
}

export const CNN_KERNELS: readonly Matrix[] = [
  [[0, -1, 0], [-1, 4, -1], [0, -1, 0]],
  [[-1, -1, -1], [2, 2, 2], [-1, -1, -1]],
  [[1, 0, -1], [1, 0, -1], [1, 0, -1]],
  Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => 1 / 9)),
];

export interface AttentionPanoramaResult {
  tokens: string[];
  raw: Matrix;
  scaled: Matrix;
  unscaled: Matrix;
  headLocal: Matrix;
  headLong: Matrix;
  rope: Matrix;
}

export function transformerPanorama(dk: number, offset = 0, ropeMode = 1): AttentionPanoramaResult {
  const tokens = ['小猫', '追', '毛线球', '因为', '它', '滚落'];
  const base: Matrix = [
    [0.3, 0.7, 0.3, 0.0, 0.1, 0.1],
    [1.0, 0.4, 1.0, 0.0, 0.2, 0.4],
    [0.6, 0.9, 0.5, 0.1, 0.6, 0.8],
    [0.0, 0.0, 0.4, 0.2, 0.8, 0.7],
    [0.2, 0.3, 2.8, 0.5, 0.4, 1.2],
    [0.1, 0.6, 1.4, 0.5, 0.9, 0.4],
  ];
  const dim = Math.round(finite(dk, 16, 2, 64));
  const scale = Math.sqrt(dim) / 4;
  const raw = base.map((row, i) => row.map((value, j) => {
    const distance = Math.abs(i - j);
    const positional = ropeMode ? Math.cos((i - j + offset) * 0.42) * 0.32 : Math.sin((i + offset + 1) / 2.7) * Math.cos((j + offset + 1) / 3.1) * 0.28;
    return value * scale + positional - distance * 0.03;
  }));
  const scaled = raw.map((row) => softmax(row.map((value) => value / Math.sqrt(dim))));
  const unscaled = raw.map((row) => softmax(row));
  const local = raw.map((row, i) => softmax(row.map((value, j) => value / Math.sqrt(dim) - Math.abs(i - j) * 0.9)));
  const long = raw.map((row, i) => softmax(row.map((value, j) => value / Math.sqrt(dim) + (i === 4 && j === 2 ? 1.4 : 0) + (i === 5 && j === 2 ? 0.8 : 0))));
  const rope = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => Math.cos((i - j) * 0.55)));
  return { tokens, raw, scaled, unscaled, headLocal: local, headLong: long, rope };
}

export interface DiffusionTrajectory {
  frames: Matrix[];
  logDensity: number[];
  alphaBar: number[];
  mixture: { centers: Matrix; variance: number };
}

export function diffusionCenters(scenario: number): Matrix {
  if (scenario === 2 || scenario === 3) {
    return Array.from({ length: 60 }, (_, i) => {
      const angle = 1 + i / 59 * 3 * Math.PI;
      return [0.18 * angle * Math.cos(angle), 0.18 * angle * Math.sin(angle)];
    });
  }
  return [[-1.35, -0.15], [1.35, 0.15]];
}

export function diffusionScore(point: readonly number[], t: number, centers: Matrix, variance = 0.06, beta = 3): { score: [number, number]; logDensity: number; alpha: number } {
  const time = finite(t, 0, 0, 4);
  const alpha = Math.exp(-beta * time);
  const s = alpha * variance + 1 - alpha;
  const means = centers.map((center) => [Math.sqrt(alpha) * center[0]!, Math.sqrt(alpha) * center[1]!]);
  const logs = means.map((center) => -((point[0]! - center[0]!) ** 2 + (point[1]! - center[1]!) ** 2) / (2 * s));
  const weights = softmax(logs);
  const max = Math.max(...logs);
  const logDensity = max + Math.log(logs.reduce((sum, value) => sum + Math.exp(value - max), 0)) - Math.log(centers.length * 2 * Math.PI * s);
  return {
    score: [0, 1].map((axis) => means.reduce((sum, center, index) => sum + weights[index]! * (center[axis]! - point[axis]!) / s, 0)) as [number, number],
    logDensity,
    alpha,
  };
}

export function diffusionTrajectory(options: { scenario: number; steps: number; seed?: number; beta?: number }): DiffusionTrajectory {
  const centers = diffusionCenters(options.scenario);
  const variance = centers.length > 2 ? 0.025 : 0.16;
  const beta = finite(options.beta, 3, 1, 5);
  const steps = Math.round(finite(options.steps, 32, 8, 48));
  const random = seeded(options.seed ?? 23);
  const count = 180;
  let current: Matrix = Array.from({ length: count }, () => [gaussian(random) * 1.15, gaussian(random) * 1.15]);
  const frames: Matrix[] = [current.map((point) => [...point])];
  const logDensity: number[] = [];
  const alphaBar: number[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = 4 * (1 - step / steps);
    const stats = current.map((point) => diffusionScore(point, t, centers, variance, beta));
    logDensity.push(stats.reduce((sum, item) => sum + item.logDensity, 0) / stats.length);
    alphaBar.push(Math.exp(-beta * t));
    if (step < steps) {
      const dt = 4 / steps;
      current = current.map((point, index) => {
        const score = stats[index]!.score;
        return [point[0]! + 1.5 * dt * (point[0]! + score[0]), point[1]! + 1.5 * dt * (point[1]! + score[1])];
      });
      frames.push(current.map((point) => [...point]));
    }
  }
  return { frames, logDensity, alphaBar, mixture: { centers, variance } };
}

export interface RlSnapshot {
  table: Matrix;
  policy: Matrix;
  returns: number[];
  steps: number[];
  lastPath: number[];
  values: Matrix;
}

const RL_START = 30;
const RL_GOAL = 35;
export function rlTransition(state: number, action: number): { next: number; reward: number; done: boolean } {
  const row = Math.floor(state / 6);
  const col = state % 6;
  const offsets = [[-1, 0], [0, 1], [1, 0], [0, -1]];
  const d = offsets[Math.round(finite(action, 0, 0, 3))]!;
  const nextRow = clamp(row + d[0]!, 0, 5);
  const nextCol = clamp(col + d[1]!, 0, 5);
  const next = nextRow * 6 + nextCol;
  if (next > 30 && next < 35) return { next: RL_START, reward: -100, done: false };
  return { next, reward: next === RL_GOAL ? 20 : -1, done: next === RL_GOAL };
}

export function trainRlPanorama(options: { episodes: number; alpha: number; gamma: number; epsilon: number; reinforce: number; seed?: number }): RlSnapshot {
  const random = seeded(options.seed ?? 31);
  const episodes = Math.round(finite(options.episodes, 30, 1, 180));
  const alpha = finite(options.alpha, 0.15, 0.001, 1);
  const gamma = finite(options.gamma, 0.95, 0, 1);
  const epsilon = finite(options.epsilon, 0.2, 0, 1);
  const reinforce = options.reinforce >= 0.5;
  const table = Array.from({ length: 36 }, () => [0, 0, 0, 0]);
  const returns: number[] = [];
  const steps: number[] = [];
  let lastPath = [RL_START];
  const draw = (probabilities: number[]) => {
    const u = random();
    let cumulative = 0;
    for (let i = 0; i < probabilities.length; i += 1) {
      cumulative += probabilities[i]!;
      if (u < cumulative) return i;
    }
    return probabilities.length - 1;
  };
  for (let episode = 0; episode < episodes; episode += 1) {
    let state = RL_START;
    let total = 0;
    const path = [state];
    const trajectory: { state: number; action: number; reward: number; probabilities: number[] }[] = [];
    for (let step = 0; step < 200; step += 1) {
      const probabilities = softmax(table[state]!);
      const max = Math.max(...table[state]!);
      const ties = table[state]!.map((value, action) => value === max ? action : -1).filter((action) => action >= 0);
      const action = reinforce ? draw(probabilities) : random() < epsilon ? Math.floor(random() * 4) : ties[Math.floor(random() * ties.length)]!;
      const transition = rlTransition(state, action);
      trajectory.push({ state, action, reward: transition.reward, probabilities });
      if (!reinforce) {
        const nextMax = Math.max(...table[transition.next]!);
        table[state]![action]! += alpha * (transition.reward + (transition.done ? 0 : gamma * nextMax) - table[state]![action]!);
      }
      total += transition.reward;
      state = transition.next;
      path.push(state);
      if (transition.done) break;
    }
    if (reinforce) {
      let g = 0;
      const gradient = table.map((row) => row.map(() => 0));
      for (let index = trajectory.length - 1; index >= 0; index -= 1) {
        const item = trajectory[index]!;
        g = item.reward + gamma * g;
        item.probabilities.forEach((p, action) => {
          gradient[item.state]![action]! += gamma ** index * g * (Number(action === item.action) - p);
        });
      }
      table.forEach((row, stateIndex) => row.forEach((value, action) => {
        table[stateIndex]![action] = clamp(value + alpha * (gradient[stateIndex]?.[action] ?? 0) / 100, -30, 30);
      }));
    }
    returns.push(total);
    steps.push(trajectory.length);
    lastPath = path;
  }
  const policy = table.map((row) => reinforce ? softmax(row) : row);
  const values = Array.from({ length: 6 }, (_, row) => Array.from({ length: 6 }, (_, col) => Math.max(...policy[row * 6 + col]!)));
  return { table, policy, returns, steps, lastPath, values };
}

export function allFinite(values: readonly unknown[]): boolean {
  return values.every((value) => {
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return allFinite(value);
    return true;
  });
}

const mlpSnapshotCache = new Map<string, MlpSnapshot>();
export function trainMlpPanoramaCached(options: {
  scenario: number;
  activation: number;
  width: number;
  lr: number;
  l2: number;
  dropout: number;
  steps: number;
  seed?: number;
}): MlpSnapshot {
  const key = JSON.stringify(options);
  const cached = mlpSnapshotCache.get(key);
  if (cached) return cached;
  const snapshot = trainMlpPanorama(options);
  if (mlpSnapshotCache.size > 160) mlpSnapshotCache.delete(mlpSnapshotCache.keys().next().value!);
  mlpSnapshotCache.set(key, snapshot);
  return snapshot;
}

const rlSnapshotCache = new Map<string, RlSnapshot>();
export function trainRlPanoramaCached(options: { episodes: number; alpha: number; gamma: number; epsilon: number; reinforce: number; seed?: number }): RlSnapshot {
  const key = JSON.stringify(options);
  const cached = rlSnapshotCache.get(key);
  if (cached) return cached;
  const snapshot = trainRlPanorama(options);
  if (rlSnapshotCache.size > 160) rlSnapshotCache.delete(rlSnapshotCache.keys().next().value!);
  rlSnapshotCache.set(key, snapshot);
  return snapshot;
}

const diffusionTrajectoryCache = new Map<string, DiffusionTrajectory>();
export function diffusionTrajectoryCached(options: { scenario: number; steps: number; seed?: number; beta?: number }): DiffusionTrajectory {
  const key = JSON.stringify(options);
  const cached = diffusionTrajectoryCache.get(key);
  if (cached) return cached;
  const trajectory = diffusionTrajectory(options);
  if (diffusionTrajectoryCache.size > 80) diffusionTrajectoryCache.delete(diffusionTrajectoryCache.keys().next().value!);
  diffusionTrajectoryCache.set(key, trajectory);
  return trajectory;
}
