/** 活页文本插值（纯函数，无 React 依赖，可单测）。
 *
 * 支持三种形态：
 * - ``${name}``       → 变量当前值（数字按精度格式化）
 * - ``${expr: …}``    → 受控表达式求值（``labs/expr`` 预算内）
 * - ``${cond ? a : b}``→ 顶层 ``? :`` 有限分支（不支持嵌套）
 *
 * 解析不了的占位符原样保留——插值失败永远降级为可读文本，不吃字符。
 */

import { evaluateExpression, formatNumber } from '../labs/expr.ts';
import type { PageVariables } from './types.ts';

export type LiveVarValue = number | string;

/** 将运行时的变量值字典与最新页面变量定义对齐：
 *  - 新增变量、类型变更、作者修改了默认值、或当前值超出新范围/选项时采用新默认值；
 *  - 未改定义的已有变量保留学生/预览拖动的当前值；已删除变量从字典移除。 */
export function reconcileLiveVars(
  prevValues: Record<string, LiveVarValue>,
  nextDefs: PageVariables,
  prevDefs?: PageVariables,
): Record<string, LiveVarValue> {
  const next: Record<string, LiveVarValue> = {};
  for (const [name, spec] of Object.entries(nextDefs)) {
    const oldSpec = prevDefs?.[name];
    const hasPrev = Object.prototype.hasOwnProperty.call(prevValues, name);
    const prevVal = prevValues[name];
    if (!hasPrev || (oldSpec && (oldSpec.type !== spec.type || oldSpec.value !== spec.value))) {
      next[name] = spec.value;
      continue;
    }
    if (spec.type === 'number') {
      if (
        typeof prevVal === 'number'
        && Number.isFinite(prevVal)
        && (spec.min === undefined || prevVal >= spec.min)
        && (spec.max === undefined || prevVal <= spec.max)
      ) {
        next[name] = prevVal;
      } else {
        next[name] = spec.value;
      }
    } else {
      if (typeof prevVal === 'string' && spec.options.includes(prevVal)) {
        next[name] = prevVal;
      } else {
        next[name] = spec.value;
      }
    }
  }
  return next;
}

const TOKEN = /\$\{([^{}]+)\}/g;

const numericValues = (values: Record<string, LiveVarValue>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
};

const CMP = /^(.*?)(>=|<=|==|!=|>|<)(.*)$/;

/** 条件求值：``expr op expr`` 单比较，或裸数值表达式取真假。两侧仍是纯算术。 */
function evalCondition(cond: string, values: Record<string, LiveVarValue>): boolean | null {
  const vars = numericValues(values);
  const names = Object.keys(vars);
  const num = (source: string): number | null => evaluateExpression(source.trim(), vars, names);
  const match = cond.match(CMP);
  if (!match) {
    const value = num(cond);
    return value === null ? null : value !== 0;
  }
  const left = num(match[1] ?? '');
  const right = num(match[3] ?? '');
  if (left === null || right === null) return null;
  switch (match[2]) {
    case '>': return left > right;
    case '<': return left < right;
    case '>=': return left >= right;
    case '<=': return left <= right;
    case '==': return Math.abs(left - right) <= 1e-9;
    case '!=': return Math.abs(left - right) > 1e-9;
    default: return null;
  }
}

function evalToken(body: string, values: Record<string, LiveVarValue>): string | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  // ${cond ? a : b}
  const q = trimmed.indexOf('?');
  const c = q >= 0 ? trimmed.indexOf(':', q) : -1;
  if (q > 0 && c > q) {
    const verdict = evalCondition(trimmed.slice(0, q), values);
    if (verdict === null) return null;
    return verdict ? trimmed.slice(q + 1, c).trim() : trimmed.slice(c + 1).trim();
  }
  // ${expr: …}
  if (trimmed.startsWith('expr:')) {
    const source = trimmed.slice(5).trim();
    const vars = numericValues(values);
    const result = evaluateExpression(source, vars, Object.keys(vars));
    return result === null ? null : formatNumber(result);
  }
  // ${name}
  if (/^[A-Za-z][A-Za-z0-9_]*$/.test(trimmed)) {
    const value = values[trimmed];
    if (value === undefined) return null;
    return typeof value === 'number' ? formatNumber(value) : String(value);
  }
  return null;
}

/** ``${name}`` / ``${expr: …}`` / ``${cond ? a : b}`` 插值；解析不了的原样保留。 */
export function interpolate(text: string, values: Record<string, LiveVarValue>): string {
  if (!text.includes('${')) return text;
  return text.replace(TOKEN, (match, body: string) => evalToken(body, values) ?? match);
}
