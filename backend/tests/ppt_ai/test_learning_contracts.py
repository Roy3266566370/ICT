"""T01/T04：学习契约、显式解与分支用途。"""

from __future__ import annotations

import math

import pytest

from app.ppt_ai.contracts import ContractError, validate_contract
from app.ppt_ai.learning_types import (
    LEARNING_CONTRACT_VERSION,
    LearningActionDraft,
    LearningCapabilities,
    LearningContext,
    LearningControl,
    LearningDescriptor,
    LearningItem,
    LearningPage,
    LearningReply,
    LearningResultCard,
    LearningSourceRef,
    LearningSuggestedAction,
    LearningVerification,
)
from app.ppt_ai.types import BBox, TargetSolution


def _context(**overrides) -> LearningContext:
    payload = {
        "document_revision": 3,
        "source_hash": "a" * 64,
        "bundle_id": "bun_1",
        "bundle_revision": 2,
        "page_no": 6,
        "node_id": "ain_1",
        "region_id": "reg_1",
        "branch_id": "brn_1",
        "branch_revision": 4,
        "draft_revision": 2,
        "client_request_id": "req_1",
        "input_values": {"a11": 2.0, "a12": 1.0},
        "input_hash": None,
    }
    payload.update(overrides)
    return LearningContext.model_validate(payload)


def _descriptor() -> LearningDescriptor:
    ref = LearningSourceRef(
        material_id="mat_1",
        page_no=6,
        node_id="ain_1",
        region_id="reg_1",
        element_id="e1",
        bbox=BBox(x=0.1, y=0.1, w=0.3, h=0.2),
        excerpt="A = [[2,1],[1,2]]",
        semantic_content_hash="b" * 64,
    )
    return LearningDescriptor(
        goal_id="eigen_direction",
        title="特征方向",
        objective="改变向量，观察 Av 是否与 v 共线。",
        source_refs=[ref],
        template_id="matrix.eigen_probe",
        bindings={"matrix.a11": "concept_a11", "vector.v1": "concept_v1"},
        fixed_roles=["matrix"],
        editable_roles=["vector"],
        controls=[
            LearningControl(
                concept_id="concept_v1",
                label="v1",
                role="editable",
                min=-5,
                max=5,
                step=0.1,
            )
        ],
        suggested_actions=[
            LearningSuggestedAction(
                action_type="explain", label="为什么倍率是 3？", question="为什么 v=(1,1) 的倍率是 3？"
            )
        ],
    )


def test_learning_contract_version_and_descriptor_schema() -> None:
    descriptor = _descriptor()
    assert descriptor.contract_version == LEARNING_CONTRACT_VERSION
    validate_contract("learning", descriptor.model_dump(mode="json"))


def test_learning_page_and_reply_schema() -> None:
    descriptor = _descriptor()
    item = LearningItem(
        item_id="item_1",
        node_id="ain_1",
        region_id="reg_1",
        title=descriptor.title,
        state="ready",
        support_status="supported",
        descriptor=descriptor,
        baseline_values={"a11": 2.0},
        explanation_ready=True,
        experiment_ready=True,
    )
    page = LearningPage(
        material_id="mat_1",
        page_no=6,
        document_revision=3,
        source_hash="a" * 64,
        bundle_id="bun_1",
        bundle_revision=2,
        branch_id="brn_1",
        branch_revision=4,
        branch_kind="baseline",
        state="ready",
        items=[item],
        pending_task_id=None,
        capabilities=LearningCapabilities(can_explain_online=True, can_ask_online=True, can_save_cloud=True, can_manage=True),
        note="",
        generated_at="2026-11-08T00:00:00Z",
    )
    validate_contract("learning", page.model_dump(mode="json"))
    solution = TargetSolution(
        unknowns=["v1", "v2"],
        values=[3.0, 1.0],
        classification="unique",
        exact_values=["3", "1"],
        equations=["2·v1 + 1·v2 = 7", "1·v1 + 2·v2 = 5"],
        verification=[{"label": "代回第 1 行", "expected": "7", "actual": "7", "residual": 0.0, "status": "pass"}],
    )
    card = LearningResultCard(
        card_id="card_1",
        title="逆映射答案",
        conclusion="v=(3,1)。",
        solution=solution,
        steps=["由 A 可逆，直接解方程。"],
        verification=[LearningVerification(label="代回第 1 行", expected="7", actual="7", residual=0.0, status="pass")],
        source_refs=[descriptor.source_refs[0]],
        scope={"atol": 1e-8, "rtol": 1e-6},
        limitations=[],
        next_actions=["用图验证"],
        input_hash="c" * 64,
        request_hash="d" * 64,
        task_id="task_1",
        result_kind="target",
    )
    validate_contract("learning", card.model_dump(mode="json"))
    reply = LearningReply(
        reply_id="reply_1",
        material_id="mat_1",
        page_no=6,
        node_id="ain_1",
        branch_id="brn_1",
        client_request_id="req_1",
        draft_revision=2,
        input_hash="c" * 64,
        request_hash="d" * 64,
        state="action_ready",
        action_draft=LearningActionDraft(
            action_id="act_1",
            kind="solve_target",
            context=_context(),
            summary="求解 v",
            conditions=[],
            added_conditions=[],
            execution_payload={"node_id": "ain_1"},
            created_at="2026-11-08T00:00:00Z",
        ),
        task_id="task_1",
    )
    validate_contract("learning", reply.model_dump(mode="json"))


def test_learning_rejects_unknown_action_and_non_finite_numbers() -> None:
    payload = _descriptor().model_dump(mode="json")
    payload["suggested_actions"][0]["action_type"] = "patch_canvas"
    with pytest.raises(ContractError):
        validate_contract("learning", payload)
    with pytest.raises(ValueError):
        LearningContext.model_validate({**_context().model_dump(), "input_values": {"a11": math.nan}})


def test_old_node_without_learning_is_readable() -> None:
    from app.ppt_ai.types import CompiledNode, PlanParameter, Provenance, SourceAnchor

    anchor = SourceAnchor(
        material_id="mat_1",
        page=1,
        bbox=BBox(x=0, y=0, w=0.2, h=0.2),
        semantic_content_hash="e" * 64,
    )
    node = CompiledNode(
        node_id="ain_old",
        option_id="opt_old",
        region_id="reg_old",
        operator_id="matrix.transform",
        title="旧节点",
        parameters=[
            PlanParameter(
                concept_id="concept_a11",
                id="a11",
                label="a11",
                default=1.0,
                min=-5,
                max=5,
                step=0.1,
                source=anchor,
                provenance=Provenance(origin_type="native", evidence="1"),
            )
        ],
        source=anchor,
    )
    assert node.learning is None
    assert node.model_dump(mode="json")["learning"] is None
