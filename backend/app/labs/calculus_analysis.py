"""Deterministic P1 kernels: limits, Taylor expansion, high-order derivatives, function study."""
from __future__ import annotations

import math
import re
from typing import Any, Mapping, Sequence

import sympy as sp
from sympy.calculus.util import continuous_domain

from .expr import expression_text, number_text, parse_expression, safe_float, to_latex

ANALYSIS_KINDS = ("limit", "taylor", "higher_derivative", "function_study")
MAX_ORDER = 10
_LIMIT_INFINITIES = {
    "oo": sp.oo, "+oo": sp.oo, "inf": sp.oo, "+inf": sp.oo, "∞": sp.oo, "+∞": sp.oo,
    "-oo": -sp.oo, "-inf": -sp.oo, "-∞": -sp.oo,
}
_CLASSIFICATION_LABELS = {
    "minimum": "极小值",
    "maximum": "极大值",
    "inflection": "非极值临界点",
    "undetermined": "未定",
}


def _fmt(value: float | None, digits: int = 6) -> str:
    return number_text(value, digits)


def _parse(raw: Any, variable: str) -> sp.Expr:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("缺少可计算的函数表达式")
    return parse_expression(raw, (variable,))


def _parse_constant(raw: Any) -> float | None:
    try:
        expression = parse_expression(str(raw), ("x",))
    except Exception:  # noqa: BLE001
        return None
    if expression.free_symbols:
        return None
    return safe_float(expression)


def _point_payload(value: Any) -> dict[str, Any]:
    if value is None:
        return {"kind": "undetermined", "value": None, "text": "无法判定"}
    if value is sp.oo:
        return {"kind": "infinite", "sign": 1, "value": None, "text": "+∞"}
    if value is -sp.oo:
        return {"kind": "infinite", "sign": -1, "value": None, "text": "-∞"}
    if value is sp.nan or value is sp.zoo:
        return {"kind": "undetermined", "value": None, "text": "无法判定"}
    if isinstance(value, sp.AccumBounds) or bool(getattr(value, "has", lambda *_: False)(sp.AccumBounds)):
        return {"kind": "does_not_exist", "value": None, "text": "不存在（振荡）"}
    try:
        converted = complex(sp.N(value, 18))
    except Exception:  # noqa: BLE001
        return {"kind": "undetermined", "value": None, "text": "无法判定"}
    if abs(converted.imag) > 1e-9 * max(1.0, abs(converted.real)):
        return {"kind": "does_not_exist", "value": None, "text": "不存在（非实值）"}
    numeric = float(converted.real)
    if not math.isfinite(numeric):
        return {"kind": "undetermined", "value": None, "text": "无法判定"}
    return {"kind": "finite", "value": numeric, "text": str(sp.simplify(value))}


def _limit_at(expression: sp.Expr, variable: sp.Symbol, point: sp.Expr, direction: str | None = None) -> dict[str, Any]:
    try:
        value = sp.limit(expression, variable, point) if direction is None else sp.limit(expression, variable, point, direction)
    except Exception:  # noqa: BLE001
        return {"kind": "undetermined", "value": None, "text": "无法判定"}
    return _point_payload(value)


def _side_domain_defined(domain: sp.Set, point: sp.Expr, side: str) -> bool:
    if domain == sp.S.Reals:
        return True
    if isinstance(domain, sp.Complement):
        excluded = domain.args[1]
        parts = excluded.args if isinstance(excluded, sp.Union) else (excluded,)
        for part in parts:
            if not isinstance(part, sp.Interval) or part.is_empty is True:
                continue
            if part.left < point < part.right:
                return False
            if side == 'right' and part.left <= point < part.right:
                return False
            if side == 'left' and part.left < point <= part.right:
                return False
        return True
    parts = domain.args if isinstance(domain, sp.Union) else (domain,)
    for part in parts:
        if not isinstance(part, sp.Interval) or part.is_empty is True:
            continue
        if side == 'right' and part.left <= point < part.right:
            return True
        if side == 'left' and part.left < point <= part.right:
            return True
    return False


def _real_side_defined(expression: sp.Expr, variable: sp.Symbol, point: sp.Expr) -> dict[str, bool]:
    try:
        domain = continuous_domain(expression, variable, sp.S.Reals)
    except Exception:  # noqa: BLE001
        domain = None
    if domain is not None:
        return {side: _side_domain_defined(domain, point, side) for side in ('left', 'right')}
    result: dict[str, bool] = {}
    for name, sign in (("left", -1), ("right", 1)):
        try:
            value = complex(sp.N(expression.subs(variable, point + sign * sp.Rational(1, 1000)), 18))
            result[name] = abs(value.imag) <= 1e-9 * max(1.0, abs(value.real))
        except Exception:  # noqa: BLE001
            result[name] = False
    return result


def _same_limit(left: Mapping[str, Any], right: Mapping[str, Any]) -> bool:
    if left["kind"] == "infinite" and right["kind"] == "infinite":
        return left.get("sign") == right.get("sign")
    if left["kind"] == "finite" and right["kind"] == "finite":
        try:
            return sp.simplify(sp.sympify(left["text"]) - sp.sympify(right["text"])) == 0
        except Exception:  # noqa: BLE001
            return float(left["value"]) == float(right["value"])
    return left["kind"] == right["kind"] == "does_not_exist"


def _limit_report(model: Mapping[str, Any]) -> dict[str, Any]:
    variable = sp.Symbol(str(model.get("variable") or "x"), real=True)
    expression = _parse(model.get("expression"), str(variable))
    point_raw = model.get("limit_point")
    if point_raw in _LIMIT_INFINITIES:
        point = _LIMIT_INFINITIES[str(point_raw)]
    else:
        point = parse_expression(str(model.get("exact_point", model.get("limit_point_value", 0.0))))
    side = str(model.get("side") or "both")
    if point in (sp.oo, -sp.oo):
        both = _limit_at(expression, variable, point)
        sides = {"left": None, "right": None, "both": both}
    else:
        left = _limit_at(expression, variable, point, "-")
        right = _limit_at(expression, variable, point, "+")
        side_defined = _real_side_defined(expression, variable, point)
        if side_defined.get("left") is False:
            left = {"kind": "undefined", "value": None, "text": "左侧不在实定义域"}
        if side_defined.get("right") is False:
            right = {"kind": "undefined", "value": None, "text": "右侧不在实定义域"}
        if side == "left":
            both = left
        elif side == "right":
            both = right
        elif _same_limit(left, right):
            both = dict(left)
        elif left["kind"] == "undefined" or right["kind"] == "undefined":
            both = {"kind": "does_not_exist", "value": None, "text": "不存在（函数在一侧不在实定义域）"}
        elif left["kind"] == "undetermined" or right["kind"] == "undetermined":
            both = {"kind": "undetermined", "value": None, "text": "无法判定"}
        elif left["kind"] == "infinite" and right["kind"] == "infinite" and left.get("sign") != right.get("sign"):
            both = {"kind": "does_not_exist", "value": None, "text": f"不存在（左极限 {left['text']}，右极限 {right['text']}）"}
        else:
            both = {"kind": "does_not_exist", "value": None, "text": "不存在（左右极限不同）"}
        sides = {"left": left, "right": right, "both": both}
    status = "complete" if both["kind"] in ("finite", "infinite", "does_not_exist", "undefined") else "incomplete"
    if both["kind"] == "finite":
        answer = f"极限为 {both['text']}"
    elif both["kind"] == "infinite":
        direction = ""
        if side != "both" and point not in (sp.oo, -sp.oo):
            direction = f"（{ '左极限' if side == 'left' else '右极限'}）"
        answer = f"极限发散到 {both['text']}，不属于有限极限{direction}"
    elif both["kind"] == "does_not_exist":
        answer = f"极限不存在：{both['text']}"
    elif both["kind"] == "undefined":
        answer = f"该方向极限不存在：{both['text']}"
    else:
        answer = "极限无法判定"
    steps = [
        {
            "id": "substitute",
            "title": "先判断能否直接代入",
            "latex": rf"\lim_{{{to_latex(variable)}\to {to_latex(point)}}} {to_latex(expression)}",
            "detail": "代入后若出现 0/0、∞/∞、∞−∞ 等未定式，需要用等价变形或洛必达/泰勒等方法，而不能把代入失败当作无极限。",
        },
        {
            "id": "sides",
            "title": "分别检查左右极限",
            "latex": r"\lim_{x\to x_0^-}f(x),\quad \lim_{x\to x_0^+}f(x)",
            "detail": (
                f"左极限 {sides['left']['text'] if sides['left'] else '不适用'}；"
                f"右极限 {sides['right']['text'] if sides['right'] else '不适用'}；"
                f"当前所选方向结论：{both['text']}。"
            ),
        },
        {
            "id": "conclusion",
            "title": "判定极限是否存在",
            "latex": rf"\lim f={both['text']}",
            "detail": "有限值才称为极限存在；发到 ±∞ 时写“发散到 ±∞”，左右不同或振荡时写“不存在”。",
        },
    ]
    return {
        "summary": "极限题：先检查直接代入，再比较左右极限，最后区分有限极限、发散与不存在。",
        "answer": answer if status == "complete" else "",
        "answer_value": both["value"] if both["kind"] == "finite" else None,
        "exact": both["text"],
        "approx": None,
        "steps": steps,
        "conditions": [f"研究点 {point_raw}；方向 {side}。"],
        "limitations": ["发散到 ±∞ 不等于极限存在；振荡或左右不一致会明确标为不存在或无法判定。"],
        "limit_point": str(model.get("limit_point")),
        "limit_point_value": safe_float(model.get("limit_point_value")),
        "side": side,
        "left": sides["left"],
        "right": sides["right"],
        "two_sided": both,
        "limit_status": both["kind"],
        "solution_status": status,
        "solution_complete": status == "complete",
        "incomplete_reason": None if status == "complete" else "极限无法判定",
    }


def _numeric_side(expression: sp.Expr, variable: sp.Symbol, point: float, direction: str) -> float | None:
    func = sp.lambdify(variable, expression, modules=["math"])
    last = None
    for exponent in range(1, 9):
        step = 10.0 ** (-exponent)
        probe = point - step if direction == "left" else point + step
        try:
            value = float(func(probe))
        except Exception:  # noqa: BLE001
            continue
        if math.isfinite(value):
            last = value
    return last


def _series_around(expression: sp.Expr, variable: sp.Symbol, center: float | None, span: float = 3.0) -> tuple[dict[str, float], list[dict[str, Any]]]:
    func = sp.lambdify(variable, expression, modules=["math"])
    if center is None:
        low, high = -10.0, 10.0
    else:
        low, high = center - span, center + span
    series: list[dict[str, Any]] = []
    for index in range(240):
        x_value = low + (high - low) * index / 239
        if center is not None and abs(x_value - center) < 1e-9:
            value = None
        else:
            try:
                value = float(func(x_value))
            except Exception:  # noqa: BLE001
                value = None
        if value is not None and not math.isfinite(value):
            value = None
        series.append({"x": x_value, "y": None if value is None else round(value, 6)})
    return {"x_min": low, "x_max": high}, series


def _evaluate_limit(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    variable = sp.Symbol(str(model.get("variable") or "x"), real=True)
    expression = _parse(model.get("expression"), str(variable))
    worked = dict(model)
    worked["side"] = str(params.get("side") or model.get("side") or "both")
    point_override = params.get("point")
    if point_override is not None and model.get("limit_point_value") is not None:
        if float(point_override) != float(model.get("limit_point_value")):
            worked.pop("exact_point", None)
        worked["limit_point_value"] = float(point_override)
        worked["limit_point"] = str(float(point_override))
    report = _limit_report(worked)
    point_value = report["limit_point_value"]
    point_text = report["limit_point"]
    side = str(worked["side"] or report["side"] or "both")
    left = report["left"]
    right = report["right"]
    both = report["two_sided"]
    if point_text in _LIMIT_INFINITIES:
        center = None
        approx = _point_payload(sp.limit(expression, variable, _LIMIT_INFINITIES[point_text]))["value"]
        domain, series = _series_around(expression, variable, None, 10.0)
    else:
        center = float(point_value or 0.0)
        if side == "left":
            approx = _numeric_side(expression, variable, center, "left")
        elif side == "right":
            approx = _numeric_side(expression, variable, center, "right")
        else:
            approx = _numeric_side(expression, variable, center, "right")
        domain, series = _series_around(expression, variable, center)
    exact = both["value"] if both["kind"] == "finite" else None
    error = abs(approx - exact) if approx is not None and exact is not None else None
    frames = []
    if center is not None:
        for index, exponent in enumerate(range(1, 9)):
            step = 10.0 ** (-exponent)
            values = {}
            for direction, sign in (("left", -1), ("right", 1)):
                try:
                    value = float(sp.lambdify(variable, expression, "math")(center + sign * step))
                except Exception:  # noqa: BLE001
                    value = None
                values[direction] = None if value is None or not math.isfinite(value) else round(value, 10)
            frames.append({
                "index": index,
                "label": f"h=1e-{exponent}",
                "detail": f"左 {_fmt(values['left'])} · 右 {_fmt(values['right'])}",
                "values": {"h": step, **values},
            })
    checks = [
        {
            "id": "left_right",
            "label": "左右极限核对",
            "status": "pass" if both["kind"] in ("finite", "infinite", "does_not_exist") else "fail",
            "detail": (
                f"左极限 {left['text'] if left else '不适用'}，右极限 {right['text'] if right else '不适用'}；"
                f"双侧结论 {both['text']}。"
            ),
        },
        {
            "id": "numeric",
            "label": "数值逼近核对",
            "status": "pass" if error is not None and error <= 0.02 * max(1.0, abs(exact or 0)) else "warn",
            "detail": f"数值估计 {_fmt(approx)}，解析 {_fmt(exact)}，差 {_fmt(error)}；数值实验不替代符号极限。",
        },
    ]
    metrics = [
        {"id": "left", "label": "左极限", "value": left["text"] if left else "—", "accent": side == "left"},
        {"id": "right", "label": "右极限", "value": right["text"] if right else "—", "accent": side == "right"},
        {"id": "both", "label": "双侧极限", "value": both["text"], "accent": side == "both"},
        {"id": "approx", "label": "数值估计", "value": _fmt(approx)},
    ]
    headline = f"lim {variable}→{point_text} f = {both['text']}"
    return {
        "subject": "calculus",
        "task": "limit",
        "kind": "limit",
        "params": {"point": center if center is not None else 0.0, "side": side},
        "headline": headline,
        "metrics": metrics,
        "checks": checks,
        "notes": ["极限结论来自符号单侧极限；数值逼近只用于核对。"],
        "series": series,
        "domain": domain,
        "rects": [],
        "exact": exact,
        "approx": approx,
        "error": error,
        "answerText": both["text"],
        "trace": frames,
        "limit": {
            "point": center,
            "side": side,
            "left": left,
            "right": right,
            "value": both,
            "status": both["kind"],
        },
    }


def _taylor_report(model: Mapping[str, Any]) -> dict[str, Any]:
    from .taylor_analysis import taylor_report
    return taylor_report(model)


def _taylor_answer(report: Mapping[str, Any]) -> str:
    variable,point,order=report['variable'],report['point'],report['order']
    polynomial_text=str(report['polynomial']).replace('**','^')
    return f"P_{order}({variable})={polynomial_text}（在 {variable}={point} 处展开；余项 {report['remainder_text']}）"


def _solve_taylor(model: Mapping[str, Any]) -> dict[str, Any]:
    report = _taylor_report(model)
    if report["status"] != "complete":
        return {
            "summary": report["reason"],
            "answer": "",
            "answer_value": None,
            "steps": [],
            "conditions": [],
            "limitations": [report["reason"]],
            "solution_status": report["status"],
            "solution_complete": False,
            "incomplete_reason": report["reason"],
        }
    answer = _taylor_answer(report)
    coefficients = [
        {"order": index, "value": str(coefficient)}
        for index, coefficient in enumerate(report["coefficients"])
    ]
    return {
        "summary": "泰勒展开：核对原式定义域、精确系数与余项，再单独说明观察范围与误差保证。",
        "answer": answer,
        "answer_value": safe_float(report["limit_value"]["value"]),
        "exact": str(report["polynomial"]).replace("**", "^"),
        "exact_latex": to_latex(report["polynomial"]),
        "taylor_details": report["details"],
        "approx": None,
        "steps": [
            {
                "id": "point",
                "title": "确认展开点与阶数",
                "latex": rf"a={to_latex(report['point'])},\quad n={report['order']}",
                "detail": "展开点必须在函数的实定义域内且具有有限极限。",
            },
            {
                "id": "coefficients",
                "title": "求各阶系数",
                "latex": r"c_k=\frac{f^{(k)}(x_0)}{k!}",
                "detail": "；".join(f"c_{k}={c}" for k, c in enumerate(report["coefficients"])),
            },
            {
                "id": "polynomial",
                "title": "写出多项式与余项",
                "latex": report['details']['relation_latex'],
                "detail": answer,
            },
        ],
        "conditions": [f"在 {report['variable']}={report['point']} 处展开到 {report['order']} 阶。"],
        "limitations": ["泰勒多项式只在展开点附近逼近函数；余项阶不保证整个定义域内一致精度。"],
        "taylor_point": str(report["point"]),
        "taylor_point_value": safe_float(report["point"]),
        "order": report["order"],
        "coefficients": coefficients,
        "polynomial": str(report["polynomial"]).replace("**", "^"),
        "remainder_order": report["order"] if report["remainder_kind"] == "little_o" else report["order"] + 1,
        "solution_status": "complete",
        "solution_complete": True,
    }


def _evaluate_taylor(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    order = int(params.get("order", model.get("order", 3)))
    point = float(params.get("point", model.get("taylor_point_value", 0.0)))
    worked = {**model, "order": order, "taylor_point": str(point), "taylor_point_value": point}
    if point == (model.get("defaults") or {}).get("point"):
        worked["taylor_point"] = model.get("taylor_point", str(point))
    report = _taylor_report(worked)
    variable = report["variable"]
    expression = report["expression"]
    if report["status"] != "complete":
        exact = None
        series = _series_around(expression, variable, float(report["point"]))[1]
        return {
            "subject": "calculus", "task": "taylor", "kind": "taylor",
            "params": {"order": int(model.get("order", 3)), "point": float(report["point"])},
            "headline": report["reason"],
            "metrics": [
                {"id": "order", "label": "展开阶数", "value": str(report["order"])},
                {"id": "polynomial", "label": "展开式", "value": "—"},
            ],
            "checks": [{"id": "expansion", "label": "泰勒展开完成", "status": "fail", "detail": report["reason"]}],
            "notes": [report["reason"]], "series": series,
            "domain": {"x_min": float(report["point"]) - 3, "x_max": float(report["point"]) + 3},
            "rects": [], "exact": exact, "approx": None, "error": None,
            "answerText": "", "trace": [],
            "taylor": {"point": float(report["point"]), "order": report["order"], "coefficients": [], "polynomial": "", "overlay": [], "max_error": None},
        }
    func = sp.lambdify(variable, expression, modules=["math"])
    polynomial_func = sp.lambdify(variable, report["polynomial"], modules=["math"])
    center = float(report["point"])
    domain, series = _series_around(expression, variable, center, float(report["radius"]))
    overlay: list[dict[str, Any]] = []
    errors: list[float] = []
    for index in range(240):
        x_value = domain["x_min"] + (domain["x_max"] - domain["x_min"]) * index / 239
        try:
            value = float(polynomial_func(x_value))
        except Exception:  # noqa: BLE001
            value = None
        overlay.append({"x": x_value, "y": None if value is None or not math.isfinite(value) else round(value, 6)})
        if abs(x_value - center) > 1e-6:
            try:
                target = float(func(x_value))
                if math.isfinite(target) and value is not None and math.isfinite(value):
                    errors.append(abs(target - value))
            except Exception:  # noqa: BLE001
                pass
    max_error = max(errors) if errors else None
    frames = []
    try:
        for k in range(1, report["order"] + 1):
            partial = sp.simplify(sum(c * (variable - report["point"]) ** i for i, c in enumerate(report["coefficients"][: k + 1])))
            partial_func = sp.lambdify(variable, partial, "math")
            partial_error = 0.0
            count = 0
            for sample in [center + float(report["radius"])*delta for delta in (-1, -0.5, 0.5, 1)]:
                try:
                    a, b = float(func(sample)), float(partial_func(sample))
                    if math.isfinite(a) and math.isfinite(b):
                        partial_error = max(partial_error, abs(a - b))
                        count += 1
                except Exception:  # noqa: BLE001
                    continue
            frames.append({
                "index": k - 1, "label": f"n={k}",
                "detail": f"样本最大偏差 {_fmt(partial_error if count else None)}",
                "values": {"order": k, "error": round(partial_error, 8) if count else None},
            })
    except Exception:  # noqa: BLE001
        frames = []
    coefficients = [safe_float(c) for c in report["coefficients"]]
    return {
        "subject": "calculus", "task": "taylor", "kind": "taylor",
        "params": {"order": report["order"], "point": center},
        "headline": f"在 x={center:g} 处展开到 {report['order']} 阶",
        "metrics": [
            {"id": "order", "label": "展开阶数", "value": str(report["order"]), "accent": True},
            {"id": "polynomial", "label": "泰勒多项式", "value": str(report["polynomial"])},
            {"id": "max_error", "label": "观察区间样本最大偏差", "value": _fmt(max_error)},
            {"id": "coefficients", "label": "系数个数", "value": str(len(report["coefficients"]))},
        ],
        "checks": [
            {"id": "expansion", "label": "系数全部求出", "status": "pass", "detail": "各阶导数在展开点均有有限极限。"},
            {"id": "error", "label": "样本误差（非上界）", "status": "warn",
             "detail": f"观察区间抽样最大偏差 {_fmt(max_error)}；样本误差不保证整个区间精度，误差上界以原题结果中单独核验的信息为准。"},
        ],
        "notes": ["实线为原函数，虚线为泰勒多项式；改变阶数观察局部逼近。"],
        "series": series, "domain": domain, "rects": [],
        "exact": None, "approx": None, "error": max_error,
        "answerText": str(report["polynomial"]),
        "trace": frames,
        "taylor": {
            "point": center, "order": report["order"],
            "coefficients": coefficients, "polynomial": str(report["polynomial"]).replace("**", "^"),
            "overlay": overlay, "max_error": max_error,
        },
    }


def _same_real_limit(left: sp.Expr, right: sp.Expr) -> bool:
    if left in (sp.oo, -sp.oo) or right in (sp.oo, -sp.oo):
        return left == right
    try:
        left_value = complex(sp.N(left, 18))
        right_value = complex(sp.N(right, 18))
    except Exception:  # noqa: BLE001
        return False
    return abs(left_value - right_value) <= 1e-9 * max(1.0, abs(left_value))


def _derivative_report(model: Mapping[str, Any]) -> dict[str, Any]:
    variable = sp.Symbol(str(model.get("variable") or "x"), real=True)
    expression = _parse(model.get("expression"), str(variable))
    order = max(1, min(MAX_ORDER, int(model.get("order", 1))))
    try:
        derivative = sp.simplify(sp.diff(expression, variable, order))
    except Exception as exc:  # noqa: BLE001
        return {"status": "incomplete", "reason": f"高阶导数未能求出：{exc}", "variable": variable, "expression": expression, "order": order}
    if derivative.has(sp.DiracDelta) or derivative.has(sp.Derivative):
        return {
            "status": "unsupported",
            "reason": "该函数的高阶导数包含分布项或未完成求导，当前只支持普通可导函数",
            "variable": variable, "expression": expression, "order": order,
        }
    point = model.get("derivative_point")
    point_value = None
    if point is not None:
        point = parse_expression(str(point))
        try:
            original = parse_expression(str(model['expression']), (str(variable),), preserve_structure=True)
            if continuous_domain(original, variable, sp.S.Reals).contains(point) is not sp.S.true:
                raise ValueError('求值点不在原式已确认的实定义域内')
            side_domain = _real_side_defined(original, variable, point)
            if not side_domain.get('left') or not side_domain.get('right'):
                raise ValueError('该点在原式只有单侧实邻域，不能按双侧普通导数判定')
            previous = original
            for level in range(order):
                quotient = (previous - previous.subs(variable, point))/(variable-point)
                left = sp.limit(quotient, variable, point, '-')
                right = sp.limit(quotient, variable, point, '+')
                if safe_float(left) is None or safe_float(right) is None or sp.simplify(left-right) != 0:
                    raise ValueError('该点相应阶双侧普通导数无法确认存在')
                previous = sp.diff(previous, variable)
        except (ValueError, NotImplementedError, TypeError) as exc:
            return {'status': 'unsupported', 'reason': str(exc), 'variable': variable, 'expression': expression, 'order': order}

        try:
            left_limit = sp.limit(derivative, variable, point, "-")
            right_limit = sp.limit(derivative, variable, point, "+")
        except Exception:  # noqa: BLE001
            left_limit = right_limit = None
        if left_limit is None or right_limit is None or not _same_real_limit(left_limit, right_limit):
            return {
                "status": "incomplete",
                "reason": "该点导数不存在或左右导数不一致，不能把高阶导数代入值当作答案",
                "variable": variable, "expression": expression, "order": order,
            }
        try:
            point_value = safe_float(sp.simplify(derivative.subs(variable, point)))
        except Exception:  # noqa: BLE001
            point_value = None
        if point_value is None:
            return {"status": "incomplete", "reason": "高阶导数在该点不是有限实数", "variable": variable, "expression": expression, "order": order}
    return {
        "status": "complete", "variable": variable, "expression": expression,
        "order": order, "derivative": derivative, "point": point, "point_value": point_value,
    }


def _solve_higher_derivative(model: Mapping[str, Any]) -> dict[str, Any]:
    report = _derivative_report(model)
    variable = str(model.get("variable") or "x")
    if report["status"] != "complete":
        return {
            "summary": report["reason"], "answer": "", "answer_value": None, "steps": [],
            "conditions": [], "limitations": [report["reason"]],
            "solution_status": report["status"], "solution_complete": False,
            "incomplete_reason": report["reason"],
        }
    order = report["order"]
    derivative_text = str(report["derivative"]).replace("**", "^")
    point = report.get("point")
    value = report.get("point_value")
    answer = f"f^({order})({variable})={derivative_text}"
    if point is not None:
        answer += f"；f^({order})({point})={sp.simplify(report['derivative'].subs(report['variable'], point))}"
    return {
        "summary": "高阶导数：对原函数连续求导指定阶数，并可在给定点取值。",
        "answer": answer,
        "answer_value": value,
        "exact": derivative_text.replace("**", "^"),
        "exact_latex": to_latex(report["derivative"]) if point is None else to_latex(sp.simplify(report["derivative"].subs(report["variable"], point))),
        "approx": None,
        "steps": [
            {"id": "order", "title": "确认阶数", "latex": rf"n={order}", "detail": "阶数必须来自原题，不从一次导数外推。"},
            {"id": "differentiate", "title": "逐阶求导", "latex": rf"\frac{{d^{{{order}}}}}{{d{to_latex(sp.Symbol(variable))}^{{{order}}}}}{to_latex(report['expression'])}={to_latex(report['derivative'])}", "detail": "使用符号求导，未展开成数值差分。"},
        ],
        "conditions": [f"对 {variable} 求 {order} 阶导数。"],
        "limitations": ["参数方程与反函数高阶导数暂未纳入本任务；仅支持显式函数，导数公式只在原式相应阶可导处适用。"],
        "derivative_order": order,
        "derivative_expression": derivative_text,
        "derivative_point": None if point is None else str(point),
        "derivative_value": value,
        "solution_status": "complete",
        "solution_complete": True,
    }


def _evaluate_higher_derivative(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    worked = {**model, "order": int(params.get("order", model.get("order", 1)))}
    if params.get("point") is not None and params.get("point") != (model.get("defaults") or {}).get("point"):
        worked["derivative_point"] = str(params.get("point"))
    report = _derivative_report(worked)
    variable = report["variable"]
    expression = report["expression"]
    point = report.get("point")
    center = float(point) if point is not None else 0.0
    domain, series = _series_around(expression, variable, center if point is not None else None)
    if report["status"] != "complete":
        return {
            "subject": "calculus", "task": "higher_derivative", "kind": "higher_derivative",
            "params": {"order": report["order"]}, "headline": report["reason"],
            "metrics": [{"id": "order", "label": "导数阶数", "value": str(report["order"])}],
            "checks": [{"id": "derivative", "label": "高阶导数完成", "status": "fail", "detail": report["reason"]}],
            "notes": [report["reason"]], "series": series, "domain": domain, "rects": [],
            "exact": None, "approx": None, "error": None, "answerText": "", "trace": [],
            "higher": {"order": report["order"], "point": float(point) if point is not None else None, "value": None, "expression": ""},
        }
    approx = None
    if point is not None:
        try:
            import mpmath as mp
            func = sp.lambdify(variable, expression, "mpmath")
            approx = float(mp.diff(func, mp.mpf(str(point)), report["order"]))
            if not math.isfinite(approx):
                approx = None
        except Exception:  # noqa: BLE001
            approx = None
    exact = report.get("point_value")
    error = abs(approx - exact) if approx is not None and exact is not None else None
    derivative_text = str(report["derivative"]).replace("**", "^")
    return {
        "subject": "calculus", "task": "higher_derivative", "kind": "higher_derivative",
        "params": {"order": report["order"], "point": center},
        "headline": f"f^({report['order']})({variable})={derivative_text}",
        "metrics": [
            {"id": "order", "label": "导数阶数", "value": str(report["order"]), "accent": True},
            {"id": "expression", "label": "导函数", "value": derivative_text},
            {"id": "value", "label": "指定点导数值", "value": _fmt(exact)},
            {"id": "numeric", "label": "数值差分参照", "value": _fmt(approx)},
        ],
        "checks": [
            {"id": "derivative", "label": "高阶导数闭合", "status": "pass", "detail": "导函数为有限初等表达式。"},
            {"id": "numeric", "label": "数值差分核对", "status": "pass" if error is not None and error <= 0.05 * max(1.0, abs(exact or 0)) else "warn",
             "detail": f"符号值 {_fmt(exact)}，数值差分参照 {_fmt(approx)}；高阶差分误差通常大于低阶。"},
        ],
        "notes": ["曲线为原函数；数值差分只用于核对，不替代符号求导。"],
        "series": series, "domain": domain, "rects": [],
        "exact": exact, "approx": approx, "error": error,
        "answerText": derivative_text,
        "trace": [{"index": 0, "label": f"n={report['order']}", "detail": f"f^({report['order']})={report['derivative']}", "values": {"order": report["order"]}}],
        "higher": {
            "order": report["order"], "point": float(point) if point is not None else None,
            "value": exact, "expression": derivative_text,
        },
    }


# ---------------------------------------------------------------------------
# 函数区间研究
# ---------------------------------------------------------------------------


def _interval_components(domain: sp.Set) -> list[tuple[sp.Expr, sp.Expr, bool, bool]] | None:
    if isinstance(domain, sp.Interval):
        return [(domain.start, domain.end, bool(domain.left_open), bool(domain.right_open))]
    if isinstance(domain, sp.Union):
        result: list[tuple[sp.Expr, sp.Expr, bool, bool]] = []
        for part in domain.args:
            found = _interval_components(part)
            if found is None:
                return None
            result.extend(found)
        return sorted(result, key=lambda item: float(sp.N(item[0])))
    if domain is sp.S.Reals:
        return [(-sp.oo, sp.oo, True, True)]
    return None


def _finite_roots(expression: sp.Expr, variable: sp.Symbol, domain: sp.Set) -> tuple[list[sp.Expr], bool]:
    if expression == 0:
        return [], True
    try:
        roots = sp.solveset(expression, variable, domain=domain)
    except Exception:  # noqa: BLE001
        return [], False
    if roots is sp.S.EmptySet:
        return [], True
    if isinstance(roots, sp.FiniteSet):
        values = []
        complete = True
        for value in roots:
            if value.is_real is True:
                values.append(sp.simplify(value))
            elif value.is_real is None:
                complete = False
        return values, complete
    return [], False


def _sample_point(low: sp.Expr, high: sp.Expr) -> sp.Expr:
    if low is -sp.oo:
        return high - 1 if high is not sp.oo else sp.Integer(0)
    if high is sp.oo:
        return low + 1
    return sp.simplify((low + high) / 2)


def _sign_at(expression: sp.Expr, variable: sp.Symbol, point: sp.Expr) -> int | None:
    try:
        value = sp.N(expression.subs(variable, point), 18)
        converted = complex(value)
        if not math.isfinite(converted.real) or abs(converted.imag) > 1e-9:
            return None
        numeric = float(converted.real)
        if abs(numeric) < 1e-10:
            return 0
        return 1 if numeric > 0 else -1
    except Exception:  # noqa: BLE001
        return None


def _format_bound(value: sp.Expr) -> str:
    if value is sp.oo:
        return "+∞"
    if value is -sp.oo:
        return "-∞"
    if isinstance(value, sp.Rational) and value.q > 1000:
        return f"{float(sp.N(value)):.6g}"
    return str(value)


def _interval_label(low: sp.Expr, high: sp.Expr) -> str:
    return f"({_format_bound(low)}, {_format_bound(high)})"


def _study_report(model: Mapping[str, Any]) -> dict[str, Any]:
    if model.get("manual_study"):
        from .interval_study import interval_study_report
        return interval_study_report(model)
    variable = sp.Symbol(str(model.get("variable") or "x"), real=True)
    expression = _parse(model.get("expression"), str(variable))
    lower = model.get("study_lower")
    upper = model.get("study_upper")
    if lower is not None and upper is not None:
        study_domain: sp.Set = sp.Interval(sp.Rational(str(lower)), sp.Rational(str(upper)))
    else:
        study_domain = sp.S.Reals
    try:
        domain = continuous_domain(expression, variable, study_domain)
    except Exception as exc:  # noqa: BLE001
        return {"status": "incomplete", "reason": f"函数定义域分析失败：{exc}"}
    components = _interval_components(domain)
    if components is None:
        return {"status": "incomplete", "reason": "函数定义域包含周期族或未确定的缺口，暂不能给出完整区间分解"}
    derivative = sp.simplify(sp.diff(expression, variable))
    second = sp.simplify(sp.diff(expression, variable, 2))
    derivative_zero = derivative == 0
    second_zero = second == 0
    complete = True
    monotonic: list[dict[str, Any]] = []
    concavity: list[dict[str, Any]] = []
    extrema: list[dict[str, Any]] = []
    inflections: list[dict[str, Any]] = []
    vertical: list[str] = []
    horizontal: list[str] = []
    oblique: list[str] = []
    vertical_values: list[float] = []
    horizontal_values: list[float] = []

    for start, end, left_open, right_open in components:
        component_domain = sp.Interval(start, end, left_open, right_open)
        first_roots, first_complete = _finite_roots(derivative, variable, component_domain)
        second_roots, second_complete = _finite_roots(second, variable, component_domain)
        first_roots = [
            root for root in first_roots
            if sp.simplify(root - start) != 0 and sp.simplify(root - end) != 0
        ]
        second_roots = [
            root for root in second_roots
            if sp.simplify(root - start) != 0 and sp.simplify(root - end) != 0
        ]
        complete = complete and first_complete and second_complete
        first_cuts = sorted({*first_roots}, key=lambda value: float(sp.N(value)))
        first_boundaries = [start, *first_cuts, end]
        first_signs: list[int | None] = []
        for index in range(len(first_boundaries) - 1):
            low, high = first_boundaries[index], first_boundaries[index + 1]
            if sp.simplify(high - low) == 0:
                first_signs.append(None)
                continue
            sample = _sample_point(low, high)
            sign = _sign_at(derivative, variable, sample) if sample > low and sample < high else None
            if sign is None or (sign == 0 and not derivative_zero):
                complete = False
            first_signs.append(sign)
            if sign == 1:
                monotonic.append({"kind": "increasing", "label": "单调递增", "interval": _interval_label(low, high), "from": float(sp.N(low)) if low is not -sp.oo else None, "to": float(sp.N(high)) if high is not sp.oo else None})
            elif sign == -1:
                monotonic.append({"kind": "decreasing", "label": "单调递减", "interval": _interval_label(low, high), "from": float(sp.N(low)) if low is not -sp.oo else None, "to": float(sp.N(high)) if high is not sp.oo else None})
        for index, cut in enumerate(first_cuts):
            left_sign = first_signs[index] if index < len(first_signs) else None
            right_sign = first_signs[index + 1] if index + 1 < len(first_signs) else None
            if left_sign is not None and right_sign is not None and left_sign * right_sign < 0:
                try:
                    value = sp.simplify(expression.subs(variable, cut))
                except Exception:  # noqa: BLE001
                    value = None
                classification = "maximum" if left_sign > 0 else "minimum"
                extrema.append({
                    "point": str(cut), "value": str(value) if value is not None else "—",
                    "classification": classification, "label": _CLASSIFICATION_LABELS[classification],
                })

        second_cuts = sorted({*second_roots}, key=lambda value: float(sp.N(value)))
        second_boundaries = [start, *second_cuts, end]
        second_signs: list[int | None] = []
        for index in range(len(second_boundaries) - 1):
            low, high = second_boundaries[index], second_boundaries[index + 1]
            if sp.simplify(high - low) == 0:
                second_signs.append(None)
                continue
            sample = _sample_point(low, high)
            sign = _sign_at(second, variable, sample) if sample > low and sample < high else None
            if sign is None or (sign == 0 and not second_zero):
                complete = False
            second_signs.append(sign)
            if sign == 1:
                concavity.append({"kind": "concave_up", "label": "凹向上", "interval": _interval_label(low, high)})
            elif sign == -1:
                concavity.append({"kind": "concave_down", "label": "凹向下", "interval": _interval_label(low, high)})
        for index, cut in enumerate(second_cuts):
            left_sign = second_signs[index] if index < len(second_signs) else None
            right_sign = second_signs[index + 1] if index + 1 < len(second_signs) else None
            if left_sign is not None and right_sign is not None and left_sign * right_sign < 0:
                try:
                    value = sp.simplify(expression.subs(variable, cut))
                except Exception:  # noqa: BLE001
                    value = None
                if value is not None:
                    inflections.append({"point": str(cut), "value": str(value)})

    for start, end, left_open, right_open in components:
        if left_open and start is not -sp.oo:
            candidate = start
            try:
                left_value = sp.limit(expression, variable, candidate, "-")
            except Exception:  # noqa: BLE001
                left_value = None
            if left_value in (sp.oo, -sp.oo):
                vertical.append(f"x={candidate}")
                value = safe_float(candidate)
                if value is not None:
                    vertical_values.append(value)
        if right_open and end is not sp.oo:
            candidate = end
            try:
                right_value = sp.limit(expression, variable, candidate, "+")
            except Exception:  # noqa: BLE001
                right_value = None
            if right_value in (sp.oo, -sp.oo):
                vertical.append(f"x={candidate}")
                value = safe_float(candidate)
                if value is not None:
                    vertical_values.append(value)
    sides = []
    if any(component[0] is -sp.oo for component in components):
        sides.append(-sp.oo)
    if any(component[1] is sp.oo for component in components):
        sides.append(sp.oo)
    for side in sides:
        try:
            limit_value = sp.limit(expression, variable, side)
        except Exception:  # noqa: BLE001
            complete = False
            continue
        if safe_float(limit_value) is not None:
            if sp.simplify(expression - limit_value) != 0:
                horizontal.append(f"y={limit_value}")
                value = safe_float(limit_value)
                if value is not None:
                    horizontal_values.append(value)
        elif limit_value in (sp.oo, -sp.oo):
            try:
                slope = sp.limit(expression / variable, variable, side)
                intercept = sp.limit(expression - slope * variable, variable, side)
                if (
                    safe_float(slope) is not None
                    and abs(float(sp.N(slope))) > 1e-12
                    and safe_float(intercept) is not None
                    and sp.simplify(expression - (slope * variable + intercept)) != 0
                ):
                    oblique.append(f"y={slope}*x+{intercept}")
                else:
                    complete = complete and True
            except Exception:  # noqa: BLE001
                complete = False
    vertical = sorted(set(vertical))
    horizontal = sorted(set(horizontal))
    oblique = sorted(set(oblique))
    vertical_values = sorted(set(vertical_values))
    horizontal_values = sorted(set(horizontal_values))
    if complete:
        descriptions = []
        increasing = [item["interval"] for item in monotonic if item["kind"] == "increasing"]
        decreasing = [item["interval"] for item in monotonic if item["kind"] == "decreasing"]
        concavity_up = [item["interval"] for item in concavity if item["kind"] == "concave_up"]
        concavity_down = [item["interval"] for item in concavity if item["kind"] == "concave_down"]
        descriptions.append("单调递增区间：" + ("、".join(increasing) or "无"))
        descriptions.append("单调递减区间：" + ("、".join(decreasing) or "无"))
        descriptions.append("凹向上区间：" + ("、".join(concavity_up) or "无"))
        descriptions.append("凹向下区间：" + ("、".join(concavity_down) or "无"))
        if extrema:
            descriptions.append("；".join(f"{item['label']} f({item['point']})={item['value']}" for item in extrema))
        else:
            descriptions.append("没有内部极值点")
        if inflections:
            descriptions.append("拐点：" + "、".join(f"({item['point']}, {item['value']})" for item in inflections))
        else:
            descriptions.append("没有拐点")
        descriptions.append("垂直渐近线：" + ("、".join(vertical) or "无"))
        descriptions.append("水平渐近线：" + ("、".join(horizontal) or "无"))
        if oblique:
            descriptions.append("斜渐近线：" + "、".join(oblique))
        answer = "；".join(descriptions)
    else:
        answer = ""
    return {
        "status": "complete" if complete else "incomplete",
        "reason": None if complete else "存在周期族或无法确定的临界点/渐近线，区间分解未完成",
        "answer": answer,
        "derivative": str(derivative),
        "second_derivative": str(second),
        "monotonic": monotonic,
        "concavity": concavity,
        "extrema": extrema,
        "inflections": inflections,
        "asymptotes": {
            "vertical": vertical, "horizontal": horizontal, "oblique": oblique,
            "vertical_values": vertical_values, "horizontal_values": horizontal_values,
        },
        "domain": [{"from": str(start), "to": str(end), "left_open": left_open, "right_open": right_open} for start, end, left_open, right_open in components],
    }


def _solve_function_study(model: Mapping[str, Any]) -> dict[str, Any]:
    report = _study_report(model)
    if report["status"] != "complete":
        return {
            "summary": report["reason"], "answer": "", "answer_value": None,
            "steps": [], "conditions": [], "limitations": [report["reason"]],
            "study": {key: report.get(key) for key in ("monotonic", "concavity", "extrema", "inflections", "asymptotes", "domain", "absolute", "critical_points", "endpoints")},
            "solution_status": "incomplete", "solution_complete": False,
            "incomplete_reason": report["reason"],
        }
    if model.get('manual_study'):
        keys=('monotonic','concavity','extrema','inflections','asymptotes','domain','absolute','critical_points','endpoints')
        return dict(summary='在原式实定义域内完整分段，区分局部极值与区间最值。',answer=report['answer'],exact=report['answer'],answer_value=None,
            study={key:report.get(key) for key in keys},solution_status='complete',solution_complete=True,
            conditions=['区间开闭与原式定义域均来自已确认条件。'],limitations=['只支持能完整分解的有限实区间；常值区间不枚举全部非严格极值点。未分析全局渐近线。'],
            steps=[dict(id='domain',title='确认定义域与端点',detail='保留原式无定义点，将研究区间与实定义域求交；开端点不能当作函数取值。'),
                dict(id='critical',title='检查导数零点与不可导点',detail='完整求解各光滑分支的一、二阶导数零点，并补入导数定义域边界及绝对值折点；无法确认完整性时停止给出完整结论。'),
                dict(id='signs',title='逐段核对单调性与凹凸性',detail='确认分段内部导数连续且没有遗漏零点后，以符号判号；只有变号且函数在该点连续，才判极值或拐点。'),
                dict(id='absolute',title='比较候选取值与边界极限',detail='闭端点、内部候选点和常值区间取值参与比较；开端点与缺口只贡献单侧极限，单独区分最值和未取到的上下确界。')])
    return {
        "summary": "函数研究：由一阶导数定单调区间与极值，由二阶导数定凹凸区间与拐点，并单独分析渐近线。",
        "answer": report["answer"],
        "answer_value": None,
        "exact": report["answer"],
        "steps": [
            {"id": "domain", "title": "确定定义域", "latex": r"D_f", "detail": "先排除无定义点与定义域缺口，再在每段内部讨论。"},
            {"id": "first", "title": "用一阶导数定单调性与极值", "latex": rf"{to_latex(sp.sympify(report['derivative']))}", "detail": "核对导数零点、不可导点与定义域分段，再在连续且无零点的子区间内符号判号。"},
            {"id": "second", "title": "用二阶导数定凹凸与拐点", "latex": rf"{to_latex(sp.sympify(report['second_derivative']))}", "detail": "核对二阶导数零点和不存在点，并检查函数连续且凹凸方向改变。"},
            *([{ "id": "absolute", "title": "比较端点与内部候选值", "detail": "闭端点、内部驻点及不可导候选点参与取值比较；开端点和定义域缺口仅比较单侧极限，不冒充取到的最值。" }] if model.get("manual_study") else []),
            {"id": "asymptote", "title": "求渐近线", "latex": r"\lim f(x),\quad \lim f(x)/x", "detail": "垂直渐近线由定义域缺口出发；水平/斜渐近线由无穷远极限确定。"},
        ],
        "conditions": ["研究区间与变量来自原题；没有指定区间时按实定义域分析。"],
        "limitations": ["周期临界点族、无法符号判号的区间会明确标为未完成，不把部分区间冒充完整答案。"],
        "study": {key: report.get(key) for key in ("monotonic", "concavity", "extrema", "inflections", "asymptotes", "domain", "absolute", "critical_points", "endpoints")},
        "solution_status": "complete",
        "solution_complete": True,
    }


def _evaluate_function_study(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    report = _study_report(model)
    variable = sp.Symbol(str(model.get("variable") or "x"), real=True)
    expression = _parse(model.get("expression"), str(variable))
    plot = model.get("plot_domain") or [-6.0, 6.0]
    domain = {"x_min": float(plot[0]), "x_max": float(plot[1])}
    series = []
    func = sp.lambdify(variable, expression, "math")
    for index in range(260):
        x_value = domain["x_min"] + (domain["x_max"] - domain["x_min"]) * index / 259
        try:
            value = float(func(x_value))
        except Exception:  # noqa: BLE001
            value = None
        if value is not None and not math.isfinite(value):
            value = None
        series.append({"x": x_value, "y": None if value is None else round(value, 6)})
    if model.get('manual_study') and report['status'] == 'complete':
        ranges=[(float(parse_expression(d['from'])),float(parse_expression(d['to'])),d['left_open'],d['right_open']) for d in report['domain']]
        clipped=[]; previous=None
        for item in series:
            x=item['x']
            component=next((i for i,(lo,hi,lop,rop) in enumerate(ranges) if (x>lo or x==lo and not lop) and (x<hi or x==hi and not rop)),None)
            if component is None: item={**item,'y':None}
            if previous is not None and component is not None and previous!=component:
                clipped.append(dict(x=x,y=None))
            clipped.append(item);previous=component
        series=clipped
    if report["status"] != "complete":
        return {
            "subject": "calculus", "task": "function_study", "kind": "function_study",
            "params": {}, "headline": report["reason"],
            "metrics": [{"id": "status", "label": "区间研究", "value": "未完成"}],
            "checks": [{"id": "complete", "label": "区间分解完成", "status": "fail", "detail": report["reason"]}],
            "notes": [report["reason"]], "series": series, "domain": domain, "rects": [],
            "exact": None, "approx": None, "error": None, "answerText": "", "trace": [],
            "study": {key: report.get(key) for key in ("monotonic", "concavity", "extrema", "inflections", "asymptotes", "domain", "absolute", "critical_points", "endpoints")},
        }
    study = {key: report.get(key) for key in ("monotonic", "concavity", "extrema", "inflections", "asymptotes", "domain", "absolute", "critical_points", "endpoints")}
    return {
        "subject": "calculus", "task": "function_study", "kind": "function_study",
        "params": {},
        "headline": "单调性、凹凸性、极值、拐点与渐近线",
        "metrics": [
            {"id": "increasing", "label": "递增区间数", "value": str(sum(1 for item in report["monotonic"] if item["kind"] == "increasing")), "accent": True},
            {"id": "decreasing", "label": "递减区间数", "value": str(sum(1 for item in report["monotonic"] if item["kind"] == "decreasing"))},
            {"id": "extrema", "label": "极值点", "value": str(len(report["extrema"]))},
            {"id": "inflections", "label": "拐点", "value": str(len(report["inflections"]))},
            {"id": "asymptotes", "label": "渐近线", "value": str(sum(len(report["asymptotes"][key]) for key in ("vertical", "horizontal", "oblique")))},
        ],
        "checks": [
            {"id": "complete", "label": "区间分解完成", "status": "pass", "detail": "全部临界候选点、定义域缺口和区间端点均已核对。" if model.get("manual_study") else "全部临界点、定义域缺口和渐近线均已核对。"},
            {"id": "sign", "label": "区间判号", "status": "pass", "detail": "每个子区间取内点核对一阶、二阶导数符号。"},
        ],
        "notes": ["阴影带表示单调/凹凸区间；竖线和横线表示渐近线。"],
        "series": series, "domain": domain, "rects": [],
        "exact": None, "approx": None, "error": None,
        "answerText": report["answer"],
        "trace": [{"index": index, "label": item["label"], "detail": item["interval"], "values": {"from": item.get("from"), "to": item.get("to")}} for index, item in enumerate(report["monotonic"])],
        "study": study,
    }


# ---------------------------------------------------------------------------
# 入口与声明式编译
# ---------------------------------------------------------------------------


def solve_analysis(model: Mapping[str, Any]) -> dict[str, Any] | None:
    kind = model.get("analysis_kind") or model.get("task")
    if kind == "limit":
        if model.get("continuity_config"):
            from .continuity import continuity_report
            return continuity_report(model)
        return _limit_report(model)
    if kind == "taylor":
        return _solve_taylor(model)
    if kind == "higher_derivative":
        return _solve_higher_derivative(model)
    if kind == "function_study":
        return _solve_function_study(model)
    return None


def evaluate_analysis(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any] | None:
    kind = model.get("analysis_kind") or model.get("task")
    if kind == "limit":
        return _evaluate_limit(model, params)
    if kind == "taylor":
        return _evaluate_taylor(model, params)
    if kind == "higher_derivative":
        return _evaluate_higher_derivative(model, params)
    if kind == "function_study":
        return _evaluate_function_study(model, params)
    return None


def detect_analysis_kind(text: str) -> str | None:
    if re.search(r"(?:\\?lim|极限)", text, flags=re.I):
        return "limit"
    if re.search(r"泰勒|麦克劳林|Taylor|Maclaurin", text, flags=re.I):
        return "taylor"
    if re.search(r"(?:高阶导数|[一二两三四五六七八九十\d]+\s*阶导数|f\s*\^?\s*\(\s*\d+\s*\))", text):
        return "higher_derivative"
    if re.search(r"单调|凹凸|拐点|渐近线", text):
        return "function_study"
    return None


def _parse_limit_text(text: str) -> tuple[str | None, str, str]:
    match = re.search(
        r"(?:\\?lim|极限)\s*[_]?\s*\{?\s*([A-Za-z])\s*(?:->|→|to|趋于|趋近于)\s*([^\s,，}]+)\s*\}?\s*(.+)",
        text,
        flags=re.I,
    )
    if not match:
        return None, "x", "0"
    variable, point, body = match.group(1), match.group(2), match.group(3)
    body = re.split(r"(?:的极限|极限为|等于|求)", body, maxsplit=1)[0].strip(" ：:，,。；;")
    body = body.strip(" ：:，,。；;")
    point = point.replace("＋", "+").replace("−", "-")
    return body or None, variable, point


_CHINESE_ORDERS = {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}


def _parse_order(text: str, default: int = 3) -> int:
    match = re.search(r"(\d+)\s*阶", text)
    if match:
        return max(1, min(MAX_ORDER, int(match.group(1))))
    match = re.search(r"([一二两三四五六七八九十])\s*阶", text)
    if match:
        return max(1, min(MAX_ORDER, _CHINESE_ORDERS[match.group(1)]))
    return default


def _parse_limit_point_text(text: str) -> str | None:
    match = re.search(r"[xX]\s*(?:->|→|趋于|趋近于|to)\s*([^\s,，}]+)", text)
    if not match:
        return None
    return match.group(1).replace("＋", "+").replace("−", "-")


def _parse_study_interval(text: str) -> tuple[float, float] | None:
    patterns = [
        r"\[\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*\]",
        r"([-+]?\d+(?:\.\d+)?)\s*(?:<=|≤)\s*[xX]\s*(?:<=|≤)\s*([-+]?\d+(?:\.\d+)?)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            try:
                lower, upper = float(match.group(1)), float(match.group(2))
            except ValueError:
                continue
            if lower < upper:
                return lower, upper
    return None


def _parse_point_number(text: str) -> float | None:
    match = re.search(r"(?:在|于)?\s*[xX]\s*=\s*([-+]?\d+(?:\.\d+)?|pi|π|e)", text)
    if not match:
        return None
    raw = match.group(1).replace("π", "pi")
    return _parse_constant(raw)


def _extract_expression_text(text: str) -> str | None:
    match = re.search(r"(?:f|g|h|y)\s*\(\s*[xX]\s*\)\s*=\s*([^\n，,。；;]+)", text)
    if not match:
        return None
    raw = re.split(r"\s*(?:在|的|处|求|，|,|。|；|;|\n)", match.group(1), maxsplit=1)[0]
    return raw.strip() or None


def build_analysis_problem(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    kind = str(overrides.get("calculus_kind") or "").strip()
    if kind not in ANALYSIS_KINDS:
        kind = detect_analysis_kind(text) or ""
        if not kind:
            return None
    from .exam_math import _condition
    from .recognize import _ambiguity
    ambiguities: list[dict[str, Any]] = []
    conditions: list[dict[str, Any]] = []
    raw_expr = str(overrides.get("expression") or "").strip() or _extract_expression_text(text)
    variable = str(overrides.get("variable") or "x")
    point_raw = overrides.get("point")
    side = str(overrides.get("side") or "both")
    order = int(overrides.get("order") or 0)
    lower = overrides.get("lower")
    upper = overrides.get("upper")
    if kind == "limit" and raw_expr is None:
        raw_expr, parsed_variable, parsed_point = _parse_limit_text(text)
        variable = parsed_variable or variable
        if point_raw is None:
            point_raw = _parse_limit_point_text(text) or parsed_point
    if kind == "taylor":
        order_found = bool(overrides.get("order")) or bool(re.search(r"[一二两三四五六七八九十\d]+\s*阶", text))
        order = order or _parse_order(text, 3)
        if not order_found and overrides.get("calculus_kind") is None:
            ambiguities.append(_ambiguity("taylor_order", "order", "泰勒展开阶数未明确；请给出需要展开到的阶数。", options=[]))
        if point_raw is None:
            point_raw = _parse_point_number(text)
            if point_raw is None and "麦克劳林" not in text:
                ambiguities.append(_ambiguity("taylor_point", "point", "泰勒展开点未明确；麦克劳林展开请注明 x=0。", options=[]))
            point_raw = 0.0 if point_raw is None else point_raw
    if kind == "higher_derivative":
        order_found = bool(overrides.get("order")) or bool(re.search(r"[一二两三四五六七八九十\d]+\s*阶", text))
        order = order or _parse_order(text, 1)
        if not order_found and overrides.get("calculus_kind") is None:
            ambiguities.append(_ambiguity("derivative_order", "order", "高阶导数的阶数未明确；请给出求导阶数。", options=[]))
        if point_raw is None:
            point_raw = _parse_point_number(text)
    if raw_expr is None:
        ambiguities.append(_ambiguity("analysis_expression", "expression", "没有识别到可计算的函数表达式。", options=[]))
        raw_expr = "x"
    try:
        parsed = _parse(raw_expr, variable)
        raw_expr = expression_text(parsed)
    except Exception as exc:  # noqa: BLE001
        ambiguities.append(_ambiguity("analysis_expression", "expression", f"表达式无法解析：{exc}", options=[]))
        parsed = sp.Symbol(variable)
        raw_expr = variable
    conditions.append(_condition("expression", "函数表达式", raw_expr, source, kind="expr"))
    defaults: dict[str, Any] = {}
    params: list[dict[str, Any]] = []
    model: dict[str, Any] = {
        "engine": "analysis_v1", "subject": "calculus", "task": kind,
        "analysis_kind": kind, "kind": kind, "variable": variable,
        "expression": raw_expr, "teaching": False, "defaults": defaults, "params": params,
        "formula_tex": to_latex(parsed),
    }
    if kind == "limit":
        point_text = str(point_raw).replace("＋", "+").replace("−", "-")
        model["side"] = side
        if point_text in _LIMIT_INFINITIES:
            point_value = None
            defaults.update(point=0.0, side=side)
            model["limit_point"] = point_text
            model["limit_point_value"] = None
        else:
            point_value = _parse_constant(point_text)
            if point_value is None:
                ambiguities.append(_ambiguity("limit_point", "point", "极限点必须是有限数或 ±∞。", options=[]))
                point_value = 0.0
            defaults.update(point=point_value, side=side)
            model["limit_point"] = str(point_value)
            model["limit_point_value"] = point_value
            params.append({"id": "point", "label": "极限点 x₀", "kind": "number", "min": -50, "max": 50, "step": 0.5, "options": []})
            params.append({"id": "side", "label": "考察方向", "kind": "enum", "min": None, "max": None, "step": None, "options": ["both", "left", "right"]})
            conditions.append(_condition("side", "考察方向", side, source, kind="text"))
        defaults["side"] = side
        conditions.append(_condition("point", "极限点", str(point_raw), source))
    elif kind == "taylor":
        point_value = _parse_constant(point_raw if point_raw is not None else 0)
        if point_value is None:
            ambiguities.append(_ambiguity("taylor_point", "point", "泰勒展开点必须是有限实数。", options=[]))
            point_value = 0.0
        defaults.update(point=point_value, order=order)
        model["taylor_point"] = expression_text(parse_expression(str(point_raw if point_raw is not None else 0)))
        model["expression"] = str(overrides.get("expression") or raw_expr)
        model["taylor_point_value"] = point_value
        model["order"] = order
        params.extend([
            {"id": "order", "label": "展开阶数 n", "kind": "integer", "min": 1, "max": MAX_ORDER, "step": 1, "options": []},
            {"id": "point", "label": "展开点 x₀", "kind": "number", "min": -50, "max": 50, "step": 0.5, "options": []},
        ])
        conditions.extend([
            _condition("point", "展开点", str(point_raw), source),
            _condition("order", "展开阶数", order, source),
        ])
    elif kind == "higher_derivative":
        defaults["order"] = order
        model["order"] = order
        params.append({"id": "order", "label": "导数阶数 n", "kind": "integer", "min": 1, "max": MAX_ORDER, "step": 1, "options": []})
        if point_raw is not None:
            point_value = _parse_constant(point_raw)
            if point_value is None:
                ambiguities.append(_ambiguity("derivative_point", "point", "求值点必须是有限实数。", options=[]))
            else:
                model["derivative_point"] = expression_text(parse_expression(str(point_raw)))
                defaults["point"] = point_value
                params.append({"id": "point", "label": "求值点 x₀", "kind": "number", "min": -50, "max": 50, "step": 0.5, "options": []})
                conditions.append(_condition("point", "求值点", str(point_raw), source))
        conditions.append(_condition("order", "导数阶数", order, source))
    elif kind == "function_study":
        if overrides.get("manual_study"):
            model["manual_study"] = overrides["manual_study"]
            model["expression"] = str(overrides["expression"])
        if lower is None and upper is None and overrides.get("calculus_kind") is None:
            parsed_interval = _parse_study_interval(text)
            if parsed_interval is not None:
                lower, upper = parsed_interval
        if lower is not None or upper is not None:
            try:
                lower_value = float(lower)
                upper_value = float(upper)
            except (TypeError, ValueError):
                lower_value = upper_value = None
            if lower_value is None or upper_value is None or not lower_value < upper_value:
                ambiguities.append(_ambiguity("study_interval", "interval", "研究区间必须是有限递增区间。", options=[]))
                lower_value = upper_value = None
            model["study_lower"] = lower_value
            model["study_upper"] = upper_value
            conditions.append(_condition("lower", "研究区间下限", lower_value, source))
            conditions.append(_condition("upper", "研究区间上限", upper_value, source))
        plot = [-6.0, 6.0]
        if model.get("study_lower") is not None and model.get("study_upper") is not None:
            plot = [model["study_lower"], model["study_upper"]]
        model["plot_domain"] = plot
        defaults["lower"], defaults["upper"] = plot
    return {
        "model": model,
        "conditions": conditions,
        "ambiguities": ambiguities,
        "formulas": [{"id": kind, "tex": model.get("formula_tex", ""), "plain": raw_expr, "role": "P1 分析模型"}],
        "recognized": not any(item.get("severity") == "blocking" and not item.get("resolved") for item in ambiguities),
    }


__all__ = [
    "ANALYSIS_KINDS",
    "build_analysis_problem",
    "detect_analysis_kind",
    "evaluate_analysis",
    "solve_analysis",
    "MAX_ORDER",
]
