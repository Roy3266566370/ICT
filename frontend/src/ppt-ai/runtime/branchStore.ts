/** 分支本地状态：人工修改 → 提交 revision；服务端更新不静默覆盖本地草稿。 */

import type { CanonicalValue, CanonicalValues } from '../types';

export interface BranchSnapshot {
  branchId: string;
  revision: number;
  values: CanonicalValues;
}

export interface BranchLocalState extends BranchSnapshot {
  status: 'clean' | 'dirty' | 'saving' | 'conflict';
  error: string | null;
}

export class BranchStore {
  private state: BranchLocalState;
  private listeners = new Set<() => void>();

  constructor(initial: BranchSnapshot) {
    this.state = { ...initial, values: { ...initial.values }, status: 'clean', error: null };
  }

  getSnapshot = (): BranchLocalState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  setValue(conceptId: string, value: CanonicalValue): void {
    this.state = {
      ...this.state,
      values: { ...this.state.values, [conceptId]: value },
      status: 'dirty',
      error: null,
    };
    this.emit();
  }

  markSaving(): void {
    this.state = { ...this.state, status: 'saving', error: null };
    this.emit();
  }

  markSaved(revision: number): void {
    this.state = { ...this.state, revision, status: 'clean', error: null };
    this.emit();
  }

  markConflict(message: string): void {
    this.state = { ...this.state, status: 'conflict', error: message };
    this.emit();
  }

  /** 服务端 revision 更新：本地有未提交修改时保留草稿并标记冲突。 */
  replaceFromServer(snapshot: BranchSnapshot): boolean {
    if (snapshot.revision < this.state.revision) return false;
    if (snapshot.revision === this.state.revision && this.state.status !== 'dirty') {
      this.state = { ...this.state, values: { ...snapshot.values }, status: 'clean' };
      this.emit();
      return true;
    }
    if (this.state.status === 'dirty' || this.state.status === 'saving') {
      this.state = { ...this.state, revision: snapshot.revision, status: 'conflict', error: '服务端分支已更新，本地修改保留为草稿。' };
      this.emit();
      return false;
    }
    this.state = { branchId: snapshot.branchId, revision: snapshot.revision, values: { ...snapshot.values }, status: 'clean', error: null };
    this.emit();
    return true;
  }

  reset(values: CanonicalValues): void {
    this.state = { ...this.state, values: { ...values }, status: 'clean', error: null };
    this.emit();
  }

  diff(): CanonicalValues {
    return { ...this.state.values };
  }
}
