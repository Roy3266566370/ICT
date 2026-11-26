import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { applyRulePreset, parseAiRulePayload } from './aiRuleBlock.ts';
import { ruleUpstream } from './aiRulePorts.ts';
import { inputValues, makeCtx } from './engine.ts';
import { runRuleInSandbox } from './ruleSandbox.ts';
import { buildTemplateDoc, WORKSHOP_PLUGIN_CATALOG, workshopPluginConfigForTemplate } from './templateCatalog.ts';
import { LINALG_TOPICS, VISIBLE_LINALG_TEMPLATES } from './linalgTemplates.ts';
import type { FrameShapes, PipelineResult } from './lab408PipelineTypes.ts';
import type { CanvasDoc } from './types.ts';
import { compatiblePorts } from './wireRecommend.ts';

const KINDS = [
  'la01-matrix-det-basis', 'la02-gauss-lu-rank', 'la03-four-subspaces',
  'la04-ortho-qr-ls', 'la05-eigen-dynamics', 'la06-quadform-svd-pca',
] as const;

test('线性代数的六章独立注册为通文册插件，各章提供三个视角', () => {
  const entries = WORKSHOP_PLUGIN_CATALOG.filter(entry => entry.category === '线性代数');
  assert.deepEqual(entries.map(entry => entry.kind), [...KINDS]);
  assert.deepEqual(VISIBLE_LINALG_TEMPLATES.map(entry => entry.kind), [...KINDS]);
  assert.deepEqual(LINALG_TOPICS.map(({ id }) => VISIBLE_LINALG_TEMPLATES.filter(entry => entry.topic === id).length), [2, 2, 2]);
  for (const kind of KINDS) {
    const doc = buildTemplateDoc(kind);
    assert.equal(doc.panel?.view_node_ids.length, 3, kind);
    const plugin = workshopPluginConfigForTemplate(entries.find(entry => entry.kind === kind)!);
    assert.deepEqual(plugin.doc, doc, `${kind} 离线插件携带自己的画布`);
    assert.equal(plugin.display_mode, 'full', `${kind} 默认显示视角专属控件`);
  }
});

test('共享输入确实接到了每个视角，端口相容，且公共数值控件没有重复', async () => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../../', import.meta.url)),
    cacheDir: join(tmpdir(), 'ict-linalg-sandboxes-vite'),
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: { '@': fileURLToPath(new URL('../', import.meta.url)) } },
  });
  try {
    const { nodePorts } = await server.ssrLoadModule('/src/canvas/nodes.tsx') as typeof import('./nodes.tsx');
    for (const kind of KINDS) {
      const doc = buildTemplateDoc(kind);
      assert.deepEqual(doc.panel?.exposed_params.map(param => param.node_id), ['scene', 'amount']);
      const occupied = new Set<string>();
      for (const wire of doc.wires) {
        const source = doc.nodes.find(node => node.id === wire.from)!;
        const target = doc.nodes.find(node => node.id === wire.to)!;
        assert.equal(source.type, 'slider');
        const output = nodePorts(source, 'out').find(port => port.id === (wire.fromPort ?? 'out'))!;
        const input = nodePorts(target, 'in').find(port => port.id === (wire.toPort ?? 'in'))!;
        assert.ok(output && input && compatiblePorts(source, output.id, output.kind, target, input), wire.id);
        const address = target.id + ':' + input.id;
        assert.ok(!occupied.has(address), wire.id);
        occupied.add(address);
      }
      for (const id of doc.panel!.view_node_ids) {
        assert.ok(occupied.has(id + ':in') && occupied.has(id + ':aux'), id);
        const payload = parseAiRulePayload(doc.nodes.find(node => node.id === id)!.payload)!;
        assert.deepEqual(payload.presetSource, { param: 'scene', auxiliaryParam: 'amount' });
        assert.ok(!payload.controls.some(item => item.key === 'amount'), id);
      }
    }
  } finally {
    await server.close();
  }
});

async function runNode(doc: CanvasDoc, nodeId: string, params: Record<string, number> = {}, text?: string) {
  const node = doc.nodes.find(item => item.id === nodeId)!;
  const payload = parseAiRulePayload(node.payload)!;
  return (await runRuleInSandbox(payload.code, {
    text: text ?? node.text ?? payload.defaultText ?? '',
    params: { ...node.params, ...params },
    upstream: ruleUpstream(inputValues(makeCtx(doc, new Map()), node), payload.sampleProfile),
  }, {
    timeoutMs: 3000,
    workerFactory(source) {
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
      thread.on('message', data => worker.onmessage?.({ data } as MessageEvent));
      thread.on('error', error => worker.onerror?.(error as unknown as ErrorEvent));
      return worker;
    },
  })).result;
}

function checkShapeBounds(shapes: FrameShapes) {
  const [width, height] = shapes.viewBox!;
  const check = ([x, y]: [number, number]) =>
    assert.ok(x >= 24 - 1e-8 && x <= width - 24 + 1e-8 && y >= 24 - 1e-8 && y <= height - 24 + 1e-8,
      `图元 (${x}, ${y}) 超出 ${width}×${height} 的安全范围`);
  for (const shape of shapes.items) {
    switch (shape.kind) {
      case 'circle': check([shape.cx - shape.r, shape.cy - shape.r]); check([shape.cx + shape.r, shape.cy + shape.r]); break;
      case 'rect': check([shape.x, shape.y]); check([shape.x + shape.w, shape.y + shape.h]); break;
      case 'arrow':
      case 'line': check([shape.x1, shape.y1]); check([shape.x2, shape.y2]); break;
      case 'polygon': shape.points.forEach(check); break;
      case 'text': check([shape.x, shape.y]); break;
    }
  }
}

function near(actual: unknown, expected: number, tolerance = 1e-6) {
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < tolerance, `${actual} ≉ ${expected}`);
}

test('18 条规则在默认值和所有预设下产生可视帧，数值、轨迹及安全框一致', async () => {
  const results = new Map<string, PipelineResult>();
  for (const kind of KINDS) {
    const base = buildTemplateDoc(kind);
    for (const id of base.panel!.view_node_ids) {
      const payload = parseAiRulePayload(base.nodes.find(node => node.id === id)!.payload)!;
      assert.equal(payload.presets?.length, 4);
      for (const [index, preset] of payload.presets!.entries()) {
        const doc = index === 0 ? base : applyRulePreset(base, id, preset, payload.presetSource!);
        assert.equal(doc.nodes.find(node => node.id === 'scene')?.params.v, index);
        const result = await runNode(doc, id).catch(error => {
          throw new Error(`${kind}/${id}/${preset.label}: ${String(error)}`, { cause: error });
        });
        results.set(id + ':' + index, result);
        assert.ok(result.frames.length);
        for (const frame of result.frames) {
          assert.ok(frame.title && frame.summary);
          if (payload.preferredView === 'grid') assert.ok(frame.grid?.cells.length, id);
          if (payload.preferredView === 'chart') assert.ok(frame.series?.length, id);
          if (payload.preferredView === 'shapes') assert.ok(frame.shapes?.items.length, id);
          if (frame.shapes) checkShapeBounds(frame.shapes);
        }
      }
    }
  }
  const data = (view: string, scene: number) => results.get(view + ':' + scene)!.data;
  const frames = (view: string, scene: number) => results.get(view + ':' + scene)!.frames;
  near(data('matrix', 0).det, 1);
  near(data('matrix', 2).det, -1);
  near(data('matrix', 3).det, 0);
  assert.equal(data('matrix', 3).invertible, false);
  assert.equal(data('compose', 0).commute, false);
  assert.ok(frames('compose', 0).length > 2);
  assert.equal(data('rref', 0).rankA, 3);
  assert.equal(data('rref', 1).solutionType, 'infinite');
  assert.equal(data('rref', 2).solutionType, 'none');
  assert.ok(frames('rref', 3).some(frame => frame.summary?.includes('↔')));
  for (let scene = 0; scene < 4; scene++) {
    near(data('lu', scene).luError, 0);
    const spaces = data('subspaces', scene);
    assert.equal(Number(spaces.rank) + Number(spaces.nullity), spaces.n);
    assert.equal(Number(spaces.rank) + Number(spaces.leftNullity), spaces.m);
    near(spaces.orthCheck, 0);
    near(data('decompose', scene).kernelError, 0);
    near(data('decompose', scene).imageError, 0);
    near(data('qr', scene).orthoError, 0);
    near(data('qr', scene).qrError, 0);
    near(data('leastSquares', scene).residualOrthogonality, 0, 1e-5);
    near(data('projection', scene).symmetryError, 0);
    near(data('projection', scene).idempotenceError, 0);
    near(data('eigen', scene).traceError, 0);
    near(data('eigen', scene).detError, 0);
    near(data('markov', scene).stationaryError, 0);
    assert.equal(frames('powers', scene).length, 17);
    near(data('svd', scene).reconstructionError, 0);
    assert.ok(frames('svd', scene).length > 3);
  }
  assert.equal(data('subspaces', 1).rank, 1);
  assert.equal(data('eigen', 1).isComplex, true);
  assert.equal(data('eigen', 2).diagonalizable, false);
  assert.equal(data('quadratic', 0).definiteness, 'positive-definite');
  assert.equal(data('quadratic', 1).definiteness, 'indefinite');
  assert.match(frames('quadratic', 1)[0]!.summary!, /红正蓝负/);
});

test('改动共享输入联动多个视角，PCA 在保留全部成分时无重构误差', async () => {
  const doc = buildTemplateDoc('la03-four-subspaces');
  doc.nodes.find(node => node.id === 'amount')!.params.v = 0;
  for (const view of ['subspaces', 'decompose', 'rank']) {
    assert.equal((await runNode(doc, view)).data.rank, 1, view);
  }
  const pca = buildTemplateDoc('la06-quadform-svd-pca');
  const none = await runNode(pca, 'pca', { k: 0 });
  const full = await runNode(pca, 'pca', { k: 2 });
  near(none.data.explainedVariance, 0);
  near(full.data.explainedVariance, 1);
  near(full.data.reconstructionError, 0);
});

test('先调共享参数再选预设，恢复预设对应的旋转角、秩与拟合阶数', async () => {
  for (const [kind, view, scene, field, expected] of [
    ['la01-matrix-det-basis', 'matrix', 0, 'trace', Math.SQRT2],
    ['la03-four-subspaces', 'rank', 1, 'rank', 1],
    ['la04-ortho-qr-ls', 'leastSquares', 1, 'degree', 1],
  ] as const) {
    const doc = buildTemplateDoc(kind);
    doc.nodes.find(node => node.id === 'amount')!.params.v = 2;
    const payload = parseAiRulePayload(doc.nodes.find(node => node.id === view)!.payload)!;
    const selected = applyRulePreset(doc, view, payload.presets![scene]!, payload.presetSource!);
    near((await runNode(selected, view)).data[field], expected);
  }
});

test('三份历史线代课件仍可打开，且退出可见插件目录', () => {
  for (const kind of ['basis-change', 'eigen-transform', 'svd-steps']) {
    assert.ok(buildTemplateDoc(kind).nodes.length, kind);
    assert.ok(!WORKSHOP_PLUGIN_CATALOG.some(entry => entry.kind === kind), kind);
  }
});
