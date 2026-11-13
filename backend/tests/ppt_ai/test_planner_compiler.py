"""T04/T05：规划、能力注册、编译、求值与黄金用例。"""

from __future__ import annotations

import pytest

from app.ppt_ai.compiler import CompileStaleError, compile_plan
from app.ppt_ai.evaluation import default_values, evaluate_model, evaluate_node
from app.ppt_ai.types import FrozenContext, TargetRequest, CallBudget
from app.ppt_ai.registry import REGISTRY
from app.ppt_ai.targets import solve_target
from tests.ppt_ai import helpers


def test_integral_plan_compiles_to_real_calculus_node() -> None:
    extraction, plan = helpers.plan_for(helpers.integral_snapshot())
    integral = next(option for option in plan.options if option.operator_id == "lab.calculus.integral")
    assert integral.support_status == "needs_review"
    assert any(item.kind == "initial_value" for item in integral.review_items)
    bundle = compile_plan(
        plan,
        REGISTRY,
        bundle_revision=1,
        selected_option_ids=[integral.option_id],
        snapshot=helpers.integral_snapshot(),
    )
    node = helpers.node_of(bundle, "calculus.integral")
    evaluation = evaluate_node(node, {parameter.concept_id: parameter.default for parameter in node.parameters})
    assert evaluation["result"]["subject"] == "calculus"
    assert evaluation["result"]["exact"] == pytest.approx(0.6931471805599453, abs=1e-8)
    assert len(evaluation["result"]["series"]) > 100
    assert not evaluation["violations"]
    assert bundle.compiled.ispecs


def test_chart_and_table_use_source_values() -> None:
    snap = helpers.snapshot(
        "mat_chart_table",
        pages=[
            {
                "page_no": 1,
                "width": helpers.PAGE_W,
                "height": helpers.PAGE_H,
                "elements": [
                    helpers.element(
                        "chart",
                        "chart",
                        chart_data={"categories": ["A", "B"], "series": [{"name": "s", "values": [3, 5]}], "title": "t"},
                    ),
                    helpers.element(
                        "table",
                        "table",
                        text="x | y\n1 | 2",
                        table_data={"headers": ["x", "y"], "rows": [["1", "2"]]},
                        bbox=(6000000, 100000, 4000000, 2000000),
                    ),
                ],
            }
        ],
    )
    _extraction, plan, bundle = helpers.bundle_for(snap)
    chart = helpers.node_of(bundle, "native.chart")
    table = helpers.node_of(bundle, "native.table")
    chart_values = {parameter.concept_id: "全部" for parameter in chart.parameters}
    chart_result = evaluate_node(chart, chart_values)["result"]
    assert [row[2] for row in chart_result["rows"]] == [3, 5]
    table_result = evaluate_node(table, {parameter.concept_id: "全部" for parameter in table.parameters})["result"]
    assert table_result["headers"] == ["x", "y"]
    assert table_result["rows"] == [["1", "2"]]


def test_stale_plan_is_rejected() -> None:
    snap = helpers.integral_snapshot()
    _extraction, plan = helpers.plan_for(snap)
    changed = snap.model_copy(update={"document_revision": 1, "source_hash": "f" * 64})
    with pytest.raises(CompileStaleError):
        compile_plan(
            plan,
            REGISTRY,
            bundle_revision=1,
            selected_option_ids=[plan.options[0].option_id],
            snapshot=changed,
        )


def test_parameter_range_override_is_applied() -> None:
    snap = helpers.integral_snapshot()
    _extraction, plan = helpers.plan_for(snap)
    option = plan.options[0]
    bundle = compile_plan(
        plan,
        REGISTRY,
        bundle_revision=1,
        selected_option_ids=[option.option_id],
        parameter_overrides={option.option_id: {"upper": {"value": 2, "min": 0, "max": 4}}},
        snapshot=snap,
    )
    node = bundle.compiled.nodes[0]
    upper = next(parameter for parameter in node.parameters if parameter.id == "upper")
    assert upper.min == 0 and upper.max == 4
    assert upper.default == 2
    assert upper.provenance.origin_type == "user_input"
    assert upper.provenance.user_checks


def test_default_value_and_target_x_squared() -> None:
    _extraction, plan, bundle = helpers.bundle_for(helpers.expression_snapshot())
    node = helpers.node_of(bundle, "expression")
    x_concept = next(parameter.concept_id for parameter in node.parameters if parameter.id == "x")
    context = FrozenContext(
        bundle_id=bundle.bundle_id,
        bundle_revision=1,
        branch_id="brn_test",
        branch_revision=1,
        values=default_values(bundle),
        evaluation_hash="a" * 64,
    )
    request = TargetRequest(
        node_id=node.node_id,
        output="value",
        target_value=4,
        variables=[x_concept],
        ranges={x_concept: [0, 3]},
        tolerance=1e-6,
        operation_id="op_target",
    )
    result = solve_target(request, context, bundle=bundle)
    assert result.status == "found"
    assert result.candidates[0].values[x_concept] == pytest.approx(2.0, abs=1e-5)
    assert result.residual is not None and result.residual < 1e-4


def test_cross_page_shared_value_follows_one_branch() -> None:
    # 同一概念的共享值由 graph/branch 统一；不同 concept_id 不自动合并。
    _extraction, plan, bundle = helpers.bundle_for(helpers.expression_snapshot())
    node = bundle.compiled.nodes[0]
    concept = node.parameters[0].concept_id
    values = {**default_values(bundle), concept: 2}
    snapshot = evaluate_model(bundle, values)
    assert snapshot.derived[node.node_id]["value"] == pytest.approx(4.0)


def test_no_sample_value_is_hardcoded_for_stranger_material() -> None:
    snap = helpers.snapshot(
        "mat_stranger_formula",
        hash_char="9",
        pages=[
            {
                "page_no": 3,
                "width": helpers.PAGE_W,
                "height": helpers.PAGE_H,
                "elements": [helpers.element("z", "text", text="求 ∫_2^5 3/(t+1) dt")],
            }
        ],
    )
    _extraction, plan = helpers.plan_for(snap)
    option = plan.options[0]
    assert option.operator_id == "lab.calculus.integral"
    lowered = next(parameter for parameter in option.parameters if parameter.id == "lower")
    assert lowered.default == 2
    assert lowered.provenance.origin_type == "native"


def test_user_confirmation_clears_blocking_review_items() -> None:
    snap = helpers.integral_snapshot()
    _extraction, plan = helpers.plan_for(snap)
    option = plan.options[0]
    assert option.support_status == "needs_review"
    bundle = compile_plan(
        plan,
        REGISTRY,
        bundle_revision=1,
        selected_option_ids=[option.option_id],
        confirmed_option_ids=[option.option_id],
        snapshot=snap,
    )
    compiled_option = bundle.plans[0].options[0]
    assert compiled_option.support_status == "supported"
    assert all(item.answer == "用户已核对" for item in compiled_option.review_items if not item.required)
