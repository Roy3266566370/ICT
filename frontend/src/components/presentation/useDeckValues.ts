import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage, isApiError } from '@/api/client';
import { initialValues, type ISpec } from '@/ispec/types';
import type { SpecCell } from '@/ispec/format';
import {
  createHistory,
  commitHistory,
  undoHistory,
  redoHistory,
  changeDeckParameters,
  sameDeckValues,
  sameObjectValues,
  type DeckParameterPatch,
} from './deckHistory';
import { useAccountScope } from '@/state/accountSession';

export type DeckValues = Record<string, Record<string, SpecCell>>;

/** 限制并发：弱网下避免一次性 20 个参数请求占满连接、挤占页图。 */
async function settleWithLimit<T>(
  items: readonly T[],
  limit: number,
  handler: (item: T) => Promise<void>,
): Promise<PromiseSettledResult<void>[]> {
  const results: PromiseSettledResult<void>[] = new Array(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) continue;
      try {
        await handler(item);
        results[index] = { status: 'fulfilled', value: undefined };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** The editor, slide graphic, calculation and saved snapshot read this one store. */
export function useDeckValues(specs: ISpec[], identity: string, materialId?: string) {
  // 账号 scope 的唯一来源（C-SESSION@1）；键随 scope 变化，切换账号后读不到旧账号的草稿（R5-AC3）。
  const scope = useAccountScope();
  const [values, setValues] = useState<DeckValues>({});
  /** `values` 当前所属的存储键；用于阻止"按键切换时把上一个账号的参数写进新 scope 的键"。 */
  const [valuesOwner, setValuesOwner] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [loadFailed,setLoadFailed]=useState(false);
  const dirty = useRef(new Set<string>());
  const versions = useRef<Record<string, string | null>>({});
  const edits = useRef<Record<string, number>>({});
  const loadingValues = useRef<Promise<unknown>>(Promise.resolve());
  const loadedObjects=useRef(new Set<string>());
  const current = useRef(values);
  const history=useRef(createHistory({}));
  /** 同帧多次单点参数改动（如二维拖拽的 x/y）合并到一次 rAF 提交，避免高频全量重渲染与撤销栈暴涨。 */
  const pendingPatches = useRef<Map<string, DeckParameterPatch>>(new Map());
  const rafId = useRef<number | null>(null);
  const storageTimer = useRef<number | null>(null);
  const storagePending = useRef(false);
  const ownerRef = useRef(valuesOwner);
  ownerRef.current = valuesOwner;
  // 键含账号 scope：`xiangsheng.deck.v1.<scope>.<identity>`（identity 仍携带 edit_revision）。
  const key = `xiangsheng.deck.v1.${scope}.${identity}`;
  const signature = specs.map(s => s.object_id).join('|');

  const writeStorageNow = useCallback((targetKey: string, snapshot: DeckValues) => {
    if (storageTimer.current !== null) {
      window.clearTimeout(storageTimer.current);
      storageTimer.current = null;
    }
    storagePending.current = false;
    if (!Object.keys(snapshot).length) return;
    try {
      localStorage.setItem(targetKey, JSON.stringify({
        values: snapshot,
        dirty: [...dirty.current],
        versions: versions.current,
      }));
    } catch { /* private browsing */ }
  }, []);

  const scheduleStorageWrite = useCallback((targetKey: string) => {
    storagePending.current = true;
    if (typeof window === 'undefined') {
      writeStorageNow(targetKey, current.current);
      return;
    }
    if (storageTimer.current !== null) window.clearTimeout(storageTimer.current);
    storageTimer.current = window.setTimeout(() => {
      storageTimer.current = null;
      if (ownerRef.current !== targetKey) return;
      writeStorageNow(targetKey, current.current);
    }, 350);
  }, [writeStorageNow]);

  useEffect(() => {
    let alive = true;
    if (rafId.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    pendingPatches.current.clear();
    if (storageTimer.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(storageTimer.current);
      storageTimer.current = null;
    }
    storagePending.current = false;
    dirty.current = new Set();
    versions.current = {};
    edits.current = {};
    loadedObjects.current=new Set();
    setLoadFailed(false);
    let stored: { values?: DeckValues; dirty?: string[]; versions?: Record<string, string | null> } = {};
    try { stored = JSON.parse(localStorage.getItem(key) ?? '{}') as typeof stored; } catch { /* storage unavailable */ }
    versions.current = stored.versions ?? {};
    const next: DeckValues = {};
    for (const spec of specs) {
      const restored = stored.values?.[spec.object_id] ?? {};
      const defaults = initialValues(spec);
      // Only declared scalar parameters can be restored.
      for (const parameter of spec.parameters) {
        const value = restored[parameter.id];
        if (value !== undefined && typeof value === typeof parameter.default &&
            (typeof value !== 'number' || Number.isFinite(value))) defaults[parameter.id] = value;
      }
      next[spec.object_id] = defaults;
      if (stored.dirty?.includes(spec.object_id)) dirty.current.add(spec.object_id);
    }
    current.current = next;
    history.current=createHistory(next);
    ownerRef.current = key;
    setValuesOwner(key);
    setValues(next);
    setStatus(dirty.current.size ? '有未保存的修改' : '');
    if (materialId) {
      // 弱网首开：先让整页图和相邻页预取占满带宽，再同步全部对象的服务端参数。
      const afterFirstScreen = typeof window === 'undefined'
        ? Promise.resolve()
        : new Promise<void>(resolve => {
            window.setTimeout(resolve, 1200);
          });
      loadingValues.current = afterFirstScreen.then(() => settleWithLimit(specs, 2, async spec => {
        const generation = edits.current[spec.object_id] ?? 0;
        const record = await api.getISpecValues(materialId, spec.object_id);
        if (!alive) return;
        loadedObjects.current.add(spec.object_id);
        // Keep the draft's baseline revision. Never replace a known baseline with
        // a newer server version while local edits are pending.
        if (versions.current[spec.object_id] === undefined) versions.current[spec.object_id] = record.updated_at;
        if (dirty.current.has(spec.object_id) || (edits.current[spec.object_id] ?? 0) !== generation) {
          scheduleStorageWrite(key);
          return;
        }
        versions.current[spec.object_id] = record.updated_at;
        setValues(previous => {
          const merged = { ...previous, [spec.object_id]: { ...initialValues(spec), ...record.values } };
          current.current = merged;
          const patch=(item:DeckValues)=>({...item,[spec.object_id]:merged[spec.object_id]!});
          history.current={...history.current,present:merged,past:history.current.past.map(patch),future:history.current.future.map(patch)};
          return merged;
        });
      })).then(results => {
        if (alive && results.some(result => result.status === 'rejected')) {
          setLoadFailed(true);setStatus('服务端参数读取失败，当前修改仍保存在此浏览器');
        }
      });
    }
    return () => { alive = false; };
    // Specs are immutable for a material; do not reload state on each query refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, materialId, signature]);

  useEffect(() => {
    // `values` 仍属于上一个键（账号切换 / 材料版本切换）时绝不写入：否则旧账号的
    // 参数会被搬进新 scope 的键，新账号随即"继承"这些值（R5-AC3）。
    if (valuesOwner !== key) return;
    if (!Object.keys(values).length) return;
    scheduleStorageWrite(key);
  }, [values, key, valuesOwner, scheduleStorageWrite]);

  const applyValues=useCallback((next:DeckValues)=>{
    if(sameDeckValues(current.current,next)) return;
    for(const spec of specs) if(!sameObjectValues(current.current[spec.object_id],next[spec.object_id])) {
      dirty.current.add(spec.object_id);
      edits.current[spec.object_id]=(edits.current[spec.object_id]??0)+1;
    }
    current.current=next;setValues(next);
    setStatus(materialId ? '有未保存的修改' : '已在此浏览器保留修改');
  },[specs,materialId]);

  const flushPending = useCallback(() => {
    if (rafId.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    if (!pendingPatches.current.size) return;
    const batch = [...pendingPatches.current.values()];
    pendingPatches.current.clear();
    const next = changeDeckParameters(specs, current.current, batch);
    const groupKey = batch
      .map(item => `${item.objectId}.${item.id}`)
      .sort()
      .join('|');
    history.current = commitHistory(history.current, next, groupKey);
    applyValues(next);
  }, [specs, applyValues]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const flushAll = () => {
      flushPending();
      if (storagePending.current && ownerRef.current === key) {
        writeStorageNow(key, current.current);
      }
    };
    window.addEventListener('pagehide', flushAll);
    window.addEventListener('beforeunload', flushAll);
    return () => {
      window.removeEventListener('pagehide', flushAll);
      window.removeEventListener('beforeunload', flushAll);
      flushAll();
    };
  }, [flushPending, key, writeStorageNow]);

  const change = useCallback((spec: ISpec, id: string, value: SpecCell) => {
    pendingPatches.current.set(`${spec.object_id}:${id}`, { objectId: spec.object_id, id, value });
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      flushPending();
      return;
    }
    if (rafId.current === null) {
      rafId.current = window.requestAnimationFrame(() => {
        rafId.current = null;
        flushPending();
      });
    }
  }, [flushPending]);

  const restore=useCallback((spec:ISpec,snapshot:Record<string,SpecCell>)=>{
    flushPending();
    const patches: DeckParameterPatch[] = spec.parameters.map(parameter => ({
      objectId: spec.object_id,
      id: parameter.id,
      value: snapshot[parameter.id] ?? parameter.default,
    }));
    const next = changeDeckParameters(specs, current.current, patches);
    history.current=commitHistory(history.current,next);
    applyValues(next);
  },[specs,applyValues,flushPending]);
  const undo=useCallback(()=>{flushPending();history.current=undoHistory(history.current);applyValues(history.current.present);},[applyValues,flushPending]);
  const redo=useCallback(()=>{flushPending();history.current=redoHistory(history.current);applyValues(history.current.present);},[applyValues,flushPending]);

  const persistDirty = useCallback(async (): Promise<boolean> => {
    flushPending();
    for (const spec of specs) {
      if (!dirty.current.has(spec.object_id)) continue;
      if (versions.current[spec.object_id] === undefined) throw new Error('无法核对服务端参数版本，请重新载入后保存');
      const revision = edits.current[spec.object_id];
      const result = await api.putISpecValues(materialId!, spec.object_id,
        current.current[spec.object_id] ?? initialValues(spec), versions.current[spec.object_id] ?? '');
      versions.current[spec.object_id] = result.updated_at;
      if (revision === edits.current[spec.object_id]) dirty.current.delete(spec.object_id);
    }
    writeStorageNow(key, current.current);
    setStatus(dirty.current.size ? '仍有新修改，请再次保存' : '参数已保存');
    return dirty.current.size === 0;
  }, [materialId, specs, key, flushPending, writeStorageNow]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!materialId || saving) return !materialId;
    setSaving(true);
    try {
      await loadingValues.current;
      if(specs.some(spec=>!loadedObjects.current.has(spec.object_id))) throw new Error('服务端参数尚未完整载入，请先重新载入已保存参数');
      return await persistDirty();
    } catch (error) {
      if (isApiError(error, 'VERSION_CONFLICT')) setConflict(true);
      setStatus(`保存失败：${errorMessage(error)}。本地修改已保留`);
      return false;
    } finally { setSaving(false); }
  }, [materialId, specs, saving, persistDirty]);

  const reset = useCallback((spec: ISpec) => {
    const baseline=Object.fromEntries(spec.parameters.map(parameter=>[parameter.id,parameter.source_default??parameter.default]));
    restore(spec,baseline);
  }, [restore]);

  const loadSaved = useCallback(async () => {
    if (!materialId || saving) return;
    setSaving(true);
    try {
      const records = await Promise.all(specs.map(spec => api.getISpecValues(materialId, spec.object_id)));
      const next: DeckValues = {};
      specs.forEach((spec, index) => {
        next[spec.object_id] = {...initialValues(spec), ...records[index]!.values};
        versions.current[spec.object_id] = records[index]!.updated_at;
      });
      dirty.current.clear();
      loadedObjects.current=new Set(specs.map(spec=>spec.object_id));
      current.current = next;
      history.current=createHistory(next);
      setValues(next);
      setConflict(false);
      setLoadFailed(false);
      setStatus('已载入服务端保存的参数');
      try { localStorage.setItem(key, JSON.stringify({values: next, dirty: [], versions: versions.current})); } catch { /* private browsing */ }
    } catch (error) { setStatus(`载入失败：${errorMessage(error)}。本地修改已保留`); }
    finally { setSaving(false); }
  }, [materialId, saving, specs, key]);

  const reloadBaseline = useCallback(async (): Promise<boolean> => {
    if (!materialId || saving) return false;
    setSaving(true);
    try {
      const records = await Promise.all(specs.map(spec => api.getISpecValues(materialId, spec.object_id)));
      const next: DeckValues = {};
      specs.forEach((spec, index) => {
        const record = records[index]!;
        versions.current[spec.object_id] = record.updated_at;
        loadedObjects.current.add(spec.object_id);
        // Dirty drafts win; untouched values come from the recovered baseline.
        next[spec.object_id] = dirty.current.has(spec.object_id)
          ? (current.current[spec.object_id] ?? {...initialValues(spec), ...record.values})
          : {...initialValues(spec), ...record.values};
      });
      current.current = next;
      history.current = createHistory(next);
      setValues(next);
      setLoadFailed(false);
      setStatus(dirty.current.size ? '已重新载入基线，正在保存本地草稿…' : '已重新载入服务端参数基线');
      if (!dirty.current.size) return true;
      return await persistDirty();
    } catch (error) {
      setStatus(`重新载入基线失败：${errorMessage(error)}。本地修改已保留`);
      return false;
    } finally { setSaving(false); }
  }, [materialId, saving, specs, persistDirty]);

  return { values, change, reset, restore, undo, redo, canUndo:history.current.past.length>0,
    canRedo:history.current.future.length>0, save, saving, status, conflict, loadFailed, loadSaved,
    reloadBaseline };
}
