/**
 * `unifiedSpecState.test.ts` —— 单一状态源的纯函数单测（P0-02 验收 4）。
 *
 * 运行（Node ≥ 22.6，原生 type stripping）：
 *   cd frontend && node --test src/components/reader/unifiedSpecState.test.ts
 *
 * 断言重点：图读的合并参数、表读的 rows、保存/校验读的 object 是**同一个值**；
 * 用户改一个区域不会污染另一个区域；恢复原稿后回到基线。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyRegionParamsToObject,
  applySpecValuesToObject,
  buildUnifiedRows,
  mergeAllRegionParams,
  sanitizeRegionOverrides,
  formatUnifiedValue,
} from './unifiedSpecState.ts';

const REGION = {
  region_id: 'rgn_s06_vectors',
  material_id: 'mat_matrix_courseware',
  page: 6,
  status: 'confirmed',
  script_id: 'matrix_eigen_2d',
  original_params: { a11: 2, a12: 1, a21: 1, a22: 2 },
};

const OTHER_REGION = {
  ...REGION,
  region_id: 'rgn_s09_columns',
  page: 9,
  original_params: { a11: 1, a12: 0, a21: 0, a22: 1 },
};

function buildObject() {
  return {
    object_id: 'obj_matrix_1',
    template_id: 'matrix_2d',
    parameters: [
      { id: 'a11', name: '矩阵元素 a11', type: 'decimal', value: 2, unit: '1' },
      { id: 'a12', name: '矩阵元素 a12', type: 'decimal', value: 1, unit: '1' },
      { id: 'a21', name: '矩阵元素 a21', type: 'decimal', value: 1, unit: '1' },
      { id: 'a22', name: '矩阵元素 a22', type: 'decimal', value: 2, unit: '1' },
      { id: 'vector_x', name: '输入向量 x', type: 'vector2', value: [1, 1], unit: '1' },
    ],
  };
}

test('合并结果唯一：图 / 表 / 保存对象读到同一个值', () => {
  const merged = mergeAllRegionParams([REGION], { rgn_s06_vectors: { a11: 5 } });
  const graphValue = merged.rgn_s06_vectors.a11;
  assert.equal(graphValue, 5);

  const object = buildObject();
  const objectWithParams = applyRegionParamsToObject(object, REGION, merged.rgn_s06_vectors);
  const rows = buildUnifiedRows({
    spec: null,
    specValues: {},
    object: objectWithParams,
    activeRegion: REGION,
    activeParams: merged.rgn_s06_vectors,
  });

  const tableRow = rows.find((row) => row.id === 'a11');
  assert.ok(tableRow, '表格必须包含 a11 行');
  assert.equal(tableRow.valueText, formatUnifiedValue(graphValue));
  assert.equal(objectWithParams.parameters.find((p) => p.id === 'a11').value, graphValue);

  // 投影不修改原对象（保存基线仍保持原稿语义）
  assert.equal(object.parameters.find((p) => p.id === 'a11').value, 2);
});

test('区域隔离：改 S6 不影响 S9，也不改 original_params', () => {
  const merged = mergeAllRegionParams([REGION, OTHER_REGION], {
    rgn_s06_vectors: { a11: 5 },
  });

  assert.equal(merged.rgn_s06_vectors.a11, 5);
  assert.equal(merged.rgn_s09_columns.a11, 1);
  assert.equal(REGION.original_params.a11, 2, 'original_params 必须保持原稿值');
  assert.notEqual(merged.rgn_s06_vectors, REGION.original_params, '合并结果必须是新对象');
});

test('恢复原稿：清空覆盖后回到基线', () => {
  const merged = mergeAllRegionParams([REGION], {});
  assert.equal(merged.rgn_s06_vectors.a11, 2);
  assert.deepEqual(merged.rgn_s06_vectors, REGION.original_params);
});

test('无对象时表格直接读区域参数（图与表同值）', () => {
  const merged = mergeAllRegionParams([REGION], { rgn_s06_vectors: { a22: 7 } });
  const rows = buildUnifiedRows({
    spec: null,
    specValues: {},
    object: null,
    activeRegion: REGION,
    activeParams: merged.rgn_s06_vectors,
  });
  const row = rows.find((item) => item.id === 'a22');
  assert.ok(row);
  assert.equal(row.valueText, formatUnifiedValue(merged.rgn_s06_vectors.a22));
  assert.equal(row.source, 'region');
});

test('有 iSpec 时表格读 specValues（与 ISpecView 同一份）', () => {
  const spec = {
    object_id: 'spec_matrix_p6',
    kind: 'parametric',
    parameters: [
      { id: 'lambda', label: '缩放倍数', type: 'number', default: 1, unit: '1' },
      { id: 'theta', label: '旋转角', type: 'number', default: 0, unit: '°' },
    ],
    views: [{ type: 'text', template: 'λ = {lambda}' }],
  };
  const rows = buildUnifiedRows({
    spec,
    specValues: { lambda: 3, theta: 0 },
    object: buildObject(),
    activeRegion: REGION,
    activeParams: { a11: 5 },
  });

  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.id === 'lambda').valueText, '3');
  assert.equal(rows.find((row) => row.id === 'lambda').source, 'spec');
  assert.equal(rows.find((row) => row.id === 'theta').valueText, '0');
});

test('存储清洗：非法区域/值被丢弃，避免读到别人的脏数据', () => {
  assert.deepEqual(sanitizeRegionOverrides(null), {});
  assert.deepEqual(sanitizeRegionOverrides('bad'), {});
  assert.deepEqual(
    sanitizeRegionOverrides({
      rgn_s06_vectors: { a11: 5 },
      rgn_broken: 'not-a-record',
    }),
    { rgn_s06_vectors: { a11: 5 } },
  );
});

test('类型收窄：字符串不会硬塞进 matrix2 / vector2', () => {
  const object = buildObject();
  const projected = applyRegionParamsToObject(object, REGION, {
    a11: '5',
    vector_x: ['1', '2'],
  });
  // decimal 接受数字字符串
  assert.equal(projected.parameters.find((p) => p.id === 'a11').value, 5);
  // vector2 拒绝字符串元素，保持原值
  assert.deepEqual(projected.parameters.find((p) => p.id === 'vector_x').value, [1, 1]);
});
test('命名差异投影：区域 a11..a22 合成对象的 matrix_A（保存与校验同源）', () => {
  const object = {
    object_id: 'obj_matrix_1',
    template_id: 'matrix_2d',
    parameters: [
      { id: 'matrix_A', name: '矩阵 A', type: 'matrix2', value: [[2, 1], [1, 2]], unit: '1' },
    ],
  };
  const projected = applyRegionParamsToObject(object, REGION, {
    a11: 2.5,
    a12: 1,
    a21: 1,
    a22: 2,
  });
  assert.deepEqual(projected.parameters[0].value, [[2.5, 1], [1, 2]]);
  // 原对象不被改写，保存基线仍是原稿
  assert.deepEqual(object.parameters[0].value, [[2, 1], [1, 2]]);
});
test('iSpec 参数也投影到知识对象（图 / 表 / 保存同源）', () => {
  const object = {
    object_id: 'obj_matrix_1',
    template_id: 'matrix_2d',
    parameters: [
      { id: 'matrix_A', name: '矩阵 A', type: 'matrix2', value: [[2, 1], [1, 2]], unit: '1' },
    ],
  };
  const spec = {
    object_id: 'spec_p6',
    kind: 'parametric',
    parameters: [{ id: 'a11', label: 'a11', type: 'number', default: 2 }],
    views: [{ type: 'text', template: 'a11 = {a11}' }],
  };
  const projected = applySpecValuesToObject(object, spec, { a11: 3 });
  assert.deepEqual(projected.parameters[0].value, [[3, 1], [1, 2]]);
});