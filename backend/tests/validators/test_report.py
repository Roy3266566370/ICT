"""独立校验器单元测试（T9，R11-AC1~AC4，C-RUN@1）。

本文件**显式**导入 ``app.engines``：它需要真实的内核结果来证明"校验器能发现内核错误"
（这是 R11-AC1 的核心证明方式）。生产代码（``app/validators/**`` 与
``scripts/selftest.py``）不得导入内核，该约束由交付验收的 ``grep`` 检查保证，
不适用于测试。

覆盖点：

1. 报告/检查项形状严格等于 C-RUN@1（字段逐字、snake_case、summary 三计数）。
2. ``summary`` 与 ``items`` 计数一致；``is_stale`` 由对象当前版本动态判定且不计入 summary。
3. 四个 ``validation_profile`` 的检查项集合与 ``CHECK_IDS`` 的单一事实来源一致。
4. **注入内核错误**（改数值、伪造逆矩阵、抵消给 0°、重复入队、金额用 float、
   未设上限却给余量）必须被判 ``fail`` —— 证明校验器不是"复算一遍拿同样结果"。
5. ``build_report(object_json, ...)`` 能从 ``fixtures/examples/*.json`` 提取输入并全通过。
6. ``build_error_report`` 能发现"过度拒绝"。
7. 校验器不修改入参。
"""

from __future__ import annotations

import copy
from typing import Any

import pytest

from app.engines import (
    apply_matrix,
    bfs_run,
    budget_compare,
    compose_matrices,
    force_resultant,
)
from app.validators import (
    CHECK_IDS,
    InputProblem,
    PROFILE_IDS,
    build_error_report,
    build_report,
    build_report_for_template,
    has_failure,
    is_passing,
)
from app.validators.report import BOUNDARY_RATIO, TOLERANCE

REPORT_FIELDS = {
    "report_id",
    "object_id",
    "model_version",
    "revision",
    "kernel_version",
    "validation_profile",
    "items",
    "summary",
    "is_stale",
    "created_at",
}
ITEM_FIELDS = {"check_id", "title", "status", "expected", "actual", "detail"}


# ---------------------------------------------------------------------------
# 辅助
# ---------------------------------------------------------------------------


def _case(load_golden: Any, template_id: str, case_id: str) -> dict[str, Any]:
    golden = load_golden(template_id)
    for case in golden["cases"]:
        if case["id"] == case_id:
            return case
    raise AssertionError(f"{template_id} 黄金夹具中不存在用例 {case_id}")


def _result(template_id: str, case_input: dict[str, Any]) -> dict[str, Any]:
    """用真实内核产出 ``actual``（校验器只消费它，不参与计算）。"""

    if template_id == "matrix_2d":
        if case_input.get("second_matrix") is not None:
            return compose_matrices(
                case_input["matrix"],
                case_input["second_matrix"],
                case_input["vector"],
                case_input.get("compose_order", "A_then_B"),
            )
        return apply_matrix(case_input["matrix"], case_input["vector"])
    if template_id == "force_2d":
        return force_resultant(
            case_input["forces"],
            case_input.get("display_precision", 2),
            case_input.get("compute_precision", 6),
        )
    if template_id == "bfs_flow":
        return bfs_run(
            case_input["nodes"],
            case_input["edges"],
            directed=case_input.get("directed", True),
            start=case_input.get("start_node_id"),
            max_steps=case_input.get("max_steps", 200),
        )
    if template_id == "budget_compare":
        expressions = case_input.get("expressions") or {}
        return budget_compare(
            {"plan_a": expressions["plan_a"], "plan_b": expressions["plan_b"]},
            case_input["people"],
            case_input.get("budget_limit"),
            parameters=case_input.get("parameters") or {},
            display_precision=case_input.get("display_precision", 2),
        )
    raise AssertionError(f"未知模板 {template_id}")


def _report(
    load_golden: Any, template_id: str, case_id: str, **kwargs: Any
) -> dict[str, Any]:
    case = _case(load_golden, template_id, case_id)
    return build_report_for_template(
        template_id, _result(template_id, case["input"]), case["input"], **kwargs
    )


def _failure_items(report: dict[str, Any]) -> list[dict[str, Any]]:
    return [item for item in report["items"] if item["status"] == "fail"]


# ---------------------------------------------------------------------------
# 1. 形状与计数
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("template_id", list(PROFILE_IDS))
def test_report_shape_matches_contract(load_golden: Any, template_id: str) -> None:
    """C-RUN@1：报告只有 10 个字段，检查项只有 6 个字段，全部 snake_case。"""

    report = _report(load_golden, template_id, load_golden(template_id)["cases"][0]["id"])

    assert set(report) == REPORT_FIELDS
    assert isinstance(report["report_id"], str) and report["report_id"].startswith("rpt_")
    # C-RUN@1：object_id / validation_profile 都是 minLength>=1。
    assert isinstance(report["object_id"], str) and report["object_id"]
    assert report["validation_profile"] == PROFILE_IDS[template_id]
    assert isinstance(report["is_stale"], bool)
    assert report["created_at"].endswith("Z")
    assert set(report["summary"]) == {"pass", "fail", "not_covered"}

    for item in report["items"]:
        assert set(item) == ITEM_FIELDS
        assert item["status"] in {"pass", "fail", "not_covered", "stale"}
        assert isinstance(item["title"], str) and item["title"]
        # expected 来自独立实现、actual 来自内核，二者必须是可读字符串（R11-AC1）。
        assert isinstance(item["expected"], str)
        assert isinstance(item["actual"], str)
        assert item["detail"] is None or isinstance(item["detail"], str)


def test_summary_counts_match_items(load_golden: Any) -> None:
    """summary 的三计数必须与 items 逐状态计数一致（§2.2.2 语义）。"""

    report = _report(load_golden, "matrix_2d", "mx_singular")
    summary = report["summary"]
    for status, key in (("pass", "pass"), ("fail", "fail"), ("not_covered", "not_covered")):
        assert summary[key] == sum(1 for item in report["items"] if item["status"] == status)
    assert summary["pass"] + summary["fail"] + summary["not_covered"] == len(report["items"])
    assert has_failure(report) is False
    assert is_passing(report) is True


@pytest.mark.parametrize("template_id", list(PROFILE_IDS))
def test_check_ids_are_the_single_source_of_truth(load_golden: Any, template_id: str) -> None:
    """实现产出的 check_id 必须与 ``CHECK_IDS`` 完全一致（防止文档与实现漂移）。"""

    report = _report(load_golden, template_id, load_golden(template_id)["cases"][0]["id"])
    assert [item["check_id"] for item in report["items"]] == list(CHECK_IDS[template_id])
    assert len(set(CHECK_IDS[template_id])) == len(CHECK_IDS[template_id])


def test_not_covered_items_are_explicit(load_golden: Any) -> None:
    """未覆盖项必须显式列出，不得静默忽略（R11-AC2）。"""

    report = _report(load_golden, "matrix_2d", "mx_basic")
    not_covered = {
        item["check_id"] for item in report["items"] if item["status"] == "not_covered"
    }
    assert not_covered == {"mx_ellipse", "mx_scope", "mx_composition"}
    for item in report["items"]:
        if item["status"] == "not_covered":
            assert item["detail"]


# ---------------------------------------------------------------------------
# 2. is_stale
# ---------------------------------------------------------------------------


def test_is_stale_when_object_moved_forward(load_golden: Any) -> None:
    """对象 revision 领先 → is_stale=True，且 stale 不计入 summary（C-04）。"""

    case = _case(load_golden, "matrix_2d", "mx_basic")
    result = _result("matrix_2d", case["input"])
    fresh = build_report_for_template(
        "matrix_2d", result, case["input"], model_version=2, revision=7
    )
    assert fresh["is_stale"] is False

    stale = build_report_for_template(
        "matrix_2d",
        result,
        case["input"],
        model_version=2,
        revision=7,
        current_revision=8,
    )
    assert stale["is_stale"] is True
    assert set(stale["summary"]) == {"pass", "fail", "not_covered"}
    assert sum(stale["summary"].values()) == len(stale["items"])
    # 过期报告不得被当成通过（R10-AC7）。
    assert is_passing(stale) is False

    newer_model = build_report_for_template(
        "matrix_2d",
        result,
        case["input"],
        model_version=2,
        revision=7,
        current_model_version=3,
    )
    assert newer_model["is_stale"] is True


def test_build_report_uses_object_current_version(load_golden: Any, repo_root: Any) -> None:
    """``build_report`` 默认以 object 的版本判定 stale；显式 kwargs 可覆盖。"""

    object_json = _load_example(repo_root, "matrix_2d")
    result = _result("matrix_2d", {"matrix": [[1, 1], [0, 1]], "vector": [1, 1]})

    report = build_report(object_json, result, model_version=1, revision=0)
    assert report["is_stale"] is False
    assert report["object_id"] == object_json["object_id"]
    assert report["kernel_version"] == "linear_v1"

    stale = build_report(
        object_json, result, model_version=1, revision=0, current_revision=1
    )
    assert stale["is_stale"] is True


# ---------------------------------------------------------------------------
# 3. 能发现内核错误（核心证据）
# ---------------------------------------------------------------------------


def test_detects_wrong_ax_value(load_golden: Any) -> None:
    """Ax 被改 1e-6 → fail，detail 写出期望/实际。"""

    case = _case(load_golden, "matrix_2d", "mx_basic")
    result = copy.deepcopy(_result("matrix_2d", case["input"]))
    result["ax"] = [2.000001, 1.0]

    report = build_report_for_template("matrix_2d", result, case["input"])
    failures = _failure_items(report)
    assert [item["check_id"] for item in failures] == ["mx_ax_value"]
    assert "2.0" in failures[0]["expected"]
    assert "2.000001" in failures[0]["actual"]
    assert failures[0]["detail"]


def test_detects_forged_inverse_for_singular_matrix(load_golden: Any) -> None:
    """奇异矩阵返回逆矩阵（伪造）→ fail（R6-AC10）。"""

    case = _case(load_golden, "matrix_2d", "mx_singular")
    result = copy.deepcopy(_result("matrix_2d", case["input"]))
    result["inverse"] = [[1.0, 0.0], [0.0, 1.0]]

    report = build_report_for_template("matrix_2d", result, case["input"])
    failures = {item["check_id"]: item for item in _failure_items(report)}
    assert "mx_inverse_value" in failures
    assert "伪造" in (failures["mx_inverse_value"]["detail"] or "")


def test_detects_broken_steps_consistency(load_golden: Any) -> None:
    """steps 的 partial 与数值表不一致 → fail（R6-AC9）。"""

    case = _case(load_golden, "matrix_2d", "mx_basic")
    result = copy.deepcopy(_result("matrix_2d", case["input"]))
    result["steps"][1]["partial"] = [2, 1]  # 抄成 result，与 C-11 的第一项部分和不同

    report = build_report_for_template("matrix_2d", result, case["input"])
    failures = {item["check_id"]: item for item in _failure_items(report)}
    assert "mx_steps_consistency" in failures
    assert "partial" in (failures["mx_steps_consistency"]["detail"] or "")


def test_detects_zero_direction_when_cancelled(load_golden: Any) -> None:
    """抵消却输出 0° → fail（R7-AC3 禁止 0° 或 NaN）。"""

    case = _case(load_golden, "force_2d", "fc_cancel")
    result = copy.deepcopy(_result("force_2d", case["input"]))
    result["direction_deg"] = 0.0
    result["direction_defined"] = True

    report = build_report_for_template("force_2d", result, case["input"])
    failures = {item["check_id"]: item for item in _failure_items(report)}
    assert {"fc_direction_value", "fc_direction_undefined"} <= set(failures)


def test_detects_duplicate_enqueue(load_golden: Any) -> None:
    """D 被重复入队 → fail（R8-AC2）。"""

    case = _case(load_golden, "bfs_flow", "bfs_golden")
    result = copy.deepcopy(_result("bfs_flow", case["input"]))
    result["enqueue_order"] = ["A", "B", "C", "D", "D"]

    report = build_report_for_template("bfs_flow", result, case["input"])
    failures = {item["check_id"]: item for item in _failure_items(report)}
    assert "bfs_enqueue_once" in failures
    assert "重复入队" in (failures["bfs_enqueue_once"]["detail"] or "")


def test_detects_float_amount(load_golden: Any) -> None:
    """金额用二进制浮点输出 → fail（R9-AC3）。"""

    case = _case(load_golden, "budget_compare", "bd_n80")
    result = copy.deepcopy(_result("budget_compare", case["input"]))
    result["scenarios"][0]["total"] = 9400.0

    report = build_report_for_template("budget_compare", result, case["input"])
    failures = {item["check_id"]: item for item in _failure_items(report)}
    assert "bd_totals" in failures
    assert "十进制字符串" in (failures["bd_totals"]["detail"] or "")


def test_detects_remaining_when_no_limit(load_golden: Any) -> None:
    """未设上限却返回余量 → fail（R9-AC5）。"""

    case = _case(load_golden, "budget_compare", "bd_n80")
    result = copy.deepcopy(_result("budget_compare", case["input"]))
    result["remaining"] = ["600.00", "0.00"]
    result["over_budget"] = [False, False]

    report = build_report_for_template("budget_compare", result, case["input"])
    failures = {item["check_id"]: item for item in _failure_items(report)}
    assert {"bd_remaining", "bd_no_limit"} <= set(failures)


def test_detects_unvisited_node_marked_visited(load_golden: Any) -> None:
    """不可达节点被伪造为已访问 → fail（R8-AC4）。"""

    case = _case(load_golden, "bfs_flow", "bfs_unreachable")
    result = copy.deepcopy(_result("bfs_flow", case["input"]))
    result["order"] = ["A", "B", "C"]
    result["visited"] = ["A", "B", "C"]
    result["unvisited"] = []

    report = build_report_for_template("bfs_flow", result, case["input"])
    failures = {item["check_id"] for item in _failure_items(report)}
    assert {"bfs_order", "bfs_unvisited", "bfs_terminated"} <= failures


def test_boundary_delta_passes_with_detail(load_golden: Any) -> None:
    """差值落在容差边界附近：仍判 pass，但 detail 提示（契约无 warn 状态，C-T9-01）。"""

    case = _case(load_golden, "matrix_2d", "mx_basic")
    result = copy.deepcopy(_result("matrix_2d", case["input"]))
    delta = TOLERANCE * (BOUNDARY_RATIO + 0.5)
    result["ax"] = [2.0 + delta, 1.0]

    report = build_report_for_template("matrix_2d", result, case["input"])
    item = next(item for item in report["items"] if item["check_id"] == "mx_ax_value")
    assert item["status"] == "pass"
    assert "贴近容差边界" in (item["detail"] or "")


# ---------------------------------------------------------------------------
# 4. build_report(object_json) 走 C-KO@1 提取
# ---------------------------------------------------------------------------


def _load_example(repo_root: Any, template_id: str) -> dict[str, Any]:
    path = repo_root / "fixtures" / "examples" / f"{template_id}.json"
    import json

    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def test_build_report_extracts_inputs_from_example_objects(repo_root: Any) -> None:
    """四个示例对象都能被提取成模板输入，并与内核结果一致（T10 的使用路径）。"""

    matrix = _load_example(repo_root, "matrix_2d")
    matrix_result = compose_matrices(
        [[1, 1], [0, 1]], [[1, 0], [1, 1]], [1, 1], "A_then_B"
    )
    report = build_report(matrix, matrix_result, matrix["model_version"], matrix["revision"])
    assert report["summary"]["fail"] == 0
    assert report["validation_profile"] == "matrix_2d_v1_full"

    force = _load_example(repo_root, "force_2d")
    force_result = force_resultant(
        [{"magnitude": "10", "angle_deg": 0}, {"magnitude": "10", "angle_deg": 90}], 2, 6
    )
    report = build_report(force, force_result, force["model_version"], force["revision"])
    assert report["summary"]["fail"] == 0

    bfs = _load_example(repo_root, "bfs_flow")
    graph = bfs["parameters"][0]["value"]
    bfs_result = bfs_run(
        graph["nodes"], graph["edges"], start=bfs["config"]["start_node_id"]
    )
    report = build_report(bfs, bfs_result, bfs["model_version"], bfs["revision"])
    assert report["summary"]["fail"] == 0

    budget = _load_example(repo_root, "budget_compare")
    budget_result = budget_compare(
        {
            "plan_a": {"fixed": "3000", "per_unit": "80"},
            "plan_b": {"fixed": "6000", "per_unit": "50"},
        },
        80,
        10000,
    )
    report = build_report(budget, budget_result, budget["model_version"], budget["revision"])
    assert report["summary"]["fail"] == 0
    assert report["is_stale"] is False


def test_budget_coefficient_extraction_detects_wrong_total(repo_root: Any) -> None:
    """系数形态的独立复核也能发现总额错误（C-06：示例对象不携带 AST）。"""

    budget = _load_example(repo_root, "budget_compare")
    result = budget_compare(
        {
            "plan_a": {"fixed": "3000", "per_unit": "80"},
            "plan_b": {"fixed": "6000", "per_unit": "50"},
        },
        80,
        10000,
    )
    result["scenarios"][1]["total"] = "10001.00"
    report = build_report(budget, result, budget["model_version"], budget["revision"])
    failures = {item["check_id"] for item in _failure_items(report)}
    assert "bd_totals" in failures


# ---------------------------------------------------------------------------
# 5. 错误路径与不可变性
# ---------------------------------------------------------------------------


def test_profile_mismatch_is_rejected(load_golden: Any) -> None:
    """profile 与模板不匹配时必须拒绝（C-RUN@1 validation_profile 语义）。"""

    case = _case(load_golden, "matrix_2d", "mx_basic")
    result = _result("matrix_2d", case["input"])
    with pytest.raises(InputProblem) as excinfo:
        build_report_for_template(
            "matrix_2d", result, case["input"], validation_profile="force_2d_v1_full"
        )
    assert excinfo.value.code == "MISSING_FIELD"
    assert excinfo.value.field == "validation_profile"


def test_unsupported_template_is_rejected(load_golden: Any) -> None:
    with pytest.raises(InputProblem) as excinfo:
        build_report_for_template("unknown_2d", {}, {})
    assert excinfo.value.code == "UNSUPPORTED_TEMPLATE"


def test_build_error_report_accepts_matching_kernel_error(load_golden: Any) -> None:
    """独立实现同样判定为循环依赖 → pass（错误码与 field 一致）。"""

    case = _case(load_golden, "budget_compare", "bd_cycle")
    kernel_error = {
        "code": "MISSING_FIELD",
        "message": "命名表达式 plan_a 存在循环依赖",
        "field": "plan_a",
    }
    report = build_error_report("budget_compare", case["input"], kernel_error)
    assert report["summary"]["fail"] == 0
    assert [item["check_id"] for item in report["items"]] == ["input_validity"]
    assert report["items"][0]["status"] == "pass"


def test_build_error_report_detects_over_rejection(load_golden: Any) -> None:
    """内核拒绝了一份独立实现认为合法的输入 → fail（过度拒绝）。"""

    case = _case(load_golden, "budget_compare", "bd_n80")
    kernel_error = {"code": "MISSING_FIELD", "message": "人数越界", "field": "people"}
    report = build_error_report("budget_compare", case["input"], kernel_error)
    assert report["summary"]["fail"] == 1
    assert "过度拒绝" in (report["items"][0]["detail"] or "")


def test_cycle_input_raises_independent_problem(load_golden: Any) -> None:
    """直接把非法输入交给正常报告路径时，独立实现抛出契约错误（不进入无限递归）。"""

    case = _case(load_golden, "budget_compare", "bd_cycle")
    with pytest.raises(InputProblem) as excinfo:
        build_report_for_template("budget_compare", {}, case["input"])
    assert excinfo.value.code == "MISSING_FIELD"
    assert "循环依赖" in excinfo.value.message


@pytest.mark.parametrize("template_id", list(PROFILE_IDS))
def test_report_does_not_mutate_inputs(load_golden: Any, template_id: str) -> None:
    """校验器只读：入参与内核结果前后必须完全一致。"""

    case = _case(load_golden, template_id, load_golden(template_id)["cases"][0]["id"])
    parameters = copy.deepcopy(case["input"])
    result = _result(template_id, parameters)
    snapshot_parameters = copy.deepcopy(parameters)
    snapshot_result = copy.deepcopy(result)

    build_report_for_template(template_id, result, parameters)

    assert parameters == snapshot_parameters
    assert result == snapshot_result


def test_compose_order_b_then_a_is_reflected(load_golden: Any) -> None:
    """``compose_order=B_then_A`` 只影响 order 回显，不应被判 fail。"""

    case = _case(load_golden, "matrix_2d", "mx_noncommute")
    parameters = dict(case["input"], compose_order="B_then_A")
    result = compose_matrices(
        parameters["matrix"],
        parameters["second_matrix"],
        parameters["vector"],
        "B_then_A",
    )
    report = build_report_for_template("matrix_2d", result, parameters)
    assert report["summary"]["fail"] == 0
    composition = next(
        item for item in report["items"] if item["check_id"] == "mx_composition"
    )
    assert composition["status"] == "pass"


def test_non_cancel_note_wording_is_not_contractual(load_golden: Any) -> None:
    """非抵消时的 note 措辞不在契约内，只要求非空（C-T9-07）。"""

    case = _case(load_golden, "force_2d", "fc_perpendicular")
    result = copy.deepcopy(_result("force_2d", case["input"]))
    result["note"] = "合力 = 14.14 N（按矢量合成）"

    report = build_report_for_template("force_2d", result, case["input"])
    assert report["summary"]["fail"] == 0


def test_invalid_result_type_is_rejected(load_golden: Any) -> None:
    """``result`` 不是内核返回对象时必须给出契约错误，而不是崩溃。"""

    case = _case(load_golden, "matrix_2d", "mx_basic")
    with pytest.raises(InputProblem) as excinfo:
        build_report_for_template("matrix_2d", ["not", "a", "mapping"], case["input"])
    assert excinfo.value.code == "MISSING_FIELD"
    assert excinfo.value.field == "result"


def test_check_ids_total_count() -> None:
    """四个 profile 共 38 条检查项，且每个模板的 id 集合与 profile 一一对应。"""

    assert set(CHECK_IDS) == set(PROFILE_IDS)
    assert sum(len(ids) for ids in CHECK_IDS.values()) == 38
