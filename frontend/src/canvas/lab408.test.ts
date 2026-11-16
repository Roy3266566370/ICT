import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheSplit,
  pageReplacement,
  subnetInfo,
  treeTraversal,
  TRAVERSAL_LABELS,
} from './lab408.ts';
import { LAB408_TEMPLATES, LAB408_WORKBENCH_TEMPLATES, lab408TemplateDoc } from './lab408Templates.ts';
import { MANUAL_408_SUBJECTS } from '../labs/manual408.ts';

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

test('408 工坊模板覆盖四个科目并生成对应实验节点', () => {
  assert.deepEqual(LAB408_TEMPLATES.map(template => template.kind), ['dsTraversal', 'cacheSplit', 'pageReplace', 'ipSubnet']);
  for (const template of LAB408_TEMPLATES) {
    const doc = lab408TemplateDoc(template.kind);
    assert.equal(doc.title, template.name);
    assert.equal(doc.wires.length, 0);
    assert.ok(doc.nodes.some(node => node.type === template.node));
    assert.ok(doc.nodes.some(node => node.type === 'textNote' && node.text?.includes('探究')));
  }
});

test('408 工作台模板覆盖四个科目并能切换全题型', () => {
  assert.equal(LAB408_WORKBENCH_TEMPLATES.length, 4);
  for (const template of LAB408_WORKBENCH_TEMPLATES) {
    const subject = MANUAL_408_SUBJECTS[template.subjectIndex];
    assert.ok(subject, template.kind);
    assert.ok(subject.groups.flatMap(group => group.types).some(type => type.id === template.typeId), template.kind);
    const doc = lab408TemplateDoc(template.kind);
    const node = doc.nodes.find(item => item.type === 'lab408Workbench');
    assert.ok(node, template.kind);
    assert.equal(node.params.subjectIndex, template.subjectIndex);
    assert.ok(node.text, template.kind);
  }
});
