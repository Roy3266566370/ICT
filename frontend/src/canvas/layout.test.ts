import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyAutoLayout,
  computeContentBounds,
  computeOptimalViewport,
  type NodeBoxSize,
} from './layout.ts';
import type { CanvasNode, Wire } from './types.ts';

const node = (id: string, type: CanvasNode['type'], x: number, y: number): CanvasNode => ({
  id,
  type,
  x,
  y,
  params: {},
});

test('layout: 按真实宽高紧凑排布，大视图不会撑爆小滑杆间距', () => {
  const nodes: CanvasNode[] = [
    node('s1', 'slider', 500, 300),
    node('s2', 'slider', 500, 100),
    node('v1', 'transformView', 100, 200),
  ];
  const wires: Wire[] = [
    { id: 'w1', from: 's1', to: 'v1' },
    { id: 'w2', from: 's2', to: 'v1' },
  ];
  const nodeSizes = new Map<string, NodeBoxSize>([
    ['s1', { w: 200, h: 90 }],
    ['s2', { w: 200, h: 90 }],
    ['v1', { w: 560, h: 420 }],
  ]);

  const laid = applyAutoLayout(nodes, wires, { nodeSizes, gapX: 70, gapY: 28 });
  const byId = new Map(laid.map((n) => [n.id, n]));

  // 第 0 列宽度应由滑杆决定（200），而不是被第 1 列的大视图（560）撑宽
  assert.equal(byId.get('v1')!.x - byId.get('s2')!.x, 200 + 70);
  // 两个小滑杆之间间距为 28，而不是 420
  assert.equal(byId.get('s1')!.y - (byId.get('s2')!.y + 90), 28);
});

test('layout: 多组独立实验自动分泳道纵向排布，且 Sugiyama 重心法解开连线交叉', () => {
  // 实验 1：两对交叉连线（a1->b2, a2->b1），重心法应自动交换 b1/b2 消除交叉
  const nodes: CanvasNode[] = [
    node('a1', 'slider', 0, 10),
    node('a2', 'slider', 0, 200),
    node('b1', 'rotor', 200, 10),
    node('b2', 'rotor', 200, 200),
    // 实验 2：独立泳道
    node('p1', 'projectile', 50, 500),
    node('p2', 'trailView', 300, 500),
  ];
  const wires: Wire[] = [
    { id: 'w1', from: 'a1', to: 'b2' },
    { id: 'w2', from: 'a2', to: 'b1' },
    { id: 'w3', from: 'p1', to: 'p2' },
  ];
  const laid = applyAutoLayout(nodes, wires, { cardWidth: 200, cardHeight: 100 });
  const byId = new Map(laid.map((n) => [n.id, n]));

  // a1 在 a2 上方，b2 应被排到 b1 上方，消除交叉
  assert.ok(byId.get('a1')!.y < byId.get('a2')!.y);
  assert.ok(byId.get('b2')!.y < byId.get('b1')!.y);

  // 实验 2 泳道整体位于实验 1 下方，互不重叠
  const lane1Bottom = Math.max(byId.get('a2')!.y, byId.get('b1')!.y) + 100;
  assert.ok(byId.get('p1')!.y > lane1Bottom);
  assert.ok(byId.get('p2')!.x > byId.get('p1')!.x);
});

test('layout: delayRegister 反馈环按前向数据流分层展开，不挤在同一列', () => {
  const nodes: CanvasNode[] = [
    node('reg', 'delayRegister', 0, 0),
    node('op', 'rotor', 0, 0),
    node('view', 'fieldView', 0, 0),
  ];
  const wires: Wire[] = [
    { id: 'w1', from: 'reg', to: 'op' },
    { id: 'w2', from: 'op', to: 'view' },
    { id: 'w_fb', from: 'op', to: 'reg', toPort: 'next' },
  ];
  const laid = applyAutoLayout(nodes, wires, { cardWidth: 200, cardHeight: 100 });
  const byId = new Map(laid.map((n) => [n.id, n]));
  assert.ok(byId.get('reg')!.x < byId.get('op')!.x);
  assert.ok(byId.get('op')!.x < byId.get('view')!.x);
});

test('computeOptimalViewport: 扣除右侧检查器抽屉与底部工具坞后精确居中可见安全区', () => {
  const bounds = computeContentBounds(
    [{ left: 100, top: 100, right: 900, bottom: 500 }],
    [{ id: 's1', color: '#000', width: 2, points: [[950, 520], [1000, 560]] }],
  );
  assert.deepEqual(bounds, { left: 100, top: 100, right: 1000, bottom: 560 });

  const vp = computeOptimalViewport(bounds!, 1400, 800, { top: 40, bottom: 80, left: 32, right: 360 });
  // 可见安全区中心：x = 32 + (1400 - 392) / 2 = 536，y = 40 + (800 - 120) / 2 = 380
  const renderedCenterX = vp.pan.x + ((100 + 1000) / 2) * vp.zoom;
  const renderedCenterY = vp.pan.y + ((100 + 560) / 2) * vp.zoom;
  assert.ok(Math.abs(renderedCenterX - 536) <= 2);
  assert.ok(Math.abs(renderedCenterY - 380) <= 2);
  assert.ok(vp.zoom > 0.5 && vp.zoom <= 1.05);
});
