import assert from 'node:assert/strict';
import test from 'node:test';
import { interpolate, reconcileLiveVars } from './interpolate.ts';
import { blockDraft, parseBlockDraft } from './blockRegistry.ts';
import type { PageBlock, PageVariables } from './types.ts';

test('${name} 直接插值，数字变量格式化', () => {
  const values = { eta: 0.05, mode: '线性' };
  assert.equal(interpolate('当前 η = ${eta}', values), '当前 η = 0.05');
  assert.equal(interpolate('模式：${mode}', values), '模式：线性');
});

test('${expr:…} 用变量求值', () => {
  const values = { eta: 0.5, n: 3 };
  assert.equal(interpolate('二倍 = ${expr:2*eta}', values), '二倍 = 1');
  assert.equal(interpolate('平方 = ${expr:n^2}', values), '平方 = 9');
});

test('${cond ? a : b} 有限分支', () => {
  const values = { eta: 0.8 };
  assert.equal(interpolate('${eta > 0.6 ? 发散 : 收敛}', values), '发散');
  assert.equal(interpolate('${eta < 0.6 ? 发散 : 收敛}', values), '收敛');
});

test('未知变量与坏表达式原样保留', () => {
  assert.equal(interpolate('${ghost}', { eta: 1 }), '${ghost}');
  assert.equal(interpolate('${expr:???}', { eta: 1 }), '${expr:???}');
});

test('select 变量不参与数值求值', () => {
  const values = { mode: '快', n: 2 };
  assert.equal(interpolate('${expr:n+mode}', values), '${expr:n+mode}');
});

test('无占位符的文本原样返回', () => {
  assert.equal(interpolate('普通文本 $x^2$', { eta: 1 }), '普通文本 $x^2$');
});

// --- blockRegistry：bindings / select / checkbox / callout ---

const canvasBlock: PageBlock = {
  id: 'b1', type: 'canvas',
  data: { doc: { version: 1, title: '', zoom: 1, nodes: [], wires: [], strokes: [] } as never },
};

test('bindings 草稿序列化与解析回读', () => {
  const block: PageBlock = { ...canvasBlock, bindings: { 'k1.rate': 'eta' } };
  const draft = blockDraft(block);
  assert.equal(draft.bindings, '{"k1.rate":"eta"}');
  const { block: parsed, errors } = parseBlockDraft(block, draft);
  assert.deepEqual(errors, {});
  assert.deepEqual(parsed?.bindings, { 'k1.rate': 'eta' });
});

test('bindings 非法 JSON 与非法变量名被拒', () => {
  const bad1 = parseBlockDraft(canvasBlock, { bindings: '{broken' });
  assert.equal(bad1.block, null);
  const bad2 = parseBlockDraft(canvasBlock, { bindings: '{"lr":"not a var!"}' });
  assert.equal(bad2.block, null);
  const empty = parseBlockDraft(canvasBlock, { bindings: '{}' });
  assert.equal(empty.block?.bindings, undefined);
});

test('checkbox/select/callout 字段往返', () => {
  const callout: PageBlock = { id: 'c1', type: 'callout', data: { kind: 'warning', title: 't', md: 'm', collapsible: true } };
  const draft = blockDraft(callout);
  assert.equal(draft.collapsible, 'true');
  assert.equal(draft.kind, 'warning');
  const { block: parsed } = parseBlockDraft(callout, { ...draft, collapsible: 'false', kind: 'proof' });
  assert.equal(parsed?.type === 'callout' && parsed.data.collapsible, false);
  assert.equal(parsed?.type === 'callout' && parsed.data.kind, 'proof');
});

test('callout 非法 kind 被拒', () => {
  const callout: PageBlock = { id: 'c1', type: 'callout', data: { kind: 'warning', title: '', md: '', collapsible: false } };
  const { block, errors } = parseBlockDraft(callout, { kind: 'tip', title: '', md: '', collapsible: 'false' });
  assert.equal(block, null);
  assert.ok(errors.kind);
});

test('reconcileLiveVars 同步新增、删除、默认值变更与越界回退，同时保留有效预览值', () => {
  const prevDefs: PageVariables = {
    eta: { label: '学习率', type: 'number', value: 0.05, min: 0, max: 1, step: 0.01 },
    old: { label: '旧变量', type: 'number', value: 1, min: 0, max: 5 },
    mode: { label: '模式', type: 'select', value: 'A', options: ['A', 'B'] },
  };
  const prevValues = { eta: 0.3, old: 2, mode: 'B' };
  const nextDefs: PageVariables = {
    eta: { label: '学习率', type: 'number', value: 0.05, min: 0, max: 1, step: 0.01 },
    mode: { label: '模式', type: 'select', value: 'B', options: ['B', 'C'] },
    fresh: { label: '新变量', type: 'number', value: 2, min: 0, max: 10 },
  };
  const reconciled = reconcileLiveVars(prevValues, nextDefs, prevDefs);
  assert.deepEqual(reconciled, { eta: 0.3, mode: 'B', fresh: 2 });

  // 范围收窄导致旧预览值 0.3 越界时回退到默认值 0.05
  const narrowed: PageVariables = {
    eta: { label: '学习率', type: 'number', value: 0.05, min: 0, max: 0.2, step: 0.01 },
  };
  assert.deepEqual(reconcileLiveVars({ eta: 0.3 }, narrowed, nextDefs), { eta: 0.05 });

  // 作者主动修改默认值时刷新为新默认值
  const changedDefault: PageVariables = {
    eta: { label: '学习率', type: 'number', value: 0.1, min: 0, max: 1, step: 0.01 },
  };
  assert.deepEqual(reconcileLiveVars({ eta: 0.3 }, changedDefault, prevDefs), { eta: 0.1 });
});
