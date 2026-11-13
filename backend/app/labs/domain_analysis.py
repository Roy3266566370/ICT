"""Real-domain, singularity and improper-integral status.

Finite endpoints alone do not justify Newton-Leibniz: the original expression can
have interior poles or leave the real domain. This module locates those points on
the original expression, splits the interval, and classifies the result instead of
letting a sampled Riemann sum or an antiderivative endpoint difference pass.
"""
from __future__ import annotations

import math
from typing import Any

import sympy as sp
from sympy.calculus.util import continuous_domain

from .expr import safe_float

MAX_ANALYSIS_OPS = 180
NUMERIC_TOL = 1e-5


def _missing_components(missing: sp.Set, variable: sp.Symbol) -> tuple[list[sp.Expr], bool, bool]:
    """Return (isolated points, has_positive_measure_gap, analysis_complete)."""
    points: list[sp.Expr] = []
    gap = False
    complete = True
    if missing is sp.S.EmptySet:
        return points, False, True
    if isinstance(missing, sp.FiniteSet):
        for value in missing:
            if value.is_real is not True:
                complete = False
                continue
            points.append(sp.simplify(value))
        return points, False, complete
    if isinstance(missing, sp.Interval):
        if missing.measure == 0:
            if missing.start.is_real is True:
                points.append(sp.simplify(missing.start))
            else:
                complete = False
            return points, False, complete
        return points, True, complete
    if isinstance(missing, sp.ImageSet):
        # 周期函数（tan/sec/csc/cot）的瑕点族是零测度孤立点；不展开具体数值，
        # 但可以确认它不含正测度的实区间。
        return points, False, True
    if isinstance(missing, sp.Union):
        for part in missing.args:
            found, part_gap, part_complete = _missing_components(part, variable)
            points.extend(found)
            gap = gap or part_gap
            complete = complete and part_complete
        return points, gap, complete
    return [], False, False


def _point_text(value: Any) -> str:
    return sp.sstr(sp.simplify(value))


def _contains_infinity(value: sp.Expr) -> bool:
    if value in (sp.oo, -sp.oo, sp.zoo, sp.nan):
        return True
    return bool(getattr(value, "has", lambda *_: False)(sp.oo, -sp.oo, sp.zoo, sp.nan))


def _numeric_real(value: sp.Expr) -> float | None:
    try:
        converted = complex(sp.N(value, 20))
    except Exception:  # noqa: BLE001
        return None
    if not (math.isfinite(converted.real) and math.isfinite(converted.imag)):
        return None
    if abs(converted.imag) > 1e-9 * max(1.0, abs(converted.real)):
        return None
    return float(converted.real)


def _classify_value(value: sp.Expr) -> dict[str, Any]:
    if value is sp.nan or _contains_infinity(value):
        return {
            "status": "divergent",
            "reason": "至少一个子区间上的积分发散（单侧极限为无穷大或不存在）",
        }
    if isinstance(value, sp.Expr) and value.has(sp.Integral):
        numeric = _numeric_real(sp.N(value, 20)) if not value.free_symbols else None
        if numeric is None:
            return {"status": "undetermined", "reason": "符号积分未化为闭式，且无法取得有限数值"}
        return {
            "status": "numeric_only",
            "value": None,
            "numeric": numeric,
            "reason": "符号积分未得到闭式解，只能提供数值参考",
        }
    numeric = _numeric_real(value)
    if numeric is None:
        try:
            converted = complex(sp.N(value, 20))
        except Exception:  # noqa: BLE001
            return {"status": "undetermined", "reason": "积分结果无法求值"}
        if math.isfinite(converted.imag) and abs(converted.imag) > 1e-9 * max(1.0, abs(converted.real)):
            return {
                "status": "undetermined",
                "reason": "符号积分返回非实数结果，当前无法确认真实积分值（可能涉及幂或对数的复分支）",
            }
        return {"status": "undetermined", "reason": "积分结果不是有限实数"}
    if value.free_symbols:
        return {"status": "undetermined", "reason": "积分结果仍含未确定符号"}
    return {"status": "finite", "value": value, "numeric": numeric}


def _mpf(value: sp.Expr):
    import mpmath as mp

    if value in (sp.oo, sp.S.Infinity):
        return mp.inf
    if value is -sp.oo:
        return -mp.inf
    try:
        return mp.mpf(str(sp.N(value, 25)))
    except Exception:  # noqa: BLE001
        return None


def _nonsmooth_breakpoints(expression: sp.Expr, variable: sp.Symbol, a: sp.Expr, b: sp.Expr) -> list[float]:
    """Integrand 的折点（|u| 与 sqrt(u^2) 的零点）若不拆开，数值复核会被光滑求积低估。"""
    left, right = safe_float(a), safe_float(b)
    if left is None or right is None:
        left, right = -math.inf, math.inf
    candidates: list[sp.Expr] = []
    for atom in expression.atoms(sp.Abs):
        candidates.append(atom.args[0])
    for atom in expression.atoms(sp.Pow):
        if atom.exp != sp.Rational(1, 2):
            continue
        base = atom.base
        squared = None
        if isinstance(base, sp.Pow) and base.exp == 2:
            squared = base.base
        elif isinstance(base, sp.Mul):
            squares = [factor.base for factor in base.args if isinstance(factor, sp.Pow) and factor.exp == 2]
            if len(squares) == 1:
                squared = squares[0]
        if squared is not None:
            candidates.append(squared)
    points: set[float] = set()
    for candidate in candidates:
        try:
            solutions = sp.solve(sp.Eq(candidate, 0), variable)
        except Exception:  # noqa: BLE001
            continue
        for solution in solutions:
            value = safe_float(solution)
            if value is not None and left < value < right:
                points.add(round(value, 12))
    return sorted(points)


def _numeric_quad(
    expression: sp.Expr,
    variable: sp.Symbol,
    a: sp.Expr,
    b: sp.Expr,
    *,
    open_left: bool = False,
    open_right: bool = False,
) -> float | None:
    try:
        import mpmath as mp

        func = sp.lambdify(variable, expression, modules=["mpmath"])
        left, right = _mpf(a), _mpf(b)
        if left is None or right is None:
            return None
        span = abs(right - left) if mp.isfinite(right) and mp.isfinite(left) else mp.mpf(1)
        delta = mp.mpf("1e-12") * max(mp.mpf(1), span)
        if open_left and mp.isfinite(left):
            left = left + delta
        if open_right and mp.isfinite(right):
            right = right - delta
        path = [left]
        for point in _nonsmooth_breakpoints(expression, variable, a, b):
            value = _mpf(sp.Float(point))
            if value is not None and left < value < right:
                path.append(value)
        path.append(right)
        with mp.workdps(25):
            value = mp.quad(func, path if len(path) > 2 else [left, right])
        real = getattr(value, "real", value)
        imag = getattr(value, "imag", 0)
        if abs(float(imag)) > 1e-9 * max(1.0, abs(float(real))):
            return None
        result = float(real)
        return result if math.isfinite(result) else None
    except Exception:  # noqa: BLE001
        return None


def _sympy_numeric(expression: sp.Expr, variable: sp.Symbol, a: sp.Expr, b: sp.Expr) -> float | None:
    try:
        return safe_float(sp.N(sp.Integral(expression, (variable, a, b)), 25))
    except Exception:  # noqa: BLE001
        return None


def _antiderivative_value(
    expression: sp.Expr, variable: sp.Symbol, a: sp.Expr, b: sp.Expr
) -> sp.Expr | None:
    try:
        antiderivative = sp.integrate(expression, variable)
        if antiderivative.has(sp.Integral):
            return None
        value = sp.simplify(antiderivative.subs(variable, b) - antiderivative.subs(variable, a))
        if _contains_infinity(value):
            return None
        if _numeric_real(value) is None:
            return None
        return value
    except Exception:  # noqa: BLE001
        return None


def _numeric_crosscheck(
    expression: sp.Expr,
    variable: sp.Symbol,
    a: sp.Expr,
    b: sp.Expr,
    expected: float,
    *,
    open_left: bool = False,
    open_right: bool = False,
) -> tuple[bool | None, float | None]:
    numeric = _numeric_quad(
        expression, variable, a, b, open_left=open_left, open_right=open_right
    )
    if numeric is None:
        numeric = _numeric_quad(
            expression, variable, a, b, open_left=True, open_right=True
        )
    if numeric is None:
        numeric = _sympy_numeric(expression, variable, a, b)
    if numeric is None:
        return None, None
    if abs(numeric - expected) <= NUMERIC_TOL * max(1.0, abs(expected)):
        return True, numeric
    return False, numeric


def _abs_roots(expression: sp.Expr, variable: sp.Symbol, lower: sp.Expr, upper: sp.Expr) -> list[sp.Expr]:
    """|u| 内部的零点；在分段内去掉绝对值后才能得到闭式原函数。"""
    roots: list[sp.Expr] = []
    left, right = safe_float(lower), safe_float(upper)
    for atom in expression.atoms(sp.Abs):
        try:
            solutions = sp.solve(sp.Eq(atom.args[0], 0), variable)
        except Exception:  # noqa: BLE001
            continue
        for solution in solutions:
            value = safe_float(solution)
            if value is None or left is None or right is None:
                continue
            if left < value < right:
                roots.append(sp.simplify(solution))
        if len(roots) >= 24:
            break
    return roots


def _linearize_abs(expression: sp.Expr, variable: sp.Symbol, point: sp.Expr) -> sp.Expr | None:
    """在分段中点按符号替换 |u|，让符号积分得到闭式结果；符号不确定时保持原式。"""
    replacements: dict[sp.Expr, sp.Expr] = {}
    for atom in expression.atoms(sp.Abs):
        argument = atom.args[0]
        try:
            value = sp.N(argument.subs(variable, point))
        except Exception:  # noqa: BLE001
            return None
        if value.is_real is not True:
            return None
        if value > 0:
            replacements[atom] = argument
        elif value < 0:
            replacements[atom] = -argument
        else:
            return None
    return expression.xreplace(replacements) if replacements else expression


def _analyze_integral_forward(
    expression: sp.Expr,
    variable: sp.Symbol,
    lower: sp.Expr,
    upper: sp.Expr,
) -> dict[str, Any]:
    """Split at real domain gaps and classify convergence of the original integral."""
    report: dict[str, Any] = {
        "status": "undetermined",
        "reason": "",
        "value": None,
        "numeric": None,
        "numeric_verified": None,
        "singularities": [],
        "segments": [],
        "warnings": [],
        "complete": False,
        "domain_complete": False,
    }
    try:
        if sp.simplify(lower - upper) == 0:
            report.update(status="finite", value=sp.Integer(0), numeric=0.0,
                          numeric_verified=True, complete=True, domain_complete=True)
            return report
    except Exception:  # noqa: BLE001
        pass
    if sp.count_ops(expression) > MAX_ANALYSIS_OPS:
        report["reason"] = "表达式超出当前定义域与瑕点分析预算"
        return report
    try:
        interval = sp.Interval(lower, upper)
        domain = continuous_domain(expression, variable, interval)
        missing = interval - domain
    except Exception:  # noqa: BLE001
        report["reason"] = "无法完成实定义域与瑕点分析"
        return report
    if missing is not sp.S.EmptySet:
        points, has_gap, complete = _missing_components(missing, variable)
        report["domain_complete"] = complete
        if has_gap:
            report.update(
                status="undefined",
                reason="被积函数在积分区间内存在一段无定义的实区间，不能直接作为实积分计算",
                complete=True,
            )
            report["singularities"] = [
                {"point": _point_text(point), "kind": "isolated"} for point in sorted(points, key=lambda v: float(sp.N(v)))
            ]
            return report
        if not complete:
            report["reason"] = "无法确认被积函数在区间内的实定义域是否完整"
            return report
    else:
        points = []
        report["domain_complete"] = True

    try:
        order = sorted({sp.simplify(point) for point in points}, key=lambda v: float(sp.N(v)))
    except Exception:  # noqa: BLE001
        report["reason"] = "瑕点排序失败"
        return report
    report["singularities"] = [
        {
            "point": _point_text(point),
            "kind": "endpoint" if sp.simplify(point - lower) == 0 or sp.simplify(point - upper) == 0 else "interior",
        }
        for point in order
    ]
    boundaries: list[sp.Expr] = [lower]
    for point in order:
        if sp.simplify(point - boundaries[-1]) != 0:
            boundaries.append(point)
    for point in _abs_roots(expression, variable, lower, upper):
        if all(sp.simplify(point - boundary) != 0 for boundary in boundaries):
            boundaries.append(point)
    if sp.simplify(upper - boundaries[-1]) != 0:
        boundaries.append(upper)
    boundaries = sorted(boundaries, key=lambda value: float(sp.N(value)))

    finite_values: list[sp.Expr] = []
    numeric_parts: list[float] = []
    numeric_ok = True
    numeric_only_seen = False
    for first, second in zip(boundaries, boundaries[1:]):
        if sp.simplify(second - first) == 0:
            continue
        segment: dict[str, Any] = {"lower": _point_text(first), "upper": _point_text(second)}
        integrand = expression
        try:
            midpoint = sp.simplify((first + second) / 2)
            linearized = _linearize_abs(expression, variable, midpoint)
            if linearized is not None:
                integrand = linearized
        except Exception:  # noqa: BLE001
            integrand = expression
        try:
            value = sp.integrate(integrand, (variable, first, second))
        except Exception as exc:  # noqa: BLE001
            segment.update(status="undetermined", reason=f"符号积分失败：{type(exc).__name__}")
            report["segments"].append(segment)
            report.update(status="undetermined", reason="至少一个子区间的符号积分失败")
            report["complete"] = False
            return report
        classified = _classify_value(value)
        segment.update(classified)
        if classified["status"] in ("divergent", "undefined", "undetermined"):
            report["segments"].append(segment)
            report.update(status=classified["status"], reason=classified["reason"])
            report["complete"] = classified["status"] in ("divergent", "undefined")
            return report
        if classified["status"] == "numeric_only":
            if classified.get("numeric") is None:
                report["segments"].append(segment)
                report.update(status="undetermined", reason=classified["reason"])
                return report
            numeric_parts.append(float(classified["numeric"]))
            numeric_only_seen = True
        else:
            finite_values.append(classified["value"])
            numeric_parts.append(float(classified["numeric"]))
            open_left = any(sp.simplify(first - point) == 0 for point in order)
            open_right = any(sp.simplify(second - point) == 0 for point in order)
            verified, numeric = _numeric_crosscheck(
                expression,
                variable,
                first,
                second,
                float(classified["numeric"]),
                open_left=open_left,
                open_right=open_right,
            )
            segment["numeric"] = numeric
            segment["numeric_verified"] = verified
            if verified is False:
                fallback = _antiderivative_value(expression, variable, first, second)
                fallback_numeric = _numeric_real(fallback) if fallback is not None else None
                if (
                    fallback is not None
                    and fallback_numeric is not None
                    and numeric is not None
                    and abs(fallback_numeric - numeric) <= NUMERIC_TOL * max(1.0, abs(fallback_numeric))
                ):
                    finite_values[-1] = fallback
                    numeric_parts[-1] = float(fallback_numeric)
                    segment["value"] = fallback
                    segment["value_source"] = "antiderivative"
                    segment["numeric_verified"] = True
                    report["warnings"].append(
                        f"子区间 [{_point_text(first)}, {_point_text(second)}] 的定积分数值符号结果与独立数值复核不一致，已改用原函数端点差并与数值复核核对。"
                    )
                else:
                    report["segments"].append(segment)
                    report.update(
                        status="undetermined",
                        reason="解析积分与独立数值积分不一致，不能判为通过",
                    )
                    report["complete"] = False
                    return report
            numeric_ok = numeric_ok and segment["numeric_verified"] is True
        report["segments"].append(segment)

    if numeric_only_seen:
        report.update(
            status="numeric_only",
            numeric=sum(numeric_parts) if numeric_parts else None,
            complete=False,
            reason="至少一个子区间没有有限闭式解，整体不能作为精确结果",
        )
        return report
    if not finite_values:
        numeric = sum(numeric_parts) if numeric_parts else None
        report.update(status="numeric_only" if numeric is not None else "undetermined",
                      numeric=numeric, complete=False,
                      reason="未能得到有限闭式解" if numeric is not None else "没有可计算的子区间")
        return report
    total = sp.simplify(sum(finite_values))
    total_numeric = _numeric_real(total)
    if total_numeric is None:
        report.update(status="undefined", reason="各子区间积分之和不是有限实数", complete=True)
        return report
    report.update(
        status="finite",
        value=total,
        numeric=sum(numeric_parts) if numeric_parts else total_numeric,
        numeric_verified=True if numeric_ok else None,
        complete=True,
        reason="",
    )
    return report


def analyze_integral(
    expression: sp.Expr,
    variable: sp.Symbol,
    lower: sp.Expr,
    upper: sp.Expr,
) -> dict[str, Any]:
    """Analyze in increasing order so a reversed interval cannot hide a pole."""
    reversed_sign = 1
    try:
        if sp.simplify(lower - upper).is_positive:
            lower, upper = upper, lower
            reversed_sign = -1
    except Exception:  # noqa: BLE001
        pass
    report = _analyze_integral_forward(expression, variable, lower, upper)
    if reversed_sign == -1 and report["status"] in ("finite", "numeric_only"):
        if report.get("value") is not None:
            report["value"] = -report["value"]
        if report.get("numeric") is not None:
            report["numeric"] = -report["numeric"]
        for segment in report.get("segments") or []:
            if isinstance(segment.get("value"), sp.Expr):
                segment["value"] = -segment["value"]
            if segment.get("numeric") is not None:
                segment["numeric"] = -segment["numeric"]
    return report


def domain_gap_profile(expression: sp.Expr, variable: sp.Symbol, interval: sp.Set) -> dict[str, Any]:
    """原式在给定区间内是否存在正测度的无定义段；周期瑕点视为零测度孤立点。"""
    domain = continuous_domain(expression, variable, interval)
    if isinstance(domain, sp.Complement):
        # continuous_domain 对 tan/sec/csc/cot 常返回 Complement(区间, 瑕点集)；
        # 直接做集合差会留下未化简的嵌套 Complement，这里还原为显式瑕点集。
        base, excluded = domain.args
        missing = (interval - base).union(interval.intersect(excluded))
    else:
        missing = interval - domain
    points, gap, complete = _missing_components(missing, variable)
    return {"domain": domain, "missing": missing, "gap": gap, "complete": complete, "points": points}


def describe_singularities(report: dict[str, Any]) -> str:
    items = report.get("singularities") or []
    if not items:
        return ""
    return "、".join(
        f"x={item['point']}" + ("（端点）" if item["kind"] == "endpoint" else "（内部瑕点）")
        for item in items
    )


__all__ = ["analyze_integral", "describe_singularities", "domain_gap_profile", "MAX_ANALYSIS_OPS"]
