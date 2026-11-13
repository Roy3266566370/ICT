/**
 * 个人临时练习的本地持久化。
 *
 * 作用域至少包含访问者、材料/分享身份、来源哈希、页与节点；换账号或来源变化后
 * 不自动套用旧草稿。存储不可用时退回内存，并如实告诉调用方“本次不能自动恢复”。
 */

import type { LearningValue, LearningValues } from './controller';

const PREFIX = 'xs.ppt-learning.';

export interface LearningDraftScope {
  /** 账号 id 或访客 session id；不同身份不共享草稿。 */
  viewerKey: string;
  /** 私有材料 id 或分享 id。 */
  materialKey: string;
  sourceHash: string;
  nodeId: string;
  pageNo: number;
}

export interface StoredLearningDraft {
  values: LearningValues;
  draftRevision: number;
  updatedAt: string;
  sourceHash: string;
  nodeId: string;
  pageNo: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

const memory = new Map<string, string>();

function resolveStorage(): StorageLike | null {
  try {
    const candidate = typeof window !== 'undefined' ? window.localStorage : undefined;
    if (!candidate) return null;
    const probe = `${PREFIX}__probe__`;
    candidate.setItem(probe, '1');
    candidate.removeItem(probe);
    return candidate;
  } catch {
    return null;
  }
}

function isValue(value: unknown): value is LearningValue {
  if (typeof value === 'boolean' || typeof value === 'string') return true;
  return typeof value === 'number' && Number.isFinite(value);
}

export function draftKey(scope: LearningDraftScope): string {
  return [
    `${PREFIX}${encodeURIComponent(scope.viewerKey)}`,
    encodeURIComponent(scope.materialKey),
    scope.sourceHash.slice(0, 16),
    scope.pageNo,
    encodeURIComponent(scope.nodeId),
  ].join('.');
}

export class LearningDraftPersistence {
  private readonly scope: LearningDraftScope;
  private readonly storage: StorageLike | null;

  constructor(scope: LearningDraftScope, storage?: StorageLike | null) {
    this.scope = scope;
    this.storage = storage === undefined ? resolveStorage() : storage;
  }

  get persistent(): boolean {
    return this.storage !== null;
  }

  save(values: LearningValues, draftRevision: number): void {
    const cleaned: LearningValues = {};
    Object.entries(values).forEach(([key, value]) => {
      if (isValue(value)) cleaned[key] = value;
    });
    const payload: StoredLearningDraft = {
      values: cleaned,
      draftRevision: Math.max(0, Math.floor(draftRevision)),
      updatedAt: new Date().toISOString(),
      sourceHash: this.scope.sourceHash,
      nodeId: this.scope.nodeId,
      pageNo: this.scope.pageNo,
    };
    const encoded = JSON.stringify(payload);
    const key = draftKey(this.scope);
    if (this.storage) {
      try {
        this.storage.setItem(key, encoded);
        return;
      } catch {
        memory.set(key, encoded);
        return;
      }
    }
    memory.set(key, encoded);
  }

  load(): StoredLearningDraft | null {
    const key = draftKey(this.scope);
    let encoded: string | null = null;
    if (this.storage) {
      try {
        encoded = this.storage.getItem(key);
      } catch {
        encoded = null;
      }
    }
    encoded = encoded ?? memory.get(key) ?? null;
    if (!encoded) return null;
    try {
      const parsed = JSON.parse(encoded) as Partial<StoredLearningDraft>;
      if (
        parsed.sourceHash !== this.scope.sourceHash ||
        parsed.nodeId !== this.scope.nodeId ||
        parsed.pageNo !== this.scope.pageNo ||
        typeof parsed.draftRevision !== 'number' ||
        typeof parsed.values !== 'object' ||
        parsed.values === null
      ) {
        return null;
      }
      const values: LearningValues = {};
      Object.entries(parsed.values).forEach(([name, value]) => {
        if (isValue(value)) values[name] = value;
      });
      return {
        values,
        draftRevision: Math.max(0, Math.floor(parsed.draftRevision)),
        updatedAt: String(parsed.updatedAt ?? ''),
        sourceHash: this.scope.sourceHash,
        nodeId: this.scope.nodeId,
        pageNo: this.scope.pageNo,
      };
    } catch {
      return null;
    }
  }

  clear(): void {
    const key = draftKey(this.scope);
    if (this.storage) {
      try {
        this.storage.removeItem(key);
      } catch {
        // 继续清理内存副本
      }
    }
    memory.delete(key);
  }
}

/** 退出/切换身份时清理当前身份前缀下的私有草稿。 */
export function clearLearningDrafts(
  viewerKey?: string,
  storageOverride?: StorageLike | null,
): number {
  const prefix = viewerKey ? `${PREFIX}${encodeURIComponent(viewerKey)}.` : PREFIX;
  let removed = 0;
  memory.forEach((_value, key) => {
    if (key.startsWith(prefix)) {
      memory.delete(key);
      removed += 1;
    }
  });
  const storage = storageOverride === undefined ? resolveStorage() : storageOverride;
  if (!storage) return removed;
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => {
      storage.removeItem(key);
      removed += 1;
    });
  } catch {
    return removed;
  }
  return removed;
}
