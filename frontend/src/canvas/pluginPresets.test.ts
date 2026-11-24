import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPresetToDoc, defaultPresetsForTemplate, extractSourceParams, workshopParamRefs } from './pluginPresets.ts';
import { buildTemplateDoc } from './templateCatalog.ts';
import type { CanvasDoc } from './types.ts';

test('经营预设包含完整参数快照，更新来源节点时保留画布和其余节点', () => {
  const doc = buildTemplateDoc('biz-breakeven');
  const current = extractSourceParams(doc);
  assert.equal(current.price, 99);
  const presets = defaultPresetsForTemplate('biz-breakeven');
  assert.equal(presets.length, 3);
  assert.equal(presets[1]?.params.price, 79.2);
  const next = applyPresetToDoc(doc, presets[1]!);
  assert.deepEqual(extractSourceParams(next), { ...current, price: 79.2 });
  assert.equal(doc.nodes.find(node => node.params.price !== undefined)?.params.price, 99);
  assert.equal(next.wires, doc.wires);
  assert.equal(next.panel, doc.panel);
  assert.equal(next.nodes.at(-1), doc.nodes.at(-1));
});

test('作品的同名参数分别保存，拒绝隐藏、无效或未声明的快照字段', () => {
  const doc: CanvasDoc = {
    version: 1, title: '自定义仪器', strokes: [], wires: [], zoom: 1,
    nodes: [
      { id: 'a', x: 0, y: 0, type: 'slider', params: { v: 1, internal: 42 } },
      { id: 'b', x: 0, y: 100, type: 'slider', params: { v: 2 } },
    ],
    panel: { view_node_ids: ['a'], exposed_params: [
      { node_id: 'a', param_key: 'v' }, { node_id: 'b', param_key: 'v' }, { node_id: 'missing', param_key: 'v' },
    ] },
  };
  const [a, b] = workshopParamRefs(doc);
  assert.ok(a && b && a.key !== b.key);
  assert.deepEqual(extractSourceParams(doc), { [a.key]: 1, [b.key]: 2 });
  assert.deepEqual(extractSourceParams({ ...doc, panel: { ...doc.panel!, exposed_params: [...doc.panel!.exposed_params].reverse() } }),
    { [a.key]: 1, [b.key]: 2 });
  const next = applyPresetToDoc(doc, { id: 'changed', label: '更新', params: { [a.key]: 10, [b.key]: Infinity, internal: 3, v: 7 } });
  assert.deepEqual(next.nodes[0]?.params, { v: 10, internal: 42 });
  assert.equal(next.nodes[1], doc.nodes[1]);
  assert.equal(applyPresetToDoc(next, { id: 'same', label: '相同', params: { [a.key]: 10 } }), next);
});

test('时间轴预设按比例定位，非策展作品可创建自己的快照', () => {
  const presets = defaultPresetsForTemplate('biz-abtest');
  assert.equal(presets[0]?.cursor, 2 / 29);
  assert.equal(presets[1]?.cursor, 13 / 29);
  assert.deepEqual(defaultPresetsForTemplate('custom-work'), []);
});

test('观众切换预设时只改变白名单参数，空白名单保持所有数值', () => {
  const doc = buildTemplateDoc('biz-breakeven');
  const preset = { id: 'promo', label: '促销', params: { price: 79.2, adBudget: 100000 } };
  assert.deepEqual(extractSourceParams(applyPresetToDoc(doc, preset, ['price'])),
    { ...extractSourceParams(doc), price: 79.2 });
  assert.equal(applyPresetToDoc(doc, preset, []), doc);
  assert.equal(extractSourceParams(applyPresetToDoc(doc, preset)).adBudget, 100000);
});
