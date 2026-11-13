"""``force_2d`` 内核单元测试（C-FC@1，T8 验收 4）。

覆盖：黄金夹具逐字段对照、反向抵消时方向为 null、精度双输出、范围与数量校验、
入参不可变。
"""

from __future__ import annotations

import copy
import math
from typing import Any

import pytest

from app.engines import KernelError, force_resultant


def _load_case(load_golden: Any, case_id: str) -> dict[str, Any]:
    golden = load_golden("force_2d")
    assert golden["templateId"] == "force_2d"
    for case in golden["cases"]:
        if case["id"] == case_id:
            return case
    raise AssertionError(f"黄金夹具中不存在用例 {case_id}")


def _run_case(case: dict[str, Any]) -> dict[str, Any]:
    data = case["input"]
    return force_resultant(
        data["forces"],
        data.get("display_precision", 2),
        data.get("compute_precision", 6),
    )


def test_fc_perpendicular(load_golden: Any, assert_subset: Any) -> None:
    """R7-AC1/AC2：10N 向东 + 10N 向北 → 14.14 N，方向 45°。"""

    case = _load_case(load_golden, "fc_perpendicular")
    result = _run_case(case)
    assert_subset(result, case["expected"], "fc_perpendicular")

    assert result["fx"] == pytest.approx(10)
    assert result["fy"] == pytest.approx(10)
    assert result["magnitude"] == pytest.approx(10 * math.sqrt(2), abs=1e-9)
    assert result["magnitude_rounded"] == "14.14"
    assert result["magnitude_exact"] == "14.142136"
    assert result["direction_deg"] == pytest.approx(45)
    assert result["direction_rounded"] == "45.00"
    assert result["cancel"] is False
    assert result["tolerance"] == 1e-9


def test_fc_cancel(load_golden: Any, assert_subset: Any) -> None:
    """R7-AC3：等大反向力 → cancel=true、direction_deg=None（禁止 0°/NaN）。"""

    case = _load_case(load_golden, "fc_cancel")
    result = _run_case(case)
    assert_subset(result, case["expected"], "fc_cancel")

    assert result["cancel"] is True
    assert result["direction_deg"] is None
    assert result["direction_rounded"] is None
    assert result["direction_defined"] is False
    assert result["magnitude"] < 1e-9
    assert result["note"] == "合力为零，方向未定义"
    assert isinstance(result["direction_deg"], type(None))


def test_fc_three(load_golden: Any, assert_subset: Any) -> None:
    """R7-AC6：支持 3 个共点力，fx=8、fy=4、方向 26.565°。"""

    case = _load_case(load_golden, "fc_three")
    result = _run_case(case)
    assert_subset(result, case["expected"], "fc_three")
    assert len(result["forces"]) == 3
    assert result["magnitude"] == pytest.approx(8.94427190999916, abs=1e-9)
    assert result["direction_deg"] == pytest.approx(26.56505117707799, abs=1e-9)


def test_four_forces_are_supported(load_golden: Any, assert_subset: Any) -> None:
    result = force_resultant(
        [
            {"magnitude": "1", "angle_deg": 0},
            {"magnitude": "2", "angle_deg": 90},
            {"magnitude": "3", "angle_deg": 180},
            {"magnitude": "4", "angle_deg": 270},
        ]
    )
    assert len(result["forces"]) == 4
    assert result["fx"] == pytest.approx(-2)
    assert result["fy"] == pytest.approx(-2)
    assert result["cancel"] is False


def test_force_count_is_enforced() -> None:
    one = [{"magnitude": "10", "angle_deg": 0}]
    five = [{"magnitude": "1", "angle_deg": 0} for _ in range(5)]

    with pytest.raises(KernelError) as excinfo:
        force_resultant(one)
    assert excinfo.value.code == "MISSING_FIELD"
    assert "数量" in excinfo.value.message

    with pytest.raises(KernelError):
        force_resultant(five)


def test_magnitude_range_is_enforced() -> None:
    with pytest.raises(KernelError) as excinfo:
        force_resultant(
            [{"magnitude": "1001", "angle_deg": 0}, {"magnitude": "1", "angle_deg": 90}]
        )
    assert excinfo.value.code == "MISSING_FIELD"
    assert "力的大小" in excinfo.value.message

    with pytest.raises(KernelError):
        force_resultant(
            [{"magnitude": "-1", "angle_deg": 0}, {"magnitude": "1", "angle_deg": 90}]
        )


def test_angle_range_is_enforced() -> None:
    for angle in (360, -1):
        with pytest.raises(KernelError) as excinfo:
            force_resultant(
                [
                    {"magnitude": "10", "angle_deg": angle},
                    {"magnitude": "10", "angle_deg": 90},
                ]
            )
        assert excinfo.value.code == "MISSING_FIELD"
        assert "角度" in excinfo.value.message


def test_magnitude_must_be_decimal_string() -> None:
    with pytest.raises(KernelError) as excinfo:
        force_resultant(
            [{"magnitude": "abc", "angle_deg": 0}, {"magnitude": "1", "angle_deg": 90}]
        )
    assert excinfo.value.code == "MISSING_FIELD"


def test_precision_outputs_are_independent() -> None:
    """R7-AC2：舍入值与计算精度值必须同时可读且互不覆盖。"""

    result = force_resultant(
        [{"magnitude": "10", "angle_deg": 0}, {"magnitude": "10", "angle_deg": 90}],
        display_precision=1,
        compute_precision=10,
    )
    assert result["magnitude_rounded"] == "14.1"
    assert result["magnitude_exact"] == "14.1421356237"


def test_force_inputs_are_not_mutated() -> None:
    """T8 验收 7：入参前后深比较相等。"""

    forces = [
        {"magnitude": "10", "angle_deg": 0},
        {"magnitude": "10", "angle_deg": 90},
    ]
    before = copy.deepcopy(forces)
    force_resultant(forces)
    assert forces == before