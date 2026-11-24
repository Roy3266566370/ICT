import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loraApprox,
  lossProbe,
  quantizeMatrix,
  sampleDistribution,
  sanitizeMatrix,
} from './deepModernBlocks.ts';

test('损失对比器给出三类损失、梯度与曲线', () => {
  const result = lossProbe([0.7, 0.2, 0.1], 0, 2);
  assert.equal(result.probabilities.length, 3);
  assert.ok(Math.abs(result.losses.ce + Math.log(0.7)) < 1e-9);
  assert.ok(result.losses.focal < result.losses.ce);
  assert.ok(result.losses.mse > 0);
  assert.equal(result.curve.length, 40);
  assert.ok(result.curve.every((point) => Number.isFinite(point.ce) && Number.isFinite(point.mse)));
  assert.ok(Number.isFinite(result.gradients.ce));
  const logits = lossProbe([2, 1, 0], 1, 2);
  assert.ok(Math.abs(logits.probabilities.reduce((sum, value) => sum + value, 0) - 1) < 1e-9);
});

test('LoRA 低秩近似压缩参数并降低重构误差', () => {
  const matrix = [
    [1.2, 0.4, -0.3],
    [0.8, 0.1, 0.2],
    [-0.4, 0.6, 0.9],
    [0.3, -0.7, 0.5],
  ];
  const full = loraApprox(matrix, 3);
  assert.ok(full.error < 1e-8);
  assert.equal(full.adapterParams, 3 * (4 + 3));
  const low = loraApprox(matrix, 1);
  assert.equal(low.rank, 1);
  assert.equal(low.adapterParams, 7);
  assert.ok(low.compression < 1);
  assert.ok(low.error >= full.error);
  assert.ok(low.approx.every((row) => row.every(Number.isFinite)));
  const single = loraApprox([[2]], 1);
  assert.ok(Math.abs((single.approx[0]?.[0] ?? 0) - 2) < 1e-9);
});

test('量化探针保持 FP32 精确并给出 INT8/INT4 误差与显存', () => {
  const matrix = [[-1, -0.5], [0, 1]];
  const fp32 = quantizeMatrix(matrix, 0);
  assert.deepEqual(fp32.quantized, matrix);
  assert.equal(fp32.maxError, 0);
  assert.equal(fp32.memoryBytes, 16);
  const int8 = quantizeMatrix(matrix, 2);
  assert.equal(int8.bits, 8);
  assert.ok(int8.maxError <= (1 / 127) / 2 + 1e-9);
  assert.ok(int8.memoryBytes < fp32.memoryBytes);
  const int4 = quantizeMatrix(matrix, 3);
  assert.equal(int4.bits, 4);
  assert.ok(int4.maxError > int8.maxError);
  assert.ok(int4.compression > int8.compression);
  assert.deepEqual(quantizeMatrix([[0, 0]], 2).quantized, [[0, 0]]);
});

test('采样解码器应用温度、Top-K 与 Top-P 并归一化', () => {
  const result = sampleDistribution([2, 1, 0, -1], 1, 2, 0.9);
  assert.ok(result.keptCount <= 2);
  assert.ok(Math.abs(result.tokens.reduce((sum, item) => sum + item.probability, 0) - 1) < 1e-9);
  assert.ok(result.tokens.every((item) => !item.kept || item.probability > 0));
  const cold = sampleDistribution([2, 1, 0, -1], 0.1, 4, 1);
  const warm = sampleDistribution([2, 1, 0, -1], 2, 4, 1);
  const maxCold = Math.max(...cold.tokens.map((item) => item.probability));
  const maxWarm = Math.max(...warm.tokens.map((item) => item.probability));
  assert.ok(maxCold > maxWarm);
  assert.equal(sampleDistribution([1, 2], 1, 99, 1).keptCount, 2);
  assert.equal(sanitizeMatrix([[1, Number.NaN]]), null);
  assert.deepEqual(sanitizeMatrix([[1, 2]]), [[1, 2]]);
});
