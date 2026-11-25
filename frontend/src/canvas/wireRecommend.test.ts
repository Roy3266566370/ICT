import test from 'node:test';
import assert from 'node:assert/strict';
import type { NodeDef } from './nodes.tsx';
import type { CanvasNode, NodeType, PortSpec, ValueKind } from './types.ts';
import { compatiblePorts, filterWireRecommendations, recommendNodesForPort } from './wireRecommend.ts';
import { pipelinePorts } from './lab408Pipeline.ts';

function def(title: string, badge: NodeDef['badge'], ...inputs: PortSpec[]): NodeDef {
  return { title, badge, width: 200, inputs, Body: () => null };
}

const source: CanvasNode = { id: 'source', type: 'slider', x: 0, y: 0, params: {} };
const defs = {
  aiRuleBlock: def('自建积木', '实验', { id: 'in', label: '上游数据' }),
  trailView: def('轨迹图', '视图', { id: 'in', label: '位置', kind: 'body' }),
  universalStageView: def('通用舞台', '视图', { id: 'in', label: '实验数据', kind: 'customFrames' }),
  transformView: def('线性变换图', '视图', { id: 'in', label: '矩阵', kind: 'matrix2' }),
  spark: def('数值走势', '视图', { id: 'in', label: '标量', kind: 'scalar' }),
  bizWaterfallView: def('曲线', '视图', { id: 'in', label: '序列', kind: 'series' }),
  composite: def('内部节点', '变换', { id: 'in', label: '内部' }),
} as Partial<Record<NodeType, NodeDef>>;

test('精确匹配排在通用输入之前，推荐均可接线并可搜索端口名', () => {
  const best = {
    scalar: 'spark', matrix2: 'transformView', series: 'bizWaterfallView',
    customFrames: 'universalStageView', body: 'trailView',
  } as const;
  for (const [kind, type] of Object.entries(best)) {
    const items = recommendNodesForPort(source, 'out', kind as ValueKind, defs);
    assert.deepEqual(items.map((item) => item.type), [type, 'aiRuleBlock']);
    for (const item of items) {
      const input = defs[item.type]?.inputs?.find(({ id }) => id === item.inPortId);
      assert.ok(input && compatiblePorts(source, 'out', kind as ValueKind, { type: item.type }, input));
    }
    assert.deepEqual(filterWireRecommendations(items, items[0]!.inPortLabel), [items[0]]);
  }
});

test('408 实验接线仅匹配同一管线的指定前置阶段', () => {
  const target: CanvasNode = { ...source, type: 'lab408Stage', payload: 'dsTraversal/traversal' };
  const inputs = pipelinePorts(target, 'in');
  assert.equal(inputs.length, 1);
  assert.equal(compatiblePorts({ ...target, payload: 'dsTraversal/treeInput' }, 'out', 'lab408Data', target, inputs[0]!), true);
  assert.equal(compatiblePorts({ ...target, payload: 'pageReplace/references' }, 'out', 'lab408Data', target, inputs[0]!), false);
});

test('多类型输入仅推荐声明支持的值，通用输入依然兼容', () => {
  const input = { id: 'in', label: '训练', accepts: ['scalar', 'body', 'matrix2'] } as const;
  const candidates = { ...defs, spark: def('记录仪', '学习', input) };
  assert.equal(recommendNodesForPort(source, 'out', 'series', candidates).some((item) => item.type === 'spark'), false);
  assert.equal(recommendNodesForPort(source, 'out', 'body', candidates).some((item) => item.type === 'spark'), true);
});
