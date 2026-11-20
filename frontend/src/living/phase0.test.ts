import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareLivingMarkdown } from './markdown.ts';
import { blockDraft, blockRegistry, parseBlockDraft } from './blockRegistry.ts';
import { parseLivingPageDoc, type PageBlock } from './types.ts';

test('Markdown、公式、代码和转义美元符号保留', () => {
  for (const text of ['# 标题\n\n- 项目\n- $x^2$', '$$\nx^2+1\n$$', '价格 \\$5，公式 $x$', '代码 `cost=$5` 与 $x$', '```js\nconst price = "$5";\n\n```\n\n$x$', '| a | b |\n|---|---|\n| 1 | 2 |']) {
    assert.equal(prepareLivingMarkdown(text), text);
  }
});

test('OCR 未配对公式按段退回字面文本，不吞后续段落', () => {
  assert.equal(prepareLivingMarkdown('坏 $x\n正文 **保留**\n\n正确 $y$'), '坏 \\$x  \n正文 \\*\\*保留\\*\\*\n\n正确 $y$');
  assert.equal(prepareLivingMarkdown('坏 $$x$'), '坏 \\$\\$x\\$');
  assert.equal(prepareLivingMarkdown('<img src=x onerror=alert(1)> $'), '\\<img src\\=x onerror\\=alert\\(1\\)\\> \\$');
});

test('registry 提供全部多字段并保留已有 data 字段', () => {
  const block: PageBlock = { id: 'q', type: 'quiz', data: { question: '', answer: '', explain: '', min: 0, max: 10, value: 1 } };
  const result = parseBlockDraft(block, { ...blockDraft(block), question: '预测', answer: '一半', explain: '说明', min: '-1', max: '1', value: '0.5' });
  assert.deepEqual(result.block?.data, { question: '预测', answer: '一半', explain: '说明', min: -1, max: 1, value: 0.5 });
  for (const patch of [{ min: '1', max: '1' }, { value: '99' }, { value: '' }, { value: 'Infinity' }]) {
    assert.equal(parseBlockDraft(block, { ...blockDraft(block), ...patch }).block, null);
  }
  const text: PageBlock = { id: 't', type: 'text', data: { md: 'old', collapsed: true } };
  assert.deepEqual(parseBlockDraft(text, { md: 'new' }).block?.data, { md: 'new', collapsed: true });
  assert.deepEqual(blockRegistry.checkpoint?.fields.map((f) => f.key), ['prompt', 'expected', 'placeholder', 'grading', 'locked_until']);
});

test('embed 接受空配置，拒绝脚本、凭据和无效高度', () => {
  const block: PageBlock = { id: 'e', type: 'embed', data: { url: '', height: 360 } };
  assert.ok(parseBlockDraft(block, blockDraft(block)).block);
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://user:pass@example.com', 'http://', 'https://example.com/ bad']) {
    assert.equal(parseBlockDraft(block, { url, height: '360' }).block, null);
  }
  for (const height of ['0', '1201', 'NaN']) assert.equal(parseBlockDraft(block, { url: '', height }).block, null);
});

test('旧 page.1 与未知块数据保留，原型名称不会成为编辑器', () => {
  const unknown = { id: 'u', type: '__proto__', data: { nested: ['<script>alert(1)</script>', { x: 2 }] } };
  const parsed = parseLivingPageDoc({ page_id: 'p', schema_version: 'page.1', blocks: [unknown] });
  assert.deepEqual(parsed.blocks, [unknown]);
  assert.equal(blockRegistry[parsed.blocks[0]!.type], undefined);
  assert.deepEqual(parsed.settings, { answers_visible: 'after_attempt', allow_fork: true, collect_progress: true });
});
