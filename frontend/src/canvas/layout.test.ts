import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAutoLayout, applyAutoLayout } from './layout.ts';
import type { CanvasNode, Wire } from './types.ts';

const node = (id: string, type: CanvasNode['type'], x = 0, y = 0): CanvasNode => ({
  id, type, x, y, params: {},
});

test('computeAutoLayout 按拓扑从左到右分层并垂直居中', () => {
  const nodes: CanvasNode[] = [
    node('a', 'pixelGridSource', 10, 10),
    node('b1', 'conv2dOp', 10, 10),
    node('b2', 'conv2dOp', 10, 80),
    node('c', 'matrixHeatmapView', 10, 10),
  ];
  const wires: Wire[] = [
    { id: 'w1', from: 'a', to: 'b1' },
    { id: 'w2', from: 'a', to: 'b2' },
    { id: 'w3', from: 'b1', to: 'c' },
    { id: 'w4', from: 'b2', to: 'c' },
  ];
  const pos = computeAutoLayout(nodes, wires);
  assert.ok(pos.get('a')!.x < pos.get('b1')!.x);
  assert.equal(pos.get('b1')!.x, pos.get('b2')!.x);
  assert.ok(pos.get('b1')!.x < pos.get('c')!.x);
  assert.ok(pos.get('b1')!.y < pos.get('b2')!.y);
  // 单节点列垂直居中于两节点列之间
  const midY = (pos.get('b1')!.y + pos.get('b2')!.y) / 2;
  assert.ok(Math.abs(pos.get('a')!.y - midY) <= 1);
  assert.ok(Math.abs(pos.get('c')!.y - midY) <= 1);
});

test('computeAutoLayout 遇到环和便签时不死循环且输出有限坐标', () => {
  const nodes: CanvasNode[] = [
    node('n1', 'textNote', 0, 0),
    node('a', 'conv2dOp', 0, 0),
    node('b', 'conv2dOp', 0, 50),
  ];
  const wires: Wire[] = [
    { id: 'w1', from: 'a', to: 'b' },
    { id: 'w2', from: 'b', to: 'a' },
  ];
  const laid = applyAutoLayout(nodes, wires);
  assert.equal(laid.length, 3);
  for (const item of laid) {
    assert.ok(Number.isFinite(item.x) && Number.isFinite(item.y));
  }
});
