/**
 * `document.test.ts` —— 自由编辑的文档模型单测（纯函数，无需浏览器）。
 *
 * 跑法（Node ≥ 22.6，原生类型擦除）：
 *   cd frontend && npm test
 *
 * 断言重点：保存时只上行改动字段（不整份覆盖）、样式单独成包、新增/删除对象
 * 走 create / deleted 两种语义、以及新建对象的默认位置与参考样式。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPayload,
  diffDocuments,
  distributeNodes,
  newNode,
  patchNodes,
  rebaseDocument,
} from './model.ts';
import { applySlideLayout, isImagePlaceholder, layoutNodes } from './layouts.ts';
import { THEMES, presetTheme } from './themes.ts';
import type { SceneDocument, SceneNode } from './types.ts';

function node(overrides: Partial<SceneNode> = {}): SceneNode {
  return {
    id: 'n_1',
    name: '标题',
    type: 'text',
    x: 10,
    y: 20,
    width: 300,
    height: 80,
    rotation: 0,
    z: 1,
    opacity: 1,
    locked: false,
    hidden: false,
    deleted: false,
    text: '原始文字',
    style: { font_size: 24, font_family: '微软雅黑', color: '#18233D' },
    base_style: { font_size: 24, font_family: '微软雅黑', color: '#18233D' },
    base_text: '原始文字',
    ...overrides,
  };
}

function doc(nodes: SceneNode[]): SceneDocument {
  return {
    schema_version: '1.0',
    revision: 3,
    title: '测试文档',
    pages: [{ page_no: 1, width: 1280, height: 720, nodes }],
  };
}

test('只把改动过的字段放进 patch，没动的字段不上行', () => {
  const base = doc([node()]);
  const current = doc([node({ x: 42, text: '新文字' })]);
  const changes = diffDocuments(base, current);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.id, 'n_1');
  assert.deepEqual(changes[0]!.patch, { x: 42, text: '新文字' });
});

test('文字样式改动单独成 style 包，不掺杂几何字段', () => {
  const base = doc([node()]);
  const current = doc([node({ style: { ...node().style, bold: true } })]);
  const [change] = diffDocuments(base, current);
  assert.deepEqual(change!.patch, { style: { bold: true } });
  assert.equal('x' in (change!.patch ?? {}), false);
});

test('新增对象走 create，删除对象走 deleted，不产生空 patch', () => {
  const base = doc([node()]);
  const added = doc([node(), node({ id: 'u_1', name: '新文字', text: '新的' })]);
  const created = diffDocuments(base, added);
  assert.equal(created.length, 1);
  assert.ok(created[0]!.create, '新增对象应带 create 负载');
  assert.equal(created[0]!.id, 'u_1');

  const removed = diffDocuments(base, doc([node({ deleted: true })]));
  assert.deepEqual(removed, [{ page_no: 1, id: 'n_1', patch: { deleted: true } }]);
});

test('patchNodes 不改原对象（撤销栈依赖不可变数据）', () => {
  const base = doc([node()]);
  const next = patchNodes(base, 1, ['n_1'], { x: 99, style: { color: '#FF0000' } });
  assert.equal(base.pages[0]!.nodes[0]!.x, 10);
  assert.equal(base.pages[0]!.nodes[0]!.style.color, '#18233D');
  assert.equal(next.pages[0]!.nodes[0]!.x, 99);
  assert.equal(next.pages[0]!.nodes[0]!.style.color, '#FF0000');
  assert.equal(next.pages[0]!.modified, true);
});

test('复制对象只带可编辑属性，图片二进制不重复上行', () => {
  const source = node({ type: 'image', image_data: 'data:image/png;base64,AAA', asset_id: 'a1' });
  const copy = node({ ...source, id: 'u_2', duplicate_from: 'n_1' });
  const payload = createPayload(copy);
  assert.equal(payload.duplicate_from, 'n_1');
  assert.equal('image_data' in payload, false, '复制应复用源对象资源，不重传图片');
  assert.equal(payload.width, 300);
});

test('新建图片会带 image_data，新建文字不带', () => {
  const image = createPayload(node({ id: 'u_3', type: 'image', image_data: 'data:image/png;base64,AAA' }));
  assert.equal(image.image_data, 'data:image/png;base64,AAA');
  const text = createPayload(node({ id: 'u_4' }));
  assert.equal('image_data' in text, false);
  assert.equal(text.type, 'text');
});

test('新建文字落在页面中央，并继承本页字号最大的文字样式', () => {
  const page = doc([
    node({ id: 'foot', style: { font_size: 9, font_family: '宋体', color: '#999999' }, text: '页脚' }),
    node({ id: 'title', style: { font_size: 51, font_family: '微软雅黑', color: '#FFFFFF' }, text: '大标题' }),
  ]).pages[0]!;
  const created = newNode(page, 'u_5', 'text');
  assert.equal(created.x, Math.round((1280 - 320) / 2));
  assert.equal(created.y, Math.round((720 - 70) / 2));
  assert.equal(created.style.font_family, '微软雅黑');
  assert.equal(created.style.color, '#FFFFFF');
});

test('两端同时改同一字段时 rebase 报冲突，改不同字段则自动合并', () => {
  const base = doc([node()]);
  const local = doc([node({ x: 100 })]);
  const sameField = doc([node({ x: 300 })]);
  const conflict = rebaseDocument(base, local, sameField);
  assert.equal(conflict.conflicts.length, 1);

  const otherField = doc([node({ y: 200 })]);
  const merged = rebaseDocument(base, local, otherField);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.document.pages[0]!.nodes[0]!.x, 100);
  assert.equal(merged.document.pages[0]!.nodes[0]!.y, 200);
});

test('横向分布保持首尾不动并平均分配剩余间距', () => {
  const base = doc([
    node({ id: 'a', x: 10, width: 20 }),
    node({ id: 'b', x: 100, width: 30 }),
    node({ id: 'c', x: 300, width: 40 }),
  ]);
  const next = distributeNodes(base, 1, ['c', 'a', 'b'], 'h');
  const [a, b, c] = ['a', 'b', 'c'].map(id => next.pages[0]!.nodes.find(n => n.id === id)!);
  assert.equal(a.x, 10);
  assert.equal(b.x, 150);
  assert.equal(c.x, 300);
});

test('纵向分布同样保持首尾并平均分配间距', () => {
  const base = doc([
    node({ id: 'a', y: 10, height: 20 }),
    node({ id: 'b', y: 100, height: 30 }),
    node({ id: 'c', y: 300, height: 40 }),
  ]);
  const next = distributeNodes(base, 1, ['a', 'b', 'c'], 'v');
  const [a, b, c] = ['a', 'b', 'c'].map(id => next.pages[0]!.nodes.find(n => n.id === id)!);
  assert.equal(a.y, 10);
  assert.equal(b.y, 150);
  assert.equal(c.y, 300);
});

test('不足三个对象时分布不产生改动', () => {
  const base = doc([node({ id: 'a' }), node({ id: 'b', x: 100 })]);
  assert.equal(distributeNodes(base, 1, ['a', 'b'], 'v'), base);
});


test('在保存前更换副本图片，仅单独上行变更后的图片', () => {
  const source = node({type:'image', image_data:'data:image/png;base64,AAA'});
  const copy = node({...source,id:'u_2',duplicate_from:source.id,image_data:'data:image/png;base64,BBB'});
  const base=doc([source]);
  assert.equal(diffDocuments(base,doc([source,{...copy,image_data:source.image_data}])).length,1);
  const changes=diffDocuments(base,doc([source,copy]));
  assert.equal(changes[0]?.create?.image_data,undefined);
  assert.deepEqual(changes[1]?.patch,{image_data:copy.image_data});
  assert.deepEqual(rebaseDocument(base,doc([source,copy]),base).conflicts,[]);
});

test('换版替换旧装饰并保留自建对象及已经填写的图片占位', () => {
  const original=doc([node({id:'custom',type:'shape',name:'自建卡片'})]);
  const page=original.pages[0]!;
  const generated=layoutNodes(page,'text-image');
  const slot=generated.find(item=>item.name==='图片占位')!;
  const withLayout={...page,layout_id:'text-image' as const,nodes:[...page.nodes,...generated]};
  assert.equal(isImagePlaceholder(withLayout,slot),true);
  const repurposed={...slot,text:'讲解提示'};
  assert.equal(isImagePlaceholder(withLayout,repurposed),false);
  withLayout.nodes=withLayout.nodes.map(item=>item===slot?repurposed:item);
  let count=0;
  const identifier=()=>`u_layout_${++count}`;
  const next=applySlideLayout({...original,pages:[withLayout]},withLayout,'agenda',identifier);
  const current=next.pages[0]!;
  const repeated=applySlideLayout(next,current,'agenda',identifier).pages[0]!;
  assert.equal(repeated.nodes.filter(item=>item.name==='目录卡片').length,4);
  assert.equal(repeated.nodes.some(item=>item.name==='左侧卡片'),false);
  assert.ok(repeated.nodes.includes(repurposed));
  assert.ok(repeated.nodes.includes(page.nodes[0]!));
});

test('预设主题将卡片、边框、辅助文字和图表色分开', () => {
  for(const [id] of THEMES){
    const {palette}=presetTheme(id,'16:9')!;
    assert.notEqual(palette.surface,palette.background);
    assert.notEqual(palette.muted,palette.text);
    assert.notEqual(palette.border,palette.primary);
    assert.equal(new Set([palette.primary,palette.accent,palette.secondary]).size,3);
  }
});
