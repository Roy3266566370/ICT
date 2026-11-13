"""``matrix_2d`` 内核单元测试（C-MX@1，T8 验收 1–3）。

覆盖：黄金夹具逐字段对照、``ab``/``ba`` 语义、奇异与零矩阵、复数特征值、
参数范围与入参不可变。
"""

from __future__ import annotations

import copy
import math
from typing import Any

import pytest

from app.engines import KernelError, apply_matrix, compose_matrices
from app.engines.matrix import COMPOSE_SEMANTICS
from app.engines.types import NO_REAL_EIGEN_REASON, SINGULAR_REASON


def _load_case(load_golden: Any, case_id: str) -> dict[str, Any]:
    golden = load_golden("matrix_2d")
    assert golden["templateId"] == "matrix_2d"
    for case in golden["cases"]:
        if case["id"] == case_id:
            return case
    raise AssertionError(f"黄金夹具中不存在用例 {case_id}")


def _run_case(case: dict[str, Any]) -> dict[str, Any]:
    data = case["input"]
    if "second_matrix" in data:
        return compose_matrices(data["matrix"], data["second_matrix"], data["vector"])
    return apply_matrix(data["matrix"], data["vector"])


def _check_golden(case: dict[str, Any], result: dict[str, Any], assert_subset: Any) -> None:
    for key, expected in case["expected"].items():
        assert key in result, f"结果缺少契约字段 {key}"
        assert_subset(result[key], expected, key)


# ---------------------------------------------------------------------------
# 黄金夹具
# ---------------------------------------------------------------------------


def test_mx_basic(load_golden: Any, assert_subset: Any) -> None:
    """R6-AC1：A=[[1,1],[0,1]]、x=(1,1) → Ax=(2,1) 与完整确定性字段。"""

    case = _load_case(load_golden, "mx_basic")
    result = _run_case(case)
    _check_golden(case, result, assert_subset)

    assert result["ax"] == [2, 1]
    assert result["columns"] == [[1, 0], [1, 1]]
    assert result["det"] == pytest.approx(1)
    assert result["trace"] == pytest.approx(2)
    assert result["rank"] == 2
    assert result["eigenvalues"] == {"real": True, "values": [1, 1]}
    assert result["invertible"] is True
    assert result["inverse"] == [[1, -1], [0, 1]]
    assert result["singular_reason"] is None
    assert result["composition"] is None
    assert [step["step"] for step in result["steps"]] == [1, 2]
    assert result["steps"][1]["partial"] == [1.0, 0.0]


def test_mx_identity(load_golden: Any, assert_subset: Any) -> None:
    """R6-AC11：单位矩阵按公式自然得出 Ax=x，不特判。"""

    case = _load_case(load_golden, "mx_identity")
    result = _run_case(case)
    _check_golden(case, result, assert_subset)
    assert result["ax"] == [2, -1]
    assert result["inverse"] == [[1, 0], [0, 1]]


def test_mx_zero_vector(load_golden: Any, assert_subset: Any) -> None:
    """R6-AC11：零向量不特判，partial 与 result 均为 (0, 0)。"""

    case = _load_case(load_golden, "mx_zero_vector")
    result = _run_case(case)
    _check_golden(case, result, assert_subset)
    assert result["ax"] == [0, 0]
    assert result["steps"][1]["partial"] == [0.0, 0.0]


def test_mx_singular(load_golden: Any, assert_subset: Any) -> None:
    """R6-AC10：奇异矩阵 det=0、rank=1、不伪造逆矩阵。"""

    case = _load_case(load_golden, "mx_singular")
    result = _run_case(case)
    _check_golden(case, result, assert_subset)

    assert result["det"] == pytest.approx(0)
    assert result["rank"] == 1
    assert result["invertible"] is False
    assert result["inverse"] is None
    assert result["singular_reason"] == SINGULAR_REASON
    assert result["ellipse"] is None
    assert result["eigenvalues"] == {"real": True, "values": [0, 3]}


def test_mx_noncommute(load_golden: Any, assert_subset: Any) -> None:
    """R6-AC2/R6-AC3：ABx=(3,2) 与 BAx=(2,3) 并列且不相等。"""

    case = _load_case(load_golden, "mx_noncommute")
    result = _run_case(case)
    _check_golden(case, result, assert_subset)

    composition = result["composition"]
    assert composition is not None
    assert composition["ab"] == [[2, 1], [1, 1]]
    assert composition["ba"] == [[1, 1], [1, 2]]
    assert composition["abx"] == [3, 2]
    assert composition["bax"] == [2, 3]
    assert composition["commutes"] is False
    assert composition["order"] == "A_then_B"


def test_mx_textbook_s6(load_golden: Any, assert_subset: Any) -> None:
    """课程第 6 页矩阵：disc=4，特征值升序 (1, 3)。"""

    case = _load_case(load_golden, "mx_textbook_s6")
    result = _run_case(case)
    _check_golden(case, result, assert_subset)
    assert result["eigenvalues"] == {"real": True, "values": [1, 3]}


# ---------------------------------------------------------------------------
# 验收补充
# ---------------------------------------------------------------------------


def test_acceptance_1_apply_matrix(load_golden: Any, assert_subset: Any) -> None:
    """T8 验收 1：apply_matrix 的 ax/det/trace/rank/特征值/可逆与两步步骤。"""

    case = _load_case(load_golden, "mx_basic")
    result = apply_matrix([[1, 1], [0, 1]], [1, 1])
    _check_golden(case, result, assert_subset)
    assert len(result["steps"]) == 2
    assert result["steps"][0]["terms"] == [
        {"coefficient": 1.0, "column_index": 0, "column": [1.0, 0.0]},
        {"coefficient": 1.0, "column_index": 1, "column": [1.0, 1.0]},
    ]


def test_acceptance_2_compose_matrices() -> None:
    """T8 验收 2：ab/ba/abx/bax/commutes（字段位于契约的 composition 子对象）。"""

    result = compose_matrices([[1, 1], [0, 1]], [[1, 0], [1, 1]], [1, 1])
    composition = result["composition"]
    assert composition == {
        "order": "A_then_B",
        "ab": [[2, 1], [1, 1]],
        "ba": [[1, 1], [1, 2]],
        "abx": [3, 2],
        "bax": [2, 3],
        "commutes": False,
    }

    # C-12 语义：ab = A·B 表示先 B 后 A，(AB)x = A(Bx)。
    assert composition["ab"] == [[2, 1], [1, 1]]
    assert composition["ba"] == [[1, 1], [1, 2]]
    assert COMPOSE_SEMANTICS["ab_means_apply_b_then_a"].startswith("ab = A·B")
    assert COMPOSE_SEMANTICS["ba_means_apply_a_then_b"].startswith("ba = B·A")


def test_acceptance_3_singular_and_zero_matrix() -> None:
    """T8 验收 3：奇异矩阵拒绝求逆；零矩阵 rank=0。"""

    singular = apply_matrix([[1, 1], [2, 2]], [1, 0])
    assert singular["det"] == pytest.approx(0)
    assert singular["rank"] == 1
    assert singular["inverse"] is None
    assert singular["singular_reason"]

    zero = apply_matrix([[0, 0], [0, 0]], [1, 1])
    assert zero["rank"] == 0
    assert zero["invertible"] is False
    assert zero["inverse"] is None
    assert zero["singular_reason"] == SINGULAR_REASON
    assert zero["eigenvalues"] == {"real": True, "values": [0, 0]}
    assert zero["ellipse"] is None


def test_complex_eigenvalues_are_reported_without_nan() -> None:
    """旋转矩阵 disc<0：real=false 且给原因，禁止 NaN。"""

    result = apply_matrix([[0, -1], [1, 0]], [1, 0])
    assert result["eigenvalues"] == {"real": False, "reason": NO_REAL_EIGEN_REASON}
    assert "values" not in result["eigenvalues"]
    assert not math.isnan(result["det"])


def test_ellipse_for_full_rank_matrix() -> None:
    """单位圆像的半轴长：rank=2 时返回 {a, b}，长轴 >= 短轴。"""

    result = apply_matrix([[1, 1], [0, 1]], [1, 1])
    ellipse = result["ellipse"]
    assert ellipse is not None
    assert ellipse["a"] >= ellipse["b"] > 0


def test_compose_order_is_validated() -> None:
    with pytest.raises(KernelError) as excinfo:
        compose_matrices([[1, 0], [0, 1]], [[1, 0], [0, 1]], [1, 1], order="B_first")
    assert excinfo.value.code == "MISSING_FIELD"
    assert excinfo.value.field == "compose_order"


def test_matrix_parameter_range_is_enforced() -> None:
    """§2.2.3 规则 7：矩阵元素与向量分量限 [-3, 3]。"""

    with pytest.raises(KernelError) as excinfo:
        apply_matrix([[3.1, 0], [0, 1]], [1, 1])
    assert excinfo.value.code == "MISSING_FIELD"
    assert "范围" in excinfo.value.message

    with pytest.raises(KernelError):
        apply_matrix([[1, 0], [0, 1]], [0, -3.5])


def test_matrix_rejects_non_finite_values() -> None:
    with pytest.raises(KernelError) as excinfo:
        apply_matrix([[float("nan"), 0], [0, 1]], [1, 1])
    assert excinfo.value.code == "MISSING_FIELD"


def test_matrix_inputs_are_not_mutated() -> None:
    """T8 验收 7：内核不得修改入参。"""

    matrix = [[1, 1], [0, 1]]
    vector = [1, 1]
    matrix_before = copy.deepcopy(matrix)
    vector_before = copy.deepcopy(vector)

    apply_matrix(matrix, vector)
    compose_matrices(matrix, [[1, 0], [1, 1]], vector)

    assert matrix == matrix_before
    assert vector == vector_before