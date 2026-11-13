import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAssistantCommand, type AssistantParam } from './assistantCommands.ts';

const p = (id: string, value = 2, extra: Partial<AssistantParam> = {}): AssistantParam =>
  ({ specId: 's1', specTitle: '矩阵', id, label: `参数 ${id}`, value, min: -10, max: 10, step: 0.5, ...extra });
const params = [p('a'), p('b', 1), p('steps_rotate_angle_deg', 90, { label: '旋转角度', min: -450, max: 450 })];
const ctx = { pageCount: 9, currentIndex: 3 };

test('设值指令解析并保留原值用于回显', () => {
  const action = parseAssistantCommand('把 a 设为 3', params, ctx);
  assert.equal(action.kind, 'set');
  if (action.kind === 'set') { assert.equal(action.value, 3); assert.equal(action.param.value, 2); }
});

test('大小写精确匹配优先：「矩阵 A 的 b」指向 b，而不是 a', () => {
  const action = parseAssistantCommand('把矩阵 A 的 b 调成 -1', params, ctx);
  assert.equal(action.kind === 'set' && action.param.id, 'b');
  const loose = parseAssistantCommand('把 A 设为 1', params, ctx);
  assert.equal(loose.kind === 'set' && loose.param.id, 'a');
});

test('相对增减与中文标签匹配', () => {
  const up = parseAssistantCommand('把 b 加 2', params, ctx);
  assert.equal(up.kind === 'set' && up.value, 3);
  const angle = parseAssistantCommand('旋转角度调到 45', params, ctx);
  assert.equal(angle.kind === 'set' && angle.value, 45);
  const neg = parseAssistantCommand('把 b 设为 −2', params, ctx);
  assert.equal(neg.kind === 'set' && neg.value, -2);
});

test('越界、没听清、找不到参数都不执行', () => {
  assert.equal(parseAssistantCommand('把 a 设为 99', params, ctx).kind, 'say');
  assert.equal(parseAssistantCommand('把 a 弄大一点', params, ctx).kind, 'say');
  assert.equal(parseAssistantCommand('把 zz 设为 1', params, ctx).kind, 'say');
  assert.equal(parseAssistantCommand('随便聊聊', params, ctx).kind, 'say');
});

test('同名参数来自多个对象时要求说明，不乱选', () => {
  const dup = [p('a'), { ...p('a'), specId: 's2', specTitle: '另一图' }];
  assert.equal(parseAssistantCommand('把 a 设为 1', dup, ctx).kind, 'say');
});

test('恢复与翻页', () => {
  assert.equal(parseAssistantCommand('恢复原稿', params, ctx).kind, 'reset');
  assert.deepEqual(parseAssistantCommand('下一页', params, ctx), { kind: 'page', index: 4 });
  assert.deepEqual(parseAssistantCommand('翻到第 2 页', params, ctx), { kind: 'page', index: 1 });
  assert.equal(parseAssistantCommand('第 20 页', params, ctx).kind, 'say');
});
