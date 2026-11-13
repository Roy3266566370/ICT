/**
 * draftScope.ts —— 本地草稿的账号隔离与版本指纹（契约 `C-DRAFT-SCOPE@1`）
 *
 * 为什么**零 import**：与 `state/accountScope.ts` 同因——必须能被 `node --test`
 * 直接加载，且草稿层（T6）与账号层（T2）之间不引入新的依赖方向。
 *
 * 键格式（精确）：`` `xiangsheng.<kind>.v1.<scope>.<part1>.<part2>...` ``
 *  - `<kind>` 取 `DRAFT_KINDS` 之一；
 *  - `<scope>` 是 `guest` 或 `user:<user_id>`（冒号在字符串键中安全）；
 *  - `<part*>` 由调用方按语义拼接（如 `[materialId]`、`[labId, problemId]`）。
 *
 * 旧格式（无 scope 段，例如 `xiangsheng.free-document.v1.<id>.<writer>`）一律
 * 解析为 `null`，既不会被任何账号恢复，也不会被按 scope 清理误删（R5-AC3）。
 */

/** 草稿范围：与 `AccountScope` 同构（刻意不互相 import，保持零依赖）。 */
export type DraftScope = 'guest' | `user:${string}`;

export interface DraftFingerprint {
  /** `SceneDocument.source_key`；非自由编辑场景传 `''`。 */
  readonly sourceKey: string;
  /** 作品/文档版本号（整数）。 */
  readonly revision: number;
}

export const DRAFT_STORAGE_PREFIX = 'xiangsheng';

export const DRAFT_KINDS = ['free-document', 'lab', 'deck', 'region', 'ispec'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

/** 草稿键的格式版本号；与草稿内容结构一起演进。 */
const DRAFT_VERSION = 'v1';
/** scope 段的合法形状：`guest` 或 `user:` + 1–64 位安全字符。 */
const DRAFT_SCOPE_PATTERN = /^(?:guest|user:[A-Za-z0-9_-]{1,64})$/;
const DRAFT_SEPARATOR = '.';

/** 形如 `xiangsheng.<kind>.v1.<scope>.<part1>.<part2>`（契约 C-DRAFT-SCOPE@1）。 */
export function draftStorageKey(
  kind: DraftKind,
  scope: DraftScope,
  parts: readonly string[],
): string {
  return [DRAFT_STORAGE_PREFIX, kind, DRAFT_VERSION, scope, ...parts].join(DRAFT_SEPARATOR);
}

function isDraftKind(value: unknown): value is DraftKind {
  return typeof value === 'string' && (DRAFT_KINDS as readonly string[]).includes(value);
}

function isDraftScope(value: unknown): value is DraftScope {
  return typeof value === 'string' && DRAFT_SCOPE_PATTERN.test(value);
}

interface DraftKeyParts {
  readonly kind: DraftKind;
  readonly scope: DraftScope;
  readonly parts: readonly string[];
}

/** 解析草稿键；形状不符（含所有旧格式键）返回 `null`。 */
function parseDraftKey(key: string): DraftKeyParts | null {
  const segments = key.split(DRAFT_SEPARATOR);
  const root = segments[0];
  const kind = segments[1];
  const version = segments[2];
  const scope = segments[3];
  if (root !== DRAFT_STORAGE_PREFIX) return null;
  if (!isDraftKind(kind)) return null;
  if (version !== DRAFT_VERSION) return null;
  if (!isDraftScope(scope)) return null;
  return { kind, scope, parts: segments.slice(4) };
}

/** 是否为「新格式」草稿键（旧格式键返回 `false`）。 */
export function isDraftKey(key: string): boolean {
  return parseDraftKey(key) !== null;
}

/**
 * 从草稿键解析所属 scope。
 *
 * 旧格式键（无 scope 段）与非法键都返回 `null`；调用方据此判断"不得按账号清理
 * 或恢复这条记录"，而不是把它当成 visitor 草稿（R5-AC3）。
 */
export function draftScopeOfKey(key: string): DraftScope | null {
  const parsed = parseDraftKey(key);
  return parsed === null ? null : parsed.scope;
}

export function isDraftKeyForScope(key: string, scope: DraftScope): boolean {
  return draftScopeOfKey(key) === scope;
}

/**
 * 清理时只用到这三个成员；DOM 的 `Storage` 结构上满足本接口，无需适配层。
 */
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
}

/** 浏览器默认存储；隐私模式下访问 `localStorage` 本身就可能抛错，故逐个 try。 */
function defaultStorages(): readonly StorageLike[] {
  const storages: StorageLike[] = [];
  try {
    if (typeof localStorage !== 'undefined') storages.push(localStorage);
  } catch {
    /* 忽略：隐私模式 / 存储被禁用 */
  }
  try {
    if (typeof sessionStorage !== 'undefined') storages.push(sessionStorage);
  } catch {
    /* 忽略：同上 */
  }
  return storages;
}

/**
 * 删除指定 scope 的全部草稿键，返回删除条数。
 *
 * 安全边界（R5-AC5 / D-03）：
 *  - 只删 `draftScopeOfKey(key) === scope` 的键，其它账号与访客的草稿原样保留；
 *  - 旧格式键（无 scope）不匹配任何 scope，因此永远不会被删除；
 *  - 存储不可用（隐私模式 / 配额）时返回 0，**绝不抛错**打断调用方主流程；
 *  - IndexedDB 草稿不做跨库枚举删除，靠"键含 scope + 读取校验"隔离。
 */
export function clearDraftsForScope(
  scope: DraftScope,
  storages?: readonly StorageLike[],
): number {
  const targets = storages ?? defaultStorages();
  let removed = 0;
  for (const storage of targets) {
    if (storage === null || storage === undefined) continue;
    // 先快照键名再删除：边删边按索引遍历会跳过相邻键。
    const keys: string[] = [];
    try {
      const count = storage.length;
      for (let index = 0; index < count; index += 1) {
        const key = storage.key(index);
        if (typeof key === 'string') keys.push(key);
      }
    } catch {
      continue;
    }
    for (const key of keys) {
      if (!isDraftKeyForScope(key, scope)) continue;
      try {
        storage.removeItem(key);
        removed += 1;
      } catch {
        /* 单条删除失败（配额 / 权限）不影响其余键 */
      }
    }
  }
  return removed;
}

/**
 * 指纹核对：`sourceKey` 与 `revision` 都必须严格相等。
 *
 * `revision` 用 `===` 是有意的——JSON 里误存成字符串（`"3"`）时判定为不匹配，
 * 宁可丢弃草稿回落到服务端值，也不要拿版本不明的本地数据覆盖权威值（R5-AC4）。
 */
export function matchesFingerprint(
  stored: DraftFingerprint | null | undefined,
  expected: DraftFingerprint,
): boolean {
  if (stored === null || stored === undefined) return false;
  return stored.sourceKey === expected.sourceKey && stored.revision === expected.revision;
}