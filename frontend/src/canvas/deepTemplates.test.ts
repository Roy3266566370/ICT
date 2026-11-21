import test from 'node:test';
import assert from 'node:assert/strict';
import { DEEP_TEMPLATES, DEEP_TOPICS, deepTemplateDoc } from './deepTemplates.ts';
import { DEEP_LESSONS } from '../living/deepLessons.ts';
import type { CanvasDoc } from './types.ts';

function assertDoc(doc: CanvasDoc): void {
  const ids = new Set(doc.nodes.map((node) => node.id));
  assert.equal(ids.size, doc.nodes.length, '节点 id 必须唯一');
  for (const wire of doc.wires) {
    assert.ok(ids.has(wire.from), `悬空 from ${wire.from}`);
    assert.ok(ids.has(wire.to), `悬空 to ${wire.to}`);
  }
  assert.ok(doc.panel, '模板必须带仪器面板');
  for (const id of doc.panel!.view_node_ids) assert.ok(ids.has(id), `面板视图节点缺失 ${id}`);
  for (const entry of doc.panel!.exposed_params) {
    assert.ok(ids.has(entry.node_id), `外露参数节点缺失 ${entry.node_id}`);
    if (entry.min !== undefined && entry.max !== undefined) assert.ok(entry.min < entry.max, `${entry.param_key} 范围非法`);
    if (entry.step !== undefined) assert.ok(entry.step > 0, `${entry.param_key} 步长非法`);
  }
  assert.ok(doc.panel!.view_node_ids.length > 0);
  assert.ok(doc.panel!.exposed_params.length > 0);
  assert.equal(JSON.parse(JSON.stringify(doc)).nodes.length, doc.nodes.length);
}

test('four topics and fourteen templates with unique kinds', () => {
  assert.equal(DEEP_TOPICS.length, 4);
  assert.equal(DEEP_TEMPLATES.length, 14);
  assert.equal(new Set(DEEP_TEMPLATES.map((template) => template.kind)).size, 14);
  for (const template of DEEP_TEMPLATES) assert.ok(DEEP_TOPICS.some((topic) => topic.id === template.topic), template.kind);
  for (const topic of DEEP_TOPICS) assert.ok(DEEP_TEMPLATES.some((template) => template.topic === topic.id), topic.id);
});

test('every template document has valid wiring and a usable instrument panel', () => {
  for (const template of DEEP_TEMPLATES) assertDoc(deepTemplateDoc(template.kind));
});

test('every official lesson builds valid blocks, bindings and gates', () => {
  assert.ok(DEEP_LESSONS.length >= 4);
  for (const lesson of DEEP_LESSONS) {
    const { blocks, variables } = lesson.build();
    const blockIds = new Set(blocks.map((block) => block.id));
    assert.equal(blockIds.size, blocks.length, `${lesson.id} 块 id 重复`);
    for (const block of blocks) {
      if (block.type === 'canvas') {
        const doc = block.data.doc as unknown as CanvasDoc;
        assertDoc(doc);
        const nodeIds = new Set(doc.nodes.map((node) => node.id));
        for (const [key, variable] of Object.entries(block.bindings ?? {})) {
          const [nodeId, paramKey] = key.split('.');
          assert.ok(nodeIds.has(nodeId!), `${lesson.id} 绑定节点缺失 ${key}`);
          assert.ok(paramKey, `${lesson.id} 绑定参数缺失 ${key}`);
          const target = doc.nodes.find((node) => node.id === nodeId);
          assert.ok(target && Object.hasOwn(target.params, paramKey!), `${lesson.id} 绑定参数不存在 ${key}`);
          assert.equal(variables[variable]?.type, 'number', `${lesson.id} 绑定变量必须为数值 ${variable}`);
        }
      }
      if (block.locked_until) assert.ok(blockIds.has(block.locked_until.block_id), `${lesson.id} 门控目标缺失`);
    }
    assert.ok(blocks.some((block) => block.type === 'quiz'), `${lesson.id} 缺少先猜再看`);
    assert.ok(blocks.some((block) => block.type === 'canvas'), `${lesson.id} 缺少实验`);
  }
});
