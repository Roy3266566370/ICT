import assert from 'node:assert/strict';
import test from 'node:test';
import { cpmFrames, funnelFrames } from './businessCharts.ts';
import { calculateCpm, calculateFunnel } from './businessModels.ts';
import { parseBusinessPaste } from './businessPaste.ts';
import { readBusinessSettings, writeBusinessSettings, writeBusinessUnits } from './businessUnits.ts';

test('旧的单位设置兼容名称和工期，改单位时保留业务文案', () => {
  const kind = 'biz-cpm';
  const old = readBusinessSettings(kind, '{"time":"工作日"}');
  assert.equal(old.labels.T2, '前端开发');
  assert.equal(old.durations.T2, 6);
  const saved = writeBusinessSettings(kind, {
    ...old, labels: { ...old.labels, T2: '支付网关' }, durations: { ...old.durations, T2: 12 },
  });
  const converted = readBusinessSettings(kind, writeBusinessUnits(kind, { time: '冲刺日' }, saved));
  assert.equal(converted.units.time, '冲刺日');
  assert.equal(converted.labels.T2, '支付网关');
  assert.equal(converted.durations.T2, 12);
});

test('支持带引号 CSV 及 Excel TSV，名称按稳定键定位，工期按任务顺序导入', () => {
  const kind = 'biz-cpm';
  const settings = readBusinessSettings(kind, undefined);
  const result = parseBusinessPaste(kind, '名称,数值\r\n"需求,梳理",4\r\n"支付""网关""",9\r\nT3,接口联调\r\ndelayT2,5', settings);
  assert.deepEqual(result, {
    params: { delayT2: 5 },
    labels: { T1: '需求,梳理', T2: '支付"网关"', T3: '接口联调' },
    durations: { T1: 4, T2: 9 },
  });
  const tsv = parseBusinessPaste('biz-funnel', 'impressions\t访客触达\n点击率\t12.5%\n付费\t激活账号', readBusinessSettings('biz-funnel', undefined));
  assert.deepEqual(tsv, { params: { ctr: .125 }, labels: { impressions: '访客触达', paid: '激活账号' }, durations: {} });
});

test('整批校验重复项、越界、非法行和未授权参数，拒绝部分写入', () => {
  const settings = readBusinessSettings('biz-breakeven', undefined);
  assert.throws(() => parseBusinessPaste('biz-breakeven', 'price,12.75\nmonthlySales,-1', settings), /第 2 行/);
  assert.throws(() => parseBusinessPaste('biz-breakeven', 'price,12.75\n客单价,22', settings), /重复/);
  assert.throws(() => parseBusinessPaste('biz-breakeven', 'price,12.75,abc', settings), /两列/);
  assert.throws(() => parseBusinessPaste('biz-breakeven', 'price,12.75\nadBudget,0', settings, ['price']), /不可编辑/);
  assert.deepEqual(parseBusinessPaste('biz-breakeven', '客单价,12.75\n变动成本率,28.75', settings).params,
    { price: 12.75, varRate: .2875 });
});

test('自定义标签用于 CPM 关键路径、图表与漏斗对照，基准使用自定义计划工期', () => {
  const cpm = readBusinessSettings('biz-cpm', '{"labels":{"T2":"支付网关"},"durations":{"T2":11}}');
  const project = calculateCpm({ delayT2: 2 }, cpm);
  assert.equal(project.tasks[1]?.name, '支付网关');
  assert.equal(project.tasks[1]?.duration, 13);
  assert.equal(project.totalDays, 22);
  assert.equal(project.delay, 2);
  const stage = cpmFrames(project, 'main', cpm.units)[0]!;
  assert.ok(stage.scene.labels?.some(({ text }) => text.includes('支付网关')));
  assert.match(stage.metrics?.find(({ label }) => label === '关键路径')?.value ?? '', /支付网关/);

  const funnel = readBusinessSettings('biz-funnel', '{"labels":{"impressions":"访客触达","paid":"激活账号","repeat":"回访账户"}}');
  const growth = calculateFunnel({}, funnel);
  const main = funnelFrames(growth, 'main', funnel.units)[0]!;
  const detail = funnelFrames(growth, 'analysis', funnel.units)[0]!;
  assert.ok(main.scene.labels?.some(({ text }) => text === '激活账号'));
  assert.ok(main.scene.labels?.some(({ text }) => text === '回访账户'));
  assert.ok(detail.scene.labels?.some(({ text }) => text.includes('访客触达')));
  assert.match(main.summary ?? '', /激活账号/);
});
