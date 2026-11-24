import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultAiRuleParams,
  defaultAiRulePayload,
  normalizeAiRulePayload,
  parseAiRulePayload,
} from './aiRuleBlock.ts';

test('默认 AI 方块载荷可解析，并带有控件、预设和核对说明', () => {
  const payload = defaultAiRulePayload();
  assert.equal(payload.version, 1);
  assert.ok(payload.code.includes('function run'));
  assert.equal(payload.controls.length, 3);
  assert.equal(payload.presets?.length, 3);
  assert.ok(payload.verificationNote);
  assert.deepEqual(defaultAiRuleParams(payload), { a: 1, b: 0, c: 0 });
  const parsed = parseAiRulePayload(JSON.stringify(payload));
  assert.equal(parsed?.title, payload.title);
});

test('载荷清洗拒绝无 run 的代码，过滤无效控件和未知预设参数', () => {
  assert.throws(() => normalizeAiRulePayload({
    code: 'return 1', controls: [], presets: [],
  }), /function run/);
  const payload = normalizeAiRulePayload({
    title: '测试',
    summary: '说明',
    controls: [
      { key: 'a', label: 'A', value: 3, min: 0, max: 2 },
      { key: 'bad key', label: '坏', value: 1 },
    ],
    presets: [
      { label: '预设一', params: { a: 1, unknown: 4 } },
      { label: '预设二', params: { unknown: 4 } },
    ],
    preferredView: 'graph',
    code: 'function run({ params }) { return { data: {}, frames: [{ title: \'1\', summary: \'2\' }] }; }',
  });
  assert.equal(payload.controls.length, 1);
  assert.equal(payload.controls[0]!.value, 2);
  assert.deepEqual(payload.presets, [{ label: '预设一', params: { a: 1 } }]);
  assert.equal(payload.preferredView, 'graph');
  assert.equal(parseAiRulePayload('{bad json'), null);
});

test('完整载荷可序列化并保留 textLabel、defaultText、verificationNote', () => {
  const payload = normalizeAiRulePayload({
    prompt: '演示一个测试规则',
    title: '测试规则',
    summary: '一行说明',
    textLabel: '输入序列',
    defaultText: '1 2 3',
    controls: [{ key: 'n', label: '数量', value: 3, min: 1, max: 9, step: 1 }],
    presets: [{ label: '小规模', text: '1 2', params: { n: 2 } }],
    preferredView: 'timeline',
    verificationNote: 'n=2 时两帧',
    code: 'function run({ params }) { const frames = []; for (let i = 0; i < params.n; i += 1) frames.push({ title: String(i), summary: "帧" }); return { data: {}, frames: frames }; }',
  });
  const parsed = parseAiRulePayload(JSON.stringify(payload));
  assert.equal(parsed?.textLabel, '输入序列');
  assert.equal(parsed?.defaultText, '1 2 3');
  assert.equal(parsed?.preferredView, 'timeline');
  assert.equal(parsed?.presets?.[0]?.text, '1 2');
});
