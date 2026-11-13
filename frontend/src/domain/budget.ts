/**
 * budget.ts —— `budget_compare` 的前端确定性派生实现（C-BUD@1，plan §2.2.6）
 *
 * 精度策略（重要）：
 *  - 契约要求「金额全程 Decimal，禁止二进制浮点参与金额运算」（R9-AC3）。
 *  - 前端不引入 decimal.js，改用 **BigInt 定点数** 自实现最小十进制算术：
 *    `DecimalValue = { units: bigint, scale: number }`，实际值 = units / 10^scale。
 *    加/减/乘与 quantize(ROUND_HALF_UP) 全部在整数域完成，因此与后端
 *    `decimal.Decimal`（精度 28，ROUND_HALF_UP）在 28 位有效数字内结果一致。
 *  - 只在最后格式化时输出字符串，绝不让 `number` 参与金额运算。
 *
 * 表达式安全（R12-AC2）：只解释 `constant / ref / add / multiply` 四种 AST 节点，
 * 导出字符串**永不**进入 `eval` / `new Function`。
 */
import type {
  AstNode,
  BudgetCompareResult,
  BudgetScenario,
  KnowledgeObject,
  LineSeries,
  Parameter,
  ScenarioId,
} from '@/api/types';
import { domainFail, domainOk, type DomainOutcome } from './matrix';

/** 人数允许范围（§2.2.6 规则 3） */
export const PEOPLE_MIN = 0;
export const PEOPLE_MAX = 2000;
/** 预算上限允许范围（R9-AC6） */
export const BUDGET_LIMIT_MIN = 0;
export const BUDGET_LIMIT_MAX = 1000000;
export const DEFAULT_DISPLAY_PRECISION = 2;
/** 绘图区间上限（与 PEOPLE_MAX 一致，供 LineSeries 使用） */
export const LINE_MAX_PEOPLE = PEOPLE_MAX;

const DECIMAL_PATTERN = /^[+-]?\d+(\.\d+)?$/;

/* -------------------------------------------------------------------------- */
/* 定点十进制                                                                 */
/* -------------------------------------------------------------------------- */

/** 定点十进制：实际值 = units / 10^scale（BigInt，无精度损失）。 */
export interface DecimalValue {
  readonly units: bigint;
  readonly scale: number;
}

const ZERO: DecimalValue = { units: 0n, scale: 0 };

/** 从十进制字符串构造；非法格式返回 null。 */
export function decFromString(input: string): DecimalValue | null {
  const trimmed = input.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) return null;
  const negative = trimmed.startsWith('-');
  const unsigned = trimmed.replace(/^[+-]/, '');
  const dotIndex = unsigned.indexOf('.');
  const intPart = dotIndex === -1 ? unsigned : unsigned.slice(0, dotIndex);
  const fracPart = dotIndex === -1 ? '' : unsigned.slice(dotIndex + 1);
  if (intPart.length + fracPart.length === 0) return null;
  const digits = `${intPart === '' ? '0' : intPart}${fracPart}`;
  const units = BigInt(digits);
  return { units: negative ? -units : units, scale: fracPart.length };
}

/** 从整数构造（人数、上限等只允许整数的场景）。 */
export function decFromInteger(value: number): DecimalValue | null {
  if (!Number.isInteger(value)) return null;
  return { units: BigInt(value), scale: 0 };
}

/** 对齐两个定点数的 scale，返回 [a', b', scale]。 */
function align(a: DecimalValue, b: DecimalValue): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  const aUnits = a.units * 10n ** BigInt(scale - a.scale);
  const bUnits = b.units * 10n ** BigInt(scale - b.scale);
  return [aUnits, bUnits, scale];
}

export function decAdd(a: DecimalValue, b: DecimalValue): DecimalValue {
  const [aUnits, bUnits, scale] = align(a, b);
  return { units: aUnits + bUnits, scale };
}

export function decSub(a: DecimalValue, b: DecimalValue): DecimalValue {
  const [aUnits, bUnits, scale] = align(a, b);
  return { units: aUnits - bUnits, scale };
}

export function decMul(a: DecimalValue, b: DecimalValue): DecimalValue {
  return { units: a.units * b.units, scale: a.scale + b.scale };
}

export function decCompare(a: DecimalValue, b: DecimalValue): -1 | 0 | 1 {
  const [aUnits, bUnits] = align(a, b);
  if (aUnits === bUnits) return 0;
  return aUnits < bUnits ? -1 : 1;
}

export function decIsZero(value: DecimalValue): boolean {
  return value.units === 0n;
}

export function decNegate(value: DecimalValue): DecimalValue {
  return { units: -value.units, scale: value.scale };
}

/** 按 ROUND_HALF_UP（半数远离零）量化到指定小数位。 */
export function decQuantize(value: DecimalValue, digits = 2): DecimalValue {
  const target = Math.max(0, Math.floor(digits));
  const { units, scale } = value;
  if (scale === target) return value;
  if (scale < target) {
    return { units: units * 10n ** BigInt(target - scale), scale: target };
  }
  const divisor = 10n ** BigInt(scale - target);
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const quotient = abs / divisor;
  const remainder = abs % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  return { units: negative ? -rounded : rounded, scale: target };
}

/** 量化为固定小数位的十进制字符串，如 "9400.00" / "-600.00"。 */
export function decToString(value: DecimalValue, digits = 2): string {
  const quantized = decQuantize(value, digits);
  const { units, scale } = quantized;
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const base = 10n ** BigInt(scale);
  const intPart = abs / base;
  const fracPart = abs % base;
  const fracText = scale > 0 ? `.${fracPart.toString().padStart(scale, '0')}` : '';
  const sign = negative && abs !== 0n ? '-' : '';
  return `${sign}${intPart.toString()}${fracText}`;
}

/* -------------------------------------------------------------------------- */
/* AST 校验与求值                                                             */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 把外部 `unknown` 收窄为合法 `AstNode`，递归校验。
 * 出现其他 op、缺少 args、args 非数组 → 返回 `ok:false`（R9-AC7）。
 */
export function parseAstNode(value: unknown): DomainOutcome<AstNode> {
  if (!isRecord(value)) return domainFail('表达式节点不是对象');
  const op = value['op'];
  if (op === 'constant') {
    const constantValue = value['value'];
    if (typeof constantValue !== 'string' || decFromString(constantValue) === null) {
      return domainFail('constant 节点的 value 必须是十进制字符串');
    }
    return domainOk({ op: 'constant', value: constantValue });
  }
  if (op === 'ref') {
    const id = value['parameter_id'];
    if (typeof id !== 'string' || id === '') {
      return domainFail('ref 节点的 parameter_id 必须是非空字符串');
    }
    return domainOk({ op: 'ref', parameter_id: id });
  }
  if (op === 'add' || op === 'multiply') {
    const args = value['args'];
    if (!Array.isArray(args) || args.length === 0) {
      return domainFail(`${op} 节点的 args 必须是非空数组`);
    }
    const parsed: AstNode[] = [];
    for (let index = 0; index < args.length; index += 1) {
      const child = parseAstNode(args[index]);
      if (!child.ok) {
        return domainFail(`${op}.args[${index}] 非法：${child.error}`);
      }
      parsed.push(child.result);
    }
    return domainOk({ op, args: parsed });
  }
  return domainFail(`不支持的表达式操作 op=${String(op)}（只允许 constant / ref / add / multiply）`);
}

export interface AstEvaluationContext {
  /** 参数 id → 原始值（number / string） */
  values: Readonly<Record<string, unknown>>;
  /** 方案 id 或参数 id → 另一段表达式（支持表达式互相引用，需检测循环） */
  expressions?: Readonly<Record<string, AstNode>>;
  /** 当前人数，供 ref 指向 "people" / "n" 时使用 */
  people: number;
  /**
   * "人数类"参数 id 集合（含真实参数 id 如 `people_n`，以及别名）。
   * 求 `at_zero / at_one / at_max` 时这些 id 一律使用 `ctx.people`，
   * 绝不从 `values` 读固定快照 —— 否则曲线会退化成水平线（P0 修复 A）。
   */
  peopleParameterIds?: ReadonlySet<string>;
  /** 递归求值栈：用于循环依赖检测 */
  stack?: readonly string[];
}

export const PEOPLE_REF_ALIASES: readonly string[] = ['people', 'n', 'people_count'] as const;

/** 是否为"人数"引用：固定别名，或调用方声明的人数参数 id（如 fixture 里的 `people_n`）。 */
function isPeopleReference(name: string, ctx: AstEvaluationContext): boolean {
  if (PEOPLE_REF_ALIASES.includes(name)) return true;
  return ctx.peopleParameterIds?.has(name) === true;
}

function resolveRef(name: string, ctx: AstEvaluationContext): DomainOutcome<DecimalValue> {
  const stack = ctx.stack ?? [];
  // 人数类引用一律使用当前扫描的 n，绝不从参数快照中读（P0 修复 A）
  if (isPeopleReference(name, ctx)) {
    const peopleValue = decFromInteger(ctx.people);
    return peopleValue === null
      ? domainFail(`ref ${name} 解析失败：人数 ${ctx.people} 不是整数`)
      : domainOk(peopleValue);
  }

  const raw = ctx.values[name];
  if (raw !== undefined && raw !== null) {
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) return domainFail(`参数 ${name} 的取值不是有限数`);
      // 数值参数（金额）按二进制到十进制的精确短表示转换；整数场景不丢精度
      const parsed = decFromString(String(raw));
      return parsed === null
        ? domainFail(`参数 ${name} 的取值无法转为十进制：${String(raw)}`)
        : domainOk(parsed);
    }
    if (typeof raw === 'string') {
      const parsed = decFromString(raw);
      return parsed === null
        ? domainFail(`参数 ${name} 的取值不是合法的十进制字符串：${raw}`)
        : domainOk(parsed);
    }
    return domainFail(`参数 ${name} 的取值类型不被支持（需要 number 或十进制字符串）`);
  }

  const expression = ctx.expressions?.[name];
  if (expression !== undefined) {
    if (stack.includes(name)) {
      return domainFail(`循环依赖：${[...stack, name].join(' → ')}（${name} 引用了自身所在的表达式链）`);
    }
    return evaluateAst(expression, { ...ctx, stack: [...stack, name] });
  }

  return domainFail(`ref ${name} 指向未定义的参数（未定义 ref）`);
}

/** 解释执行 AST（白名单四节点，安全无 eval）。 */
export function evaluateAst(node: AstNode, ctx: AstEvaluationContext): DomainOutcome<DecimalValue> {
  switch (node.op) {
    case 'constant': {
      const parsed = decFromString(node.value);
      return parsed === null
        ? domainFail(`constant 节点的 value 不是合法十进制字符串：${node.value}`)
        : domainOk(parsed);
    }
    case 'ref':
      return resolveRef(node.parameter_id, ctx);
    case 'add': {
      let total = ZERO;
      for (let index = 0; index < node.args.length; index += 1) {
        const arg = node.args[index];
        if (arg === undefined) continue;
        const evaluated = evaluateAst(arg, ctx);
        if (!evaluated.ok) return domainFail(`add.args[${index}] 求值失败：${evaluated.error}`);
        total = decAdd(total, evaluated.result);
      }
      return domainOk(total);
    }
    case 'multiply': {
      let product: DecimalValue = { units: 1n, scale: 0 };
      for (let index = 0; index < node.args.length; index += 1) {
        const arg = node.args[index];
        if (arg === undefined) continue;
        const evaluated = evaluateAst(arg, ctx);
        if (!evaluated.ok) return domainFail(`multiply.args[${index}] 求值失败：${evaluated.error}`);
        product = decMul(product, evaluated.result);
      }
      return domainOk(product);
    }
    default: {
      // 穷尽检查：新增 op 时 TS 会在此报错
      const exhaustive: never = node;
      return domainFail(`不支持的表达式节点：${JSON.stringify(exhaustive)}`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 方案对比                                                                   */
/* -------------------------------------------------------------------------- */

export interface BudgetInput {
  astA: AstNode;
  astB: AstNode;
  people: number;
  /** 人数类参数 id（含 `people_n` 等真实 id）；缺失时只按固定别名识别 */
  peopleParameterIds?: ReadonlySet<string>;
  /** 上限的十进制字符串；null 表示未设上限（R9-AC5） */
  budgetLimit: string | null;
  scenarioNames?: [string, string];
  /** 供 ref 解析的参数值表 */
  parameterValues?: Readonly<Record<string, unknown>>;
  displayPrecision?: number;
}

function evaluateAt(ast: AstNode, people: number, input: BudgetInput): DomainOutcome<DecimalValue> {
  return evaluateAst(ast, {
    values: input.parameterValues ?? {},
    expressions: { plan_a: input.astA, plan_b: input.astB },
    people,
    ...(input.peopleParameterIds === undefined
      ? {}
      : { peopleParameterIds: input.peopleParameterIds }),
  });
}

function buildScenario(
  scenarioId: ScenarioId,
  name: string,
  ast: AstNode,
  input: BudgetInput,
  digits: number,
): DomainOutcome<{ scenario: BudgetScenario; line: LineSeries; total: DecimalValue }> {
  const atPeople = evaluateAt(ast, input.people, input);
  if (!atPeople.ok) return domainFail(`${name} 表达式求值失败：${atPeople.error}`);
  const atZero = evaluateAt(ast, 0, input);
  if (!atZero.ok) return domainFail(`${name} 在 n=0 处求值失败：${atZero.error}`);
  const atOne = evaluateAt(ast, 1, input);
  if (!atOne.ok) return domainFail(`${name} 在 n=1 处求值失败：${atOne.error}`);
  const atMax = evaluateAt(ast, LINE_MAX_PEOPLE, input);
  if (!atMax.ok) return domainFail(`${name} 在 n=${LINE_MAX_PEOPLE} 处求值失败：${atMax.error}`);

  const total = decQuantize(atPeople.result, digits);
  const slope = decSub(atOne.result, atZero.result);

  return domainOk({
    total,
    scenario: {
      scenario_id: scenarioId,
      name,
      total: decToString(total, digits),
      per_person: decToString(slope, digits),
      fixed: decToString(atZero.result, digits),
    },
    line: {
      scenario_id: scenarioId,
      at_zero: decToString(atZero.result, digits),
      at_max: decToString(atMax.result, digits),
      slope: decToString(slope, digits),
    },
  });
}

/**
 * 两方案预算对比。
 * 输出金额统一为 2 位小数字符串（如 `"9400.00"`），界面展示时用
 * `trimDecimalString` 去掉无意义尾零。
 *
 * 契约未提供参数通道的视图级配置（P1 说明，勿误解为缺陷）：
 *  - 人均成本/固定费来自对象参数，`deriveBudgetCompare` 从不改写它们；
 *  - 预算上限由 `config.budget_limit_parameter_id` 指向的参数给出，缺省为 null（不画预算线），
 *    模板侧的"显示/隐藏预算线"是**纯视图开关**，不改写对象参数、不推进 revision。
 */
export function computeBudget(input: BudgetInput): DomainOutcome<BudgetCompareResult> {
  const digits = Math.max(0, Math.floor(input.displayPrecision ?? DEFAULT_DISPLAY_PRECISION));
  const people = input.people;

  if (!Number.isInteger(people)) {
    return domainFail(`人数 n = ${people} 必须是整数`);
  }
  if (people < PEOPLE_MIN || people > PEOPLE_MAX) {
    return domainFail(`人数 n = ${people} 超出允许范围 ${PEOPLE_MIN} ~ ${PEOPLE_MAX}`);
  }

  let limit: DecimalValue | null = null;
  if (input.budgetLimit !== null) {
    limit = decFromString(input.budgetLimit);
    if (limit === null) {
      return domainFail(`预算上限 ${input.budgetLimit} 不是合法的十进制数`);
    }
    if (limit.scale > 0 && limit.units % 10n ** BigInt(limit.scale) !== 0n) {
      return domainFail(`预算上限 ${input.budgetLimit} 必须是整数`);
    }
    if (decCompare(limit, { units: BigInt(BUDGET_LIMIT_MIN), scale: 0 }) < 0 ||
        decCompare(limit, { units: BigInt(BUDGET_LIMIT_MAX), scale: 0 }) > 0) {
      return domainFail(`预算上限 ${input.budgetLimit} 超出允许范围 ${BUDGET_LIMIT_MIN} ~ ${BUDGET_LIMIT_MAX}`);
    }
  }

  const names = input.scenarioNames ?? ['方案A', '方案B'];
  const builtA = buildScenario('plan_a', names[0] ?? '方案A', input.astA, input, digits);
  if (!builtA.ok) return domainFail(builtA.error);
  const builtB = buildScenario('plan_b', names[1] ?? '方案B', input.astB, input, digits);
  if (!builtB.ok) return domainFail(builtB.error);

  const difference = decSub(builtA.result.total, builtB.result.total);

  let remaining: [string, string] | null = null;
  let overBudget: [boolean, boolean] | null = null;
  if (limit !== null) {
    const remainingA = decQuantize(decSub(limit, builtA.result.total), digits);
    const remainingB = decQuantize(decSub(limit, builtB.result.total), digits);
    remaining = [decToString(remainingA, digits), decToString(remainingB, digits)];
    overBudget = [
      decCompare(remainingA, { units: 0n, scale: 0 }) < 0,
      decCompare(remainingB, { units: 0n, scale: 0 }) < 0,
    ];
  }

  return domainOk({
    inputs: { people },
    scenarios: [builtA.result.scenario, builtB.result.scenario],
    difference: decToString(difference, digits),
    equal: decIsZero(difference),
    budget_limit: limit === null ? null : decToString(limit, Math.max(digits, limit.scale)),
    remaining,
    over_budget: overBudget,
    lines: [builtA.result.line, builtB.result.line],
    display_precision: digits,
  });
}

/* -------------------------------------------------------------------------- */
/* 从 KnowledgeObject 派生                                                    */
/* -------------------------------------------------------------------------- */

const AST_FALLBACK_KEYS: Record<ScenarioId, readonly string[]> = {
  plan_a: ['plan_a', 'a', 'ast_a', 'expression_a'],
  plan_b: ['plan_b', 'b', 'ast_b', 'expression_b'],
};

function pickAst(
  object: KnowledgeObject,
  scenarioId: ScenarioId,
  peopleParameterId: string,
): DomainOutcome<AstNode> {
  // 契约 §2.2.6 未规定 AST 存放的键名，这里按优先级兼容：
  //   1) config.expressions = { plan_a: AstNode, plan_b: AstNode }
  //   2) config.plan_a / config.plan_b（及 a/b、ast_a/ast_b、expression_a/b 等别名）
  //   3) 参数推导：`{plan_a|plan_b}_fixed` + `{plan_a|plan_b}_per_person` × 人数
  //      —— T1 的 fixtures/examples/budget_compare.json 正是这种形态（无内联 AST）
  // 0) 团队裁决（P1）：config.coefficients = { plan_a: { fixed, per_unit }, plan_b: {...} }，金额为十进制字符串
  const coefficients = object.config['coefficients'];
  if (isRecord(coefficients)) {
    const entry = coefficients[scenarioId];
    if (isRecord(entry)) {
      const fixed = entry['fixed'];
      const perUnit = entry['per_unit'];
      if (
        (typeof fixed === 'string' || typeof fixed === 'number') &&
        (typeof perUnit === 'string' || typeof perUnit === 'number')
      ) {
        return domainOk(buildLinearAst(String(fixed), String(perUnit), peopleParameterId));
      }
    }
  }

  const containers: unknown[] = [object.config['expressions'], object.config];
  for (const container of containers) {
    if (!isRecord(container)) continue;
    for (const key of AST_FALLBACK_KEYS[scenarioId]) {
      const raw = container[key];
      if (raw === undefined) continue;
      const parsed = parseAstNode(raw);
      if (!parsed.ok) return domainFail(`${scenarioId} 表达式非法：${parsed.error}`);
      return parsed;
    }
  }
  return deriveAstFromParameters(object, scenarioId, peopleParameterId);
}

/** 由「固定费 + 人均费 × 人数」三个参数推导线性表达式。 */
function deriveAstFromParameters(
  object: KnowledgeObject,
  scenarioId: ScenarioId,
  peopleParameterId: string,
): DomainOutcome<AstNode> {
  const fixedParam = object.parameters.find((item) => item.id === `${scenarioId}_fixed`);
  const perParam = object.parameters.find((item) => item.id === `${scenarioId}_per_person`);
  if (fixedParam === undefined || perParam === undefined) {
    return domainFail(
      `缺少 ${scenarioId} 的方案表达式：config.expressions.${scenarioId} 不存在，且未找到 ${scenarioId}_fixed / ${scenarioId}_per_person 参数`,
    );
  }
  return domainOk({
    op: 'add',
    args: [
      { op: 'ref', parameter_id: fixedParam.id },
      {
        op: 'multiply',
        args: [
          { op: 'ref', parameter_id: perParam.id },
          { op: 'ref', parameter_id: peopleParameterId },
        ],
      },
    ],
  });
}

/** 从 `KnowledgeObject` 派生 `budget_compare` 结果。 */
export function deriveBudgetCompare(object: KnowledgeObject): DomainOutcome<BudgetCompareResult> {
  const limitParamId =
    typeof object.config['budget_limit_parameter_id'] === 'string'
      ? object.config['budget_limit_parameter_id']
      : null;

  // 人数参数：优先 config.people_parameter_id，其次第一个既非上限的 integer 参数
  const configuredPeopleId =
    typeof object.config['people_parameter_id'] === 'string'
      ? object.config['people_parameter_id']
      : null;
  const peopleParam: Parameter | null =
    (configuredPeopleId === null
      ? null
      : (object.parameters.find((item) => item.id === configuredPeopleId) ?? null)) ??
    object.parameters.find(
      (item) => item.type === 'integer' && item.id !== limitParamId,
    ) ??
    null;
  if (peopleParam === null) return domainFail('缺少人数参数（type="integer"）');
  const people = typeof peopleParam.value === 'number' ? peopleParam.value : Number(peopleParam.value);
  if (!Number.isFinite(people)) {
    return domainFail(`参数 ${peopleParam.name}（${peopleParam.id}）的取值不是数字`);
  }

  let budgetLimit: string | null = null;
  if (limitParamId !== null) {
    const limitParam = object.parameters.find((item) => item.id === limitParamId) ?? null;
    if (limitParam !== null) {
      if (typeof limitParam.value === 'string') {
        budgetLimit = limitParam.value;
      } else if (typeof limitParam.value === 'number') {
        budgetLimit = String(limitParam.value);
      }
    }
  }

  const astA = pickAst(object, 'plan_a', peopleParam.id);
  if (!astA.ok) return domainFail(astA.error);
  const astB = pickAst(object, 'plan_b', peopleParam.id);
  if (!astB.ok) return domainFail(astB.error);

  const values: Record<string, unknown> = {};
  for (const parameter of object.parameters) values[parameter.id] = parameter.value;

  // 人数类参数：显式人数参数 + 任何 unit 为"人 / person / people"的参数。
  // 这些 id 出现在表达式里时，at_zero / at_one / at_max 一律用当前 n（P0 修复 A）。
  const peopleParameterIds = new Set<string>([peopleParam.id]);
  for (const parameter of object.parameters) {
    const unit = parameter.unit.trim().toLowerCase();
    if (unit === '人' || unit === 'person' || unit === 'people') {
      peopleParameterIds.add(parameter.id);
    }
  }

  const nameParams = object.parameters.filter((item) => item.type === 'text');
  const scenarioNames: [string, string] = [
    typeof nameParams[0]?.value === 'string' ? nameParams[0].value : '方案A',
    typeof nameParams[1]?.value === 'string' ? nameParams[1].value : '方案B',
  ];

  const rawPrecision = object.config['display_precision'];
  const displayPrecision =
    typeof rawPrecision === 'number' && Number.isFinite(rawPrecision)
      ? Math.min(6, Math.max(0, Math.floor(rawPrecision)))
      : DEFAULT_DISPLAY_PRECISION;

  return computeBudget({
    astA: astA.result,
    astB: astB.result,
    people,
    budgetLimit,
    scenarioNames,
    parameterValues: values,
    peopleParameterIds,
    displayPrecision,
  });
}

/** 模板默认表达式：方案A = 3000 + 80n，方案B = 6000 + 50n。 */
export const BUDGET_TEMPLATE_DEFAULTS = {
  astA: {
    op: 'add',
    args: [
      { op: 'constant', value: '3000' },
      { op: 'multiply', args: [{ op: 'constant', value: '80' }, { op: 'ref', parameter_id: 'people' }] },
    ],
  } as AstNode,
  astB: {
    op: 'add',
    args: [
      { op: 'constant', value: '6000' },
      { op: 'multiply', args: [{ op: 'constant', value: '50' }, { op: 'ref', parameter_id: 'people' }] },
    ],
  } as AstNode,
  people: 80,
} as const;
/* -------------------------------------------------------------------------- */
/* C-UI@1 P1 澄清的冻结签名（§2.2.11，T6 直接 import）                        */
/* -------------------------------------------------------------------------- */

/** 由「固定费 + 人均费 × 人数」构造线性表达式（coefficients 形态使用）。 */
function buildLinearAst(fixed: string, perUnit: string, peopleId: string): AstNode {
  return {
    op: 'add',
    args: [
      { op: 'constant', value: fixed },
      {
        op: 'multiply',
        args: [
          { op: 'constant', value: perUnit },
          { op: 'ref', parameter_id: peopleId },
        ],
      },
    ],
  };
}

/** 非法输入时的安全降级结果。 */
function emptyBudgetResult(): BudgetCompareResult {
  const zeroScenario = (scenarioId: ScenarioId, name: string): BudgetScenario => ({
    scenario_id: scenarioId,
    name,
    total: decToString(ZERO, DEFAULT_DISPLAY_PRECISION),
    per_person: decToString(ZERO, DEFAULT_DISPLAY_PRECISION),
    fixed: decToString(ZERO, DEFAULT_DISPLAY_PRECISION),
  });
  const zeroLine = (scenarioId: ScenarioId): LineSeries => ({
    scenario_id: scenarioId,
    at_zero: decToString(ZERO, DEFAULT_DISPLAY_PRECISION),
    at_max: decToString(ZERO, DEFAULT_DISPLAY_PRECISION),
    slope: decToString(ZERO, DEFAULT_DISPLAY_PRECISION),
  });
  return {
    inputs: { people: 0 },
    scenarios: [zeroScenario('plan_a', '方案A'), zeroScenario('plan_b', '方案B')],
    difference: decToString(ZERO, DEFAULT_DISPLAY_PRECISION),
    equal: true,
    budget_limit: null,
    remaining: null,
    over_budget: null,
    lines: [zeroLine('plan_a'), zeroLine('plan_b')],
    display_precision: DEFAULT_DISPLAY_PRECISION,
  };
}

/** `budget_compare` 派生（签名冻结于 §2.2.11 P1 澄清）。 */
export function calcBudget(object: KnowledgeObject): {
  result: BudgetCompareResult;
  error: string | null;
} {
  const outcome = deriveBudgetCompare(object);
  if (outcome.ok) return { result: outcome.result, error: null };
  return { result: emptyBudgetResult(), error: outcome.error };
}
