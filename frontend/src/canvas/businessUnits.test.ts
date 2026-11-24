import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBusinessPipeline, evaluateBusinessStage } from './businessPipeline.ts';
import type { BusinessTemplateKind } from './businessPipelineTypes.ts';
import { businessControlLabel, readBusinessUnits, writeBusinessUnits } from './businessUnits.ts';
import type { PortValue } from './types.ts';

test('单位设置兼容旧文档并规范化自定义标签', () => {
  const kind = 'biz-breakeven';
  assert.deepEqual(readBusinessUnits(kind, undefined), { currency: '元', orders: '单' });
  assert.deepEqual(readBusinessUnits(kind, '旧的参数说明'), { currency: '元', orders: '单' });
  assert.deepEqual(readBusinessUnits(kind, 'null'), { currency: '元', orders: '单' });
  const stored = writeBusinessUnits(kind, { currency: ' USD ', orders: '  ', invalid: '不适用' });
  const units = readBusinessUnits(kind, stored);
  assert.deepEqual(units, { currency: 'USD', orders: '单' });
  assert.equal(businessControlLabel(kind, 'price', '客单价（元）', units), '客单价（USD）');
  assert.equal(businessControlLabel(kind, 'varRate', '变动成本率（%）', units), '变动成本率（%）');
  assert.equal(readBusinessUnits(kind, '{"currency":"超出输入框范围的单位字符串"}').currency?.length, 8);
});

function evaluateFrames(kind: BusinessTemplateKind, custom: Record<string, string>) {
  const doc = buildBusinessPipeline(kind, kind, '');
  doc.nodes.find((node) => node.payload === kind + '/source')!.text = writeBusinessUnits(kind, custom);
  const values = new Map<string, PortValue>();
  return doc.nodes.filter((node) => node.type === 'businessStage').map((node) => {
    const value = evaluateBusinessStage(node, (port) => {
      const wire = doc.wires.find(({ to, toPort }) => to === node.id && toPort === port);
      return wire ? values.get(wire.from) ?? null : null;
    });
    assert.ok(value && !value.error);
    values.set(node.id, value);
    return value.result.frames[0]!;
  });
}

test('四个管线的单位从参数源传递到主图、分析和时间轴，并保持数值不变', () => {
  const [source, main, analysis, summary] = evaluateFrames('biz-breakeven', { currency: 'USD', orders: '件' });
  assert.match(source!.metrics![0]!.label, /USD/);
  assert.ok(main!.scene.labels?.some(({ text }) => text === '销量（件）'));
  assert.ok(analysis!.scene.labels?.some(({ text }) => text.endsWith(' USD')));
  assert.ok(summary!.scene.labels?.some(({ text }) => text === '累计净现金流（USD）'));
  assert.equal(main!.metrics![2]!.value, '3,886 件');
  const standard = evaluateFrames('biz-breakeven', {});
  assert.equal(main!.metrics![0]!.value.replace(' USD', ''), standard[1]!.metrics![0]!.value.slice(1));

  const [, funnel, , cohorts] = evaluateFrames('biz-funnel', { currency: '欧元', impressions: '浏览', people: '账户' });
  assert.ok(funnel!.scene.labels?.some(({ text }) => text.includes('200,000 浏览')));
  assert.ok(cohorts!.scene.labels?.some(({ text }) => text === '活跃付费用户（账户）'));
  assert.match(funnel!.metrics![0]!.value, /欧元$/);

  const [, gantt, slack] = evaluateFrames('biz-cpm', { time: '工作日' });
  assert.match(gantt!.title, /工作日/);
  assert.ok(slack!.scene.labels?.some(({ text }) => text.endsWith('（工作日）')));

  const [abSource, abMain, , abHistory] = evaluateFrames('biz-abtest', { samples: '访客', time: '实验日' });
  assert.ok(abSource!.metrics?.some(({ label }) => label === '日均总流量（访客/实验日）'));
  assert.equal(abMain!.metrics![2]!.value, '2,000 访客');
  assert.ok(abHistory!.scene.labels?.some(({ text }) => text === '实验进度（实验日）'));
});
