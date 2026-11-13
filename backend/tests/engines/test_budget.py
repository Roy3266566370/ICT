"""``budget_compare`` 内核单元测试（C-BUD@1，T8 验收 6）。

覆盖：黄金夹具逐字段对照（系数形态与 AST 形态）、Decimal 金额精度、预算余量、
循环依赖与未定义 ref、字符串表达式安全边界（不使用 eval）、入参不可变。
"""

from __future__ import annotations

import copy
from decimal import Decimal
from typing import Any

import pytest

from app.engines import KernelError, budget_compare, budget_compare_ast


def _load_case(load_golden: Any, case_id: str) -> dict[str, Any]:
    golden = load_golden("budget_compare")
    assert golden["templateId"] == "budget_compare"
    for case in golden["cases"]:
        if case["id"] == case_id:
            return case
    raise AssertionError(f"黄金夹具中不存在用例 {case_id}")


#: 黄金夹具使用的方案系数（3000+80n / 6000+50n）。
COEFFICIENTS: dict[str, Any] = {
    "plan_a": {"fixed": "3000.00", "per_unit": "80.00"},
    "plan_b": {"fixed": "6000.00", "per_unit": "50.00"},
}


def _compare(people: int, budget_limit: int | None) -> dict[str, Any]:
    return budget_compare(COEFFICIENTS, people, budget_limit)


# ---------------------------------------------------------------------------
# 黄金夹具（系数形态）
# ---------------------------------------------------------------------------


def test_bd_n80(load_golden: Any, assert_subset: Any) -> None:
    """R9-AC1：n=80 → 9400.00 / 10000.00，difference=-600.00。"""

    case = _load_case(load_golden, "bd_n80")
    result = _compare(80, None)
    assert_subset(result, case["expected"], "bd_n80")

    assert result["inputs"] == {"people": 80}
    assert result["scenarios"][0]["total"] == "9400.00"
    assert result["scenarios"][1]["total"] == "10000.00"
    assert result["difference"] == "-600.00"
    assert result["equal"] is False
    assert result["budget_limit"] is None
    assert result["remaining"] is None
    assert result["over_budget"] is None


def test_bd_n100(load_golden: Any, assert_subset: Any) -> None:
    """R9-AC2：n=100 → 两方案均为 11000.00 且标记相等。"""

    case = _load_case(load_golden, "bd_n100")
    result = _compare(100, None)
    assert_subset(result, case["expected"], "bd_n100")

    assert result["scenarios"][0]["total"] == "11000.00"
    assert result["scenarios"][1]["total"] == "11000.00"
    assert result["difference"] == "0.00"
    assert result["equal"] is True


def test_bd_limit_ok(load_golden: Any, assert_subset: Any) -> None:
    """R9-AC4/AC6：上限 10000 → 余量 600.00 与 0.00，均未超预算。"""

    case = _load_case(load_golden, "bd_limit_ok")
    result = _compare(80, 10000)
    assert_subset(result, case["expected"], "bd_limit_ok")

    assert result["budget_limit"] == "10000.00"
    assert result["remaining"] == ["600.00", "0.00"]
    assert result["over_budget"] == [False, False]


def test_bd_over_budget(load_golden: Any, assert_subset: Any) -> None:
    """R9-AC4：上限 5000 → 余量为负并标记超预算。"""

    case = _load_case(load_golden, "bd_over_budget")
    result = _compare(80, 5000)
    assert_subset(result, case["expected"], "bd_over_budget")

    assert result["remaining"] == ["-4400.00", "-5000.00"]
    assert result["over_budget"] == [True, True]


# ---------------------------------------------------------------------------
# AST 形态（C-ENGINE@1 兼容）与循环依赖
# ---------------------------------------------------------------------------


def test_ast_form_matches_coefficient_form(load_golden: Any, assert_subset: Any) -> None:
    """C-ENGINE@1 AST 路径与系数路径对同一输入产生逐字段一致的结果。"""

    case = _load_case(load_golden, "bd_n80")
    data = case["input"]
    result = budget_compare(
        data["expressions"],
        data["people"],
        data["budget_limit"],
        parameters=data["parameters"],
    )
    assert_subset(result, case["expected"], "bd_n80(AST)")
    assert result == _compare(80, None)


def test_budget_compare_ast_wrapper(load_golden: Any, assert_subset: Any) -> None:
    """C-ENGINE@1 位置参数包装：budget_compare_ast(ast_a, ast_b, params, people, limit)。"""

    case = _load_case(load_golden, "bd_n80")
    data = case["input"]
    result = budget_compare_ast(
        data["expressions"]["plan_a"],
        data["expressions"]["plan_b"],
        data["parameters"],
        data["people"],
        data["budget_limit"],
    )
    assert_subset(result, case["expected"], "bd_n80(wrapper)")


def test_bd_cycle_is_rejected(load_golden: Any) -> None:
    """R9-AC7：plan_a 引用自身 → MISSING_FIELD，message 含"循环依赖"。"""

    case = _load_case(load_golden, "bd_cycle")
    data = case["input"]
    expected_error = case["expected"]["error"]

    with pytest.raises(KernelError) as excinfo:
        budget_compare(
            data["expressions"],
            data["people"],
            data["budget_limit"],
            parameters=data["parameters"],
        )

    error = excinfo.value
    assert error.code == expected_error["code"]
    assert expected_error["message_contains"] in error.message
    assert error.field == expected_error["field"]


def test_undefined_ref_is_rejected() -> None:
    with pytest.raises(KernelError) as excinfo:
        budget_compare(
            {
                "plan_a": {"op": "ref", "parameter_id": "missing"},
                "plan_b": {"fixed": "0", "per_unit": "1"},
            },
            80,
        )
    assert excinfo.value.code == "MISSING_FIELD"
    assert excinfo.value.field == "missing"
    assert "未定义" in excinfo.value.message


def test_unsupported_ast_operation_is_rejected() -> None:
    with pytest.raises(KernelError) as excinfo:
        budget_compare(
            {
                "plan_a": {"op": "divide", "args": [{"op": "constant", "value": "1"}]},
                "plan_b": {"fixed": "0", "per_unit": "1"},
            },
            80,
        )
    assert excinfo.value.code == "MISSING_FIELD"
    assert "不支持" in excinfo.value.message


# ---------------------------------------------------------------------------
# 字符串表达式（C-06 裁决）：只解释、不 eval
# ---------------------------------------------------------------------------


def test_string_expression_form() -> None:
    coefficients = {
        "plan_a": {"expression": "3000 + 80 * n"},
        "plan_b": {"expression": "6000 + 50 * n"},
    }
    result = budget_compare(coefficients, 80)
    assert result["scenarios"][0]["total"] == "9400.00"
    assert result["scenarios"][1]["total"] == "10000.00"
    assert result["scenarios"][0]["per_person"] == "80.00"
    assert result["scenarios"][1]["per_person"] == "50.00"
    assert result["scenarios"][0]["fixed"] == "3000.00"
    assert result["scenarios"][1]["fixed"] == "6000.00"
    assert result["lines"][0]["at_max"] == "163000.00"
    assert result["lines"][1]["at_max"] == "106000.00"


def test_top_level_expression_keys() -> None:
    coefficients = {
        "expression_a": "3000 + 80*n",
        "expression_b": "6000 + 50*n",
    }
    result = budget_compare(coefficients, 100)
    assert result["equal"] is True
    assert result["difference"] == "0.00"


def test_string_expression_rejects_function_calls() -> None:
    with pytest.raises(KernelError) as excinfo:
        budget_compare(
            {"plan_a": {"expression": "3000 + sqrt(n)"}, "plan_b": {"fixed": "0", "per_unit": "1"}},
            80,
        )
    assert excinfo.value.code == "MISSING_FIELD"
    assert "仅支持变量 n" in excinfo.value.message


def test_string_expression_rejects_code_injection() -> None:
    """R12-AC2：表达式只能是白名单算术，源码级注入被词法/语法拒绝。"""

    for payload in (
        "__import__('os').system('dir')",
        "3000 + n; n",
        "3000 + n ** 2",
        "3000 + n,",
    ):
        with pytest.raises(KernelError) as excinfo:
            budget_compare(
                {"plan_a": {"expression": payload}, "plan_b": {"fixed": "0", "per_unit": "1"}},
                80,
            )
        assert excinfo.value.code == "MISSING_FIELD"


def test_string_expression_rejects_division_by_zero() -> None:
    with pytest.raises(KernelError) as excinfo:
        budget_compare(
            {"plan_a": {"expression": "3000 + n/0"}, "plan_b": {"fixed": "0", "per_unit": "1"}},
            80,
        )
    assert excinfo.value.code == "MISSING_FIELD"
    assert "除数" in excinfo.value.message


# ---------------------------------------------------------------------------
# 校验与精度
# ---------------------------------------------------------------------------


def test_people_range_is_enforced() -> None:
    for people in (-1, 2001, 80.5, True, "80"):
        with pytest.raises(KernelError) as excinfo:
            _compare(people, None)  # type: ignore[arg-type]
        assert excinfo.value.code == "MISSING_FIELD"
        assert excinfo.value.field == "people"


def test_budget_limit_range_is_enforced() -> None:
    for limit in (-1, 1000001, 1.5, "10000.50", True):
        with pytest.raises(KernelError) as excinfo:
            _compare(80, limit)  # type: ignore[arg-type]
        assert excinfo.value.code == "MISSING_FIELD"
        assert excinfo.value.field == "budget_limit"


def test_decimal_arithmetic_avoids_binary_float() -> None:
    """R9-AC3：0.1 + 0.2 在 Decimal 下精确为 0.30，而非 0.30000000000000004。"""

    result = budget_compare(
        {
            "plan_a": {"fixed": "0.10", "per_unit": "0.20"},
            "plan_b": {"fixed": "0", "per_unit": "0.30"},
        },
        1,
    )
    assert result["scenarios"][0]["total"] == "0.30"
    assert result["scenarios"][0]["fixed"] == "0.10"
    assert result["scenarios"][1]["total"] == "0.30"
    assert result["difference"] == "0.00"
    assert result["equal"] is True
    assert Decimal(result["scenarios"][0]["total"]) == Decimal("0.3")


def test_budget_inputs_are_not_mutated() -> None:
    """T8 验收 7：coefficients / parameters 深比较前后相等。"""

    coefficients = {
        "plan_a": {"fixed": "3000", "per_unit": "80"},
        "plan_b": {"fixed": "6000", "per_unit": "50"},
    }
    parameters = {"people_n": 80, "plan_a_fixed": "3000"}
    coefficients_before = copy.deepcopy(coefficients)
    parameters_before = copy.deepcopy(parameters)

    budget_compare(coefficients, 80, None, parameters=parameters)
    assert coefficients == coefficients_before
    assert parameters == parameters_before