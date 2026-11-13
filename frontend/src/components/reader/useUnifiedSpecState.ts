/**
 * `useUnifiedSpecState.ts` —— 工作台唯一参数值源（P0-02）。
 *
 * 一个 hook 同时服务：
 *  - 图（PageCanvas / 区域组件 / ISpecView）；
 *  - 文字（LinkedTextLayer 与 iSpec text 视图）；
 *  - "当前参数"表（`rows`）；
 *  - 独立校验与保存运行（`objectWithParams`）。
 *
 * 持久化（整改文件 §10.1 第 5 步："保存并重新打开，恢复同一状态"）：
 *  1. **初始化优先级**：服务器值 → `sessionStorage` 草稿 → `initialValues(spec)`。
 *     服务器值来自 `GET /materials/{id}/ispecs/{object_id}/values`，与区域覆盖
 *     （`data/regions/`）同构，因此换浏览器 / 重开标签页也能恢复；
 *     返回值里的 `persistState` 明确告诉界面当前值来自哪一层。
 *  2. **变更**：去抖 600ms 调 `PUT .../values`；失败时保留 `sessionStorage`
 *     并给出"未能保存到服务器，已保存在本机"的提示（绝不静默失败）。
 *     遇到 409 `VERSION_CONFLICT` 时先吸收服务器的最新版本号再重试一次
 *     （本地值优先；只写者胜是刻意的降级，仍失败才提示）。
 *  3. **重置**：先 `PUT values: {}` 清掉服务器上的桶，再回到默认值。
 *
 * 跨 iSpec 共享池（§9-4）的池值也持久化：写在同一个参数文件的保留桶
 * `__shared__` 下，与当前页的 iSpec 桶互不覆盖。
 *
 * 保留原有的 `sessionStorage` 草稿层：它是**同步**的，页面切换/刷新时先渲染
 * 本机值，再异步与服务器对齐，避免首屏等待网络。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, isApiError } from '@/api/client';
import { SHARED_VALUES_OBJECT_ID } from '@/api/types';
import type { ISpecScalar, KnowledgeObject } from '@/api/types';
import { clampToSpec, initialValues, isOffDefault } from '@/ispec/types';
import type { ISpec, SharedGroup } from '@/ispec/types';
import type { LinkedTextRuntime, PageRegion } from '@/regions/types';
import { isRegionChanged } from './regionData';
import {
  applyRegionParamsToObject,
  applySpecValuesToObject,
  buildUnifiedRows,
  mergeAllRegionParams,
  sanitizeRegionOverrides,
  sanitizeSpecValues,
  sameUnifiedValue,
  type RegionOverrides,
  type SpecValue,
  type SpecValues,
  type UnifiedParameterRow,
} from './unifiedSpecState';
import {
  applySharedValuesToSpec,
  checkSharedConsistency,
  collectSharedGroups,
  memberValueKey,
  sanitizeSharedValues,
  setSharedValue,
  sharedConflictGroups,
  sharedValueOf,
  type SharedConsistencyItem,
  type SharedValues,
} from './sharedParamPool';

const REGION_STORE_PREFIX = 'xiangsheng.reader.regionParams.v1';
const SPEC_STORE_PREFIX = 'xiangsheng.reader.specValues.v1';
/** 跨 iSpec 共享池的持久化前缀（§9-4）：`xiangsheng:shared:<material_id>`。 */
const SHARED_STORE_PREFIX = 'xiangsheng:shared';

/** 参数变更 → 服务器保存的去抖窗口。 */
export const SPEC_PERSIST_DEBOUNCE_MS = 600;
/** 保存失败时对用户可见的提示（不静默失败）。 */
export const SPEC_PERSIST_FAILED_NOTICE = '未能保存到服务器，已保存在本机';

/** 当前值来自哪一层：服务器持久化 / 本机会话草稿 / iSpec 默认值。 */
export type SpecPersistState = 'server' | 'local' | 'default';

function readStored(key: string | null): unknown {
  if (key === null || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function writeStored(key: string | null, value: unknown): void {
  if (key === null || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式 / 配额不足：内存状态仍然有效，只是刷新后丢失
  }
}

interface PersistentRecord<T> {
  key: string | null;
  value: T;
}

/**
 * 以 key 为命名空间的 sessionStorage 记录。
 *
 * 关键点：切换材料/对象时**不会**把旧材料的值写进新材料的 key——
 * 持久化 effect 只在 `store.key === key` 时执行。
 */
function usePersistentRecord<T>(
  key: string | null,
  load: (raw: unknown) => T,
): [T, (updater: (previous: T) => T) => void] {
  const [store, setStore] = useState<PersistentRecord<T>>(() => ({
    key,
    value: load(readStored(key)),
  }));

  useEffect(() => {
    setStore((previous) => (previous.key === key ? previous : { key, value: load(readStored(key)) }));
    // load 依赖 spec/materialId；key 变化时必须重新读取，因此只以 key 作为触发条件。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (store.key === key) writeStored(key, store.value);
  }, [store, key]);

  const value = store.key === key ? store.value : load(readStored(key));

  const update = useCallback(
    (updater: (previous: T) => T): void => {
      setStore((previous) => {
        const base = previous.key === key ? previous.value : load(readStored(key));
        return { key, value: updater(base) };
      });
    },
    [key, load],
  );

  return [value, update];
}

function specValuesWithDefaults(spec: ISpec | null): SpecValues {
  if (spec === null) return {};
  return initialValues(spec);
}

/** 把存储里的覆盖值按 iSpec 定义夹紧；不属于该 spec 的键丢弃。 */
function restoreSpecValues(spec: ISpec | null, raw: unknown): SpecValues {
  const base = specValuesWithDefaults(spec);
  if (spec === null) return base;
  const stored = sanitizeSpecValues(raw);
  for (const parameter of spec.parameters) {
    const value = stored[parameter.id];
    if (value !== undefined) base[parameter.id] = clampToSpec(parameter, value);
  }
  return base;
}

/** 只保留标量：服务器端拒绝嵌套对象，前端提前过滤避免整批 422。 */
function toScalarMap(values: Record<string, SpecValue>): Record<string, ISpecScalar> {
  const result: Record<string, ISpecScalar> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'number') {
      if (Number.isFinite(value)) result[key] = value;
    } else if (typeof value === 'boolean' || typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

/** 从 409 的 details 里读服务器当前版本（供"吸收版本号后重试"）。 */
function readConflictUpdatedAt(details: Record<string, unknown> | undefined): string | null {
  if (details === undefined) return null;
  const value = details['current_updated_at'];
  return typeof value === 'string' ? value : null;
}

interface PersistSnapshot {
  materialId: string;
  objectId: string;
  values: SpecValues;
  pool: SharedValues;
  /** 重置：发送空 values 清空服务器桶。 */
  clear: boolean;
  /** 已经处理过一次 409，第二次不再带乐观锁。 */
  skipLock: boolean;
}

export interface UseUnifiedSpecStateOptions {
  materialId: string | null;
  regions: PageRegion[];
  activeRegion: PageRegion | null;
  object: KnowledgeObject | null;
  /** 当前页命中 iSpec 时优先以它为值源；为 null 时使用区域参数。 */
  spec: ISpec | null;
  /** 本材料的全部 iSpec（用于汇总跨页共享组）；缺省只用当前 `spec`。 */
  specs?: ISpec[];
}

export interface UnifiedSpecState {
  /** 所有区域的合并结果（图、表、文字共用）。 */
  paramsByRegion: Record<string, Record<string, unknown>>;
  /** 当前激活区域的合并参数。 */
  activeParams: Record<string, unknown>;
  /** 当前区域是否偏离基线。 */
  activeRegionChanged: boolean;
  /** 已完成区域参数投影的知识对象；保存 / 校验 / 表格读它。 */
  objectWithParams: KnowledgeObject | null;
  /** iSpec 参数值；ISpecView 与 iSpec 表格读它。 */
  specValues: SpecValues;
  /** iSpec 参数是否偏离默认值。 */
  specChanged: boolean;
  /** 跨 iSpec 共享池：`{ [shared_key]: 值 }`（已与本地值合并后的读入口径）。 */
  sharedValues: SharedValues;
  /** 本材料的共享组（同一变量在多页出现时归为一组）。 */
  sharedGroups: SharedGroup[];
  /** 默认值不一致、需要用户确认的共享组。 */
  sharedConflicts: SharedGroup[];
  /** 同一 `shared_key` 在不同 iSpec 取值是否一致（供详情面板展示）。 */
  sharedConsistency: SharedConsistencyItem[];
  /** 表格唯一数据源。 */
  rows: UnifiedParameterRow[];
  runtimeTextsByRegion: Record<string, LinkedTextRuntime[]>;
  /** 任一来源有改动（决定是否必须走"保存模型"而不是直接保存运行）。 */
  hasUnifiedChanges: boolean;
  /** 当前参数值的来源层级（§10.1 第 5 步）。 */
  persistState: SpecPersistState;
  /** 服务器保存失败时的提示；成功或切换材料后清空。 */
  persistNotice: string | null;
  setRegionParams: (regionId: string, patch: Record<string, unknown>) => void;
  resetRegionParams: (regionId: string) => void;
  setSpecValue: (id: string, value: SpecValue) => void;
  resetSpecValues: () => void;
  setLinkedTexts: (regionId: string, texts: LinkedTextRuntime[]) => void;
}

export function useUnifiedSpecState(options: UseUnifiedSpecStateOptions): UnifiedSpecState {
  const { materialId, regions, activeRegion, object, spec, specs } = options;

  const specObjectId = spec?.object_id ?? null;
  const regionStoreKey = materialId === null ? null : `${REGION_STORE_PREFIX}:${materialId}`;
  const specStoreKey =
    materialId === null || specObjectId === null
      ? null
      : `${SPEC_STORE_PREFIX}:${materialId}:${specObjectId}`;

  const sharedStoreKey = materialId === null ? null : `${SHARED_STORE_PREFIX}:${materialId}`;

  const regionLoader = useCallback((raw: unknown) => sanitizeRegionOverrides(raw), []);
  const specLoader = useCallback((raw: unknown) => restoreSpecValues(spec, raw), [spec]);
  const sharedLoader = useCallback((raw: unknown) => sanitizeSharedValues(raw), []);

  const [regionOverrides, updateRegionOverrides] = usePersistentRecord<RegionOverrides>(
    regionStoreKey,
    regionLoader,
  );
  const [specValues, updateSpecValues] = usePersistentRecord<SpecValues>(specStoreKey, specLoader);
  const [sharedValues, updateSharedValues] = usePersistentRecord<SharedValues>(
    sharedStoreKey,
    sharedLoader,
  );

  /* ---------------- 服务器持久化状态 ---------------- */

  const [persistState, setPersistState] = useState<SpecPersistState>('default');
  const [persistNotice, setPersistNotice] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  /** 用户是否产生过改动（含"重置"）；未改动且无本地草稿时不做无意义的 PUT。 */
  const dirtyRef = useRef(false);
  /** 下一次保存应发送空 values（重置语义）。 */
  const clearOnNextSaveRef = useRef(false);
  /** 服务器桶的版本号（乐观锁的 expected_updated_at）。 */
  const serverUpdatedAtRef = useRef<string | null>(null);
  /** 已经完成初始化的 key，避免 spec 重新计算时重复 GET。 */
  const hydratedKeyRef = useRef<string | null>(null);
  /** 串行化保存：同一时刻只允许一个 PUT 在飞，期间的新值排队。 */
  const savingRef = useRef(false);
  const queuedRef = useRef<PersistSnapshot | null>(null);

  /* ---------------- 区域参数 ---------------- */

  const paramsByRegion = useMemo(
    () => mergeAllRegionParams(regions, regionOverrides),
    [regions, regionOverrides],
  );

  const activeRegionId = activeRegion?.region_id ?? null;
  const activeParams = useMemo(
    () => (activeRegionId === null ? {} : (paramsByRegion[activeRegionId] ?? activeRegion?.original_params ?? {})),
    [activeRegionId, activeRegion?.original_params, paramsByRegion],
  );

  const activeRegionChanged = useMemo(
    () => isRegionChanged(activeRegion, activeParams),
    [activeRegion, activeParams],
  );

  /* ---------------- 跨 iSpec 共享池（§9-4） ---------------- */

  /** 本材料的全部 iSpec：显式传入优先，否则至少包含当前页的 spec。 */
  const allSpecs = useMemo<ISpec[]>(() => {
    if (specs !== undefined && specs.length > 0) return specs;
    return spec === null ? [] : [spec];
  }, [specs, spec]);

  const sharedGroups = useMemo(() => collectSharedGroups(allSpecs), [allSpecs]);
  const sharedConflicts = useMemo(() => sharedConflictGroups(sharedGroups), [sharedGroups]);

  /**
   * 本页最终参数值：共享池里的值优先于本页默认值/本地覆盖值，
   * 于是同键参数在任何一页被改动后，其他页读到的是同一个值。
   */
  const effectiveSpecValues = useMemo(
    () => applySharedValuesToSpec(spec, specValues, sharedValues),
    [spec, specValues, sharedValues],
  );

  const objectWithParams = useMemo(
    () =>
      applySpecValuesToObject(
        applyRegionParamsToObject(object, activeRegion, activeParams),
        spec,
        effectiveSpecValues,
      ),
    [object, activeRegion, activeParams, spec, effectiveSpecValues],
  );

  const setRegionParams = useCallback(
    (regionId: string, patch: Record<string, unknown>): void => {
      updateRegionOverrides((previous) => ({
        ...previous,
        [regionId]: { ...(previous[regionId] ?? {}), ...patch },
      }));
    },
    [updateRegionOverrides],
  );

  const resetRegionParams = useCallback(
    (regionId: string): void => {
      updateRegionOverrides((previous) => {
        if (previous[regionId] === undefined) return previous;
        const next = { ...previous };
        delete next[regionId];
        return next;
      });
    },
    [updateRegionOverrides],
  );

  /* ---------------- iSpec 参数 ---------------- */

  const setSpecValue = useCallback(
    (id: string, value: SpecValue): void => {
      const parameter = spec?.parameters.find((item) => item.id === id);
      const clamped = parameter === undefined ? value : clampToSpec(parameter, value);
      dirtyRef.current = true;
      // 重置后用户立刻又改：以新改动为准，别再发空 values 把刚输入的值清掉。
      clearOnNextSaveRef.current = false;
      updateSpecValues((previous) =>
        sameUnifiedValue(previous[id], clamped) ? previous : { ...previous, [id]: clamped },
      );
      // 带 shared_key 的参数改动后写入共享池：所有引用同一键的 iSpec 立即读到新值。
      const sharedKey = parameter?.shared_key;
      if (typeof sharedKey === 'string' && sharedKey.length > 0) {
        updateSharedValues((previous) => setSharedValue(previous, sharedKey, clamped));
      }
    },
    [spec, updateSpecValues, updateSharedValues],
  );

  const resetSpecValues = useCallback((): void => {
    const defaults = specValuesWithDefaults(spec);
    dirtyRef.current = true;
    // 重置要"清空服务器上的桶"，而不是把默认值写进去当作用户覆盖。
    clearOnNextSaveRef.current = true;
    updateSpecValues(() => defaults);
    // 重置本页时一并清掉本页共享参数的池值，否则"回到默认"会被池值覆盖而看起来无效。
    if (spec === null) return;
    const sharedKeys = spec.parameters
      .map((parameter) => parameter.shared_key)
      .filter((key): key is string => typeof key === 'string' && key.length > 0);
    if (sharedKeys.length === 0) return;
    updateSharedValues((previous) => {
      let next = previous;
      for (const key of sharedKeys) {
        if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
        if (next === previous) next = { ...previous };
        delete next[key];
      }
      return next;
    });
  }, [spec, updateSpecValues, updateSharedValues]);

  const specChanged = useMemo(
    () => (spec === null ? false : isOffDefault(spec, effectiveSpecValues)),
    [spec, effectiveSpecValues],
  );

  /* ---------------- 与服务器对齐 ---------------- */

  /**
   * 初始化：服务器值优先，其次 sessionStorage 草稿，最后是 iSpec 默认值。
   *
   * 两个 GET 并发（当前 iSpec + 共享池）；任一成功且非空即视为 `server`。
   * GET 失败不打断阅读：保留本地草稿，`persistState` 标为 `local`/`default`，
   * 用户下一次改动仍会尝试保存。
   */
  useEffect(() => {
    if (materialId === null || specObjectId === null || specStoreKey === null) {
      setHydrated(false);
      setPersistState('default');
      setPersistNotice(null);
      return undefined;
    }
    if (spec === null) return undefined;

    const hydrationKey = `${specStoreKey}::${sharedStoreKey ?? ''}`;
    if (hydratedKeyRef.current === hydrationKey) return undefined;
    hydratedKeyRef.current = hydrationKey;

    const hasLocal =
      readStored(specStoreKey) !== null || readStored(sharedStoreKey) !== null;
    serverUpdatedAtRef.current = null;
    dirtyRef.current = false;
    clearOnNextSaveRef.current = false;
    setHydrated(false);
    setPersistNotice(null);
    setPersistState(hasLocal ? 'local' : 'default');

    let cancelled = false;
    const currentSpec = spec;
    const currentMaterial = materialId;

    void Promise.allSettled([
      api.getISpecValues(currentMaterial, specObjectId),
      api.getISpecValues(currentMaterial, SHARED_VALUES_OBJECT_ID),
    ]).then(([specResult, sharedResult]) => {
      if (cancelled) return;
      let fromServer = false;

      if (specResult.status === 'fulfilled') {
        serverUpdatedAtRef.current = specResult.value.updated_at;
        if (Object.keys(specResult.value.values).length > 0) {
          const restored = restoreSpecValues(currentSpec, specResult.value.values);
          updateSpecValues(() => restored);
          fromServer = true;
        }
      }

      if (
        sharedResult.status === 'fulfilled' &&
        Object.keys(sharedResult.value.values).length > 0
      ) {
        const pool = sanitizeSharedValues(sharedResult.value.values);
        if (Object.keys(pool).length > 0) {
          updateSharedValues(() => pool);
          fromServer = true;
        }
      }

      setPersistState(fromServer ? 'server' : hasLocal ? 'local' : 'default');
      // 本地草稿（上次没写进服务器）在初始化完成后主动上送一次。
      if (!fromServer && hasLocal) dirtyRef.current = true;
      setHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, [
    materialId,
    specObjectId,
    specStoreKey,
    sharedStoreKey,
    spec,
    updateSpecValues,
    updateSharedValues,
  ]);

  /**
   * 实际写服务器：spec 桶与共享池桶各一次 PUT，串行化避免互相覆盖。
   *
   * 冲突处理：第一次带 `expected_updated_at`；409 时吸收服务器的最新版本
   * （`details.current_updated_at`）后**重试一次且不带锁**——本地值优先，
   * 这是刻意的降级（同一用户的材料，多标签冲突极少；宁可最后写者胜，
   * 也不要把用户刚输入的值丢掉）。仍失败才提示。
   */
  const persistSnapshot = useCallback(async (snapshot: PersistSnapshot): Promise<void> => {
    if (savingRef.current) {
      queuedRef.current = snapshot;
      return;
    }
    savingRef.current = true;
    try {
      let pending = snapshot;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const useLock = !pending.skipLock;
        const specValuesToSend = pending.clear ? {} : toScalarMap(pending.values);
        const poolToSend = toScalarMap(pending.pool);
        const [specResult, sharedResult] = await Promise.allSettled([
          api.putISpecValues(
            pending.materialId,
            pending.objectId,
            specValuesToSend,
            useLock ? serverUpdatedAtRef.current : null,
          ),
          api.putISpecValues(
            pending.materialId,
            SHARED_VALUES_OBJECT_ID,
            poolToSend,
            null,
          ),
        ]);

        if (specResult.status === 'fulfilled') {
          serverUpdatedAtRef.current = specResult.value.updated_at;
        } else if (
          attempt === 0 &&
          isApiError(specResult.reason, 'VERSION_CONFLICT')
        ) {
          const latest = readConflictUpdatedAt(specResult.reason.details);
          serverUpdatedAtRef.current = latest;
          pending = { ...pending, skipLock: true };
          continue;
        } else {
          setPersistState('local');
          setPersistNotice(SPEC_PERSIST_FAILED_NOTICE);
          return;
        }

        if (sharedResult.status === 'rejected') {
          setPersistState('local');
          setPersistNotice(SPEC_PERSIST_FAILED_NOTICE);
          return;
        }

        clearOnNextSaveRef.current = false;
        // 保存期间没有新的改动才允许清 dirty，否则下一轮去抖继续上送。
        if (
          specValuesRef.current === pending.values &&
          sharedValuesRef.current === pending.pool
        ) {
          dirtyRef.current = false;
        }
        setPersistState('server');
        setPersistNotice(null);
        return;
      }
      // 两次都被并发写打断：保留本机值并提示，不静默丢弃。
      setPersistState('local');
      setPersistNotice(SPEC_PERSIST_FAILED_NOTICE);
    } finally {
      savingRef.current = false;
      const queued = queuedRef.current;
      queuedRef.current = null;
      if (queued !== null) void persistSnapshot(queued);
    }
  }, []);

  /** 保存函数放 ref：避免每次渲染重建导致去抖定时器被反复重置。 */
  const persistRef = useRef(persistSnapshot);
  useEffect(() => {
    persistRef.current = persistSnapshot;
  }, [persistSnapshot]);

  /** 最新值的引用：保存成功后据此判断"期间是否又改过"，避免多打一次 PUT。 */
  const specValuesRef = useRef(specValues);
  const sharedValuesRef = useRef(sharedValues);
  useEffect(() => {
    specValuesRef.current = specValues;
  }, [specValues]);
  useEffect(() => {
    sharedValuesRef.current = sharedValues;
  }, [sharedValues]);

  /** 去抖保存：参数变化 600ms 后写服务器；重置时发空 values。 */
  useEffect(() => {
    if (!hydrated || materialId === null || specObjectId === null) return undefined;
    const shouldPersist =
      dirtyRef.current || clearOnNextSaveRef.current || persistState === 'local';
    if (!shouldPersist) return undefined;

    const snapshot: PersistSnapshot = {
      materialId,
      objectId: specObjectId,
      values: specValues,
      pool: sharedValues,
      clear: clearOnNextSaveRef.current,
      skipLock: false,
    };
    const timer = window.setTimeout(() => {
      void persistRef.current(snapshot);
    }, SPEC_PERSIST_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [hydrated, materialId, specObjectId, specValues, sharedValues, persistState]);

  /* ---------------- 文字与表格 ---------------- */

  const [runtimeTextsByRegion, setRuntimeTextsByRegion] = useState<
    Record<string, LinkedTextRuntime[]>
  >({});

  const setLinkedTexts = useCallback(
    (regionId: string, texts: LinkedTextRuntime[]): void => {
      setRuntimeTextsByRegion((previous) => {
        const current = previous[regionId];
        if (current !== undefined && sameUnifiedValue(current, texts)) return previous;
        return { ...previous, [regionId]: texts };
      });
    },
    [],
  );

  /**
   * 一致性校验：收集每个共享成员在**各自页上的实际取值**再比较。
   *
   * - 当前页用它正在显示的合并值（`effectiveSpecValues`）；
   * - 其他页优先读共享池；池里还没有值时读该 iSpec 自己的会话存储（从未编辑过则为默认值）。
   * 因此"两页各自改过、池子还没值"这种真不一致会被报出来（`ok:false`）。
   */
  const sharedConsistency = useMemo<SharedConsistencyItem[]>(() => {
    if (sharedGroups.length === 0) return [];
    const values: SpecValues = {};
    for (const group of sharedGroups) {
      for (const member of group.members) {
        const key = memberValueKey(member.object_id, member.parameter_id);
        if (spec !== null && member.object_id === spec.object_id) {
          const current = effectiveSpecValues[member.parameter_id];
          if (current !== undefined) values[key] = current;
          continue;
        }
        const pooled = sharedValueOf(sharedValues, group.shared_key);
        if (pooled !== undefined) {
          values[key] = pooled;
          continue;
        }
        const memberSpec = allSpecs.find((item) => item.object_id === member.object_id);
        const parameter = memberSpec?.parameters.find((item) => item.id === member.parameter_id);
        const stored = sanitizeSpecValues(
          readStored(
            materialId === null
              ? null
              : `${SPEC_STORE_PREFIX}:${materialId}:${member.object_id}`,
          ),
        );
        const raw = stored[member.parameter_id] ?? parameter?.default;
        if (raw !== undefined) values[key] = raw;
      }
    }
    return checkSharedConsistency(sharedGroups, values);
  }, [sharedGroups, sharedValues, effectiveSpecValues, spec, allSpecs, materialId]);

  const rows = useMemo(
    () =>
      buildUnifiedRows({
        spec,
        specValues: effectiveSpecValues,
        object: objectWithParams,
        activeRegion,
        activeParams,
      }),
    [spec, effectiveSpecValues, objectWithParams, activeRegion, activeParams],
  );

  return {
    paramsByRegion,
    activeParams,
    activeRegionChanged,
    objectWithParams,
    specValues: effectiveSpecValues,
    specChanged,
    sharedValues,
    sharedGroups,
    sharedConflicts,
    sharedConsistency,
    rows,
    runtimeTextsByRegion,
    hasUnifiedChanges: activeRegionChanged || specChanged,
    persistState,
    persistNotice,
    setRegionParams,
    resetRegionParams,
    setSpecValue,
    resetSpecValues,
    setLinkedTexts,
  };
}