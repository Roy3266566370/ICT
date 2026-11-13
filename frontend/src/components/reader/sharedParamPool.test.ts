/**
 * `sharedParamPool.test.ts` —— 跨 iSpec 共享池的纯函数单测（§9-4）。
 *
 * 运行（Node ≥ 22.6，原生 type stripping）：
 *   cd frontend && node --test src/components/reader/sharedParamPool.test.ts
 *
 * 断言重点：同一 `shared_key` 在两条 iSpec 之间**读到同一个值**；默认值不一致只报冲突、
 * 不自动统一；取值不一致时一致性校验返回 `ok:false`。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applySharedValuesToSpec,
  checkSharedConsistency,
  collectSharedGroups,
  describeSharedConflict,
  memberValueKey,
  sanitizeSharedValues,
  setSharedValue,
  sharedValueOf,
  type SharedValues,
} from './sharedParamPool.ts';
import type { ISpec, SpecParameter } from '../../ispec/types.ts';
import type { SpecValues } from './unifiedSpecState.ts';

const SHARED_KEY = 'shared_销售额_1a2b3c4d';

function parameter(id: string, page: number, defaultValue: number): SpecParameter {
  return {
    id,
    label: '销售额',
    type: 'number',
    unit: '万元',
    default: defaultValue,
    shared_key: SHARED_KEY,
    source: {
      page,
      element_id: `p0${page}_s00`,
      bbox: null,
      status: 'original',
      excerpt: '销售额',
    },
  };
}

function spec(objectId: string, page: number, parameterId: string, defaultValue: number): ISpec {
  return {
    spec_version: '1.0',
    object_id: objectId,
    kind: 'parametric',
    parameters: [parameter(parameterId, page, defaultValue)],
    views: [{ type: 'text', template: '销售额 {{value}}' }],
  };
}

const PAGE_A = spec('ispec_p02_chart', 2, 'sales', 10);
const PAGE_B = spec('ispec_p07_table', 7, 'sales_total', 10);

test('共享组：同一 shared_key 在多页归为一组', () => {
  const groups = collectSharedGroups([PAGE_A, PAGE_B]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.shared_key, SHARED_KEY);
  assert.equal(groups[0]?.members.length, 2);
  assert.equal(groups[0]?.conflict, undefined);
  assert.deepEqual(
    groups[0]?.members.map((member) => member.page),
    [2, 7],
  );

  // 没有 shared_key 的参数不进入共享组
  const plain: ISpec = {
    ...PAGE_A,
    object_id: 'ispec_p03_plain',
    parameters: [{ ...parameter('sales', 3, 10), shared_key: undefined }],
  };
  assert.deepEqual(collectSharedGroups([plain]), []);
});

test('写池后另一页读到同一个值（跨 iSpec 同步）', () => {
  let pool: SharedValues = {};
  pool = setSharedValue(pool, SHARED_KEY, 88);
  assert.equal(sharedValueOf(pool, SHARED_KEY), 88);

  const readOnPageB = applySharedValuesToSpec(PAGE_B, { sales_total: 10 }, pool);
  assert.equal(readOnPageB.sales_total, 88, '第 7 页必须读到第 2 页改过的值');

  // 池值未变化时返回原对象（避免无意义重渲染）
  assert.equal(setSharedValue(pool, SHARED_KEY, 88), pool);

  // 未改动的页保持自己的值（池里没有该键时不覆盖）
  assert.deepEqual(applySharedValuesToSpec(PAGE_B, { sales_total: 10 }, {}), {
    sales_total: 10,
  });
  // 没有 shared_key 的参数不受共享池影响
  const unshared: ISpec = {
    ...PAGE_B,
    parameters: [{ ...parameter('sales_total', 7, 10), shared_key: undefined }],
  };
  assert.equal(applySharedValuesToSpec(unshared, { sales_total: 10 }, pool).sales_total, 10);
});

test('一致性校验：同值 ok，异值 ok=false', () => {
  const groups = collectSharedGroups([PAGE_A, PAGE_B]);
  const keys = [
    memberValueKey('ispec_p02_chart', 'sales'),
    memberValueKey('ispec_p07_table', 'sales_total'),
  ];

  const consistent = checkSharedConsistency(groups, { [keys[0]!]: 88, [keys[1]!]: 88 });
  assert.equal(consistent.length, 1);
  assert.equal(consistent[0]?.ok, true);

  const inconsistent = checkSharedConsistency(groups, { [keys[0]!]: 88, [keys[1]!]: 90 });
  assert.equal(inconsistent[0]?.ok, false);
  assert.match(inconsistent[0]?.message ?? '', /不一致/);
  assert.match(inconsistent[0]?.message ?? '', /请确认一个值/);
});

test('默认值冲突：标记 conflict 且提示用户确认（不自动统一）', () => {
  const groups = collectSharedGroups([
    spec('ispec_p02_chart', 2, 'sales', 10),
    spec('ispec_p07_table', 7, 'sales_total', 25),
  ]);
  assert.equal(groups[0]?.conflict, true);
  assert.deepEqual(groups[0]?.defaults, ['10', '25']);
  const text = describeSharedConflict(groups[0]!);
  assert.match(text, /销售额/);
  assert.match(text, /10 \/ 25/);
});

test('持久化清理：只保留标量值', () => {
  const cleaned = sanitizeSharedValues({ [SHARED_KEY]: 88, bad: null, nan: Number.NaN });
  assert.deepEqual(cleaned, { [SHARED_KEY]: 88 });
  assert.deepEqual(sanitizeSharedValues('not-a-record'), {});
});