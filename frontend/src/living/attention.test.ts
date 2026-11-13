import assert from 'node:assert/strict';
import test from 'node:test';
import { attention } from './attention.ts';

test('注意力权重归一化且输出等于 value 的加权和', () => {
  const { weights, output } = attention(1, 1, false);
  assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.equal(output[0], weights[0] + weights[2]);
  assert.equal(output[1], weights[1] + weights[2]);
});
test('因果掩码排除未来位置，低温度集中权重，极端滑块值保持有限', () => {
  assert.equal(attention(1, 1, true).weights[2], 0);
  assert.ok(Math.max(...attention(3, 0.1, false).weights) > Math.max(...attention(3, 3, false).weights));
  for (const q of [-4, 4]) for (const t of [0.1, 3]) {
    assert.ok(attention(q, t, false).output.every(Number.isFinite));
  }
});
