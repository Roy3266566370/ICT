import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fromXY,
  layeredLayout,
  reachSets,
  stepOrder,
  toXY,
  type DiagramDoc,
} from './diagram.ts';

const doc: DiagramDoc = {
  version: 1,
  nodes: [
    { id: 'a', label: '开始', x: 0.2, y: 0.2, shape: 'oval' },
    { id: 'b', label: '处理', x: 0.5, y: 0.5, shape: 'rect' },
    { id: 'c', label: '判断', x: 0.8, y: 0.5, shape: 'diamond' },
    { id: 'd', label: '结束', x: 0.8, y: 0.8, shape: 'oval' },
  ],
  edges: [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'd' },
    { from: 'c', to: 'b' },
  ],
  order: ['a', 'b', 'c', 'd'],
  confidence: 0.8,
  warnings: [],
};

test('上下游高亮：祖先与后继 BFS', () => {
  const { up, down } = reachSets(doc, 'b');
  assert.deepEqual([...up].sort(), ['a', 'c'], 'c→b 回边使 c 也是上游');
  assert.deepEqual([...down].sort(), ['c', 'd'].sort());
  const { up: upD, down: downD } = reachSets(doc, 'd');
  assert.deepEqual([...downD], []);
  assert.ok(upD.has('c') && upD.has('b') && upD.has('a'), '环不应卡死遍历');
});

test('单步顺序：order 优先，缺失按 (y,x) 排序', () => {
  assert.deepEqual(stepOrder(doc), ['a', 'b', 'c', 'd']);
  const unordered: DiagramDoc = {
    ...doc, order: ['a', 'ghost'],
    nodes: [
      { id: 'b', label: '', x: 0.9, y: 0.9, shape: 'rect' },
      { id: 'a', label: '', x: 0.1, y: 0.1, shape: 'rect' },
    ],
  };
  assert.deepEqual(stepOrder(unordered), ['a', 'b'], '无效 order 回退排序');
});

test('分层布局：拓扑深度 → 列', () => {
  const pos = layeredLayout(doc);
  // a→b→c→d 链 + c→b 回边：a 在第 0 列，d 最深
  assert.ok(pos.a!.x < pos.d!.x, '下游应在更右列');
  assert.ok(pos.c!.x > pos.a!.x);
  for (const p of Object.values(pos)) {
    assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1, '坐标应归一化');
  }
});

test('归一化坐标 ⇄ 像素换算互逆', () => {
  const node = doc.nodes[0]!;
  const px = toXY(node);
  const back = fromXY(px.x, px.y);
  assert.ok(Math.abs(back.x - node.x) < 1e-6 && Math.abs(back.y - node.y) < 1e-6);
  const clamped = fromXY(-500, 9999);
  assert.deepEqual(clamped, { x: 0, y: 1 });
});
