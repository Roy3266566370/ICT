import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { BUSINESS_TEMPLATES, VISIBLE_BUSINESS_TEMPLATES, businessTemplateDoc, isBusinessPipelineKind } from './businessTemplates.ts';
import { WORKSHOP_PLUGIN_CATALOG } from './templateCatalog.ts';
import { applyRulePreset, defaultAiRuleParams, parseAiRulePayload } from './aiRuleBlock.ts';
import { ruleUpstream, serializeUpstreamValue } from './aiRulePorts.ts';
import { evalOutput, inputValues, makeCtx } from './engine.ts';
import { runRuleInSandbox } from './ruleSandbox.ts';
import type { CanvasDoc } from './types.ts';
import { compatiblePorts } from './wireRecommend.ts';

const ALL_KINDS = VISIBLE_BUSINESS_TEMPLATES.map((t) => t.kind);

test('series 上游序列化保留 title/labels/values，标量稳定', () => {
  const series = serializeUpstreamValue({ kind: 'series', title: '增长曲线', labels: ['1月', '2月'], values: [100, 110], unit: '单' })!;
  assert.equal(series.kind, 'series');
  assert.equal(series.title, '增长曲线');
  assert.deepEqual(series.labels, ['1月', '2月']);
  assert.deepEqual(series.values, [100, 110]);
  assert.deepEqual(serializeUpstreamValue({ kind: 'scalar', v: 0.65 }), { kind: 'scalar', v: 0.65 });
});

test('4 专题 8 章全景沙盘注册到可见目录与活页插件，旧 4 模板 legacy 兼容', () => {
  assert.equal(VISIBLE_BUSINESS_TEMPLATES.length, 8);
  assert.ok(VISIBLE_BUSINESS_TEMPLATES.every((t) => t.panorama && !t.legacy));
  assert.equal(BUSINESS_TEMPLATES.length, 12);
  assert.equal(BUSINESS_TEMPLATES.filter((t) => t.legacy).length, 4);
  for (const template of VISIBLE_BUSINESS_TEMPLATES) {
    assert.ok(WORKSHOP_PLUGIN_CATALOG.some((entry) => entry.kind === template.kind), template.kind);
    const doc = businessTemplateDoc(template.kind);
    assert.ok(doc.panel?.view_node_ids.length, template.kind);
    assert.ok(doc.panel?.exposed_params.length, template.kind);
    assert.ok(doc.nodes.some((n) => n.type === 'aiRuleBlock'), template.kind);
  }
  for (const template of BUSINESS_TEMPLATES.filter((t) => t.legacy)) {
    assert.ok(!WORKSHOP_PLUGIN_CATALOG.some((entry) => entry.kind === template.kind), template.kind);
    assert.ok(isBusinessPipelineKind(template.kind), template.kind);
    const doc = businessTemplateDoc(template.kind);
    assert.ok(doc.nodes.some((n) => n.type === 'businessStage'), `${template.kind} 旧模板仍走流水线`);
  }
});

test('8 章沙盘的所有连线都使用实际存在且相容的端口', async () => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../../', import.meta.url)),
    cacheDir: join(tmpdir(), 'ict-biz-sandboxes-vite'),
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: { '@': fileURLToPath(new URL('../', import.meta.url)) } },
  });
  try {
    const { nodePorts } = await server.ssrLoadModule('/src/canvas/nodes.tsx') as typeof import('./nodes.tsx');
    for (const kind of ALL_KINDS) {
      const doc = businessTemplateDoc(kind);
      const occupied = new Set<string>();
      for (const wire of doc.wires) {
        const source = doc.nodes.find(({ id }) => id === wire.from);
        const target = doc.nodes.find(({ id }) => id === wire.to);
        assert.ok(source && target, wire.id);
        const output = nodePorts(source, 'out').find(({ id }) => id === (wire.fromPort ?? 'out'));
        const input = nodePorts(target, 'in').find(({ id }) => id === (wire.toPort ?? 'in'));
        assert.ok(output, `${kind}:${wire.id} 输出端口不存在`);
        assert.ok(input, `${kind}:${wire.id} 输入端口不存在`);
        assert.ok(compatiblePorts(source, output.id, output.kind, target, input), `${kind}:${wire.id} 端口不相容`);
        const key = target.id + ':' + input.id;
        assert.ok(!occupied.has(key), `${kind}:${key} 端口重复接线`);
        occupied.add(key);
      }
      for (const viewId of doc.panel?.view_node_ids ?? []) {
        assert.ok(doc.nodes.some((n) => n.id === viewId), `${kind}:${viewId}`);
      }
      for (const param of doc.panel?.exposed_params ?? []) {
        const owner = doc.nodes.find((n) => n.id === param.node_id);
        assert.ok(owner, `${kind}:${param.node_id}`);
        assert.ok(param.param_key in owner!.params || owner!.type === 'aiRuleBlock', `${kind}:${param.param_key}`);
      }
    }
  } finally {
    await server.close();
  }
});

function runRule(code: string, input: Parameters<typeof runRuleInSandbox>[1]) {
  return runRuleInSandbox(code, input, {
    workerFactory: (source) => {
      const thread = new Worker(
        'const port = require("node:worker_threads").parentPort;\n' +
        'const self = { performance, postMessage: port.postMessage.bind(port) };\n' +
        source + '\nport.on("message", data => self.onmessage({ data }));', { eval: true });
      const worker = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        onerror: null as ((event: ErrorEvent) => void) | null,
        postMessage(message: unknown) { thread.postMessage(message); },
        terminate() { void thread.terminate(); },
      };
      thread.on('message', (data) => worker.onmessage?.({ data } as MessageEvent));
      thread.on('error', (error) => worker.onerror?.(error as unknown as ErrorEvent));
      return worker;
    },
  });
}

async function runNode(doc: CanvasDoc, id: string) {
  const node = doc.nodes.find((item) => item.id === id)!;
  const payload = parseAiRulePayload(node.payload)!;
  return (await runRule(payload.code, {
    text: node.text ?? payload.defaultText ?? '',
    params: { ...defaultAiRuleParams(payload), ...node.params },
    upstream: ruleUpstream(inputValues(makeCtx(doc, new Map()), node), payload.sampleProfile),
  })).result;
}

function setParam(doc: CanvasDoc, id: string, key: string, v: number): void {
  doc.nodes.find((n) => n.id === id)!.params[key] = v;
}

test('8 章全部规则的默认与预设都能在沙箱内生成可视化帧', async () => {
  for (const kind of ALL_KINDS) {
    const doc = businessTemplateDoc(kind);
    const rules = doc.nodes.filter(({ type }) => type === 'aiRuleBlock');
    assert.ok(rules.length >= 1, kind);
    for (const node of rules) {
      const payload = parseAiRulePayload(node.payload)!;
      const wired = doc.wires.some((w) => w.to === node.id && (w.toPort ?? 'in') === 'in');
      const presetSource = doc.nodes.find((n) => n.id === doc.wires.find((w) => w.to === node.id && (w.toPort ?? 'in') === 'in')?.from);
      const presettable = presetSource?.type === 'slider' || presetSource?.type === 'bizTableSource';
      if (wired && presettable && payload.presets?.length) {
        assert.ok(payload.presetSource, `${kind}:${node.id} 可写主源需要 presetSource 联动`);
      }
      for (const preset of [undefined, ...payload.presets ?? []]) {
        const changed = !preset ? doc
          : payload.presetSource ? applyRulePreset(doc, node.id, preset, payload.presetSource)
          : { ...doc, nodes: doc.nodes.map((n) => n.id === node.id ? { ...n, params: { ...n.params, ...preset.params } } : n) };
        const result = await runNode(changed, node.id);
        assert.ok(result.frames.length > 0, `${kind}:${node.id} 预设 ${preset?.label ?? '默认'}`);
        assert.ok(result.frames.every((f) =>
          f.shapes?.items.length || f.grid?.cells.length || f.series?.length
          || f.rows?.length || f.timeline?.length || f.graph?.nodes.length), `${kind}:${node.id} 帧无内容`);
      }
    }
  }
}, { timeout: 300_000 });

test('biz01：月净利公式、敏感性热图当前点、盈亏平衡与回本', async () => {
  const doc = businessTemplateDoc('biz01-unit-economics');
  const grid = await runNode(doc, 'sensGrid');
  // 月净利 = 120×0.65×2500 − 200000 − 50000 = −55000
  assert.equal(grid.data.monthlyNet, -55000);
  assert.ok(Math.abs(grid.data.breakEvenPrice - 153.8) < 1);
  const frame = grid.frames[0]!;
  assert.equal(frame.grid?.palette, 'diverging');
  assert.ok(frame.grid!.cells.length === 9 && frame.grid!.cells[0]!.length === 8);
  const payback = await runNode(doc, 'payback');
  assert.equal(payback.data.breakEvenSales, Math.ceil(250000 / 78)); // 3206 单/期
  assert.ok(Math.abs(payback.data.marginPerUnit - 78) < 0.01);
  // 首月销量≈2500 时当月净利 2500×78−250000 <0，但增长曲线下后几期转正
  assert.ok(payback.data.paybackMonth > 0 && payback.data.paybackMonth <= 12);
});

test('biz02：折现率上行 NPV 单调下降，蒙特卡洛亏损概率随情景变厚', async () => {
  const doc = businessTemplateDoc('biz02-investment-npv');
  const npvAt = (wacc: number) => {
    setParam(doc, 'wacc', 'v', wacc);
    const ctx = makeCtx(doc, new Map());
    const out = evalOutput(ctx, 'discount', 'npv');
    return out?.kind === 'scalar' ? out.v : NaN;
  };
  const npvLow = npvAt(0.05);
  const npvMid = npvAt(0.1);
  const npvHigh = npvAt(0.2);
  assert.ok(npvLow > npvMid && npvMid > npvHigh, `NPV 应随折现率下降：${npvLow} ${npvMid} ${npvHigh}`);
  const base = await runNode(doc, 'mcRisk');
  assert.ok(base.data.p50 > 0, '基准现金流 P50 应为正');
  const stress = applyRulePreset(doc, 'mcRisk', { label: '低现金流压力', params: { spread: 0.4 }, text: '月份,现金流\n1月,120000\n2月,140000\n3月,110000\n4月,160000\n5月,130000\n6月,150000\n7月,170000\n8月,150000\n9月,180000\n10月,160000\n11月,190000\n12月,170000' }, 'text');
  assert.equal(stress.nodes.find((n) => n.id === 'cashflow')!.text?.includes('190000'), true, 'presetSource:text 应回写现金流源');
  const stressed = await runNode(stress, 'mcRisk');
  assert.ok(stressed.data.pLoss > base.data.pLoss, '低现金流+高波动应有更高亏损概率');
});

test('biz03：Cohort 半衰期与留存 +5pp 的 12 周复利增益', async () => {
  const doc = businessTemplateDoc('biz03-growth-cohort');
  const cohort = await runNode(doc, 'cohort');
  assert.ok(Math.abs(cohort.data.week12Rate - Math.pow(0.65, 11)) < 0.001);
  assert.ok(Math.abs(cohort.data.halfLifeWeeks - Math.log(0.5) / Math.log(0.65)) < 0.05);
  const funnel = await runNode(doc, 'funnel');
  assert.equal(funnel.data.bottleneck, '点击率'); // 5% 是四层转化中最低
  assert.equal(funnel.data.paid, 200); // 200000×0.05×0.25×0.08
  const ltv = await runNode(doc, 'ltv');
  assert.ok(Math.abs(ltv.data.ltv - 120 / 0.35) < 1);
  assert.ok(ltv.data.gainRet5 > 0 && ltv.data.gainReach2x > 0);
  setParam(doc, 'retention', 'v', 0.85);
  const ltvHigh = await runNode(doc, 'ltv');
  assert.ok(ltvHigh.data.ltv > ltv.data.ltv, '留存提升 → LTV 提升');
  assert.ok(ltvHigh.data.gmvBase > ltv.data.gmvBase, '留存提升 → 12 周累计活跃提升（复利）');
});

test('biz04：样本量、功效达标天数、CI 显著日与早停假阳性', async () => {
  const doc = businessTemplateDoc('biz04-ab-experiment');
  const power = await runNode(doc, 'abPower');
  // p0=0.1 lift=0.12 → n≈10356/组，4000 流量下 ≈6 天达标
  assert.ok(Math.abs(power.data.requiredSamples - 10356) < 60);
  assert.ok(power.data.daysRequired >= 5 && power.data.daysRequired <= 8);
  assert.ok(power.data.power30 > 0.9);
  setParam(doc, 'traffic', 'v', 1000);
  const slow = await runNode(doc, 'abPower');
  assert.ok(slow.data.daysRequired > power.data.daysRequired, '流量降 → 达标天数增');
  const ciLow = await runNode(doc, 'ci'); // traffic=1000：区间更宽，显著更晚
  assert.equal(ciLow.data.firstSignificantDay, 14);
  setParam(doc, 'traffic', 'v', 4000);
  const ciBase = await runNode(doc, 'ci');
  assert.equal(ciBase.data.firstSignificantDay, 3);
  const peek = await runNode(doc, 'peek');
  assert.ok(peek.data.fpRate30 > 0.1, `偷看假阳性率应远超 5%，实得 ${peek.data.fpRate30}`);
  assert.ok(peek.data.fpRate30 > peek.data.fpRate7, '偷看越久误判越多');
});

test('biz05：基准 16 天关键路径 T1→T3→T5→T6、浮动与延期/人力传导', async () => {
  const doc = businessTemplateDoc('biz05-cpm-delivery');
  const graph = await runNode(doc, 'depGraph');
  assert.equal(graph.data.totalDays, 16);
  assert.deepEqual(graph.data.critical, ['T1', 'T3', 'T5', 'T6']);
  assert.deepEqual(graph.data.slacks, { T1: 0, T2: 1, T3: 0, T4: 3, T5: 0, T6: 0 });
  setParam(doc, 'delay', 'v', 3);
  const delayed = await runNode(doc, 'depGraph');
  assert.equal(delayed.data.totalDays, 19); // 关键任务延期 1:1 传导
  assert.equal(delayed.data.slacks.T2, 4); // 非关键任务浮动吸收延期：1→4 天
  setParam(doc, 'depGraph', 'taskSel', 2); // 改为 T2 前端延期 → 关键路径切到 T2 链
  const switched = await runNode(doc, 'depGraph');
  assert.ok(switched.data.critical.includes('T2') && !switched.data.critical.includes('T3'), 'T2 延期 3 天后关键路径应切到 T2 链');
  assert.equal(switched.data.totalDays, 18); // 3+(6+3)+4+2
  setParam(doc, 'depGraph', 'taskSel', 3);
  setParam(doc, 'delay', 'v', 0);
  const gantt = await runNode(doc, 'gantt');
  assert.ok(gantt.frames.length >= 6);
  const load = await runNode(doc, 'load');
  assert.equal(load.data.peak, 6); // T2+T3+T4 并行期 2+3+1=6 人
  assert.ok(load.data.overDays.length > 0, 'cap=4 必有超载日');
  setParam(doc, 'cap', 'v', 6);
  const staffed = await runNode(doc, 'load');
  assert.equal(staffed.data.overDays.length, 0);
});

test('biz06：EOQ 最小点、库存服务水平、排队 ρ≥1 发散', async () => {
  const doc = businessTemplateDoc('biz06-inventory-queue');
  const eoq = await runNode(doc, 'eoq');
  // 日需求 120×300 = 36000/年；EOQ = √(2·36000·300/6) ≈ 1897
  assert.ok(Math.abs(eoq.data.eoq - 1897) < 5);
  assert.ok(eoq.data.costAtHalf > eoq.data.minCost && eoq.data.costAt2x > eoq.data.minCost, 'EOQ 应为 U 型最小点');
  const stock = await runNode(doc, 'stock');
  assert.ok(stock.data.serviceLevel >= 0 && stock.data.serviceLevel <= 1);
  assert.ok(stock.data.orders >= 1);
  const queue = await runNode(doc, 'queue');
  assert.equal(queue.data.stable, true); // s=4, ρ=20/32=0.625
  setParam(doc, 'agents', 'v', 2);
  const diverge = await runNode(doc, 'queue');
  assert.equal(diverge.data.stable, false); // ρ=1.25 发散
  setParam(doc, 'agents', 'v', 3);
  const tight = await runNode(doc, 'queue');
  assert.ok(tight.data.waitMin > queue.data.waitMin!, 'ρ 越高等待越久');
});

test('biz07：四维加权排名与第一名翻转阈值', async () => {
  const doc = businessTemplateDoc('biz07-decision-matrix');
  const flip = await runNode(doc, 'flip');
  assert.equal(flip.data.winner, '平衡方案'); // w=0.25 均权
  assert.ok(flip.data.flipAt > 0, '应存在第一名翻转点');
  setParam(doc, 'costW', 'v', 0.8);
  const heavy = await runNode(doc, 'flip');
  assert.equal(heavy.data.winner, '低成本方案'); // 重成本 → 低成本方案胜出
  const compare = await runNode(doc, 'compare');
  assert.equal(compare.data.winner, '低成本方案');
  // 决策卡引擎求值（bizDecisionMatrix）同步翻转
  const ctx = makeCtx(doc, new Map());
  const matrixOut = evalOutput(ctx, 'matrix', 'out');
  assert.ok(matrixOut?.kind === 'series');
  assert.ok((matrixOut as { title?: string }).title?.includes('加权'));
});

test('biz08：边际最优分配 ≥ 平分，帕累托最小方差为内点', async () => {
  const doc = businessTemplateDoc('biz08-budget-portfolio');
  const alloc = await runNode(doc, 'alloc');
  assert.ok(alloc.data.optRev > alloc.data.equalRev, `边际最优 ${alloc.data.optRev} 应高于平分 ${alloc.data.equalRev}`);
  assert.ok(alloc.data.uplift > 0);
  const mroi = await runNode(doc, 'mroi');
  const total = mroi.data.alloc.reduce((a: number, b: number) => a + b, 0);
  assert.ok(Math.abs(total - 90) < 2, '分配合计应≈总预算');
  assert.ok(mroi.data.alloc[0] > mroi.data.alloc[2], '搜索广告边际更高应分得更多');
  const pareto = await runNode(doc, 'pareto');
  assert.ok(pareto.data.minVarW > 0 && pareto.data.minVarW < 1, '最小方差应为内点组合');
});
