/**
 * evaluate.ts —— 按 iSpec 求值：参数归一 → 派生量（可互相引用）→ 约束检查。
 *
 * 关键行为：
 *  - `expressions` 允许后者引用前者，也允许引用更后面的派生量：内部按依赖拓扑求解，
 *    不依赖书写顺序；
 *  - 循环依赖必须检测并给出可读消息（如「循环依赖：det → area → det」），**不做无界递归**；
 *  - 单个派生量求值失败不会抛出、不会整页崩溃：失败的 id 不出现在 `derived` 里，
 *    视图显示「—」，同时通过 `issues` 暴露「派生量 x：第 N 列：未知标识符 y」；
 *  - 约束求值失败（语法错误 / 未知标识符）记为对应 severity 的违规，并说明原因。
 */
import { evaluateAst, isTruthyValue, parseExpression, type ExprValue } from './expr';
import type { ExprNode } from './expr';
import { clampToSpec } from './types';
import type { ISpec, SpecEvaluation, SpecExpression } from './types';

/** 派生量求值过程中遇到的问题（不抛异常，供宿主展示可读提示）。 */
export interface SpecIssue {
  id: string;
  expr: string;
  error: string;
  position?: number;
}

export interface SpecEvaluationDetail {
  evaluation: SpecEvaluation;
  issues: SpecIssue[];
}

interface PreparedExpression {
  spec: SpecExpression;
  ast: ExprNode | null;
  identifiers: string[];
  parseError: string | null;
  parsePosition: number;
}

/** Expressions are immutable per spec; cache their AST across curve sampling. */
const preparedCache = new WeakMap<SpecExpression, PreparedExpression>();

/** 把宿主传入的取值与参数默认值合并，并按 min/max/step 归一。 */
function normalizeValues(spec: ISpec, values: Record<string, ExprValue>): Record<string, ExprValue> {
  const normalized: Record<string, ExprValue> = {};
  for (const parameter of spec.parameters) {
    const provided = values[parameter.id];
    normalized[parameter.id] = clampToSpec(parameter, provided ?? parameter.default);
  }
  return normalized;
}

/**
 * 求值带详细问题列表的版本。
 * 宿主若只需要 `SpecEvaluation`，用 `evaluateSpec` 即可。
 */
export function evaluateSpecWithIssues(
  spec: ISpec,
  values: Record<string, ExprValue>,
): SpecEvaluationDetail {
  const baseValues = normalizeValues(spec, values);
  const issues: SpecIssue[] = [];
  const issueIds = new Set<string>();

  const pushIssue = (issue: SpecIssue): void => {
    if (issueIds.has(issue.id)) return;
    issueIds.add(issue.id);
    issues.push(issue);
  };

  const expressions = spec.expressions ?? [];

  // 1) 预解析：语法错误在求值前就变成可读 issue，不参与依赖求解。
  const prepared = new Map<string, PreparedExpression>();
  for (const expression of expressions) {
    if (prepared.has(expression.id)) {
      pushIssue({
        id: `duplicate:${expression.id}`,
        expr: expression.expr,
        error: `派生量 id 重复：${expression.id}（只采用第一条）`,
      });
      continue;
    }
    const cached = preparedCache.get(expression);
    if (cached) {
      prepared.set(expression.id, cached);
      continue;
    }
    const parsed = parseExpression(expression.expr);
    const entry: PreparedExpression = {
      spec: expression,
      ast: parsed.ok ? parsed.ast : null,
      identifiers: parsed.ok ? parsed.identifiers : [],
      parseError: parsed.ok ? null : parsed.error,
      parsePosition: parsed.ok ? 0 : parsed.position,
    };
    preparedCache.set(expression, entry);
    prepared.set(expression.id, entry);
  }

  const derived: Record<string, ExprValue> = {};
  const state = new Map<string, 'visiting' | 'done'>();
  const failed = new Set<string>();
  const stack: string[] = [];

  /** 返回该派生量是否成功求值；失败时已登记 issue。 */
  const resolve = (id: string): boolean => {
    const status = state.get(id);
    if (status === 'done') return !failed.has(id);

    if (status === 'visiting') {
      // 循环依赖：把环上每个 id 标失败，并给出一条完整路径
      const start = Math.max(0, stack.indexOf(id));
      const cycle = [...stack.slice(start), id];
      const message = `循环依赖：${cycle.join(' → ')}`;
      for (const item of cycle) {
        failed.add(item);
        state.set(item, 'done');
        delete derived[item];
        const target = prepared.get(item);
        pushIssue({ id: item, expr: target?.spec.expr ?? '', error: message });
      }
      return false;
    }

    const preparedExpression = prepared.get(id);
    if (preparedExpression === undefined) return false;

    state.set(id, 'visiting');
    stack.push(id);

    if (preparedExpression.parseError !== null || preparedExpression.ast === null) {
      failed.add(id);
      state.set(id, 'done');
      stack.pop();
      pushIssue({
        id,
        expr: preparedExpression.spec.expr,
        error: `派生量 ${id}：${preparedExpression.parseError ?? '表达式解析失败'}`,
        position: preparedExpression.parsePosition,
      });
      return false;
    }

    // 2) 先解决它引用的其它派生量（拓扑顺序），顺便检测环
    let brokenDependency: string | null = null;
    for (const identifier of preparedExpression.identifiers) {
      if (!prepared.has(identifier)) continue;
      if (!resolve(identifier)) {
        brokenDependency = identifier;
        break;
      }
    }
    if (brokenDependency !== null) {
      failed.add(id);
      state.set(id, 'done');
      stack.pop();
      pushIssue({
        id,
        expr: preparedExpression.spec.expr,
        error: `派生量 ${id}：依赖的派生量 ${brokenDependency} 求值失败`,
      });
      return false;
    }

    // 3) 求值：作用域 = 参数值 + 已解出的派生量（派生量可覆盖同名参数）
    const scope: Record<string, ExprValue> = { ...baseValues, ...derived };
    const result = evaluateAst(preparedExpression.ast, scope, true);
    state.set(id, 'done');
    stack.pop();

    if (!result.ok) {
      failed.add(id);
      pushIssue({
        id,
        expr: preparedExpression.spec.expr,
        error: `派生量 ${id}：${result.error}`,
        position: result.position,
      });
      return false;
    }

    derived[id] = result.value;
    return true;
  };

  for (const expression of expressions) {
    if (!prepared.has(expression.id)) continue;
    resolve(expression.id);
  }

  // 4) 约束：结果的 truthy 判定；NaN 视为不通过，交给约束层统一处理
  const violations: SpecEvaluation['violations'] = [];
  const constraintScope: Record<string, ExprValue> = { ...baseValues, ...derived };
  for (const constraint of spec.constraints ?? []) {
    const severity: 'error' | 'warn' = constraint.severity ?? 'error';
    const parsed = parseExpression(constraint.expr);
    if (!parsed.ok) {
      violations.push({
        expr: constraint.expr,
        message: `约束表达式无效：${parsed.error}`,
        severity,
      });
      continue;
    }
    const result = evaluateAst(parsed.ast, constraintScope);
    if (!result.ok) {
      violations.push({
        expr: constraint.expr,
        message: `约束无法求值：${result.error}`,
        severity,
      });
      continue;
    }
    if (!isTruthyValue(result.value)) {
      violations.push({
        expr: constraint.expr,
        message: constraint.message ?? `约束不通过：${constraint.expr}`,
        severity,
      });
    }
  }

  return {
    evaluation: { values: baseValues, derived, violations },
    issues,
  };
}

/** 契约要求的入口：只返回 `{ values, derived, violations }`。 */
export function evaluateSpec(
  spec: ISpec,
  values: Record<string, ExprValue>,
): SpecEvaluation {
  return evaluateSpecWithIssues(spec, values).evaluation;
}
