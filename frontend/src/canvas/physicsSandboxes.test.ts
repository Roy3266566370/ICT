import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { PHYSICS_TEMPLATES, VISIBLE_PHYSICS_TEMPLATES, physicsTemplateDoc } from './physicsTemplates.ts';
import { WORKSHOP_PLUGIN_CATALOG } from './templateCatalog.ts';
import { applyRulePreset, defaultAiRuleParams, parseAiRulePayload } from './aiRuleBlock.ts';
import { ruleUpstream, serializeUpstreamValue } from './aiRulePorts.ts';
import { inputValues, makeCtx } from './engine.ts';
import { runRuleInSandbox } from './ruleSandbox.ts';
import type { CanvasDoc } from './types.ts';
import { compatiblePorts } from './wireRecommend.ts';

const kinds = ['phy01-mechanics', 'phy05-em-fields', 'phy08-wave-optics', 'phy10-modern-physics'];
const moreKinds = ['phy02-rigid-rotation', 'phy03-oscillations', 'phy04-waves',
  'phy06-induction-circuits', 'phy07-geometric-optics', 'phy09-thermodynamics'];
const allKinds = [...kinds, ...moreKinds];

test('物理规则输入保留标量、body 与 field2d 上游', () => {
  assert.deepEqual(serializeUpstreamValue({ kind: 'scalar', v: 0.6 }), { kind: 'scalar', v: 0.6 });
  assert.equal(serializeUpstreamValue({ kind: 'scalar', v: NaN }), null);
  const body = serializeUpstreamValue({ kind: 'body', x: 1, y: 2, vx: 0.5, vy: -1, ke: 0.4, pe: 0.6, theta: 0.3 });
  assert.equal(body?.kind, 'body');
  assert.equal((body as { ke: number }).ke, 0.4);
  const field = serializeUpstreamValue({ kind: 'field2d', mode: 'electric',
    sources: [{ x: 1, y: 2, strength: 1.5, kind: 'charge' }] });
  assert.equal(field?.kind, 'field2d');
  assert.equal((field?.sources as unknown[]).length, 1);
});

test('十章全景沙盘置于物理目录前列并注册到活页插件，旧流水线模板保留兼容', () => {
  assert.equal(VISIBLE_PHYSICS_TEMPLATES.length, 10);
  assert.ok(VISIBLE_PHYSICS_TEMPLATES.every((t) => t.panorama && !t.legacy));
  assert.equal(PHYSICS_TEMPLATES.length, 22);
  assert.equal(PHYSICS_TEMPLATES.filter((t) => t.legacy).length, 12);
  for (const kind of allKinds) {
    assert.ok(WORKSHOP_PLUGIN_CATALOG.some((entry) => entry.kind === kind), kind);
    const doc = physicsTemplateDoc(kind);
    assert.ok(doc.panel?.view_node_ids.length, kind);
    assert.ok(doc.panel?.exposed_params.length, kind);
    assert.ok(doc.nodes.some((n) => n.type === 'aiRuleBlock'), kind);
  }
  for (const kind of WORKSHOP_PLUGIN_CATALOG.filter((e) => e.category === '大学物理').map((e) => e.kind)) {
    assert.ok(allKinds.includes(kind), kind);
  }
  const legacy = physicsTemplateDoc('projectile-drag');
  assert.ok(legacy.nodes.some(({ type }) => type === 'physicsStage'), '旧模板仍走流水线');
});

test('十章沙盘的所有连线都使用实际存在且相容的端口', async () => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../../', import.meta.url)),
    cacheDir: join(tmpdir(), 'ict-physics-sandboxes-vite'),
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: { '@': fileURLToPath(new URL('../', import.meta.url)) } },
  });
  try {
    const { nodePorts } = await server.ssrLoadModule('/src/canvas/nodes.tsx') as typeof import('./nodes.tsx');
    for (const kind of allKinds) {
      const doc = physicsTemplateDoc(kind);
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

function slider(doc: CanvasDoc, id: string, v: number): void {
  doc.nodes.find((n) => n.id === id)!.params.v = v;
}

test('所有物理规则的默认与预设都在沙箱内生成可视化帧', async () => {
  for (const kind of allKinds) {
    const doc = physicsTemplateDoc(kind);
    const rules = doc.nodes.filter(({ type }) => type === 'aiRuleBlock');
    assert.ok(rules.length >= 2, kind);
    for (const node of rules) {
      const payload = parseAiRulePayload(node.payload)!;
      assert.equal(payload.presets?.length, 3, node.id);
      for (const preset of [undefined, ...payload.presets!]) {
        assert.ok(payload.presetSource, node.id);
        const changed = preset ? applyRulePreset(doc, node.id, preset, payload.presetSource) : doc;
        const result = await runNode(changed, node.id);
        assert.ok(result.frames.length > 0, node.id);
        assert.ok(result.frames.every((f) =>
          f.shapes?.items.length || f.grid?.cells.length || f.series?.length || f.rows?.length), node.id);
      }
    }
  }
}, { timeout: 180_000 });

test('第 1 章：阻力缩短射程并耗散机械能，碰撞动量守恒', async () => {
  const doc = physicsTemplateDoc('phy01-mechanics');
  slider(doc, 'drag', 0);
  const vacuum = await runNode(doc, 'proj');
  assert.ok(Math.abs(Number(vacuum.data.rangeDrag) - Number(vacuum.data.rangeIdeal)) < 0.01);
  slider(doc, 'drag', 0.2);
  const dragged = await runNode(doc, 'proj');
  assert.ok(Number(dragged.data.rangeDrag) < Number(dragged.data.rangeIdeal));
  assert.ok(Number(dragged.data.loss) > 0.5);
  const energy = await runNode(doc, 'energyBar');
  assert.ok(Number(energy.data.loss) > 0);
  assert.ok(Number(energy.data.ratio) > 0.05);
  slider(doc, 'drag', 0);
  assert.ok(Number((await runNode(doc, 'energyBar')).data.loss) < 0.01);
  const hit = await runNode(doc, 'collision');
  assert.equal(hit.data.conserved, true);
  assert.ok(Number(hit.data.ke1) <= Number(hit.data.ke0) + 1e-9);
  const node = doc.nodes.find((n) => n.id === 'collision')!;
  node.params.e = 0;
  const dead = await runNode(doc, 'collision');
  assert.ok(Number(dead.data.ke1) < Number(hit.data.ke1));
});

test('第 5 章：v=E/B 直穿，R=mv/(qB) 反比于 B 且 T 与 v 无关', async () => {
  const doc = physicsTemplateDoc('phy05-em-fields');
  slider(doc, 'bField', 1.2);
  const node = doc.nodes.find((n) => n.id === 'selector')!;
  Object.assign(node.params, { velocity: 1, e: 1.2 });
  const straight = await runNode(doc, 'selector');
  assert.equal(straight.data.pass, true);
  assert.ok(Math.abs(Number(straight.data.radius) - 1 / 1.2) < 1e-9);
  node.params.velocity = 2;
  assert.equal((await runNode(doc, 'selector')).data.pass, false);
  const orbit = await runNode(doc, 'orbitAudit');
  assert.ok(Math.abs(Number(orbit.data.radius) - 1 / 1.2) < 1e-9);
  assert.ok(Math.abs(Number(orbit.data.period) - 2 * Math.PI / 1.2) < 1e-9);
  slider(doc, 'bField', 2.4);
  const tighter = await runNode(doc, 'orbitAudit');
  assert.ok(Math.abs(Number(tighter.data.radius) - 1 / 2.4) < 1e-9);
});

test('第 8 章：条纹间距正比于 λ，N 增大主极大变窄，马吕斯定律成立', async () => {
  const doc = physicsTemplateDoc('phy08-wave-optics');
  slider(doc, 'lambda', 420);
  const violet = await runNode(doc, 'interfer');
  slider(doc, 'lambda', 650);
  const red = await runNode(doc, 'interfer');
  assert.ok(Math.abs(Number(red.data.spacing) / Number(violet.data.spacing) - 650 / 420) < 0.01);
  const two = await runNode(doc, 'grating');
  slider(doc, 'slits', 10);
  const ten = await runNode(doc, 'grating');
  assert.ok(Number(ten.data.widthEstimate) < Number(two.data.widthEstimate) / 3);
  const pol = doc.nodes.find((n) => n.id === 'polarizer')!;
  pol.params.theta = 60; pol.params.middle = 0;
  const direct = await runNode(doc, 'polarizer');
  assert.ok(Math.abs(Number(direct.data.direct) - 0.25) < 1e-9);
  pol.params.theta = 90;
  assert.ok(Number((await runNode(doc, 'polarizer')).data.direct) < 1e-9);
  pol.params.middle = 1;
  const revived = await runNode(doc, 'polarizer');
  assert.ok(Math.abs(Number(revived.data.via45) - 0.25) < 1e-9);
});

test('第 10 章：γ(0.6)=1.25，低于截止无光电子，hν=ΔE 才吸收', async () => {
  const doc = physicsTemplateDoc('phy10-modern-physics');
  slider(doc, 'beta', 0.6);
  const slow = await runNode(doc, 'relativity');
  assert.ok(Math.abs(Number(slow.data.gamma) - 1.25) < 1e-9);
  slider(doc, 'beta', 0.95);
  const fast = await runNode(doc, 'relativity');
  assert.ok(Number(fast.data.gamma) > 3);
  slider(doc, 'freq', 5);
  const below = await runNode(doc, 'photo');
  assert.equal(below.data.emits, false);
  assert.equal(below.data.stopping, 0);
  slider(doc, 'freq', 8);
  const lit = await runNode(doc, 'photo');
  assert.equal(lit.data.emits, true);
  assert.ok(Math.abs(Number(lit.data.kMax) - (0.41357 * 8 - 2.3)) < 1e-9);
  const well = doc.nodes.find((n) => n.id === 'well')!;
  Object.assign(well.params, { level: 2, e1: 0.5 });
  slider(doc, 'freq', 6);
  assert.equal((await runNode(doc, 'well')).data.absorbed, true);
  slider(doc, 'freq', 8);
  assert.equal((await runNode(doc, 'well')).data.absorbed, false);
});

test('第 2 章：惯量小的先到终点且与 R 无关，收臂 ω∝1/r²', async () => {
  const doc = physicsTemplateDoc('phy02-rigid-rotation');
  const race = await runNode(doc, 'rollRace');
  assert.ok(Number(race.data.tSphere) < Number(race.data.tDisk));
  assert.ok(Number(race.data.tDisk) < Number(race.data.tHoop));
  slider(doc, 'radius', 0.12);
  const small = await runNode(doc, 'rollRace');
  assert.ok(Math.abs(Number(small.data.tSphere) - Number(race.data.tSphere)) < 1e-9);
  const spin = await runNode(doc, 'spinUp');
  assert.ok(Math.abs(Number(spin.data.omegaRatio) - Math.pow(0.6 / 0.12, 2)) < 1e-6);
  assert.ok(Math.abs(Number(spin.data.keRatio) - Number(spin.data.omegaRatio)) < 1e-9);
});

test('第 3 章：上游 body 驱动能量账本，共振峰锁定 ω0', async () => {
  const doc = physicsTemplateDoc('phy03-oscillations');
  const audit = await runNode(doc, 'pendAudit');
  assert.ok(Number(audit.data.total) > 0);
  assert.ok(Number(audit.data.thetaDeg) > 0);
  const node = doc.nodes.find((n) => n.id === 'pendAudit')!;
  node.params.thetaAmp = 80;
  assert.ok(Number((await runNode(doc, 'pendAudit')).data.periodRatio) > 1.1);
  const scan = await runNode(doc, 'resonanceScan');
  assert.ok(Math.abs(Number(scan.data.w0) - Math.sqrt(10)) < 1e-9);
  slider(doc, 'damp', 0.08);
  const sharp = await runNode(doc, 'resonanceScan');
  assert.ok(Number(sharp.data.peak) > Number(scan.data.peak));
});

test('第 4 章：驻波波节 λ/2，多普勒前升后降，超声速出马赫锥', async () => {
  const doc = physicsTemplateDoc('phy04-waves');
  const standing = await runNode(doc, 'standing');
  assert.equal(standing.data.nodeSpacing, 1);
  slider(doc, 'srcV', 0);
  const still = await runNode(doc, 'doppler');
  assert.equal(still.data.fAhead, 1);
  slider(doc, 'srcV', 0.6);
  const moving = await runNode(doc, 'doppler');
  assert.ok(Math.abs(Number(moving.data.fAhead) - 2.5) < 1e-9);
  assert.ok(Math.abs(Number(moving.data.fBehind) - 0.625) < 1e-9);
  assert.equal(moving.data.machDeg, null);
  slider(doc, 'srcV', 1.15);
  const mach = await runNode(doc, 'doppler');
  assert.ok(Math.abs(Number(mach.data.machDeg) - Math.asin(1 / 1.15) * 180 / Math.PI) < 1e-9);
});

test('第 6 章：τ=mR/(B²L²) 主导刹车，动能全部化为焦耳热', async () => {
  const doc = physicsTemplateDoc('phy06-induction-circuits');
  const emf = await runNode(doc, 'motionalEmf');
  const expectTau = 0.5 * 20 / (0.8 * 0.8 * 0.5 * 0.5);
  assert.ok(Math.abs(Number(emf.data.tau) - expectTau) < 1e-9);
  assert.ok(Math.abs(Number(emf.data.heat) - 0.5 * 0.5 * 16) < 1e-9);
  slider(doc, 'bField', 1.6);
  const quick = await runNode(doc, 'motionalEmf');
  assert.ok(Math.abs(Number(quick.data.tau) - expectTau / 4) < 1e-9);
  const charge = await runNode(doc, 'rcCharge');
  assert.ok(Math.abs(Number(charge.data.tau) - 20) < 1e-9);
  slider(doc, 'ohm', 50);
  assert.ok(Math.abs(Number((await runNode(doc, 'rcCharge')).data.tau) - 50) < 1e-9);
});

test('第 7 章：临界角后全反射，物距跨 f 实像翻虚像', async () => {
  const doc = physicsTemplateDoc('phy07-geometric-optics');
  slider(doc, 'incident', 35);
  const refract = await runNode(doc, 'snell');
  assert.equal(refract.data.tir, false);
  assert.ok(Math.abs(Number(refract.data.theta2) - Math.asin(1.5 * Math.sin(35 * Math.PI / 180)) * 180 / Math.PI) < 1e-9);
  slider(doc, 'incident', 55);
  const tir = await runNode(doc, 'snell');
  assert.equal(tir.data.tir, true);
  assert.ok(Math.abs(Number(tir.data.thetaC) - Math.asin(1 / 1.5) * 180 / Math.PI) < 1e-9);
  const lens = await runNode(doc, 'lens3');
  assert.equal(lens.data.kind, 'real');
  assert.ok(Math.abs(Number(lens.data.v) - 90) < 1e-9);
  slider(doc, 'objDist', 30);
  const virtual = await runNode(doc, 'lens3');
  assert.equal(virtual.data.kind, 'virtual');
  assert.ok(Number(virtual.data.mag) > 0);
});

test('第 9 章：vp=√(2kT/m) 随温升，卡诺效率与 W/Qh 对账', async () => {
  const doc = physicsTemplateDoc('phy09-thermodynamics');
  const gas = await runNode(doc, 'maxwell');
  const expected = Math.sqrt(2 * 1.380649e-23 * 600 / 4.65e-26);
  assert.ok(Math.abs(Number(gas.data.vp) - expected) / expected < 1e-9);
  slider(doc, 'tHot', 900);
  const hotter = await runNode(doc, 'maxwell');
  assert.ok(Math.abs(Number(hotter.data.vp) / Number(gas.data.vp) - Math.sqrt(1.5)) < 0.01);
  slider(doc, 'tHot', 600);
  const cycle = await runNode(doc, 'carnot');
  assert.ok(Math.abs(Number(cycle.data.eta) - 0.5) < 1e-9);
  assert.ok(Math.abs(Number(cycle.data.ratio) - 0.5) < 1e-9);
  assert.ok(Math.abs(Number(cycle.data.work) - (Number(cycle.data.heatIn) - Number(cycle.data.heatOut))) < 1e-9);
});
