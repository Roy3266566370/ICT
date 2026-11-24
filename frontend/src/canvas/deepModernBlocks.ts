/** 深度学习现代机制积木：损失对比、LoRA 低秩近似、量化与采样解码。 */

import { makeSeries, type SeriesValue } from './officeBlocks.ts';

export type Matrix = number[][];

export const DEFAULT_LOSS_PREDICTIONS = [0.55, 0.25, 0.15, 0.05];
export const DEFAULT_LORA_MATRIX: Matrix = [
  [1.2, 0.4, -0.3, 0.2],
  [0.8, 0.1, 0.2, -0.5],
  [-0.4, 0.6, 0.9, 0.3],
  [0.3, -0.7, 0.5, 0.8],
];
export const DEFAULT_QUANT_MATRIX: Matrix = [
  [-1.4, -0.6, 0.2, 1.1],
  [-0.2, 0.4, 0.8, 1.6],
];
export const DEFAULT_LOGITS = [2.4, 1.8, 1.1, 0.5, -0.2, -0.9];

export function probabilityVector(matrix: Matrix | null | undefined): number[] {
  if (!matrix?.length || !matrix[0]?.length) return [...DEFAULT_LOSS_PREDICTIONS];
  if (matrix.length === 1) return [...matrix[0]];
  if (matrix[0].length === 1) return matrix.map((row) => row[0] ?? 0);
  return matrix[0].map((_, col) => matrix.reduce((sum, row) => sum + (row[col] ?? 0), 0) / matrix.length);
}

export function sanitizeMatrix(matrix: Matrix | null | undefined, maxSize = 16): Matrix | null {
  if (!Array.isArray(matrix) || !matrix.length || matrix.length > maxSize) return null;
  const width = matrix[0]?.length ?? 0;
  if (!width || width > maxSize || matrix.some((row) => !Array.isArray(row) || row.length !== width)) return null;
  if (!matrix.every((row) => row.every(Number.isFinite))) return null;
  return matrix.map((row) => row.map((value) => Math.max(-1e6, Math.min(1e6, value))));
}

function softmax(logits: readonly number[], temperature = 1): number[] {
  const safe = logits.map((value) => Number.isFinite(value) ? value / Math.max(0.02, temperature) : -700);
  const max = Math.max(...safe);
  const exps = safe.map((value) => Math.exp(value - max));
  const sum = exps.reduce((total, value) => total + value, 0) || 1;
  return exps.map((value) => value / sum);
}

export interface LossProbeResult {
  probabilities: number[];
  losses: { mse: number; ce: number; focal: number };
  gradients: { mse: number; ce: number; focal: number };
  curve: { p: number; mse: number; ce: number; focal: number }[];
}

function lossAt(probability: number, classes: number, gamma: number): { mse: number; ce: number; focal: number } {
  const p = Math.max(1e-6, Math.min(1, probability));
  const other = classes > 1 ? Math.max(0, 1 - p) / (classes - 1) : 0;
  const mse = ((1 - p) ** 2 + (classes - 1) * other ** 2) / Math.max(1, classes);
  const ce = -Math.log(p);
  return { mse, ce, focal: (1 - p) ** gamma * ce };
}

export function lossProbe(predictions: readonly number[], target: number, gamma = 2): LossProbeResult {
  const classes = Math.max(1, Math.min(16, predictions.length || 1));
  const safe = Array.from({ length: classes }, (_, index) => Number.isFinite(predictions[index]) ? predictions[index]! : 0);
  const sum = safe.reduce((total, value) => total + value, 0);
  const probabilities = safe.every((value) => value >= 0 && value <= 1) && Math.abs(sum - 1) < 1e-3
    ? safe.map((value) => value / (sum || 1))
    : softmax(safe, 1);
  const index = Math.max(0, Math.min(classes - 1, Math.round(target)));
  const p = Math.max(1e-6, probabilities[index] ?? 1 / classes);
  const losses = lossAt(p, classes, Math.max(0.1, gamma));
  const gradients = {
    mse: 2 * (p - 1) / classes,
    ce: -1 / p,
    focal: -((1 - p) ** Math.max(0.1, gamma)) * (1 / p) + Math.max(0.1, gamma) * (1 - p) ** (Math.max(0.1, gamma) - 1) * Math.log(p),
  };
  const curve = Array.from({ length: 40 }, (_, step) => {
    const probability = 0.01 + step / 39 * 0.98;
    return { p: probability, ...lossAt(probability, classes, Math.max(0.1, gamma)) };
  });
  return { probabilities, losses, gradients, curve };
}

export function lossCurveSeries(result: LossProbeResult): SeriesValue {
  const labels = result.curve.map((point) => point.p.toFixed(2));
  return makeSeries('损失曲线', labels, result.curve.map((point) => point.ce), [
    { name: 'MSE', values: result.curve.map((point) => point.mse) },
    { name: 'Focal', values: result.curve.map((point) => point.focal) },
  ]);
}

function jacobiEigen(matrix: number[][]): { values: number[]; vectors: number[][] } {
  const n = matrix.length;
  if (n <= 1) return { values: [Math.max(0, matrix[0]?.[0] ?? 0)], vectors: [[1]] };
  const a = matrix.map((row) => [...row]);
  const v: number[][] = Array.from({ length: n }, (_, row) => Array.from({ length: n }, (_, col) => row === col ? 1 : 0));
  for (let sweep = 0; sweep < 80; sweep += 1) {
    let p = 0;
    let q = 1;
    let max = 0;
    for (let row = 0; row < n; row += 1) {
      for (let col = row + 1; col < n; col += 1) {
        const value = Math.abs(a[row]![col]!);
        if (value > max) { max = value; p = row; q = col; }
      }
    }
    if (max < 1e-11) break;
    const app = a[p]![p]!;
    const aqq = a[q]![q]!;
    const apq = a[p]![q]!;
    const angle = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    for (let k = 0; k < n; k += 1) {
      if (k === p || k === q) continue;
      const akp = a[k]![p]!;
      const akq = a[k]![q]!;
      a[k]![p] = c * akp - s * akq;
      a[p]![k] = a[k]![p]!;
      a[k]![q] = s * akp + c * akq;
      a[q]![k] = a[k]![q]!;
    }
    a[p]![p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    a[q]![q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    a[p]![q] = 0;
    a[q]![p] = 0;
    for (let k = 0; k < n; k += 1) {
      const vkp = v[k]![p]!;
      const vkq = v[k]![q]!;
      v[k]![p] = c * vkp - s * vkq;
      v[k]![q] = s * vkp + c * vkq;
    }
  }
  const order = Array.from({ length: n }, (_, index) => index).sort((left, right) => a[right]![right]! - a[left]![left]!);
  return {
    values: order.map((index) => Math.max(0, a[index]![index]!)),
    vectors: Array.from({ length: n }, (_, row) => order.map((index) => v[row]![index]!)),
  };
}

function frobenius(matrix: Matrix): number {
  return Math.sqrt(matrix.reduce((sum, row) => sum + row.reduce((rowSum, value) => rowSum + value * value, 0), 0));
}

export interface LoraResult {
  approx: Matrix;
  error: number;
  rank: number;
  originalParams: number;
  adapterParams: number;
  compression: number;
}

export function loraApprox(matrix: Matrix, rank: number): LoraResult {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  const maxRank = Math.min(rows, cols);
  const r = Math.max(1, Math.min(maxRank, Math.round(rank)));
  const ata = Array.from({ length: cols }, (_, i) => Array.from({ length: cols }, (_, j) => {
    let sum = 0;
    for (let row = 0; row < rows; row += 1) sum += (matrix[row]![i] ?? 0) * (matrix[row]![j] ?? 0);
    return sum;
  }));
  const eigen = jacobiEigen(ata);
  const approx = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let component = 0; component < r; component += 1) {
    const sigma = Math.sqrt(eigen.values[component] ?? 0);
    if (sigma < 1e-10) continue;
    const vector = Array.from({ length: cols }, (_, row) => eigen.vectors[row]![component] ?? 0);
    const u = Array.from({ length: rows }, (_, row) => {
      let sum = 0;
      for (let col = 0; col < cols; col += 1) sum += (matrix[row]![col] ?? 0) * (vector[col] ?? 0);
      return sum / sigma;
    });
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        approx[row]![col] += sigma * (u[row] ?? 0) * (vector[col] ?? 0);
      }
    }
  }
  const difference = approx.map((row, rowIndex) => row.map((value, colIndex) => value - (matrix[rowIndex]![colIndex] ?? 0)));
  const error = frobenius(difference) / Math.max(1e-9, frobenius(matrix));
  const originalParams = rows * cols;
  const adapterParams = r * (rows + cols);
  return { approx, error: Number.isFinite(error) ? error : 0, rank: r, originalParams, adapterParams, compression: adapterParams / Math.max(1, originalParams) };
}

export interface QuantResult {
  quantized: Matrix;
  maxError: number;
  meanError: number;
  bits: number;
  memoryBytes: number;
  compression: number;
}

export function quantizeMatrix(matrix: Matrix, mode: number): QuantResult {
  const precision = Math.round(Math.max(0, Math.min(3, mode)));
  const bits = [32, 16, 8, 4][precision] ?? 32;
  const maxAbs = Math.max(1e-9, ...matrix.flat().map(Math.abs));
  const levels = precision === 2 ? 127 : precision === 3 ? 7 : 0;
  const errors: number[] = [];
  const quantized = matrix.map((row) => row.map((value) => {
    let next = value;
    if (precision === 1) next = Math.round(value * 1024) / 1024;
    else if (levels > 0) {
      const scale = maxAbs / levels;
      next = Math.round(value / scale) * scale;
    }
    errors.push(Math.abs(next - value));
    return Number.isFinite(next) ? Math.max(-1e6, Math.min(1e6, next)) : 0;
  }));
  const count = matrix.length * (matrix[0]?.length ?? 0);
  return {
    quantized,
    maxError: Math.max(0, ...errors),
    meanError: errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : 0,
    bits,
    memoryBytes: count * bits / 8,
    compression: 32 / bits,
  };
}

export interface SamplingToken {
  token: number;
  logit: number;
  probability: number;
  kept: boolean;
}

export interface SamplingResult {
  tokens: SamplingToken[];
  keptCount: number;
  temperature: number;
}

export function sampleDistribution(logits: readonly number[], temperature: number, topK: number, topP: number): SamplingResult {
  const length = Math.max(1, Math.min(32, logits.length || 1));
  const safe = Array.from({ length }, (_, index) => Number.isFinite(logits[index]) ? logits[index]! : -20);
  const temp = Math.max(0.05, Math.min(3, temperature));
  const probabilities = softmax(safe, temp);
  const sorted = probabilities.map((probability, token) => ({ token, logit: safe[token]!, probability, kept: false }))
    .sort((left, right) => right.probability - left.probability);
  const k = Math.max(1, Math.min(length, Math.round(topK)));
  const p = Math.max(0.01, Math.min(1, topP));
  let cumulative = 0;
  let keptCount = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const item = sorted[index]!;
    if (index >= k) break;
    item.kept = true;
    cumulative += item.probability;
    keptCount += 1;
    if (cumulative >= p) break;
  }
  const keptTotal = sorted.filter((item) => item.kept).reduce((sum, item) => sum + item.probability, 0) || 1;
  for (const item of sorted) {
    item.probability = item.kept ? item.probability / keptTotal : 0;
  }
  return { tokens: sorted.sort((left, right) => left.token - right.token), keptCount, temperature: temp };
}

export function samplingSeries(result: SamplingResult): SeriesValue {
  return makeSeries('采样概率', result.tokens.map((item) => `#${item.token}`), result.tokens.map((item) => item.probability));
}
