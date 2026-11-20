import { useCallback, useRef, useState } from 'react';

/**
 * 「我来 ✋」手动接管状态：本地 useState + 可选的持久化回写。
 * saved 是 LabState.manual 中属于本画布的切片：
 * - 本地每次变更回写 onSave 让上层并入 LabState.manual；
 * - saved 引用被外部换掉（文档重置、AI 重解、切分问）时重取本地副本；
 *   上层按 key 局部更新，无关渲染不会换引用，所以不会覆盖正在编辑的内容。
 */
export function useManualState<T>(
  saved: T | undefined,
  onSave: ((value: T) => void) | undefined,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => saved ?? initial);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const lastSavedRef = useRef(saved);
  if (saved !== lastSavedRef.current) {
    lastSavedRef.current = saved;
    setValue(saved ?? initial);
  }
  const set = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      onSaveRef.current?.(resolved);
      return resolved;
    });
  }, []);
  return [value, set];
}
