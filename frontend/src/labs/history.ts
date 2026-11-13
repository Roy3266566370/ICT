/** 参数撤销/重做；连续拖动在 450ms 内合并为一次操作。 */

export interface LabHistory<T> {
  past: T[];
  present: T;
  future: T[];
  key: string;
  at: number;
}

export function createHistory<T>(present: T): LabHistory<T> {
  return { past: [], present, future: [], key: '', at: 0 };
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function commitHistory<T>(
  history: LabHistory<T>,
  next: T,
  key = '',
  at = Date.now(),
): LabHistory<T> {
  if (sameValue(history.present, next)) return history;
  const coalesce = Boolean(key) && history.key === key && at - history.at >= 0 && at - history.at < 450 && history.future.length === 0;
  return {
    present: next,
    past: coalesce ? history.past : [...history.past, history.present].slice(-60),
    future: [],
    key,
    at,
  };
}

export function undoHistory<T>(history: LabHistory<T>): LabHistory<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return {
    present: previous,
    past: history.past.slice(0, -1),
    future: [history.present, ...history.future],
    key: '',
    at: 0,
  };
}

export function redoHistory<T>(history: LabHistory<T>): LabHistory<T> {
  const next = history.future[0];
  if (next === undefined) return history;
  return {
    present: next,
    past: [...history.past, history.present],
    future: history.future.slice(1),
    key: '',
    at: 0,
  };
}
