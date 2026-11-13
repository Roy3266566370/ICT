"""独立积分验收：真实题型、独立期望值、按错误类型统计。

开发调试用例允许围绕已修问题反复调整；这里的题目只按数学分类选取，
期望答案由人工推导后写成 SymPy 可核对的形式。脚本同时检查答案、步骤、
条件保留、验证等级、图形评估和改参后的一致性，失败按类型计数而不是只看
“多少条测试通过”。
"""
from __future__ import annotations

import json
import math
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import sympy as sp

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.labs.expr import safe_float, to_latex
from app.labs.manual import build_manual_document
from app.labs.solvers import evaluate_problem

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_DIR = REPO_ROOT / "verify" / "integral-acceptance-2026-11-13"
VARIABLE = sp.Symbol("x", real=True)

METRIC_KEYS = (
    "answer_error",
    "step_error",
    "false_unsupported",
    "condition_loss",
    "condition_extra",
    "verification_error",
    "consistency_error",
    "exception",
)
METRIC_LABELS = {
    "answer_error": "答案错误",
    "step_error": "步骤错误",
    "false_unsupported": "误判不支持",
    "condition_loss": "条件丢失",
    "condition_extra": "条件/定义域被擅自扩写",
    "verification_error": "验证等级错误",
    "consistency_error": "答案/图形/改参不一致",
    "exception": "运行异常",
}

_LOCALS = {
    "sin": sp.sin, "cos": sp.cos, "tan": sp.tan, "cot": sp.cot,
    "sec": sp.sec, "csc": sp.csc, "asin": sp.asin, "acos": sp.acos,
    "atan": sp.atan, "acot": sp.acot, "sinh": sp.sinh, "cosh": sp.cosh,
    "tanh": sp.tanh, "exp": sp.exp, "log": sp.log, "sqrt": sp.sqrt,
    "Abs": sp.Abs, "pi": sp.pi, "E": sp.E, "erf": sp.erf, "Si": sp.Si,
    "Ci": sp.Ci, "li": sp.li, "Ei": sp.Ei,
}


@dataclass(frozen=True)
class AcceptanceCase:
    id: str
    category: str
    task: str
    expression: str
    expected_status: str
    lower: str | None = None
    upper: str | None = None
    expected_verification: str | None = None
    expected_antiderivative: str | None = None
    expected_exact: str | None = None
    expected_numeric: float | None = None
    expected_method: str | None = None
    required_text: tuple[str, ...] = ()
    forbidden_text: tuple[str, ...] = ()
    check_changed_params: bool = False
    note: str = ""


CASES: tuple[AcceptanceCase, ...] = (
    # 换元
    AcceptanceCase("sub-poly-exp", "换元", "antiderivative", "3*x^2*exp(x^3)", "complete",
                   expected_verification="symbolic", expected_antiderivative="exp(x^3)",
                   expected_method="substitution", note="复合函数与导数配对"),
    AcceptanceCase("sub-linear-trig", "换元", "antiderivative", "cos(2*x+1)", "complete",
                   expected_verification="symbolic", expected_antiderivative="sin(2*x+1)/2",
                   expected_method="substitution", note="线性内层"),
    AcceptanceCase("sub-radical", "换元", "antiderivative", "x^2*sqrt(x^3+1)", "complete",
                   expected_verification="symbolic",
                   expected_antiderivative="2*(x^3+1)^(3/2)/9",
                   expected_method="substitution", note="根式换元"),
    # 分部
    AcceptanceCase("parts-xcos", "分部", "antiderivative", "x*cos(x)", "complete",
                   expected_verification="symbolic", expected_antiderivative="x*sin(x)+cos(x)",
                   expected_method="parts"),
    AcceptanceCase("parts-x2exp", "分部", "antiderivative", "x^2*exp(x)", "complete",
                   expected_verification="symbolic",
                   expected_antiderivative="(x^2-2*x+2)*exp(x)",
                   expected_method="parts", note="两次分部"),
    AcceptanceCase("parts-log", "分部", "antiderivative", "log(x)", "complete",
                   expected_verification="symbolic", expected_antiderivative="x*(log(x)-1)",
                   expected_method="parts", note="对数只在正半轴有定义"),
    AcceptanceCase("parts-xlog", "分部", "antiderivative", "x*log(x)", "complete",
                   expected_verification="symbolic",
                   expected_antiderivative="x^2*(2*log(x)-1)/4", expected_method="parts"),
    AcceptanceCase("parts-atan", "分部", "antiderivative", "atan(x)", "complete",
                   expected_verification="symbolic",
                   expected_antiderivative="x*atan(x)-log(x^2+1)/2", expected_method="parts"),
    # 对数与定义域
    AcceptanceCase("log-recip", "对数", "antiderivative", "1/x", "complete",
                   expected_verification="symbolic", expected_antiderivative="log(Abs(x))",
                   required_text=("log|·|",), note="负半轴仍为实值，必须用 log|x|"),
    AcceptanceCase("log-nested", "对数", "antiderivative", "1/(x*log(x))", "complete",
                   expected_verification="numeric",
                   expected_antiderivative="log(Abs(log(x)))",
                   expected_method="substitution",
                   required_text=("log|·|", "数值抽查", "不是全域证明"),
                   note="符号化简未通过，只能数值抽查"),
    AcceptanceCase("log-over-x", "对数", "antiderivative", "log(x)/x", "complete",
                   expected_verification="symbolic", expected_antiderivative="log(x)^2/2",
                   expected_method="substitution"),
    AcceptanceCase("log-square", "对数", "antiderivative", "log(x)^2", "complete",
                   expected_verification="symbolic",
                   expected_antiderivative="x*(log(x)^2-2*log(x)+2)",
                   expected_method="parts", forbidden_text=("log|·|",),
                   note="被积函数在负半轴非实，不能扩写为 log|x|"),
    # 根式
    AcceptanceCase("radical-sqrt", "根式", "antiderivative", "sqrt(x)", "complete",
                   expected_verification="symbolic", expected_antiderivative="2*x^(3/2)/3"),
    AcceptanceCase("radical-shift", "根式", "antiderivative", "x*sqrt(x+1)", "complete",
                   expected_verification="symbolic",
                   expected_antiderivative="2*(x+1)^(3/2)*(3*x-2)/15",
                   expected_method="parts"),
    AcceptanceCase("radical-asin", "根式", "antiderivative", "1/sqrt(1-x^2)", "complete",
                   expected_verification="symbolic", expected_antiderivative="asin(x)"),
    # 周期函数
    AcceptanceCase("periodic-sin2", "周期函数", "antiderivative", "sin(x)^2", "complete",
                   expected_verification="symbolic",
                   expected_antiderivative="x/2-sin(2*x)/4"),
    AcceptanceCase("periodic-tan", "周期函数", "antiderivative", "tan(x)", "complete",
                   expected_verification="symbolic", expected_antiderivative="-log(Abs(cos(x)))",
                   required_text=("log|·|",)),
    AcceptanceCase("periodic-sec2", "周期函数", "antiderivative", "sec(x)^2", "complete",
                   expected_verification="symbolic", expected_antiderivative="tan(x)"),
    # 特殊函数与非初等
    AcceptanceCase("special-gauss", "特殊函数", "antiderivative", "exp(-x^2)", "complete",
                   expected_verification="symbolic",
                   expected_antiderivative="sqrt(pi)*erf(x)/2"),
    AcceptanceCase("special-sinc", "特殊函数", "antiderivative", "sin(x)/x", "complete",
                   expected_verification="symbolic", expected_antiderivative="Si(x)",
                   note="非初等但可核验为 Si(x)"),
    AcceptanceCase("non-elementary-power", "非初等", "antiderivative", "x^x", "unsupported",
                   expected_verification="unconfirmed", required_text=("未完成",)),
    AcceptanceCase("non-elementary-sin1x", "非初等", "antiderivative", "sin(1/x)", "unsupported",
                   expected_verification="unconfirmed", required_text=("未通过核验",)),
    # 定积分：瑕点
    AcceptanceCase("def-log-endpoint", "瑕点", "integral", "log(x)", "complete",
                   lower="0", upper="1", expected_exact="-1", expected_numeric=-1.0,
                   required_text=("瑕点", "单侧极限"), note="端点瑕点，积分收敛"),
    AcceptanceCase("def-sqrt-endpoint", "瑕点", "integral", "1/sqrt(x)", "complete",
                   lower="0", upper="1", expected_exact="2", expected_numeric=2.0,
                   required_text=("瑕点", "单侧极限")),
    AcceptanceCase("def-tan-divergent", "瑕点", "integral", "tan(x)", "divergent",
                   lower="0", upper="pi/2", required_text=("发散", "瑕点"),
                   note="端点瑕点，积分发散"),
    AcceptanceCase("def-recip-divergent", "瑕点", "integral", "1/x", "divergent",
                   lower="-1", upper="1", required_text=("发散", "瑕点"),
                   note="内部瑕点，不能取柯西主值"),
    # 定积分：反向区间
    AcceptanceCase("def-reversed-poly", "反向区间", "integral", "x^2", "complete",
                   lower="2", upper="0", expected_exact="-8/3",
                   expected_numeric=-8 / 3, check_changed_params=True,
                   forbidden_text=("交换",), note="反向区间必须保留上下限顺序和负号"),
    AcceptanceCase("def-reversed-sin", "反向区间", "integral", "sin(x)", "complete",
                   lower="pi", upper="0", expected_exact="-2", expected_numeric=-2.0,
                   check_changed_params=True, forbidden_text=("交换",)),
    # 定积分：特殊结果与未完成
    AcceptanceCase("def-gauss", "特殊函数", "integral", "exp(-x^2)", "complete",
                   lower="0", upper="1", expected_exact="sqrt(pi)*erf(1)/2",
                   expected_numeric=0.7468241328124271, check_changed_params=True),
    AcceptanceCase("def-sqrt-square", "根式", "integral", "sqrt(x)^2", "complete",
                   lower="0", upper="1", expected_exact="1/2", expected_numeric=0.5,
                   check_changed_params=True, note="保持原式结构，不在识别阶段改写"),
    AcceptanceCase("def-power-unsupported", "非初等", "integral", "x^x", "unsupported",
                   lower="1", upper="2", required_text=("未能确认",)),
)

CATEGORY_ORDER = ("换元", "分部", "对数", "根式", "周期函数", "特殊函数", "非初等", "瑕点", "反向区间")


def _parse(text: str) -> sp.Expr:
    return sp.sympify(str(text).replace("^", "**"), locals=_LOCALS)


def _extract_antiderivative(answer: str) -> sp.Expr | None:
    match = re.fullmatch(r"F\([^)]*\)=(.*?)\s*\+\s*C", answer.strip())
    if match is None:
        return None
    return _parse(match.group(1))


def _same_antiderivative(actual: sp.Expr, expected: sp.Expr) -> bool:
    try:
        difference = sp.simplify(actual - expected)
        if difference == 0:
            return True
        return sp.simplify(sp.diff(difference, VARIABLE)) == 0
    except Exception:  # noqa: BLE001 - 符号化简失败时退到数值抽查
        pass
    for sample in (-2.3, -1.4, -0.7, 0.6, 1.2, 2.1):
        try:
            left = complex(sp.N(actual.subs(VARIABLE, sample), 15))
            right = complex(sp.N(expected.subs(VARIABLE, sample), 15))
        except Exception:  # noqa: BLE001
            return False
        if not (math.isfinite(left.real) and math.isfinite(right.real)):
            return False
        if abs(left.imag) > 1e-8 or abs(right.imag) > 1e-8:
            return False
        if abs(left.real - right.real) > 1e-6 * max(1.0, abs(right.real)):
            return False
    return True


def _same_exact(actual: str, expected: str) -> bool:
    try:
        return sp.simplify(_parse(actual) - _parse(expected)) == 0
    except Exception:  # noqa: BLE001
        return False


def _numeric_close(actual: float | None, expected: float) -> bool:
    if actual is None:
        return False
    return abs(actual - expected) <= 1e-7 * max(1.0, abs(expected))


def _condition_text(problem: dict[str, Any]) -> str:
    solution = problem["solution"]
    parts = list(solution.get("conditions") or []) + list(solution.get("limitations") or [])
    parts.append(problem["manual_input"].get("result_note") or "")
    parts.append(solution.get("summary") or "")
    return "\n".join(parts)


def _all_step_text(problem: dict[str, Any]) -> str:
    steps = problem["solution"].get("steps") or []
    return "\n".join(
        f"{step.get('title', '')}\n{step.get('detail', '')}\n{step.get('latex', '')}"
        for step in steps
    )


def _record(metric: str, errors: dict[str, list[str]], message: str) -> None:
    errors[metric].append(message)


def run_case(case: AcceptanceCase) -> dict[str, Any]:
    errors: dict[str, list[str]] = {key: [] for key in METRIC_KEYS}
    started = time.perf_counter()
    conditions: dict[str, Any] = {"expression": case.expression, "variable": "x"}
    if case.task == "integral":
        conditions.update(lower=case.lower, upper=case.upper)
    try:
        problem = build_manual_document(
            lab_id="acceptance", title="", task=case.task,
            conditions=conditions, now_iso="acceptance")["problems"][0]
    except Exception as exc:  # noqa: BLE001 - 记录异常，不中断整批
        _record("exception", errors, f"{type(exc).__name__}: {exc}")
        return {
            "id": case.id, "category": case.category, "task": case.task,
            "input": conditions, "expected_status": case.expected_status,
            "actual": None, "metrics": errors,
            "passed": False, "elapsed_seconds": round(time.perf_counter() - started, 2),
        }

    solution = problem["solution"]
    manual = problem["manual_input"]
    actual_status = manual.get("result_status")
    steps = solution.get("steps") or []
    step_ids = [str(step.get("id") or "") for step in steps]
    condition_text = _condition_text(problem)
    all_text = "\n".join([condition_text, _all_step_text(problem),
                          manual.get("result_answer") or "", manual.get("result_latex") or ""])

    if not steps or any(not step.get("id") or not step.get("title") or not step.get("detail")
                        for step in steps):
        _record("step_error", errors, "步骤缺少 id/title/detail")

    # 状态判定：区分输入/内核未完成与真正的答案错误。
    if case.expected_status != actual_status:
        if case.expected_status == "complete" and actual_status == "unsupported":
            _record("false_unsupported", errors, f"期望可计算，实际为 {actual_status}")
        else:
            _record("answer_error", errors, f"期望状态 {case.expected_status}，实际 {actual_status}")

    if case.task == "integral":
        if "limits" not in step_ids or "evaluate" not in step_ids:
            _record("step_error", errors, "定积分缺少确认区间或求值步骤")
        if str(manual.get("conditions", {}).get("lower")) != str(case.lower):
            _record("condition_loss", errors, "下限文本被改写或丢失")
        if str(manual.get("conditions", {}).get("upper")) != str(case.upper):
            _record("condition_loss", errors, "上限文本被改写或丢失")
        exact_bounds = problem["model"].get("exact_bounds") or {}
        if str(exact_bounds.get("lower")) != str(case.lower) or str(exact_bounds.get("upper")) != str(case.upper):
            _record("condition_loss", errors, "精确端点未按原题保留")
    else:
        if "lower" in manual.get("conditions", {}) or "upper" in manual.get("conditions", {}):
            _record("condition_extra", errors, "不定积分被补入上下限")
        if "原式在" in condition_text:
            _record("condition_extra", errors, "不定积分补入了未声明的瑕点条件")
        if "一族原函数" not in condition_text:
            _record("condition_loss", errors, "缺少原函数族/常数 C 的说明")

    for required in case.required_text:
        if required not in all_text:
            _record("condition_loss", errors, f"缺少必要说明：{required}")
    for forbidden in case.forbidden_text:
        searchable = "\n".join([
            condition_text, manual.get("result_answer") or "", manual.get("result_latex") or "",
        ])
        if forbidden in searchable:
            _record("condition_extra", errors, f"不应出现：{forbidden}")

    actual_verification = manual.get("verification") or {}
    actual_level = actual_verification.get("level")
    if case.expected_verification:
        if actual_level != case.expected_verification:
            _record("verification_error", errors,
                    f"期望验证等级 {case.expected_verification}，实际 {actual_level}")
        if solution.get("verification") != manual.get("verification"):
            _record("consistency_error", errors, "解答与结果区的验证等级不一致")
        if not actual_verification.get("label") or not actual_verification.get("detail"):
            _record("verification_error", errors, "验证等级缺少标签或说明")
        if case.expected_verification == "numeric" and "非全域证明" not in str(actual_verification.get("label")):
            _record("verification_error", errors, "数值抽查未标注非全域证明")
        if case.expected_verification == "unconfirmed" and "尚未确认" not in str(actual_verification.get("label")):
            _record("verification_error", errors, "未确认等级未明确标注")

    verify_steps = [step for step in steps if step.get("id") == "verify"]
    if case.expected_verification == "unconfirmed":
        if verify_steps:
            _record("step_error", errors, "未确认结果不应展示核对步骤")
        if solution.get("answer"):
            _record("answer_error", errors, "未确认结果仍给出了答案")
        if problem["model"].get("antiderivative_expression") is not None:
            _record("consistency_error", errors, "未核验候选式仍被写入图形模型")
        if not (manual.get("result_note") or "").strip():
            _record("condition_loss", errors, "未确认结果缺少原因说明")
    elif case.expected_verification:
        expected_title = "符号求导核对" if case.expected_verification == "symbolic" else "数值抽查核对"
        if not verify_steps or verify_steps[0].get("title") != expected_title:
            _record("step_error", errors, f"缺少“{expected_title}”步骤")
        if "+C" not in (solution.get("answer") or ""):
            _record("answer_error", errors, "不定积分答案缺少 +C")

    if case.expected_method:
        prefix = f"method-{case.expected_method}"
        if not any(step_id.startswith(prefix) for step_id in step_ids):
            _record("step_error", errors, f"缺少经核验的 {case.expected_method} 方法步骤")

    # 答案与展示一致性
    if case.expected_status == "complete" and actual_status == "complete":
        if case.task == "antiderivative":
            if manual.get("result_answer") != solution.get("answer"):
                _record("consistency_error", errors, "结果区答案与解答答案不一致")
            answer_expr = _extract_antiderivative(solution.get("answer") or "")
            if answer_expr is None:
                _record("answer_error", errors, "答案缺少 F(x)=...+C 形式")
            else:
                expected_expr = _parse(case.expected_antiderivative or "")
                if not _same_antiderivative(answer_expr, expected_expr):
                    _record("answer_error", errors, "原函数与独立期望值不一致")
                if solution.get("exact_latex") != manual.get("result_latex"):
                    _record("consistency_error", errors, "结果区展示与解答精确式不一致")
                displayed = str(manual.get("result_latex") or "")
                expected_latex = to_latex(answer_expr) + "+C"
                if displayed != expected_latex:
                    _record("consistency_error", errors, "结果 LaTeX 与答案表达式不一致")
                if "antiderivative" not in step_ids:
                    _record("step_error", errors, "缺少求原函数步骤")
        else:
            exact_text = solution.get("exact") or ""
            if not _same_exact(exact_text, case.expected_exact or ""):
                _record("answer_error", errors,
                        f"定积分精确值 {exact_text} 与期望 {case.expected_exact} 不一致")
            if not _numeric_close(solution.get("answer_value"), case.expected_numeric or 0.0):
                _record("answer_error", errors, "定积分数值答案与期望不一致")
            approx = safe_float(manual.get("result_approx"))
            if not _numeric_close(approx, case.expected_numeric or 0.0):
                _record("consistency_error", errors, "结果区数值近似与期望不一致")
            if manual.get("result_latex") != solution.get("exact_latex"):
                _record("consistency_error", errors, "结果区展示与解答精确式不一致")
            try:
                expected_latex = to_latex(_parse(exact_text))
            except Exception:  # noqa: BLE001
                expected_latex = ""
            if expected_latex and manual.get("result_latex") != expected_latex:
                _record("consistency_error", errors, "结果 LaTeX 与数学表达式不一致")
            if "antiderivative" not in step_ids:
                _record("step_error", errors, "定积分缺少原函数步骤")

    model = problem["model"]
    defaults = dict(model.get("defaults") or {})

    # 图形与改参：同一原函数、同一区间、同一常数语义。
    try:
        if case.task == "antiderivative" and actual_status == "complete":
            ev0 = evaluate_problem(model, {**defaults, "c": 0.0})
            ev5 = evaluate_problem(model, {**defaults, "c": 5.0})
            headline = str(ev0.get("headline") or "")
            if not headline.endswith("+C"):
                _record("consistency_error", errors, "图形评估标题缺少 +C")
            if "=" in headline:
                graph_rhs = re.sub(r"\s*\+\s*C\s*$", "", headline.rsplit("=", 1)[1].strip())
                graph_expr = _parse(graph_rhs)
                answer_expr = _extract_antiderivative(solution.get("answer") or "")
                if answer_expr is None or not _same_antiderivative(graph_expr, answer_expr):
                    _record("consistency_error", errors, "图形评估的原函数与答案不一致")
            overlap = [
                (right["y"] - left["y"])
                for left, right in zip(ev0.get("series") or [], ev5.get("series") or [])
                if left.get("y") is not None and right.get("y") is not None
            ]
            if len(overlap) < 20:
                _record("consistency_error", errors, "原函数图形在展示区间内不可用")
            elif max(abs(value - 5.0) for value in overlap) > 1e-6:
                _record("consistency_error", errors, "改变 C 时图形未按常数整体平移")
        elif case.task == "integral" and actual_status == "complete":
            evaluation = evaluate_problem(model, defaults)
            expected_numeric = case.expected_numeric or 0.0
            if evaluation.get("convergence") != "finite":
                _record("consistency_error", errors, "图形评估未确认积分收敛")
            if not _numeric_close(evaluation.get("answer"), expected_numeric):
                _record("consistency_error", errors, "图形评估的解析值与答案不一致")
            approx = evaluation.get("approx")
            error = evaluation.get("error")
            if approx is None or error is None:
                _record("consistency_error", errors, "图形评估缺少黎曼和或误差")
            elif abs(abs(approx - expected_numeric) - error) > 1e-5:
                _record("consistency_error", errors, "黎曼和、解析值与误差不是同一组数据")
            if case.check_changed_params:
                changed = evaluate_problem(model, {**defaults, "n": 32})
                if not _numeric_close(changed.get("answer"), expected_numeric):
                    _record("consistency_error", errors, "改分割数后解析值发生变化")
                if str(changed.get("params", {}).get("lower")) != str(evaluation.get("params", {}).get("lower")):
                    _record("consistency_error", errors, "改分割数时区间下限被改变")
        elif case.task == "integral" and actual_status == "divergent":
            evaluation = evaluate_problem(model, defaults)
            if evaluation.get("convergence") != "divergent" or evaluation.get("answer") is not None:
                _record("consistency_error", errors, "发散结果在图形评估中被当成有限值")
        elif case.task == "integral" and actual_status == "unsupported":
            evaluation = evaluate_problem(model, defaults)
            if evaluation.get("answer") is not None:
                _record("consistency_error", errors, "未完成结果仍给出了图形评估答案")
    except Exception as exc:  # noqa: BLE001
        _record("exception", errors, f"评估阶段 {type(exc).__name__}: {exc}")

    return {
        "id": case.id,
        "category": case.category,
        "task": case.task,
        "input": conditions,
        "expected_status": case.expected_status,
        "actual": {
            "result_status": actual_status,
            "solution_status": solution.get("solution_status"),
            "answer": solution.get("answer"),
            "exact": solution.get("exact"),
            "verification": actual_level,
            "method_steps": [step_id for step_id in step_ids if step_id.startswith("method-")],
            "conditions": solution.get("conditions") or [],
        },
        "metrics": errors,
        "passed": not any(errors.values()),
        "elapsed_seconds": round(time.perf_counter() - started, 2),
    }


def run_all(cases: tuple[AcceptanceCase, ...] = CASES) -> list[dict[str, Any]]:
    return [run_case(case) for case in cases]


def summarize(results: list[dict[str, Any]]) -> dict[str, Any]:
    metrics = {
        key: sum(1 for result in results if result["metrics"].get(key))
        for key in METRIC_KEYS
    }
    categories = {}
    for category in CATEGORY_ORDER:
        items = [result for result in results if result["category"] == category]
        if not items:
            continue
        categories[category] = {
            "total": len(items),
            "passed": sum(1 for item in items if item["passed"]),
            "failed": sum(1 for item in items if not item["passed"]),
            "metrics": {
                key: sum(1 for item in items if item["metrics"].get(key))
                for key in METRIC_KEYS
            },
        }
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dataset_size": len(results),
        "passed": sum(1 for result in results if result["passed"]),
        "failed": sum(1 for result in results if not result["passed"]),
        "metrics": metrics,
        "categories": categories,
        "cases": results,
        "limitations": [
            "验收题由人工按数学分类选取，不是随机抽样，不能代表所有题型。",
            "期望原函数用 SymPy 结构比较；相差常数视为同一原函数族。",
            "数值抽查阅验只说明样本点一致，不是全域证明；等级字段单独标注。",
            "定积分图形评估按当前分割数核对，分割数误差不代表解析值错误。",
            "未覆盖多元积分、参数积分、复积分和需要人工指定分支的题目。",
        ],
    }


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# 独立积分验收集报告",
        "",
        f"生成时间：{report['generated_at']}",
        "",
        f"- 题目数：{report['dataset_size']}",
        f"- 通过：{report['passed']}",
        f"- 未通过：{report['failed']}",
        "",
        "## 错误类型统计",
        "",
        "| 类型 | 受影响题目数 |",
        "| --- | ---: |",
    ]
    for key in METRIC_KEYS:
        lines.append(f"| {METRIC_LABELS[key]}（{key}） | {report['metrics'][key]} |")
    lines += ["", "## 分类结果", "", "| 分类 | 题数 | 通过 | 未通过 |", "| --- | ---: | ---: | ---: |"]
    for category, item in report["categories"].items():
        lines.append(f"| {category} | {item['total']} | {item['passed']} | {item['failed']} |")
    lines += ["", "## 逐题结果", "", "| 编号 | 分类 | 任务 | 状态 | 验证等级 | 方法 | 结果 |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for result in report["cases"]:
        actual = result.get("actual") or {}
        method = ", ".join(actual.get("method_steps") or []) or "—"
        lines.append(
            f"| {result['id']} | {result['category']} | {result['task']} | "
            f"{actual.get('result_status') or '—'} | {actual.get('verification') or '—'} | "
            f"{method} | {'通过' if result['passed'] else '未通过'} |")
    failures = [result for result in report["cases"] if not result["passed"]]
    lines += ["", "## 未通过详情", ""]
    if not failures:
        lines.append("本批次没有未通过题目。")
    else:
        for result in failures:
            lines.append(f"### {result['id']}")
            lines.append("")
            for key in METRIC_KEYS:
                for message in result["metrics"].get(key) or []:
                    lines.append(f"- {METRIC_LABELS[key]}：{message}")
            lines.append("")
    lines += ["", "## 口径与限制", ""]
    lines += [f"- {item}" for item in report["limitations"]]
    lines.append("")
    return "\n".join(lines)


def write_report(report: dict[str, Any], output_dir: Path = DEFAULT_OUTPUT_DIR) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "report.json"
    markdown_path = output_dir / "report.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    markdown_path.write_text(render_markdown(report), encoding="utf-8")
    return json_path, markdown_path


def main() -> int:
    results = run_all()
    report = summarize(results)
    json_path, markdown_path = write_report(report)
    metrics_text = "，".join(
        f"{METRIC_LABELS[key]} {report['metrics'][key]}" for key in METRIC_KEYS
        if report["metrics"][key])
    print(
        f"验收 {report['dataset_size']} 题：通过 {report['passed']}，未通过 {report['failed']}"
        + (f"；{metrics_text}" if metrics_text else "")
    )
    print(f"报告：{json_path} / {markdown_path}")
    return 0 if report["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
