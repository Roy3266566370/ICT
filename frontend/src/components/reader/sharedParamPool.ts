/**
 * `sharedParamPool.ts` —— 跨 iSpec 共享池的纯函数层（§9-4）。
 *
 * 背景：同一变量（如"销售额·万元"）会在多页的 iSpec 里各出现一份。识别层用
 * `shared_key` 把它们钉成一组（`backend/app/ispec/shared.py`），运行时则必须让
 * **一份值**服务所有引用该键的 iSpec，否则"改一处、全课同步"落空。
 *
 * 三条规则：
 * 1. **池优先**：`sharedValues[shared_key]` 存在时覆盖各页自己的默认值/本地覆盖值；
 * 2. **写池即同步**：任一页改动带 `shared_key` 的参数时写池，其他页下次读取即为新值；
 * 3. **冲突不自动修**：各页默认值不一致只报出来（`conflict`），由用户确认一个值。
 *
 * 约束：本文件只允许 `import type`（无运行时依赖），便于 `node --test` / esbuild 直接执行。
 */
import type { ISpec, SharedGroup, SharedGroupMember, SpecParameter } from '../../ispec/types';
import type { SpecValue, SpecValues } from './unifiedSpecState';

/** 共享池：`{ [shared_key]: 值 }`，随会话持久化（`xiangsheng:shared:<material_id>`）。 */
export type SharedValues = Record<string, SpecValue>;

/** 一致性检查结果（供详情面板展示）。 */
export interface SharedConsistencyItem {
  shared_key: string;
  ok: boolean;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 成员取值的键：`object_id::parameter_id`（同一 iSpec 内参数 id 唯一）。 */
export function memberValueKey(objectId: string, parameterId: string): string {
  return `${objectId}::${parameterId}`;
}

/** 清理持久化的共享池：只接受数字/布尔/字符串（其余键丢弃）。 */
export function sanitizeSharedValues(raw: unknown): SharedValues {
  if (!isRecord(raw)) return {};
  const result: SharedValues = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
    else if (typeof value === 'boolean' || typeof value === 'string') result[key] = value;
  }
  return result;
}

/** 比较两个共享值是否相同（数字 1e-9 容差）。 */
function sameValue(left: SpecValue, right: SpecValue): boolean {
  if (isFiniteNumber(left) && isFiniteNumber(right)) return Math.abs(left - right) < 1e-9;
  return left === right;
}

/** 读共享池里的值；没有则返回 `undefined`。 */
export function sharedValueOf(pool: SharedValues, sharedKey: string): SpecValue | undefined {
  return Object.prototype.hasOwnProperty.call(pool, sharedKey) ? pool[sharedKey] : undefined;
}

/**
 * 写共享池（返回新对象；值未变化时返回原对象，避免无意义的重渲染）。
 * 供 `useUnifiedSpecState` 在参数改动时调用——写池即"全课同步"。
 */
export function setSharedValue(
  pool: SharedValues,
  sharedKey: string,
  value: SpecValue,
): SharedValues {
  const current = sharedValueOf(pool, sharedKey);
  if (current !== undefined && sameValue(current, value)) return pool;
  return { ...pool, [sharedKey]: value };
}

/** 某参数的共享键（无 `shared_key` 返回 `undefined`，即页内参数）。 */
export function sharedKeyOfParameter(parameter: SpecParameter): string | undefined {
  const key = parameter.shared_key;
  return typeof key === 'string' && key.length > 0 ? key : undefined;
}

/**
 * 共享池 → 本页参数值。
 *
 * 池里有值的共享参数一律读池（跨页一致）；其余参数保持本页自己的值。
 * 池值在写入时已由写入方的参数定义夹紧（`setSpecValue`），读方直接采用——
 * 若各页再按自己的 min/max 二次夹紧，同一变量会被拆成不同的值，同步就失效了。
 */
export function applySharedValuesToSpec(
  spec: ISpec | null,
  values: SpecValues,
  pool: SharedValues,
): SpecValues {
  if (spec === null) return values;
  let result: SpecValues | null = null;
  for (const parameter of spec.parameters) {
    const sharedKey = sharedKeyOfParameter(parameter);
    if (sharedKey === undefined) continue;
    const pooled = sharedValueOf(pool, sharedKey);
    if (pooled === undefined) continue;
    const current = values[parameter.id];
    if (current !== undefined && sameValue(current, pooled)) continue;
    if (result === null) result = { ...values };
    result[parameter.id] = pooled;
  }
  return result ?? values;
}

/** 由多条 iSpec 汇总共享组（同一 `shared_key` 一条）；无共享键时返回空数组。 */
export function collectSharedGroups(specs: ReadonlyArray<ISpec>): SharedGroup[] {
  const byKey = new Map<string, SharedGroup>();
  for (const spec of specs) {
    for (const parameter of spec.parameters) {
      const sharedKey = sharedKeyOfParameter(parameter);
      if (sharedKey === undefined) continue;
      const member: SharedGroupMember = {
        object_id: spec.object_id,
        parameter_id: parameter.id,
      };
      if (typeof parameter.source?.page === 'number') member.page = parameter.source.page;
      const group = byKey.get(sharedKey);
      if (group === undefined) {
        byKey.set(sharedKey, {
          shared_key: sharedKey,
          label: parameter.label,
          unit: parameter.unit,
          members: [member],
        });
        continue;
      }
      // 同一条 iSpec 的同一参数只记一次（防止重复渲染）
      if (
        group.members.some(
          (item) => item.object_id === member.object_id && item.parameter_id === member.parameter_id,
        )
      ) {
        continue;
      }
      group.members.push(member);
    }
  }
  const groups = [...byKey.values()];
  for (const group of groups) {
    const defaults = new Set<string>();
    for (const spec of specs) {
      for (const parameter of spec.parameters) {
        if (sharedKeyOfParameter(parameter) !== group.shared_key) continue;
        defaults.add(String(parameter.default));
      }
    }
    if (defaults.size > 1) {
      group.conflict = true;
      group.defaults = [...defaults];
    }
  }
  return groups;
}

/** 只保留默认值冲突的共享组（详情面板只提示这些）。 */
export function sharedConflictGroups(groups: ReadonlyArray<SharedGroup>): SharedGroup[] {
  return groups.filter((group) => group.conflict === true);
}

/** 冲突提示文案：说明是哪一变量、各页默认值分别是什么，并要求用户确认一个值。 */
export function describeSharedConflict(group: SharedGroup): string {
  const values = (group.defaults ?? []).join(' / ');
  const unit = group.unit !== undefined && group.unit.length > 0 ? `（${group.unit}）` : '';
  return `同一变量「${group.label}」${unit}在不同页默认值不一致（${values}），请确认一个值。`;
}

/** 一致性提示文案（`ok:false` 时展示）。 */
export function describeSharedConsistency(item: SharedConsistencyItem): string {
  return item.message;
}

/**
 * 一致性校验：同一 `shared_key` 的取值在不同 iSpec 中必须相同。
 *
 * @param groups 共享组（`collectSharedGroups` 的结果）
 * @param values 取值查找表，键为 `memberValueKey(object_id, parameter_id)`；
 *   也接受直接用 `shared_key` 作为键（此时视作"全局值"）。
 * @returns 每组一条结果；任一群组取值不一致 → `ok:false`。
 */
export function checkSharedConsistency(
  groups: ReadonlyArray<SharedGroup>,
  values: Record<string, SpecValue>,
): SharedConsistencyItem[] {
  return groups.map((group) => {
    const observed: Array<{ member: SharedGroupMember; value: SpecValue }> = [];
    for (const member of group.members) {
      const keyed = values[memberValueKey(member.object_id, member.parameter_id)];
      const value = keyed !== undefined ? keyed : values[group.shared_key];
      if (value === undefined) continue;
      observed.push({ member, value });
    }
    const first = observed[0];
    if (first === undefined) {
      return {
        shared_key: group.shared_key,
        ok: true,
        message: `共享参数「${group.label}」暂无取值，无需同步。`,
      };
    }
    const mismatched = observed.filter((item) => !sameValue(item.value, first.value));
    if (mismatched.length === 0) {
      return {
        shared_key: group.shared_key,
        ok: true,
        message: `共享参数「${group.label}」在 ${observed.length} 处取值一致。`,
      };
    }
    const other = mismatched[0];
    if (other === undefined) {
      return {
        shared_key: group.shared_key,
        ok: true,
        message: `共享参数「${group.label}」在 ${observed.length} 处取值一致。`,
      };
    }
    const describe = (item: { member: SharedGroupMember; value: SpecValue }): string => {
      const page =
        item.member.page === undefined ? item.member.object_id : `第 ${item.member.page} 页`;
      return `${page}=${String(item.value)}`;
    };
    return {
      shared_key: group.shared_key,
      ok: false,
      message: `共享参数「${group.label}」在不同页取值不一致：${describe(first)} / ${describe(other)}，请确认一个值。`,
    };
  });
}