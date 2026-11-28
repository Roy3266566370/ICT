import type { MaterialSummary } from '../../api/types';
import type { WorkSummary } from '../../api/works';
import type { CustomBlockRecord } from '../../canvas/customBlocks.ts';

type Asset<T extends string, Record> = { kind: T; id: string; title: string; time: number; record: Record };
export type MaterialSpaceItem = Asset<'material', MaterialSummary>;
export type WorkSpaceItem = Asset<'work', WorkSummary>;
export type BlockSpaceItem = Asset<'block', CustomBlockRecord>;
export type SpaceItem = MaterialSpaceItem | WorkSpaceItem | BlockSpaceItem;
export type SpaceFilter = 'all' | SpaceItem['kind'];

export const SPACE_KIND_LABEL = { material: '课件', work: '作品', block: '积木' } as const;

function dateOrder(a: SpaceItem, b: SpaceItem): number {
  return (Number.isFinite(b.time) ? b.time : -Infinity) - (Number.isFinite(a.time) ? a.time : -Infinity) || 0;
}

export function materialItem(record: MaterialSummary): MaterialSpaceItem {
  return { kind: 'material', id: record.material_id, title: record.title.trim() || '未命名课件',
    time: Date.parse(record.created_at), record };
}

function workItem(record: WorkSummary): WorkSpaceItem {
  return { kind: 'work', id: record.work_id, title: record.title.trim() || '未命名作品',
    time: Date.parse(record.updated_at), record };
}

export function buildSpaceItems(materials: readonly MaterialSummary[], works: readonly WorkSummary[], blocks: readonly CustomBlockRecord[]): SpaceItem[] {
  const items: SpaceItem[] = [
    ...materials.map(materialItem), ...works.map(workItem),
    ...blocks.map((record): BlockSpaceItem => ({ kind: 'block', id: record.id,
      title: record.title.trim() || '未命名积木', time: record.createdAt, record })),
  ];
  return items.sort(dateOrder);
}

export function pickContinueItem(materials: readonly MaterialSummary[], works: readonly WorkSummary[]): MaterialSpaceItem | WorkSpaceItem | null {
  return [...materials.map(materialItem), ...works.map(workItem)].sort(dateOrder)[0] ?? null;
}

export function filterSpaceItems(items: readonly SpaceItem[], filter: SpaceFilter, query: string): SpaceItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter(item => (filter === 'all' || item.kind === filter) && item.title.toLowerCase().includes(needle));
}

export function materialCoverUrl(materialId: string): string {
  return `/api/v1/materials/${encodeURIComponent(materialId)}/renders/s01.png`;
}

export function findEarliestExpiry(materials: readonly Pick<MaterialSummary, 'expires_at'>[]): string | null {
  let expiry = null;
  let earliest = Infinity;
  for (const { expires_at } of materials) {
    const time = Date.parse(expires_at);
    if (Number.isFinite(time) && time < earliest) {
      expiry = expires_at;
      earliest = time;
    }
  }
  return expiry;
}

export function spaceItemHref(item: SpaceItem): string {
  const id = encodeURIComponent(item.id);
  if (item.kind === 'material') return `/materials/${id}/work`;
  return item.kind === 'work' ? `/canvas?work=${id}` : `/canvas?customBlock=${id}`;
}

export function relativeAssetTime(then: number, now: number): string {
  if (!Number.isFinite(then)) return '';
  const minutes = Math.floor(Math.max(0, now - then) / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  if (minutes < 1440 * 30) return `${Math.floor(minutes / 1440)} 天前`;
  return new Date(then).toLocaleDateString('zh-CN');
}
