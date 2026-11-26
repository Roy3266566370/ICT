import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { LAB408_TEMPLATES, VISIBLE_LAB408_TEMPLATES, lab408TemplateDoc } from './lab408Templates.ts';
import { WORKSHOP_PLUGIN_CATALOG } from './templateCatalog.ts';
import { applyRulePreset, defaultAiRuleParams, parseAiRulePayload } from './aiRuleBlock.ts';
import { ruleUpstream, serializeUpstreamValue } from './aiRulePorts.ts';
import { inputValues, makeCtx } from './engine.ts';
import { runRuleInSandbox } from './ruleSandbox.ts';
import type { CanvasDoc } from './types.ts';
import { compatiblePorts } from './wireRecommend.ts';

const ALL_KINDS = VISIBLE_LAB408_TEMPLATES.map((t) => t.kind);

test('algoData 上游序列化保留 array/graph/addrStream 三种模式', () => {
  const arr = serializeUpstreamValue({ kind: 'algoData', mode: 'array', values: [1, 2, 3] })!;
  assert.equal(arr.kind, 'algoData');
  assert.equal(arr.mode, 'array');
  assert.deepEqual(arr.values, [1, 2, 3]);
  const graph = serializeUpstreamValue({ kind: 'algoData', mode: 'graph', edges: [{ u: 'A', v: 'B', w: 4 }] })!;
  assert.equal(graph.mode, 'graph');
  assert.deepEqual(graph.edges, [{ u: 'A', v: 'B', w: 4 }]);
  const addrs = serializeUpstreamValue({ kind: 'algoData', mode: 'addrStream', addresses: [0, 64] })!;
  assert.equal(addrs.mode, 'addrStream');
  assert.deepEqual(addrs.addresses, [0, 64]);
  assert.deepEqual(serializeUpstreamValue({ kind: 'scalar', v: 5 }), { kind: 'scalar', v: 5 });
});

test('4 科 16 章全景沙盘注册到可见目录与活页插件，旧 21 模板 legacy 兼容', () => {
  assert.equal(VISIBLE_LAB408_TEMPLATES.length, 16);
  assert.ok(VISIBLE_LAB408_TEMPLATES.every((t) => t.panorama && !t.legacy));
  assert.equal(LAB408_TEMPLATES.length, 37);
  assert.equal(LAB408_TEMPLATES.filter((t) => t.legacy).length, 21);
  for (const template of VISIBLE_LAB408_TEMPLATES) {
    assert.ok(WORKSHOP_PLUGIN_CATALOG.some((entry) => entry.kind === template.kind), template.kind);
    const doc = lab408TemplateDoc(template.kind);
    assert.ok(doc.panel?.view_node_ids.length, template.kind);
    assert.ok(doc.panel?.exposed_params.length, template.kind);
    assert.ok(doc.nodes.some((n) => n.type === 'aiRuleBlock'), template.kind);
  }
  for (const template of LAB408_TEMPLATES.filter((t) => t.legacy)) {
    assert.ok(!WORKSHOP_PLUGIN_CATALOG.some((entry) => entry.kind === template.kind), template.kind);
    const doc = lab408TemplateDoc(template.kind);
    assert.ok(doc.nodes.some((n) => n.type === 'lab408Stage'), `${template.kind} 旧模板仍走流水线`);
  }
});

test('16 章沙盘的所有连线都使用实际存在且相容的端口', async () => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../../', import.meta.url)),
    cacheDir: join(tmpdir(), 'ict-lab408-sandboxes-vite'),
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: { '@': fileURLToPath(new URL('../', import.meta.url)) } },
  });
  try {
    const { nodePorts } = await server.ssrLoadModule('/src/canvas/nodes.tsx') as typeof import('./nodes.tsx');
    for (const kind of ALL_KINDS) {
      const doc = lab408TemplateDoc(kind);
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

test('16 章全部规则的默认与预设都能在沙箱内生成可视化帧', async () => {
  for (const kind of ALL_KINDS) {
    const doc = lab408TemplateDoc(kind);
    const rules = doc.nodes.filter(({ type }) => type === 'aiRuleBlock');
    assert.ok(rules.length >= 2, kind);
    for (const node of rules) {
      const payload = parseAiRulePayload(node.payload)!;
      assert.ok((payload.presets?.length ?? 0) >= 2, `${kind}:${node.id} 需要至少 2 组预设`);
      const wired = doc.wires.some((w) => w.to === node.id && (w.toPort ?? 'in') === 'in');
      if (wired) assert.ok(payload.presetSource, `${kind}:${node.id} 主源接线需要 presetSource 联动`);
      for (const preset of [undefined, ...payload.presets!]) {
        const changed = preset ? applyRulePreset(doc, node.id, preset, payload.presetSource) : doc;
        const result = await runNode(changed, node.id);
        assert.ok(result.frames.length > 0, `${kind}:${node.id} 预设 ${preset?.label ?? '默认'}`);
        assert.ok(result.frames.every((f) =>
          f.shapes?.items.length || f.grid?.cells.length || f.series?.length
          || f.rows?.length || f.timeline?.length || f.graph?.nodes.length), `${kind}:${node.id} 帧无内容`);
      }
    }
  }
}, { timeout: 300_000 });

test('DS 第 5 章：Prim 与 Dijkstra 同图不同语义，AOE 关键路径 20', async () => {
  const doc = lab408TemplateDoc('ds03-graphs');
  const cmp = await runNode(doc, 'mstVsSpt');
  assert.equal(cmp.data.mstWeight, 13);
  assert.equal(cmp.data.distances.F, 13);
  assert.equal(cmp.data.distances.B, 3);
  const floyd = await runNode(doc, 'distMatrix');
  assert.equal(floyd.data.dist[0][5], 13); // A→F
  const aoe = doc.nodes.find((n) => n.id === 'graphSrc')!;
  aoe.text = 'v1 v2 6\nv1 v3 4\nv1 v4 5\nv2 v5 1\nv3 v5 1\nv4 v6 2\nv5 v7 9\nv5 v8 7\nv6 v8 4\nv8 v9 2\nv7 v9 4';
  const cpm = await runNode(doc, 'topoCpm');
  assert.equal(cpm.data.cyclic, false);
  assert.equal(cpm.data.critLen, 20);
  assert.ok(cpm.data.critical.includes('v7→v9'));
});

test('CO 第 3 章：冲突流直接映射全 Miss、2 路命中率回升、AMAT 对账', async () => {
  const doc = lab408TemplateDoc('co02-memory-cache');
  const grid = await runNode(doc, 'cacheGrid');
  assert.equal(grid.data.hits, 0); // 1 路（assoc=1）下 tag 0/1 互踢：12 访存全 Miss
  assert.equal(grid.data.misses, 12);
  setParam(doc, 'assoc', 'v', 2);
  const grid2 = await runNode(doc, 'cacheGrid');
  assert.equal(grid2.data.misses, 2); // 2 路：tag 0 与 tag 2 同组共存，冷启动 2 缺后全中
  assert.equal(grid2.data.hits, 10);
  const amat = await runNode(doc, 'amatRace');
  assert.equal(amat.data.rates[0], 0); // 1 路命中率 0%
  assert.ok(amat.data.rates[1] > 80); // 2 路 ≈ 83%
  assert.ok(amat.data.amats[0] > amat.data.amats[1]); // AMAT 随路数下降
  setParam(doc, 'addrSrc', 'mode', 1);
  const split = await runNode(doc, 'addrSplit');
  assert.ok(split.data.tagBits > 0 && split.data.indexBits > 0 && split.data.offsetBits === 6);
});

test('OS 第 3 章：FIFO 3 框缺 9 页、4 框缺 10 页直击 Belady', async () => {
  const doc = lab408TemplateDoc('os03-memory-vm');
  const fifo3 = await runNode(doc, 'pageGrid');
  assert.equal(fifo3.data.faults, 9);
  setParam(doc, 'frames', 'v', 4);
  const fifo4 = await runNode(doc, 'pageGrid');
  assert.equal(fifo4.data.faults, 10);
  const race = await runNode(doc, 'beladyRace');
  assert.equal(race.data.table.find((r: { cap: number }) => r.cap === 3).faults[0], 9);
  assert.equal(race.data.table.find((r: { cap: number }) => r.cap === 4).faults[0], 10);
  assert.equal(race.data.beladyAt, 4);
  assert.ok(race.data.table.every((r: { cap: number; faults: number[] }) => r.faults[2] <= r.faults[0])); // OPT ≤ FIFO
  const frag = await runNode(doc, 'allocFrag');
  assert.ok(frag.data.ffPlaced + frag.data.bfPlaced + frag.data.wfPlaced > 0);
});

test('CN 第 5 章：超时 cwnd 归 1、3-ACK 减半、rwnd 限流', async () => {
  const doc = lab408TemplateDoc('cn03-tcp-transport');
  setParam(doc, 'cwndCurve', 'lossType', 1);
  const timeout = await runNode(doc, 'cwndCurve');
  assert.equal(timeout.data.cwndAtLoss, 1);
  setParam(doc, 'cwndCurve', 'lossType', 0);
  const dup = await runNode(doc, 'cwndCurve');
  // 3-ACK：cwnd(9)=14 → ssthresh=7 → cwnd=7
  assert.equal(dup.data.ssthAfter, 7);
  assert.equal(dup.data.cwndAtLoss, 7);
  const hs = await runNode(doc, 'handshake');
  assert.equal(hs.data.msgs, 8);
  const win = await runNode(doc, 'winLimit');
  assert.ok(win.data.limitedByRwnd > 0); // rwnd=16 会卡住部分 RTT
  setParam(doc, 'rwnd', 'v', 64);
  const open = await runNode(doc, 'winLimit');
  assert.equal(open.data.limitedByRwnd, 0);
});

test('DS 第 4 章：中序遍历升序、哈夫曼 WPL 最小、AVL 旋转修复', async () => {
  const doc = lab408TemplateDoc('ds02-trees');
  const inorder = await runNode(doc, 'traversal'); // order 默认 1 = 中序
  const seq = inorder.data.sequence as number[];
  assert.deepEqual([...seq].sort((a, b) => a - b), seq);
  const huff = await runNode(doc, 'huffman');
  assert.ok(huff.data.wpl > 0 && huff.data.merges === huff.data.leaves - 1);
  const avl = await runNode(doc, 'avl');
  assert.ok(avl.data.height <= Math.ceil(Math.log2(avl.data.count + 1)) + 1);
  const src = doc.nodes.find((n) => n.id === 'seq')!;
  src.text = '30 20 10'; // 触发 LL 单旋
  const ll = await runNode(doc, 'avl');
  assert.ok(ll.data.fixes.some((f: { kind: string }) => f.kind === 'LL'));
});

test('DS 第 6–7 章：散列 α 决定探测，排序结果正确', async () => {
  const doc = lab408TemplateDoc('ds04-search-sort');
  const hash = await runNode(doc, 'hashProbe');
  assert.ok(hash.data.asl >= 1);
  const sorted = await runNode(doc, 'sortRace');
  const expect = [...(sorted.data.sorted as number[])].sort((a, b) => a - b);
  assert.deepEqual(sorted.data.sorted, expect);
  assert.ok(sorted.data.mergeCmp > 0 && sorted.data.heapCmp > 0);
  const bt = await runNode(doc, 'btree');
  assert.ok(bt.data.splits > 0); // 11 键进 3 阶树必分裂
});

test('CO 第 1–2 章：IEEE 边界、双符号位溢出、Booth 乘积正确', async () => {
  const doc = lab408TemplateDoc('co01-data-alu');
  setParam(doc, 'expo', 'v', 127);
  const spec = await runNode(doc, 'ieee754');
  assert.match(String(spec.data.kind), /规格化/);
  setParam(doc, 'expo', 'v', 0);
  setParam(doc, 'ieee754', 'frac', 4194304);
  assert.equal((await runNode(doc, 'ieee754')).data.denorm, true);
  setParam(doc, 'ieee754', 'frac', 0);
  setParam(doc, 'expo', 'v', 255);
  assert.equal((await runNode(doc, 'ieee754')).data.inf, true);
  const ovf = await runNode(doc, 'overflow'); // a=60(operand), b=70
  assert.equal(ovf.data.overflow, true);
  setParam(doc, 'operand', 'v', 10);
  assert.equal((await runNode(doc, 'overflow')).data.overflow, false);
  setParam(doc, 'operand', 'v', 10);
  const booth = await runNode(doc, 'booth'); // x=operand=10, y=-3
  assert.equal(booth.data.product, -30);
  assert.equal(booth.data.ok, true);
});

test('CO 第 5–7 章：关转发 CPI 恶化，DMA 占用最低', async () => {
  const doc = lab408TemplateDoc('co04-pipeline-io');
  const cpi = await runNode(doc, 'cpiRace');
  assert.ok(cpi.data.noFwdTotal > cpi.data.fwdTotal);
  const io = await runNode(doc, 'ioMode');
  assert.ok(io.data.busy[2] < io.data.busy[0]);
});

test('OS 第 1–2 章：SJF 周转不劣于 FCFS，PV 错序死锁，银行家安全', async () => {
  const doc = lab408TemplateDoc('os01-process-sched');
  const race = await runNode(doc, 'schedRace');
  assert.ok(race.data.avgTurn[1] <= race.data.avgTurn[0]); // SJF ≤ FCFS
  const doc2 = lab408TemplateDoc('os02-sync-deadlock');
  const pv = await runNode(doc2, 'pvSim');
  assert.equal(pv.data.deadlockAt, null); // 正确顺序不死锁
  setParam(doc2, 'pvSim', 'wrong', 1);
  const dead = await runNode(doc2, 'pvSim');
  assert.ok(dead.data.deadlockAt !== null);
  const banker = await runNode(doc2, 'banker');
  assert.equal(banker.data.safe, true);
  assert.deepEqual(banker.data.order[0], 'P1');
});

test('CPU 调度：RR 预设同步双图，时间片轮转且按原始到达时间计算周转', async () => {
  let doc = lab408TemplateDoc('os01-process-sched');
  setParam(doc, 'q', 'v', 5);
  const gantt = doc.nodes.find((node) => node.id === 'schedGantt')!;
  const payload = parseAiRulePayload(gantt.payload)!;
  const preset = payload.presets!.find((item) => item.label === 'RR q=2')!;
  doc = applyRulePreset(doc, gantt.id, preset, payload.presetSource);
  assert.equal(doc.nodes.find((node) => node.id === 'q')!.params.v, 2);

  const rr = await runNode(doc, gantt.id);
  const finalFrame = rr.frames.at(-1)!;
  assert.deepEqual(finalFrame.rows?.map((row) => row.slice(0, 5)), [
    ['P1', 0, 8, 22, 22], ['P2', 1, 4, 12, 11],
    ['P3', 2, 9, 26, 24], ['P4', 3, 5, 23, 20],
  ]);
  assert.deepEqual(finalFrame.timeline?.[0].segments.slice(0, 4).map(({ label, start, end }) =>
    [label, start, end]), [['P1', 0, 2], ['P2', 2, 4], ['P3', 4, 6], ['P1', 6, 8]]);
  assert.equal(rr.data.avgTurn, 19.25);
  assert.equal(rr.data.avgWTurn, 3.04);
  const race = await runNode(doc, 'schedRace');
  assert.deepEqual(race.data.avgTurn, [15.25, 14.25, 13, 19.25]);
  assert.equal(race.data.avgWTurn[3], rr.data.avgWTurn);
  assert.equal(race.data.switches[3], rr.data.switches);
});

test('OS 第 4–5 章：SSTF 不劣于 FCFS，inode 容量核算', async () => {
  const doc = lab408TemplateDoc('os04-file-io');
  const disk = await runNode(doc, 'diskTrace');
  assert.ok(disk.data.totals.SSTF <= disk.data.totals.FCFS);
  const inode = await runNode(doc, 'inode');
  assert.equal(inode.data.perBlk, 1024);
  assert.ok(inode.data.maxFileKB > 16 * 1024 * 1024); // 4KB 块上限 > 16GB
  assert.equal(inode.data.fits, true);
});

test('CN 第 2–3 章：争用期 2τ 与最短帧长，曼彻斯特中点必跳', async () => {
  const doc = lab408TemplateDoc('cn01-phys-datalink');
  const csma = await runNode(doc, 'csma'); // dist=1km, rate=100Mbps
  assert.ok(Math.abs(csma.data.tauUs - 5) < 0.01);
  assert.ok(Math.abs(csma.data.contentionUs - 10) < 0.01);
  assert.equal(csma.data.minBytes, 125);
  const manch = await runNode(doc, 'manchester');
  assert.ok(manch.data.bits.length >= 8);
  const arq = await runNode(doc, 'arqRace');
  assert.ok(arq.data.sends[1] > arq.data.sends[2]); // GBN 回退整窗，SR 最省重传
});

test('CN 第 4 章：/26 子网 62 主机，分片偏移按 8B', async () => {
  const doc = lab408TemplateDoc('cn02-ip-routing');
  const sub = await runNode(doc, 'subnet'); // plen=26
  assert.equal(sub.data.hosts, 62);
  assert.equal(sub.data.net, '192.168.1.0');
  const frag = await runNode(doc, 'frag'); // mtu=1500, size=4000
  assert.equal(frag.data.frags, 3);
  assert.deepEqual(frag.data.offsets, [0, 185, 370]);
  const conv = await runNode(doc, 'ripOspf');
  assert.ok(conv.data.ripRounds > conv.data.ospfSteps);
});

test('CN 第 6 章：流水线 HTTP 总耗时腰斩，五层封装齐全', async () => {
  const doc = lab408TemplateDoc('cn04-app-fullpath');
  const http = await runNode(doc, 'dnsHttp'); // rtt=30, objs=4, dns=3
  assert.ok(http.data.costs[2] < http.data.costs[0]);
  const stack = await runNode(doc, 'stackRule');
  assert.equal(stack.data.layers.length, 5);
  const dns = await runNode(doc, 'rttRace');
  assert.ok(dns.data.recursiveHops > dns.data.iterativeHops);
});
