import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheSplit,
  pageReplacement,
  subnetInfo,
  treeTraversal,
  TRAVERSAL_LABELS,
} from './lab408.ts';
import { LAB408_TEMPLATES, LAB408_TOPICS, VISIBLE_LAB408_TEMPLATES, lab408TemplateDoc, type Lab408Kind } from './lab408Templates.ts';
import { isLab408SandboxKind } from './lab408Sandboxes.ts';
import { WORKSHOP_PLUGIN_CATALOG } from './templateCatalog.ts';
import { evalOutput, makeCtx } from './engine.ts';

test('二叉树四种遍历给出确定序列', () => {
  assert.deepEqual(TRAVERSAL_LABELS, ['先序', '中序', '后序', '层序']);
  assert.deepEqual(treeTraversal(0), ['A', 'B', 'D', 'E', 'C', 'F']);
  assert.deepEqual(treeTraversal(1), ['D', 'B', 'E', 'A', 'C', 'F']);
  assert.deepEqual(treeTraversal(2), ['D', 'E', 'B', 'F', 'C', 'A']);
  assert.deepEqual(treeTraversal(3), ['A', 'B', 'C', 'D', 'E', 'F']);
});

test('Cache 地址划分按块大小、组数与路数分配位数', () => {
  const split = cacheSplit(32, 64, 64, 4);
  assert.equal(split.valid, true);
  assert.deepEqual([split.offset, split.index, split.tag], [6, 8, 18]);
  assert.equal(split.blocks, 1024);
  assert.equal(split.sets, 256);
  assert.equal(cacheSplit(8, 256, 64, 4).valid, false);
  assert.equal(cacheSplit(32, 48, 64, 4).valid, false);
});

test('页面置换 FIFO / LRU / OPT 的缺页次数与 Belady 异常', () => {
  assert.equal(pageReplacement(0, 3).faults, 9);
  assert.equal(pageReplacement(1, 3).faults, 10);
  assert.equal(pageReplacement(2, 3).faults, 7);
  assert.equal(pageReplacement(0, 4).faults, 10);
  assert.ok(pageReplacement(0, 4).faults > pageReplacement(0, 3).faults);
  assert.equal(pageReplacement(2, 3).hits, 5);
});

test('IPv4 子网划分给出网络地址、广播地址与可用范围', () => {
  const first = subnetInfo(26, 0);
  assert.equal(first.mask, '255.255.255.192');
  assert.equal(first.network, '192.168.1.0');
  assert.equal(first.broadcast, '192.168.1.63');
  assert.equal(first.hosts, 62);
  const last = subnetInfo(26, 3);
  assert.equal(last.network, '192.168.1.192');
  assert.equal(last.broadcast, '192.168.1.255');
  const slash30 = subnetInfo(30, 3);
  assert.equal(slash30.network, '192.168.1.12');
  assert.equal(slash30.broadcast, '192.168.1.15');
  assert.equal(slash30.hosts, 2);
  assert.equal(subnetInfo(26, 9).index, 3);
});

test('408 定象坊保留 21 张 legacy 模板 + 16 张全景沙盘，均生成结果面板', () => {
  assert.deepEqual(LAB408_TOPICS.map(topic => topic.id), ['l01', 'l02', 'l03', 'l04']);
  assert.equal(LAB408_TEMPLATES.length, 37);
  assert.equal(VISIBLE_LAB408_TEMPLATES.length, 16);
  assert.deepEqual(VISIBLE_LAB408_TEMPLATES.map(template => template.kind), [
    'ds01-linear-string', 'ds02-trees', 'ds03-graphs', 'ds04-search-sort',
    'co01-data-alu', 'co02-memory-cache', 'co03-isa-cpu', 'co04-pipeline-io',
    'os01-process-sched', 'os02-sync-deadlock', 'os03-memory-vm', 'os04-file-io',
    'cn01-phys-datalink', 'cn02-ip-routing', 'cn03-tcp-transport', 'cn04-app-fullpath',
  ]);
  assert.ok(LAB408_TEMPLATES.filter(t => t.legacy).every(t => !isLab408SandboxKind(t.kind)));
  for (const template of LAB408_TEMPLATES.filter(t => !t.legacy)) {
    const doc = lab408TemplateDoc(template.kind);
    assert.equal(doc.title, template.name);
    assert.ok(doc.nodes.some(node => node.type === 'aiRuleBlock'), template.kind);
    assert.ok(doc.panel, `${template.kind} 必须有 panel`);
    assert.ok((doc.panel?.view_node_ids.length ?? 0) > 0, `${template.kind} panel 需要停靠视图`);
  }
  for (const template of LAB408_TEMPLATES.filter(t => t.legacy)) {
    const doc = lab408TemplateDoc(template.kind);
    assert.equal(doc.title, template.name);
    assert.ok(doc.wires.length >= 2, template.kind);
    assert.ok(doc.nodes.filter(node => node.type === 'lab408Stage').length >= 3, template.kind);
    assert.ok(doc.nodes.some(node => node.type === 'textNote' && node.text?.includes('探究')));
    assert.ok(doc.panel, `${template.kind} 必须有 panel`);
    assert.ok((doc.panel?.view_node_ids.length ?? 0) > 0, `${template.kind} panel 需要停靠视图`);
    const ctx = makeCtx(doc, new Map());
    for (const stage of doc.nodes.filter((node) => node.type === 'lab408Stage')) {
      const value = evalOutput(ctx, stage.id);
      assert.equal(value?.kind, 'lab408Data', stage.payload);
      assert.equal(value.error, undefined, stage.payload);
      assert.ok(value.result.frames.length > 0, stage.payload);
    }
  }
});

test('编辑 408 源会更新末端，断开边后会等待有效输入', () => {
  const doc = lab408TemplateDoc('cacheSimLab');
  const source = doc.nodes.find((node) => node.payload === 'cacheSimLab/source')!;
  const sink = doc.nodes.find((node) => node.payload === 'cacheSimLab/amat')!;
  const before = evalOutput(makeCtx(doc, new Map()), sink.id);
  source.text = '0x1000 0x1000 0x1000';
  const after = evalOutput(makeCtx(doc, new Map()), sink.id);
  assert.equal(after?.kind, 'lab408Data');
  assert.notDeepEqual(after, before);
  assert.equal(after.result.frames.at(-1)?.rows?.[0]?.[0], 2);
  doc.wires = doc.wires.filter((wire) => wire.from !== source.id);
  const disconnected = evalOutput(makeCtx(doc, new Map()), sink.id);
  assert.equal(disconnected?.kind, 'lab408Data');
  assert.match(disconnected.error ?? '', /等待有效输入/);
});

test('408 题型工作台模板已从目录与模板构造器中移除', () => {
  assert.equal(LAB408_TEMPLATES.length, 37);
  for (const kind of ['dsWorkbench', 'coWorkbench', 'osWorkbench', 'netWorkbench'] as const) {
    assert.throws(() => lab408TemplateDoc(kind as Lab408Kind), /未知 408 模板/);
  }
});

test('活页插件目录只列 16 张全景沙盘，legacy 模板不再出现', () => {
  const catalogKinds = new Set(WORKSHOP_PLUGIN_CATALOG.map((entry) => entry.kind));
  for (const template of VISIBLE_LAB408_TEMPLATES) assert.ok(catalogKinds.has(template.kind), template.kind);
  for (const template of LAB408_TEMPLATES.filter(t => t.legacy)) assert.ok(!catalogKinds.has(template.kind), template.kind);
});
