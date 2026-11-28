import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAiRulePayload } from './aiRuleBlock.ts';
import { ruleAuxiliaryOutputs, ruleNamedInputs } from './aiRulePorts.ts';
import {
  MAX_COMPOSITE_DEPTH,
  collectCandidateExposedParams,
  getLayerAtPath,
  pickDefaultExposedParams,
  pickDefaultPreviewNodeId,
  updateLayerAtPath,
  updateSubNodeParams,
  wouldExceedDepthLimit,
} from './compositeUtils.ts';
import {
  exportBlueprintPackage,
  instantiateCustomBlock,
  mergeBlueprintLibraries,
  parseBlueprintPackage,
  type CustomCompositeBlockRecord,
} from './customBlocks.ts';
import { collectNextDelayStates, evalOutput, getSubCtx, listDelayRegisterIds, makeCtx } from './engine.ts';
import { runRuleInSandbox } from './ruleSandbox.ts';
import type { CanvasDoc, CanvasNode, CompositeSub, PortValue } from './types.ts';

function fakeWorker(source: string) {
  let listener: ((event: MessageEvent) => void) | null = null;
  const workerSelf: Record<string, unknown> = {
    postMessage(data: unknown) {
      queueMicrotask(() => listener?.({ data } as MessageEvent));
    },
  };
  new Function('self', source)(workerSelf);
  return {
    set onmessage(fn: ((event: MessageEvent) => void) | null) { listener = fn; },
    get onmessage() { return listener; },
    onerror: null,
    postMessage(data: unknown) {
      (workerSelf.onmessage as (event: MessageEvent) => void)({ data } as MessageEvent);
    },
    terminate() {},
  };
}

test('Composite 2.0: 自动提取透出参数、选择默认封面，并在外壳直接调参触发子图重新求值', () => {
  const innerNodes: CanvasNode[] = [
    { id: 'pi1', type: 'portIn', x: 0, y: 0, params: {} },
    { id: 's1', type: 'slider', x: 20, y: 40, params: { v: 0.25, min: 0, max: 1, step: 0.05 }, text: '弹性系数' },
    { id: 'r1', type: 'rotor', x: 180, y: 40, params: { theta: 0 } },
    { id: 'v1', type: 'transformView', x: 360, y: 40, params: {} },
    { id: 'po1', type: 'portOut', x: 520, y: 40, params: {} },
  ];
  const candidates = collectCandidateExposedParams(innerNodes);
  assert.ok(candidates.some((p) => p.nodeId === 's1' && p.paramKey === 'v' && p.label === '弹性系数'));

  const defaults = pickDefaultExposedParams(innerNodes, undefined, 3);
  assert.ok(defaults.length >= 1 && defaults.length <= 3);
  assert.equal(pickDefaultPreviewNodeId(innerNodes), 'v1');

  const sub: CompositeSub = {
    nodes: innerNodes,
    wires: [
      { id: 'w1', from: 's1', to: 'r1', toPort: 'in' },
      { id: 'w2', from: 'r1', to: 'v1', toPort: 'in' },
      { id: 'w3', from: 'r1', to: 'po1', toPort: 'in' },
    ],
    ports: [
      { id: 'pi1', dir: 'in', label: '外部输入', kind: 'scalar' },
      { id: 'po1', dir: 'out', label: '旋转矩阵', kind: 'matrix2' },
    ],
    exposedParams: defaults,
    previewNodeId: 'v1',
    summary: '可外露弹性参数的旋转模块',
  };

  // 外壳修改透出参数 s1.v：0.25 圈（90°）→ 0.5 圈（180°）
  const updatedSub = updateSubNodeParams(sub, 's1', { v: 0.5 });
  const doc: CanvasDoc = {
    version: 1, title: '复合测试', zoom: 1, strokes: [], wires: [],
    nodes: [{ id: 'comp1', type: 'composite', x: 100, y: 100, params: {}, text: '供需模块', sub: updatedSub }],
  };
  const ctx = makeCtx(doc, new Map());
  const out = evalOutput(ctx, 'comp1', 'po1');
  assert.equal(out?.kind, 'matrix2');
  if (out?.kind === 'matrix2') {
    assert.ok(Math.abs(out.a - (-1)) < 1e-6);
    assert.ok(Math.abs(out.d - (-1)) < 1e-6);
  }
  // 子求值上下文可供封面预览节点实时取数
  const childCtx = getSubCtx(ctx, doc.nodes[0]!);
  assert.ok(childCtx);
  assert.equal(evalOutput(childCtx, 'r1')?.kind, 'matrix2');
});

test('Composite 2.0: 双击钻入多层子画布、面包屑导航、不可变写回与 6 层深度软限制', () => {
  const deepChild: CanvasNode = {
    id: 'comp2', type: 'composite', x: 40, y: 40, params: {}, text: '价格弹性',
    sub: {
      nodes: [{ id: 's_inner', type: 'slider', x: 10, y: 10, params: { v: 0.2 } }],
      wires: [],
      ports: [],
    },
  };
  const rootComp: CanvasNode = {
    id: 'comp1', type: 'composite', x: 10, y: 10, params: {}, text: '供需模块',
    sub: {
      nodes: [deepChild],
      wires: [],
      ports: [],
    },
  };
  const doc: CanvasDoc = {
    version: 1, title: '主画布', zoom: 1, strokes: [], wires: [],
    nodes: [rootComp],
  };

  const layer = getLayerAtPath(doc, ['comp1', 'comp2']);
  assert.deepEqual(layer.breadcrumbs.map((b) => b.title), ['供需模块', '价格弹性']);
  assert.equal(layer.nodes[0]?.id, 's_inner');

  const nextDoc = updateLayerAtPath(doc, ['comp1', 'comp2'], (nodes, wires) => ({
    nodes: nodes.map((n) => (n.id === 's_inner' ? { ...n, params: { v: 0.85 } } : n)),
    wires,
  }));
  assert.equal(getLayerAtPath(nextDoc, ['comp1', 'comp2']).nodes[0]?.params.v, 0.85);
  assert.equal(getLayerAtPath(doc, ['comp1', 'comp2']).nodes[0]?.params.v, 0.2);

  // 嵌套深度检查（当前路径 4 层 + 选中的 2 层复合积木 + 新建 1 层 = 7 > 6）
  assert.equal(wouldExceedDepthLimit(4, [rootComp], MAX_COMPOSITE_DEPTH), true);
  assert.equal(wouldExceedDepthLimit(2, [rootComp], MAX_COMPOSITE_DEPTH), false);
});

test('AI 积木自定义多输入/多输出端口：清洗、命名输入注入沙箱与多路输出分流', async () => {
  const payload = normalizeAiRulePayload({
    prompt: '市场出清多路汇聚',
    title: '市场出清',
    summary: '接收供给、需求与政策滑块，输出均衡价与超额需求曲线',
    controls: [{ key: 'tax', label: '税率', value: 0.1, min: 0, max: 0.5, step: 0.05 }],
    inputs: [
      { id: 'supply', label: '供给量', kind: 'scalar' },
      { id: 'demand', label: '需求量', kind: 'scalar' },
      { id: 'policy', label: '政策冲击', kind: 'scalar' },
      { id: 'bad id', label: '非法端口', kind: 'scalar' },
    ],
    outputs: [
      { id: 'price', label: '均衡价格', kind: 'scalar' },
      { id: 'gapSeries', label: '供需缺口曲线', kind: 'series' },
      { id: 'invalid', label: '不支持的类型', kind: 'matrix2' },
    ],
    preferredView: 'chart',
    code: `function run({ params, inputs }) {
      const s = inputs.supply ? inputs.supply.v : 10;
      const d = inputs.demand ? inputs.demand.v : 14;
      const p = inputs.policy ? inputs.policy.v : 1;
      const price = Number((10 + (d - s) * 0.5 + p - params.tax * 2).toFixed(3));
      const gap = [d - s, (d - s) * 0.6, (d - s) * 0.2];
      return {
        data: { value: price, outputs: { price, gapSeries: gap } },
        frames: [{ title: '市场出清', summary: '均衡价=' + price, series: [{ label: '缺口', values: gap }] }],
      };
    }`,
  });

  assert.equal(payload.inputs?.length, 3);
  assert.equal(payload.outputs?.length, 2);

  const values: Record<string, PortValue | null> = {
    supply: { kind: 'scalar', v: 10 },
    demand: { kind: 'scalar', v: 18 },
    policy: { kind: 'scalar', v: 2 },
  };
  const named = ruleNamedInputs(values, payload);
  assert.equal((named.inputs.supply as { v: number }).v, 10);
  assert.equal((named.inputs.demand as { v: number }).v, 18);
  assert.equal(named.upstream.length, 3);

  const run = await runRuleInSandbox(
    payload.code,
    { text: '', params: { tax: 0.5 }, upstream: named.upstream, inputs: named.inputs },
    { workerFactory: fakeWorker },
  );
  const outputs = ruleAuxiliaryOutputs(run.result, payload.title, payload.outputs, payload.controls, run.elapsedMs);
  assert.deepEqual(outputs.price, { kind: 'scalar', v: 15 });
  assert.equal(outputs.gapSeries?.kind, 'series');
  if (outputs.gapSeries?.kind === 'series') {
    assert.deepEqual(outputs.gapSeries.values, [8, 4.8, 1.6]);
  }
});

test('delayRegister: 打破反馈闭环、初始值回退、原子同步步进及复合积木内步进', () => {
  // 场景：delayA (init=1) → delayB (init=5) 且 delayB → delayA（双寄存器互换闭环，检验原子提交无竞态）
  const doc: CanvasDoc = {
    version: 1, title: '双寄存器互换反馈环', zoom: 1, strokes: [],
    nodes: [
      { id: 'regA', type: 'delayRegister', x: 0, y: 0, params: { init: 1 } },
      { id: 'regB', type: 'delayRegister', x: 200, y: 0, params: { init: 5 } },
      {
        id: 'comp', type: 'composite', x: 400, y: 0, params: {}, text: '内含记忆',
        sub: {
          nodes: [
            { id: 'pi', type: 'portIn', x: 0, y: 0, params: {} },
            { id: 'regInner', type: 'delayRegister', x: 100, y: 0, params: { init: 0 } },
            { id: 'po', type: 'portOut', x: 200, y: 0, params: {} },
          ],
          wires: [
            { id: 'cw1', from: 'pi', to: 'regInner', toPort: 'next' },
            { id: 'cw2', from: 'regInner', to: 'po', toPort: 'in' },
          ],
          ports: [
            { id: 'pi', dir: 'in', label: 'in', kind: 'scalar' },
            { id: 'po', dir: 'out', label: 'out', kind: 'scalar' },
          ],
        },
      },
    ],
    wires: [
      { id: 'w1', from: 'regA', to: 'regB', toPort: 'next' },
      { id: 'w2', from: 'regB', to: 'regA', toPort: 'next' },
      { id: 'w3', from: 'regA', to: 'comp', toPort: 'pi' },
    ],
  };

  assert.deepEqual(listDelayRegisterIds(doc.nodes), ['regA', 'regB', 'regInner']);

  const live = new Map<string, PortValue>();
  // t=0：未步进前输出各自 init
  let ctx = makeCtx(doc, live);
  assert.deepEqual(evalOutput(ctx, 'regA'), { kind: 'scalar', v: 1 });
  assert.deepEqual(evalOutput(ctx, 'regB'), { kind: 'scalar', v: 5 });
  assert.deepEqual(evalOutput(ctx, 'comp', 'po'), { kind: 'scalar', v: 0 });

  // t=1：原子步进 → regA=5, regB=1, regInner=1
  for (const [id, val] of collectNextDelayStates(ctx)) live.set(id, val);
  ctx = makeCtx(doc, live);
  assert.deepEqual(evalOutput(ctx, 'regA'), { kind: 'scalar', v: 5 });
  assert.deepEqual(evalOutput(ctx, 'regB'), { kind: 'scalar', v: 1 });
  assert.deepEqual(evalOutput(ctx, 'comp', 'po'), { kind: 'scalar', v: 1 });

  // t=2：再次原子步进 → regA=1, regB=5, regInner=5
  for (const [id, val] of collectNextDelayStates(ctx)) live.set(id, val);
  ctx = makeCtx(doc, live);
  assert.deepEqual(evalOutput(ctx, 'regA'), { kind: 'scalar', v: 1 });
  assert.deepEqual(evalOutput(ctx, 'regB'), { kind: 'scalar', v: 5 });
  assert.deepEqual(evalOutput(ctx, 'comp', 'po'), { kind: 'scalar', v: 5 });
});

test('蓝图包导入导出、版本校验、Composite 2.0 实例化重映射与云端合并突破上限', () => {
  const block: CustomCompositeBlockRecord = {
    id: 'cb_1',
    kind: 'composite',
    title: 'PID 控制器',
    summary: '比例-积分-微分闭环控制模块',
    createdAt: 1700000000000,
    sub: {
      nodes: [
        { id: 's_kp', type: 'slider', x: 0, y: 0, params: { v: 0.6, min: 0, max: 2 } },
        { id: 'v_out', type: 'spark', x: 180, y: 0, params: {} },
      ],
      wires: [{ id: 'w1', from: 's_kp', to: 'v_out', toPort: 'in' }],
      ports: [],
      exposedParams: [{ nodeId: 's_kp', paramKey: 'v', label: 'Kp 增益', min: 0, max: 2, step: 0.05 }],
      previewNodeId: 'v_out',
      summary: '比例-积分-微分闭环控制模块',
    },
  };

  // 导出再导入
  const pkg = exportBlueprintPackage([block]);
  assert.equal(pkg.format, 'wanxiang-blueprints');
  assert.equal(pkg.version, 1);

  const imported = parseBlueprintPackage(JSON.stringify(pkg));
  assert.equal(imported.length, 1);
  assert.equal(imported[0]?.title, 'PID 控制器');

  // 实例化后，exposedParams.nodeId 和 previewNodeId 应正确重映射到新克隆的内部节点 id
  const inst = instantiateCustomBlock(imported[0]!, 100, 100);
  assert.equal(inst.type, 'composite');
  const innerIds = new Set(inst.sub?.nodes.map((n) => n.id));
  assert.ok(inst.sub?.exposedParams?.[0]);
  assert.ok(innerIds.has(inst.sub.exposedParams[0].nodeId));
  assert.notEqual(inst.sub.exposedParams[0].nodeId, 's_kp');
  assert.ok(inst.sub?.previewNodeId && innerIds.has(inst.sub.previewNodeId));
  assert.equal(inst.sub?.summary, '比例-积分-微分闭环控制模块');

  // 非法版本被拒绝
  assert.throws(() => parseBlueprintPackage(JSON.stringify({ ...pkg, version: 99 })), /不支持的蓝图包版本/);

  // 合并云端与本地蓝图，可超过 24 个上限；同内容不同 ID（含键序差异）自动去重保留云端
  const cloudList = Array.from({ length: 30 }, (_, i) => ({
    ...block,
    id: `bp_${i}`,
    title: `云端模块 ${i}`,
    createdAt: 1700000000000 + i,
    source: 'cloud' as const,
  }));
  const merged = mergeBlueprintLibraries(cloudList, [block]);
  assert.equal(merged.length, 31);

  const cloudSameContent: CustomCompositeBlockRecord = {
    ...block,
    id: 'bp_synced_1',
    source: 'cloud',
    sub: {
      ports: block.sub.ports,
      wires: block.sub.wires,
      nodes: [...block.sub.nodes].reverse(),
      summary: block.sub.summary,
    },
  };
  const deduped = mergeBlueprintLibraries([cloudSameContent], [block]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.id, 'bp_synced_1');
});
