/**
 * 学习状态协调器：基准、草稿、保存与请求接收判定集中在同一处。
 *
 * 硬约束：
 * - 保存必须使用服务器返回的新 revision；不能用旧闭包或单纯延时。
 * - 每次提问/求解携带同一份草稿快照与 draft revision。
 * - 只有仍对应当前请求、当前条件、当前页/节点的慢响应才能被接收。
 */

import type { BranchState } from '@/ppt-ai/types';
import type { LearningContext } from './types';

export type LearningValue = number | boolean | string;
export type LearningValues = Record<string, LearningValue>;

export interface LearningControllerInit {
  documentRevision: number;
  sourceHash: string;
  bundleId: string;
  bundleRevision: number;
  pageNo: number;
  nodeId: string;
  regionId: string;
  branchId: string;
  branchRevision: number;
  baselineValues: LearningValues;
  values?: LearningValues;
  draftRevision?: number;
  /** 只允许该节点参数与教学探针进入 input_values；同一 bundle 其他节点的值不得混入。 */
  allowedValueKeys?: string[];
}

export interface LearningRequestTicket {
  clientRequestId: string;
  draftRevision: number;
  nodeId: string;
  pageNo: number;
}

export interface LearningResponseIdentity {
  client_request_id?: string;
  draft_revision?: number;
  input_hash?: string;
  page_no?: number;
  node_id?: string;
}

export type LearningControllerStatus = 'clean' | 'dirty' | 'saving' | 'conflict' | 'stale';

export interface LearningControllerState extends LearningControllerInit {
  values: LearningValues;
  draftRevision: number;
  baselineValues: LearningValues;
  status: LearningControllerStatus;
  error: string | null;
  serverInputHash: string | null;
  activeRequestId: string | null;
  savingDraftRevision: number | null;
}

function sameValues(left: LearningValues, right: LearningValues): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

function filterValues(values: Record<string, unknown>, allowed?: string[]): LearningValues {
  const allowedSet = allowed ? new Set(allowed) : null;
  const result: LearningValues = {};
  for (const [key, value] of Object.entries(values)) {
    if (allowedSet && !allowedSet.has(key)) continue;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

export class LearningController {
  private state: LearningControllerState;
  private listeners = new Set<() => void>();

  constructor(init: LearningControllerInit) {
    const values = filterValues({ ...(init.values ?? init.baselineValues) }, init.allowedValueKeys);
    this.state = {
      ...init,
      baselineValues: filterValues({ ...init.baselineValues }, init.allowedValueKeys),
      values,
      draftRevision: init.draftRevision ?? 0,
      status: sameValues(values, init.baselineValues) ? 'clean' : 'dirty',
      error: null,
      serverInputHash: null,
      activeRequestId: null,
      savingDraftRevision: null,
    };
  }

  getSnapshot = (): LearningControllerState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(next: Partial<LearningControllerState>): void {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
  }

  private touch(patch: LearningValues): void {
    this.emit({
      values: { ...this.state.values, ...patch },
      draftRevision: this.state.draftRevision + 1,
      serverInputHash: null,
      status: 'dirty',
      error: null,
    });
  }

  setValue(conceptId: string, value: LearningValue): void {
    this.touch({ [conceptId]: value });
  }

  setValues(patch: LearningValues): void {
    this.touch(patch);
  }

  resetToBaseline(): void {
    this.touch({ ...this.state.baselineValues });
  }

  beginRequest(clientRequestId: string): LearningContext {
    this.emit({ activeRequestId: clientRequestId });
    return this.buildContext(clientRequestId);
  }

  buildContext(clientRequestId: string): LearningContext {
    return {
      contract_version: 'ppt-learning.1',
      document_revision: this.state.documentRevision,
      source_hash: this.state.sourceHash,
      bundle_id: this.state.bundleId,
      bundle_revision: this.state.bundleRevision,
      page_no: this.state.pageNo,
      node_id: this.state.nodeId,
      region_id: this.state.regionId,
      branch_id: this.state.branchId,
      branch_revision: this.state.branchRevision,
      draft_revision: this.state.draftRevision,
      client_request_id: clientRequestId,
      input_values: filterValues(this.state.values, this.state.allowedValueKeys),
      input_hash: this.state.serverInputHash,
    };
  }

  /** 慢响应只有在请求、条件、页与节点都仍匹配时才允许更新界面。 */
  acceptTaskResult(identity: LearningResponseIdentity, ticket: LearningRequestTicket): boolean {
    if (ticket.clientRequestId !== this.state.activeRequestId) return false;
    if (ticket.draftRevision !== this.state.draftRevision) return false;
    if (identity.client_request_id !== undefined && identity.client_request_id !== ticket.clientRequestId) {
      return false;
    }
    if (identity.draft_revision !== undefined && identity.draft_revision !== this.state.draftRevision) {
      return false;
    }
    if (identity.page_no !== undefined && identity.page_no !== this.state.pageNo) return false;
    if (identity.node_id !== undefined && identity.node_id !== this.state.nodeId) return false;
    if (identity.input_hash) this.emit({ serverInputHash: identity.input_hash });
    return true;
  }

  markSaving(): void {
    this.emit({ status: 'saving', error: null, savingDraftRevision: this.state.draftRevision });
  }

  /**
   * 以服务器返回值更新版本；保存期间又有本地修改时保留草稿，不用旧返回值覆盖。
   */
  acceptSavedBranch(branch: Pick<BranchState, 'branch_id' | 'revision' | 'canonical_values'> & { kind?: string }): void {
    const sameBranch = branch.branch_id === this.state.branchId;
    if (sameBranch && branch.revision < this.state.branchRevision) return;
    const savedRevision = this.state.savingDraftRevision;
    const unchanged = savedRevision !== null && savedRevision === this.state.draftRevision;
    const isCourseBaseline = branch.kind === 'baseline' || (!branch.kind && sameBranch);
    const serverValues = filterValues({ ...branch.canonical_values }, this.state.allowedValueKeys);
    this.emit({
      branchId: branch.branch_id,
      branchRevision: branch.revision,
      ...(isCourseBaseline ? { baselineValues: serverValues } : {}),
      ...(unchanged
        ? {
            values: serverValues,
            status: 'clean' as const,
            error: null,
            savingDraftRevision: null,
            serverInputHash: null,
          }
        : {
            status: 'dirty' as const,
            error: null,
            savingDraftRevision: null,
          }),
    });
  }

  markConflict(message: string): void {
    this.emit({ status: 'conflict', error: message, savingDraftRevision: null });
  }

  markStale(message: string): void {
    this.emit({ status: 'stale', error: message });
  }

  loadBranch(
    branch: Pick<BranchState, 'branch_id' | 'revision' | 'canonical_values'> & { kind?: string },
    options: { keepCourseBaseline?: boolean } = {},
  ): void {
    const isCourseBaseline = branch.kind === 'baseline' || branch.kind === undefined;
    const values = filterValues({ ...branch.canonical_values }, this.state.allowedValueKeys);
    this.emit({
      branchId: branch.branch_id,
      branchRevision: branch.revision,
      ...(options.keepCourseBaseline && !isCourseBaseline
        ? {}
        : { baselineValues: values }),
      values,
      draftRevision: this.state.draftRevision + 1,
      status: 'clean',
      error: null,
      serverInputHash: null,
      activeRequestId: null,
    });
  }

  getState(): LearningControllerState {
    return this.state;
  }
}

export function createLearningController(init: LearningControllerInit): LearningController {
  return new LearningController(init);
}
