import assert from 'node:assert/strict';
import test from 'node:test';
import { recommendationContentKey } from './recommendations.ts';
import type { PageBlock } from './types.ts';

const text: PageBlock = { id: 't', type: 'text', data: { md: '位置编码知识点' }, source: { file_id: 'f1', page: 53 } };
test('字段序列化顺序变化不应使推荐失效', () => {
  const reordered: PageBlock = { source: { page: 53, file_id: 'f1' }, data: text.data, type: 'text', id: 't' };
  assert.equal(recommendationContentKey({ title: '课程', blocks: [text] }), recommendationContentKey({ title: '课程', blocks: [reordered] }));
});
test('添加生成模型不改变推荐内容指纹', () => {
  const model: PageBlock = { id: 'm', type: 'canvas', data: { doc: { template: 'ai_model', nodes: [] } } };
  assert.equal(recommendationContentKey({ title: '课程', blocks: [text] }), recommendationContentKey({ title: '课程', blocks: [text, model] }));
});
test('修改原文或标题会使推荐失效', () => {
  const original = recommendationContentKey({ title: '课程', blocks: [text] });
  assert.notEqual(original, recommendationContentKey({ title: '新标题', blocks: [text] }));
  assert.notEqual(original, recommendationContentKey({ title: '课程', blocks: [{ ...text, data: { md: '层归一化知识点' } }] }));
});
