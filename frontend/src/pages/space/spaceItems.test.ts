import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpaceItems, filterSpaceItems, findEarliestExpiry, materialCoverUrl, pickContinueItem } from './spaceItems.ts';
import type { MaterialSummary } from '../../api/types';
import type { WorkSummary } from '../../api/works';
import type { CustomBlockRecord } from '../../canvas/customBlocks.ts';

const sheet = { material_id: 'one/slide', title: '线性代数', page_count: 8, status: 'ready',
  created_at: '2026-11-23T08:00:00Z', expires_at: '2026-11-27T08:00:00Z', object_count: 0 } satisfies MaterialSummary;
const work = { work_id: 'project', title: '向量作品', node_count: 2, revision: 1, forked_from_share: null,
  created_at: '2026-11-22T08:00:00Z', updated_at: '2026-11-24T08:00:00Z' } satisfies WorkSummary;
const block = { id: 'block', title: 'Vector 积木', createdAt: Date.parse('2026-11-25T08:00:00Z'),
  sub: { nodes: [], wires: [], ports: [] } } satisfies CustomBlockRecord;

test('全部内容按真实时间倒序混排，损坏日期排在末尾', () => {
  assert.deepEqual(buildSpaceItems([sheet, { ...sheet, material_id: 'bad', created_at: 'invalid' }], [work], [block])
    .map(({kind, id}) => [kind, id]), [['block', 'block'], ['work', 'project'], ['material', 'one/slide'], ['material', 'bad']]);
  assert.equal(materialCoverUrl(sheet.material_id), '/api/v1/materials/one%2Fslide/renders/s01.png');
});

test('继续上次按活页创建时间和作品更新时间选择', () => {
  assert.equal(pickContinueItem([], []), null);
  assert.equal(pickContinueItem([sheet], [])?.kind, 'material');
  assert.equal(pickContinueItem([], [work])?.kind, 'work');
  assert.equal(pickContinueItem([sheet], [work])?.kind, 'work');
  assert.equal(pickContinueItem([{ ...sheet, created_at: '2026-11-26T08:00:00Z' }], [work])?.kind, 'material');
});

test('类型和标题搜索同时生效，搜索忽略空白与大小写', () => {
  const items = buildSpaceItems([sheet], [work], [block]);
  assert.equal(filterSpaceItems(items, 'all', '').length, 3);
  assert.deepEqual(filterSpaceItems(items, 'work', ' 向量 ').map(({id}) => id), ['project']);
  assert.equal(filterSpaceItems(items, 'work', 'vector').length, 0);
  assert.deepEqual(filterSpaceItems(items, 'all', ' VECTOR ').map(({id}) => id), ['block']);
});

test('最早到期时间忽略无效日期并处理空列表', () => {
  const first = { expires_at: '2026-11-26T08:00:00Z' };
  assert.equal(findEarliestExpiry([sheet, { expires_at: 'unknown' }, first]), first.expires_at);
  assert.equal(findEarliestExpiry([{ expires_at: '' }]), null);
  assert.equal(findEarliestExpiry([]), null);
});
