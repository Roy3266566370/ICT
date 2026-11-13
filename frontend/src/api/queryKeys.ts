/**
 * queryKeys.ts —— TanStack Query 的键工厂（唯一来源，避免各处手写字符串）
 *
 * 约定：key 的第一段是资源名，第二段起是唯一标识；变体参数（limit 等）放在尾部，
 * 便于 `invalidateQueries({ queryKey: queryKeys.materials() })` 做前缀失效。
 *
 * C-QUERY-KEY@1（账号维度）：私有资源一律走 `scopedQueryKeys(scope)` / `useScopedQueryKeys()`，
 * 键的第一段为 `PRIVATE_KEY_TAG`（`@private`），第二段为账号 scope（`guest` / `user:<id>`）。
 * 公开键 `session`、`templates` 与公开分享（`p/*`、`lab-shares/*`）保持全局无 scope，
 * 账号切换时不被清理。delete 语义见 `state/accountScope.ts#isPrivateQueryKey`。
 */
import { useMemo } from 'react';
import { PRIVATE_KEY_TAG } from '@/state/accountScope';
import type { AccountScope } from '@/state/accountScope';
import { useAccountScope } from '@/state/accountSession';

/** 与 `state/accountScope.ts` 同源；在此重导出，避免调用方跨层 import。 */
export { PRIVATE_KEY_TAG };

export const DEFAULT_MATERIAL_LIMIT = 20;
export const MAX_PAGE_LIMIT = 50;

function clampLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return fallback;
  return Math.min(MAX_PAGE_LIMIT, Math.floor(limit));
}

export const queryKeys = {
  session: () => ['session'] as const,
  templates: () => ['templates'] as const,

  materialsRoot: () => ['materials'] as const,
  materials: (limit?: number) => ['materials', 'list', clampLimit(limit, DEFAULT_MATERIAL_LIMIT)] as const,
  material: (materialId: string) => ['materials', 'detail', materialId] as const,
  /** 区域确认/纠正的持久化结果（P2 追加端点）。 */
  materialRegions: (materialId: string) => ['materials', 'regions', materialId] as const,
  /** iSpec 参数值的持久化结果（§10.1 第 5 步）；按 material + object 隔离。 */
  materialIspecValues: (materialId: string, objectId: string) =>
    ['materials', 'ispec-values', materialId, objectId] as const,

  jobsRoot: () => ['jobs'] as const,
  job: (jobId: string) => ['jobs', jobId] as const,

  objectsRoot: () => ['objects'] as const,
  object: (objectId: string) => ['objects', objectId] as const,

  runsRoot: (objectId?: string) => (objectId === undefined ? (['runs'] as const) : (['runs', objectId] as const)),
  runs: (objectId: string, limit?: number) =>
    ['runs', objectId, 'list', clampLimit(limit, DEFAULT_MATERIAL_LIMIT)] as const,
  run: (runId: string) => ['runs', 'snapshot', runId] as const,

  checksRoot: (objectId?: string) =>
    objectId === undefined ? (['checks'] as const) : (['checks', objectId] as const),
  checks: (objectId: string) => ['checks', objectId, 'list'] as const,
} as const;

export type QueryKey = ReturnType<(typeof queryKeys)[keyof typeof queryKeys]>;

/** 把契约的 `limit` 规则（默认 20、最大 50、超限按 50、不报错）落到一处。 */
export function normalizeLimit(limit: number | undefined): number {
  return clampLimit(limit, DEFAULT_MATERIAL_LIMIT);
}

/* -------------------------------------------------------------------------- */
/* C-QUERY-KEY@1：带账号维度的私有查询键                                       */
/* -------------------------------------------------------------------------- */

/**
 * 私有查询键工厂。键形状是契约的一部分（§2.2 C-QUERY-KEY@1 的「键形状（精确）」表），
 * 不得增删段或调整顺序：`['@private', scope, <resource>, <variant...>]`。
 */
export interface ScopedQueryKeys {
  readonly materialsRoot: () => readonly unknown[];
  readonly materials: (limit?: number) => readonly unknown[];
  readonly material: (materialId: string) => readonly unknown[];
  readonly materialRegions: (materialId: string) => readonly unknown[];
  readonly materialIspecValues: (materialId: string, objectId: string) => readonly unknown[];
  readonly job: (jobId: string) => readonly unknown[];
  readonly object: (objectId: string) => readonly unknown[];
  readonly runsRoot: (objectId?: string) => readonly unknown[];
  readonly runs: (objectId: string, limit?: number) => readonly unknown[];
  readonly run: (runId: string) => readonly unknown[];
  readonly checksRoot: (objectId?: string) => readonly unknown[];
  readonly checks: (objectId: string) => readonly unknown[];
  readonly labs: () => readonly unknown[];
}

export function scopedQueryKeys(scope: AccountScope): ScopedQueryKeys {
  return {
    materialsRoot: () => [PRIVATE_KEY_TAG, scope, 'materials'] as const,
    materials: (limit?: number) =>
      [PRIVATE_KEY_TAG, scope, 'materials', 'list', normalizeLimit(limit)] as const,
    material: (materialId: string) =>
      [PRIVATE_KEY_TAG, scope, 'materials', 'detail', materialId] as const,
    materialRegions: (materialId: string) =>
      [PRIVATE_KEY_TAG, scope, 'materials', 'regions', materialId] as const,
    materialIspecValues: (materialId: string, objectId: string) =>
      [PRIVATE_KEY_TAG, scope, 'materials', 'ispec-values', materialId, objectId] as const,
    job: (jobId: string) => [PRIVATE_KEY_TAG, scope, 'jobs', jobId] as const,
    object: (objectId: string) => [PRIVATE_KEY_TAG, scope, 'objects', objectId] as const,
    runsRoot: (objectId?: string) =>
      objectId === undefined
        ? ([PRIVATE_KEY_TAG, scope, 'runs'] as const)
        : ([PRIVATE_KEY_TAG, scope, 'runs', objectId] as const),
    runs: (objectId: string, limit?: number) =>
      [PRIVATE_KEY_TAG, scope, 'runs', objectId, 'list', normalizeLimit(limit)] as const,
    run: (runId: string) => [PRIVATE_KEY_TAG, scope, 'runs', 'snapshot', runId] as const,
    checksRoot: (objectId?: string) =>
      objectId === undefined
        ? ([PRIVATE_KEY_TAG, scope, 'checks'] as const)
        : ([PRIVATE_KEY_TAG, scope, 'checks', objectId] as const),
    checks: (objectId: string) => [PRIVATE_KEY_TAG, scope, 'checks', objectId, 'list'] as const,
    labs: () => [PRIVATE_KEY_TAG, scope, 'labs', 'list'] as const,
  };
}

/**
 * 既有私有 hook 的统一取键方式。
 *
 * scope 只从 `useAccountSessionStore` 的 `scope` 字段读取（R5-AC6），并用 `useMemo`
 * 稳定引用：同一 scope 下每次渲染拿到同一组函数，避免 queryKey 抖动引发多余请求。
 */
export function useScopedQueryKeys(): ScopedQueryKeys {
  const scope = useAccountScope();
  return useMemo(() => scopedQueryKeys(scope), [scope]);
}