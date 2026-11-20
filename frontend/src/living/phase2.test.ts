import assert from 'node:assert/strict';
import test from 'node:test';
import { blockDraft, blockRegistry, parseBlockDraft } from './blockRegistry.ts';
import { aiAnchorOf, aiInstructionOf, inferParamRange, panelParamRange, parsePageLabSim, simParamMeta, simsIn } from './sim.ts';
import type { PageBlock } from './types.ts';
import type { CanvasDoc } from '../canvas/types.ts';

const labPayload = JSON.stringify({
  kind: 'page_lab', title: '温度实验', summary: '调温度看权重', explain: ['观察分布'],
  params: [{ id: 't', label: '温度', min: 0.1, max: 3, step: 0.1, default: 1 }],
  program: 'input.t', anchor_id: 'blk_a1', instruction: '做温度对比实验', input_hash: 'h1',
});

const simBlock: PageBlock = {
  id: 'c1', type: 'canvas',
  data: { doc: { version: 1, title: 'AI 交互', nodes: [
    { id: 'sim1', type: 'pageLabSim', x: 0, y: 0, params: { t: 1 }, payload: labPayload },
  ], wires: [], strokes: [], zoom: 1 } },
};

test('parsePageLabSim 只收 page_lab 载荷，格式不符返回 null', () => {
  const sim = parsePageLabSim(labPayload);
  assert.equal(sim?.kind, 'page_lab');
  assert.equal(sim?.anchor_id, 'blk_a1');
  assert.equal(sim?.params.length, 1);
  for (const bad of [undefined, '', 'not-json', '{"kind":"other","program":"x","params":[]}',
    '{"kind":"page_lab","params":[]}']) {
    assert.equal(parsePageLabSim(bad), null);
  }
});

test('aiAnchorOf 新旧两态都认锚点，普通画布返回 null', () => {
  assert.equal(aiAnchorOf(simBlock), 'blk_a1');
  const legacy: PageBlock = { id: 'c2', type: 'canvas',
    data: { doc: { template: 'ai_model', anchor_id: 'blk_old', model: {}, instruction: '老指令' } } };
  assert.equal(aiAnchorOf(legacy), 'blk_old');
  assert.equal(aiInstructionOf(legacy), '老指令');
  const plain: PageBlock = { id: 'c3', type: 'canvas',
    data: { doc: { version: 1, nodes: [{ id: 'n', type: 'note', x: 0, y: 0, params: {} }], wires: [] } } };
  assert.equal(aiAnchorOf(plain), null);
  assert.equal(simsIn(plain).length, 0);
});

test('新块从 payload 读 instruction，多 sim 画布取首个锚点', () => {
  assert.equal(aiInstructionOf(simBlock), '做温度对比实验');
  const two: PageBlock = { id: 'c4', type: 'canvas',
    data: { doc: { version: 1, nodes: [
      { id: 'a', type: 'pageLabSim', x: 0, y: 0, params: {}, payload: JSON.stringify({ kind: 'page_lab', program: 'p', params: [] }) },
      { id: 'b', type: 'pageLabSim', x: 0, y: 0, params: {}, payload: labPayload },
    ], wires: [] } } };
  assert.equal(simsIn(two).length, 2);
  assert.equal(aiAnchorOf(two), 'blk_a1');
});

test('gate 字段：合法门控序列化回块，空串清除，自身/坏规则被拒', () => {
  const lab: PageBlock = { id: 'lab1', type: 'lab', data: { problem: {} } };
  const draft = blockDraft(lab);
  assert.equal(draft.locked_until, '');
  const gated = parseBlockDraft(lab, { ...draft, locked_until: '{"block_id":"q1","rule":"correct"}' });
  assert.deepEqual(gated.block?.locked_until, { block_id: 'q1', rule: 'correct' });
  const cleared = parseBlockDraft(
    { ...lab, locked_until: { block_id: 'q1', rule: 'submitted' } },
    { ...draft, locked_until: '' });
  assert.equal(cleared.block?.locked_until, undefined);
  const self = parseBlockDraft(lab, { ...draft, locked_until: '{"block_id":"lab1"}' });
  assert.equal(self.block, null);
  assert.ok(self.errors.locked_until);
  const badRule = parseBlockDraft(lab, { ...draft, locked_until: '{"block_id":"q1","rule":"viewed"}' });
  assert.equal(badRule.block, null);
});

test('gate 字段挂在所有可编辑块类型上', () => {
  for (const type of ['text', 'formula', 'section', 'callout', 'quiz', 'checkpoint', 'lab', 'canvas', 'embed'] as const) {
    assert.ok(blockRegistry[type]?.fields.some((f) => f.kind === 'gate'), `${type} 缺 gate 字段`);
  }
});

test('CanvasDoc panel 契约：view_node_ids 与 exposed_params 可序列化', () => {
  const doc: CanvasDoc = {
    version: 1, title: '仪器面板', nodes: [], wires: [], strokes: [], zoom: 1,
    panel: {
      view_node_ids: ['n1', 'n2'],
      exposed_params: [{ node_id: 'n1', param_key: 'k', label: 'k 滑杆', min: 0, max: 1, step: 0.1 }],
    },
  };
  assert.equal(JSON.parse(JSON.stringify(doc)).panel.exposed_params[0].node_id, 'n1');
});

test('panelParamRange 与 simParamMeta：缺失 min/max 时不截断大数与负数，优先读仿真元信息', () => {
  assert.deepEqual(inferParamRange(0.5), { min: 0, max: 1, step: 0.01 });
  const angleRange = panelParamRange({}, 45);
  assert.ok(angleRange.min <= 45 && angleRange.max >= 45 && angleRange.max > 1);
  const negRange = panelParamRange({}, -3);
  assert.ok(negRange.min <= -3 && negRange.max >= 3);
  const explicit = panelParamRange({ min: -5, max: 5, step: 0.5 }, 2);
  assert.deepEqual(explicit, { min: -5, max: 5, step: 0.5 });

  const simMeta = simParamMeta({ type: 'pageLabSim', params: { t: 1 }, payload: labPayload }, 't');
  assert.deepEqual(simMeta, { label: '温度', min: 0.1, max: 3, step: 0.1 });
  const attnMeta = simParamMeta({ type: 'attentionSim', params: { query: 1 } }, 'query');
  assert.deepEqual(attnMeta, { label: 'Query 第一维', min: -4, max: 4, step: 0.1 });
});
