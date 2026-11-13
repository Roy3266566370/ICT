"""条件层与混合匹配：单位、缺失、模型冲突、弃权与目录完整性。"""

from __future__ import annotations

import pytest

from app.ppt_ai.compiler import compile_plan
from app.ppt_ai.conditions import extract_conditions
from app.ppt_ai.matching import recall_candidates, resolve_match
from app.ppt_ai.planner import plan_interactions
from app.ppt_ai.registry import REGISTRY
from app.ppt_ai.recognition_types import (
    ModelCandidateProposal,
    ModelParameterProposal,
    ModelProposal,
    TemplateDescriptor,
)
from app.ppt_ai.template_packs import TEMPLATE_CATALOG, TEMPLATES_BY_ID, TemplateCatalogError, validate_templates
from app.ppt_ai.types import CallBudget
from tests.ppt_ai import helpers


def _text_snapshot(text: str):
    return helpers.snapshot(
        "mat_text",
        hash_char="8",
        pages=[
            {
                "page_no": 1,
                "width": helpers.PAGE_W,
                "height": helpers.PAGE_H,
                "elements": [helpers.element("e1", "text", text=text)],
            }
        ],
    )


def _condition_set(text: str):
    snapshot = _text_snapshot(text)
    from app.ppt_ai.regions import extract_regions

    extraction = extract_regions(snapshot)
    conditions = extract_conditions(snapshot, extraction.regions)
    assert len(conditions) == 1
    return snapshot, conditions[0]


def test_projectile_unit_is_normalized_and_option_carries_template_ref() -> None:
    snap, condition_set = _condition_set(
        "抛体运动：初速度 v0 = 36 km/h，仰角 30°，g = 9.8 m/s^2，t = 1 s。"
    )
    v0 = next(condition for condition in condition_set.conditions if condition.key == "v0")
    assert v0.normalized_value == pytest.approx(10.0)
    assert v0.normalized_unit == "m/s"
    assert "36" in v0.raw_value
    from app.ppt_ai.regions import extract_regions

    extraction = extract_regions(snap)
    plan = plan_interactions(extraction, snap, budget=CallBudget(max_calls=0), client=None)
    option = plan.options[0]
    assert option.operator_id == "physics.projectile"
    assert option.provider["template_ref"] == {"id": "physics.projectile", "version": "1.0", "adapter_version": "1"}
    assert option.provider["parameters"]["v0"] == pytest.approx(10.0)
    assert option.support_status == "supported"


def test_missing_required_condition_blocks_auto_execution() -> None:
    _snap, condition_set = _condition_set("用泰勒多项式近似 f(x) = cos(x)，展开点 x0 = 0。")
    candidates = recall_candidates(condition_set, TEMPLATE_CATALOG)
    decision = resolve_match(condition_set, candidates, None, TEMPLATES_BY_ID)
    assert decision.template_ref.id == "calculus.taylor"
    assert decision.status == "needs_review"
    assert "order" in decision.missing
    assert any("阶数" in item or "order" in item for item in decision.missing)


def test_model_value_must_match_source_evidence() -> None:
    _snap, condition_set = _condition_set(
        "抛体运动：初速度 v0 = 0.1 m/s，仰角 45°，g = 9.8 m/s^2，t = 1 s。"
    )
    candidates = recall_candidates(condition_set, TEMPLATE_CATALOG)
    v0_condition = next(condition for condition in condition_set.conditions if condition.key == "v0")
    proposal = ModelProposal(
        region_id=condition_set.region_id,
        candidates=[
            ModelCandidateProposal(
                template_ref=TEMPLATES_BY_ID["physics.projectile"].ref,
                parameters=[
                    ModelParameterProposal(
                        name="v0",
                        value=1.0,
                        source_condition_id=v0_condition.condition_id,
                        origin_type="native",
                    )
                ],
                rationale="模型读成 1 m/s",
            )
        ],
    )
    decision = resolve_match(condition_set, candidates, proposal, TEMPLATES_BY_ID)
    assert decision.status == "needs_review"
    assert decision.parameters["v0"] == pytest.approx(0.1)
    assert any("0.1" in item and "1.0" in item for item in decision.conflicts)


def test_confirmation_cannot_bypass_missing_required_condition() -> None:
    snap = _text_snapshot("抛体运动：初速度未知，仰角 45°，求轨迹。")
    from app.ppt_ai.regions import extract_regions

    extraction = extract_regions(snap)
    plan = plan_interactions(extraction, snap, budget=CallBudget(max_calls=0), client=None)
    option = next(item for item in plan.options if item.operator_id == "physics.projectile")
    assert option.support_status == "needs_review"
    assert any(item.blocking for item in option.review_items)
    bundle = compile_plan(
        plan,
        REGISTRY,
        bundle_revision=1,
        selected_option_ids=[option.option_id],
        confirmed_option_ids=[option.option_id],
        snapshot=snap,
    )
    assert bundle.compiled.nodes == []
    assert any("阻塞条件" in str(check.get("message")) for check in bundle.compiled.checks)


def test_parameter_override_unlocks_missing_required_value() -> None:
    snap = _text_snapshot("抛体运动：初速度未知，仰角 45°，求轨迹。")
    from app.ppt_ai.regions import extract_regions

    extraction = extract_regions(snap)
    plan = plan_interactions(extraction, snap, budget=CallBudget(max_calls=0), client=None)
    option = next(item for item in plan.options if item.operator_id == "physics.projectile")
    bundle = compile_plan(
        plan,
        REGISTRY,
        bundle_revision=1,
        selected_option_ids=[option.option_id],
        parameter_overrides={option.option_id: {"v0": 5}},
        snapshot=snap,
    )
    assert len(bundle.compiled.nodes) == 1
    assert bundle.compiled.nodes[0].parameters[0].default == 5


def test_model_cannot_select_template_outside_recall() -> None:
    _snap, condition_set = _condition_set(
        "抛体运动：初速度 v0 = 10 m/s，仰角 30°，g = 9.8 m/s^2，t = 1 s。"
    )
    candidates = recall_candidates(condition_set, TEMPLATE_CATALOG)
    proposal = ModelProposal(
        region_id=condition_set.region_id,
        candidates=[
            ModelCandidateProposal(
                template_ref=TEMPLATES_BY_ID["calculus.taylor"].ref,
                rationale="强行匹配",
            )
        ],
    )
    decision = resolve_match(condition_set, candidates, proposal, TEMPLATES_BY_ID)
    assert decision.template_ref.id == "physics.projectile"
    assert decision.model_used is False


def test_negative_text_does_not_auto_execute() -> None:
    for text in ("课程安排：第一章 绪论；第二章 极限。", "牛顿法是一种迭代方法，队列是一种先进先出的数据结构。"):
        snap = _text_snapshot(text)
        from app.ppt_ai.regions import extract_regions

        extraction = extract_regions(snap)
        plan = plan_interactions(extraction, snap, budget=CallBudget(max_calls=0), client=None)
        assert all(not (option.support_status == "supported" and option.provider.get("template_ref")) for option in plan.options)


def test_catalog_rejects_duplicate_or_unknown_renderer() -> None:
    valid = TEMPLATE_CATALOG[0]
    duplicate = [
        valid,
        valid.model_copy(update={"version": "2.0"}),
    ]
    with pytest.raises(TemplateCatalogError):
        validate_templates(duplicate)

    bad_renderer = [valid.model_copy(update={"template_id": "calculus.unknown", "renderer": "not-registered"})]
    with pytest.raises(TemplateCatalogError):
        validate_templates(bad_renderer)

    bad_operator = [valid.model_copy(update={"template_id": "calculus.unknown", "operator_id": "not.registered"})]
    with pytest.raises(TemplateCatalogError):
        validate_templates(bad_operator)


def test_array_parameter_shape_is_enforced() -> None:
    from app.ppt_ai.planner import plan_interactions
    from app.ppt_ai.regions import extract_regions
    from app.ppt_ai.types import PlanParameter

    snap = _text_snapshot("单通道卷积：输入矩阵 [[1,2,3],[4,5,6],[7,8,9]]，卷积核 [[1,0,-1],[1,0,-1],[1,0,-1]]，步长 1，填充 0。")
    extraction = extract_regions(snap)
    plan = plan_interactions(extraction, snap, budget=CallBudget(max_calls=0), client=None)
    option = next(item for item in plan.options if item.operator_id == "deep_learning.conv_pool")
    matrix = next(parameter for parameter in option.parameters if parameter.id == "matrix")
    payload = matrix.model_dump(mode="python")
    payload["shape"] = [2, 2]
    with pytest.raises(ValueError):
        PlanParameter.model_validate(payload)
