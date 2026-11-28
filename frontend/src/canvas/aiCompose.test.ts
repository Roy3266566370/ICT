import assert from 'node:assert/strict';
import test from 'node:test';

import { applyComposePlan, buildComposeCatalog, type AiComposePlan } from './aiCompose.ts';
import type { NodeDef } from './nodes.tsx';
import type { CanvasDoc, CanvasNode, NodeType, PortSpec } from './types.ts';

const MOCK_DEFS: Partial<Record<NodeType, NodeDef>> = {
  slider: {
    title: '滑杆源',
    badge: '源',
    outputs: [{ id: 'out', label: 'v', kind: 'scalar' }],
    Body: () => null as never,
  },
  rotor: {
    title: '旋转器',
    badge: '变换',
    inputs: [{ id: 'in', label: 'θ', kind: 'scalar' }],
    outputs: [{ id: 'out', label: 'R', kind: 'matrix2' }],
    Body: () => null as never,
  },
  fieldView: {
    title: '向量场',
    badge: '视图',
    inputs: [{ id: 'in', label: 'M', kind: 'matrix2' }],
    Body: () => null as never,
  },
  springOsc: {
    title: '弹簧振子',
    badge: '源',
    outputs: [{ id: 'out', label: '质点', kind: 'body' }],
    Body: () => null as never,
  },
  energyMeter: {
    title: '能量表',
    badge: '视图',
    inputs: [{ id: 'in', label: '质点', kind: 'body' }],
    Body: () => null as never,
  },
  delayRegister: {
    title: '延迟寄存器',
    badge: '变换',
    inputs: [{ id: 'next', label: '下拍', kind: 'scalar' }],
    outputs: [{ id: 'out', label: '当前', kind: 'scalar' }],
    Body: () => null as never,
  },
};

const resolvePorts = (node: CanvasNode, dir: 'in' | 'out'): readonly PortSpec[] =>
  (dir === 'in' ? MOCK_DEFS[node.type]?.inputs : MOCK_DEFS[node.type]?.outputs) ?? [];

let seq = 0;
const createNode = (type: NodeType, x: number, y: number): CanvasNode => ({
  id: `new_${++seq}`,
  type,
  x,
  y,
  params: {},
});

test('aiCompose: 自动搭整套实验、过滤不兼容连线并按拓扑层级从左到右排布', () => {
  const catalog = buildComposeCatalog(MOCK_DEFS);
  assert.ok(catalog.some((c) => c.type === 'springOsc'));

  const emptyDoc: CanvasDoc = { version: 1, title: '空白画布', zoom: 1, nodes: [], wires: [], strokes: [] };
  const plan: AiComposePlan = {
    title: '弹簧与旋转演示',
    summary: '滑杆驱动旋转器输出到向量场，过滤一条不兼容的跨类型连线',
    add_nodes: [
      { ref: 's1', type: 'slider', label: '转角', params: { v: 0.25 } },
      { ref: 'r1', type: 'rotor' },
      { ref: 'v1', type: 'fieldView' },
      { ref: 'bad', type: 'unknownType' },
    ],
    wires: [
      { from: 's1', fromPort: 'out', to: 'r1', toPort: 'in' },
      { from: 'r1', fromPort: 'out', to: 'v1', toPort: 'in' },
      // 不兼容：scalar 不能直连 matrix2
      { from: 's1', fromPort: 'out', to: 'v1', toPort: 'in' },
    ],
  };

  const applied = applyComposePlan(emptyDoc, plan, MOCK_DEFS, resolvePorts, createNode);
  assert.equal(applied.addedNodeIds.length, 3);
  assert.equal(applied.addedWireCount, 2);
  assert.equal(applied.skippedWireCount, 1);
  assert.equal(applied.doc.title, '弹簧与旋转演示');

  // 拓扑层级排布：slider(x) < rotor(x) < fieldView(x)
  const [nSlider, nRotor, nView] = applied.doc.nodes;
  assert.ok(nSlider!.x < nRotor!.x && nRotor!.x < nView!.x);
});

test('aiCompose: 帮已有散落积木自动连线，并允许经过 delayRegister 的反馈环', () => {
  const doc: CanvasDoc = {
    version: 1,
    title: '散落积木',
    zoom: 1,
    strokes: [],
    nodes: [
      { id: 'exist_osc', type: 'springOsc', x: 50, y: 50, params: {} },
      { id: 'exist_meter', type: 'energyMeter', x: 350, y: 50, params: {} },
      { id: 'reg1', type: 'delayRegister', x: 50, y: 300, params: { init: 1 } },
      { id: 'reg2', type: 'delayRegister', x: 350, y: 300, params: { init: 2 } },
    ],
    wires: [],
  };
  const plan: AiComposePlan = {
    title: '自动连线',
    summary: '连接弹簧振子与能量表，并形成双寄存器反馈环',
    add_nodes: [],
    wires: [
      { from: 'exist_osc', fromPort: 'out', to: 'exist_meter', toPort: 'in' },
      { from: 'reg1', fromPort: 'out', to: 'reg2', toPort: 'next' },
      { from: 'reg2', fromPort: 'out', to: 'reg1', toPort: 'next' },
    ],
  };
  const applied = applyComposePlan(doc, plan, MOCK_DEFS, resolvePorts, createNode);
  assert.equal(applied.addedNodeIds.length, 0);
  assert.equal(applied.addedWireCount, 3);
  assert.equal(applied.skippedWireCount, 0);
});
