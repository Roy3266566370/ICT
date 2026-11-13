/**
 * modelStore.ts —— 按 `object_id` 隔离的即时参数状态（plan §2.1.1 / §2.3.1）
 *
 * 语义（与契约 §2.3.2 对齐）：
 *  - **revision**：同一 `model_version` 下数值调整的递增计数。每次合法参数写入 +1。
 *  - **model_version**：结构（图节点/边、模板、表达式依赖）变化时 +1，并**清空执行轨迹**，
 *    同时把 `revision` 归 0。
 *  - 越界/非法取值 **不写入**，只在 `paramErrors[parameterId]` 与 `error` 记录原因。
 *  - 只按 `object_id` + `parameter.id` 共享状态，绝不跨对象按名称合并（R5-AC5）。
 *  - 全部更新都走不可变写法（新对象引用），便于 React 精准重渲染。
 *
 * revision 是"复用同一 Result"的天然 key：视图切换不改 revision，参数不改也不改 revision。
 */
import { create } from 'zustand';
import type { KnowledgeObject, Parameter } from '@/api/types';
import { isForceInputList, isGraphValue, isMatrix2, isVector2 } from '@/api/types';
import { decCompare, decFromString } from '@/domain/budget';

export interface ObjectState {
  /** 当前对象快照（含 revision / model_version 权威值） */
  object: KnowledgeObject;
  /** 该对象首次载入时的基线，`resetObject` 用（R10-AC3） */
  baseline: KnowledgeObject;
  /** parameterId → 越界/非法原因 */
  paramErrors: Record<string, string>;
  /** 最近一次失败的总体原因 */
  error: string | null;
  /** 执行轨迹（BFS 的逐步轨迹等）；结构变更时清空（R5-AC4） */
  trace: readonly unknown[];
  /** 是否存在未回传服务端的本地修改 */
  dirty: boolean;
}

export interface SetParamResult {
  ok: boolean;
  error: string | null;
  /** 写入后的最新 revision（失败时保持原值） */
  revision: number;
}

export interface ModelStoreState {
  objects: Record<string, ObjectState>;

  /** 载入/刷新服务端对象；本地有未保存修改时默认不覆盖（可用 force 强制）。 */
  loadObject(object: KnowledgeObject, options?: { force?: boolean }): void;
  /** 写入参数值：合法则 revision + 1，非法则只记录错误。 */
  setParam(objectId: string, parameterId: string, value: unknown): SetParamResult;
  /** 恢复模板初始状态与初始 revision 基线。 */
  resetObject(objectId: string): KnowledgeObject | null;
  /** 应用一次手工示例克隆（等价于强制载入一个新对象）。 */
  applyExample(object: KnowledgeObject): void;
  /** 读取当前对象快照。 */
  getObject(objectId: string): KnowledgeObject | null;
  /** 结构变更（节点/边/模板/AST 依赖）：model_version + 1、revision 归 0、清空 trace。 */
  setModel(objectId: string, object: KnowledgeObject): void;
  /** 写入执行轨迹（结构变更时会被清空）。 */
  setTrace(objectId: string, trace: readonly unknown[]): void;
  /** 清除错误标记（例如用户重新输入后）。 */
  clearError(objectId: string): void;
  /** 标记本地修改已同步（保存运行 / PUT model 成功后调用）。 */
  markSynced(objectId: string): void;
  /** 移除对象（切换材料时清理，避免内存膨胀）。 */
  removeObject(objectId: string): void;
}

/* -------------------------------------------------------------------------- */
/* 参数校验                                                                   */
/* -------------------------------------------------------------------------- */

const DECIMAL_PATTERN = /^[+-]?\d+(\.\d+)?$/;

function withinRange(
  value: number,
  range: Parameter['range'],
  label: string,
  unit: string,
): string | null {
  const suffix = unit === '' || unit === '1' ? '' : unit;
  if (range.min !== null && value < range.min) {
    return `${label} = ${value}${suffix} 小于允许下限 ${range.min}${suffix}`;
  }
  if (range.max !== null && value > range.max) {
    return `${label} = ${value}${suffix} 大于允许上限 ${range.max}${suffix}`;
  }
  return null;
}

function withinDecimalRange(value: string, range: Parameter['range'], label: string): string | null {
  const parsed = decFromString(value);
  if (parsed === null) return `${label} 不是合法的十进制金额：${value}`;
  if (range.min_decimal !== undefined) {
    const min = decFromString(range.min_decimal);
    if (min !== null && decCompare(parsed, min) < 0) {
      return `${label} = ${value} 小于允许下限 ${range.min_decimal}`;
    }
  }
  if (range.max_decimal !== undefined) {
    const max = decFromString(range.max_decimal);
    if (max !== null && decCompare(parsed, max) > 0) {
      return `${label} = ${value} 大于允许上限 ${range.max_decimal}`;
    }
  }
  return null;
}

/**
 * 依据 `Parameter.type` 与 `range` 校验取值。
 * 返回 null 表示合法；返回字符串表示原因（直接展示给用户，含参数名与允许范围）。
 */
export function validateParameterValue(parameter: Parameter, value: unknown): string | null {
  const { name, type, range, unit } = parameter;

  switch (type) {
    case 'matrix2': {
      if (!isMatrix2(value)) return `${name} 需要 2×2 的数值矩阵`;
      const flat = [value[0][0], value[0][1], value[1][0], value[1][1]];
      for (let index = 0; index < flat.length; index += 1) {
        const element = flat[index];
        if (element === undefined) return `${name} 需要 2×2 的数值矩阵`;
        const row = index < 2 ? 0 : 1;
        const col = index % 2;
        const rangeError = withinRange(element, range, `${name}[${row}][${col}]`, unit);
        if (rangeError !== null) return rangeError;
      }
      return null;
    }
    case 'vector2': {
      if (!isVector2(value)) return `${name} 需要两个有限数值分量`;
      for (let index = 0; index < value.length; index += 1) {
        const component = value[index];
        if (component === undefined) return `${name} 需要两个有限数值分量`;
        const rangeError = withinRange(component, range, `${name}[${index}]`, unit);
        if (rangeError !== null) return rangeError;
      }
      return null;
    }
    case 'force_list': {
      if (!isForceInputList(value)) {
        return `${name} 需要 2 至 4 个 { magnitude: 十进制字符串, angle_deg: 度数 }`;
      }
      for (let index = 0; index < value.length; index += 1) {
        const force = value[index];
        if (force === undefined) continue;
        const magnitude = Number(force.magnitude);
        if (!Number.isFinite(magnitude)) {
          return `第 ${index + 1} 个力的大小不是合法数字：${force.magnitude}`;
        }
        if (magnitude < 0 || magnitude > 1000) {
          return `第 ${index + 1} 个力的大小 ${magnitude}N 超出允许范围 0 ~ 1000N`;
        }
        if (!Number.isFinite(force.angle_deg) || force.angle_deg < 0 || force.angle_deg >= 360) {
          return `第 ${index + 1} 个力的角度 ${force.angle_deg} 超出允许范围 [0, 360)`;
        }
      }
      return null;
    }
    case 'graph': {
      if (!isGraphValue(value)) return `${name} 需要 { nodes: [...], edges: [...] } 结构`;
      if (value.nodes.length > 20) return `${name} 的节点数为 ${value.nodes.length}，超出上限 20（节点数超限）`;
      if (value.edges.length > 40) return `${name} 的边数为 ${value.edges.length}，超出上限 40（边数超限）`;
      return null;
    }
    case 'integer': {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return `${name} 需要整数`;
      }
      return withinRange(value, range, name, unit);
    }
    case 'decimal': {
      if (typeof value !== 'string') return `${name} 需要十进制字符串（禁止二进制浮点参与金额运算）`;
      const trimmed = value.trim();
      if (!DECIMAL_PATTERN.test(trimmed)) return `${name} 不是合法的十进制数：${value}`;
      return withinDecimalRange(trimmed, range, name);
    }
    case 'enum':
    case 'text': {
      return typeof value === 'string' ? null : `${name} 需要字符串`;
    }
    default: {
      const exhaustive: never = type;
      return `不支持的参数类型：${String(exhaustive)}`;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 不可变工具                                                                 */
/* -------------------------------------------------------------------------- */

/** 深拷贝对象快照，避免 baseline 与当前值共享可变数组引用。 */
function cloneObject(object: KnowledgeObject): KnowledgeObject {
  return {
    ...object,
    config: { ...object.config },
    parameters: object.parameters.map((parameter) => ({
      ...parameter,
      range: { ...parameter.range },
      source_ref_ids: [...parameter.source_ref_ids],
      value: cloneValue(parameter.value),
    })),
    views: [...object.views],
    bindings: object.bindings.map((binding) => ({ ...binding })),
    source_refs: object.source_refs.map((sourceRef) => ({
      ...sourceRef,
      bbox: sourceRef.bbox === null ? null : { ...sourceRef.bbox },
    })),
  };
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item));
  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source)) result[key] = cloneValue(source[key]);
    return result;
  }
  return value;
}

function createObjectState(object: KnowledgeObject): ObjectState {
  const snapshot = cloneObject(object);
  return {
    object: snapshot,
    baseline: cloneObject(snapshot),
    paramErrors: {},
    error: null,
    trace: [],
    dirty: false,
  };
}

function replaceParameterValue(
  object: KnowledgeObject,
  parameterId: string,
  value: unknown,
  revision: number,
): KnowledgeObject {
  return {
    ...object,
    revision,
    updated_at: new Date().toISOString(),
    parameters: object.parameters.map((parameter) =>
      parameter.id === parameterId ? { ...parameter, value } : parameter,
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Store                                                                      */
/* -------------------------------------------------------------------------- */

export const useModelStore = create<ModelStoreState>()((set, get) => ({
  objects: {},

  loadObject(object, options) {
    const { objects } = get();
    const existing = objects[object.object_id];
    if (existing !== undefined && existing.dirty && options?.force !== true) {
      // 本地有未回传修改时保留本地值，避免服务端刷新覆盖用户输入（R10-AC6）
      return;
    }
    set({ objects: { ...objects, [object.object_id]: createObjectState(object) } });
  },

  setParam(objectId, parameterId, value) {
    const { objects } = get();
    const entry = objects[objectId];
    if (entry === undefined) {
      const error = `对象 ${objectId} 尚未载入，无法修改参数`;
      return { ok: false, error, revision: 0 };
    }

    const parameter = entry.object.parameters.find((item) => item.id === parameterId);
    if (parameter === undefined) {
      const error = `参数 ${parameterId} 不存在于对象 ${objectId}`;
      set({
        objects: {
          ...objects,
          [objectId]: { ...entry, error, paramErrors: { ...entry.paramErrors, [parameterId]: error } },
        },
      });
      return { ok: false, error, revision: entry.object.revision };
    }

    if (!parameter.editable) {
      const error = `参数 ${parameter.name} 为只读，不能修改`;
      set({
        objects: {
          ...objects,
          [objectId]: { ...entry, error, paramErrors: { ...entry.paramErrors, [parameterId]: error } },
        },
      });
      return { ok: false, error, revision: entry.object.revision };
    }

    const validationError = validateParameterValue(parameter, value);
    if (validationError !== null) {
      // 越界值不写入（R5-AC3 的反面），只记录原因
      set({
        objects: {
          ...objects,
          [objectId]: {
            ...entry,
            error: validationError,
            paramErrors: { ...entry.paramErrors, [parameterId]: validationError },
          },
        },
      });
      return { ok: false, error: validationError, revision: entry.object.revision };
    }

    const nextRevision = entry.object.revision + 1;
    const nextObject = replaceParameterValue(entry.object, parameterId, cloneValue(value), nextRevision);
    const nextErrors = { ...entry.paramErrors };
    delete nextErrors[parameterId];

    set({
      objects: {
        ...objects,
        [objectId]: {
          ...entry,
          object: nextObject,
          paramErrors: nextErrors,
          error: null,
          dirty: true,
        },
      },
    });
    return { ok: true, error: null, revision: nextRevision };
  },

  resetObject(objectId) {
    const { objects } = get();
    const entry = objects[objectId];
    if (entry === undefined) return null;
    const baseline = cloneObject(entry.baseline);
    const restored: KnowledgeObject = { ...baseline, revision: 0, updated_at: new Date().toISOString() };
    set({
      objects: {
        ...objects,
        [objectId]: {
          ...entry,
          object: restored,
          paramErrors: {},
          error: null,
          trace: [],
          dirty: false,
        },
      },
    });
    return restored;
  },

  applyExample(object) {
    get().loadObject(object, { force: true });
  },

  getObject(objectId) {
    return get().objects[objectId]?.object ?? null;
  },

  setModel(objectId, object) {
    const { objects } = get();
    const entry = objects[objectId];
    // 结构变更推进 model_version：服务端返回了更高版本就采用，否则本地 +1
    const nextVersion =
      entry !== undefined && object.model_version <= entry.object.model_version
        ? entry.object.model_version + 1
        : object.model_version;
    const nextObject: KnowledgeObject = {
      ...object,
      model_version: nextVersion,
      revision: 0,
      updated_at: new Date().toISOString(),
    };
    const nextState: ObjectState =
      entry === undefined
        ? { ...createObjectState(nextObject), dirty: true }
        : {
            ...entry,
            object: nextObject,
            paramErrors: {},
            error: null,
            trace: [],
            dirty: true,
          };
    set({ objects: { ...objects, [objectId]: nextState } });
  },

  setTrace(objectId, trace) {
    const { objects } = get();
    const entry = objects[objectId];
    if (entry === undefined) return;
    set({ objects: { ...objects, [objectId]: { ...entry, trace: [...trace] } } });
  },

  clearError(objectId) {
    const { objects } = get();
    const entry = objects[objectId];
    if (entry === undefined) return;
    set({
      objects: {
        ...objects,
        [objectId]: { ...entry, error: null, paramErrors: {} },
      },
    });
  },

  markSynced(objectId) {
    const { objects } = get();
    const entry = objects[objectId];
    if (entry === undefined) return;
    set({ objects: { ...objects, [objectId]: { ...entry, dirty: false } } });
  },

  removeObject(objectId) {
    const { objects } = get();
    if (objects[objectId] === undefined) return;
    const next = { ...objects };
    delete next[objectId];
    set({ objects: next });
  },
}));

/* -------------------------------------------------------------------------- */
/* Selector hooks（给页面/模板用，避免整棵 store 订阅）                        */
/* -------------------------------------------------------------------------- */

/** 订阅单个对象的状态；对象不存在返回 null。 */
export function useModelObject(objectId: string | null): ObjectState | null {
  return useModelStore((state) => (objectId === null ? null : (state.objects[objectId] ?? null)));
}

/** 订阅该对象当前的 revision（视图同步的 key，R10-AC1）。 */
export function useObjectRevision(objectId: string | null): number {
  return useModelStore((state) =>
    objectId === null ? 0 : (state.objects[objectId]?.object.revision ?? 0),
  );
}

/** 订阅某个参数的越界原因。 */
export function useParamError(objectId: string | null, parameterId: string): string | null {
  return useModelStore((state) =>
    objectId === null ? null : (state.objects[objectId]?.paramErrors[parameterId] ?? null),
  );
}