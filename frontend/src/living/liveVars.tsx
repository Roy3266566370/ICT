/** 页面级活变量（Phase 1）：单向 变量→块 广播 + 插值 + 页级块状态。
 *
 * - ``LiveVarsProvider`` 从 ``doc.variables`` 初始化运行时值，块只读消费；
 * - 插值只支持 ``${name}``、``${expr: …}``、``${cond ? a : b}`` 三种形态，
 *   数值求值走 ``labs/expr`` 的受控表达式，不执行任意脚本；
 * - ``useBlockState`` 把块 UI 状态（折叠/步进/尝试）提升到页级 Map，
 *   折叠再展开不再丢状态；无 Provider 时退回普通 useState（块可独立渲染）。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PageVariables } from './types';
import { interpolate, reconcileLiveVars, type LiveVarValue } from './interpolate';

export { interpolate, reconcileLiveVars };
export type { LiveVarValue };

interface LiveVarsContextValue {
  defs: PageVariables;
  values: Record<string, LiveVarValue>;
  /** 块状态表自身也是 context 值的一部分：写入后消费方才能重渲染。 */
  states: Record<string, Record<string, unknown>>;
  setValue: (name: string, value: LiveVarValue) => void;
  getBlockState: <T>(blockId: string, key: string, initial: T) => T;
  setBlockState: <T>(blockId: string, key: string, value: T) => void;
}

const LiveVarsContext = createContext<LiveVarsContextValue | null>(null);

export function LiveVarsProvider(props: { variables?: PageVariables; children: ReactNode }): ReactNode {
  const defs = useMemo(() => props.variables ?? {}, [props.variables]);
  const prevDefsRef = useRef<PageVariables>(defs);
  const [values, setValues] = useState<Record<string, LiveVarValue>>(() => reconcileLiveVars({}, defs));
  const [states, setStates] = useState<Record<string, Record<string, unknown>>>({});
  const statesRef = useRef(states);
  statesRef.current = states;

  const effectiveValues = useMemo(
    () => reconcileLiveVars(values, defs, prevDefsRef.current),
    [values, defs],
  );

  useEffect(() => {
    const prevDefs = prevDefsRef.current;
    if (prevDefs === defs) return;
    setValues((prev) => reconcileLiveVars(prev, defs, prevDefs));
    prevDefsRef.current = defs;
  }, [defs]);

  const setValue = useCallback((name: string, value: LiveVarValue) => {
    setValues((prev) => {
      const base = reconcileLiveVars(prev, defs, prevDefsRef.current);
      return base[name] === value ? base : { ...base, [name]: value };
    });
  }, [defs]);

  const getBlockState = useCallback(<T,>(blockId: string, key: string, initial: T): T => {
    const entry = statesRef.current[blockId];
    return entry && key in entry ? (entry[key] as T) : initial;
  }, []);

  const setBlockState = useCallback(<T,>(blockId: string, key: string, value: T) => {
    setStates((prev) => ({ ...prev, [blockId]: { ...prev[blockId], [key]: value } }));
  }, []);

  const ctx = useMemo<LiveVarsContextValue>(
    () => ({ defs, values: effectiveValues, states, setValue, getBlockState, setBlockState }),
    [defs, effectiveValues, states, setValue, getBlockState, setBlockState],
  );
  return <LiveVarsContext.Provider value={ctx}>{props.children}</LiveVarsContext.Provider>;
}

/** 无 Provider 时返回空变量集（块可脱离活变量体系独立渲染）。 */
export function useLiveVars(): Pick<LiveVarsContextValue, 'defs' | 'values' | 'states' | 'setValue'> {
  const ctx = useContext(LiveVarsContext);
  return useMemo(
    () => ctx ?? { defs: {}, values: {}, states: {}, setValue: () => undefined },
    [ctx],
  );
}

const localBlockStateStore = new Map<string, Record<string, unknown>>();

/** 页级块状态：折叠/步进/尝试记录在 Provider 生命周期内不丢。 */
export function useBlockState<T>(blockId: string, key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const ctx = useContext(LiveVarsContext);
  const [local, setLocal] = useState<T>(() => {
    const entry = localBlockStateStore.get(blockId);
    return entry && key in entry ? (entry[key] as T) : initial;
  });
  const stateKey = `${blockId}`;
  const value = ctx ? ctx.getBlockState<T>(blockId, key, local) : local;
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(value) : next;
      if (ctx) {
        ctx.setBlockState(blockId, key, resolved);
      } else {
        const entry = localBlockStateStore.get(stateKey) ?? {};
        localBlockStateStore.set(stateKey, { ...entry, [key]: resolved });
        setLocal(resolved);
      }
    },
    [ctx, blockId, key, stateKey, value],
  );
  return [value, set];
}


