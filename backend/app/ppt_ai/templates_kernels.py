"""十个新模板的确定性内核（后端）。

只消费已登记 provider 与规范化后的 canonical values；输出指标、检查、表格与曲线
均来自同一次求值。模型与模板包不能在这里执行任意代码。
"""

from __future__ import annotations

import math
from typing import Any, Mapping, Sequence

import sympy as sp

from ..labs.expr import ExprError, parse_expression, safe_float, to_latex
from .evaluation import EvaluationError

MAX_SERIES_POINTS = 241
MAX_MATRIX_SIZE = 32
MAX_LIST_SIZE = 64


def _metric(identifier: str, label: str, value: str, tone: str = "") -> dict[str, Any]:
    item: dict[str, Any] = {"id": identifier, "label": label, "value": value}
    if tone:
        item["tone"] = tone
    return item


def _check(identifier: str, label: str, status: str, detail: str) -> dict[str, Any]:
    return {"id": identifier, "label": label, "status": status, "detail": detail}


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _fmt(value: float | None, digits: int = 8) -> str:
    if value is None or not math.isfinite(value):
        return "—"
    return f"{value:.{digits}g}"


def _series(xs: Sequence[float], ys: Sequence[float | None]) -> list[dict[str, Any]]:
    return [
        {"x": round(float(x), 6), "y": None if y is None or not math.isfinite(float(y)) else round(float(y), 8)}
        for x, y in zip(xs, ys)
    ]


def _x_expression(expression: str, extra: Sequence[str] = ()) -> tuple[sp.Expr, sp.Symbol]:
    text = str(expression or "").strip()
    if not text:
        raise EvaluationError("表达式缺失")
    expression_obj = parse_expression(text, ("x", *extra))
    return expression_obj, sp.Symbol("x", real=True)


def _numeric_subs(expression: sp.Expr, symbol: sp.Symbol, value: float) -> float | None:
    try:
        result = expression.subs(symbol, value)
        number = complex(sp.N(result))
    except Exception:  # noqa: BLE001
        return None
    if abs(number.imag) > 1e-9 or not math.isfinite(number.real):
        return None
    return float(number.real)


def _curve_domain(x0: float, *, log_guard: bool = False) -> tuple[float, float]:
    low, high = x0 - 3.0, x0 + 3.0
    if log_guard:
        low = max(low, -0.99)
    if high <= low:
        high = low + 1.0
    return low, high


# ---------------------------------------------------------------------------
# 高数
# ---------------------------------------------------------------------------


def evaluate_taylor(provider: Mapping[str, Any], values: Mapping[str, Any]) -> dict[str, Any]:
    expression_text = str(values.get("expression") or provider.get("expression") or "")
    expression, x = _x_expression(expression_text)
    x0 = float(values.get("x0", 0.0))
    order = int(values.get("order", 5))
    x_eval = float(values.get("x_eval", 0.5))
    checks: list[dict[str, Any]] = []
    if not 0 <= order <= 8:
        return {
            "subject": "calculus",
            "kind": "taylor",
            "error": "阶数必须在 0—8 之间",
            "metrics": [],
            "checks": [_check("order_range", "阶数范围", "fail", "阶数必须在 0—8 之间。")],
            "trace": [],
            "series": [],
        }
    functions = expression.atoms(sp.Function)
    allowed = (sp.sin, sp.cos, sp.exp, sp.log)
    if any(function.func not in allowed for function in functions):
        checks.append(_check("supported_family", "支持函数族", "fail", "仅支持 sin/cos/exp/ln(1+x) 与低阶多项式。"))
    else:
        checks.append(_check("supported_family", "支持函数族", "pass", "函数族在模板允许范围内。"))
    if expression.has(sp.log):
        try:
            argument = next(iter(expression.atoms(sp.log))).args[0]
            value = _numeric_subs(argument, x, x0)
            if value is None or value <= 0:
                checks.append(_check("domain", "展开点定义域", "fail", "对数在展开点无定义。"))
        except Exception:  # noqa: BLE001
            checks.append(_check("domain", "展开点定义域", "fail", "无法验证对数定义域。"))
    try:
        series = sp.series(expression, x, x0, order + 1).removeO()
        polynomial = sp.expand(series)
    except Exception as exc:  # noqa: BLE001
        return {
            "subject": "calculus",
            "kind": "taylor",
            "error": f"无法展开：{exc}",
            "metrics": [],
            "checks": checks,
            "trace": [],
            "series": [],
        }
    low, high = _curve_domain(x0, log_guard=bool(expression.has(sp.log)))
    xs = [low + (high - low) * index / (MAX_SERIES_POINTS - 1) for index in range(MAX_SERIES_POINTS)]
    function_values = [_numeric_subs(expression, x, value) for value in xs]
    approx_values = [_numeric_subs(polynomial, x, value) for value in xs]
    function_at_eval = _numeric_subs(expression, x, x_eval)
    approx_at_eval = _numeric_subs(polynomial, x, x_eval)
    error = (
        abs(function_at_eval - approx_at_eval)
        if function_at_eval is not None and approx_at_eval is not None
        else None
    )
    shifted = sp.Poly(polynomial, x - x0)
    raw_coefficients = [sp.N(value) for value in reversed(shifted.all_coeffs())]
    coefficients = [_fmt(float(raw_coefficients[index]), 10) if index < len(raw_coefficients) else "0" for index in range(order + 1)]
    table_rows = [[str(index), coefficients[index]] for index in range(order + 1)]
    finite = function_at_eval is not None and approx_at_eval is not None
    checks.append(_check("finite", "当前点有有限值", "pass" if finite else "fail", "原函数与多项式分别求值。"))
    checks.append(
        _check(
            "approximation",
            "近似误差",
            "pass" if error is not None and error <= 10 ** -max(0, min(6, order)) * 100 else "warn",
            f"|f(x)-P(x)| = {_fmt(error)}。",
        )
    )
    return {
        "subject": "calculus",
        "kind": "taylor",
        "expression": expression_text,
        "latex": to_latex(expression),
        "polynomial_latex": to_latex(polynomial),
        "x0": x0,
        "order": order,
        "x_eval": x_eval,
        "value": function_at_eval,
        "approx": approx_at_eval,
        "error": error,
        "series": _series(xs, function_values),
        "overlay_series": _series(xs, approx_values),
        "overlay_label": f"{order} 阶泰勒多项式",
        "metrics": [
            _metric("function_value", "f(x)", _fmt(function_at_eval)),
            _metric("approx_value", "P(x)", _fmt(approx_at_eval)),
            _metric("abs_error", "绝对误差", _fmt(error)),
            _metric("order", "阶数", str(order)),
        ],
        "table": {"headers": ["k", "系数 a_k"], "rows": table_rows},
        "checks": checks,
        "trace": [],
        "notes": ["曲线与近似式来自同一表达式；系数由符号展开得到。"],
    }


def _double_integral_grid(
    expression: sp.Expr, x: sp.Symbol, y: sp.Symbol, ax: float, bx: float, ay: float, by: float, nx: int, ny: int
) -> tuple[float, list[list[Any]]]:
    dx = (bx - ax) / nx
    dy = (by - ay) / ny
    total = 0.0
    rows: list[list[Any]] = []
    for j in range(ny):
        y_mid = ay + (j + 0.5) * dy
        strip = 0.0
        for i in range(nx):
            x_mid = ax + (i + 0.5) * dx
            try:
                value = float(sp.N(expression.subs({x: x_mid, y: y_mid})))
            except Exception:  # noqa: BLE001
                value = float("nan")
            if math.isfinite(value):
                strip += value
        strip *= dx * dy
        total += strip
        rows.append([f"[{ay + j * dy:.3g}, {ay + (j + 1) * dy:.3g}]", round(strip, 8), round(total, 8)])
    return total, rows


def evaluate_double_integral(provider: Mapping[str, Any], values: Mapping[str, Any]) -> dict[str, Any]:
    expression_text = str(values.get("expression") or provider.get("expression") or "")
    if not expression_text:
        raise EvaluationError("被积函数缺失")
    expression = parse_expression(expression_text, ("x", "y"))
    x, y = sp.Symbol("x", real=True), sp.Symbol("y", real=True)
    ax, bx = float(values["ax"]), float(values["bx"])
    ay, by = float(values["ay"]), float(values["by"])
    nx, ny = int(values.get("nx", 20)), int(values.get("ny", 20))
    checks = [
        _check("rectangular_domain", "矩形区域", "pass" if ax < bx and ay < by else "fail", f"x∈[{ax},{bx}]，y∈[{ay},{by}]。"),
        _check("grid_limit", "网格规模", "pass" if 1 <= nx <= 64 and 1 <= ny <= 64 else "fail", f"{nx}×{ny}。"),
    ]
    if ax >= bx or ay >= by:
        return {"subject": "calculus", "kind": "double_integral", "error": "积分上下限无效", "metrics": [], "checks": checks, "trace": [], "table": None}
    nx, ny = max(1, min(64, nx)), max(1, min(64, ny))
    numeric, rows = _double_integral_grid(expression, x, y, ax, bx, ay, by, nx, ny)
    analytic = None
    try:
        analytic_expr = sp.integrate(expression, (y, ay, by), (x, ax, bx))
        analytic = safe_float(analytic_expr)
    except Exception:  # noqa: BLE001
        analytic = None
    error = abs(numeric - analytic) if analytic is not None else None
    checks.append(_check("finite", "网格求和有限", "pass" if math.isfinite(numeric) else "fail", f"数值积分 {_fmt(numeric)}。"))
    checks.append(
        _check(
            "analytic_available",
            "解析参考值",
            "pass" if analytic is not None else "warn",
            f"解析值 {_fmt(analytic)}。" if analytic is not None else "该函数未取得解析参考值，只显示数值近似。",
        )
    )
    return {
        "subject": "calculus",
        "kind": "double_integral",
        "expression": expression_text,
        "latex": to_latex(expression),
        "numeric": numeric,
        "analytic": analytic,
        "error": error,
        "nx": nx,
        "ny": ny,
        "table": {"headers": ["y 区间", "条带积分", "累计"], "rows": rows[:64]},
        "metrics": [
            _metric("numeric", "数值近似", _fmt(numeric)),
            _metric("analytic", "解析参考", _fmt(analytic)),
            _metric("error", "误差", _fmt(error)),
            _metric("grid", "网格", f"{nx}×{ny}"),
        ],
        "checks": checks,
        "trace": [],
        "notes": ["数值近似使用矩形中点累加；解析值另行计算，两者不混同。"],
    }


# ---------------------------------------------------------------------------
# 最优化
# ---------------------------------------------------------------------------


def evaluate_newton(provider: Mapping[str, Any], values: Mapping[str, Any]) -> dict[str, Any]:
    expression_text = str(values.get("expression") or provider.get("expression") or "")
    expression, x = _x_expression(expression_text)
    x_value = float(values.get("x0", 0.0))
    max_iter = int(values.get("max_iter", 8))
    first = sp.diff(expression, x)
    second = sp.diff(first, x)
    trace: list[dict[str, Any]] = []
    status = "iteration_limit"
    curvature_positive = True
    for iteration in range(1, max(1, min(50, max_iter)) + 1):
        f_value = _numeric_subs(expression, x, x_value)
        g_value = _numeric_subs(first, x, x_value)
        h_value = _numeric_subs(second, x, x_value)
        if f_value is None or g_value is None or h_value is None:
            status = "invalid_value"
            break
        trace.append(
            {
                "iteration": iteration,
                "x": round(x_value, 10),
                "f": round(f_value, 10),
                "gradient": round(g_value, 10),
                "curvature": round(h_value, 10),
            }
        )
        if h_value <= 1e-10:
            curvature_positive = False
            status = "non_positive_curvature" if h_value < 0 else "zero_curvature"
            break
        next_value = x_value - g_value / h_value
        if not math.isfinite(next_value):
            status = "invalid_value"
            break
        if abs(next_value - x_value) <= 1e-9:
            x_value = next_value
            status = "converged"
            break
        x_value = next_value
    final_f = _numeric_subs(expression, x, x_value)
    final_g = _numeric_subs(first, x, x_value)
    final_h = _numeric_subs(second, x, x_value)
    classification = (
        "local_minimum"
        if status == "converged" and final_h is not None and final_h > 0
        else "local_maximum"
        if final_h is not None and final_h < 0
        else "not_a_minimum"
        if status in ("non_positive_curvature", "zero_curvature")
        else "not_converged"
        if status != "converged"
        else "flat_curvature"
    )
    low, high = _curve_domain(float(values.get("x0", 0.0)))
    xs = [low + (high - low) * index / (MAX_SERIES_POINTS - 1) for index in range(MAX_SERIES_POINTS)]
    ys = [_numeric_subs(expression, x, value) for value in xs]
    checks = [
        _check(
            "curvature_positive",
            "二阶导为正",
            "pass" if final_h is not None and final_h > 0 else "warn",
            f"f''(x)={_fmt(final_h)}；曲率非正时停止，不把结果称为极小值。",
        ),
        _check(
            "converged",
            "收敛",
            "pass" if status == "converged" else "warn",
            f"停止原因：{status}。",
        ),
        _check("finite", "迭代值有限", "pass" if final_f is not None else "fail", f"f(x)={_fmt(final_f)}。"),
    ]
    return {
        "subject": "optimization",
        "kind": "newton_1d",
        "expression": expression_text,
        "latex": to_latex(expression),
        "x_final": x_value,
        "f_final": final_f,
        "gradient": final_g,
        "curvature": final_h,
        "classification": classification,
        "status": status,
        "series": _series(xs, ys),
        "points": [{"x": item["x"], "y": item["f"], "label": str(item["iteration"])} for item in trace],
        "table": {
            "headers": ["迭代", "x", "f(x)", "f'(x)", "f''(x)"],
            "rows": [
                [item["iteration"], item["x"], item["f"], item["gradient"], item["curvature"]]
                for item in trace
            ],
        },
        "metrics": [
            _metric("x_final", "x*", _fmt(x_value)),
            _metric("f_final", "f(x*)", _fmt(final_f)),
            _metric("iterations", "迭代次数", str(len(trace))),
            _metric("classification", "分类", classification),
        ],
        "checks": checks,
        "trace": trace,
        "notes": ["一维牛顿优化使用二阶导；曲率非正时不会继续迭代。"],
    }


def evaluate_least_squares(provider: Mapping[str, Any], values: Mapping[str, Any]) -> dict[str, Any]:
    raw_xs = values.get("xs")
    raw_ys = values.get("ys")
    xs = [float(item) for item in raw_xs] if isinstance(raw_xs, list) else []
    ys = [float(item) for item in raw_ys] if isinstance(raw_ys, list) else []
    checks = [
        _check("same_length", "数据长度一致", "pass" if len(xs) == len(ys) and len(xs) >= 2 else "fail", f"x={len(xs)}，y={len(ys)}。"),
    ]
    if len(xs) != len(ys) or len(xs) < 2:
        return {"subject": "optimization", "kind": "least_squares", "error": "x/y 数据长度不足或不一致", "metrics": [], "checks": checks, "trace": [], "table": None}
    count = len(xs)
    x_mean = sum(xs) / count
    y_mean = sum(ys) / count
    sxx = sum((value - x_mean) ** 2 for value in xs)
    sxy = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, ys))
    if sxx <= 1e-12:
        checks.append(_check("full_rank", "满秩", "fail", "所有 x 相同，直线不唯一。"))
        return {
            "subject": "optimization",
            "kind": "least_squares",
            "error": "x 数据没有变化，秩不足，不能声称唯一解",
            "metrics": [_metric("rank", "秩", "1")],
            "checks": checks,
            "trace": [],
            "table": {"headers": ["x", "y"], "rows": [[x, y] for x, y in zip(xs, ys)]},
            "points": [{"x": x, "y": y, "label": str(index + 1)} for index, (x, y) in enumerate(zip(xs, ys))],
        }
    slope = sxy / sxx
    intercept = y_mean - slope * x_mean
    residuals = [y - (slope * x + intercept) for x, y in zip(xs, ys)]
    sse = sum(value ** 2 for value in residuals)
    sst = sum((value - y_mean) ** 2 for value in ys)
    r_squared = 1 - sse / sst if sst > 1e-12 else None
    low, high = min(xs), max(xs)
    if high - low <= 0:
        high = low + 1
    line_x = [low + (high - low) * index / (MAX_SERIES_POINTS - 1) for index in range(MAX_SERIES_POINTS)]
    line_y = [slope * value + intercept for value in line_x]
    checks.append(_check("full_rank", "满秩", "pass", "x 数据存在变化，直线唯一。"))
    checks.append(_check("finite", "结果有限", "pass" if all(math.isfinite(item) for item in (slope, intercept, sse)) else "fail", "斜率/截距/残差均为有限值。"))
    return {
        "subject": "optimization",
        "kind": "least_squares",
        "slope": slope,
        "intercept": intercept,
        "r_squared": r_squared,
        "sse": sse,
        "series": _series(line_x, line_y),
        "overlay_label": "拟合直线",
        "points": [{"x": x, "y": y, "label": str(index + 1)} for index, (x, y) in enumerate(zip(xs, ys))],
        "table": {
            "headers": ["#", "x", "y", "拟合值", "残差"],
            "rows": [
                [index + 1, xs[index], ys[index], round(slope * xs[index] + intercept, 8), round(residuals[index], 8)]
                for index in range(count)
            ],
        },
        "metrics": [
            _metric("slope", "斜率", _fmt(slope)),
            _metric("intercept", "截距", _fmt(intercept)),
            _metric("r_squared", "R²", _fmt(r_squared)),
            _metric("sse", "残差平方和", _fmt(sse)),
        ],
        "checks": checks,
        "trace": [],
        "notes": ["秩不足时只报告不唯一，不伪造唯一解。"],
    }


# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------


def _parse_operation_tokens(operations: str) -> list[tuple[str, float | None]]:
    tokens: list[tuple[str, float | None]] = []
    for part in str(operations or "").replace("；", ";").split(";"):
        text = part.strip().lower()
        if not text:
            continue
        match = __import__("re").match(r"(push|pop|enqueue|dequeue)\s*(-?\d+(?:\.\d+)?)?", text)
        if not match:
            continue
        tokens.append((match.group(1), float(match.group(2)) if match.group(2) else None))
    return tokens


def evaluate_stack_queue(provider: Mapping[str, Any], values: Mapping[str, Any]) -> dict[str, Any]:
    mode = str(values.get("mode") or "stack")
    initial = values.get("initial")
    state = [float(item) for item in initial] if isinstance(initial, list) else []
    capacity = int(values.get("capacity", 8))
    operations = str(values.get("operations") or "")
    tokens = _parse_operation_tokens(operations)
    steps: list[list[Any]] = []
    errors: list[str] = []
    checks: list[dict[str, Any]] = []
    if not tokens:
        checks.append(_check("operation_valid", "操作序列", "fail", "没有读到明确的操作。"))
    for index, (operation, operand) in enumerate(tokens, start=1):
        note = ""
        if operation in ("push", "enqueue"):
            if operand is None:
                note = "缺少入栈/入队数值，已跳过"
                errors.append(note)
            elif len(state) >= capacity:
                note = "容量已满，操作被拒绝"
                errors.append(note)
            else:
                state.append(operand)
                note = f"加入 {operand:g}"
        elif operation == "pop":
            if not state:
                note = "空栈，pop 被拒绝"
                errors.append(note)
            else:
                note = f"弹出 {state.pop():g}"
        elif operation == "dequeue":
            if not state:
                note = "空队列，dequeue 被拒绝"
                errors.append(note)
            else:
                note = f"出队 {state.pop(0):g}"
        expected = "stack" if operation in ("push", "pop") else "queue"
        if expected != mode:
            note = (note + "；" if note else "") + f"操作 {operation} 与结构 {mode} 不匹配"
            errors.append(note)
        steps.append([index, operation, str([round(value, 8) for value in state]), note])
    checks.append(_check("operation_valid", "操作序列", "pass" if tokens else "fail", f"执行 {len(tokens)} 个操作。"))
    checks.append(_check("capacity", "容量", "warn" if any("容量" in item for item in errors) else "pass", f"容量上限 {capacity}。"))
    checks.append(_check("empty_state", "空结构", "warn" if any("空" in item for item in errors) else "pass", "空栈/空队列会明确报告。"))
    return {
        "subject": "data_structure",
        "kind": "stack_queue",
        "mode": mode,
        "final_state": state,
        "errors": errors,
        "metrics": [
            _metric("final_size", "最终长度", str(len(state))),
            _metric("errors", "问题", str(len(errors))),
            _metric("capacity", "容量", str(capacity)),
        ],
        "table": {"headers": ["步骤", "操作", "状态", "说明"], "rows": steps[:64]},
        "checks": checks,
        "trace": [{"label": f"{row[1]} → {row[2]}"} for row in steps],
        "notes": ["操作序列来自原文；空结构与容量问题不会被静默忽略。"],
    }


def _sort_steps(values: list[float], algorithm: str) -> tuple[list[list[Any]], int, int, list[float]]:
    data = list(values)
    steps: list[list[Any]] = []
    comparisons = 0
    swaps = 0
    if algorithm == "bubble":
        for round_index in range(len(data)):
            changed = False
            for index in range(len(data) - 1 - round_index):
                comparisons += 1
                if data[index] > data[index + 1]:
                    data[index], data[index + 1] = data[index + 1], data[index]
                    swaps += 1
                    changed = True
            steps.append([f"第 {round_index + 1} 轮", str([round(value, 8) for value in data]), comparisons, swaps])
            if not changed:
                break
    else:
        for index in range(1, len(data)):
            current = data[index]
            position = index - 1
            while position >= 0:
                comparisons += 1
                if data[position] > current:
                    data[position + 1] = data[position]
                    position -= 1
                    swaps += 1
                else:
                    break
            data[position + 1] = current
            steps.append([f"插入第 {index + 1} 个", str([round(value, 8) for value in data]), comparisons, swaps])
    return steps, comparisons, swaps, data


def evaluate_sorting(provider: Mapping[str, Any], values: Mapping[str, Any]) -> dict[str, Any]:
    raw = values.get("values")
    data = [float(item) for item in raw] if isinstance(raw, list) else []
    algorithm = str(values.get("algorithm") or "bubble")
    checks: list[dict[str, Any]] = []
    if len(data) > 32:
        checks.append(_check("length_limit", "长度上限", "fail", "最多 32 个元素。"))
        return {"subject": "data_structure", "kind": "sorting", "error": "元素超过 32 个", "metrics": [], "checks": checks, "trace": [], "table": None}
    checks.append(_check("length_limit", "长度上限", "pass", f"{len(data)} 个元素。"))
    checks.append(_check("algorithm_registered", "算法", "pass" if algorithm in ("bubble", "insertion") else "fail", algorithm))
    steps, comparisons, swaps, sorted_values = _sort_steps(data, algorithm)
    checks.append(_check("sorted", "升序结果", "pass" if sorted_values == sorted(data) else "fail", "按升序排列。"))
    return {
        "subject": "data_structure",
        "kind": "sorting",
        "algorithm": algorithm,
        "sorted": sorted_values,
        "comparisons": comparisons,
        "swaps": swaps,
        "metrics": [
            _metric("comparisons", "比较次数", str(comparisons)),
            _metric("swaps", "移动次数", str(swaps)),
            _metric("length", "元素数", str(len(data))),
        ],
        "table": {"headers": ["阶段", "列表", "累计比较", "累计移动"], "rows": steps[:64]},
        "checks": checks,
        "trace": [{"label": f"{row[0]}：{row[1]}"} for row in steps],
        "notes": ["比较次数口径为元素两两比较次数；插入排序以移动次数计。"],
    }


# ---------------------------------------------------------------------------
# 深度学习
# ---------------------------------------------------------------------------


def _activation_value(name: str, x: float) -> tuple[float | None, float | None, str]:
    if name == "sigmoid":
        if x >= 0:
            value = 1 / (1 + math.exp(-x))
        else:
            exponent = math.exp(x)
            value = exponent / (1 + exponent)
        return value, value * (1 - value), ""
    if name == "tanh":
        value = math.tanh(x)
        return value, 1 - value * value, ""
    if name == "relu":
        value = max(0.0, x)
        derivative = 1.0 if x > 0 else 0.0 if x < 0 else 0.0
        return value, derivative, "ReLU 在 x=0 处采用导数 0 的约定。" if x == 0 else ""
    return None, None, "未登记的激活函数"


def evaluate_activation(provider: Mapping[str, Any], values: Mapping[str, Any]) -> dict[str, Any]:
    name = str(values.get("activation") or "relu")
    x_value = float(values.get("x", 0.0))
    upstream = float(values.get("upstream", 1.0))
    value, derivative, note = _activation_value(name, x_value)
    checks = [
        _check("activation_registered", "激活函数", "pass" if value is not None else "fail", name),
    ]
    if name == "relu":
        checks.append(
            _check(
                "relu_zero_convention",
                "ReLU 零点约定",
                "pass" if x_value != 0 else "warn",
                note or "x=0 时导数取 0；这是本模板的固定约定。",
            )
        )
    if value is None:
        return {"subject": "deep_learning", "kind": "activation", "error": "未知激活函数", "metrics": [], "checks": checks, "trace": [], "series": []}
    gradient = None if derivative is None else upstream * derivative
    xs = [-5 + 10 * index / (MAX_SERIES_POINTS - 1) for index in range(MAX_SERIES_POINTS)]
    ys = [_activation_value(name, value)[0] for value in xs]
    checks.append(_check("finite", "有限值", "pass" if math.isfinite(value) else "fail", f"激活值 {_fmt(value)}。"))
    return {
        "subject": "deep_learning",
        "kind": "activation",
        "activation": name,
        "x": x_value,
        "value": value,
        "derivative": derivative,
        "gradient": gradient,
        "series": _series(xs, ys),
        "metrics": [
            _metric("activation_value", "激活值", _fmt(value)),
            _metric("derivative", "局部导数", _fmt(derivative)),
            _metric("gradient", "反向梯度", _fmt(gradient)),
        ],
        "checks": checks,
        "trace": [],
        "notes": [note] if note else ["激活值与梯度来自同一次求值。"],
    }


def _matrices(values: Mapping[str, Any], provider: Mapping[str, Any]) -> tuple[list[list[float]] | None, list[list[float]] | None, list[int] | None]:
    matrix = values.get("matrix")
    kernel = values.get("kernel")
    window = provider.get("window")
    normalized_matrix = [[float(item) for item in row] for row in matrix] if isinstance(matrix, list) and matrix and all(isinstance(row, list) for row in matrix) else None
    normalized_kernel = [[float(item) for item in row] for row in kernel] if isinstance(kernel, list) and kernel and all(isinstance(row, list) for row in kernel) else None
    normalized_window = [int(item) for item in window] if isinstance(window, list) and len(window) == 2 else None
    return normalized_matrix, normalized_kernel, normalized_window


def evaluate_conv_pool(provider: Mapping[str, Any], values: Mapping[str, Any]) -> dict[str, Any]:
    mode = str(values.get("mode") or "conv")
    stride = int(values.get("stride", 1))
    padding = int(values.get("padding", 0))
    matrix, kernel, window = _matrices(values, provider)
    checks: list[dict[str, Any]] = []
    if matrix is None:
        checks.append(_check("shape_match", "输入矩阵", "fail", "缺少可解析的输入矩阵。"))
        return {"subject": "deep_learning", "kind": "conv_pool", "error": "输入矩阵缺失", "metrics": [], "checks": checks, "trace": [], "table": None}
    height, width = len(matrix), len(matrix[0])
    if any(len(row) != width for row in matrix):
        checks.append(_check("shape_match", "输入矩阵", "fail", "输入矩阵各行长度不一致。"))
        return {"subject": "deep_learning", "kind": "conv_pool", "error": "输入矩阵形状不合法", "metrics": [], "checks": checks, "trace": [], "table": None}
    if kernel is None and window is not None:
        kernel = [[0.0] * window[1] for _ in range(window[0])]
    if mode == "conv" and kernel is None:
        checks.append(_check("shape_match", "卷积核", "fail", "卷积模式缺少卷积核。"))
        return {"subject": "deep_learning", "kind": "conv_pool", "error": "卷积核缺失", "metrics": [], "checks": checks, "trace": [], "table": None}
    if kernel is None:
        checks.append(_check("shape_match", "池化窗口", "fail", "池化模式缺少窗口形状。"))
        return {"subject": "deep_learning", "kind": "conv_pool", "error": "池化窗口缺失", "metrics": [], "checks": checks, "trace": [], "table": None}
    kernel_height, kernel_width = len(kernel), len(kernel[0])
    if any(len(row) != kernel_width for row in kernel):
        checks.append(_check("shape_match", "核/窗口", "fail", "核或窗口各行长度不一致。"))
        return {"subject": "deep_learning", "kind": "conv_pool", "error": "核/窗口形状不合法", "metrics": [], "checks": checks, "trace": [], "table": None}
    if stride < 1 or padding < 0:
        checks.append(_check("stride_positive", "步长/填充", "fail", "步长必须为正、填充不能为负。"))
        return {"subject": "deep_learning", "kind": "conv_pool", "error": "步长或填充非法", "metrics": [], "checks": checks, "trace": [], "table": None}
    padded = [[0.0] * (width + 2 * padding) for _ in range(height + 2 * padding)]
    for row in range(height):
        for column in range(width):
            padded[row + padding][column + padding] = matrix[row][column]
    out_height = (height + 2 * padding - kernel_height) // stride + 1
    out_width = (width + 2 * padding - kernel_width) // stride + 1
    if out_height <= 0 or out_width <= 0:
        checks.append(_check("shape_match", "输出形状", "fail", "核大于填充后的输入，无法产生输出。"))
        return {"subject": "deep_learning", "kind": "conv_pool", "error": "输出形状为空", "metrics": [], "checks": checks, "trace": [], "table": None}
    output: list[list[float]] = []
    operations = 0
    for row in range(out_height):
        output_row: list[float] = []
        for column in range(out_width):
            window_values = [
                padded[row * stride + i][column * stride + j]
                for i in range(kernel_height)
                for j in range(kernel_width)
            ]
            operations += len(window_values)
            if mode == "conv":
                value = sum(
                    padded[row * stride + i][column * stride + j] * kernel[i][j]
                    for i in range(kernel_height)
                    for j in range(kernel_width)
                )
            elif mode == "maxpool":
                value = max(window_values)
            else:
                value = sum(window_values) / len(window_values)
            output_row.append(round(float(value), 8))
        output.append(output_row)
    checks.append(_check("shape_match", "维度匹配", "pass", f"输出 {out_height}×{out_width}。"))
    checks.append(_check("stride_positive", "步长/填充", "pass", f"stride={stride}, padding={padding}。"))
    checks.append(
        _check(
            "convention",
            "卷积约定",
            "pass",
            "采用深度学习互相关约定（不翻转核）。" if mode == "conv" else "池化按窗口取最大/平均。",
        )
    )
    return {
        "subject": "deep_learning",
        "kind": "conv_pool",
        "mode": mode,
        "matrix": matrix,
        "kernel": kernel,
        "output": output,
        "output_shape": [out_height, out_width],
        "stride": stride,
        "padding": padding,
        "metrics": [
            _metric("output_shape", "输出形状", f"{out_height}×{out_width}"),
            _metric("operations", "乘加/比较次数", str(operations)),
            _metric("mode", "模式", mode),
        ],
        "table": {
            "headers": ["对象", "内容"],
            "rows": [
                ["输入", str(matrix)],
                ["核/窗口", str(kernel)],
                ["输出", str(output)],
            ],
        },
        "checks": checks,
        "trace": [],
        "notes": ["单通道小矩阵；填充值固定为 0。"],
    }


# ---------------------------------------------------------------------------
# 物理
# ---------------------------------------------------------------------------


def evaluate_projectile(provider: Mapping[str, Any], values: Mapping[str, Any]) -> dict[str, Any]:
    v0 = float(values.get("v0", 0.0))
    angle = math.radians(float(values.get("angle_deg", 0.0)))
    y0 = float(values.get("y0", 0.0))
    g = float(values.get("g", 9.8))
    t = float(values.get("t", 1.0))
    checks: list[dict[str, Any]] = [
        _check("speed_positive", "初速度", "pass" if v0 >= 0 else "fail", f"v0={v0:g} m/s。"),
        _check("gravity_positive", "重力", "pass" if g > 0 else "fail", f"g={g:g} m/s²。"),
    ]
    if v0 < 0 or g <= 0:
        return {"subject": "physics", "kind": "projectile", "error": "初速度/重力参数非法", "metrics": [], "checks": checks, "trace": [], "series": []}
    vx = v0 * math.cos(angle)
    vy = v0 * math.sin(angle)
    x = vx * t
    y = y0 + vy * t - 0.5 * g * t * t
    vy_now = vy - g * t
    speed = math.hypot(vx, vy_now)
    discriminant = vy * vy + 2 * g * y0
    flight = (vy + math.sqrt(discriminant)) / g if discriminant >= 0 else None
    apex_time = vy / g if vy > 0 else 0.0
    apex = y0 + vy * vy / (2 * g) if vy > 0 else y0
    range_value = vx * flight if flight is not None else None
    duration = max(t, flight or 0.0, 0.1)
    xs = [duration * index / (MAX_SERIES_POINTS - 1) for index in range(MAX_SERIES_POINTS)]
    points = [{"x": round(vx * time, 6), "y": round(y0 + vy * time - 0.5 * g * time * time, 8)} for time in xs]
    checks.append(_check("finite", "状态有限", "pass" if all(math.isfinite(v) for v in (x, y, speed)) else "fail", f"位置 ({x:.6g}, {y:.6g})。"))
    checks.append(_check("unit_normalized", "单位规范化", "pass" if values.get("v0") is not None else "warn", "初速度以 m/s 参与计算；原单位换算记录在条件来源。"))
    return {
        "subject": "physics",
        "kind": "projectile",
        "v0": v0,
        "angle_deg": math.degrees(angle),
        "g": g,
        "t": t,
        "position": [x, y],
        "velocity": [vx, vy_now],
        "speed": speed,
        "range": range_value,
        "apex": apex,
        "flight_time": flight,
        "series": points,
        "metrics": [
            _metric("x", "水平位置 x", f"{x:.8g} m"),
            _metric("y", "竖直位置 y", f"{y:.8g} m"),
            _metric("speed", "速度大小", f"{speed:.8g} m/s"),
            _metric("range", "射程", "—" if range_value is None else f"{range_value:.8g} m"),
            _metric("apex", "最高点", f"{apex:.8g} m"),
        ],
        "table": {
            "headers": ["量", "值"],
            "rows": [
                ["vx", f"{vx:.8g} m/s"],
                ["vy(t)", f"{vy_now:.8g} m/s"],
                ["飞行时间", "—" if flight is None else f"{flight:.8g} s"],
                ["最高点时间", f"{apex_time:.8g} s"],
            ],
        },
        "checks": checks,
        "trace": [],
        "notes": ["恒定重力、无空气阻力；初速度已按 m/s 计算。"],
    }


def evaluate_spring(provider: Mapping[str, Any], values: Mapping[str, Any]) -> dict[str, Any]:
    m = float(values.get("m", 0.0))
    k = float(values.get("k", 0.0))
    x0 = float(values.get("x0", 0.0))
    v0 = float(values.get("v0", 0.0))
    t = float(values.get("t", 1.0))
    checks: list[dict[str, Any]] = [
        _check("mass_positive", "质量为正", "pass" if m > 0 else "fail", f"m={m:g} kg。"),
        _check("stiffness_positive", "劲度系数为正", "pass" if k > 0 else "fail", f"k={k:g} N/m。"),
    ]
    if m <= 0 or k <= 0:
        return {"subject": "physics", "kind": "spring", "error": "质量或劲度系数必须为正", "metrics": [], "checks": checks, "trace": [], "series": []}
    omega = math.sqrt(k / m)
    phase = math.atan2(v0, omega * x0) if abs(x0) + abs(v0) > 1e-12 else 0.0
    amplitude = math.hypot(x0, v0 / omega)
    x = x0 * math.cos(omega * t) + (v0 / omega) * math.sin(omega * t)
    v = -x0 * omega * math.sin(omega * t) + v0 * math.cos(omega * t)
    acceleration = -omega * omega * x
    energy = 0.5 * k * x * x + 0.5 * m * v * v
    period = 2 * math.pi / omega if omega > 0 else None
    duration = max(t, (period or 0.0), 0.1)
    xs = [duration * index / (MAX_SERIES_POINTS - 1) for index in range(MAX_SERIES_POINTS)]
    ys = [x0 * math.cos(omega * time) + (v0 / omega) * math.sin(omega * time) for time in xs]
    energies = []
    for time in (0.0, t, duration):
        xx = x0 * math.cos(omega * time) + (v0 / omega) * math.sin(omega * time)
        vv = -x0 * omega * math.sin(omega * time) + v0 * math.cos(omega * time)
        energies.append(0.5 * k * xx * xx + 0.5 * m * vv * vv)
    conserved = max(energies) - min(energies) <= 1e-8 * max(1.0, max(energies))
    checks.append(_check("finite", "状态有限", "pass" if all(math.isfinite(v) for v in (x, v, energy)) else "fail", f"x={x:.6g} m。"))
    checks.append(_check("energy_conserved", "能量守恒", "pass" if conserved else "warn", f"E={energy:.8g} J。"))
    return {
        "subject": "physics",
        "kind": "spring",
        "m": m,
        "k": k,
        "omega": omega,
        "amplitude": amplitude,
        "phase": phase,
        "x": x,
        "v": v,
        "acceleration": acceleration,
        "energy": energy,
        "period": period,
        "series": _series(xs, ys),
        "metrics": [
            _metric("x", "位移 x", f"{x:.8g} m"),
            _metric("v", "速度 v", f"{v:.8g} m/s"),
            _metric("acceleration", "加速度 a", f"{acceleration:.8g} m/s²"),
            _metric("energy", "总能量", f"{energy:.8g} J"),
            _metric("period", "周期", "—" if period is None else f"{period:.8g} s"),
        ],
        "table": {
            "headers": ["量", "值"],
            "rows": [
                ["角频率 ω", f"{omega:.8g} rad/s"],
                ["振幅", f"{amplitude:.8g} m"],
                ["相位", f"{phase:.8g} rad"],
            ],
        },
        "checks": checks,
        "trace": [],
        "notes": ["一维无阻尼；能量由同一状态下的位移与速度计算。"],
    }


KERNELS = {
    "taylor": evaluate_taylor,
    "double_integral": evaluate_double_integral,
    "newton_1d": evaluate_newton,
    "least_squares": evaluate_least_squares,
    "stack_queue": evaluate_stack_queue,
    "sorting": evaluate_sorting,
    "activation": evaluate_activation,
    "conv_pool": evaluate_conv_pool,
    "projectile": evaluate_projectile,
    "spring": evaluate_spring,
}


def evaluate_template(kind: str, provider: Mapping[str, Any], values: Mapping[str, Any]) -> dict[str, Any]:
    kernel = KERNELS.get(kind)
    if kernel is None:
        raise EvaluationError(f"未登记的模板内核：{kind}")
    return kernel(provider, values)


__all__ = ["KERNELS", "evaluate_template"]
