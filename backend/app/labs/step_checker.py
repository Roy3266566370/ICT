"""引导模式中间步骤符号核验与苏格拉底式追问（借鉴 stem-tutor-agent 与 SocraticMath）。

核心原则：
1. 用 SymPy 逐项检验学生提交的中间表达式或等式变形，定位具体错因（符号反了、漏掉常数系数/链式法则因子、常数项偏差等）；
2. 只给诊断与苏格拉底式反问，不直接剧透最终答案；
3. 无法安全解析时明确提示写法，不伪造正误结论。
"""
from __future__ import annotations

from typing import Any, Mapping

import sympy as sp

from .expr import parse_expression, to_latex
from .integral_methods import verifies_antiderivative
from .math_verify_adapter import verify_math_equivalence


def _try_parse(raw: str, variables: list[str]) -> sp.Expr | None:
    text = (raw or "").strip().strip("$").strip()
    if not text or len(text) > 500:
        return None
    try:
        return parse_expression(text, variables)
    except Exception:  # noqa: BLE001
        return None


def _diagnose_pair(student: sp.Expr, target: sp.Expr, variable: sp.Symbol | None = None) -> tuple[bool, str, str]:
    """比较学生表达式与目标表达式，返回 (是否等价, 错因诊断, 苏格拉底追问)。"""
    try:
        diff = sp.simplify(student - target)
    except Exception:  # noqa: BLE001
        diff = student - target
    if diff == 0:
        return True, "这一步的符号表达式与确定性内核完全等价。", ""

    try:
        if sp.simplify(student + target) == 0:
            return (
                False,
                "方向或正负号反了（你的结果恰好是目标的相反数）。",
                "请检查这一步中的负号、求导/积分符号（例如 sin 与 cos 的符号变化），再试一次？",
            )
    except Exception:  # noqa: BLE001
        pass

    try:
        if target != 0:
            ratio = sp.simplify(student / target)
            if ratio.is_number and ratio.is_real and ratio != 1:
                return (
                    False,
                    f"主体结构已经非常接近，但相差了一个常数倍系数（约 {to_latex(ratio)} 倍）。",
                    "想想看：是幂函数求导/积分时忘了乘除指数，还是复合函数凑微分/链式法则漏了内层导数系数？",
                )
    except Exception:  # noqa: BLE001
        pass

    if getattr(diff, "is_number", False) and diff != 0:
        return (
            False,
            "含变量的项已对齐，但常数项存在偏差。",
            "请核对展开后的常数项或代值计算过程，看看常数部分哪里多加/少减了一项？",
        )

    hint_var = str(variable) if variable is not None else "x"
    return (
        False,
        "这一步与当前目标表达式尚不等价。",
        f"试着取一个简单数值（如 {hint_var}=1 或 {hint_var}=2）分别代入原式和你的式子，看看两边的数值从哪一项开始不一致？",
    )


def diagnose_intermediate_step(
    problem: Mapping[str, Any],
    evaluation: Mapping[str, Any],
    step_input: str,
) -> dict[str, Any]:
    """对引导模式下学生提交的中间步骤做 SymPy 符号诊断并生成苏格拉底追问。"""
    raw = (step_input or "").strip()
    model = problem.get("model") or {}
    solution = problem.get("solution") or {}
    subject = str(problem.get("subject") or "")
    kind = str(model.get("kind") or "")
    var_name = str(model.get("variable") or "x")
    variables = list(dict.fromkeys([var_name, *(model.get("variables") or []), "x", "y", "t", "C"]))

    # 1) 等式变形步骤：lhs = rhs（如因式分解、通分、三角恒等变形）
    if "=" in raw and raw.count("=") == 1:
        lhs_raw, rhs_raw = [part.strip() for part in raw.split("=", 1)]
        lhs = _try_parse(lhs_raw, variables)
        rhs = _try_parse(rhs_raw, variables)
        if lhs is not None and rhs is not None:
            ok, diag, question = _diagnose_pair(lhs, rhs, sp.Symbol(var_name, real=True))
            if ok:
                return {
                    "correct": True,
                    "expected": "",
                    "actual": raw,
                    "field": "step",
                    "kind": "step",
                    "feedback": (
                        "判断：正确（等式恒等变形核验通过）。\n"
                        "这一步代数/三角变形完全等价！下一步你准备对右端式子做什么操作？"
                    ),
                }
            return {
                "correct": False,
                "expected": "",
                "actual": raw,
                "field": "step",
                "kind": "step",
                "feedback": f"判断：这一步变形有偏差。\n诊断：{diag}\n思考：{question}",
            }
        # 尝试 Math-Verify 兜底（处理带 LaTeX 的等式变形）
        mv = verify_math_equivalence(lhs_raw, rhs_raw)
        if mv is True:
            return {
                "correct": True,
                "expected": "",
                "actual": raw,
                "field": "step",
                "kind": "step",
                "feedback": "判断：正确（LaTeX 等式变形等价核验通过）。\n下一步可以继续基于右端推进求解。",
            }
        if mv is False:
            return {
                "correct": False,
                "expected": "",
                "actual": raw,
                "field": "step",
                "kind": "step",
                "feedback": "判断：这一步等式两边不等价。\n思考：请检查分式通分、括号展开或移项时的符号与系数。",
            }

    # 2) 微积分核心题型中间步骤诊断（原函数 / 导函数）
    expr_raw = str(model.get("expression") or "").strip()
    if subject == "calculus" and expr_raw:
        var = sp.Symbol(var_name, real=True)
        integrand_or_fn = _try_parse(expr_raw, variables)
        student_expr = _try_parse(raw, variables)
        if integrand_or_fn is not None and student_expr is not None:
            if kind in ("integral", "antiderivative"):
                if verifies_antiderivative(student_expr, integrand_or_fn, var):
                    next_q = (
                        "下一步如何代入定积分上下限应用牛顿-莱布尼茨公式 F(b)-F(a)？"
                        if kind == "integral"
                        else "原函数求导已验证通过！作为不定积分，最后别忘了补上什么？"
                    )
                    return {
                        "correct": True,
                        "expected": "",
                        "actual": raw,
                        "field": "step",
                        "kind": "step",
                        "feedback": f"判断：正确（求导核验通过，你的式子是合法原函数）。\n引导：{next_q}",
                    }
                # 对学生写的候选原函数求导，与原被积函数对比定位具体错因
                try:
                    student_deriv = sp.diff(student_expr, var)
                except Exception:  # noqa: BLE001
                    student_deriv = None
                if student_deriv is not None:
                    _, diag, question = _diagnose_pair(student_deriv, integrand_or_fn, var)
                    return {
                        "correct": False,
                        "expected": "",
                        "actual": raw,
                        "field": "step",
                        "kind": "step",
                        "feedback": (
                            f"判断：原函数还需要调整（对你的候选式求导得到 {to_latex(student_deriv)}）。\n"
                            f"诊断：{diag}\n思考：{question}"
                        ),
                    }

            if kind in ("derivative", "higher_derivative"):
                order = int(model.get("order") or 1) if kind == "higher_derivative" else 1
                try:
                    target_deriv = sp.diff(integrand_or_fn, var, max(1, min(order, 10)))
                except Exception:  # noqa: BLE001
                    target_deriv = None
                if target_deriv is not None:
                    ok, diag, question = _diagnose_pair(student_expr, target_deriv, var)
                    if ok:
                        next_q = (
                            "导函数完全正确！下一步把研究点代入导函数求斜率，再写出切线方程试试？"
                            if kind == "derivative"
                            else "这一阶导函数完全正确！如果题目要求继续求值，下一步代入给定点即可。"
                        )
                        return {
                            "correct": True,
                            "expected": "",
                            "actual": raw,
                            "field": "step",
                            "kind": "step",
                            "feedback": f"判断：正确（导函数符号核验通过）。\n引导：{next_q}",
                        }
                    return {
                        "correct": False,
                        "expected": "",
                        "actual": raw,
                        "field": "step",
                        "kind": "step",
                        "feedback": f"判断：导函数还需要调整。\n诊断：{diag}\n思考：{question}",
                    }

    # 3) 通用兜底：与最终解析式比对（不泄露最终答案）
    expected_exact = str(solution.get("exact") or solution.get("answer") or "").strip()
    if expected_exact and verify_math_equivalence(expected_exact, raw) is True:
        return {
            "correct": True,
            "expected": "",
            "actual": raw,
            "field": "step",
            "kind": "step",
            "feedback": "判断：正确！你这一步已经直接到达与原题等价的结论，可以去下方「提交我的尝试」正式核验记录。",
        }

    return {
        "correct": False,
        "expected": "",
        "actual": raw,
        "field": "step",
        "kind": "step",
        "feedback": (
            "判断：暂未能把这一步与当前内核步骤建立等价关系。\n"
            "思考：可以写成“左式 = 右式”的变形等式（例如 `(x^2-1)/(x-1) = x+1`），"
            "或直接写出你求得的原函数 / 导函数表达式，我帮你用符号内核逐项核对。"
        ),
    }


__all__ = ["diagnose_intermediate_step"]
