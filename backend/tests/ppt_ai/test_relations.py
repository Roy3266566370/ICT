"""T06：跨页语义关系核对与新 bundle。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.ppt_ai.evaluation import evaluate_model
from app.ppt_ai.relations import (
    RelationCycleError,
    RelationConflict,
    apply_link_decisions,
    preview_link_decisions,
)
from app.ppt_ai.types import (
    InteractionBundle,
    LinkCandidate,
    LinkDecision,
    ParameterBinding,
)
from tests.ppt_ai import helpers

REPO_ROOT = Path(__file__).resolve().parents[3]
GOLDEN = REPO_ROOT / "fixtures" / "ppt-ai" / "linking" / "golden_bundle.json"


def _two_page_bundle():
    snap = helpers.snapshot(
        "mat_links",
        hash_char="1",
        pages=[
            {
                "page_no": 1,
                "width": helpers.PAGE_W,
                "height": helpers.PAGE_H,
                "elements": [helpers.element("e1", "text", text="∫_0^1 x dx")],
            },
            {
                "page_no": 2,
                "width": helpers.PAGE_W,
                "height": helpers.PAGE_H,
                "elements": [helpers.element("e2", "text", text="∫_0^2 x dx")],
            },
        ],
    )
    extraction, plan = helpers.plan_for(snap)
    assert len(plan.options) == 2
    from app.ppt_ai.compiler import compile_plan
    from app.ppt_ai.registry import REGISTRY

    bundle = compile_plan(
        plan,
        REGISTRY,
        bundle_revision=1,
        selected_option_ids=[option.option_id for option in plan.options],
        snapshot=snap,
    )
    return bundle


def test_candidates_are_not_auto_merged() -> None:
    bundle = _two_page_bundle()
    assert bundle.graph.candidates
    concept_ids = {node.concept_id for node in bundle.compiled.nodes[0].parameters}
    bundle2 = _two_page_bundle()
    assert concept_ids == {node.concept_id for node in bundle2.compiled.nodes[0].parameters}
    # 两个页面的概念仍然独立（候选不等同于确认）
    names = [node.name for node in bundle.graph.nodes]
    assert any(names.count(name) >= 2 for name in names)


def test_confirm_link_creates_new_immutable_bundle() -> None:
    bundle = _two_page_bundle()
    names = [node.name for node in bundle.graph.nodes]
    shared_name = next(name for name in names if names.count(name) >= 2)
    left = next(node for node in bundle.graph.nodes if node.name == shared_name)
    candidate = next(item for item in bundle.graph.candidates if left.concept_id in (item.left_concept_id, item.right_concept_id))
    decision = LinkDecision(candidate_id=candidate.candidate_id, decision="confirm", concept_id=left.concept_id, expected_graph_revision=bundle.graph.graph_revision)
    applied = apply_link_decisions(bundle, [decision])
    graph = applied.graph
    assert graph.graph_revision == bundle.graph.graph_revision + 1
    assert any(relation.type == "same_parameter" for relation in graph.relations)
    # 原 bundle 未被修改
    assert not bundle.graph.relations
    assert applied.bundle_id != bundle.bundle_id
    assert applied.bundle_revision == bundle.bundle_revision + 1
    assert applied.content_hash != bundle.content_hash
    assert len(applied.compiled.nodes) == len(bundle.compiled.nodes)


def test_split_keeps_concepts_separate() -> None:
    bundle = _two_page_bundle()
    candidate = bundle.graph.candidates[0]
    decision = LinkDecision(candidate_id=candidate.candidate_id, decision="split", note="同名异义")
    graph = apply_link_decisions(bundle, [decision]).graph
    assert any(item.get("decision") == "split" for item in graph.conflicts)
    assert not graph.relations


def _golden() -> InteractionBundle:
    return InteractionBundle.model_validate(
        json.loads(GOLDEN.read_text(encoding="utf-8"))
    )


def _free_page5(bundle: InteractionBundle) -> None:
    from app.ppt_ai.linking import dependency_order

    page5 = next(node for node in bundle.compiled.nodes if node.node_id == "ain_page5")
    page5.parameters[0].binding = ParameterBinding(mode="free", concept_id="")
    bundle.graph.relations = [
        relation
        for relation in bundle.graph.relations
        if relation.relation_id != "rel_1"
    ]
    order, _cycles = dependency_order(bundle.compiled.nodes)
    bundle.graph.dependency_order = order


def _derived_candidate(
    *,
    source_node: str,
    source_output: str,
    target_node: str,
    target_parameter: str,
    left: str,
    right: str,
) -> LinkCandidate:
    return LinkCandidate(
        candidate_id=f"lnk_{source_node}_{target_node}",
        left_concept_id=left,
        right_concept_id=right,
        concept_ids=[left, right],
        relation_type="derived_from",
        reason="输出与下游参数同名。",
        confidence=0.66,
        source_node_id=source_node,
        source_output=source_output,
        target_node_id=target_node,
        target_parameter_id=target_parameter,
    )


def test_derived_link_preview_and_apply_propagate_output() -> None:
    bundle = _golden()
    _free_page5(bundle)
    candidate = _derived_candidate(
        source_node="ain_page1",
        source_output="det",
        target_node="ain_page5",
        target_parameter="a11",
        left="out:ain_page1:det",
        right="cpt_p5_a11",
    )
    bundle.graph.candidates = [candidate]
    values = dict(bundle.seed_values)
    values["cpt_p5_a11"] = 2.0
    decision = LinkDecision(candidate_id=candidate.candidate_id, decision="confirm")
    preview = preview_link_decisions(bundle, [decision], values=values)
    assert preview["ok"] is True
    assert preview["cycles"] == []
    assert {item["page"] for item in preview["affected_nodes"]} >= {5, 9}
    assert preview["before"]["evaluation_hash"] != preview["after"]["evaluation_hash"]

    applied = apply_link_decisions(bundle, [decision])
    page5 = next(node for node in applied.compiled.nodes if node.node_id == "ain_page5")
    assert page5.parameters[0].binding.mode == "linked"
    assert page5.parameters[0].binding.concept_id == "out:ain_page1:det"
    evaluated = evaluate_model(applied, values)
    assert evaluated.derived_values["out:ain_page5:det"] == pytest.approx(6.0)
    assert evaluated.derived_values["out:ain_page9:det"] == pytest.approx(6.0)
    assert any(relation.type == "derived_from" for relation in applied.graph.relations)
    assert applied.graph.dependency_order == ["ain_page1", "ain_page5", "ain_page9"]


def test_cycle_is_rejected_at_confirmation() -> None:
    bundle = _golden()
    _free_page5(bundle)
    first = _derived_candidate(
        source_node="ain_page1",
        source_output="det",
        target_node="ain_page5",
        target_parameter="a11",
        left="out:ain_page1:det",
        right="cpt_p5_a11",
    )
    second = _derived_candidate(
        source_node="ain_page5",
        source_output="det",
        target_node="ain_page1",
        target_parameter="a11",
        left="out:ain_page5:det",
        right="cpt_p1_a11",
    )
    bundle.graph.candidates = [first, second]
    decisions = [
        LinkDecision(candidate_id=first.candidate_id, decision="confirm"),
        LinkDecision(candidate_id=second.candidate_id, decision="confirm"),
    ]
    preview = preview_link_decisions(bundle, decisions)
    assert preview["ok"] is False
    assert preview["cycle_nodes"]
    with pytest.raises(RelationCycleError):
        apply_link_decisions(bundle, decisions)
