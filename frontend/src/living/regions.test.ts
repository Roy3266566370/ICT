import assert from 'node:assert/strict';
import test from 'node:test';
import { canInsertRegion, functionDocForRegion, planRegionInsert, regionAriaLabel, regionStyle } from './regions.ts';
import type { PageRegion } from './types.ts';

test('区域 bbox 归一化坐标转百分比定位', () => {
  assert.deepEqual(regionStyle({ bbox: [0.1, 0.2, 0.5, 0.6] }), {
    left: '10.000%', top: '20.000%', width: '40.000%', height: '40.000%',
  });
});

test('越界与反序坐标收敛到可点击范围', () => {
  assert.deepEqual(regionStyle({ bbox: [-0.2, 0.9, 1.2, 1.1] }), {
    left: '0.000%', top: '90.000%', width: '100.000%', height: '10.000%',
  });
  assert.deepEqual(regionStyle({ bbox: [0.8, 0.7, 0.2, 0.3] }), {
    left: '20.000%', top: '30.000%', width: '60.000%', height: '40.000%',
  });
});

test('非法数值退回原点且保留最小可点击尺寸', () => {
  assert.deepEqual(regionStyle({ bbox: [Number.NaN, 0.2, 0.2, 0.2] }), {
    left: '0.000%', top: '20.000%', width: '20.000%', height: '0.500%',
  });
});

test('区域无障碍标签包含类型与文字', () => {
  assert.equal(regionAriaLabel({ kind: 'diagram', label: '多头注意力' }), '图示：多头注意力');
  assert.equal(regionAriaLabel({ kind: 'formula', label: '' }), '公式：可交互区域');
});

function fakeRegion(patch: Partial<PageRegion>): PageRegion {
  return {
    id: 'r1', kind: 'formula', bbox: [0.1, 0.1, 0.5, 0.5], asset_id: 'r1',
    label: '公式', ...patch,
  };
}

test('公式区域 expression → 标准函数图画布（源+图+滑杆，连线合法）', () => {
  const doc = functionDocForRegion(fakeRegion({ expression: 'x^2 + a' }));
  assert.ok(doc, '可求值表达式应生成画布');
  const types = doc!.nodes.map((node) => node.type);
  assert.deepEqual(types, ['functionSource', 'functionPlot', 'slider']);
  const source = doc!.nodes[0]!;
  assert.equal(source.text, 'x^2 + a');
  assert.deepEqual(
    doc!.wires.map((wire) => [wire.from, wire.to, wire.toPort]),
    [['f_src', 'f_plot', 'in'], ['f_x', 'f_plot', 'x']],
  );
});

test('无法求值的表达式不生成画布', () => {
  assert.equal(functionDocForRegion(fakeRegion({ expression: '\\int x dx' })), null);
  assert.equal(functionDocForRegion(fakeRegion({})), null);
});

let nextId = 0;
const idGen = (): string => `blk_${nextId++}`;

test('公式区域插入计划：formula + canvas 双块，参数绑定页面变量', () => {
  const plan = planRegionInsert(
    fakeRegion({ latex: 'y = x^2 + a', expression: 'x^2 + a', params: ['a'] }),
    new Set(['a']), // 'a' 已被占用 → 新变量名 a2
    idGen,
  );
  assert.ok(plan);
  assert.equal(plan!.blocks.length, 2);
  assert.equal(plan!.blocks[0]!.type, 'formula');
  assert.equal(plan!.blocks[1]!.type, 'canvas');
  assert.equal(plan!.blockAnchorId, plan!.blocks[0]!.id, '公式锚点落在 formula 块');
  assert.equal(plan!.canvasAnchorId, plan!.blocks[1]!.id, '画布锚点回写 canvas_block_id');
  assert.equal(plan!.blocks[1]!.bindings?.['f_src.a'], 'a2');
  assert.equal(plan!.variables['a2']?.type, 'number');
});

test('已有公式锚块的区域：只插 canvas 不重复 formula', () => {
  const plan = planRegionInsert(
    fakeRegion({
      latex: 'y = x^2 + a', expression: 'x^2 + a', params: ['a'],
      block_id: 'blk_existing_formula',
    }),
    new Set(), idGen,
  );
  assert.ok(plan);
  assert.equal(plan!.blocks.length, 1, '保真块已存在时不重复插 formula');
  assert.equal(plan!.blocks[0]!.type, 'canvas');
  assert.equal(plan!.blockAnchorId, undefined, 'block_id 保持原值');
  assert.equal(plan!.canvasAnchorId, plan!.blocks[0]!.id);
  assert.equal(plan!.blocks[0]!.bindings?.['f_src.a'], 'a');
  // 已有锚块但表达式不可求值 → 无可插入内容
  assert.equal(planRegionInsert(
    fakeRegion({ latex: '\\int x dx', block_id: 'blk_existing' }), new Set(), idGen,
  ), null);
});

test('无 latex 且无表达式的公式区域不可插入', () => {
  assert.equal(canInsertRegion(fakeRegion({})), false);
  assert.equal(planRegionInsert(fakeRegion({}), new Set(), idGen), null);
});

test('图示区域插入计划落成 figure 块', () => {
  const plan = planRegionInsert(
    fakeRegion({ kind: 'diagram', caption: '结构图', label: 'pipeline' }),
    new Set(), idGen,
  );
  assert.ok(plan);
  assert.equal(plan!.blocks[0]!.type, 'figure');
  assert.equal(plan!.blockAnchorId, plan!.blocks[0]!.id);
  assert.deepEqual(plan!.variables, {});
});