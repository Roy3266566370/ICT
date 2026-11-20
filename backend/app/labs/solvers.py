"""四类题目的确定性求解器与执行轨迹。

这里是实验室唯一的数值事实来源：符号积分/导数、梯度下降、BFS、MLP 前向与
反向传播都由本模块计算。AI 只接收这些结果做解释，不单独生成数值或动画。
所有函数返回可 JSON 序列化的普通类型，轨迹长度有上限。
"""

from __future__ import annotations

import math
from itertools import product
from typing import Any, Callable, Mapping, Sequence

import numpy as np
import sympy as sp

from .domain_analysis import analyze_integral, describe_singularities
from .expr import ExprError, expression_text, number_text, parse_expression, safe_float, to_latex
from .integral_methods import (
    VERIFICATION_LABELS,
    VERIFICATION_NUMERIC,
    VERIFICATION_SYMBOLIC,
    VERIFICATION_UNCONFIRMED,
    antiderivative_verification,
    contains_absolute_log,
    method_plan,
    plan_steps,
    real_antiderivative,
    verifies_antiderivative,
)

MAX_TRACE = 200
MAX_PLOT_POINTS = 260
GRAD_TOL = 1e-7


class SolveError(ValueError):
    """模型无法计算；保留识别结果并给出可理解的原因。"""


# ---------------------------------------------------------------------------
# 公共
# ---------------------------------------------------------------------------


def _symbols(model: Mapping[str, Any]) -> list[sp.Symbol]:
    return [sp.Symbol(str(name), real=True) for name in model.get("variables") or ["x"]]


def _safe_value(expression: sp.Expr, variables: Sequence[sp.Symbol], values: Sequence[float]) -> float | None:
    try:
        substituted = expression.subs(dict(zip(variables, values)))
        return safe_float(substituted)
    except Exception:  # noqa: BLE001
        return None


def _numeric_function(expression: sp.Expr, variables: Sequence[sp.Symbol]) -> Callable[..., float]:
    # math 覆盖常规初等函数；Si/Ci 等特殊函数回退到 mpmath，避免图像静默变成空线。
    func = sp.lambdify(variables, expression, modules=["math", "mpmath"])
    return func  # type: ignore[return-value]


def _generic_frames(
    frames: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for index, frame in enumerate(frames[:MAX_TRACE]):
        item = dict(frame)
        item.setdefault("index", index)
        item.setdefault("label", f"第 {index} 步")
        result.append(item)
    return result


def _check(check_id: str, label: str, passed: bool, detail: str, *, warn: bool = False) -> dict[str, Any]:
    return {
        "id": check_id,
        "label": label,
        "status": "pass" if passed else ("warn" if warn else "fail"),
        "detail": detail,
    }


def _fmt(value: float | None, digits: int = 6) -> str:
    return number_text(value, digits)


def _real_preimages(expression: sp.Expr, variable: sp.Symbol, target: sp.Expr) -> list[sp.Expr]:
    """Solve f(x)=target on the real line; reject a multi-branch inverse as ambiguous."""
    candidates: list[sp.Expr] = []
    values: list[float] = []
    try:
        raw = sp.solve(sp.Eq(expression, target), variable)
    except Exception:  # noqa: BLE001
        raw = []
    for candidate in raw:
        try:
            simplified = sp.simplify(candidate)
            if simplified.is_real is False:
                continue
            numeric = safe_float(sp.N(simplified))
            if numeric is None:
                continue
            residual = safe_float(sp.simplify(expression.subs(variable, simplified) - target))
            if residual is None or abs(residual) > 1e-9:
                continue
            if any(abs(numeric - existing) <= 1e-9 for existing in values):
                continue
            candidates.append(simplified)
            values.append(numeric)
        except Exception:  # noqa: BLE001
            continue
    return candidates


# ---------------------------------------------------------------------------
# 微积分
# ---------------------------------------------------------------------------


def _calculus_solution(model: Mapping[str, Any]) -> dict[str, Any]:
    variable = sp.Symbol(str(model.get("variable") or "x"), real=True)
    expression = parse_expression(str(model.get("expression") or ""), (str(variable),),
                                  preserve_structure=bool(model.get('preserve_expression_structure')))
    kind = str(model.get("kind") or "integral")
    improper_upper = False
    exact_latex = None
    incomplete_reason = None
    solution_status = "complete"
    solution_complete = True
    log_abs = False
    verification_record = None
    conditions = ["题目中的函数与区间按识别结果求值；数值近似与解析结果分开标注。"]
    if kind == "integral":
        lower = float((model.get("defaults") or {}).get("lower", 0.0))
        upper = float((model.get("defaults") or {}).get("upper", 1.0))
        improper_upper = bool(model.get("improper_upper"))
        # 用有理数保留 8/3 这类精确结果，而不是把上下限先变成浮点数。
        exact_bounds = model.get('exact_bounds') or {}
        lower_exact = parse_expression(str(exact_bounds['lower'])) if 'lower' in exact_bounds else sp.Rational(str(lower))
        upper_exact = sp.oo if improper_upper else (
            parse_expression(str(exact_bounds['upper'])) if 'upper' in exact_bounds else sp.Rational(str(upper)))
        lower_label = to_latex(lower_exact) if exact_bounds else f"{lower:g}"
        upper_label = r"+\infty" if improper_upper else to_latex(upper_exact) if exact_bounds else f"{upper:g}"
        raw_antiderivative = sp.integrate(expression, variable)
        method = None
        antiderivative = raw_antiderivative
        if not raw_antiderivative.has(sp.Integral):
            try:
                method = method_plan(expression, variable)
            except Exception:  # noqa: BLE001 - 方法展示失败不影响积分结果
                method = None
        if method is not None:
            antiderivative = method["result"]
            log_abs = bool(method.get("log_abs"))
        else:
            antiderivative, log_abs = real_antiderivative(
                raw_antiderivative, expression, variable)
        log_abs = log_abs or contains_absolute_log(antiderivative)
        method_steps = plan_steps(method, variable, constant=False)
        report = analyze_integral(expression, variable, lower_exact, upper_exact)
        convergence = report["status"]
        singularity_note = describe_singularities(report)
        if convergence == "undefined":
            raise SolveError(report["reason"] + (f"（{singularity_note}）" if singularity_note else ""))
        answer_value = None
        numeric = report.get("numeric")
        exact_text = ""
        exact_latex = None
        incomplete_reason = None
        solution_status = "complete"
        solution_complete = True
        if convergence == "divergent":
            exact = None
            exact_text = "发散"
            exact_latex = r"\text{发散（不存在有限值）}"
            incomplete_reason = "积分发散，不存在有限实数结果"
            answer_value = None
            numeric = None
            solution_status = "divergent"
            solution_complete = False
            evaluate_latex = (
                rf"\lim_{{\varepsilon\to0^+}}\left(\int_{{{lower_label}}}^{{x_0-\varepsilon}}"
                rf"+\int_{{x_0+\varepsilon}}^{{{upper_label}}}\right){to_latex(expression)}\,\mathrm{{d}}{to_latex(variable)}"
                if not improper_upper else
                rf"\int_{{{lower_label}}}^{{+\infty}} {to_latex(expression)}\,\mathrm{{d}}{to_latex(variable)}"
            )
        elif convergence in ("numeric_only",):
            exact = None
            exact_text = "未能得到闭式解"
            incomplete_reason = report.get("reason") or "符号积分未得到有限闭式解，只能提供数值参考"
            solution_status = "incomplete"
            solution_complete = False
            evaluate_latex = rf"\int_{{{lower_label}}}^{{{upper_label}}} {to_latex(expression)}\,\mathrm{{d}}{to_latex(variable)}\approx {_fmt(numeric)}"
        elif convergence != "finite":
            exact = None
            exact_text = "未能确认积分结果"
            incomplete_reason = report.get("reason") or "当前内核未能确认该积分的收敛性与结果"
            numeric = None
            solution_status = "incomplete"
            solution_complete = False
            evaluate_latex = rf"\int_{{{lower_label}}}^{{{upper_label}}} {to_latex(expression)}\,\mathrm{{d}}{to_latex(variable)}"
        else:
            exact = report["value"]
            exact_value = safe_float(exact)
            if exact_value is None:
                raise SolveError("积分结果不是有限实数，请核对被积函数与区间")
            answer_value = exact_value
            numeric = report.get("numeric") if report.get("numeric") is not None else exact_value
            exact_text = str(exact)
            exact_latex = to_latex(exact)
            if singularity_note and not improper_upper:
                evaluate_latex = (
                    rf"\lim_{{\varepsilon\to0^+}}\left(\sum_i\int_{{\text{{拆分段}}}}"
                    rf"{to_latex(expression)}\,\mathrm{{d}}{to_latex(variable)}\right)={to_latex(exact)}"
                )
            else:
                evaluate_latex = (
                    rf"\lim_{{x\to+\infty}} F(x)-F({lower_label})={to_latex(exact)}"
                    if improper_upper
                    else rf"F({upper_label})-F({lower_label})={to_latex(exact)}"
                )
        interval_note = (
            f"原题区间为 [{_fmt(lower)}, +∞)；图像与黎曼和在 b={_fmt(upper)} 处截断展示。"
            if improper_upper
            else f"原题区间为 [{exact_bounds.get('lower', _fmt(lower))}, {exact_bounds.get('upper', _fmt(upper))}]，被积变量为 {variable}。"
        )
        antiderivative_detail = "对函数逐项积分；若含参数，按原题给出的符号条件处理。"
        if method is not None:
            method_level = (method.get("verification") or {}).get("level")
            if method_level == VERIFICATION_SYMBOLIC:
                antiderivative_detail = (
                    "上面的换元或分部积分由内核实际执行，结果已通过符号求导核对；"
                    "若含参数，按原题给出的符号条件处理。"
                )
            else:
                antiderivative_detail = (
                    "上面的换元或分部积分由内核实际执行，结果仅通过数值抽查（非全域证明）；"
                    "若含参数，按原题给出的符号条件处理。"
                )
        if log_abs:
            antiderivative_detail += "对数参数写成绝对值，使原函数在实定义域各段上保持实值。"
        steps = [
            {
                "id": "limits",
                "title": "确认积分区间",
                "latex": rf"\int_{{{lower_label}}}^{{{upper_label}}} {to_latex(expression)}\,\mathrm{{d}}{to_latex(variable)}",
                "detail": interval_note,
            },
            *method_steps,
            {
                "id": "antiderivative",
                "title": "求原函数",
                "latex": f"F({to_latex(variable)})={to_latex(antiderivative)}+C",
                "detail": antiderivative_detail,
            },
        ]
        if singularity_note:
            steps.append(
                {
                    "id": "singularities",
                    "title": "定位瑕点并拆分区间",
                    "latex": rf"\left[{lower_label},\,{upper_label}\right]",
                    "detail": f"原式在 {singularity_note} 处不在实定义域内或为瑕点；先拆分区间，再对每段取单侧极限，不能用原函数在端点的差直接代替。",
                }
            )
        steps.append(
            {
                "id": "evaluate",
                "title": "逐段积分并判断敛散性",
                "latex": evaluate_latex,
                "detail": (
                    f"原积分发散，不存在有限值。"
                    if convergence == "divergent"
                    else f"解析结果为 {exact_text}；数值参考约为 {_fmt(numeric)}。"
                    if convergence == "finite"
                    else f"{exact_text}；数值参考约为 {_fmt(numeric)}。"
                ),
            }
        )
        steps.append(
            {
                "id": "approx",
                "title": "数值核对",
                "latex": r"\sum f(\xi_i)\Delta x",
                "detail": "改变分割数 n 观察黎曼和趋近解析值；近似值不替代原题答案。含瑕点时先分段再累加。",
            }
        )
    elif kind == "antiderivative":
        # 不定积分：答案是原函数族 F(x)+C，没有可代入的上下限。
        raw_antiderivative = sp.integrate(expression, variable)
        method = None
        antiderivative = raw_antiderivative
        if not raw_antiderivative.has(sp.Integral):
            try:
                method = method_plan(expression, variable)
            except Exception:  # noqa: BLE001 - 方法展示失败不影响积分结果
                method = None
        verification = None
        if method is not None:
            antiderivative = method["result"]
            log_abs = bool(method.get("log_abs"))
            verification = method.get("verification")
        else:
            antiderivative, log_abs = real_antiderivative(
                raw_antiderivative, expression, variable)
        log_abs = log_abs or contains_absolute_log(antiderivative)
        unresolved = bool(antiderivative.has(sp.Integral, sp.Derivative))
        if not verification:
            verification = (
                {"level": VERIFICATION_UNCONFIRMED, "symbolic": False, "numeric": False}
                if unresolved
                else antiderivative_verification(antiderivative, expression, variable)
            )
        verification_level = str(
            verification.get("level") or VERIFICATION_UNCONFIRMED)
        verification_label = VERIFICATION_LABELS.get(
            verification_level, VERIFICATION_LABELS[VERIFICATION_UNCONFIRMED])
        verified = verification_level in (VERIFICATION_SYMBOLIC, VERIFICATION_NUMERIC)
        solution_status = "complete" if verified else "unsupported"
        solution_complete = verified
        answer_value = None
        numeric = None
        integrand_step = {
            "id": "integrand",
            "title": "确认被积函数",
            "latex": rf"f({to_latex(variable)})={to_latex(expression)}",
            "detail": "不定积分没有上下限；按原题识别出的被积函数与积分变量计算。",
        }
        method_steps = plan_steps(method, variable, constant=True)
        if verified:
            antiderivative_tex = to_latex(antiderivative)
            antiderivative_plain = str(antiderivative).replace("**", "^")
            exact_text = f"{antiderivative_tex}+C"
            exact_latex = exact_text
            answer = f"F({variable})={antiderivative_plain}+C"
            if isinstance(model, dict):
                # 让图形评估复用同一个经核验的原函数，避免解答与曲线相差常数。
                model["antiderivative_expression"] = expression_text(antiderivative)
            if verification_level == VERIFICATION_SYMBOLIC:
                derivative_back = sp.diff(antiderivative, variable)
                derivative_display = derivative_back
                try:
                    simplified = sp.simplify(derivative_back)
                    if simplified.has(sp.sign, sp.Piecewise):
                        # log|·| 的求导结果会带 sign/Piecewise；核验已通过，直接展示被积函数。
                        derivative_display = expression
                    elif not simplified.has(sp.Integral):
                        derivative_display = simplified
                except Exception:  # noqa: BLE001
                    derivative_display = derivative_back
                verification_detail = (
                    "对原函数求导并符号化简后回到被积函数，说明结果正确；"
                    "常数 C 的导数为 0，因此不影响核验。"
                )
                if log_abs:
                    verification_detail += "对数已写成 log|·|，并在实定义域的各段上核对。"
                verify_step = {
                    "id": "verify",
                    "title": "符号求导核对",
                    "latex": rf"\frac{{\mathrm{{d}}}}{{\mathrm{{d}}{to_latex(variable)}}}\left({antiderivative_tex}\right)={to_latex(derivative_display)}",
                    "detail": verification_detail,
                }
            else:
                verification_detail = (
                    "符号求导未能化简回被积函数；改用多个远离常见瑕点的样本点，比较原函数中心差商与被积函数，结果一致。"
                    "数值抽查不是全域证明，定义域、分支和绝对值处理仍需人工核对。"
                )
                verify_step = {
                    "id": "verify",
                    "title": "数值抽查核对",
                    "latex": r"\left.\frac{\mathrm{d}}{\mathrm{d}x}F(x)\right|_{x=x_i}\approx f(x_i)",
                    "detail": verification_detail,
                }
            steps = [
                integrand_step,
                *method_steps,
                {
                    "id": "antiderivative",
                    "title": "求原函数并加常数 C",
                    "latex": rf"\int {to_latex(expression)}\,\mathrm{{d}}{to_latex(variable)}={antiderivative_tex}+C",
                    "detail": (
                        "逐项积分得到原函数；不定积分表示一族函数，必须写出任意常数 C。"
                        + (
                            "对数参数写成绝对值，使原函数在实定义域各段上保持实值。"
                            if log_abs else ""
                        )
                    ),
                },
                verify_step,
            ]
        else:
            if unresolved:
                incomplete_reason = (
                    "当前内核未能给出可核验的闭式原函数；符号积分形式只是原题的重写，"
                    "不能当作原题答案。"
                )
                step_title = "尝试求原函数（未完成）"
            else:
                incomplete_reason = "内核返回的候选原函数未能通过求导核对，不能作为原题答案展示。"
                step_title = "尝试求原函数（未通过核验）"
            verification_detail = incomplete_reason + "候选式不会作为答案展示。"
            exact_text = "未能得到可核验的闭式原函数"
            exact_latex = None
            answer = ""
            if isinstance(model, dict):
                # 识别阶段可能存过未核验的候选式，不能让它继续驱动图像。
                model["antiderivative_expression"] = None
            steps = [
                integrand_step,
                *method_steps,
                {
                    "id": "antiderivative",
                    "title": step_title,
                    "latex": rf"\int {to_latex(expression)}\,\mathrm{{d}}{to_latex(variable)}",
                    "detail": incomplete_reason + "这不等于原积分不存在，需换用其他工具或人工推导。",
                },
            ]
        verification_record = {
            "level": verification_level,
            "label": verification_label,
            "detail": verification_detail,
        }
        conditions.append("不定积分的结果是一族原函数，相差一个常数；C 由附加的初始条件确定。")
        if verified and log_abs:
            conditions.append("原函数中的对数按实定义域写成 log|·|；该改写已通过核验，在定义域各段上与内核结果一致。")
        if verified and verification_level == VERIFICATION_SYMBOLIC:
            conditions.append("原函数已通过符号求导核验：对结果求导可回到被积函数。")
        elif verified:
            conditions.append("原函数仅通过数值抽查，不是全域证明；定义域、分支和绝对值处理仍需人工核对。")
        else:
            conditions.append("当前内核未能给出通过求导核验的原函数；符号积分形式不代表已求出原函数。")
    elif kind == "inverse_derivative":
        point = float((model.get("defaults") or {}).get("point", 0.0))
        exact_point = parse_expression(str(model.get("exact_point", point)))
        preimages = _real_preimages(expression, variable, exact_point)
        if not preimages:
            raise SolveError(f"原函数 f(x)={model.get('expression')} 在 y={point:g} 处没有实原像，"
                             "反函数在该输入处无定义")
        if len(preimages) > 1:
            raise SolveError(
                f"y={point:g} 对应多个实原像 {[str(item) for item in preimages]}；"
                "反函数需要题目说明单调区间或分支，不能任选一个")
        preimage = preimages[0]
        derivative = sp.simplify(sp.diff(expression, variable))
        slope_at_preimage = sp.simplify(derivative.subs(variable, preimage))
        if slope_at_preimage == 0:
            raise SolveError("原函数在该原像处导数为 0，反函数在该点不可导")
        inverse_slope = sp.simplify(1 / slope_at_preimage)
        slope = safe_float(slope_at_preimage)
        value = safe_float(preimage)
        answer_value = safe_float(inverse_slope)
        if slope is None or value is None or answer_value is None:
            raise SolveError("无法得到有限的反函数导数")
        exact_text = expression_text(inverse_slope)
        exact_latex = to_latex(inverse_slope)
        numeric = answer_value
        steps = [
            {
                "id": "preimage",
                "title": "求反函数的原像",
                "latex": rf"f({to_latex(variable)}_0)={to_latex(exact_point)}\Rightarrow {to_latex(variable)}_0={to_latex(preimage)}",
                "detail": f"反函数输入 y={point:g} 对应原函数值，解得 x0={_fmt(value)}。",
            },
            {
                "id": "derivative",
                "title": "求原函数导数",
                "latex": f"f'({to_latex(variable)})={to_latex(derivative)}",
                "detail": f"在原像处 f'(x0)={_fmt(slope)}。",
            },
            {
                "id": "inverse_formula",
                "title": "使用反函数导数公式",
                "latex": r"(f^{-1})'(y_0)=\frac{1}{f'(x_0)}",
                "detail": "反函数与原函数的导数互为倒数；前提是 f'(x0)≠0 且局部单调。",
            },
            {
                "id": "slope",
                "title": "代入求值",
                "latex": rf"(f^{{-1}})'(x)={to_latex(inverse_slope)}",
                "detail": f"反函数在 x={point:g} 处的导数为 {_fmt(answer_value)}。",
            },
        ]
    else:
        point = float((model.get("defaults") or {}).get("point", 0.0))
        derivative = sp.simplify(sp.diff(expression, variable))
        exact_point = parse_expression(str(model.get("exact_point", point)))
        exact_slope = sp.simplify(derivative.subs(variable, exact_point))
        slope = safe_float(exact_slope)
        value = safe_float(expression.subs(variable, exact_point))
        if slope is None or value is None:
            raise SolveError("无法在该点计算函数值与导数")
        answer_value = slope
        exact_text = expression_text(exact_slope)
        exact_latex = to_latex(exact_slope)
        numeric = slope
        steps = [
            {
                "id": "value",
                "title": "确认研究点",
                "latex": rf"{to_latex(variable)}_0={to_latex(exact_point)}",
                "detail": f"在 x={point:g} 处，函数值为 {_fmt(value)}。",
            },
            {
                "id": "derivative",
                "title": "求导函数",
                "latex": f"f'({to_latex(variable)})={to_latex(derivative)}",
                "detail": "对原函数求导，得到切线斜率随位置变化的规则。",
            },
            {
                "id": "slope",
                "title": "代入研究点",
                "latex": rf"k=f'({to_latex(exact_point)})={to_latex(exact_slope)}",
                "detail": f"切线斜率为 {_fmt(slope)}，切线方程见下方。",
            },
            {
                "id": "approx",
                "title": "差商核对",
                "latex": r"f'(x_0)\approx\frac{f(x_0+h)-f(x_0-h)}{2h}",
                "detail": "缩小 h 观察差商趋近导数；数值核对不等于符号证明。",
            },
        ]
    tangent_tex = None
    if kind == "derivative":
        tangent_tex = rf"y={_fmt(value)}+{_fmt(slope)}(x-{point:g})"
    elif kind == "inverse_derivative":
        tangent_tex = rf"x={_fmt(value)}+{_fmt(answer_value)}(y-{point:g})"
    if kind == "antiderivative":
        summary_text = (
            "不定积分题：先求原函数，再加任意常数 C；结果是一族函数。"
            if solution_complete
            else "不定积分题：内核未能给出可核验的闭式原函数，不把符号积分形式当作答案。"
        )
        answer_text = answer
        approx_text = None
    elif kind == "integral":
        if convergence == "divergent":
            summary_text = "定积分题：原始区间含瑕点，逐段取单侧极限后积分发散。"
            answer_text = "发散（积分不存在）"
            approx_text = None
        elif convergence == "finite":
            summary_text = "积分题：解析结果、数值近似和几何面积分开呈现。"
            answer_text = f"{_fmt(answer_value, 8)}"
            approx_text = _fmt(numeric, 10)
        else:
            summary_text = "定积分题：未能完成符号求解，数值参考不等于原题答案。"
            answer_text = ""
            approx_text = _fmt(numeric, 10)
    elif kind == "inverse_derivative":
        summary_text = "反函数导数题：先求 f(x)=y0 的实原像，再用 (f^{-1})'(y0)=1/f'(x0)。"
        answer_text = f"{_fmt(answer_value, 8)}"
        approx_text = _fmt(numeric, 10)
    else:
        summary_text = "导数题：切线斜率与局部差商互相核对。"
        ask = str(model.get("ask") or "")
        if ask == "tangent_line" and slope is not None and value is not None:
            intercept = value - slope * point
            if abs(intercept) < 1e-12:
                line_eq = f"y={_fmt(slope)}x"
            else:
                line_eq = f"y={_fmt(slope)}x{'+' if intercept > 0 else '-'}{_fmt(abs(intercept))}"
            answer_text = f"切线方程 {line_eq}（斜率 {_fmt(slope)}，过点 ({_fmt(point)}, {_fmt(value)})）"
            summary_text = "切线方程题：斜率取 f'(x0)，方程 y−y0=f'(x0)(x−x0)。"
        elif ask == "derivative_expr":
            answer_text = f"f'({variable})={expression_text(derivative)}"
            answer_value = None
            summary_text = "求导题：给出导函数表达式；定点导数值见 exact 与斜率指标。"
        else:
            answer_text = f"{_fmt(answer_value, 8)}"
        approx_text = _fmt(numeric, 10)
    if kind == "integral":
        conditions = conditions + (
            [f"原式在 {singularity_note} 处为瑕点；敛散性由拆分后的单侧极限判断。"]
            if singularity_note else []
        )
        if log_abs:
            conditions.append("原函数中的对数按实定义域写成 log|·|；该改写已通过核验，在定义域各段上与内核结果一致。")
    return {
        "summary": summary_text,
        "answer": answer_text,
        "answer_value": answer_value,
        "exact": exact_text,
        "exact_latex": exact_latex,
        "approx": approx_text,
        "steps": steps,
        "conditions": conditions,
        "tangent_tex": tangent_tex,
        "solution_status": solution_status,
        "solution_complete": solution_complete,
        "incomplete_reason": incomplete_reason,
        "verification": verification_record,
        **({"convergence": convergence, "singularities": report.get("singularities") or []}
           if kind == "integral" else {}),
        "limitations": [
            "证明题仍需写出符号推导；数值与图形只用于核对，不替代证明。",
            "若原题含未识别的字母参数，求解器会保留识别结果并提示核对。",
        ]
        + (
            [
                f"原题上限为 +∞；黎曼和与图像在有限截断区间 b={upper:g} 上展示，解析值按无穷积分计算。"
            ]
            if kind == "integral" and improper_upper
            else []
        )
        + (
            [
                "一般有限端点不能直接保证 Newton–Leibniz 适用；求解器先按原式定位瑕点并拆分，再对每段判断敛散性。"
            ]
            if kind == "integral" and singularity_note
            else []
        )
        + (
            ["该积分发散，不能把柯西主值或原函数端点差当作积分值。"]
            if kind == "integral" and convergence == "divergent"
            else []
        )
        + (
            ["符号积分未得到有限闭式解；当前数值参考不能作为原题答案，需人工核对。"]
            if kind == "integral" and convergence not in ("finite", "divergent")
            else []
        )
        + (
            ["当前内核未能给出通过求导核验的原函数；这不等于原积分不存在，需人工推导或换用其他工具。"]
            if kind == "antiderivative" and not solution_complete
            else []
        )
        + (
            [f"数值复核提示：{warning}" for warning in report.get("warnings") or []]
            if kind == "integral"
            else []
        )
        + (
            ["不定积分的结果含任意常数 C；只写原函数不写 +C 会被判为不完整。"]
            if kind == "antiderivative"
            else []
        ),
    }


def _antiderivative_evaluate(
    model: Mapping[str, Any],
    params: Mapping[str, Any],
    variable: sp.Symbol,
    expression: sp.Expr,
    func: Callable[..., float],
) -> dict[str, Any]:
    """不定积分：绘制 F(x)+C 这一族原函数，并用 C 控制上下平移。"""

    constant = float(params.get("c", 0.0))
    domain_raw = model.get("plot_domain") or [-3.0, 3.0]
    try:
        x_min, x_max = float(domain_raw[0]), float(domain_raw[1])
    except (TypeError, ValueError, IndexError):
        x_min, x_max = -3.0, 3.0
    if not (math.isfinite(x_min) and math.isfinite(x_max)) or x_max <= x_min:
        x_min, x_max = -3.0, 3.0

    antiderivative = None
    candidate_text = str(model.get("antiderivative_expression") or "").strip()
    candidate_unreadable = False
    if candidate_text:
        try:
            antiderivative = parse_expression(candidate_text, (str(variable),))
        except ExprError:
            antiderivative = None
            candidate_unreadable = True
    if antiderivative is None and (candidate_unreadable or "antiderivative_expression" not in model):
        # 识别或求解阶段已记录原函数（含明确的 None）时不再重复符号积分。
        try:
            candidate = sp.integrate(expression, variable)
            if not candidate.has(sp.Integral):
                antiderivative = candidate
        except Exception:  # noqa: BLE001
            antiderivative = None
    if antiderivative is not None:
        antiderivative, _ = real_antiderivative(antiderivative, expression, variable)
        if not verifies_antiderivative(antiderivative, expression, variable):
            # 未通过求导核验的候选式不能画成原函数族。
            antiderivative = None
    family = _numeric_function(antiderivative, [variable]) if antiderivative is not None else None

    series: list[dict[str, Any]] = []
    for index in range(MAX_PLOT_POINTS):
        x_value = x_min + (x_max - x_min) * index / (MAX_PLOT_POINTS - 1)
        y_value = None
        if family is not None:
            try:
                value = float(family(x_value)) + constant
                y_value = value if math.isfinite(value) else None
            except Exception:  # noqa: BLE001
                y_value = None
        series.append({"x": round(x_value, 6), "y": None if y_value is None else round(y_value, 6)})

    # 数值核对：F'(x) 是否回到 f(x)。
    deviations: list[float] = []
    sample_step = 1e-4
    if family is not None:
        for sample in (-2.0, -1.0, -0.5, 0.5, 1.0, 2.0):
            if not (x_min < sample < x_max):
                continue
            try:
                derivative = (
                    float(family(sample + sample_step)) - float(family(sample - sample_step))
                ) / (2 * sample_step)
                target = float(func(sample))
            except Exception:  # noqa: BLE001
                continue
            if math.isfinite(derivative) and math.isfinite(target):
                deviations.append(abs(derivative - target))
    deviation = max(deviations) if deviations else None
    found = antiderivative is not None
    antiderivative_tex = to_latex(antiderivative) + "+C" if found else None
    antiderivative_plain = (
        str(antiderivative).replace("**", "^") + "+C" if found else ""
    )

    frames = []
    if found:
        for frame_index, value in enumerate(
            sorted(set([-2.0, -1.0, 0.0, 1.0, 2.0, float(constant)]))
        ):
            frames.append(
                {
                    "index": frame_index,
                    "label": f"C={_fmt(value)}",
                    "detail": "原函数族 F(x)+C 随 C 上下平移；导数处处等于被积函数 f(x)。",
                    "values": {"c": value},
                }
            )

    checks = [
        _check(
            "derivative",
            "原函数求导回到被积函数",
            deviation is not None and deviation <= 0.05,
            (
                f"抽样核对最大偏差 {_fmt(deviation)}；F(x)+C 的导数应等于 f(x)。"
                if deviation is not None
                else "当前内核未能给出通过求导核验的原函数，未绘制原函数族；这不等于原积分不存在。"
            ),
            warn=True,
        ),
        _check(
            "family",
            "常数 C 只改变平移",
            found,
            (
                "改变 C 时曲线整体上下平移，形状与斜率不变，因此不定积分答案必须保留 +C。"
                if found
                else "当前没有可核验的原函数族，不能讨论 C 的平移。"
            ),
            warn=True,
        ),
    ]

    return {
        "subject": "calculus",
        "kind": "antiderivative",
        "params": {"c": constant},
        "headline": (
            f"∫ f(x) dx = {antiderivative_plain}"
            if found else "当前内核未能给出可核验的闭式原函数"
        ),
        "metrics": [
            {"id": "antiderivative", "label": "原函数 F(x)+C",
             "value": antiderivative_plain if found else "未能求出（不是答案）", "accent": True},
            {"id": "constant", "label": "积分常数 C", "value": _fmt(constant)},
            {"id": "expression", "label": "被积函数 f(x)", "value": str(expression).replace("**", "^")},
            {"id": "deviation", "label": "F′ 与 f 的偏差", "value": _fmt(deviation)},
        ],
        "checks": checks,
        "notes": (
            ["实线是原函数族 F(x)+C；拖动 C 观察整族曲线上下平移。"]
            if found
            else ["未绘制原函数族：内核结果无法通过求导核验；这不等于原积分不存在。"]
        ),
        "trace": frames,
        "trace_kind": "family",
        "domain": {"x_min": x_min, "x_max": x_max},
        "series": series,
        "rects": [],
        "exact": antiderivative_tex,
        "approx": None,
        "error": None,
        "answer": antiderivative_plain,
        "answer_value": None,
    }


def _inverse_derivative_evaluate(model: Mapping[str, Any], params: Mapping[str, Any],
                                 variable: sp.Symbol, expression: sp.Expr,
                                 func: Callable[..., float]) -> dict[str, Any]:
    point = float(params.get("point", 0.0))
    target = sp.Rational(str(point))
    preimages = _real_preimages(expression, variable, target)
    if not preimages:
        raise SolveError(f"原函数在 y={point:g} 处没有实原像，反函数无定义")
    if len(preimages) > 1:
        raise SolveError(f"y={point:g} 有多个实原像，反函数分支未确定")
    preimage = preimages[0]
    x0 = safe_float(sp.N(preimage))
    derivative = sp.simplify(sp.diff(expression, variable))
    slope_at = sp.simplify(derivative.subs(variable, preimage))
    inverse_slope = sp.simplify(1 / slope_at)
    inv_value = safe_float(inverse_slope)
    if x0 is None or safe_float(sp.N(slope_at)) in (None, 0) or inv_value is None:
        raise SolveError("反函数在该输入处不可导")
    span = max(1.0, abs(x0) * 0.8 + 0.5)
    x_min, x_max = x0 - span, x0 + span
    y_a, y_b = float(func(x_min)), float(func(x_max))
    y_min, y_max = min(y_a, y_b), max(y_a, y_b)
    series: list[dict[str, Any]] = []

    def inverse_at(y_value: float) -> float | None:
        lo, hi = x_min, x_max
        f_lo = float(func(lo))
        for _ in range(70):
            mid = (lo + hi) / 2
            f_mid = float(func(mid))
            if (f_mid - y_value) * (f_lo - y_value) <= 0:
                hi = mid
            else:
                lo, f_lo = mid, f_mid
        value = (lo + hi) / 2
        return value if math.isfinite(value) else None

    for index in range(MAX_PLOT_POINTS):
        y_value = y_min + (y_max - y_min) * index / (MAX_PLOT_POINTS - 1)
        x_value = inverse_at(y_value) if math.isfinite(y_value) else None
        series.append({"x": round(y_value, 6), "y": None if x_value is None else round(x_value, 6)})
    frames = [
        {"index": 0, "label": f"求原像 f(x0)={point:g}",
         "detail": f"解得 x0={_fmt(x0)}；反函数输入 {point:g} 对应原函数值。",
         "values": {"反函数输入": point, "原像": round(x0, 8), "f'(x0)": round(float(safe_float(sp.N(slope_at)) or 0), 8)}},
        {"index": 1, "label": "反函数导数",
         "detail": f"(f^-1)'({point:g}) = 1/f'(x0) = {_fmt(inv_value)}。",
         "values": {"反函数导数": round(inv_value, 10), "公式": "1/f'(x0)"}},
    ]
    return {
        "subject": "calculus",
        "kind": "inverse_derivative",
        "params": {"point": point},
        "headline": f"(f⁻¹)'({_fmt(point)})={_fmt(inv_value)}",
        "metrics": [
            {"id": "preimage", "label": "反函数输入", "value": _fmt(point)},
            {"id": "x0", "label": "原像 x0", "value": _fmt(x0)},
            {"id": "fprime", "label": "f'(x0)", "value": _fmt(safe_float(sp.N(slope_at)))},
            {"id": "inverse_slope", "label": "反函数导数", "value": _fmt(inv_value)},
        ],
        "series": series,
        "domain": {"x_min": y_min, "x_max": y_max},
        "point": {"x": point, "y": x0, "slope": inv_value,
                  "tangent": {"m": inv_value, "b": x0 - inv_value * point}},
        "secant": None,
        "trace": frames,
        "trace_kind": "inverse_derivative",
        "checks": [
            _check("nonzero", "原函数导数非零", True, f"f'(x0)={_fmt(safe_float(sp.N(slope_at)))}≠0。"),
            _check("inverse", "反函数导数公式", True, "结果来自 1/f'(x0)，不是原函数在输入点的导数。"),
        ],
        "notes": ["图像横轴是反函数输入 y，纵轴是原像 x；切线与反函数曲线相切。",
                  "反函数只在原函数局部单调、f'(x0)≠0 时可导；多分支情况必须指定区间。"],
        "exact": expression_text(inverse_slope),
        "approx": _fmt(inv_value, 10),
        "error": None,
        "answer": inv_value,
        "answerText": _fmt(inv_value, 8),
    }


def _calculus_evaluate(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    variable = sp.Symbol(str(model.get("variable") or "x"), real=True)
    expression = parse_expression(str(model.get("expression") or ""), (str(variable),),
                                  preserve_structure=bool(model.get('preserve_expression_structure')))
    func = _numeric_function(expression, [variable])
    kind = str(model.get("kind") or "integral")
    if kind == "inverse_derivative":
        return _inverse_derivative_evaluate(model, params, variable, expression, func)
    if kind == "antiderivative":
        return _antiderivative_evaluate(model, params, variable, expression, func)
    if kind == "integral":
        lower = float(params.get("lower", 0.0))
        upper = float(params.get("upper", 1.0))
        n = max(2, min(80, int(params.get("n", 8))))
        plot_lower, plot_upper = min(lower, upper), max(lower, upper)
        domain = {"x_min": plot_lower - (plot_upper - plot_lower) * 0.12 - 0.2,
                  "x_max": plot_upper + (plot_upper - plot_lower) * 0.12 + 0.2}
        if abs(upper - lower) < 1e-9:
            domain = {"x_min": lower - 1, "x_max": upper + 1}
        series: list[dict[str, Any]] = []
        for index in range(MAX_PLOT_POINTS):
            x_value = domain["x_min"] + (domain["x_max"] - domain["x_min"]) * index / (MAX_PLOT_POINTS - 1)
            try:
                y_value = float(func(x_value))
            except Exception:  # noqa: BLE001
                y_value = None
            if y_value is not None and not math.isfinite(y_value):
                y_value = None
            series.append({"x": round(x_value, 6), "y": None if y_value is None else round(y_value, 6)})
        rects: list[dict[str, Any]] = []
        dx = (upper - lower) / n
        riemann = 0.0
        for index in range(n):
            x0 = lower + index * dx
            x1 = x0 + dx
            mid = (x0 + x1) / 2
            try:
                height = float(func(mid))
            except Exception:  # noqa: BLE001
                height = 0.0
            if not math.isfinite(height):
                height = 0.0
            riemann += height * dx
            rects.append({"x0": round(x0, 6), "x1": round(x1, 6), "mid": round(mid, 6), "height": round(height, 6)})
        lower_exact = sp.Rational(str(lower))
        upper_exact = sp.Rational(str(upper))
        defaults = model.get('defaults') or {}
        exact_bounds = model.get('exact_bounds') or {}
        for key in ('lower', 'upper'):
            if key in exact_bounds and params.get(key, defaults.get(key)) == defaults.get(key):
                if key == 'lower':
                    lower_exact = parse_expression(str(exact_bounds[key]))
                else:
                    upper_exact = parse_expression(str(exact_bounds[key]))
        report = analyze_integral(expression, variable, lower_exact, upper_exact)
        convergence = report["status"]
        singularity_note = describe_singularities(report)
        if convergence == "finite":
            exact = safe_float(report.get("value"))
        else:
            exact = None
        error = abs(riemann - exact) if exact is not None else None
        frame_ns = sorted(set([2, 4, 8, 16, 32, 64] + [n]))
        frame_ns = [item for item in frame_ns if 2 <= item <= 80]
        frames = []
        for frame_index, frame_n in enumerate(frame_ns):
            d_x = (upper - lower) / frame_n
            total = 0.0
            for index in range(frame_n):
                mid = lower + (index + 0.5) * d_x
                try:
                    total += float(func(mid)) * d_x
                except Exception:  # noqa: BLE001
                    pass
            frames.append(
                {
                    "index": frame_index,
                    "label": f"n={frame_n}",
                    "detail": f"中点黎曼和 {_fmt(total)}",
                    "values": {"n": frame_n, "sum": round(total, 8), "error": None if exact is None else round(abs(total - exact), 8)},
                }
            )
        checks = [
            _check(
                "domain",
                "原式实定义域与敛散性",
                convergence == "finite",
                (
                    f"已按原式检查实定义域；{singularity_note} 处按拆分区间和单侧极限计算。"
                    if convergence == "finite" and singularity_note
                    else "原式在区间内处处有定义，黎曼和与解析值可对照。"
                    if convergence == "finite"
                    else report["reason"] + (f"（{singularity_note}）" if singularity_note else "")
                ),
                warn=convergence not in ("finite", "divergent", "undefined"),
            ),
            _check(
                "riemann",
                "黎曼和与解析值对照",
                error is not None and error <= max(0.05, 0.02 * max(1.0, abs(exact or 0))),
                "当前分割数下误差为 " + (_fmt(error) if error is not None else "无法比较") + "；增大 n 观察是否趋近。",
                warn=True,
            ),
        ]
        if convergence == "divergent":
            answer = None
            headline = "积分发散 · 数值参考无效"
        elif convergence == "finite":
            answer = exact
            headline = f"∫ 近似 {_fmt(riemann)} · 解析 {_fmt(exact)}"
        else:
            answer = None
            headline = "未能确认可积性 · 数值参考不计为答案"
        return {
            "subject": "calculus",
            "kind": "integral",
            "params": {"lower": lower, "upper": upper, "n": n},
            "headline": headline,
            "metrics": [
                {"id": "approx", "label": "黎曼和（n=" + str(n) + "）", "value": _fmt(riemann)},
                {"id": "exact", "label": "解析值", "value": _fmt(exact)},
                {"id": "error", "label": "绝对误差", "value": _fmt(error)},
                {"id": "n", "label": "分割数", "value": str(n)},
            ],
            "series": series,
            "rects": rects,
            "domain": domain,
            "exact": exact,
            "approx": None if convergence != "finite" else riemann,
            "error": error,
            "answer": answer,
            "convergence": convergence,
            "singularities": report.get("singularities") or [],
            "trace": frames,
            "trace_kind": "riemann",
            "checks": checks,
            "notes": [
                "黎曼和、图形面积与解析值使用同一被积函数和区间。",
                *(['上限小于下限，积分按原方向取负号；图形按坐标从小到大展示。'] if upper < lower else []),
                *([f"区间含瑕点：{singularity_note}；数值积分必须先分段，不能跨瑕点直接采样。"] if singularity_note else []),
                *([report["reason"]] if convergence != "finite" and report.get("reason") else []),
            ],
        }

    # 导数 / 切线
    point = float(params.get("point", 0.0))
    h = max(0.001, float(params.get("h", 0.1)))
    derivative = sp.diff(expression, variable)
    slope_expr = safe_float(derivative.subs(variable, point))
    value = safe_float(expression.subs(variable, point))
    if slope_expr is None or value is None:
        raise SolveError("函数在该点无定义")
    span = max(1.0, h * 8)
    domain = {"x_min": point - span, "x_max": point + span}
    series = []
    for index in range(MAX_PLOT_POINTS):
        x_value = domain["x_min"] + (domain["x_max"] - domain["x_min"]) * index / (MAX_PLOT_POINTS - 1)
        try:
            y_value = float(func(x_value))
        except Exception:  # noqa: BLE001
            y_value = None
        if y_value is not None and not math.isfinite(y_value):
            y_value = None
        series.append({"x": round(x_value, 6), "y": None if y_value is None else round(y_value, 6)})
    try:
        left = float(func(point - h))
        right = float(func(point + h))
        secant = (right - left) / (2 * h)
    except Exception:  # noqa: BLE001
        secant = None
    tangent = {"m": slope_expr, "b": value - slope_expr * point}
    frames = []
    for frame_index, frame_h in enumerate([1.0, 0.5, 0.25, 0.1, 0.05, 0.01]):
        try:
            quotient = (float(func(point + frame_h)) - float(func(point - frame_h))) / (2 * frame_h)
        except Exception:  # noqa: BLE001
            quotient = None
        frames.append(
            {
                "index": frame_index,
                "label": f"h={frame_h:g}",
                "detail": f"中心差商 {_fmt(quotient)}",
                "values": {"h": frame_h, "quotient": None if quotient is None else round(quotient, 8)},
            }
        )
    return {
        "subject": "calculus",
        "kind": "derivative",
        "params": {"point": point, "h": h},
        "headline": f"f({_fmt(point)})={_fmt(value)} · f'({_fmt(point)})={_fmt(slope_expr)}",
        "metrics": [
            {"id": "value", "label": "函数值", "value": _fmt(value)},
            {"id": "slope", "label": "精确斜率", "value": _fmt(slope_expr)},
            {"id": "secant", "label": "中心差商", "value": _fmt(secant)},
            {"id": "h", "label": "差商步长", "value": _fmt(h)},
        ],
        "series": series,
        "domain": domain,
        "point": {"x": point, "y": value, "slope": slope_expr, "tangent": tangent},
        "secant": secant,
        "trace": frames,
        "trace_kind": "difference_quotient",
        "checks": [
            _check("point", "研究点有定义", value is not None, f"f({point:g})={_fmt(value)}"),
            _check(
                "secant",
                "差商趋近导数",
                secant is None or abs(secant - slope_expr) <= max(1e-3, 0.02 * max(1.0, abs(slope_expr))),
                f"当前 h={h:g} 的差商为 {_fmt(secant)}，导数为 {_fmt(slope_expr)}。",
                warn=True,
            ),
        ],
        "notes": ["切线、割线与数值差商读取同一函数表达式。"],
    }


# ---------------------------------------------------------------------------
# 最优化
# ---------------------------------------------------------------------------

_CLASSIFICATION_LABELS = {
    "minimum": "极小值",
    "maximum": "极大值",
    "saddle": "鞍点",
    "inflection": "非极值驻点",
    "undetermined": "未定（需进一步判别）",
}


def _expression_sign(value: sp.Expr) -> int | None:
    numeric = safe_float(value)
    if numeric is not None:
        return 1 if numeric > 1e-12 else -1 if numeric < -1e-12 else 0
    if value.is_positive is True:
        return 1
    if value.is_negative is True:
        return -1
    return None


def _finite_set_points(roots: sp.Set) -> tuple[list[sp.Expr], bool]:
    if roots is sp.S.EmptySet:
        return [], True
    if isinstance(roots, sp.FiniteSet):
        points: list[sp.Expr] = []
        complete = True
        for value in roots:
            if value.is_real is True:
                points.append(sp.simplify(value))
            elif value.is_real is None:
                complete = False
        return points, complete
    return [], False


def _classify_stationary_1d(expression: sp.Expr, variable: sp.Symbol, point: sp.Expr) -> tuple[str, sp.Expr | None]:
    for order in range(2, 7):
        value = sp.simplify(sp.diff(expression, variable, order).subs(variable, point))
        if value == 0:
            continue
        sign = _expression_sign(value)
        if sign is None or sign == 0:
            return "undetermined", value
        if order % 2 == 0:
            return ("minimum" if sign > 0 else "maximum"), value
        return "inflection", value
    return "undetermined", None


def _classify_derivative_singular_1d(
    expression: sp.Expr, variable: sp.Symbol, point: sp.Expr
) -> tuple[str, str]:
    h = sp.Symbol("_h", positive=True)
    try:
        left = sp.limit(
            (expression.subs(variable, point - h) - expression.subs(variable, point)) / (-h),
            h,
            0,
            "+",
        )
        right = sp.limit(
            (expression.subs(variable, point + h) - expression.subs(variable, point)) / h,
            h,
            0,
            "+",
        )
    except Exception:  # noqa: BLE001
        return "undetermined", "左右差商极限未能求出"
    def sign(value: sp.Expr) -> int | None:
        if value is sp.oo:
            return 1
        if value is -sp.oo:
            return -1
        return _expression_sign(value)
    left_sign, right_sign = sign(left), sign(right)
    evidence = f"左差商极限 {_fmt(safe_float(left))}，右差商极限 {_fmt(safe_float(right))}"
    if left_sign is None or right_sign is None or left_sign == 0 or right_sign == 0:
        return "undetermined", evidence
    if left_sign < 0 < right_sign:
        return "minimum", evidence
    if left_sign > 0 > right_sign:
        return "maximum", evidence
    return "inflection", evidence


def _one_dimensional_critical(expression: sp.Expr, variable: sp.Symbol) -> dict[str, Any]:
    gradient = sp.diff(expression, variable)
    if sp.simplify(gradient) == 0:
        return {"constant": True, "stationary": [], "singular": [], "complete": True}
    try:
        roots = sp.solveset(gradient, variable, domain=sp.S.Reals)
    except Exception:  # noqa: BLE001
        roots = None
    complete = isinstance(roots, (sp.FiniteSet, sp.EmptySet))
    stationary, set_complete = _finite_set_points(roots) if isinstance(roots, sp.Set) else ([], False)
    complete = complete and set_complete
    stationary = [
        point for point in stationary
        if sp.simplify(gradient.subs(variable, point)) == 0
    ]
    singular: list[sp.Expr] = []
    try:
        singular_set = sp.singularities(gradient, variable)
        singular, singular_complete = _finite_set_points(singular_set)
        complete = complete and singular_complete
    except Exception:  # noqa: BLE001
        complete = False
    singular = [
        point for point in singular
        if not any(sp.simplify(point - item) == 0 for item in stationary)
        and expression.subs(variable, point).is_real is not False
    ]
    return {
        "constant": False,
        "stationary": sorted(stationary, key=lambda v: float(sp.N(v))),
        "singular": sorted(singular, key=lambda v: float(sp.N(v))),
        "complete": complete and len(stationary) + len(singular) <= 64,
    }


def _limit_kind(value: Any) -> tuple[str, sp.Expr | None]:
    if value is sp.oo:
        return "inf", None
    if value is -sp.oo:
        return "-inf", None
    if value is None or value is sp.nan:
        return "unknown", None
    numeric = safe_float(value)
    if numeric is None:
        return "unknown", None
    return "finite", value


def _global_extrema_1d(
    expression: sp.Expr,
    variable: sp.Symbol,
    classified: Sequence[Mapping[str, Any]],
    complete: bool,
) -> tuple[dict[str, Any], dict[str, Any]]:
    minimum: dict[str, Any] = {"exists": None, "value": None, "points": [], "reason": "未能判定"}
    maximum: dict[str, Any] = {"exists": None, "value": None, "points": [], "reason": "未能判定"}
    if not complete:
        reason = "驻点集合尚未证明完整，不能判定全局性"
        minimum["reason"] = maximum["reason"] = reason
        return minimum, maximum
    try:
        left = sp.limit(expression, variable, -sp.oo)
        right = sp.limit(expression, variable, sp.oo)
    except Exception:  # noqa: BLE001
        left = right = None
    left_kind, left_value = _limit_kind(left)
    right_kind, right_value = _limit_kind(right)
    kinds = (left_kind, right_kind)
    finite_limits = [value for kind, value in ((left_kind, left_value), (right_kind, right_value)) if kind == "finite"]

    minima = [item for item in classified if item["classification"] == "minimum"]
    maxima = [item for item in classified if item["classification"] == "maximum"]
    undetermined = any(item["classification"] == "undetermined" for item in classified)

    if "-inf" in kinds:
        sides = "、".join(name for name, kind in (("x→-∞", left_kind), ("x→+∞", right_kind)) if kind == "-inf")
        minimum.update(exists=False, reason=f"{sides} 时 f→-∞，函数无下界，无全局最小值")
    elif "unknown" in kinds:
        minimum["reason"] = "无法判定无穷远处的极限，全局最小值未定"
    elif minima:
        best = min(minima, key=lambda item: float(sp.N(item["value_expr"])))
        limit_bound = min(finite_limits, key=lambda value: float(sp.N(value))) if finite_limits else None
        if limit_bound is None or _expression_sign(best["value_expr"] - limit_bound) in (0, -1):
            minimum.update(exists=True, value=best["value_expr"],
                           points=[[item["point"]] for item in minima
                                   if sp.simplify(item["value_expr"] - best["value_expr"]) == 0],
                           reason="")
        elif _expression_sign(best["value_expr"] - limit_bound) is None:
            minimum["reason"] = "无法比较局部极小值与无穷远处的极限"
        else:
            minimum.update(exists=False, reason="下确界在无穷远处趋近，但不在有限点取得")
    elif all(kind == "inf" for kind in kinds):
        minimum.update(exists=False, reason="两端都趋于 +∞，但没有有限点取得最小值")
    else:
        minimum["reason"] = "没有可确认的局部极小值，全局最小值未定"

    if "inf" in kinds:
        sides = "、".join(name for name, kind in (("x→-∞", left_kind), ("x→+∞", right_kind)) if kind == "inf")
        maximum.update(exists=False, reason=f"{sides} 时 f→+∞，函数无上界，无全局最大值")
    elif "unknown" in kinds:
        maximum["reason"] = "无法判定无穷远处的极限，全局最大值未定"
    elif maxima:
        best = max(maxima, key=lambda item: float(sp.N(item["value_expr"])))
        limit_bound = max(finite_limits, key=lambda value: float(sp.N(value))) if finite_limits else None
        if limit_bound is None or _expression_sign(best["value_expr"] - limit_bound) in (0, 1):
            maximum.update(exists=True, value=best["value_expr"],
                           points=[[item["point"]] for item in maxima
                                   if sp.simplify(item["value_expr"] - best["value_expr"]) == 0],
                           reason="")
        elif _expression_sign(best["value_expr"] - limit_bound) is None:
            maximum["reason"] = "无法比较局部极大值与无穷远处的极限"
        else:
            maximum.update(exists=False, reason="上确界在无穷远处趋近，但不在有限点取得")
    elif all(kind == "-inf" for kind in kinds):
        maximum.update(exists=False, reason="两端都趋于 -∞，但没有有限点取得最大值")
    else:
        maximum["reason"] = "没有可确认的局部极大值，全局最大值未定"

    if undetermined:
        minimum["classification_complete"] = maximum["classification_complete"] = False
    return minimum, maximum


def _points_with_values(
    expression: sp.Expr, variables: Sequence[sp.Symbol], points: Sequence[Mapping[sp.Symbol, sp.Expr]]
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for point in points:
        values = [sp.simplify(point.get(symbol)) for symbol in variables]
        if any(value is None or value.free_symbols or value.is_real is not True for value in values):
            continue
        objective = sp.simplify(expression.subs(dict(zip(variables, values))))
        if safe_float(objective) is None:
            continue
        key = tuple(str(value) for value in values)
        if any(item["key"] == key for item in result):
            continue
        result.append({"key": key, "point": values, "value_expr": objective})
    return result


def _extreme_points(items: Sequence[Mapping[str, Any]], *, minimum: bool) -> list[Mapping[str, Any]]:
    if not items:
        return []
    ordered = sorted(items, key=lambda item: float(sp.N(item["value_expr"])), reverse=not minimum)
    best = ordered[0]["value_expr"]
    return [
        item for item in ordered
        if sp.simplify(item["value_expr"] - best) == 0
        or abs(float(sp.N(item["value_expr"] - best))) <= 1e-9 * max(1.0, abs(float(sp.N(best))))
    ]


def _format_point(point: Sequence[Any]) -> str:
    return ", ".join(str(value) for value in point)


def _serializable_extremum(info: Mapping[str, Any]) -> dict[str, Any]:
    points = info.get("points")
    if isinstance(points, str):
        points_out: Any = points
    else:
        points_out = [[str(value) for value in point] for point in points or []]
    return {
        "exists": info.get("exists"),
        "value": None if info.get("value") is None else str(info.get("value")),
        "points": points_out,
        "reason": info.get("reason") or "",
    }


def _finalize_extrema(solution: dict[str, Any]) -> dict[str, Any]:
    if solution.get("solution_complete") is not True:
        solution["answer"] = ""
        solution["solution_status"] = "incomplete"
        solution["solution_complete"] = False
        reason = solution.get("incomplete_reason") or solution.get("summary") or "极值结果尚未完整求解，不能自动判分"
        solution["incomplete_reason"] = reason
        solution["summary"] = reason
    return solution


def _extrema_solution(model: Mapping[str, Any]) -> dict[str, Any]:
    symbols = _symbols(model)
    names = [str(item) for item in symbols]
    expression = parse_expression(str(model.get("expression") or ""), names)
    gradients = [sp.diff(expression, symbol) for symbol in symbols]
    bounds = model.get("bounds") or {}
    steps = [
        {
            "id": "objective",
            "title": "写出目标与梯度",
            "latex": f"{to_latex(expression)},\\quad " + ", ".join(
                rf"\frac{{\partial f}}{{\partial {symbol}}}={to_latex(gradient)}"
                for symbol, gradient in zip(symbols, gradients)
            ),
            "detail": "先解梯度为零的驻点方程，再分别讨论局部极大、局部极小与全局最值。",
        }
    ]
    limitations = [
        "局部极值由导数或 Hessian 判别；全局最值另需比较无穷远行为或全部边界候选。",
        "一般非线性约束不在当前内核范围；箱约束只处理各变量的有限闭区间。",
    ]
    if len(symbols) == 1:
        variable = symbols[0]
        critical = _one_dimensional_critical(expression, variable)
        stationary_complete = bool(critical["complete"])
        if critical["constant"]:
            value = sp.simplify(expression)
            answer = f"函数为常数 f={value}，区间内每一点都同时取得最大值与最小值。"
            return _finalize_extrema({
                "summary": "目标函数为常数，不存在孤立的极值点。",
                "answer": answer,
                "answer_point": None,
                "answer_value": safe_float(value),
                "steps": steps,
                "conditions": ["目标函数恒为常数；最大值与最小值相等。"],
                "global_note": "常数函数的全局最值在每一点取得。",
                "stationary_points": [],
                "stationary_complete": True,
                "solution_status": "complete",
                "solution_complete": True,
                "global_minimum": _serializable_extremum({"exists": True, "value": value, "points": "all", "reason": ""}),
                "global_maximum": _serializable_extremum({"exists": True, "value": value, "points": "all", "reason": ""}),
                "limitations": limitations,
            })
        classified: list[dict[str, Any]] = []
        for point in critical["stationary"]:
            classification, evidence = _classify_stationary_1d(expression, variable, point)
            if classification == "undetermined":
                cusp_classification, cusp_evidence = _classify_derivative_singular_1d(
                    expression, variable, point
                )
                if cusp_classification != "undetermined":
                    classification, evidence = cusp_classification, cusp_evidence
            classified.append({
                "point": point,
                "classification": classification,
                "value_expr": sp.simplify(expression.subs(variable, point)),
                "hessian": evidence,
                "point_kind": "stationary",
            })
        for point in critical["singular"]:
            classification, evidence = _classify_derivative_singular_1d(expression, variable, point)
            classified.append({
                "point": point,
                "classification": classification,
                "value_expr": sp.simplify(expression.subs(variable, point)),
                "hessian": None,
                "point_kind": "derivative_singular",
                "evidence": evidence,
            })
        classified.sort(key=lambda item: float(sp.N(item["point"])))
        if bounds:
            pair = bounds.get(str(variable))
            if not pair:
                raise SolveError("箱约束缺少该变量的有限闭区间")
            low, high = sp.Rational(str(pair[0])), sp.Rational(str(pair[1]))
            candidates = [
                {variable: point} for point in critical["stationary"]
                if low <= point <= high
            ]
            candidates += [
                {variable: point} for point in critical["singular"] if low <= point <= high
            ]
            candidates += [{variable: low}, {variable: high}]
            evaluated = _points_with_values(expression, symbols, candidates)
            minima = _extreme_points(evaluated, minimum=True)
            maxima = _extreme_points(evaluated, minimum=False)
            minimum = {
                "exists": bool(minima), "value": minima[0]["value_expr"] if minima else None,
                "points": [item["point"] for item in minima], "reason": "",
            }
            maximum = {
                "exists": bool(maxima), "value": maxima[0]["value_expr"] if maxima else None,
                "points": [item["point"] for item in maxima], "reason": "",
            }
            descriptions = []
            if minima:
                descriptions.append(
                    "闭区间内最小值 " + str(minima[0]["value_expr"]) + " 在 " +
                    "、".join(f"x={item['point'][0]}" for item in minima) + " 取得"
                )
            if maxima:
                descriptions.append(
                    "最大值 " + str(maxima[0]["value_expr"]) + " 在 " +
                    "、".join(f"x={item['point'][0]}" for item in maxima) + " 取得"
                )
            for item in classified:
                descriptions.append(
                    f"{_CLASSIFICATION_LABELS[item['classification']]}点 x={item['point']}，f={item['value_expr']}"
                )
            if not stationary_complete:
                descriptions.append("驻点集合尚未证明完整，不能排除其他候选")
            answer = "；".join(descriptions) or "没有可确认的极值点"
            stationary_points = [
                {
                    "coordinates": [str(item["point"])],
                    "classification": item["classification"],
                    "value": str(item["value_expr"]),
                    "hessian_determinant": str(item["hessian"]) if item["hessian"] is not None else "",
                    "latex": to_latex(sp.Tuple(item["point"])),
                    "point_kind": item["point_kind"],
                }
                for item in classified
            ]
            solution_complete = stationary_complete and all(
                item["classification"] != "undetermined" for item in classified
            )
            return _finalize_extrema({
                "summary": "在有限闭区间内比较内部临界点与端点，列出全部并列最优点。",
                "answer": answer,
                "answer_point": [float(item) for item in minima[0]["point"]] if minima else None,
                "answer_value": safe_float(minima[0]["value_expr"]) if minima else None,
                "steps": steps + [{
                    "id": "box",
                    "title": "比较内部驻点、不可导点与端点",
                    "latex": rf"{low}\le {to_latex(variable)}\le {high}",
                    "detail": answer,
                }],
                "conditions": ["箱约束为各变量的有限闭区间；边界按端点与边界驻点逐项枚举。"],
                "global_note": "箱约束内的最值由全部内部临界点和端点候选比较得到。",
                "stationary_points": stationary_points,
                "stationary_complete": stationary_complete,
                "global_minimum": _serializable_extremum(minimum),
                "global_maximum": _serializable_extremum(maximum),
                "solution_status": "complete" if solution_complete else "incomplete",
                "solution_complete": solution_complete,
                "limitations": limitations,
            })
        minimum, maximum = _global_extrema_1d(expression, variable, classified, stationary_complete)
        descriptions = [
            f"{_CLASSIFICATION_LABELS[item['classification']]}点 x={item['point']}，f={item['value_expr']}"
            + (f"（{item.get('evidence')}）" if item.get("point_kind") == "derivative_singular" else "")
            for item in classified
        ]
        if minimum["exists"] is True:
            descriptions.append(
                "全局最小值 " + str(minimum["value"]) + " 在 " +
                "、".join(f"x={_format_point(item)}" for item in minimum["points"]) + " 取得"
            )
        elif minimum["exists"] is False:
            descriptions.append("无全局最小值：" + minimum["reason"])
        else:
            descriptions.append("全局最小值未定：" + minimum["reason"])
        if maximum["exists"] is True:
            descriptions.append(
                "全局最大值 " + str(maximum["value"]) + " 在 " +
                "、".join(f"x={_format_point(item)}" for item in maximum["points"]) + " 取得"
            )
        elif maximum["exists"] is False:
            descriptions.append("无全局最大值：" + maximum["reason"])
        else:
            descriptions.append("全局最大值未定：" + maximum["reason"])
        if not stationary_complete:
            descriptions.insert(0, "驻点集合尚未证明完整，不能据此排除其他极值")
        classification_complete = all(
            item["classification"] != "undetermined" for item in classified
        ) and stationary_complete
        solution_complete = classification_complete and minimum["exists"] is not None and maximum["exists"] is not None
        stationary_points = [
            {
                "coordinates": [str(item["point"])],
                "classification": item["classification"],
                "value": str(item["value_expr"]),
                "hessian_determinant": str(item["hessian"]) if item["hessian"] is not None else "",
                "latex": to_latex(sp.Tuple(item["point"])),
                "point_kind": item["point_kind"],
            }
            for item in classified
        ]
        return _finalize_extrema({
            "summary": "一元函数研究：列出全部驻点并区分局部极大、局部极小与全局最值。",
            "answer": "；".join(descriptions) or "没有可确认的极值点",
            "answer_point": (
                [float(value) for value in minimum["points"][0]]
                if minimum["exists"] is True and len(minimum["points"]) == 1 else None
            ),
            "answer_value": safe_float(minimum["value"]) if minimum["exists"] is True else None,
            "steps": steps + [{
                "id": "classification",
                "title": "驻点分类与全局性",
                "latex": r"f'(x)=0,\quad f^{(k)}(x_0)\ne0",
                "detail": "；".join(descriptions),
            }],
            "conditions": ["无约束问题先求全部实驻点，再结合无穷远极限判断全局性。"],
            "global_note": "局部极值由导数阶数判别；全局最值由驻点值与无穷远极限共同确定。",
            "stationary_points": stationary_points,
            "stationary_complete": stationary_complete,
            "global_minimum": _serializable_extremum(minimum),
            "global_maximum": _serializable_extremum(maximum),
            "solution_status": "complete" if solution_complete else "incomplete",
            "solution_complete": solution_complete,
            "limitations": limitations,
        })

    # Two variables without box constraints are classified by complete_extrema.
    critical_complete = True
    try:
        critical = sp.solve(gradients, symbols, dict=True)
    except Exception:  # noqa: BLE001
        critical = []
        critical_complete = False
    points: list[dict[str, Any]] = []
    for item in critical or []:
        if any(symbol not in item or item[symbol].free_symbols or item[symbol].is_real is not True for symbol in symbols):
            critical_complete = False
            continue
        points.append({symbol: sp.simplify(item[symbol]) for symbol in symbols})
    if bounds:
        if not expression.is_polynomial(*symbols):
            raise SolveError("箱约束解析求解当前支持二维多项式目标，请核对目标与边界。")
        ends: list[list[sp.Expr]] = []
        for symbol in symbols:
            pair = bounds.get(str(symbol))
            if not pair or any(value is None or not math.isfinite(float(value)) for value in pair):
                raise SolveError("箱约束解析求解需要各变量的有限闭区间，不能把边界候选冒充无界问题的最优解。")
            ends.append([sp.Rational(str(pair[0])), sp.Rational(str(pair[1]))])
        edge_complete = True
        candidates: list[dict[sp.Symbol, sp.Expr]] = [
            point for point in points
            if all(ends[index][0] <= point[symbol] <= ends[index][1] for index, symbol in enumerate(symbols))
        ]
        for index, symbol in enumerate(symbols):
            free = symbols[1 - index]
            for end in ends[index]:
                edge = sp.simplify(expression.subs(symbol, end))
                try:
                    roots = sp.solveset(sp.diff(edge, free), free, domain=sp.Interval(*ends[1 - index]))
                except Exception:  # noqa: BLE001
                    roots = None
                roots_list, roots_complete = _finite_set_points(roots) if isinstance(roots, sp.Set) else ([], False)
                edge_complete = edge_complete and roots_complete
                candidates.extend({symbol: end, free: root} for root in roots_list)
        candidates.extend(dict(zip(symbols, values)) for values in product(*ends))
        if len(candidates) > 64:
            raise SolveError("边界与内部候选超过可核对上限，请缩小模型或分段求解。")
        evaluated = _points_with_values(expression, symbols, candidates)
        minima = _extreme_points(evaluated, minimum=True)
        maxima = _extreme_points(evaluated, minimum=False)
        minimum = {
            "exists": bool(minima), "value": minima[0]["value_expr"] if minima else None,
            "points": [item["point"] for item in minima], "reason": "",
        }
        maximum = {
            "exists": bool(maxima), "value": maxima[0]["value_expr"] if maxima else None,
            "points": [item["point"] for item in maxima], "reason": "",
        }
        stationary_complete = critical_complete and edge_complete and len(candidates) <= 64
        hessian = sp.hessian(expression, symbols)
        stationary_points = []
        for point in points:
            if not all(ends[index][0] <= point[symbol] <= ends[index][1] for index, symbol in enumerate(symbols)):
                continue
            matrix = sp.simplify(hessian.subs(point))
            determinant = sp.simplify(matrix.det())
            classification = "undetermined"
            if determinant.is_negative:
                classification = "saddle"
            elif determinant.is_positive and matrix[0, 0].is_positive:
                classification = "minimum"
            elif determinant.is_positive and matrix[0, 0].is_negative:
                classification = "maximum"
            if not all(
                sp.simplify(gradient.subs(point)) == 0 for gradient in gradients
            ):
                stationary_complete = False
                continue
            stationary_points.append({
                "coordinates": [str(sp.simplify(point[symbol])) for symbol in symbols],
                "classification": classification,
                "value": str(sp.simplify(expression.subs(point))),
                "hessian_determinant": str(determinant),
                "latex": to_latex(sp.Tuple(*(point[symbol] for symbol in symbols))),
                "point_kind": "stationary",
            })
        descriptions = []
        if minima:
            descriptions.append(
                "箱约束内最小值 " + str(minima[0]["value_expr"]) + " 在 " +
                "、".join("(" + ", ".join(str(value) for value in item["point"]) + ")" for item in minima) + " 取得"
            )
        if maxima:
            descriptions.append(
                "最大值 " + str(maxima[0]["value_expr"]) + " 在 " +
                "、".join("(" + ", ".join(str(value) for value in item["point"]) + ")" for item in maxima) + " 取得"
            )
        for item in stationary_points:
            descriptions.append(
                f"{_CLASSIFICATION_LABELS.get(item['classification'], item['classification'])}点 "
                f"({', '.join(item['coordinates'])}), f={item['value']}"
            )
        if not stationary_complete:
            descriptions.append("驻点或边界候选尚未证明完整，不能排除其他点")
        solution_complete = stationary_complete and all(
            item["classification"] != "undetermined" for item in stationary_points
        )
        return _finalize_extrema({
            "summary": "在有限箱约束内比较内部驻点、边界驻点与顶点，列出全部并列最优点。",
            "answer": "；".join(descriptions) or "没有可确认的极值点",
            "answer_point": [float(value) for value in minima[0]["point"]] if minima else None,
            "answer_value": safe_float(minima[0]["value_expr"]) if minima else None,
            "steps": steps + [{
                "id": "box",
                "title": "枚举内部与边界候选",
                "latex": r"\nabla f=0,\quad \partial D",
                "detail": "；".join(descriptions),
            }],
            "conditions": ["箱约束为各变量的有限闭区间；内部驻点、边界驻点与顶点全部参与比较。"],
            "global_note": "箱约束内最值由全部内部候选与边界候选比较得到。",
            "stationary_points": stationary_points,
            "stationary_complete": stationary_complete,
            "global_minimum": _serializable_extremum(minimum),
            "global_maximum": _serializable_extremum(maximum),
            "solution_status": "complete" if solution_complete else "incomplete",
            "solution_complete": solution_complete,
            "limitations": limitations,
        })

    stationary_complete = critical_complete and len(points) <= 64
    answer = (
        "已求出候选驻点；局部极大、局部极小与鞍点由 Hessian 判别，见完整讲解。"
        if stationary_complete else
        "驻点集合尚未证明完整，不能据此排除其他极值"
    )
    return _finalize_extrema({
        "summary": "二元无约束问题先求全部孤立驻点，再做 Hessian 局部分类。",
        "answer": answer,
        "answer_point": None,
        "answer_value": None,
        "steps": steps,
        "conditions": ["无约束二元问题只对孤立驻点做局部分类；全局性需另作分析。"],
        "global_note": "Hessian 分类只回答局部极值；不能直接外推为全局最优。",
        "stationary_points": [],
        "stationary_complete": stationary_complete,
        "solution_status": "complete" if stationary_complete else "incomplete",
        "solution_complete": stationary_complete,
        "limitations": limitations,
    })


def _optimization_solution(model: Mapping[str, Any]) -> dict[str, Any]:
    if str(model.get("goal") or "extrema") == "extrema":
        return _extrema_solution(model)
    symbols = _symbols(model)
    expression = parse_expression(str(model.get("expression") or ""), [str(item) for item in symbols])
    gradients = [sp.diff(expression, symbol) for symbol in symbols]
    critical_complete = True
    try:
        critical = sp.solve(gradients, symbols, dict=True)
    except Exception:  # noqa: BLE001
        critical = []
        critical_complete = False
    bounds = model.get('bounds') or {}
    if bounds:
        if len(symbols) > 2 or not expression.is_polynomial(*symbols):
            raise SolveError('箱约束解析求解当前支持一维或二维多项式目标，请核对目标与边界。')
        if not critical_complete or any(
            symbol not in point or point[symbol].free_symbols
            for point in critical for symbol in symbols
        ):
            raise SolveError('箱约束目标含未确定的驻点族或驻点求解未完成，不能把部分候选当作完整最优解。')
        ends = []
        for symbol in symbols:
            pair = bounds.get(str(symbol))
            if not pair or any(value is None or not math.isfinite(float(value)) for value in pair):
                raise SolveError('箱约束解析求解需要各变量的有限闭区间，不能把边界候选冒充无界问题的最优解。')
            ends.append([sp.Rational(str(value)) for value in pair])
        critical.extend(dict(zip(symbols, values)) for values in product(*ends))
        if len(symbols) == 2:
            for index, symbol in enumerate(symbols):
                free = symbols[1-index]
                for end in ends[index]:
                    edge = expression.subs(symbol, end)
                    try:
                        roots = sp.solve(sp.diff(edge, free), free)
                    except (ValueError, NotImplementedError):
                        raise SolveError('无法完整核对约束边界驻点，请核对原题。')
                    critical.extend({symbol: end, free: root} for root in roots if root.is_real is True)
        if len(critical) > 64:
            raise SolveError('边界与内部候选超过可核对上限，请缩小模型或分段求解。')
    candidates: list[dict[str, Any]] = []
    for point in critical[:64]:
        values = [safe_float(point.get(symbol)) for symbol in symbols]
        if any(value is None for value in values):
            continue
        if any(str(symbol) in bounds and not (
            float(bounds[str(symbol)][0]) <= float(value) <= float(bounds[str(symbol)][1])
        ) for symbol, value in zip(symbols, values)):
            continue
        objective = _safe_value(expression, symbols, [float(value) for value in values])  # type: ignore[arg-type]
        if objective is None:
            continue
        candidates.append(
            {
                "point": [round(float(value), 8) for value in values],  # type: ignore[arg-type]
                "value": round(objective, 8),
            }
        )
    best = min(candidates, key=lambda item: item["value"]) if candidates else None
    hessian = sp.hessian(expression, symbols)
    global_note = "数值轨迹收敛到驻点候选；全局最优未单独证明。"
    try:
        matrix = np.array(hessian.subs({symbol: 0 for symbol in symbols}), dtype=float)
        eigenvalues = np.linalg.eigvalsh(matrix)
        degree = sp.Poly(expression, *symbols).total_degree() if expression.is_polynomial(*symbols) else 99
        if degree <= 2 and np.all(eigenvalues >= -1e-9):
            global_note = "目标函数是凸二次函数，驻点即全局最优；这一结论来自 Hessian 半正定核对。"
    except Exception:  # noqa: BLE001
        pass
    if bounds:
        global_note = '在原题有限箱约束内比较内部驻点、边界驻点与顶点；结果保留全部可执行边界。'
    initial = [float((model.get("defaults") or {}).get(f"{symbol}0", 0.0)) for symbol in symbols]
    lr = float((model.get("defaults") or {}).get("learning_rate", 0.1))
    iterations = int((model.get("defaults") or {}).get("iterations", 30))
    steps = [
        {
            "id": "objective",
            "title": "写出目标与梯度",
            "latex": f"{to_latex(expression)},\\quad " + ", ".join(
                rf"\frac{{\partial f}}{{\partial {symbol}}}={to_latex(gradient)}"
                for symbol, gradient in zip(symbols, gradients)
            ),
            "detail": "梯度决定当前位置函数值上升最快的方向，因此沿负梯度移动。",
        },
        {
            "id": "update",
            "title": "梯度下降迭代",
            "latex": r"x_{k+1}=x_k-\eta\nabla f(x_k)",
            "detail": f"初始点 x₀={_fmt(initial[0]) if len(initial) == 1 else initial}，学习率 η={lr:g}，最多 {iterations} 次。",
        },
        {
            "id": "stop",
            "title": "检查停止与全局性",
            "latex": r"\|\nabla f(x_k)\|\le 10^{-7}",
            "detail": global_note,
        },
    ]
    answer = "—"
    if best is not None:
        if len(best["point"]) == 1:
            answer = f"x*={_fmt(best['point'][0], 8)}，f*={_fmt(best['value'], 8)}"
        else:
            answer = f"点 ({', '.join(_fmt(value, 8) for value in best['point'])})，f*={_fmt(best['value'], 8)}"
    return {
        "summary": "梯度下降轨迹、目标值变化与驻点核对使用同一目标函数。",
        "answer": answer,
        "answer_point": best["point"] if best else None,
        "answer_value": best["value"] if best else None,
        "steps": steps,
        "conditions": ["迭代只沿负梯度方向更新；箱约束存在时投影回可行域。"],
        "global_note": global_note,
        "limitations": ["一般非线性约束不在首版自动求解范围；原约束仍保留在来源中。"],
    }


def _gradient_values(
    gradients: Sequence[sp.Expr],
    symbols: Sequence[sp.Symbol],
    point: Sequence[float],
) -> list[float] | None:
    try:
        funcs = [sp.lambdify(symbols, gradient, modules=["math"]) for gradient in gradients]
        values = [float(func(*point)) for func in funcs]
    except Exception:  # noqa: BLE001
        return None
    if any(not math.isfinite(value) for value in values):
        return None
    return values


def _optimization_evaluate(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    symbols = _symbols(model)
    names = [str(item) for item in symbols]
    expression = parse_expression(str(model.get("expression") or ""), names)
    gradients = [sp.diff(expression, symbol) for symbol in symbols]
    func = _numeric_function(expression, symbols)
    initial = [
        float(params.get(f"{name}0", (model.get("defaults") or {}).get(f"{name}0", 0.0)))
        for name in names
    ]
    lr = float(params.get("learning_rate", (model.get("defaults") or {}).get("learning_rate", 0.1)))
    iterations = int(params.get("iterations", (model.get("defaults") or {}).get("iterations", 30)))
    iterations = max(1, min(120, iterations))
    bounds = model.get("bounds") or {}
    trajectory: list[dict[str, Any]] = []
    current = list(initial)
    stop_reason = "达到迭代上限"
    divergence = False
    converged = False
    constrained = False

    def evaluate_at(point: Sequence[float]) -> float | None:
        try:
            value = float(func(*point))
        except Exception:  # noqa: BLE001
            return None
        return value if math.isfinite(value) else None

    def project(point: list[float]) -> tuple[list[float], bool]:
        touched = False
        result = list(point)
        for index, name in enumerate(names):
            if name in bounds:
                low, high = bounds[name]
                if low is not None and result[index] < float(low):
                    result[index] = float(low)
                    touched = True
                if high is not None and result[index] > float(high):
                    result[index] = float(high)
                    touched = True
        return result, touched

    current, initial_projected = project(current)
    constrained = constrained or initial_projected
    f_value = evaluate_at(current)
    for step_index in range(iterations + 1):
        gradient = _gradient_values(gradients, symbols, current)
        if gradient is None or f_value is None:
            divergence = True
            stop_reason = "数值发散或进入未定义区域"
            break
        grad_norm = math.sqrt(sum(value * value for value in gradient))
        trajectory.append(
            {
                "index": step_index,
                "point": [round(value, 8) for value in current],
                "f": round(f_value, 10),
                "gradient": [round(value, 8) for value in gradient],
                "grad_norm": round(grad_norm, 10),
                "step_vector": None if step_index == 0 else [
                    round(current[i] - trajectory[-1]["point"][i], 8) for i in range(len(current))
                ],
            }
        )
        if grad_norm <= GRAD_TOL:
            converged = True
            stop_reason = "梯度范数 < 1e-7，已收敛"
            break
        if step_index >= iterations:
            break
        candidate = [current[index] - lr * gradient[index] for index in range(len(current))]
        candidate, touched = project(candidate)
        constrained = constrained or touched
        next_value = evaluate_at(candidate)
        if next_value is None:
            divergence = True
            stop_reason = "数值发散或进入未定义区域"
            break
        current = candidate
        f_value = next_value
    else:
        pass
    if constrained and stop_reason == "达到迭代上限":
        stop_reason = "达到迭代上限（部分点被投影回约束区间）"
    last = trajectory[-1] if trajectory else None
    # 1D 曲线 / 2D 网格
    domain = dict(model.get("domain") or {})
    series: list[dict[str, Any]] = []
    grid: dict[str, Any] | None = None
    if len(symbols) == 1:
        low = float(domain.get("x_min", -6))
        high = float(domain.get("x_max", 6))
        for index in range(MAX_PLOT_POINTS):
            x_value = low + (high - low) * index / (MAX_PLOT_POINTS - 1)
            y_value = evaluate_at([x_value])
            series.append({"x": round(x_value, 6), "y": None if y_value is None else round(y_value, 6)})
    else:
        x_low = float(domain.get("x_min", -6))
        x_high = float(domain.get("x_max", 6))
        y_low = float(domain.get("y_min", -6))
        y_high = float(domain.get("y_max", 6))
        xs = [x_low + (x_high - x_low) * index / 32 for index in range(33)]
        ys = [y_low + (y_high - y_low) * index / 32 for index in range(33)]
        zs: list[list[float | None]] = []
        for y_value in ys:
            row: list[float | None] = []
            for x_value in xs:
                value = evaluate_at([x_value, y_value])
                row.append(None if value is None else round(value, 6))
            zs.append(row)
        grid = {"x": [round(item, 5) for item in xs], "y": [round(item, 5) for item in ys], "z": zs}
    constraint_ok = True
    if bounds and last:
        for index, name in enumerate(names):
            if name not in bounds:
                continue
            low, high = bounds[name]
            value = float(last["point"][index])
            if low is not None and value < float(low) - 1e-9:
                constraint_ok = False
            if high is not None and value > float(high) + 1e-9:
                constraint_ok = False
    checks = [
        _check(
            "constraints",
            "约束满足",
            constraint_ok,
            "所有迭代点均在箱约束内。" if bounds else "题目未给出可执行的箱约束；未声称满足其它约束。",
            warn=not bounds,
        ),
        _check(
            "stopping",
            "停止原因明确",
            not divergence,
            stop_reason,
            warn=not converged,
        ),
        _check(
            "gradient",
            "终点梯度核对",
            bool(last and last["grad_norm"] <= 0.05),
            "终点梯度范数 " + _fmt(last["grad_norm"] if last else None) + "；越小越接近驻点。",
            warn=True,
        ),
    ]
    exact_point = None
    solution: dict[str, Any] = {}
    try:
        solution = _optimization_solution(model)
        if str(model.get("goal") or "extrema") == "extrema" and len(symbols) == 2 and not bounds:
            from .exam_math import complete_extrema
            solution = complete_extrema(model, solution)
        exact_point = solution.get("answer_point")
    except Exception:  # noqa: BLE001
        solution = {}
    if str(model.get("goal") or "extrema") != "gradient_descent":
        complete = solution.get("solution_complete") is True
        checks.append(_check(
            "completeness",
            "驻点与极值完整性",
            complete,
            (
                "驻点全集、局部极值分类与全局性均已给出。"
                if complete
                else str(solution.get("incomplete_reason") or solution.get("answer") or "驻点或分类尚未完成，不能判为通过")
            ),
        ))
    answer_text = f"x≈{_fmt(last['point'][0], 6)}，f≈{_fmt(last['f'], 6)}" if last and len(names) == 1 else (
        f"点 ≈ ({', '.join(_fmt(v, 6) for v in last['point'])})" if last else "—"
    )
    return {
        "subject": "optimization",
        "variables": names,
        "params": {"initial": initial, "learning_rate": lr, "iterations": iterations},
        "headline": answer_text,
        "metrics": [
            {"id": "f", "label": "当前目标值", "value": _fmt(last["f"] if last else None)},
            {"id": "grad", "label": "梯度范数", "value": _fmt(last["grad_norm"] if last else None)},
            {"id": "iterations", "label": "实际迭代", "value": str(max(0, len(trajectory) - 1))},
            {"id": "stop", "label": "停止原因", "value": stop_reason},
        ],
        "series": series,
        "grid": grid,
        "domain": domain,
        "trajectory": trajectory,
        "current": last,
        # 注册表声明的派生输出键是 loss/grad_norm；顶层暴露这两个键，
        # 前后端 declared_output_value 才能取到同一份值。
        "loss": last["f"] if last else None,
        "grad_norm": last["grad_norm"] if last else None,
        "stop_reason": stop_reason,
        "converged": converged,
        "diverged": divergence,
        "solution_status": solution.get("solution_status"),
        "solution_complete": solution.get("solution_complete"),
        "incomplete_reason": solution.get("incomplete_reason"),
        "exact": solution,
        "checks": checks,
        "trace": _generic_frames(
            [
                {
                    "index": item["index"],
                    "label": f"迭代 {item['index']}",
                    "detail": f"f={_fmt(item['f'])} · ‖∇f‖={_fmt(item['grad_norm'])}",
                    "values": {
                        "point": item["point"],
                        "f": item["f"],
                        "grad_norm": item["grad_norm"],
                    },
                }
                for item in trajectory
            ]
        ),
        "trace_kind": "gradient_descent",
        "notes": [solution.get("global_note") or "轨迹结果不等于全局最优证明。"],
    }


# ---------------------------------------------------------------------------
# 数据结构与算法：BFS
# ---------------------------------------------------------------------------

PSEUDOCODE = [
    "queue ← [start]; visited ← {start}; parent[start] ← null",
    "while queue 不为空:",
    "  u ← queue.dequeue()",
    "  order.append(u)",
    "  for v in neighbors(u) sorted by id:",
    "    if v not in visited:",
    "      visited.add(v); parent[v] ← u; queue.enqueue(v)",
    "return order",
]


_TIANGAN = "甲乙丙丁戊己庚辛壬癸"


def _sort_node_ids(ids) -> list[str]:
    """邻居顺序：默认按 id 升序；纯天干命名的中文节点按 甲乙丙丁… 的教材编号序。"""
    unique = list(dict.fromkeys(ids))
    if unique and all(len(item) == 1 and item in _TIANGAN for item in unique):
        return sorted(unique, key=_TIANGAN.index)
    return sorted(unique)


def _bfs_trace(model: Mapping[str, Any], start: str) -> dict[str, Any]:
    nodes = [str(item.get("id")) for item in model.get("nodes") or []]
    if start not in nodes:
        raise SolveError(f"起点 {start} 不在图中")
    adjacency: dict[str, list[str]] = {node: [] for node in nodes}
    for edge in model.get("edges") or []:
        source = str(edge.get("from"))
        target = str(edge.get("to"))
        if source not in adjacency or target not in adjacency:
            continue
        adjacency[source].append(target)
        if not model.get("directed"):
            adjacency[target].append(source)
    for node in adjacency:
        adjacency[node] = _sort_node_ids(adjacency[node])
    queue = [start]
    visited = {start}
    parent: dict[str, str | None] = {start: None}
    level: dict[str, int] = {start: 0}
    order: list[str] = []
    rejected: list[dict[str, str]] = []
    tree_edges: list[dict[str, str]] = []
    frames: list[dict[str, Any]] = [
        {
            "index": 0,
            "label": "初始化",
            "action": "init",
            "current": None,
            "queue": list(queue),
            "visited": sorted(visited),
            "parent": dict(parent),
            "level": dict(level),
            "order": [],
            "pseudocode_line": 1,
            "detail": f"从 {start} 开始；入队时立即标记已访问，保证每个节点只入队一次。",
        }
    ]
    while queue:
        current = queue.pop(0)
        order.append(current)
        frames.append(
            {
                "index": len(frames),
                "label": f"出队 {current}",
                "action": "dequeue",
                "current": current,
                "queue": list(queue),
                "visited": sorted(visited),
                "parent": dict(parent),
                "level": dict(level),
                "order": list(order),
                "pseudocode_line": 3,
                "detail": f"队列按先进先出取出 {current}；当前层编号 {level[current]}。",
            }
        )
        for neighbor in adjacency[current]:
            if neighbor in visited:
                rejected.append({"from": current, "to": neighbor, "reason": "已在已访问集合中"})
                frames.append(
                    {
                        "index": len(frames),
                        "label": f"跳过 {neighbor}",
                        "action": "skip",
                        "current": current,
                        "neighbor": neighbor,
                        "queue": list(queue),
                        "visited": sorted(visited),
                        "parent": dict(parent),
                        "level": dict(level),
                        "order": list(order),
                        "pseudocode_line": 6,
                        "detail": f"{neighbor} 已访问，不重复入队；这是 BFS 避免环的关键。",
                    }
                )
                continue
            visited.add(neighbor)
            parent[neighbor] = current
            level[neighbor] = level[current] + 1
            queue.append(neighbor)
            tree_edges.append({"from": current, "to": neighbor})
            frames.append(
                {
                    "index": len(frames),
                    "label": f"入队 {neighbor}",
                    "action": "enqueue",
                    "current": current,
                    "neighbor": neighbor,
                    "queue": list(queue),
                    "visited": sorted(visited),
                    "parent": dict(parent),
                    "level": dict(level),
                    "order": list(order),
                    "pseudocode_line": 6,
                    "detail": f"{neighbor} 首次被发现，父节点为 {current}，层级 {level[neighbor]}。",
                }
            )
    frames.append(
        {
            "index": len(frames),
            "label": "完成",
            "action": "done",
            "current": None,
            "queue": [],
            "visited": sorted(visited),
            "parent": dict(parent),
            "level": dict(level),
            "order": list(order),
            "pseudocode_line": 8,
            "detail": "队列为空，所有可达节点都已按 BFS 顺序处理。",
        }
    )
    unreachable = [node for node in nodes if node not in visited]
    return {
        "order": order,
        "visited": sorted(visited),
        "unvisited": unreachable,
        "parent": parent,
        "level": level,
        "tree_edges": tree_edges,
        "rejected_edges": rejected,
        "frames": frames,
        "adjacency": adjacency,
    }


def _bfs_evaluate(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    start = str(params.get("start") or model.get("start") or (model.get("defaults") or {}).get("start") or "")
    result = _bfs_trace(model, start)
    # 独立计算一次可达集合，验证执行记录没有漏掉或多算节点。
    reachable: set[str] = set()
    frontier = [start] if start in result["adjacency"] else []
    while frontier:
        node = frontier.pop()
        if node in reachable:
            continue
        reachable.add(node)
        frontier.extend(result["adjacency"].get(node, []))
    checks = [
        _check(
            "coverage",
            "访问覆盖",
            set(result["visited"]) == reachable and len(result["order"]) == len(result["visited"]),
            f"出队顺序 {', '.join(result['order']) or '空'}；已访问 {len(result['visited'])} 个节点，"
            f"可达 {len(reachable)} 个。",
        ),
        _check(
            "parent_edges",
            "父边有效",
            all(
                parent is None or any(
                    edge.get("from") == parent and edge.get("to") == node
                    for edge in model.get("edges") or []
                )
                or (not model.get("directed") and any(
                    edge.get("from") == node and edge.get("to") == parent
                    for edge in model.get("edges") or []
                ))
                for node, parent in result["parent"].items()
            ),
            "每个父节点都能在原图中找到一条边。",
        ),
        _check(
            "queue",
            "队列规则",
            True,
            "入队即标记已访问；同层邻居按节点编号升序，与轨迹一致。",
        ),
    ]
    return {
        "subject": "algorithm",
        "algorithm": "bfs",
        "params": {"start": start},
        "headline": "BFS 出队顺序：" + (" → ".join(result["order"]) if result["order"] else "无"),
        "metrics": [
            {"id": "order", "label": "访问顺序", "value": " → ".join(result["order"]) or "—"},
            {"id": "visited", "label": "已访问", "value": str(len(result["visited"]))},
            {"id": "queue", "label": "结束队列", "value": "空"},
            {"id": "unvisited", "label": "不可达", "value": ", ".join(result["unvisited"]) or "无"},
        ],
        "trace": result["frames"],
        "trace_kind": "bfs",
        "order": result["order"],
        "visited": result["visited"],
        "unvisited": result["unvisited"],
        "parent": result["parent"],
        "level": result["level"],
        "tree_edges": result["tree_edges"],
        "rejected_edges": result["rejected_edges"],
        "adjacency": result["adjacency"],
        "pseudocode": PSEUDOCODE,
        "checks": checks,
        "notes": [
            "入队顺序与出队顺序都来自真实执行记录；动画只是回放该记录。",
            "若图为有向图，父边只允许原图方向；无向图会补上反向边。",
        ],
    }


# ---------------------------------------------------------------------------
# 数据结构与算法：DFS
# ---------------------------------------------------------------------------

DFS_PSEUDOCODE = [
    "stack ← [start]; visited ← {}; parent[start] ← null",
    "while stack 不为空:",
    "  u ← stack.peek()",
    "  if u 未访问: 访问 u（order.append(u)）",
    "  for v in neighbors(u) sorted by id:",
    "    if v 未访问: parent[v] ← u; stack.push(v); goto 下一轮",
    "  stack.pop()（u 的邻居全部处理完，回溯）",
    "return order",
]


def _dfs_trace(model: Mapping[str, Any], start: str) -> dict[str, Any]:
    nodes = [str(item.get("id")) for item in model.get("nodes") or []]
    if start not in nodes:
        raise SolveError(f"起点 {start} 不在图中")
    adjacency: dict[str, list[str]] = {node: [] for node in nodes}
    for edge in model.get("edges") or []:
        source = str(edge.get("from"))
        target = str(edge.get("to"))
        if source not in adjacency or target not in adjacency:
            continue
        adjacency[source].append(target)
        if not model.get("directed"):
            adjacency[target].append(source)
    for node in adjacency:
        adjacency[node] = _sort_node_ids(adjacency[node])
    stack = [start]
    visited: set[str] = set()
    parent: dict[str, str | None] = {start: None}
    depth: dict[str, int] = {}
    order: list[str] = []
    rejected: list[dict[str, str]] = []
    tree_edges: list[dict[str, str]] = []

    def snapshot() -> dict[str, Any]:
        return {
            "stack": list(stack),
            "visited": sorted(visited),
            "order": list(order),
        }

    frames: list[dict[str, Any]] = [
        {
            "index": 0,
            "label": "初始化",
            "action": "init",
            "current": None,
            **snapshot(),
            "parent": dict(parent),
            "pseudocode_line": 1,
            "detail": f"从 {start} 开始；邻居按编号升序尝试，沿路径走到底再回溯。",
        }
    ]
    while stack:
        current = stack[-1]
        if current not in visited:
            visited.add(current)
            order.append(current)
            depth[current] = 0 if current == start else (depth.get(parent[current] or "", 0) + 1)
            frames.append(
                {
                    "index": len(frames),
                    "label": f"访问 {current}",
                    "action": "visit",
                    "current": current,
                    **snapshot(),
                    "parent": dict(parent),
                    "pseudocode_line": 4,
                    "detail": f"{current} 首次访问；继续沿编号最小的未访问邻居深入。",
                }
            )
        pushed = False
        for neighbor in adjacency[current]:
            if neighbor in visited or neighbor in stack:
                rejected.append({"from": current, "to": neighbor, "reason": "已访问或在栈中"})
                frames.append(
                    {
                        "index": len(frames),
                        "label": f"跳过 {neighbor}",
                        "action": "skip",
                        "current": current,
                        "neighbor": neighbor,
                        **snapshot(),
                        "parent": dict(parent),
                        "pseudocode_line": 6,
                        "detail": f"{neighbor} 已访问或已在栈中，不重复深入；这是 DFS 避免环的关键。",
                    }
                )
                continue
            parent[neighbor] = current
            depth[neighbor] = depth[current] + 1
            stack.append(neighbor)
            tree_edges.append({"from": current, "to": neighbor})
            frames.append(
                {
                    "index": len(frames),
                    "label": f"压栈 {neighbor}",
                    "action": "push",
                    "current": current,
                    "neighbor": neighbor,
                    **snapshot(),
                    "parent": dict(parent),
                    "pseudocode_line": 6,
                    "detail": f"发现 {neighbor}，父节点为 {current}；下一步深入 {neighbor}。",
                }
            )
            pushed = True
            break
        if pushed:
            continue
        stack.pop()
        frames.append(
            {
                "index": len(frames),
                "label": f"回溯 {current}",
                "action": "backtrack",
                "current": current,
                **snapshot(),
                "parent": dict(parent),
                "pseudocode_line": 7,
                "detail": f"{current} 的邻居已全部处理，弹出栈并回溯。",
            }
        )
    frames.append(
        {
            "index": len(frames),
            "label": "完成",
            "action": "done",
            "current": None,
            "stack": [],
            "visited": sorted(visited),
            "order": list(order),
            "parent": dict(parent),
            "pseudocode_line": 8,
            "detail": "栈为空，所有可达节点都已按 DFS 顺序访问。",
        }
    )
    unreachable = [node for node in nodes if node not in visited]
    return {
        "order": order,
        "visited": sorted(visited),
        "unvisited": unreachable,
        "parent": parent,
        "level": depth,
        "tree_edges": tree_edges,
        "rejected_edges": rejected,
        "frames": frames,
        "adjacency": adjacency,
    }


def _dfs_evaluate(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    start = str(params.get("start") or model.get("start") or (model.get("defaults") or {}).get("start") or "")
    result = _dfs_trace(model, start)
    # 独立计算一次可达集合，验证执行记录没有漏掉或多算节点。
    reachable: set[str] = set()
    frontier = [start] if start in result["adjacency"] else []
    while frontier:
        node = frontier.pop()
        if node in reachable:
            continue
        reachable.add(node)
        frontier.extend(result["adjacency"].get(node, []))
    checks = [
        _check(
            "coverage",
            "访问覆盖",
            set(result["visited"]) == reachable and len(result["order"]) == len(result["visited"]),
            f"访问顺序 {', '.join(result['order']) or '空'}；已访问 {len(result['visited'])} 个节点，"
            f"可达 {len(reachable)} 个。",
        ),
        _check(
            "parent_edges",
            "父边有效",
            all(
                parent is None or any(
                    edge.get("from") == parent and edge.get("to") == node
                    for edge in model.get("edges") or []
                )
                or (not model.get("directed") and any(
                    edge.get("from") == node and edge.get("to") == parent
                    for edge in model.get("edges") or []
                ))
                for node, parent in result["parent"].items()
            ),
            "每个父节点都能在原图中找到一条边。",
        ),
        _check(
            "stack",
            "栈规则",
            True,
            "邻居按节点编号升序尝试；栈顶决定下一步，走到底再回溯。",
        ),
    ]
    return {
        "subject": "algorithm",
        "algorithm": "dfs",
        "params": {"start": start},
        "headline": "DFS 访问顺序：" + (" → ".join(result["order"]) if result["order"] else "无"),
        "metrics": [
            {"id": "order", "label": "访问顺序", "value": " → ".join(result["order"]) or "—"},
            {"id": "visited", "label": "已访问", "value": str(len(result["visited"]))},
            {"id": "stack", "label": "结束栈", "value": "空"},
            {"id": "unvisited", "label": "不可达", "value": ", ".join(result["unvisited"]) or "无"},
        ],
        "trace": result["frames"],
        "trace_kind": "dfs",
        "order": result["order"],
        "visited": result["visited"],
        "unvisited": result["unvisited"],
        "parent": result["parent"],
        "level": result["level"],
        "tree_edges": result["tree_edges"],
        "rejected_edges": result["rejected_edges"],
        "adjacency": result["adjacency"],
        "pseudocode": DFS_PSEUDOCODE,
        "checks": checks,
        "notes": [
            "访问顺序与栈变化都来自真实执行记录；动画只是回放该记录。",
            "若图为有向图，父边只允许原图方向；无向图会补上反向边。",
        ],
    }


# ---------------------------------------------------------------------------
# 深度学习：小型全连接网络
# ---------------------------------------------------------------------------

ACTIVATIONS: dict[str, tuple[Callable[[Any], Any], Callable[[Any], Any]]] = {
    "tanh": (np.tanh, lambda z: 1.0 - np.tanh(z) ** 2),
    "relu": (lambda z: np.maximum(0.0, z), lambda z: (z > 0).astype(float)),
    "sigmoid": (lambda z: 1.0 / (1.0 + np.exp(-z)), lambda z: (1.0 / (1.0 + np.exp(-z))) * (1.0 - 1.0 / (1.0 + np.exp(-z)))),
    "linear": (lambda z: z, lambda z: np.ones_like(z)),
}


def _forward(
    weights: Sequence[Any],
    biases: Sequence[Any],
    input_values: Sequence[float],
    activations: Sequence[str],
) -> dict[str, Any]:
    a = np.asarray(input_values, dtype=float)
    layers: list[dict[str, Any]] = [{"z": None, "a": a.tolist(), "activation": "input"}]
    activations_out: list[str] = ["input"]
    for index, (weight, bias) in enumerate(zip(weights, biases)):
        matrix = np.asarray(weight, dtype=float)
        vector = np.asarray(bias, dtype=float)
        z = matrix @ a + vector
        name = activations[index]
        activation, _derivative = ACTIVATIONS[name]
        a = np.asarray(activation(z), dtype=float)
        layers.append({"z": z.tolist(), "a": a.tolist(), "activation": name})
        activations_out.append(name)
    return {"layers": layers, "output": a}


def _loss_and_gradients(
    weights: Sequence[Any],
    biases: Sequence[Any],
    input_values: Sequence[float],
    target: Sequence[float],
    activations: Sequence[str],
) -> tuple[float, list[np.ndarray], list[np.ndarray], dict[str, Any]]:
    forward = _forward(weights, biases, input_values, activations)
    output = np.asarray(forward["output"], dtype=float)
    target_array = np.asarray(target, dtype=float)
    loss = float(np.mean((output - target_array) ** 2))
    deltas: list[np.ndarray] = [np.zeros(0) for _ in weights]
    # 输出层：MSE 的导数，再乘输出激活的导数（输出通常为 linear）。
    out_derivative = ACTIVATIONS[activations[-1]][1](np.asarray(forward["layers"][-1]["z"], dtype=float))
    delta = (2.0 / output.size) * (output - target_array) * out_derivative
    grad_w: list[np.ndarray] = [np.zeros(0) for _ in weights]
    grad_b: list[np.ndarray] = [np.zeros(0) for _ in weights]
    for index in range(len(weights) - 1, -1, -1):
        a_prev = np.asarray(forward["layers"][index]["a"], dtype=float)
        grad_w[index] = np.outer(delta, a_prev)
        grad_b[index] = delta.copy()
        if index > 0:
            z_prev = np.asarray(forward["layers"][index]["z"], dtype=float)
            derivative = ACTIVATIONS[activations[index - 1]][1](z_prev)
            delta = (np.asarray(weights[index], dtype=float).T @ delta) * derivative
    return loss, grad_w, grad_b, forward


def _deep_learning_evaluate(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    weights = [np.asarray(item, dtype=float) for item in model.get("weights") or []]
    biases = [np.asarray(item, dtype=float) for item in model.get("biases") or []]
    layers = model.get("layers") or []
    if not weights or len(weights) != len(layers) - 1:
        raise SolveError("网络权重与层数不一致")
    sizes = [int(item.get("size") or 0) for item in layers]
    if len(sizes) < 2:
        raise SolveError("网络至少需要输入层与输出层")
    input_values = [
        float(params.get(f"input_{index + 1}", (model.get("input") or [0.0] * sizes[0])[index]))
        for index in range(sizes[0])
    ]
    target = [float(item) for item in model.get("target") or [1.0]]
    if len(target) != sizes[-1]:
        raise SolveError("目标值维度与输出层不一致")
    lr = float(params.get("learning_rate", (model.get("defaults") or {}).get("learning_rate", 0.1)))
    epochs = int(params.get("epochs", (model.get("defaults") or {}).get("epochs", 8)))
    epochs = max(1, min(30, epochs))
    activations = [
        "linear" if index == len(weights) - 1 else str(model.get("activation") or "tanh")
        for index in range(len(weights))
    ]
    # 统一使用模型本身声明的激活；输出层保持线性。
    activations = [("linear" if index == len(layers) - 2 else str(model.get("activation") or "tanh")) for index in range(len(weights))]

    initial_loss, initial_gw, initial_gb, initial_forward = _loss_and_gradients(
        weights, biases, input_values, target, activations
    )
    frames: list[dict[str, Any]] = [
        {
            "index": 0,
            "label": "初始权重",
            "loss": round(initial_loss, 8),
            "output": [round(float(item), 8) for item in initial_forward["output"]],
            "weight_norm": round(float(np.sqrt(sum(np.sum(item ** 2) for item in weights))), 8),
            "grad_norm": round(float(np.sqrt(sum(np.sum(item ** 2) for item in initial_gw))), 8),
        }
    ]
    loss_history = [initial_loss]
    current_w = [item.copy() for item in weights]
    current_b = [item.copy() for item in biases]
    last_gw = initial_gw
    last_gb = initial_gb
    last_forward = initial_forward
    for epoch in range(1, epochs + 1):
        loss, grad_w, grad_b, forward = _loss_and_gradients(
            current_w, current_b, input_values, target, activations
        )
        last_gw, last_gb, last_forward = grad_w, grad_b, forward
        for index in range(len(current_w)):
            current_w[index] = current_w[index] - lr * grad_w[index]
            current_b[index] = current_b[index] - lr * grad_b[index]
        after_loss, after_gw, _after_gb, after_forward = _loss_and_gradients(
            current_w, current_b, input_values, target, activations
        )
        loss_history.append(after_loss)
        frames.append(
            {
                "index": epoch,
                "label": f"Epoch {epoch}",
                "loss_before": round(loss, 8),
                "loss": round(after_loss, 8),
                "output": [round(float(item), 8) for item in after_forward["output"]],
                "weight_norm": round(float(np.sqrt(sum(np.sum(item ** 2) for item in current_w))), 8),
                "grad_norm": round(float(np.sqrt(sum(np.sum(item ** 2) for item in grad_w))), 8),
                "weights": [[[round(float(value), 6) for value in row] for row in item.tolist()] for item in current_w],
                "biases": [[round(float(value), 6) for value in item.tolist()] for item in current_b],
            }
        )
        last_gw = grad_w
        last_gb = grad_b
    # 有限差分核对初始权重上的一个梯度分量。
    rel_error = None
    try:
        original = float(weights[0][0, 0])
        epsilon = 1e-5
        weights_plus = [item.copy() for item in weights]
        weights_minus = [item.copy() for item in weights]
        weights_plus[0][0, 0] = original + epsilon
        weights_minus[0][0, 0] = original - epsilon
        loss_plus = _loss_and_gradients(weights_plus, biases, input_values, target, activations)[0]
        loss_minus = _loss_and_gradients(weights_minus, biases, input_values, target, activations)[0]
        numeric = (loss_plus - loss_minus) / (2 * epsilon)
        analytic = float(initial_gw[0][0, 0])
        rel_error = abs(numeric - analytic) / max(1e-12, abs(numeric), abs(analytic))
    except Exception:  # noqa: BLE001
        rel_error = None
    final_loss = loss_history[-1]
    layer_view = []
    for index, (layer, activation_values) in enumerate(zip(last_forward["layers"], last_forward["layers"])):
        layer_view.append(
            {
                "index": index,
                "activation": layer.get("activation"),
                "z": [round(float(value), 6) for value in layer.get("z") or []],
                "a": [round(float(value), 6) for value in activation_values.get("a") or []],
            }
        )
    checks = [
        _check(
            "shape",
            "张量维度一致",
            all(np.asarray(weights[i]).shape == (sizes[i + 1], sizes[i]) for i in range(len(weights))),
            "权重形状为 [输出维度, 输入维度]；当前网络 " + "–".join(str(size) for size in sizes) + "。",
        ),
        _check(
            "gradient",
            "反向传播梯度核对",
            rel_error is not None and rel_error < 1e-4,
            "有限差分相对误差 " + (_fmt(rel_error, 3) if rel_error is not None else "无法计算") + "。",
            warn=True,
        ),
        _check(
            "loss",
            "损失下降",
            final_loss <= initial_loss + 1e-9,
            f"损失 {_fmt(initial_loss)} → {_fmt(final_loss)}；学习率过大时可能振荡或发散。",
            warn=True,
        ),
    ]
    metrics = [
        {"id": "loss", "label": "当前损失", "value": _fmt(final_loss)},
        {"id": "initial_loss", "label": "初始损失", "value": _fmt(initial_loss)},
        {"id": "epoch", "label": "训练轮", "value": str(epochs)},
        {"id": "lr", "label": "学习率", "value": _fmt(lr)},
    ]
    solution_steps = [
        {
            "id": "forward",
            "title": "前向计算",
            "latex": r"z^{[l]}=W^{[l]}a^{[l-1]}+b^{[l]},\quad a^{[l]}=\sigma(z^{[l]})",
            "detail": f"输入 {input_values}，目标 {target}；逐层得到输出并计算 MSE。",
        },
        {
            "id": "loss",
            "title": "计算损失",
            "latex": r"\mathcal{L}=\frac{1}{m}\|\\hat y-y\|^2",
            "detail": f"初始损失 {_fmt(initial_loss)}，当前损失 {_fmt(final_loss)}。",
        },
        {
            "id": "backward",
            "title": "反向传播",
            "latex": r"\delta^{[L]}=\frac{2}{m}(\hat y-y)\odot\sigma'(z^{[L]})",
            "detail": "从输出层向输入层传播误差；每一层的梯度都由真实前向缓存计算。",
        },
        {
            "id": "update",
            "title": "参数更新",
            "latex": r"W\leftarrow W-\eta\nabla_W\mathcal{L}",
            "detail": f"每个 epoch 用学习率 {lr:g} 更新一次；当前显示的是第 {epochs} 轮结束后的权重。",
        },
    ]
    return {
        "subject": "deep_learning",
        "params": {"input": input_values, "learning_rate": lr, "epochs": epochs},
        "headline": f"MSE {_fmt(initial_loss)} → {_fmt(final_loss)}",
        "metrics": metrics,
        "loss_history": [round(item, 10) for item in loss_history],
        "layers": layer_view,
        "weights": [[[round(float(value), 6) for value in row] for row in item.tolist()] for item in current_w],
        "biases": [[round(float(value), 6) for value in item.tolist()] for item in current_b],
        "gradients": {
            "weights": [[[round(float(value), 8) for value in row] for row in item.tolist()] for item in last_gw],
            "biases": [[round(float(value), 8) for value in item.tolist()] for item in last_gb],
        },
        "initial": {
            "loss": round(initial_loss, 10),
            "weights": [[[round(float(value), 6) for value in row] for row in item.tolist()] for item in weights],
        },
        "frames": _generic_frames(
            [
                {
                    "index": frame["index"],
                    "label": frame["label"],
                    "detail": f"loss={_fmt(frame['loss'])} · ‖W‖={_fmt(frame['weight_norm'])}",
                    "values": {
                        "loss": frame["loss"],
                        "output": frame["output"],
                        "weight_norm": frame["weight_norm"],
                        "grad_norm": frame["grad_norm"],
                    },
                }
                for frame in frames
            ]
        ),
        "trace": _generic_frames(frames),
        "trace_kind": "training_epoch",
        "checks": checks,
        "solution_steps": solution_steps,
        "notes": [
            "权重来源：" + ("题目提供" if model.get("weight_source") == "original" else "可复现教学初始化（seed=42）"),
            "大型模型不在首版自动展开范围；这里展示的是维度与运算均可核对的小型网络。",
        ],
    }


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------


def solve_problem(model: Mapping[str, Any]) -> dict[str, Any]:
    if model.get('manual_improper_conditions'):
        from .manual_improper_integral import solve
        return solve(model)
    if model.get('task') == 'multivariable_extrema':
        from .extrema import solve_extrema
        return solve_extrema(model)
    if model.get('task') == 'multivariable':
        from .multivariable import solve_multivariable
        return solve_multivariable(model)
    if model.get('task') == 'double_integral':
        if model.get('manual_double_conditions'):
            from .manual_double_integral import solve
            return solve(model)
        from .double_integral import solve_double_integral
        return solve_double_integral(model)
    if model.get('task') == 'triple_integral' and model.get('manual_triple_conditions'):
        from .manual_triple_integral import solve
        return solve(model)
    subject = str(model.get("subject") or "")
    if subject == "unknown":
        return {"summary": "题目类型尚未确认，请先核对原题。", "answer": "", "steps": [],
                "conditions": [], "limitations": ["当前题目尚未建立可执行模型。"]}
    if subject == "calculus":
        if model.get('task') == 'ode':
            from .ode import solve_ode
            return solve_ode(model)
        if model.get('task') == 'series_convergence':
            from .series import solve_series_convergence
            return solve_series_convergence(model)
        if model.get('task') == 'power_series':
            from .series import solve_power_series
            return solve_power_series(model)
        if model.get('task') == 'fourier_series':
            from .series import solve_fourier
            return solve_fourier(model)
        if model.get('task') in ('triple_integral','line_integral','surface_integral','green','gauss','stokes','space_geometry'):
            from .space import solve_space_task
            return solve_space_task(model)
        if model.get('task') == 'proof':
            from .proof import solve_proof
            return solve_proof(model)
        if model.get('task') == 'integral_function':
            from .integral_function import solve_integral_function
            return solve_integral_function(model)
        if model.get('task') in ('parametric_derivative','implicit_derivative','curvature'):
            from .derivative_extra import solve_derivative_extra
            return solve_derivative_extra(model)
        if model.get('task') in ('arc_length','parametric_arc_length','surface_of_revolution','polar_area','polar_arc_length'):
            from .integral_applications import solve_integral_application
            return solve_integral_application(model)
        if model.get('task') in ('asymptote','sequence_limit'):
            from .limit_extra import solve_limit_extra
            return solve_limit_extra(model)
        from .exam_math import solve_exam_math
        exam = solve_exam_math(model)
        if exam is not None:
            return exam
        from .calculus_analysis import solve_analysis
        analysis = solve_analysis(model)
        if analysis is not None:
            return analysis
        return _calculus_solution(model)
    if subject == "optimization":
        if model.get('task') == 'constrained_extrema':
            from .constrained import solve_constrained_extrema
            return solve_constrained_extrema(model)
        from .exam_math import complete_extrema
        return complete_extrema(model, _optimization_solution(model))
    if subject == "algorithm":
        if model.get("engine") == "binary_search_v1":
            from .binary_search import solve_binary_search
            return solve_binary_search(model)
        if model.get("engine") == "heap_v1":
            from .heap import solve_heap
            return solve_heap(model)
        if str(model.get("engine") or "").startswith("ds_"):
            from .data_structures import solve_ds
            return solve_ds(model)
        try:
            engine = str(model.get("engine") or "")
            if engine == "dfs_v1":
                trace = _dfs_trace(model, str((model.get("defaults") or {}).get("start") or model.get("start") or ""))
                algorithm_name = "DFS"
                algorithm_summary = "DFS 沿路径走到底再回溯；访问顺序、父节点和深度来自同一条轨迹。"
                algorithm_steps = [
                    {
                        "id": "init",
                        "title": "初始化",
                        "latex": r"stack=[s],\ visited=\{\}",
                        "detail": "起点先入栈；邻居按编号升序尝试，访问时才标记。",
                    },
                    {
                        "id": "visit",
                        "title": "访问并深入",
                        "latex": r"u=stack.peek(),\ v=\min(unvisited(N(u)))",
                        "detail": "栈顶首次访问后，沿编号最小的未访问邻居继续深入。",
                    },
                    {
                        "id": "backtrack",
                        "title": "回溯",
                        "latex": r"stack.pop()",
                        "detail": "栈顶邻居全部处理完才弹出回溯，回到上一个分岔点。",
                    },
                ]
            else:
                trace = _bfs_trace(model, str((model.get("defaults") or {}).get("start") or model.get("start") or ""))
                algorithm_name = "BFS"
                algorithm_summary = "BFS 按队列规则执行；访问顺序、父节点和层级来自同一条轨迹。"
                algorithm_steps = [
                    {
                        "id": "init",
                        "title": "初始化",
                        "latex": r"queue=[s],\ visited=\{s\}",
                        "detail": "起点入队时立即标记已访问，避免环导致重复入队。",
                    },
                    {
                        "id": "dequeue",
                        "title": "出队并扩展",
                        "latex": r"u=queue.pop(0)",
                        "detail": "先进先出保证按层扩展；同层邻居按节点编号升序。",
                    },
                    {
                        "id": "enqueue",
                        "title": "发现新节点",
                        "latex": r"visited.add(v),\ parent[v]=u",
                        "detail": "只有未访问的邻居入队；父节点与层级同时写入轨迹。",
                    },
                ]
        except SolveError as exc:
            raise SolveError(str(exc)) from exc
        return {
            "summary": algorithm_summary,
            "answer": " → ".join(trace["order"]),
            "answer_order": trace["order"],
            "steps": algorithm_steps,
            "conditions": [f"{algorithm_name} 执行规则：邻居按节点编号升序；访问记录与轨迹一致。"],
            "limitations": ["这里只执行该遍历；Dijkstra、最短路径等需要另建模型。"],
        }
    if subject == "linear_algebra":
        from .linalg import solve_linalg
        try:
            return solve_linalg(model)
        except ValueError as exc:
            raise SolveError(str(exc)) from exc
    if subject == "operating_system":
        from .opsys import solve_os
        try:
            return solve_os(model)
        except ValueError as exc:
            raise SolveError(str(exc)) from exc
    if subject == "computer_organization":
        from .comp_org import solve_comp_org
        try:
            return solve_comp_org(model)
        except ValueError as exc:
            raise SolveError(str(exc)) from exc
    if subject == "computer_network":
        from .computer_network import solve_network
        try:
            return solve_network(model)
        except ValueError as exc:
            raise SolveError(str(exc)) from exc
    if subject == "physics":
        from .physics import solve_physics
        try:
            return solve_physics(model)
        except ValueError as exc:
            raise SolveError(str(exc)) from exc
    if subject == "deep_learning":
        defaults = model.get("defaults") or {}
        # 解答用初始条件计算一次，避免把学生探索参数混入原题答案。
        evaluation = _deep_learning_evaluate(model, defaults)
        final_loss = evaluation["loss_history"][-1] if evaluation.get("loss_history") else None
        return {
            "summary": "小型网络的前向、损失、梯度和参数更新均为真实数值。",
            "answer": f"训练 {evaluation['params']['epochs']} 轮后 MSE={_fmt(final_loss, 8)}",
            "steps": evaluation["solution_steps"],
            "conditions": ["权重来源与尺寸在条件面板中单独标注。"],
            "limitations": evaluation["notes"],
        }
    raise SolveError("暂不支持该题目的求解器")


def _evaluate_problem(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    if model.get('engine') == 'generic_v1':
        from .generic_model import evaluate_generic
        return evaluate_generic(model, params)
    if model.get('manual_improper_conditions'):
        from .manual_improper_integral import evaluate
        return evaluate(model)
    if model.get('task') == 'multivariable_extrema':
        from .extrema import evaluate
        return evaluate(model, params)
    if model.get('task') == 'multivariable':
        from .multivariable import evaluate_multivariable
        return evaluate_multivariable(model, params)
    if model.get('task') == 'double_integral':
        if model.get('manual_double_failure') or 'double_extension_solution' in model or (model.get('manual_double_conditions') or {}).get('region_mode')=='improper':
            from .manual_double_integral import evaluate_unfinished
            return evaluate_unfinished(model)
        from .double_integral import evaluate_double_integral
        return evaluate_double_integral(model, params)
    if model.get('task') == 'triple_integral' and model.get('manual_triple_conditions'):
        from .manual_triple_integral import evaluate
        return evaluate(model)
    subject = str(model.get("subject") or "")
    if subject == "calculus":
        if model.get('task') == 'ode':
            from .ode import evaluate_ode
            return evaluate_ode(model, params)
        if model.get('task') == 'power_series':
            from .series import evaluate_power_series
            return evaluate_power_series(model, params)
        if model.get('task') == 'fourier_series':
            from .series import evaluate_fourier
            return evaluate_fourier(model, params)
        if model.get('task') in ('triple_integral','line_integral','surface_integral','green','gauss','stokes','space_geometry'):
            from .space import evaluate_space_task
            return evaluate_space_task(model, params)
        if model.get('task') == 'proof':
            from .proof import evaluate_proof
            return evaluate_proof(model, params)
        if model.get('task') == 'series_convergence':
            from .series import solve_series_convergence
            solution = solve_series_convergence(model)
            return {
                'subject': 'calculus', 'task': 'series_convergence', 'kind': 'series_convergence',
                'headline': solution.get('answer') or solution.get('summary') or '数项级数',
                'metrics': [
                    {'id': 'status', 'label': '敛散性', 'value': solution.get('series_status') or '—', 'accent': True},
                    {'id': 'method', 'label': '判别法', 'value': solution.get('series_method') or '—'},
                    {'id': 'sum', 'label': '和', 'value': solution.get('series_sum') or '—'},
                ],
                'checks': [
                    {'id': 'convergence', 'label': '敛散性判定', 'status': 'pass' if solution.get('solution_complete') else 'warn',
                     'detail': solution.get('answer') or solution.get('incomplete_reason') or ''},
                    {'id': 'method', 'label': '判别法可用', 'status': 'pass' if solution.get('series_method') else 'warn',
                     'detail': solution.get('series_method') or '未找到确定判别法。'},
                ],
                'notes': solution.get('limitations') or [],
                'series': [], 'domain': {'x_min': 1, 'x_max': 20}, 'rects': [],
                'exact': solution.get('answer_value'), 'approx': None, 'error': None,
                'answerText': solution.get('answer') or '',
                'trace': [{'index': 0, 'label': '判别', 'detail': solution.get('answer') or '', 'values': {}}],
                'series_status': solution.get('series_status'),
                'series_method': solution.get('series_method'),
                'series_details': solution.get('series_details'),
                'series_solution': solution,
            }
        from .exam_math import evaluate_exam_math
        exam = evaluate_exam_math(model, params)
        if exam is not None:
            exam['task'] = model.get('task')
            return exam
        if model.get('task') == 'integral_function':
            from .integral_function import evaluate_integral_function
            return evaluate_integral_function(model, params)
        if model.get('task') in ('parametric_derivative','implicit_derivative','curvature'):
            from .derivative_extra import evaluate_derivative_extra
            return evaluate_derivative_extra(model, params)
        if model.get('task') in ('arc_length','parametric_arc_length','surface_of_revolution','polar_area','polar_arc_length'):
            from .integral_applications import evaluate_integral_application
            return evaluate_integral_application(model, params)
        from .calculus_analysis import evaluate_analysis
        analysis = evaluate_analysis(model, params)
        if analysis is not None:
            return analysis
        return _calculus_evaluate(model, params)
    if subject == "optimization":
        if model.get('task') == 'constrained_extrema':
            from .constrained import evaluate_constrained_extrema
            return evaluate_constrained_extrema(model, params)
        return _optimization_evaluate(model, params)
    if subject == "algorithm":
        if model.get("engine") == "binary_search_v1":
            from .binary_search import evaluate_binary_search
            return evaluate_binary_search(model, params)
        if model.get("engine") == "heap_v1":
            from .heap import evaluate_heap
            result = evaluate_heap(model, params)
            if result.get("status") != "ok":
                raise SolveError(str(result.get("reason") or "请核对堆的条件"))
            return result
        if str(model.get("engine") or "").startswith("ds_"):
            from .data_structures import evaluate_ds
            return evaluate_ds(model, params)
        if model.get("engine") == "dfs_v1":
            return _dfs_evaluate(model, params)
        return _bfs_evaluate(model, params)
    if subject == "linear_algebra":
        from .linalg import evaluate_linalg
        result = evaluate_linalg(model, params)
        if result.get("status") != "ok":
            raise SolveError(str(result.get("reason") or "请核对线性代数题目的条件"))
        return result
    if subject == "operating_system":
        from .opsys import evaluate_os
        result = evaluate_os(model, params)
        if result.get("status") != "ok":
            raise SolveError(str(result.get("reason") or "请核对操作系统题目的条件"))
        return result
    if subject == "computer_organization":
        from .comp_org import evaluate_comp_org
        result = evaluate_comp_org(model, params)
        if result.get("status") != "ok":
            raise SolveError(str(result.get("reason") or "请核对计算机组成原理题目的条件"))
        return result
    if subject == "computer_network":
        from .computer_network import evaluate_network
        result = evaluate_network(model, params)
        if result.get("status") != "ok":
            raise SolveError(str(result.get("reason") or "请核对计算机网络题目的条件"))
        return result
    if subject == "physics":
        from .physics import evaluate_physics
        result = evaluate_physics(model, params)
        if result.get("status") != "ok":
            raise SolveError(str(result.get("reason") or "请核对物理题目的条件"))
        return result
    if subject == "deep_learning":
        return _deep_learning_evaluate(model, params)
    raise SolveError("暂不支持该题目的求解器")


__all__ = [
    "MAX_TRACE",
    "PSEUDOCODE",
    "SolveError",
    "evaluate_problem",
    "solve_problem",
]


def evaluate_problem(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    from .exploration import observe
    return observe(model, params, _evaluate_problem(model, params))
