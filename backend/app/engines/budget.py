# [legacy] 不再参与主链路，保留为 iSpec 表达式求值器的领域扩展参考（见 backend/legacy/README.md）。
"""``budget_compare`` 确定性内核（C-BUD@1，plan §2.2.6）。

纯函数、无 I/O、不修改入参。返回结构与
``contracts/schemas/template_budget_compare.schema.json`` 的
``BudgetCompareResult`` 逐字一致（snake_case）。

输入形态（C-06 裁决）：

- 系数形态（主路径）::

      coefficients = {
          "plan_a": {"fixed": "3000.00", "per_unit": "80.00"},
          "plan_b": {"fixed": "6000.00", "per_unit": "50.00"},
      }

- 字符串表达式形态（可选）::

      coefficients = {
          "plan_a": {"expression": "3000 + 80 * n"},
          "plan_b": {"expression": "6000 + 50 * n"},
      }
      # 或 coefficients 顶层直接给 "expression_a" / "expression_b"

- AST 形态（C-BUD@1 / C-ENGINE@1）：``coefficients["plan_a"]`` 直接是
  ``{"op": "add", "args": [...]}``，只允许 ``constant`` / ``ref`` / ``add`` /
  ``multiply`` 四种节点（R9-AC7）。

安全边界（R12-AC2）：字符串表达式由内部词法 + 递归下降解析器解释执行，仅支持
``+ - * /``、数字、变量 ``n`` 与括号；**绝不调用** ``eval`` / ``exec`` /
``compile``。解析失败、未知标识符、函数调用、除零、循环依赖与未定义 ref 一律抛
``KernelError(code="MISSING_FIELD")`` 并指明节点。

金额全程 ``decimal.Decimal``（局部上下文精度 28、``ROUND_HALF_UP``），禁止
``float`` 参与金额运算（R9-AC3）。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Context, Decimal, ROUND_HALF_UP, localcontext
from typing import Any

from .types import (
    LINE_MAX_N,
    MAX_BUDGET_LIMIT,
    MAX_PEOPLE,
    KernelError,
    decimal_from,
    format_amount,
)

#: 金额运算上下文（§2.2.6 规则 1）。
_BUDGET_CONTEXT = Context(prec=28, rounding=ROUND_HALF_UP)

#: 方案固定顺序（C-BUD@1：scenarios / remaining / over_budget / lines 一一对应）。
PLAN_IDS = ("plan_a", "plan_b")

#: 方案默认显示名（schema 要求 ``name`` 必填）。
_DEFAULT_PLAN_NAMES = {"plan_a": "方案 A", "plan_b": "方案 B"}

#: 表达式变量的唯一合法标识符（C-06 裁决）。
_VARIABLE_NAME = "n"

#: 人数参数的可能命名：这些 ref 在扫描 n ∈ {0,1,2000} 时必须跟随当前 n，
#: 否则 lines.at_zero / at_max / slope 会被参数表里的固定人数锁死。
_PEOPLE_PARAMETER_NAMES = ("n", "people", "people_n")

#: 允许的 AST 操作白名单（R9-AC7）。
_ALLOWED_OPS = ("constant", "ref", "add", "multiply")


# ---------------------------------------------------------------------------
# 字符串表达式解析器（不使用 eval/exec/compile）
# ---------------------------------------------------------------------------


class _StringExpressionParser:
    """仅支持 ``+ - * /``、数字、变量 ``n`` 与括号的递归下降解析器。

    文法::

        expression := term (('+' | '-') term)*
        term       := factor (('*' | '/') factor)*
        factor     := ('+' | '-') factor | primary
        primary    := NUMBER | 'n' | '(' expression ')'
    """

    def __init__(self, source: str, people: int, owner: str) -> None:
        self._owner = owner
        self._people = people
        self._tokens = self._tokenize(source)
        self._position = 0

    # -- 词法 ---------------------------------------------------------------

    def _tokenize(self, source: str) -> list[tuple[str, str]]:
        tokens: list[tuple[str, str]] = []
        index = 0
        length = len(source)
        while index < length:
            char = source[index]
            if char.isspace():
                index += 1
                continue
            if char.isdigit() or char == ".":
                start = index
                while index < length and (source[index].isdigit() or source[index] == "."):
                    index += 1
                literal = source[start:index]
                if literal.count(".") > 1 or literal == ".":
                    self._fail(f"非法数字 {literal!r}")
                tokens.append(("num", literal))
                continue
            if char.isalpha() or char == "_":
                start = index
                while index < length and (source[index].isalnum() or source[index] == "_"):
                    index += 1
                tokens.append(("ident", source[start:index]))
                continue
            if char in "+-*/()":
                tokens.append(("op", char))
                index += 1
                continue
            # 逗号、方括号、乘方、百分号等一律拒绝（函数调用也会在此或后续解析失败）。
            self._fail(f"不支持字符 {char!r}")
        return tokens

    # -- 语法 ---------------------------------------------------------------

    def parse(self) -> Decimal:
        value = self._expression()
        if self._position != len(self._tokens):
            kind, text = self._tokens[self._position]
            self._fail(f"存在多余内容 {text!r}（{kind}）")
        return value

    def _peek(self) -> tuple[str, str] | None:
        if self._position >= len(self._tokens):
            return None
        return self._tokens[self._position]

    def _advance(self) -> tuple[str, str]:
        token = self._tokens[self._position]
        self._position += 1
        return token

    def _expression(self) -> Decimal:
        value = self._term()
        while True:
            token = self._peek()
            if token and token[0] == "op" and token[1] in ("+", "-"):
                self._advance()
                right = self._term()
                value = value + right if token[1] == "+" else value - right
            else:
                return value

    def _term(self) -> Decimal:
        value = self._factor()
        while True:
            token = self._peek()
            if token and token[0] == "op" and token[1] in ("*", "/"):
                self._advance()
                right = self._factor()
                if token[1] == "*":
                    value = value * right
                else:
                    if right == 0:
                        self._fail("除数为零")
                    value = value / right
            else:
                return value

    def _factor(self) -> Decimal:
        token = self._peek()
        if token and token[0] == "op" and token[1] in ("+", "-"):
            self._advance()
            value = self._factor()
            return -value if token[1] == "-" else value
        return self._primary()

    def _primary(self) -> Decimal:
        token = self._peek()
        if token is None:
            self._fail("表达式不完整")
        self._advance()
        kind, text = token
        if kind == "num":
            return Decimal(text)
        if kind == "ident":
            if text != _VARIABLE_NAME:
                # 函数名、其他变量与未知参数都在这里被拒绝。
                self._fail(f"仅支持变量 {_VARIABLE_NAME}，出现 {text!r}")
            return Decimal(self._people)
        if kind == "op" and text == "(":
            value = self._expression()
            closing = self._peek()
            if closing != ("op", ")"):
                self._fail("括号不匹配")
            self._advance()
            return value
        self._fail(f"意外的记号 {text!r}")

    def _fail(self, reason: str) -> None:
        raise KernelError(
            "MISSING_FIELD",
            f"表达式解析失败：{reason}",
            self._owner,
        ) from None


# ---------------------------------------------------------------------------
# 方案模型与求值上下文
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _Plan:
    """单个方案的线性系数或表达式。"""

    scenario_id: str
    name: str
    expression: str | Mapping[str, Any] | None = None
    fixed: Decimal | None = None
    per_unit: Decimal | None = None


class _Evaluator:
    """在固定人数 ``n`` 下递归求值，带循环依赖检测与缓存。"""

    def __init__(self, plans: Mapping[str, _Plan], parameters: Mapping[str, Any]) -> None:
        self._plans = plans
        self._parameters = parameters
        self._cache: dict[tuple[str, int], Decimal] = {}
        self._stack: list[str] = []

    def plan_total(self, plan_id: str, people: int) -> Decimal:
        key = (plan_id, people)
        if key in self._cache:
            return self._cache[key]
        if plan_id in self._stack:
            raise KernelError(
                "MISSING_FIELD",
                f"命名表达式 {plan_id} 存在循环依赖",
                plan_id,
            )

        plan = self._plans[plan_id]
        self._stack.append(plan_id)
        try:
            if plan.expression is None:
                if plan.fixed is None or plan.per_unit is None:
                    raise KernelError("MISSING_FIELD", f"方案 {plan_id} 缺少系数", plan_id)
                value = plan.fixed + plan.per_unit * Decimal(people)
            else:
                value = self._evaluate(plan.expression, people, plan_id)
        finally:
            self._stack.pop()

        self._cache[key] = value
        return value

    def _evaluate(self, expression: object, people: int, owner: str) -> Decimal:
        if isinstance(expression, str):
            return _StringExpressionParser(expression, people, owner).parse()
        if isinstance(expression, Mapping):
            return self._evaluate_ast(expression, people, owner)
        raise KernelError(
            "MISSING_FIELD",
            f"方案 {owner} 的表达式必须是字符串或 AST 对象",
            owner,
        )

    def _evaluate_ast(self, node: Mapping[str, Any], people: int, owner: str) -> Decimal:
        operation = node.get("op")
        if operation not in _ALLOWED_OPS:
            raise KernelError(
                "MISSING_FIELD",
                f"表达式 {owner} 含不支持的节点 {operation!r}（仅允许 {'/'.join(_ALLOWED_OPS)}）",
                owner,
            )

        if operation == "constant":
            if "value" not in node:
                raise KernelError("MISSING_FIELD", f"表达式 {owner} 的常量缺少 value", owner)
            return decimal_from(node["value"], f"{owner}.constant")

        if operation == "ref":
            parameter_id = node.get("parameter_id")
            if not isinstance(parameter_id, str) or not parameter_id:
                raise KernelError("MISSING_FIELD", f"表达式 {owner} 的 ref 缺少 parameter_id", owner)
            return self._resolve(parameter_id, people, owner)

        arguments = node.get("args")
        if not isinstance(arguments, (list, tuple)) or len(arguments) < 2:
            raise KernelError(
                "MISSING_FIELD",
                f"表达式 {owner} 的 {operation} 节点至少需要两个参数",
                owner,
            )

        if operation == "add":
            total = Decimal(0)
            for argument in arguments:
                total += self._evaluate(argument, people, owner)
            return total

        product = Decimal(1)
        for argument in arguments:
            product *= self._evaluate(argument, people, owner)
        return product

    def _resolve(self, name: str, people: int, owner: str) -> Decimal:
        # 人数变量优先跟随当前 n：lines 需要在 n=0/1/2000 三点扫描同一表达式。
        if name in _PEOPLE_PARAMETER_NAMES and name in self._parameters:
            return Decimal(people)
        # 参数表优先；命名表达式（plan_a / plan_b）作为可递归求值的符号。
        if name in self._parameters:
            return decimal_from(self._parameters[name], f"parameters.{name}")
        if name in self._plans:
            return self.plan_total(name, people)
        raise KernelError(
            "MISSING_FIELD",
            f"表达式 {owner} 引用了未定义的参数 {name}",
            name,
        )


# ---------------------------------------------------------------------------
# 入参校验
# ---------------------------------------------------------------------------


def _parse_people(value: object) -> int:
    """人数必须是 0..2000 的整数（R9-AC1）。"""

    if isinstance(value, bool) or not isinstance(value, int):
        raise KernelError("MISSING_FIELD", f"人数必须是 0 到 {MAX_PEOPLE} 的整数", "people")
    if not 0 <= value <= MAX_PEOPLE:
        raise KernelError("MISSING_FIELD", f"人数必须在 0 到 {MAX_PEOPLE} 之间", "people")
    return value


def _parse_budget_limit(value: object) -> Decimal | None:
    """预算上限：``None`` 或 0..1000000 的整数（R9-AC6）。"""

    if value is None:
        return None
    if isinstance(value, bool):
        raise KernelError("MISSING_FIELD", "预算上限必须是 0 到 1000000 的整数", "budget_limit")
    if isinstance(value, int):
        limit = Decimal(value)
    elif isinstance(value, str):
        limit = decimal_from(value, "budget_limit")
    elif isinstance(value, Decimal):
        limit = value
    else:
        # 金额禁止 float 参与（R9-AC3），这里不为其提供隐式转换。
        raise KernelError("MISSING_FIELD", "预算上限必须是 0 到 1000000 的整数", "budget_limit")

    if not limit.is_finite():
        raise KernelError("MISSING_FIELD", "预算上限必须是有限数值", "budget_limit")
    if limit != limit.to_integral_value():
        raise KernelError("MISSING_FIELD", "预算上限必须是整数", "budget_limit")
    if limit < 0 or limit > MAX_BUDGET_LIMIT:
        raise KernelError("MISSING_FIELD", "预算上限必须在 0 到 1000000 之间", "budget_limit")
    return limit


def _parse_display_precision(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise KernelError("MISSING_FIELD", "display_precision 必须是整数", "display_precision")
    if not 0 <= value <= 6:
        raise KernelError("MISSING_FIELD", "display_precision 必须在 0 到 6 之间", "display_precision")
    return value


def _parse_parameters(value: object) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise KernelError("MISSING_FIELD", "parameters 必须是对象", "parameters")
    return dict(value)


def _parse_plans(coefficients: object) -> dict[str, _Plan]:
    """把系数/表达式/AST 三种形态统一为 ``_Plan``。"""

    if not isinstance(coefficients, Mapping):
        raise KernelError("MISSING_FIELD", "coefficients 必须是对象", "coefficients")

    plans: dict[str, _Plan] = {}
    for plan_id in PLAN_IDS:
        default_name = _DEFAULT_PLAN_NAMES[plan_id]
        expression_key = "expression_a" if plan_id == "plan_a" else "expression_b"

        # C-06 裁决允许在 coefficients 顶层直接给 expression_a / expression_b。
        if coefficients.get(expression_key) is not None:
            plans[plan_id] = _Plan(
                scenario_id=plan_id,
                name=default_name,
                expression=coefficients[expression_key],
            )
            continue

        if plan_id not in coefficients:
            raise KernelError(
                "MISSING_FIELD",
                f"缺少方案 {plan_id} 的系数或表达式",
                plan_id,
            )

        entry = coefficients[plan_id]
        if isinstance(entry, str):
            plans[plan_id] = _Plan(scenario_id=plan_id, name=default_name, expression=entry)
            continue
        if not isinstance(entry, Mapping):
            raise KernelError("MISSING_FIELD", f"方案 {plan_id} 必须是对象或表达式字符串", plan_id)

        raw_name = entry.get("name")
        name = raw_name if isinstance(raw_name, str) and raw_name else default_name

        if entry.get("expression") is not None:
            plans[plan_id] = _Plan(
                scenario_id=plan_id,
                name=name,
                expression=entry["expression"],
            )
            continue
        if "op" in entry:
            plans[plan_id] = _Plan(scenario_id=plan_id, name=name, expression=entry)
            continue
        if "fixed" in entry or "per_unit" in entry:
            plans[plan_id] = _Plan(
                scenario_id=plan_id,
                name=name,
                fixed=decimal_from(entry.get("fixed", "0"), f"{plan_id}.fixed"),
                per_unit=decimal_from(entry.get("per_unit", "0"), f"{plan_id}.per_unit"),
            )
            continue

        raise KernelError(
            "MISSING_FIELD",
            f"方案 {plan_id} 缺少 fixed/per_unit 或表达式",
            plan_id,
        )
    return plans


# ---------------------------------------------------------------------------
# 公开内核
# ---------------------------------------------------------------------------


def budget_compare(
    coefficients: Mapping[str, Any] | None = None,
    n: int | None = None,
    budget_limit: int | str | Decimal | None = None,
    *,
    display_precision: int = 2,
    parameters: Mapping[str, Any] | None = None,
    ast_a: Any = None,
    ast_b: Any = None,
    people: int | None = None,
) -> dict[str, Any]:
    """比较两个方案的预算，返回 ``BudgetCompareResult`` 的 dict 形式。

    主签名（T8 任务裁决）::

        budget_compare({"plan_a": {"fixed": "3000", "per_unit": "80"},
                        "plan_b": {"fixed": "6000", "per_unit": "50"}}, 80, None)

    兼容 C-ENGINE@1 的关键字形态（AST）::

        budget_compare(ast_a=ast_a, ast_b=ast_b, parameters=params,
                       people=80, budget_limit=None)

    :param coefficients: 系数、字符串表达式或 AST 的方案映射。
    :param n: 人数（0..2000 的整数）。
    :param budget_limit: 预算上限（0..1000000 的整数或十进制字符串）；``None`` 表示未设上限。
    :param display_precision: 金额展示小数位（0..6），仅回显。
    :param parameters: 表达式 ``ref`` 可引用的参数表。
    :param ast_a: 兼容 C-ENGINE@1 的 plan_a AST（与 ``coefficients`` 互斥）。
    :param ast_b: 兼容 C-ENGINE@1 的 plan_b AST。
    :param people: 兼容 C-ENGINE@1 的人数关键字（与 ``n`` 等价）。
    :raises KernelError: 人数/上限越界、表达式非法、未定义 ref 或循环依赖。
    """

    # -- 参数归并与兼容 ------------------------------------------------
    if ast_a is not None or ast_b is not None:
        if coefficients is not None:
            raise KernelError(
                "MISSING_FIELD",
                "coefficients 与 ast_a/ast_b 不能同时提供",
                "coefficients",
            )
        if ast_a is None or ast_b is None:
            raise KernelError("MISSING_FIELD", "ast_a 与 ast_b 必须同时提供", "coefficients")
        coefficients = {"plan_a": ast_a, "plan_b": ast_b}

    if coefficients is None:
        raise KernelError("MISSING_FIELD", "缺少方案系数或表达式", "coefficients")

    if n is None:
        n = people
    if n is None:
        raise KernelError("MISSING_FIELD", "缺少人数 n", "people")

    people_value = _parse_people(n)
    limit_value = _parse_budget_limit(budget_limit)
    precision = _parse_display_precision(display_precision)
    parameter_values = _parse_parameters(parameters)

    # -- 求值（局部 Decimal 上下文：precision=28, ROUND_HALF_UP）---------
    with localcontext(_BUDGET_CONTEXT):
        plans = _parse_plans(coefficients)
        evaluator = _Evaluator(plans, parameter_values)

        totals = [evaluator.plan_total(plan_id, people_value) for plan_id in PLAN_IDS]
        fixed_values = [evaluator.plan_total(plan_id, 0) for plan_id in PLAN_IDS]
        slope_values = [
            evaluator.plan_total(plan_id, 1) - evaluator.plan_total(plan_id, 0)
            for plan_id in PLAN_IDS
        ]
        at_max_values = [evaluator.plan_total(plan_id, LINE_MAX_N) for plan_id in PLAN_IDS]
        difference = totals[0] - totals[1]

        if limit_value is None:
            remaining_values: list[Decimal] | None = None
        else:
            remaining_values = [limit_value - total for total in totals]

    scenarios = [
        {
            "scenario_id": plan_id,
            "name": plans[plan_id].name,
            "total": format_amount(totals[index]),
            "per_person": format_amount(slope_values[index]),
            "fixed": format_amount(fixed_values[index]),
        }
        for index, plan_id in enumerate(PLAN_IDS)
    ]

    lines = [
        {
            "scenario_id": plan_id,
            "at_zero": format_amount(fixed_values[index]),
            "at_max": format_amount(at_max_values[index]),
            "slope": format_amount(slope_values[index]),
        }
        for index, plan_id in enumerate(PLAN_IDS)
    ]

    if remaining_values is None:
        remaining: list[str] | None = None
        over_budget: list[bool] | None = None
    else:
        remaining = [format_amount(value) for value in remaining_values]
        over_budget = [value < 0 for value in remaining_values]

    return {
        "inputs": {"people": people_value},
        "scenarios": scenarios,
        "difference": format_amount(difference),
        "equal": difference == 0,
        "budget_limit": None if limit_value is None else format_amount(limit_value),
        "remaining": remaining,
        "over_budget": over_budget,
        "lines": lines,
        "display_precision": precision,
    }


def budget_compare_ast(
    ast_a: Any,
    ast_b: Any,
    parameters: Mapping[str, Any] | None = None,
    people: int | None = None,
    budget_limit: int | str | Decimal | None = None,
    display_precision: int = 2,
) -> dict[str, Any]:
    """C-ENGINE@1 位置参数形态的兼容包装。

    ``budget_compare_ast(ast_a, ast_b, parameters, people, budget_limit, display_precision)``
    与 §2.2.9 的函数签名一一对应，内部转调 :func:`budget_compare`。
    """

    if ast_a is None or ast_b is None:
        raise KernelError("MISSING_FIELD", "ast_a 与 ast_b 必须同时提供", "coefficients")
    if people is None:
        raise KernelError("MISSING_FIELD", "缺少人数 people", "people")
    return budget_compare(
        {"plan_a": ast_a, "plan_b": ast_b},
        people,
        budget_limit,
        display_precision=display_precision,
        parameters=parameters,
    )
