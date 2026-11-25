import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleAuxiliaryOutputs, serializeUpstreamValue } from './aiRulePorts.ts';
import { aiRuleInputs, evalOutput, makeCtx } from './engine.ts';
import type { CanvasDoc, CanvasNode, PortValue } from './types.ts';
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

test('规则端口优先使用主数值，按曲线和表格回退，并且没有数据时不广播', () => {
  const line = { label: '轨迹', values: [2, 3] };
  const rows = [['记录', 7]];
  const frame = { title: '末帧', rows, series: [line] };
  const output = ruleAuxiliaryOutputs({ data: { other: 12, value: 11 }, frames: [frame] }, '试算');
  assert.deepEqual(output, { value: { kind: 'scalar', v: 11 },
    series: { kind: 'series', title: '试算', labels: ['1', '2'], values: [2, 3] } });
  assert.deepEqual(ruleAuxiliaryOutputs({ data: { x: 4 }, frames: [frame] }, '试算').value, { kind: 'scalar', v: 4 });
  assert.deepEqual(ruleAuxiliaryOutputs({ data: {}, frames: [frame] }, '试算').value, { kind: 'scalar', v: 3 });
  assert.deepEqual(ruleAuxiliaryOutputs({ data: {}, frames: [{ title: '末帧', rows }] }, '试算').value, { kind: 'scalar', v: 7 });
  assert.deepEqual(ruleAuxiliaryOutputs({ data: {}, frames: [] }, '试算'), {});
});

test('命名输出和封装内的规则均沿正确端口求值', () => {
  const create = (id: string, type: CanvasNode['type']): CanvasNode => ({ id, type, x: 0, y: 0, params: {} });
  const slider = { ...create('slider', 'slider'), params: { v: 5 } };
  const composite: CanvasNode = { ...create('composite', 'composite'), sub: {
    nodes: [create('input', 'portIn'), create('rule', 'aiRuleBlock'), create('result', 'portOut')],
    ports: [{ id: 'input', dir: 'in', label: '输入' }, { id: 'result', dir: 'out', label: '输出' }],
    wires: [{ id: 'inner-in', from: 'input', to: 'rule' }, { id: 'inner-out', from: 'rule', fromPort: 'value', to: 'result' }],
  } };
  const doc: CanvasDoc = {
    version: 1, title: '测试', nodes: [slider, composite], strokes: [], zoom: 1,
    wires: [{ id: 'in', from: 'slider', to: 'composite', toPort: 'input' }],
  };
  const live = new Map<string, PortValue>([['rule|value', { kind: 'scalar', v: 10 }]]);
  const ctx = makeCtx(doc, live);
  const [entry] = [...aiRuleInputs(ctx)];
  assert.equal(entry?.node.id, 'rule');
  assert.deepEqual(serializeUpstreamValue(entry?.values.in), { kind: 'scalar', v: 5 });
  assert.deepEqual(evalOutput(ctx, composite.id, 'result'), { kind: 'scalar', v: 10 });
});
