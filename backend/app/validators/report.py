"""独立校验器与 ``ValidationReport`` 组装（R11，C-RUN@1，plan §2.2.2 / §2.3.3）。

**校验器不信任内核（这是本产品的技术主张，不是注释文案）**
===========================================================

本模块产出的每一条 ``CheckItem``：

- ``expected`` 来自 :mod:`app.validators.rules` 的**独立参考实现**；
- ``actual`` 来自传进来的**确定性内核结果**（调用方传入，本模块从不自己算一遍假装一致）；
- 两者不一致即 ``status="fail"``，并在 ``detail`` 里写明期望/实际与差值。

独立性由三个机制共同保证：

1. **不导入内核**：``app.validators`` 包内没有任何 ``app.engines`` 的导入。
   ``scripts/selftest.py`` 需要"内核算好的 actual"，因此用 ``importlib`` 动态加载内核
   （它不参与任何校验逻辑），静态代码里同样不出现 ``app.engines`` 的导入语句——
   交付验收的 ``grep`` 检查因此必须输出为空。
2. **不共享算法**：矩阵用显式标量公式、力用 ``hypot``/``atan2``、BFS 用独立 ``deque``
   循环、预算用独立 ``Decimal`` AST 求值器；详见 :mod:`app.validators.rules` 顶部
   的对照表与"为什么这样能发现内核错误"。
3. **结论可证伪**：报告同时给出 ``expected`` 与 ``actual`` 的人类可读文本，前端在
   ``fail`` 时必须展示失败项与具体输入，不得显示整体"通过"（R11-AC3）。

为什么不"复算一遍拿同样结果"
-----------------------------

如果校验器直接调用内核函数再比较，它只能证明"函数等于自己"——内核的错误会被
同一段代码原样复制。因此本模块只接收内核**已经算好的结果**：``build_report`` 的
``result`` 参数由调用方（T10 的 ``POST /objects/{id}/validate``、``scripts/selftest.py``）
传入，校验器对此毫无信任，逐项按契约原文重新推导期望值。

报告形状（逐字按 C-RUN@1）
--------------------------

``ValidationReport``::

    {report_id, object_id, model_version, revision, kernel_version,
     validation_profile, items, summary, is_stale, created_at}

``CheckItem``::

    {check_id, title, status, expected, actual, detail}

``summary`` 只有三个计数 ``{pass, fail, not_covered}``；``status="stale"`` 的条目
**不**计入 ``summary``，过期状态只由 ``is_stale`` 表达（contracts/README.md C-04）。
``is_stale`` 的语义是"对象当前的 ``model_version`` 或 ``revision`` 已领先于本报告所绑
定的值"（§2.2.7 契约级行为 4）：调用方传 ``current_model_version`` /
``current_revision`` 时按它们判定，否则退回对象自身的版本（即"校验的就是当前对象"）。

``CheckStatus`` 里的 ``stale`` 值在本实现中不用于逐项判定（否则会破坏 ``summary``
三计数的语义），而是由 ``is_stale`` 统一表达 —— 与 C-04 的裁决一致。

未覆盖项（R11-AC2）
-------------------

首版明确列出而**不静默忽略**的检查项：椭圆半轴长（SVD 数值算法无法构成独立证据）、
非方阵 / 3×3 及以上矩阵、力的运动/摩擦/碰撞、无向图与自定义邻居顺序、
预算字符串表达式形态与超过两个方案。它们以 ``status="not_covered"`` 出现。
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from . import rules

# ---------------------------------------------------------------------------
# 常量与单条检查项构造
# ---------------------------------------------------------------------------

PASS = "pass"
FAIL = "fail"
NOT_COVERED = "not_covered"

#: 契约容差（§2.3.6 规则 3），与 :mod:`rules` 使用同一份声明。
TOLERANCE = rules.TOLERANCE

#: 差值落在 ``(tol/10, tol]`` 时视为"贴近容差边界"：仍判通过，但在 ``detail`` 里提示。
#: 契约的 ``CheckStatus`` 没有 ``warn``（只有 pass/fail/not_covered/stale），
#: 因此边界提示只能走 ``detail``，不得伪造一个新状态（见交付报告契约缺口 C-T9-01）。
BOUNDARY_RATIO = 0.1

#: 每个 ``validation_profile`` 的检查项顺序与 ID（单一事实来源，测试会比对实现产出）。
CHECK_IDS: dict[str, tuple[str, ...]] = {
    "matrix_2d": (
        "mx_ax_value",
        "mx_columns",
        "mx_det_value",
        "mx_trace_value",
        "mx_rank_value",
        "mx_invertible",
        "mx_inverse_value",
        "mx_eigen_discriminant",
        "mx_steps_consistency",
        "mx_composition",
        "mx_ellipse",
        "mx_scope",
    ),
    "force_2d": (
        "fc_components",
        "fc_force_components",
        "fc_magnitude",
        "fc_magnitude_format",
        "fc_direction_value",
        "fc_direction_undefined",
        "fc_note",
        "fc_scope",
    ),
    "bfs_flow": (
        "bfs_order",
        "bfs_enqueue_once",
        "bfs_parent_edge",
        "bfs_level_value",
        "bfs_unvisited",
        "bfs_terminated",
        "bfs_rejected_edge",
        "bfs_trace_consistency",
        "bfs_scope",
    ),
    "budget_compare": (
        "bd_totals",
        "bd_scenario_breakdown",
        "bd_difference",
        "bd_equal",
        "bd_remaining",
        "bd_over_budget",
        "bd_no_limit",
        "bd_lines",
        "bd_scope",
    ),
}


def _fmt(value: object) -> str:
    """把任意值渲染成人类可读文本（报告只承载可读字符串，不承载结构化数据）。"""

    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, (list, tuple)):
        return "[" + ", ".join(_fmt(item) for item in value) + "]"
    if isinstance(value, Mapping):
        pairs = ", ".join(f"{key}: {_fmt(item)}" for key, item in value.items())
        return "{" + pairs + "}"
    return str(value)


def _item(
    check_id: str,
    title: str,
    expected: object,
    actual: object,
    *,
    ok: bool,
    detail: str | None = None,
) -> dict[str, Any]:
    """构造一条 ``CheckItem``（字段逐字按 C-RUN@1）。"""

    return {
        "check_id": check_id,
        "title": title,
        "status": PASS if ok else FAIL,
        "expected": _fmt(expected),
        "actual": _fmt(actual),
        "detail": detail,
    }


def _not_covered(check_id: str, title: str, reason: str) -> dict[str, Any]:
    """构造一条显式的未覆盖项（R11-AC2：不得静默忽略）。"""

    return {
        "check_id": check_id,
        "title": title,
        "status": NOT_COVERED,
        "expected": "不在首版独立校验范围",
        "actual": reason,
        "detail": reason,
    }


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float, Decimal)) and not isinstance(value, bool)


def _delta(expected: float, actual: object) -> float | None:
    """返回绝对差；``actual`` 不是数值时返回 ``None``（供调用方判 fail）。"""

    if not _is_number(actual):
        return None
    return abs(float(expected) - float(actual))


def _boundary_note(delta: float | None, tolerance: float) -> str | None:
    """差值为正且落在容差边界附近时给出提示文案（不改 status）。"""

    if delta is None or delta == 0.0:
        return None
    if tolerance * BOUNDARY_RATIO < delta <= tolerance:
        return f"数值贴近容差边界：Δ={delta!r}（容差 {tolerance!r}），仍判通过"
    return None


def _compare_numbers(
    check_id: str,
    title: str,
    expected: float,
    actual: object,
    tolerance: float = TOLERANCE,
) -> dict[str, Any]:
    delta = _delta(expected, actual)
    if delta is None:
        return _item(
            check_id,
            title,
            expected,
            actual,
            ok=False,
            detail=f"实际值不是数值（类型 {type(actual).__name__}）",
        )
    ok = delta <= tolerance
    if ok:
        return _item(check_id, title, expected, actual, ok=True, detail=_boundary_note(delta, tolerance))
    return _item(
        check_id,
        title,
        expected,
        actual,
        ok=False,
        detail=f"与独立复算相差 Δ={delta!r}，超出容差 {tolerance!r}",
    )


def _compare_numbers_sequence(
    check_id: str,
    title: str,
    expected: Sequence[float],
    actual: object,
    tolerance: float = TOLERANCE,
) -> dict[str, Any]:
    if not isinstance(actual, (list, tuple)) or len(actual) != len(expected):
        return _item(
            check_id,
            title,
            list(expected),
            actual,
            ok=False,
            detail=f"实际值必须是长度为 {len(expected)} 的数组",
        )
    worst = 0.0
    for index, expected_value in enumerate(expected):
        delta = _delta(expected_value, actual[index])
        if delta is None:
            return _item(
                check_id,
                title,
                list(expected),
                actual,
                ok=False,
                detail=f"[{index}] 不是数值（类型 {type(actual[index]).__name__}）",
            )
        worst = max(worst, delta)
    ok = worst <= tolerance
    detail = None if ok else f"最大分量差 Δ={worst!r}，超出容差 {tolerance!r}"
    if ok:
        detail = _boundary_note(worst, tolerance)
    return _item(check_id, title, list(expected), actual, ok=ok, detail=detail)


def _compare_numbers_matrix(
    check_id: str,
    title: str,
    expected: Sequence[Sequence[float]],
    actual: object,
    tolerance: float = TOLERANCE,
) -> dict[str, Any]:
    if not isinstance(actual, (list, tuple)) or len(actual) != len(expected):
        return _item(
            check_id,
            title,
            [list(row) for row in expected],
            actual,
            ok=False,
            detail=f"实际值必须是 {len(expected)} 行的二维数组",
        )
    worst = 0.0
    for row_index, expected_row in enumerate(expected):
        row = actual[row_index]
        if not isinstance(row, (list, tuple)) or len(row) != len(expected_row):
            return _item(
                check_id,
                title,
                [list(item) for item in expected],
                actual,
                ok=False,
                detail=f"第 {row_index} 行必须是长度为 {len(expected_row)} 的数组",
            )
        for column_index, expected_value in enumerate(expected_row):
            delta = _delta(expected_value, row[column_index])
            if delta is None:
                return _item(
                    check_id,
                    title,
                    [list(item) for item in expected],
                    actual,
                    ok=False,
                    detail=(
                        f"[{row_index}][{column_index}] 不是数值"
                        f"（类型 {type(row[column_index]).__name__}）"
                    ),
                )
            worst = max(worst, delta)
    ok = worst <= tolerance
    detail = None if ok else f"最大元素差 Δ={worst!r}，超出容差 {tolerance!r}"
    if ok:
        detail = _boundary_note(worst, tolerance)
    return _item(check_id, title, [list(item) for item in expected], actual, ok=ok, detail=detail)


def _compare_exact(
    check_id: str,
    title: str,
    expected: object,
    actual: object,
    *,
    reason: str | None = None,
) -> dict[str, Any]:
    """严格相等比较；``True`` 与 ``1`` 视为不同类型（布尔值单独处理）。"""

    same_type = isinstance(expected, bool) == isinstance(actual, bool)
    ok = same_type and expected == actual
    detail = None if ok else (reason or "与独立复算不一致")
    return _item(check_id, title, expected, actual, ok=ok, detail=detail)


def _compare_strings(
    check_id: str,
    title: str,
    expected: object,
    actual: object,
    *,
    reason: str | None = None,
) -> dict[str, Any]:
    ok = isinstance(actual, str) and actual == expected
    detail = None if ok else (reason or "与独立复算的文案/格式不一致")
    return _item(check_id, title, expected, actual, ok=ok, detail=detail)


def _compare_string_sequence(
    check_id: str,
    title: str,
    expected: Sequence[str],
    actual: object,
) -> dict[str, Any]:
    if not isinstance(actual, (list, tuple)):
        return _item(
            check_id, title, list(expected), actual, ok=False, detail="实际值必须是数组"
        )
    ok = list(actual) == list(expected)
    detail = None if ok else "序列内容或顺序与独立实现不一致"
    return _item(check_id, title, list(expected), actual, ok=ok, detail=detail)


# ---------------------------------------------------------------------------
# matrix_2d 检查项
# ---------------------------------------------------------------------------


def _matrix_steps_item(
    reference: rules.MatrixReference, actual_steps: object
) -> dict[str, Any]:
    """验算内核 ``steps`` 的数学自洽性（R6-AC9），而不是与独立步骤逐字比较。

    逐字比较会退化为"抄写对比"；这里改为验算每一步的数学含义：
    第 1 步的系数必须等于输入向量分量、列必须等于 A 的列；第 2 步的 partial 必须是
    第一项的部分和（C-11），result 必须是两列组合且等于 ``Ax``。
    """

    expected_text = (
        f"terms 系数={_fmt([term['coefficient'] for term in reference.steps[0]['terms']])}"
        f"、列={_fmt(reference.columns)}、partial={_fmt(reference.steps[1]['partial'])}"
        f"、result={_fmt(reference.ax)}"
    )

    if not isinstance(actual_steps, (list, tuple)) or len(actual_steps) != 2:
        return _item(
            "mx_steps_consistency",
            "两步步骤自洽",
            expected_text,
            actual_steps,
            ok=False,
            detail="steps 必须是长度为 2 的数组（step=1 取倍数、step=2 组合各列）",
        )

    problems: list[str] = []
    first, second = actual_steps[0], actual_steps[1]
    for index, step in enumerate((first, second)):
        if not isinstance(step, Mapping):
            problems.append(f"steps[{index}] 不是对象")
            continue
        if step.get("step") != index + 1:
            problems.append(f"steps[{index}].step 应为 {index + 1}，实际 {_fmt(step.get('step'))}")
        if not isinstance(step.get("title"), str) or not step.get("title"):
            problems.append(f"steps[{index}].title 必须是非空字符串")

    reference_terms = reference.steps[0]["terms"]
    terms = first.get("terms") if isinstance(first, Mapping) else None
    if not isinstance(terms, (list, tuple)) or len(terms) != 2:
        problems.append("steps[0].terms 必须是长度为 2 的数组")
    else:
        for index, term in enumerate(terms):
            if not isinstance(term, Mapping):
                problems.append(f"steps[0].terms[{index}] 不是对象")
                continue
            expected_term = reference_terms[index]
            coefficient_delta = _delta(expected_term["coefficient"], term.get("coefficient"))
            if coefficient_delta is None or coefficient_delta > TOLERANCE:
                problems.append(
                    f"terms[{index}].coefficient 应为 {_fmt(expected_term['coefficient'])}，"
                    f"实际 {_fmt(term.get('coefficient'))}"
                )
            if term.get("column_index") != expected_term["column_index"]:
                problems.append(
                    f"terms[{index}].column_index 应为 {expected_term['column_index']}，"
                    f"实际 {_fmt(term.get('column_index'))}"
                )
            column = term.get("column")
            if (
                not isinstance(column, (list, tuple))
                or len(column) != 2
                or any(_delta(expected_term["column"][i], column[i]) is None for i in (0, 1))
                or any(
                    _delta(expected_term["column"][i], column[i]) > TOLERANCE for i in (0, 1)
                )
            ):
                problems.append(
                    f"terms[{index}].column 应为 {_fmt(expected_term['column'])}，"
                    f"实际 {_fmt(column)}"
                )

    if isinstance(second, Mapping):
        partial = second.get("partial")
        if (
            not isinstance(partial, (list, tuple))
            or len(partial) != 2
            or any(_delta(reference.steps[1]["partial"][i], partial[i]) is None for i in (0, 1))
            or any(_delta(reference.steps[1]["partial"][i], partial[i]) > TOLERANCE for i in (0, 1))
        ):
            problems.append(
                f"steps[1].partial 应为 {_fmt(reference.steps[1]['partial'])}（第一项部分和），"
                f"实际 {_fmt(partial)}"
            )
        result = second.get("result")
        if (
            not isinstance(result, (list, tuple))
            or len(result) != 2
            or any(_delta(reference.ax[i], result[i]) is None for i in (0, 1))
            or any(_delta(reference.ax[i], result[i]) > TOLERANCE for i in (0, 1))
        ):
            problems.append(f"steps[1].result 应等于 Ax={_fmt(reference.ax)}，实际 {_fmt(result)}")

    ok = not problems
    return _item(
        "mx_steps_consistency",
        "两步步骤自洽",
        expected_text,
        actual_steps,
        ok=ok,
        detail=None if ok else "；".join(problems),
    )


def _eigen_item(reference: rules.MatrixReference, actual: object) -> dict[str, Any]:
    """特征值判别式一致：``real`` 标志 + 实特征值 / 固定原因文案。"""

    expected = reference.eigenvalues
    if not isinstance(actual, Mapping):
        return _item(
            "mx_eigen_discriminant",
            "特征值判别式",
            expected,
            actual,
            ok=False,
            detail="eigenvalues 必须是对象（{real, values} 或 {real, reason}）",
        )
    if bool(actual.get("real")) != bool(expected["real"]):
        return _item(
            "mx_eigen_discriminant",
            "特征值判别式",
            expected,
            actual,
            ok=False,
            detail=(
                "判别式符号判定不一致："
                f"独立判定 real={_fmt(expected['real'])}（disc=trace²−4·det）"
            ),
        )
    if expected["real"]:
        values = actual.get("values")
        if (
            not isinstance(values, (list, tuple))
            or len(values) != 2
            or any(_delta(expected["values"][i], values[i]) is None for i in (0, 1))
            or any(_delta(expected["values"][i], values[i]) > TOLERANCE for i in (0, 1))
        ):
            return _item(
                "mx_eigen_discriminant",
                "特征值判别式",
                expected["values"],
                values,
                ok=False,
                detail="实特征值与判别式求根结果不一致",
            )
        return _item("mx_eigen_discriminant", "特征值判别式", expected["values"], values, ok=True)
    return _compare_strings(
        "mx_eigen_discriminant",
        "特征值判别式",
        rules.NO_REAL_EIGEN_REASON,
        actual.get("reason"),
        reason="无实特征值时必须返回 §2.2.3 规则 4 的固定原因文案，不得返回 NaN",
    )


def _matrix_items(parameters: Mapping[str, Any], result: Mapping[str, Any]) -> list[dict[str, Any]]:
    compose_order = parameters.get("compose_order", "A_then_B")
    reference = rules.matrix_reference(
        parameters.get("matrix"),
        parameters.get("vector"),
        parameters.get("second_matrix"),
        compose_order if isinstance(compose_order, str) else "A_then_B",
    )
    items: list[dict[str, Any]] = []

    items.append(
        _compare_numbers_sequence("mx_ax_value", "Ax 数值", reference.ax, result.get("ax"))
    )
    items.append(
        _compare_numbers_matrix(
            "mx_columns", "两列去向", reference.columns, result.get("columns")
        )
    )
    items.append(
        _compare_numbers("mx_det_value", "行列式 det", reference.det, result.get("det"), 1e-12)
    )
    items.append(_compare_numbers("mx_trace_value", "迹 trace", reference.trace, result.get("trace")))
    items.append(_compare_exact("mx_rank_value", "秩 rank", reference.rank, result.get("rank")))
    items.append(
        _compare_exact(
            "mx_invertible",
            "可逆性（与 det≠0 一致）",
            reference.invertible,
            result.get("invertible"),
            reason="invertible 必须与 |det| > 1e-12 一致（R6-AC10）",
        )
    )

    if reference.invertible:
        items.append(
            _compare_numbers_matrix(
                "mx_inverse_value", "逆矩阵", reference.inverse or [], result.get("inverse")
            )
        )
    else:
        # 奇异矩阵：必须拒绝求逆，不得伪造逆矩阵（R6-AC10）。
        inverse_actual = result.get("inverse")
        items.append(
            _item(
                "mx_inverse_value",
                "奇异时逆矩阵必须为 null",
                "null（矩阵奇异，拒绝求逆）",
                inverse_actual,
                ok=inverse_actual is None,
                detail=None if inverse_actual is None else "内核为奇异矩阵返回了逆矩阵（伪造）",
            )
        )
    items.append(_eigen_item(reference, result.get("eigenvalues")))
    items.append(_matrix_steps_item(reference, result.get("steps")))

    if reference.composition is None:
        items.append(
            _not_covered(
                "mx_composition",
                "复合顺序对比",
                "输入未提供 second_matrix（operation=matrix_apply），复合顺序检查不适用",
            )
        )
    else:
        composition = result.get("composition")
        if not isinstance(composition, Mapping):
            items.append(
                _item(
                    "mx_composition",
                    "复合顺序对比",
                    reference.composition,
                    composition,
                    ok=False,
                    detail="提供 second_matrix 时 composition 必须非 null",
                )
            )
        else:
            problems: list[dict[str, Any]] = [
                _compare_numbers_matrix(
                    "mx_composition.ab", "AB 矩阵", reference.composition["ab"], composition.get("ab")
                ),
                _compare_numbers_matrix(
                    "mx_composition.ba", "BA 矩阵", reference.composition["ba"], composition.get("ba")
                ),
                _compare_numbers_sequence(
                    "mx_composition.abx", "ABx 向量", reference.composition["abx"], composition.get("abx")
                ),
                _compare_numbers_sequence(
                    "mx_composition.bax", "BAx 向量", reference.composition["bax"], composition.get("bax")
                ),
                _compare_exact(
                    "mx_composition.commutes",
                    "是否可交换",
                    reference.composition["commutes"],
                    composition.get("commutes"),
                    reason="commutes 必须由 |ABx − BAx| ≤ 1e-9 判定（R6-AC3）",
                ),
                _compare_strings(
                    "mx_composition.order",
                    "复合顺序标记",
                    reference.composition["order"],
                    composition.get("order"),
                ),
            ]
            failures = [problem for problem in problems if problem["status"] == FAIL]
            items.append(
                _item(
                    "mx_composition",
                    "复合顺序对比",
                    reference.composition,
                    composition,
                    ok=not failures,
                    detail=None
                    if not failures
                    else "；".join(
                        f"{problem['check_id']}: 期望 {problem['expected']} 实际 {problem['actual']}"
                        for problem in failures
                    ),
                )
            )

    items.append(
        _not_covered(
            "mx_ellipse",
            "单位圆像（半轴长）",
            "椭圆半轴长依赖 SVD 数值算法，与内核解法难以构成独立证据，首版不复核",
        )
    )
    items.append(
        _not_covered(
            "mx_scope",
            "矩阵范围",
            "非方阵、3×3 及以上矩阵不在首版范围（C-MX@1 只定义 2×2）",
        )
    )
    return items


# ---------------------------------------------------------------------------
# force_2d 检查项
# ---------------------------------------------------------------------------


def _force_items(parameters: Mapping[str, Any], result: Mapping[str, Any]) -> list[dict[str, Any]]:
    display_precision = parameters.get("display_precision", 2)
    compute_precision = parameters.get("compute_precision", 6)
    reference = rules.force_reference(
        parameters.get("forces"),
        int(display_precision) if isinstance(display_precision, int) else 2,
        int(compute_precision) if isinstance(compute_precision, int) else 6,
    )
    items: list[dict[str, Any]] = []

    items.append(
        _compare_numbers_sequence(
            "fc_components", "合力分量 fx/fy", [reference.fx, reference.fy], [result.get("fx"), result.get("fy")]
        )
    )

    # 单个力的分量：内核必须按 m·(cosθ, sinθ) 逐个给出。
    actual_forces = result.get("forces")
    component_problems: list[str] = []
    if not isinstance(actual_forces, (list, tuple)) or len(actual_forces) != len(reference.components):
        component_problems.append(
            f"forces 必须是长度为 {len(reference.components)} 的数组"
        )
    else:
        for index, expected_component in enumerate(reference.components):
            actual_component = actual_forces[index]
            if not isinstance(actual_component, Mapping):
                component_problems.append(f"forces[{index}] 不是对象")
                continue
            for key in ("fx", "fy"):
                delta = _delta(expected_component[key], actual_component.get(key))
                if delta is None or delta > TOLERANCE:
                    component_problems.append(
                        f"forces[{index}].{key} 应为 {_fmt(expected_component[key])}，"
                        f"实际 {_fmt(actual_component.get(key))}"
                    )
    items.append(
        _item(
            "fc_force_components",
            "各力分量",
            reference.components,
            actual_forces,
            ok=not component_problems,
            detail=None if not component_problems else "；".join(component_problems),
        )
    )

    items.append(
        _compare_numbers(
            "fc_magnitude", "合力大小", reference.magnitude, result.get("magnitude")
        )
    )

    format_problems: list[str] = []
    if result.get("magnitude_rounded") != reference.magnitude_rounded:
        format_problems.append(
            f"magnitude_rounded 应为 {reference.magnitude_rounded!r}"
            f"（display_precision={display_precision}），"
            f"实际 {_fmt(result.get('magnitude_rounded'))!r}"
        )
    if result.get("magnitude_exact") != reference.magnitude_exact:
        format_problems.append(
            f"magnitude_exact 应为 {reference.magnitude_exact!r}，实际 {_fmt(result.get('magnitude_exact'))!r}"
        )
    items.append(
        _item(
            "fc_magnitude_format",
            "舍入值与计算精度分开返回",
            {
                "magnitude_rounded": reference.magnitude_rounded,
                "magnitude_exact": reference.magnitude_exact,
            },
            {
                "magnitude_rounded": result.get("magnitude_rounded"),
                "magnitude_exact": result.get("magnitude_exact"),
            },
            ok=not format_problems,
            detail=None if not format_problems else "；".join(format_problems),
        )
    )

    if reference.direction_deg is None:
        items.append(
            _item(
                "fc_direction_value",
                "方向角",
                "未定义（合力为零）",
                result.get("direction_deg"),
                ok=result.get("direction_deg") is None,
                detail=None
                if result.get("direction_deg") is None
                else "合力为零时不得输出角度值（禁止 0° 或 NaN，R7-AC3）",
            )
        )
    else:
        direction = result.get("direction_deg")
        delta = _delta(reference.direction_deg, direction)
        in_range = _is_number(direction) and 0.0 <= float(direction) < 360.0
        if delta is None or delta > TOLERANCE:
            items.append(
                _item(
                    "fc_direction_value",
                    "方向角",
                    reference.direction_deg,
                    direction,
                    ok=False,
                    detail=f"方向角与独立 atan2 结果相差 {_fmt(delta)}，超出容差 {TOLERANCE!r}",
                )
            )
        elif not in_range:
            items.append(
                _item(
                    "fc_direction_value",
                    "方向角",
                    reference.direction_deg,
                    direction,
                    ok=False,
                    detail="方向角必须落在 [0, 360) 区间（§2.2.4 规则 3）",
                )
            )
        else:
            items.append(
                _item(
                    "fc_direction_value",
                    "方向角",
                    reference.direction_deg,
                    direction,
                    ok=True,
                    detail=_boundary_note(delta, TOLERANCE),
                )
            )

    # 抵消时必须 direction_defined=false 且 direction_deg=null；非抵消时为 true。
    defined_ok = result.get("direction_defined") is reference.direction_defined
    null_ok = (result.get("direction_deg") is None) == (not reference.direction_defined)
    items.append(
        _item(
            "fc_direction_undefined",
            "抵消时方向未定义",
            {
                "direction_defined": reference.direction_defined,
                "direction_deg": reference.direction_deg,
            },
            {
                "direction_defined": result.get("direction_defined"),
                "direction_deg": result.get("direction_deg"),
            },
            ok=defined_ok and null_ok,
            detail=None
            if defined_ok and null_ok
            else "cancel 与 direction_defined/direction_deg 的对应关系不符合 §2.2.4 规则 2",
        )
    )

    if reference.cancel:
        # §2.2.4 规则 2 固定了抵消时的文案；非抵消时的措辞不属于契约，只要求非空。
        items.append(
            _compare_strings(
                "fc_note",
                "结果说明文案",
                rules.CANCEL_NOTE,
                result.get("note"),
                reason="cancel=true 时必须使用固定文案「合力为零，方向未定义」",
            )
        )
    else:
        note = result.get("note")
        items.append(
            _item(
                "fc_note",
                "结果说明文案",
                "非空说明文案（非抵消时措辞不在契约内）",
                note,
                ok=isinstance(note, str) and bool(note.strip()),
                detail=None if isinstance(note, str) and note.strip() else "note 必须是非空字符串",
            )
        )
    items.append(
        _not_covered(
            "fc_scope",
            "力学范围",
            "运动、摩擦与碰撞不在首版范围（R7-AC6 只做共点力合成）",
        )
    )
    return items


# ---------------------------------------------------------------------------
# bfs_flow 检查项
# ---------------------------------------------------------------------------


def _bfs_parent_item(reference: rules.BfsReference, actual: Mapping[str, Any]) -> dict[str, Any]:
    """``parent`` 必须指向真实边，且起点为 ``null``。"""

    parent = actual.get("parent")
    start = reference.enqueue_order[0]
    expected_text = f"parent={reference.parent}（起点 {start} 为 null）"
    if not isinstance(parent, Mapping):
        return _item(
            "bfs_parent_edge",
            "parent 指向真实边",
            expected_text,
            parent,
            ok=False,
            detail="parent 必须是对象",
        )
    problems: list[str] = []
    if parent.get(start) is not None:
        problems.append(f"起点 {start} 的 parent 必须为 null，实际 {_fmt(parent.get(start))}")
    for node, parent_node in parent.items():
        if node == start:
            continue
        if not isinstance(parent_node, str):
            problems.append(f"节点 {node} 的 parent 为 {_fmt(parent_node)}，必须是非空节点 id")
            continue
        if reference.parent.get(node) != parent_node:
            problems.append(
                f"节点 {node} 的 parent 应为 {_fmt(reference.parent.get(node))}（BFS 首次发现它的边），"
                f"实际 {_fmt(parent_node)}"
            )
    missing = [node for node in reference.parent if node not in parent]
    if missing:
        problems.append(f"parent 缺少已访问节点 {_fmt(missing)}")
    extra = [node for node in parent if node not in reference.parent]
    if extra:
        problems.append(f"parent 含未被访问的节点 {_fmt(extra)}（伪造层级）")
    return _item(
        "bfs_parent_edge",
        "parent 指向真实边",
        expected_text,
        parent,
        ok=not problems,
        detail=None if not problems else "；".join(problems),
    )


def _bfs_trace_item(reference: rules.BfsReference, actual: Mapping[str, Any]) -> dict[str, Any]:
    """逐事件比对轨迹：``(kind, node, from, reason)`` 序列必须完全一致。"""

    trace = actual.get("trace")
    expected_events = [
        (event["kind"], event["node"], event.get("from"), event.get("reason"))
        for event in reference.trace
    ]
    if not isinstance(trace, (list, tuple)):
        return _item(
            "bfs_trace_consistency",
            "轨迹逐事件一致",
            expected_events,
            trace,
            ok=False,
            detail="trace 必须是数组",
        )
    actual_events = []
    problems: list[str] = []
    for index, event in enumerate(trace):
        if not isinstance(event, Mapping):
            problems.append(f"trace[{index}] 不是对象")
            continue
        if event.get("index") != index:
            problems.append(f"trace[{index}].index 应为 {index}，实际 {_fmt(event.get('index'))}")
        actual_events.append(
            (event.get("kind"), event.get("node"), event.get("from"), event.get("reason"))
        )
    if len(actual_events) != len(expected_events):
        problems.append(
            f"事件数不一致：独立实现 {len(expected_events)} 条，内核 {len(actual_events)} 条"
        )
    for index, (expected_event, actual_event) in enumerate(zip(expected_events, actual_events)):
        if expected_event != actual_event:
            problems.append(
                f"第 {index} 个事件应为 {_fmt(expected_event)}，实际 {_fmt(actual_event)}"
            )
            if len(problems) >= 5:
                problems.append("（仅显示前 5 处差异）")
                break
    return _item(
        "bfs_trace_consistency",
        "轨迹逐事件一致",
        f"{len(expected_events)} 条事件 {_fmt(expected_events[:6])}"
        + ("…" if len(expected_events) > 6 else ""),
        f"{len(actual_events)} 条事件",
        ok=not problems,
        detail=None if not problems else "；".join(problems),
    )


def _bfs_items(parameters: Mapping[str, Any], result: Mapping[str, Any]) -> list[dict[str, Any]]:
    reference = rules.bfs_reference(
        parameters.get("nodes"),
        parameters.get("edges"),
        parameters.get("start_node_id") or "",
        bool(parameters.get("directed", True)),
        int(parameters.get("max_steps", 200))
        if isinstance(parameters.get("max_steps"), int)
        else 200,
    )
    items: list[dict[str, Any]] = []

    items.append(
        _compare_string_sequence("bfs_order", "访问序列", reference.order, result.get("order"))
    )

    # 每个节点最多入队一次（R8-AC2：D 只入队一次）。
    enqueue_order = result.get("enqueue_order")
    if not isinstance(enqueue_order, (list, tuple)):
        items.append(
            _item(
                "bfs_enqueue_once",
                "每个节点最多入队一次",
                reference.enqueue_order,
                enqueue_order,
                ok=False,
                detail="enqueue_order 必须是数组",
            )
        )
    else:
        duplicates = sorted(
            {node for node in enqueue_order if list(enqueue_order).count(node) > 1}
        )
        order_ok = list(enqueue_order) == list(reference.enqueue_order)
        ok = not duplicates and order_ok
        detail = None
        if duplicates:
            detail = f"节点被重复入队：{_fmt(duplicates)}（R8-AC2 要求每节点最多入队一次）"
        elif not order_ok:
            detail = f"入队序列应为 {_fmt(reference.enqueue_order)}"
        items.append(
            _item(
                "bfs_enqueue_once",
                "每个节点最多入队一次",
                reference.enqueue_order,
                enqueue_order,
                ok=ok,
                detail=detail,
            )
        )

    items.append(_bfs_parent_item(reference, result))

    level = result.get("level")
    if not isinstance(level, Mapping):
        items.append(
            _item(
                "bfs_level_value",
                "层级（BFS 距离）",
                reference.level,
                level,
                ok=False,
                detail="level 必须是对象",
            )
        )
    else:
        level_problems = [
            f"节点 {node} 的 level 应为 {_fmt(expected)}，实际 {_fmt(level.get(node))}"
            for node, expected in reference.level.items()
            if level.get(node) != expected
        ]
        items.append(
            _item(
                "bfs_level_value",
                "层级（BFS 距离）",
                reference.level,
                level,
                ok=not level_problems,
                detail=None if not level_problems else "；".join(level_problems),
            )
        )

    items.append(
        _compare_string_sequence(
            "bfs_unvisited", "不可达节点", reference.unvisited, result.get("unvisited")
        )
    )

    # 有环图必须正常终止（R8-AC3）；终止原因与"访问集合等于可达集合"必须一致。
    visited = result.get("visited")
    visited_set = set(visited) if isinstance(visited, (list, tuple)) else set()
    reachable = set(reference.order)
    terminated = result.get("terminated_reason")
    terminated_ok = terminated == reference.terminated_reason
    covered_ok = visited_set == set(reference.order)
    items.append(
        _item(
            "bfs_terminated",
            "终止原因与访问集合",
            {
                "terminated_reason": reference.terminated_reason,
                "visited": reference.order,
            },
            {"terminated_reason": terminated, "visited": visited},
            ok=terminated_ok and covered_ok,
            detail=None
            if terminated_ok and covered_ok
            else (
                "有环图未能正常终止或访问集合与独立 BFS 不一致"
                f"（可达集合 {_fmt(sorted(reachable))}）"
            ),
        )
    )

    # 重复入队尝试必须以 skip 事件 + rejected_edges 双记录（R8-AC2）。
    rejected = result.get("rejected_edges")
    expected_rejected = [
        {"from": edge["from"], "to": edge["to"], "reason": edge["reason"]}
        for edge in reference.rejected_edges
    ]
    if not isinstance(rejected, (list, tuple)):
        items.append(
            _item(
                "bfs_rejected_edge",
                "重复入队被记录",
                expected_rejected,
                rejected,
                ok=False,
                detail="rejected_edges 必须是数组",
            )
        )
    else:
        actual_pairs = {
            (edge.get("from"), edge.get("to"), edge.get("reason"))
            for edge in rejected
            if isinstance(edge, Mapping)
        }
        missing = [
            edge
            for edge in expected_rejected
            if (edge["from"], edge["to"], edge["reason"]) not in actual_pairs
        ]
        items.append(
            _item(
                "bfs_rejected_edge",
                "重复入队被记录",
                expected_rejected,
                rejected,
                ok=not missing,
                detail=None
                if not missing
                else f"缺少被拒绝的边记录：{_fmt(missing)}（reason 必须写明原因，如「D 已在队列中」）",
            )
        )

    items.append(_bfs_trace_item(reference, result))
    items.append(
        _not_covered(
            "bfs_scope",
            "图范围",
            "无向图与自定义邻居顺序不在首版范围（neighbor_order 只允许 lexicographic_by_id）",
        )
    )
    return items


# ---------------------------------------------------------------------------
# budget_compare 检查项
# ---------------------------------------------------------------------------


def _amount_item(
    check_id: str,
    title: str,
    expected: str | None,
    actual: object,
    *,
    detail_when_not_null: str | None = None,
) -> dict[str, Any]:
    """金额比较：值用 ``Decimal`` 精确比较，格式必须等于契约格式（§2.2.6 规则 7）。"""

    if expected is None:
        return _item(
            check_id,
            title,
            "null",
            actual,
            ok=actual is None,
            detail=None if actual is None else detail_when_not_null or "未设上限时必须为 null（R9-AC5）",
        )
    try:
        expected_value = Decimal(expected)
    except ArithmeticError:  # pragma: no cover - 独立实现自身的格式兜底
        return _item(check_id, title, expected, actual, ok=False, detail="独立实现金额格式非法")
    if isinstance(actual, str):
        try:
            actual_value = Decimal(actual)
        except ArithmeticError:
            return _item(
                check_id,
                title,
                expected,
                actual,
                ok=False,
                detail="实际金额不是合法十进制字符串（R9-AC3）",
            )
        if actual_value != expected_value:
            return _item(
                check_id,
                title,
                expected,
                actual,
                ok=False,
                detail=f"金额不等：期望 {expected}，实际 {actual}",
            )
        if actual != expected:
            return _item(
                check_id,
                title,
                expected,
                actual,
                ok=False,
                detail="数值相等但格式不符合契约（必须两位小数的十进制字符串）",
            )
        return _item(check_id, title, expected, actual, ok=True)
    return _item(
        check_id,
        title,
        expected,
        actual,
        ok=False,
        detail=f"金额必须以十进制字符串传输，实际类型 {type(actual).__name__}（R9-AC3）",
    )


def _budget_items(parameters: Mapping[str, Any], result: Mapping[str, Any]) -> list[dict[str, Any]]:
    display_precision = parameters.get("display_precision", 2)
    reference = rules.budget_reference(
        parameters, int(display_precision) if isinstance(display_precision, int) else 2
    )
    items: list[dict[str, Any]] = []

    scenarios = result.get("scenarios")
    totals_actual: list[object] = []
    if isinstance(scenarios, (list, tuple)):
        totals_actual = [
            scenario.get("total") if isinstance(scenario, Mapping) else None
            for scenario in scenarios
        ]
    else:
        totals_actual = []

    problems: list[str] = []
    if len(totals_actual) != 2:
        problems.append("scenarios 必须是长度为 2 的数组（plan_a、plan_b）")
    else:
        for index, expected_total in enumerate(reference.totals):
            plan_id = rules.PLAN_IDS[index]
            actual_total = totals_actual[index]
            if actual_total is None:
                problems.append(f"{plan_id}.total 缺失")
                continue
            if not isinstance(actual_total, str):
                # 金额必须以十进制字符串传输，禁止二进制浮点（R9-AC3）。
                problems.append(
                    f"{plan_id}.total 金额必须以十进制字符串传输，"
                    f"实际类型 {type(actual_total).__name__}（R9-AC3）"
                )
                continue
            try:
                actual_value = Decimal(actual_total)
            except ArithmeticError:
                problems.append(f"{plan_id}.total 不是合法的十进制字符串：{actual_total!r}")
                continue
            if actual_value != Decimal(expected_total):
                problems.append(
                    f"{plan_id}.total 金额不等：期望 {expected_total}，实际 {actual_total}"
                )
                continue
            if actual_total != expected_total:
                problems.append(
                    f"{plan_id}.total 数值相等但格式不符合契约："
                    f"应为 {expected_total}，实际 {actual_total}"
                )
    items.append(
        _item(
            "bd_totals",
            "两方案总额（Decimal 独立计算）",
            reference.totals,
            totals_actual,
            ok=not problems,
            detail=None if not problems else "；".join(problems),
        )
    )

    # fixed / per_person：线性系数必须与独立计算一致（AST 形态下按 n=0 与 n=1 反推）。
    breakdown_problems: list[str] = []
    if isinstance(scenarios, (list, tuple)) and len(scenarios) == 2:
        expectation = [
            {
                "scenario_id": plan_id,
                "fixed": reference.fixed[index],
                "per_person": reference.per_person[index],
            }
            for index, plan_id in enumerate(rules.PLAN_IDS)
        ]
        for index, expected_entry in enumerate(expectation):
            scenario = scenarios[index]
            if not isinstance(scenario, Mapping):
                breakdown_problems.append(f"scenarios[{index}] 不是对象")
                continue
            for key in ("fixed", "per_person"):
                actual_value = scenario.get(key)
                if actual_value != expected_entry[key]:
                    breakdown_problems.append(
                        f"scenarios[{index}].{key} 应为 {expected_entry[key]!r}，"
                        f"实际 {_fmt(actual_value)!r}"
                    )
    else:
        breakdown_problems.append("scenarios 必须是长度为 2 的数组")
    items.append(
        _item(
            "bd_scenario_breakdown",
            "固定费与人均费",
            {
                "plan_a": {"fixed": reference.fixed[0], "per_person": reference.per_person[0]},
                "plan_b": {"fixed": reference.fixed[1], "per_person": reference.per_person[1]},
            },
            scenarios,
            ok=not breakdown_problems,
            detail=None if not breakdown_problems else "；".join(breakdown_problems),
        )
    )

    items.append(
        _amount_item("bd_difference", "方案差额", reference.difference, result.get("difference"))
    )
    items.append(
        _compare_exact(
            "bd_equal",
            "相等标记",
            reference.equal,
            result.get("equal"),
            reason="equal 必须由 difference == 0 判定（R9-AC2）",
        )
    )

    remaining_actual = result.get("remaining")
    if reference.remaining is None:
        items.append(
            _amount_item("bd_remaining", "余量", None, remaining_actual)
        )
    elif (
        isinstance(remaining_actual, (list, tuple))
        and len(remaining_actual) == len(reference.remaining)
    ):
        remaining_problems = [
            f"{rules.PLAN_IDS[index]}.remaining 应为 {expected!r}，实际 {_fmt(remaining_actual[index])!r}"
            for index, expected in enumerate(reference.remaining)
            if remaining_actual[index] != expected
        ]
        items.append(
            _item(
                "bd_remaining",
                "余量（上限 − 总额）",
                reference.remaining,
                remaining_actual,
                ok=not remaining_problems,
                detail=None if not remaining_problems else "；".join(remaining_problems),
            )
        )
    else:
        items.append(
            _item(
                "bd_remaining",
                "余量（上限 − 总额）",
                reference.remaining,
                remaining_actual,
                ok=False,
                detail="设上限时必须返回长度为 2 的余量数组，且顺序与 scenarios 一致",
            )
        )

    over_budget_actual = result.get("over_budget")
    if reference.over_budget is None:
        items.append(
            _item(
                "bd_over_budget",
                "超预算标记",
                "null",
                over_budget_actual,
                ok=over_budget_actual is None,
                detail=None if over_budget_actual is None else "未设上限时 over_budget 必须为 null",
            )
        )
    else:
        ok = isinstance(over_budget_actual, (list, tuple)) and list(over_budget_actual) == list(
            reference.over_budget
        )
        items.append(
            _item(
                "bd_over_budget",
                "超预算标记",
                reference.over_budget,
                over_budget_actual,
                ok=ok,
                detail=None
                if ok
                else "over_budget 必须由 remaining < 0 判定（余量为 0 不算超预算，R9-AC4）",
            )
        )

    # 未设上限的语义：budget_limit / remaining / over_budget 三者必须同时为 null（R9-AC5）。
    limit_actual = result.get("budget_limit")
    if reference.limit_decimal is None:
        no_limit_ok = (
            limit_actual is None and remaining_actual is None and over_budget_actual is None
        )
        items.append(
            _item(
                "bd_no_limit",
                "未设上限的三处 null",
                {"budget_limit": None, "remaining": None, "over_budget": None},
                {
                    "budget_limit": limit_actual,
                    "remaining": remaining_actual,
                    "over_budget": over_budget_actual,
                },
                ok=no_limit_ok,
                detail=None
                if no_limit_ok
                else "未设 budget_limit 时界面不画预算线，三处必须同时为 null（R9-AC5）",
            )
        )
    else:
        limit_expected = reference.budget_limit
        ok = limit_actual == limit_expected
        items.append(
            _item(
                "bd_no_limit",
                "预算上限回显",
                limit_expected,
                limit_actual,
                ok=ok,
                detail=None
                if ok
                else f"budget_limit 应按两位小数回显 {limit_expected!r}，实际 {_fmt(limit_actual)!r}",
            )
        )

    lines_actual = result.get("lines")
    if not isinstance(lines_actual, (list, tuple)) or len(lines_actual) != 2:
        items.append(
            _item(
                "bd_lines",
                "直线数据（n=0 / n=2000 / 斜率）",
                reference.lines,
                lines_actual,
                ok=False,
                detail="lines 必须是长度为 2 的数组",
            )
        )
    else:
        line_problems: list[str] = []
        for index, expected_line in enumerate(reference.lines):
            actual_line = lines_actual[index]
            if not isinstance(actual_line, Mapping):
                line_problems.append(f"lines[{index}] 不是对象")
                continue
            for key in ("scenario_id", "at_zero", "at_max", "slope"):
                if actual_line.get(key) != expected_line[key]:
                    line_problems.append(
                        f"lines[{index}].{key} 应为 {expected_line[key]!r}，"
                        f"实际 {_fmt(actual_line.get(key))!r}"
                    )
        items.append(
            _item(
                "bd_lines",
                "直线数据（n=0 / n=2000 / 斜率）",
                reference.lines,
                lines_actual,
                ok=not line_problems,
                detail=None if not line_problems else "；".join(line_problems),
            )
        )

    items.append(
        _not_covered(
            "bd_scope",
            "预算范围",
            "字符串表达式形态与超过两个方案的比较不在首版范围（AST 只允许 constant/ref/add/multiply）",
        )
    )
    return items


# ---------------------------------------------------------------------------
# 报告组装
# ---------------------------------------------------------------------------


def _new_report_id() -> str:
    """报告 id：全局唯一，供 ``GET /objects/{id}/checks`` 回查（R11-AC4）。"""

    return f"rpt_{uuid.uuid4().hex}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _summarize(items: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    """``summary`` 只统计 pass/fail/not_covered；``stale`` 不计入（C-04）。"""

    counts = {PASS: 0, FAIL: 0, NOT_COVERED: 0}
    for item in items:
        status = item.get("status")
        if status in counts:
            counts[status] += 1
    return counts


def _is_stale(report_version: int, report_revision: int, current_version: int, current_revision: int) -> bool:
    """对象当前版本领先于报告绑定的版本时置 true（§2.2.7 契约级行为 4）。"""

    return current_version > report_version or current_revision > report_revision


def _check_result_mapping(result: object) -> Mapping[str, Any]:
    if not isinstance(result, Mapping):
        raise rules.InputProblem(
            "MISSING_FIELD",
            f"result 必须是内核返回的对象，实际类型 {type(result).__name__}",
            "result",
        )
    return result


def _items_for(
    template_id: str, parameters: Mapping[str, Any], result: Mapping[str, Any]
) -> list[dict[str, Any]]:
    if template_id == "matrix_2d":
        return _matrix_items(parameters, result)
    if template_id == "force_2d":
        return _force_items(parameters, result)
    if template_id == "bfs_flow":
        return _bfs_items(parameters, result)
    if template_id == "budget_compare":
        return _budget_items(parameters, result)
    raise rules.InputProblem(
        "UNSUPPORTED_TEMPLATE",
        f"模板 {template_id!r} 不在白名单内（仅支持 {'/'.join(rules.PROFILE_IDS)}）",
        "template_id",
    )


def _assemble(
    template_id: str,
    result: object,
    parameters: Mapping[str, Any],
    validation_profile: str,
    *,
    object_id: str,
    kernel_version: str,
    model_version: int,
    revision: int,
    current_model_version: int,
    current_revision: int,
) -> dict[str, Any]:
    """组装 ``ValidationReport``（字段逐字按 C-RUN@1，全部 snake_case）。"""

    if validation_profile != rules.profile_for(template_id):
        raise rules.InputProblem(
            "MISSING_FIELD",
            f"validation_profile {validation_profile!r} 与模板 {template_id!r} 不匹配"
            f"（应为 {rules.profile_for(template_id)!r}）",
            "validation_profile",
        )
    if not isinstance(parameters, Mapping):
        raise rules.InputProblem("MISSING_FIELD", "parameters 必须是对象", "parameters")
    if not isinstance(object_id, str) or not object_id:
        raise rules.InputProblem(
            "MISSING_FIELD", "object_id 必须是非空字符串（报告要绑定具体对象）", "object_id"
        )
    if isinstance(model_version, bool) or not isinstance(model_version, int) or model_version < 1:
        raise rules.InputProblem("MISSING_FIELD", "model_version 必须是 ≥ 1 的整数", "model_version")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        raise rules.InputProblem("MISSING_FIELD", "revision 必须是 ≥ 0 的整数", "revision")

    items = _items_for(template_id, parameters, _check_result_mapping(result))
    summary = _summarize(items)
    stale = _is_stale(model_version, revision, current_model_version, current_revision)

    return {
        "report_id": _new_report_id(),
        "object_id": object_id,
        "model_version": model_version,
        "revision": revision,
        "kernel_version": kernel_version,
        "validation_profile": validation_profile,
        "items": items,
        "summary": summary,
        "is_stale": stale,
        "created_at": _now_iso(),
    }


def build_report(
    object_json: Mapping[str, Any],
    result: Mapping[str, Any],
    model_version: int,
    revision: int,
    *,
    current_model_version: int | None = None,
    current_revision: int | None = None,
) -> dict[str, Any]:
    """按 §2.2.9 的 P1 澄清签名产出 ``ValidationReport`` 的 dict 形式。

    :param object_json: 被校验的 ``KnowledgeObject``（C-KO@1，用于提取模板输入、
        ``object_id``、``template_id``、``kernel_version`` 与对象声明的 profile）。
    :param result: **内核已经算好的结果**。校验器只读取它，绝不重算后再宣称一致。
    :param model_version: 报告绑定的结构版本（校验发生时的值）。
    :param revision: 报告绑定的数值修订号。
    :param current_model_version: 对象**当前**的结构版本，用于动态判定 ``is_stale``；
        缺省时取 ``object_json.model_version``（即"校验的就是当前对象"）。
    :param current_revision: 对象当前的 ``revision``，缺省时取 ``object_json.revision``。
    :raises rules.InputProblem: ``code`` 为 ``MISSING_FIELD`` / ``UNSUPPORTED_TEMPLATE``，
        与 §2.2.9 P1 的"出错时抛 KernelError"约定同构（``code``/``message``/``field``）。

    示例::

        report = build_report(object_json, kernel_result, 3, 12)
        report["summary"]  # {'pass': 9, 'fail': 0, 'not_covered': 3}
    """

    if not isinstance(object_json, Mapping):
        raise rules.InputProblem("MISSING_FIELD", "object 必须是对象", "object")
    template_id = object_json.get("template_id")
    if not isinstance(template_id, str) or not template_id:
        raise rules.InputProblem("MISSING_FIELD", "object.template_id 缺失", "template_id")

    declared_profile = object_json.get("validation_profile")
    expected_profile = rules.profile_for(template_id)
    if declared_profile is not None:
        if not isinstance(declared_profile, str) or not declared_profile:
            raise rules.InputProblem(
                "MISSING_FIELD", "object.validation_profile 必须是非空字符串", "validation_profile"
            )
        if declared_profile != expected_profile:
            raise rules.InputProblem(
                "MISSING_FIELD",
                f"object.validation_profile {declared_profile!r} 与 template_id"
                f" {template_id!r} 不匹配（应为 {expected_profile!r}）",
                "validation_profile",
            )
        profile = declared_profile
    else:
        profile = expected_profile

    kernel_version = object_json.get("kernel_version")
    if not isinstance(kernel_version, str) or not kernel_version:
        kernel_version = rules.KERNEL_IDS[template_id]

    object_id = object_json.get("object_id")
    if not isinstance(object_id, str) or not object_id:
        raise rules.InputProblem(
            "MISSING_FIELD", "object.object_id 必须是非空字符串", "object_id"
        )

    extracted = rules.extract_parameters(template_id, object_json)

    object_model_version = object_json.get("model_version")
    object_revision = object_json.get("revision")
    resolved_current_version = (
        current_model_version
        if isinstance(current_model_version, int) and not isinstance(current_model_version, bool)
        else object_model_version
        if isinstance(object_model_version, int) and not isinstance(object_model_version, bool)
        else model_version
    )
    resolved_current_revision = (
        current_revision
        if isinstance(current_revision, int) and not isinstance(current_revision, bool)
        else object_revision
        if isinstance(object_revision, int) and not isinstance(object_revision, bool)
        else revision
    )

    return _assemble(
        template_id,
        result,
        extracted.parameters,
        profile,
        object_id=object_id,
        kernel_version=kernel_version,
        model_version=model_version,
        revision=revision,
        current_model_version=resolved_current_version,
        current_revision=resolved_current_revision,
    )


def build_report_for_template(
    template_id: str,
    kernel_result: Mapping[str, Any],
    parameters: Mapping[str, Any],
    validation_profile: str | None = None,
    *,
    object_id: str | None = None,
    kernel_version: str | None = None,
    model_version: int = 1,
    revision: int = 0,
    current_model_version: int | None = None,
    current_revision: int | None = None,
) -> dict[str, Any]:
    """便捷入口：直接以"模板 + 内核结果 + 模板输入"组装报告。

    这是 §2.2.9 ``build_report`` 的**无对象**形态，供 ``scripts/selftest.py`` 与
    任何只有模板输入（尚无 ``KnowledgeObject``）的调用方使用；``parameters`` 的形状
    与 ``fixtures/golden/*.json`` 的 ``input`` 一致。

    :raises rules.InputProblem: 模板不支持、profile 不匹配或输入非法。
    """

    if not isinstance(template_id, str) or not template_id:
        raise rules.InputProblem("MISSING_FIELD", "template_id 缺失", "template_id")
    profile = validation_profile or rules.profile_for(template_id)
    return _assemble(
        template_id,
        kernel_result,
        parameters,
        profile,
        object_id=object_id or f"unbound_{template_id}",
        kernel_version=kernel_version or rules.KERNEL_IDS[template_id],
        model_version=model_version,
        revision=revision,
        current_model_version=model_version
        if current_model_version is None
        else current_model_version,
        current_revision=revision if current_revision is None else current_revision,
    )


def build_error_report(
    template_id: str,
    parameters: Mapping[str, Any],
    kernel_error: Mapping[str, Any],
    validation_profile: str | None = None,
    *,
    object_id: str | None = None,
    kernel_version: str | None = None,
    model_version: int = 1,
    revision: int = 0,
) -> dict[str, Any]:
    """内核对输入报错时的独立复核报告（供 T7 的失败诊断与 selftest 使用）。

    校验器**独立判断**这份输入是否真的非法、应归为哪个错误码，再与内核实际抛出
    的错误比对：两者一致才是 ``pass``。若内核拒绝了一份校验器认为合法的输入，
    报告会给出 ``fail`` 并说明"过度拒绝"，避免把内核缺陷当成数据缺陷。

    :param kernel_error: 内核错误的三元组 ``{"code", "message", "field"}``。
    """

    if not isinstance(kernel_error, Mapping):
        raise rules.InputProblem("MISSING_FIELD", "kernel_error 必须是对象", "kernel_error")
    profile = validation_profile or rules.profile_for(template_id)

    independent_problem: rules.InputProblem | None = None
    try:
        if template_id == "matrix_2d":
            rules.matrix_reference(
                parameters.get("matrix"),
                parameters.get("vector"),
                parameters.get("second_matrix"),
            )
        elif template_id == "force_2d":
            rules.force_reference(
                parameters.get("forces"),
                parameters.get("display_precision", 2),
                parameters.get("compute_precision", 6),
            )
        elif template_id == "bfs_flow":
            rules.bfs_reference(
                parameters.get("nodes"),
                parameters.get("edges"),
                parameters.get("start_node_id") or "",
                bool(parameters.get("directed", True)),
                parameters.get("max_steps", 200),
            )
        elif template_id == "budget_compare":
            rules.budget_reference(parameters, parameters.get("display_precision", 2))
        else:
            raise rules.InputProblem(
                "UNSUPPORTED_TEMPLATE",
                f"模板 {template_id!r} 不在白名单内",
                "template_id",
            )
    except rules.InputProblem as problem:
        independent_problem = problem

    kernel_code = kernel_error.get("code")
    kernel_message = kernel_error.get("message")
    kernel_field = kernel_error.get("field")

    if independent_problem is None:
        item = _item(
            "input_validity",
            "输入合法性",
            "独立实现认为该输入合法，应正常计算",
            f"{_fmt(kernel_code)}：{_fmt(kernel_message)}",
            ok=False,
            detail="内核拒绝了合法输入（过度拒绝），需检查内核的入参校验分支",
        )
    else:
        code_ok = kernel_code == independent_problem.code
        field_ok = kernel_field is None or kernel_field == independent_problem.field
        message_ok = not isinstance(kernel_message, str) or bool(kernel_message.strip())
        ok = code_ok and field_ok and message_ok
        detail = None
        if not ok:
            problems: list[str] = []
            if not code_ok:
                problems.append(f"错误码应为 {independent_problem.code!r}")
            if not field_ok:
                problems.append(f"field 应为 {independent_problem.field!r}")
            if not message_ok:
                problems.append("错误 message 不得为空")
            detail = "；".join(problems)
        item = _item(
            "input_validity",
            "输入合法性",
            {
                "code": independent_problem.code,
                "field": independent_problem.field,
                "message": independent_problem.message,
            },
            {
                "code": kernel_code,
                "field": kernel_field,
                "message": kernel_message,
            },
            ok=ok,
            detail=detail,
        )

    if validation_profile is not None and validation_profile != rules.profile_for(template_id):
        raise rules.InputProblem(
            "MISSING_FIELD",
            f"validation_profile {validation_profile!r} 与模板 {template_id!r} 不匹配",
            "validation_profile",
        )

    items = [item]
    return {
        "report_id": _new_report_id(),
        "object_id": object_id or f"unbound_{template_id}",
        "model_version": model_version,
        "revision": revision,
        "kernel_version": kernel_version or rules.KERNEL_IDS[template_id],
        "validation_profile": profile,
        "items": items,
        "summary": _summarize(items),
        "is_stale": False,
        "created_at": _now_iso(),
    }


#: 报告有没有任何失败项（前端据此决定是否显示"通过"，R11-AC3）。
def has_failure(report: Mapping[str, Any]) -> bool:
    """``True`` 表示报告中存在 ``fail`` 项；``is_stale`` 不计入（由前端另行展示）。"""

    summary = report.get("summary")
    return isinstance(summary, Mapping) and summary.get(FAIL, 0) > 0


def is_passing(report: Mapping[str, Any]) -> bool:
    """``True`` 仅当报告未过期且没有失败项 —— 过期报告不得显示为通过（R10-AC7）。"""

    return bool(report.get("is_stale")) is False and not has_failure(report)
