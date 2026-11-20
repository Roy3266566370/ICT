"""活页 checkpoint 判分：复用 ``labs.expr`` 的受控解析，做表达式等价判定。

三种模式：
- ``exact``：宽松文本比对（去空白/标点、小写化）——保持旧行为；
- ``numeric``：两侧都必须是无自由变量的数值，比较收敛差值；
- ``expr``：符号化简差值判零，化简不下结论时用确定性多点采样核对。

判分只回答 correct/reason，不替学生判出答案；解析失败返回可读提示，
不抛异常——错误答案也是合法作答结果。
"""

from __future__ import annotations

import re
from typing import Any

import sympy as sp

from ..labs.expr import CONSTANTS, FUNCTIONS, ExprError, parse_expression, safe_float

GRADING_MODES = {"exact", "expr", "numeric"}

_IDENTIFIER = re.compile(r"[A-Za-z][A-Za-z0-9_]*")
_EXACT_STRIP = re.compile(r"[\s，。,.;；]+")
_REL_TOL = 1e-8
_ABS_TOL = 1e-9
#: 确定性采样池（避开 0/±1，降低巧合命中奇异点的概率）。
_SAMPLE_POOL = (0.37, 1.41, -0.83, 2.17, -1.29, 0.73, 3.01, -2.41)
_SAMPLE_ROUNDS = 5
_MIN_VALID_ROUNDS = 3


def _norm_exact(text: str) -> str:
    return _EXACT_STRIP.sub("", text).lower()


def _candidate_variables(*texts: str) -> tuple[str, ...]:
    known = set(FUNCTIONS) | set(CONSTANTS)
    names: list[str] = []
    for text in texts:
        for match in _IDENTIFIER.finditer(text):
            token = match[0]
            if token not in known and token not in names:
                names.append(token)
    return tuple(names) or ("x",)


def _parse(text: str, variables: tuple[str, ...]) -> sp.Expr:
    return parse_expression(text, variables)


def _numeric_equal(answer: sp.Expr, expected: sp.Expr) -> bool | None:
    """两侧均无自由变量时的数值比对；无法收敛返回 None。"""
    a = safe_float(answer)
    e = safe_float(expected)
    if a is None or e is None:
        return None
    return abs(a - e) <= _ABS_TOL + _REL_TOL * max(1.0, abs(e))


def _sampled_equal(answer: sp.Expr, expected: sp.Expr, symbols: tuple[str, ...]) -> bool | None:
    """确定性多点采样核对；有效采样不足返回 None。"""
    valid = 0
    for round_index in range(_SAMPLE_ROUNDS):
        subs = {
            sp.Symbol(name, real=True): sp.Rational(str(_SAMPLE_POOL[(i + round_index) % len(_SAMPLE_POOL)]))
            for i, name in enumerate(symbols)
        }
        try:
            a_val = complex(answer.evalf(25, subs=subs))
            e_val = complex(expected.evalf(25, subs=subs))
        except Exception:  # noqa: BLE001 - 奇异点/不可求值跳过该轮
            continue
        if abs(a_val.imag) > 1e-9 or abs(e_val.imag) > 1e-9:
            continue
        a_real, e_real = a_val.real, e_val.real
        if not (abs(a_real) < float("inf") and abs(e_real) < float("inf")):
            continue
        valid += 1
        if abs(a_real - e_real) > _ABS_TOL + _REL_TOL * max(1.0, abs(e_real)):
            return False
    return True if valid >= _MIN_VALID_ROUNDS else None


def grade_answer(answer: str, expected: str, mode: str) -> dict[str, Any]:
    """``{correct, reason?}``——mode 不在集合内按 exact 处理。"""
    answer_text = str(answer or "").strip()
    expected_text = str(expected or "").strip()
    if not expected_text:
        return {"correct": False, "reason": "该判分点未配置参考答案，无法判分"}
    if not answer_text:
        return {"correct": False, "reason": "请先写下你的答案"}
    if mode not in GRADING_MODES:
        mode = "exact"

    if mode == "exact":
        correct = _norm_exact(answer_text) == _norm_exact(expected_text)
        return {"correct": correct, "reason": None if correct else "与参考答案不一致"}

    variables = _candidate_variables(answer_text, expected_text)
    try:
        a_expr = _parse(answer_text, variables)
    except ExprError as exc:
        return {"correct": False, "reason": f"你的答案无法解析：{exc}"}
    try:
        e_expr = _parse(expected_text, variables)
    except ExprError as exc:
        return {"correct": False, "reason": f"参考答案无法解析：{exc}（请联系老师修正判分点）"}

    a_syms = {str(s) for s in a_expr.free_symbols}
    e_syms = {str(s) for s in e_expr.free_symbols}

    if mode == "numeric":
        if a_syms or e_syms:
            return {"correct": False, "reason": "该判分点要求纯数值答案，请代入数值后作答"}
        equal = _numeric_equal(a_expr, e_expr)
        if equal is None:
            return {"correct": False, "reason": "数值无法收敛，请检查答案写法"}
        return {"correct": equal, "reason": None if equal else "数值与参考答案不符"}

    # expr：在两侧符号并集上判定等价——漏写变量（x+1 vs 1）会因采样不等被
    # 拒，而 sin²x+cos²x≡1 这类消元等价仍能判对；变量名不同（x vs y）同理
    # 被拒，因为同一变量名在两式中取值不同。
    union_syms = tuple(sorted(a_syms | e_syms))

    if not union_syms:
        equal = _numeric_equal(a_expr, e_expr)
        if equal is not None:
            return {"correct": equal, "reason": None if equal else "数值与参考答案不符"}

    try:
        diff_zero = bool(sp.simplify(a_expr - e_expr) == 0)
    except Exception:  # noqa: BLE001 - 化简失败交给采样核对
        diff_zero = False
    if diff_zero:
        return {"correct": True}

    sampled = _sampled_equal(a_expr, e_expr, union_syms)
    if sampled is True:
        return {"correct": True}
    if sampled is False:
        return {"correct": False, "reason": "表达式与参考答案不等价"}
    return {"correct": False, "reason": "无法确认等价性，请整理为最简形式再提交"}


__all__ = ["GRADING_MODES", "grade_answer"]
