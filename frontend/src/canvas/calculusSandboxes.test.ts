import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { CALCULUS_TEMPLATES, calculusTemplateDoc } from './calculusTemplates.ts';
import { WORKSHOP_PLUGIN_CATALOG } from './templateCatalog.ts';
import { applyRulePreset, defaultAiRuleParams, parseAiRulePayload } from './aiRuleBlock.ts';
import { ruleUpstream, serializeUpstreamValue } from './aiRulePorts.ts';
import { evalOutput, inputValues, makeCtx } from './engine.ts';
import { runRuleInSandbox } from './ruleSandbox.ts';
import type { CanvasDoc } from './types.ts';
import { compatiblePorts } from './wireRecommend.ts';

const kinds = ['ch03-derivatives-app', 'ch07-ode-dynamics', 'ch09-multivar-opt', 'ch12-series-fourier'];
const newKinds = ['ch01-limits', 'ch02-derivatives', 'ch04-integrals', 'ch06-integral-apps', 'ch08-space-geometry',
  'ch10-multiple-int', 'ch11-vector-calc'];
const allKinds = [...kinds, ...newKinds];

test('规则输入保留有限标量，并采样实际函数及其导数', () => {
  assert.deepEqual(serializeUpstreamValue({ kind: 'scalar', v: 0 }), { kind: 'scalar', v: 0 });
  assert.equal(serializeUpstreamValue({ kind: 'scalar', v: Infinity }), null);
  const fn = serializeUpstreamValue({ kind: 'function', expression: 'a*x^2', a: 2, b: 0, c: 0 });
  const samples = fn?.samples as { xs: number[]; ys: number[]; dy: number[]; d2y: number[] };
  assert.equal(samples?.xs.length, 101);
  const i = samples.xs.indexOf(1);
  assert.deepEqual([samples.ys[i], samples.dy[i], samples.d2y[i]], [2, 4, 4]);
  const cusp = serializeUpstreamValue({ kind: 'function', expression: 'abs(x)', a: 0, b: 0, c: 0 });
  assert.equal((cusp?.samples as typeof samples).dy[50], null);
  const fn2d = serializeUpstreamValue({ kind: 'function2d', expression: 'x^2-y^2', a: 0, b: 0 });
  const terrain = fn2d?.samples as { xs: number[]; ys: number[]; values: number[][] };
  const center = terrain?.xs.indexOf(0);
  assert.equal(terrain?.values[center]?.[center], 0);
  assert.equal(terrain?.values[center]?.[terrain.xs.indexOf(1)], 1);
});

test('十一章沙盘置于定象坊与活页目录前列，并保留旧流水线模板', () => {
  assert.deepEqual(CALCULUS_TEMPLATES.slice(0, allKinds.length).map(({ kind }) => kind),
    ['ch01-limits', 'ch02-derivatives', kinds[0], 'ch04-integrals', 'ch06-integral-apps', kinds[1],
      'ch08-space-geometry', kinds[2], 'ch10-multiple-int', 'ch11-vector-calc', kinds[3]]);
  for (const kind of allKinds) {
    assert.ok(WORKSHOP_PLUGIN_CATALOG.some((entry) => entry.kind === kind), kind);
    assert.ok(calculusTemplateDoc(kind).panel?.view_node_ids.length, kind);
  }
  assert.ok(calculusTemplateDoc('taylor-error').nodes.some(({ type }) => type === 'calculusStage'));
});

test('沙盘的所有连线都使用实际存在且相容的端口', async () => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../../', import.meta.url)),
    cacheDir: join(tmpdir(), 'ict-calculus-sandboxes-vite'),
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: { '@': fileURLToPath(new URL('../', import.meta.url)) } },
  });
  try {
    const { nodePorts } = await server.ssrLoadModule('/src/canvas/nodes.tsx') as typeof import('./nodes.tsx');
    for (const kind of allKinds) {
      const doc = calculusTemplateDoc(kind);
      const occupied = new Set<string>();
      for (const wire of doc.wires) {
        const source = doc.nodes.find(({ id }) => id === wire.from);
        const target = doc.nodes.find(({ id }) => id === wire.to);
        assert.ok(source && target, wire.id);
        const output = nodePorts(source, 'out').find(({ id }) => id === (wire.fromPort ?? 'out'));
        const input = nodePorts(target, 'in').find(({ id }) => id === (wire.toPort ?? 'in'));
        assert.ok(output && input && compatiblePorts(source, output.id, output.kind, target, input), wire.id);
        const key = target.id + ':' + input.id;
        assert.ok(!occupied.has(key), key);
        occupied.add(key);
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

test('所有规则的默认与预设都在沙箱内生成紧凑可视化帧', async () => {
  for (const kind of allKinds) {
    const doc = calculusTemplateDoc(kind);
    const rules = doc.nodes.filter(({ type }) => type === 'aiRuleBlock');
    assert.equal(rules.length, ['ch08-space-geometry', 'ch11-vector-calc'].includes(kind) ? 3 : 2, kind);
    for (const node of rules) {
      const payload = parseAiRulePayload(node.payload)!;
      assert.equal(payload.presets?.length, 3, node.id);
      for (const preset of [undefined, ...payload.presets!]) {
        assert.ok(payload.presetSource, node.id);
        const changed = preset ? applyRulePreset(doc, node.id, preset, payload.presetSource) : doc;
        const result = await runNode(changed, node.id);
        assert.ok(result.frames.length > 0, node.id);
        assert.ok(result.frames.every((f) => f.shapes?.items.length || f.grid?.cells.length || f.series?.length), node.id);
      }
    }
  }
});

test('第 10 章核对单位圆上的 Jacobian、质量和密度偏置导致的质心移动', async () => {
  const doc = calculusTemplateDoc('ch10-multiple-int');
  const bias = doc.nodes.find(({ id }) => id === 'bias')!;
  bias.params.v = 0;
  const transform = await runNode(doc, 'jacobian');
  assert.ok(Math.abs(Number(transform.data.mass) - Math.PI) < 1e-8);
  assert.ok(Math.abs(Number(transform.data.withoutJacobian) - 2*Math.PI) < 1e-8);
  bias.params.v = 0.8;
  const weighted = await runNode(doc, 'centroid');
  assert.ok(Math.abs(Number(weighted.data.cx) - 0.2) < 0.001);
  assert.ok(Math.abs(Number(weighted.data.cy)) < 1e-9);
  assert.ok(Math.abs(Number(weighted.data.mass) - Math.PI) < 1e-8);
  assert.equal(weighted.frames[0]!.grid?.mask?.[0]?.[0], true);
  const mass = evalOutput(makeCtx(doc, new Map()), 'double');
  assert.ok(mass?.kind === 'scalar' && Math.abs(mass.v - Math.PI) < 1e-8);
});

test('第 11 章核对势场、涡流、非恒定场与奇点', async () => {
  const doc = calculusTemplateDoc('ch11-vector-calc');
  const field = doc.nodes.find(({ id }) => id === 'field')!;
  const radius = doc.nodes.find(({ id }) => id === 'radius')!;
  radius.params.v = 2;
  field.text = '-y\nx';
  const vortex = await runNode(doc, 'theorems');
  const preview = serializeUpstreamValue({kind:'vectorFunction2d',p:'-y',q:'x'});
  const samples = preview?.samples as { radius: number; arrows: unknown[] };
  assert.equal(samples.radius, 1);
  assert.ok(samples.arrows.length > 0);
  assert.ok(Math.abs(Number(vortex.data.circulation) - 8*Math.PI) < 1e-7);
  assert.ok(Math.abs(Number(vortex.data.curlIntegral) - 8*Math.PI) < 1e-7);
  assert.ok(Math.abs(Number(vortex.data.flux)) < 1e-8);
  field.text = 'x\ny';
  const gradient = await runNode(doc, 'theorems');
  assert.ok(Math.abs(Number(gradient.data.circulation)) < 1e-8);
  assert.ok(Math.abs(Number(gradient.data.flux) - 8*Math.PI) < 1e-7);
  field.text = '-y*(x^2+y^2)\nx*(x^2+y^2)';
  const varying = await runNode(doc, 'theorems');
  assert.ok(Math.abs(Number(varying.data.circulation) - 32*Math.PI) < 1e-7);
  assert.ok(Math.abs(Number(varying.data.curlIntegral) - 32*Math.PI) < 0.15);
  field.text = '-y/(x^2+y^2)\nx/(x^2+y^2)';
  const singular = await runNode(doc, 'theorems');
  assert.equal(singular.data.curlIntegral, undefined);
  assert.match(singular.frames[0]!.summary!, /无定义/);
});

test('第 6 章圆盘法逼近圆锥体积，水坝合力和抽水功响应实际轮廓', async () => {
  const doc = calculusTemplateDoc('ch06-integral-apps');
  const source = doc.nodes.find(({ id }) => id === 'src')!;
  const slices = doc.nodes.find(({ id }) => id === 'slices')!;
  source.text = 'x';
  slices.params.v = 4;
  const coarse = await runNode(doc, 'disks');
  slices.params.v = 32;
  const fine = await runNode(doc, 'disks');
  assert.ok(Math.abs(Number(fine.data.reference) - Math.PI/3) < 1e-10);
  assert.ok(Number(fine.data.error) < Number(coarse.data.error)/50);
  source.text = '1';
  const water = await runNode(doc, 'dam');
  assert.equal(water.data.force, 1962000);
  assert.equal(water.data.work, 9417600);
  assert.ok(Math.abs(water.frames[0]!.series![0]!.values[1]! - 98.1/32) < 1e-10);
  assert.ok(water.frames.some(frame => frame.shapes?.items.length));
  assert.ok(water.frames.some(frame => frame.series?.length));
  source.text = '2';
  assert.equal((await runNode(doc, 'dam')).data.force, 3924000);
  source.text = '1/x';
  const invalid = await runNode(doc, 'dam');
  assert.equal(invalid.data.work, undefined);
  assert.match(invalid.frames[0]!.summary!, /可取有限值/);
  source.text = '1/(x-0.0009765625)';
  assert.equal((await runNode(doc, 'dam')).data.work, undefined);
});

test('第 8 章马鞍面穿过零点时翻转，截痕与热图共享曲面，向量读数可复算', async () => {
  const doc = calculusTemplateDoc('ch08-space-geometry');
  const plane = doc.nodes.find(({ id }) => id === 'plane')!;
  plane.params.v = 1;
  const positive = await runNode(doc, 'traces');
  assert.equal(positive.data.opensAlong, 'x');
  const heatAbove = await runNode(doc, 'heights');
  assert.equal(heatAbove.frames[0]!.grid?.cells[8]?.[8], -1);
  const vectors = doc.nodes.find(({ id }) => id === 'vectors')!;
  Object.assign(vectors.params, { ax: 1, ay: 0, bx: 0, by: 1, bz: 0 });
  plane.params.v = 0;
  assert.equal((await runNode(doc, 'traces')).data.opensAlong, 'cross');
  const vector = await runNode(doc, 'vectors');
  assert.equal(vector.data.dot, 0);
  assert.equal(vector.data.area, 1);
  vectors.params.by = 0;
  const zeroVector = await runNode(doc, 'vectors');
  assert.equal(zeroVector.data.projection, null);
  assert.equal(zeroVector.data.area, 0);
  plane.params.v = -1;
  assert.equal((await runNode(doc, 'traces')).data.opensAlong, 'y');
  assert.equal((await runNode(doc, 'heights')).frames[0]!.grid?.cells[8]?.[8], 1);
  const surface = doc.nodes.find(({ id }) => id === 'surfaceMode')!;
  surface.params.v = 1;
  assert.equal((await runNode(doc, 'traces')).data.opensAlong, 'none');
  assert.equal((await runNode(doc, 'heights')).data.surface, 1);
});

test('第 1 章收紧 ε 会收紧 δ，跳跃预设取消双侧候选，二分夹逼命中 −1', async () => {
  const doc = calculusTemplateDoc('ch01-limits');
  const eps = doc.nodes.find(({ id }) => id === 'eps')!;
  const broad = await runNode(doc, 'discontinuity');
  assert.ok(Number(broad.data.delta) > 0);
  assert.ok(Math.abs(Number(broad.data.root) + 1) < 1e-7);
  eps.params.v = 0.01;
  const tight = await runNode(doc, 'discontinuity');
  assert.ok(Number(tight.data.delta) < Number(broad.data.delta));
  doc.nodes.find(({ id }) => id === 'src')!.text = 'abs(x)/x';
  const jump = await runNode(doc, 'discontinuity');
  assert.equal(jump.data.delta, null);
  assert.match(jump.frames[0]!.summary!, /跳跃/);
});

test('无穷小曲线能读出二阶，二分法拒绝把小幅跳跃当成零点', async () => {
  const doc = calculusTemplateDoc('ch01-limits');
  const source = doc.nodes.find(({ id }) => id === 'src')!;
  source.text = 'x^2';
  const active = (await runNode(doc, 'orderRace')).frames[0]!.series!.at(-1)!;
  assert.equal(active.values.at(-1), -12);
  source.text = '1e-10*abs(x+1)/(x+1)';
  assert.equal((await runNode(doc, 'discontinuity')).data.root, null);
  source.text = '1/(x+0.875)';
  const pole = await runNode(doc, 'discontinuity');
  assert.equal(pole.data.root, null);
  assert.match(pole.frames[1]!.summary!, /中点无定义/);
});

test('第 2 章验证链式法则并观察微分余差的二次缩小', async () => {
  const doc = calculusTemplateDoc('ch02-derivatives');
  doc.nodes.find(({ id }) => id === 'src')!.text = 'x+x^2';
  const step = doc.nodes.find(({ id }) => id === 'stepH')!;
  step.params.v = 0.4;
  const wide = await runNode(doc, 'differential');
  step.params.v = 0.2;
  const narrow = await runNode(doc, 'differential');
  assert.ok(Math.abs(Number(wide.data.error) / Number(narrow.data.error) - 4) < 1e-10);
  const chain = await runNode(doc, 'chain');
  assert.equal(chain.data.derivative, 2);
  assert.ok(Math.abs(Number(chain.data.increment) - 0.6336) < 1e-10);
});

test('第 4–5 章使用真实节点上的函数做求积，p=1 是反常积分临界点', async () => {
  const doc = calculusTemplateDoc('ch04-integrals');
  doc.nodes.find(({ id }) => id === 'src')!.text = 'x^2';
  const race = await runNode(doc, 'quadrature');
  assert.ok(Math.abs(Number(race.data.simpson) - 1/3) < 1e-10);
  assert.ok(Number(race.data.left) < Number(race.data.reference));
  const ftc = doc.nodes.find(({ id }) => id === 'ftc')!;
  const before = evalOutput(makeCtx(doc, new Map()), ftc.id);
  assert.ok(before?.kind === 'scalar' && Math.abs(before.v - 1/3) < 1e-5);
  ftc.params.constant = -2;
  assert.deepEqual(evalOutput(makeCtx(doc, new Map()), ftc.id), before);
  const power = doc.nodes.find(({ id }) => id === 'power')!;
  power.params.v = 1;
  const boundary = await runNode(doc, 'improper');
  assert.equal(boundary.data.converges, false);
  assert.match(boundary.frames[0]!.summary!, /ln/);
  power.params.v = 1.5;
  const convergent = await runNode(doc, 'improper');
  assert.equal(convergent.data.limit, 2);
});

test('修改函数、地形和共享滑杆会改变下游结果', async () => {
  for (const [kind, sourceId, edit, targets] of [
    [kinds[0], 'src', { text: 'exp(-0.3*x)*sin(3*x)' }, ['curvature', 'spotlight']],
    [kinds[1], 'stepH', { params: { v: 0.8 } }, ['arena']],
    [kinds[2], 'f2d', { text: 'x^2-y^2' }, ['lagrange', 'gd']],
    [kinds[3], 'nHarm', { params: { v: 3 } }, ['convRace', 'denoise']],
  ] as const) {
    const doc = calculusTemplateDoc(kind);
    const source = doc.nodes.find((node) => node.id === sourceId)!;
    const before = await Promise.all(targets.map((id) => runNode(doc, id)));
    Object.assign(source, edit);
    const after = await Promise.all(targets.map((id) => runNode(doc, id)));
    for (let i = 0; i < targets.length; i++) assert.notDeepEqual(after[i], before[i], targets[i]);
  }
});

test('旗舰预设产生对应的数值现象', async () => {
  const runPreset = (kind: string, id: string, index: number) => {
    const doc = calculusTemplateDoc(kind);
    const payload = parseAiRulePayload(doc.nodes.find((node) => node.id === id)!.payload)!;
    return runNode(applyRulePreset(doc, id, payload.presets![index]!, payload.presetSource!), id);
  };
  const cusp = await runPreset(kinds[0]!, 'spotlight', 1);
  assert.match(cusp.frames[0]!.summary!, /无可用泰勒展开/);
  const resonance = await runPreset(kinds[1]!, 'spring', 2);
  assert.ok(Number(resonance.data.value) > 5);
  const unstable = await runPreset(kinds[1]!, 'arena', 2);
  const end = unstable.frames[0]!.series!.map(({ values }) => Math.abs(values.at(-1)!));
  assert.ok(end[1]! > 1 && end[3]! < 1, 'Euler 发散，RK4 保持稳定');
  const converging = await runPreset(kinds[2]!, 'gd', 0);
  const diverging = await runPreset(kinds[2]!, 'gd', 1);
  const saddle = await runPreset(kinds[2]!, 'gd', 2);
  assert.ok(Number(converging.data.value) < 0.05);
  assert.equal(diverging.data.status, '越出可视范围');
  assert.equal(saddle.data.steps, 0);
  const filtered = await runPreset(kinds[3]!, 'denoise', 0);
  const truncated = await runPreset(kinds[3]!, 'denoise', 2);
  assert.ok(Number(filtered.data.value) > Number(filtered.data.snrBefore));
  assert.ok(Number(truncated.data.value) < Number(filtered.data.value));
});

test('高阶不可导时保留低阶结果，离网格的极点不产生中值切线', async () => {
  const doc = calculusTemplateDoc(kinds[0]!);
  const source = doc.nodes.find(({ id }) => id === 'src')!;
  source.text = 'abs(x)^3';
  const curvature = await runNode(doc, 'curvature');
  const taylor = await runNode(doc, 'spotlight');
  assert.equal(curvature.data.value, 0);
  assert.equal(taylor.frames[0]!.grid?.cells[1]?.[10], -6);
  assert.equal(taylor.frames[0]!.grid?.cells[2]?.[10], 2);

  source.text = '1/(x-0.01)^2';
  assert.match((await runNode(doc, 'curvature')).frames[0]!.summary!, /未找到可核对的中值点/);
});
