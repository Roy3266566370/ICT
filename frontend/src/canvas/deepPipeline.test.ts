import test from 'node:test';
import assert from 'node:assert/strict';
import { deepWorkshopDoc } from './deepWorkshop.ts';
import { DEEP_PIPELINES, deepPipelinePorts } from './deepPipeline.ts';
import { evalOutput, inputValues, makeCtx } from './engine.ts';
import type { CanvasDoc, CanvasNode, PortValue } from './types.ts';
import type { DeepPanoramaKind } from './deepPanoramaTypes.ts';

const KINDS: DeepPanoramaKind[] = ['dl-mlp-backprop', 'dl-cnn-resnet', 'dl-transformer-attention', 'dl-llm-inference-lora', 'dl-diffusion-latent', 'dl-rl-agent'];

function assertFiniteDeep(value: unknown, path = 'root', seen = new Set<object>(), depth = 0): void {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} 应为有限数`);
  if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.slice(0, 260).forEach((item, index) => assertFiniteDeep(item, `${path}[${index}]`, seen, depth + 1));
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) assertFiniteDeep(item, `${path}.${key}`, seen, depth + 1);
}

function stageNodes(doc: CanvasDoc): CanvasNode[] {
  return doc.nodes.filter((node) => node.type === 'deepStage');
}

test('六套深度学习沙盘均生成至少五块积木和四条真实连线', () => {
  for (const kind of KINDS) {
    const doc = deepWorkshopDoc(kind);
    const stages = stageNodes(doc);
    assert.equal(stages.length, 4, kind);
    assert.ok(doc.nodes.length >= 6, `${kind} 应包含任务卡、阶段与滑杆`);
    assert.ok(doc.wires.length >= 5, `${kind} 应包含数据流和滑杆真实连线`);
    assert.ok(doc.nodes.some((node) => node.type === 'textNote' && node.text?.includes('探究任务')));
    assert.equal(doc.nodes.filter((node) => node.type === 'slider').length, 2);
    assert.ok(doc.panel?.view_node_ids.length === 3);
  }
});

test('deepStage 动态端口无悬空连线，slider/scalar 兼容成立', () => {
  for (const kind of KINDS) {
    const doc = deepWorkshopDoc(kind);
    const byId = new Map(doc.nodes.map((node) => [node.id, node]));
    for (const wire of doc.wires) {
      const from = byId.get(wire.from);
      const to = byId.get(wire.to);
      assert.ok(from && to, `${kind} wire ${wire.id} 两端节点存在`);
      const outPorts = from!.type === 'deepStage' ? deepPipelinePorts(from!, 'out') : [{ id: 'out' }];
      const inPorts = to!.type === 'deepStage' ? deepPipelinePorts(to!, 'in') : [{ id: 'in' }];
      const out = outPorts.some((port) => port.id === (wire.fromPort ?? 'out'));
      const input = inPorts.some((port) => port.id === (wire.toPort ?? 'in'));
      assert.ok(out && input, `${kind} wire ${wire.id} 端口存在`);
    }
    const source = stageNodes(doc).find((node) => node.payload?.endsWith('/source'))!;
    assert.ok(deepPipelinePorts(source, 'out').some((port) => port.kind === 'deepData'));
    assert.ok(deepPipelinePorts(source, 'in').some((port) => port.kind === 'scalar'));
  }
});

test('滑杆覆盖沿源头—核心—下游全链路联动，未接线下游默认参数兜底', () => {
  const doc = deepWorkshopDoc('dl-mlp-backprop');
  const slider = doc.nodes.find((node) => node.type === 'slider' && node.text?.includes('学习率'))!;
  slider.params.v = 0.055;
  const ctx = makeCtx(doc, new Map());
  const source = doc.nodes.find((node) => node.payload === 'dl-mlp-backprop/source')!;
  const viewB = doc.nodes.find((node) => node.payload === 'dl-mlp-backprop/viewB')!;
  const sourceValue = evalOutput(ctx, source.id);
  const viewValue = evalOutput(ctx, viewB.id);
  assert.equal(sourceValue?.kind, 'deepData');
  assert.equal(viewValue?.kind, 'deepData');
  if (sourceValue?.kind === 'deepData') assert.equal(sourceValue.params.lr, 0.055);
  if (viewValue?.kind === 'deepData') assert.equal(viewValue.params.lr, 0.055);

  const isolated: CanvasNode = { id: 'isolated', type: 'deepStage', x: 0, y: 0, payload: 'dl-mlp-backprop/viewB', params: {} };
  const fallbackDoc: CanvasDoc = { ...doc, nodes: [...doc.nodes, isolated] };
  const fallback = evalOutput(makeCtx(fallbackDoc, new Map()), isolated.id);
  assert.equal(fallback?.kind, 'deepData');
  if (fallback?.kind === 'deepData') {
    assert.equal(fallback.params.scenario, DEEP_PIPELINES['dl-mlp-backprop'].defaults.scenario);
    assert.ok(Number.isFinite(fallback.params.lr));
  }
});

test('六条管线求值产出 deepData 且数值快照无 NaN/Infinity', () => {
  for (const kind of KINDS) {
    const doc = deepWorkshopDoc(kind);
    const ctx = makeCtx(doc, new Map());
    for (const node of stageNodes(doc)) {
      const value = evalOutput(ctx, node.id);
      assert.equal(value?.kind, 'deepData', `${kind}/${node.payload}`);
      assert.ok(value);
      if (value?.kind === 'deepData') {
        assert.equal(value.pipeline, kind);
        assertFiniteDeep(value.params, `${kind}.params`);
        assertFiniteDeep(value.state[node.stage], `${kind}.${node.stage}.state`);
      }
      const inputs = inputValues(ctx, node);
      assert.ok(inputs);
    }
  }
});

test('live 广播帧优先于静态求值，实现播放不写文档历史', () => {
  const doc = deepWorkshopDoc('dl-cnn-resnet');
  const source = doc.nodes.find((node) => node.payload === 'dl-cnn-resnet/source')!;
  const core = doc.nodes.find((node) => node.payload === 'dl-cnn-resnet/core')!;
  const ctx = makeCtx(doc, new Map());
  const base = evalOutput(ctx, source.id);
  assert.equal(base?.kind, 'deepData');
  if (base?.kind !== 'deepData') return;
  const live = new Map([[`${source.id}|out`, { ...base, frame: 17 } as PortValue]]);
  const liveCtx = makeCtx(doc, live);
  const downstream = evalOutput(liveCtx, core.id);
  assert.equal(downstream?.kind, 'deepData');
  if (downstream?.kind === 'deepData') assert.equal(downstream.frame, 17);
});
