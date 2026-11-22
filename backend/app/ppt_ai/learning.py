"""按页学习呈现投影与准备任务（``ppt-learning.1`` §5.2/§5.3）。

投影只读取已编译 bundle 与选定分支，不调用模型、不产生写副作用。学习描述优先
使用编译节点上的 ``learning`` 字段；旧节点没有该字段时，按已登记算子与来源事实
生成可解释的目标，不按页码、标题或文件名分派。
"""

from __future__ import annotations

import logging
from typing import Any, Mapping

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import MaterialRecord
from ..db.ppt_ai_models import PptAiBundleRecord, PptAiPlanRecord, PptAiTaskRecord
from ..settings import get_settings
from .branches import create_branch
from .client import PPTAIClient
from .compiler import CompileError, CompileStaleError, compile_plan
from .evaluation import evaluate_node
from .model_calls import attempt_callback
from .learning_types import (
    LEARNING_CONTRACT_VERSION,
    LearningCapabilities,
    LearningControl,
    LearningDescriptor,
    LearningItem,
    LearningPage,
    LearningReviewItem,
    LearningSourceRef,
    LearningState,
    LearningSuggestedAction,
)
from .planner import plan_interactions
from .regions import extract_regions, load_region_cache, save_region_cache
from .registry import REGISTRY
from .source_snapshot import build_source_snapshot
from .store import (
    baseline_branch_row,
    get_bundle,
    latest_bundle_row,
    save_bundle,
    save_plan,
)
from .types import CallBudget, CompiledNode, InteractionBundle, SourceSnapshot
from .util import hash_json, now_iso

logger = logging.getLogger(__name__)

_GOAL_BY_OPERATOR: dict[str, tuple[str, str]] = {
    "matrix.transform": ("eigen_direction", "matrix.eigen_probe"),
    "matrix.change_of_basis": ("change_of_basis", "matrix.change_of_basis"),
    "explain.text": ("explain", "text.explain"),
}


def _goal_for(node: CompiledNode) -> tuple[str, str]:
    if node.operator_id == "matrix.transform":
        has_vector = isinstance(node.provider.get("vector"), list) or any(
            parameter.id in ("v1", "v2") for parameter in node.parameters
        )
        return ("eigen_direction", "matrix.eigen_probe") if has_vector else ("inverse_mapping", "matrix.inverse")
    return _GOAL_BY_OPERATOR.get(node.operator_id, ("registered_exploration", "generic.registered"))


def _origin_for(node: CompiledNode) -> str:
    for parameter in node.parameters:
        origin = parameter.provenance.origin_type
        if origin:
            return origin
    return "native"


def _source_refs(node: CompiledNode, material_id: str) -> list[LearningSourceRef]:
    refs: list[LearningSourceRef] = []
    seen: set[tuple[int, str | None, str | None]] = set()

    def add(anchor, origin: str) -> None:
        key = (anchor.page, anchor.element_id, anchor.node_id)
        if key in seen:
            return
        seen.add(key)
        refs.append(
            LearningSourceRef(
                material_id=material_id,
                page_no=anchor.page,
                node_id=anchor.node_id,
                region_id=node.region_id,
                element_id=anchor.element_id,
                bbox=anchor.bbox,
                excerpt=anchor.excerpt,
                semantic_content_hash=anchor.semantic_content_hash,
                origin_type=origin,  # type: ignore[arg-type]
            )
        )

    add(node.source, _origin_for(node))
    for parameter in node.parameters:
        add(parameter.source, parameter.provenance.origin_type)
    return refs[:20]


def _control_for(parameter, role: str) -> LearningControl:
    low = parameter.min if parameter.min is not None else -5.0
    high = parameter.max if parameter.max is not None else 5.0
    step = parameter.step or (1.0 if parameter.type == "integer" else 0.1)
    if high <= low:
        high = low + 1.0
    return LearningControl(
        concept_id=parameter.concept_id,
        label=parameter.label,
        role=role,  # type: ignore[arg-type]
        min=float(low),
        max=float(high),
        step=float(step),
        precision=0 if parameter.type == "integer" else 3,
        unit=parameter.unit,
        reason=(
            "来源参数，默认固定；展开完整参数后可核对"
            if role == "fixed"
            else "可改变量；拖动或键入得到同一求值结果"
        ),
    )


def _teaching_probe(node: CompiledNode) -> list[LearningControl]:
    """没有 v1/v2 参数时创建教学探针，并明确它不是原稿内容。"""

    if node.operator_id != "matrix.transform":
        return []
    if any(parameter.id in ("v1", "v2") for parameter in node.parameters):
        return []
    return [
        LearningControl(
            concept_id=f"teaching.v{index + 1}",
            label=f"教学探针 v{index + 1}",
            role="editable",
            min=-5.0,
            max=5.0,
            step=0.1,
            precision=3,
            reason="原稿未给出可调向量；这是教学探针，不冒充原稿内容。",
        )
        for index in range(2)
    ]


def _suggested(node: CompiledNode, goal: str) -> list[LearningSuggestedAction]:
    if goal == "eigen_direction":
        return [
            LearningSuggestedAction(
                action_type="explain", label="为什么这个方向不变？", question="为什么这个方向在变换后仍与原来共线？"
            ),
            LearningSuggestedAction(
                action_type="run_experiment", label="换一个向量试试", question="把向量换成 (1,0)，Av 与 v 还共线吗？"
            ),
            LearningSuggestedAction(
                action_type="solve_target", label="求给定结果的输入", question="已知 Av，求对应的输入向量 v。"
            ),
        ]
    if goal == "inverse_mapping":
        return [
            LearningSuggestedAction(
                action_type="solve_target", label="已知 y 求 v", question="已知结果向量 y，求满足 Av=y 的输入 v。"
            ),
            LearningSuggestedAction(
                action_type="explain", label="为什么可能没有唯一解？", question="为什么奇异矩阵可能没有唯一解？"
            ),
        ]
    if goal == "change_of_basis":
        return [
            LearningSuggestedAction(
                action_type="explain", label="为什么迹和行列式不变？", question="换基后为什么迹和行列式保持不变？"
            ),
            LearningSuggestedAction(
                action_type="run_experiment", label="换成另一个角度", question="把基旋转 45°，B 会怎样变化？"
            ),
        ]
    if goal == "explain":
        return [
            LearningSuggestedAction(
                action_type="explain", label="用自己的话解释", question="这段内容的核心意思是什么？"
            )
        ]
    return [
        LearningSuggestedAction(
            action_type="explain", label="解释当前结果", question="这些数值之间是什么关系？"
        ),
        LearningSuggestedAction(
            action_type="run_experiment", label="改变一个条件", question="改变一个条件后结果会怎样变化？"
        ),
    ]


def _objective(node: CompiledNode, goal: str) -> tuple[str, str]:
    if goal == "eigen_direction":
        return ("看看这个矩阵把向量变成什么方向", "改变向量，观察 Av 是否与 v 共线，以及倍率是多少。")
    if goal == "inverse_mapping":
        return ("已知结果，反求输入向量", "给定结果向量 y，求满足 Av=y 的 v，并检查代回残差。")
    if goal == "change_of_basis":
        return ("换一组基，看同一个变换", "改变旋转基角度，比较 B=P⁻¹AP 与迹、行列式等不变量。")
    if goal == "explain":
        return (node.title or "原文说明", "阅读原文依据，并用自己的话说明核心意思。")
    return (node.title or "参数探索", "改变参数，观察图形、数值与结论如何同步变化。")


def descriptor_for_node(
    node: CompiledNode, *, material_id: str = "", bundle: InteractionBundle | None = None
) -> LearningDescriptor:
    goal, template = _goal_for(node)
    title, objective = _objective(node, goal)
    params = node.parameters
    matrix_params = [parameter for parameter in params if parameter.id.startswith("a")]
    vector_params = [parameter for parameter in params if parameter.id in ("v1", "v2")]
    angle_params = [parameter for parameter in params if parameter.id == "basis_angle_deg"]
    if goal == "eigen_direction":
        editable = vector_params
        fixed = matrix_params
    elif goal == "inverse_mapping":
        editable = vector_params
        fixed = matrix_params
    elif goal == "change_of_basis":
        editable = angle_params + vector_params
        fixed = matrix_params
    elif goal == "explain":
        editable = []
        fixed = []
    else:
        editable = params
        fixed = []
    controls = [_control_for(parameter, "editable" if parameter in editable else "fixed") for parameter in params]
    if goal == "eigen_direction":
        controls.extend(_teaching_probe(node))
    bindings: dict[str, str] = {}
    for parameter in matrix_params:
        bindings[f"matrix.{parameter.id}"] = parameter.concept_id
    for parameter in vector_params:
        bindings[f"vector.{parameter.id}"] = parameter.concept_id
    for parameter in angle_params:
        bindings["basis.angle"] = parameter.concept_id
    if goal == "eigen_direction" and not vector_params:
        bindings["vector.v1"] = "teaching.v1"
        bindings["vector.v2"] = "teaching.v2"
    review_items = []
    for check in node.checks:
        if check.get("status") == "fail":
            review_items.append(
                LearningReviewItem(
                    item_id=f"review_{node.node_id}_{len(review_items)}",
                    field=str(check.get("id") or "check"),
                    prompt=str(check.get("message") or "请核对当前来源与参数。")[:500],
                    current_value="",
                    basis=str(node.source.excerpt or "")[:500],
                    required=True,
                    resolved=False,
                )
            )
    for parameter in params:
        if parameter.provenance.origin_type in ("model_inference", "teaching"):
            review_items.append(
                LearningReviewItem(
                    item_id=f"review_{parameter.concept_id}",
                    field=parameter.id,
                    prompt=f"确认「{parameter.label}」的初值与范围。",
                    current_value=str(parameter.default),
                    basis=parameter.provenance.inference or parameter.provenance.evidence,
                    required=True,
                    resolved=False,
                )
            )
    notes = []
    if any(control.concept_id.startswith("teaching.") for control in controls):
        notes.append("教学探针由系统创建，不声称原稿给出了该向量。")
    return LearningDescriptor(
        goal_id=goal,  # type: ignore[arg-type]
        title=title,
        objective=objective,
        source_refs=_source_refs(node, material_id),
        template_id=template,  # type: ignore[arg-type]
        bindings=bindings,
        fixed_roles=["matrix"] if matrix_params else [],
        editable_roles=list(
            dict.fromkeys(
                (["vector"] if (vector_params or goal == "eigen_direction") else [])
                + (["basis"] if angle_params else [])
                + (["parameters"] if goal == "registered_exploration" else [])
            )
        ),
        controls=controls,
        suggested_actions=_suggested(node, goal),
        review_items=review_items[:20],
        notes=notes,
    )


def _item_state(node: CompiledNode, descriptor: LearningDescriptor) -> LearningState:
    if any(check.get("status") == "fail" for check in node.checks):
        return "unsupported"
    if node.operator_id == "explain.text":
        return "explanation_only"
    if any(item.required and not item.resolved for item in descriptor.review_items):
        return "needs_review"
    return "ready"


def _capabilities(*, can_manage: bool) -> LearningCapabilities:
    settings = get_settings()
    enabled = bool(settings.ppt_ai_learning_enabled and settings.ppt_ai_enabled)
    return LearningCapabilities(
        can_explain_online=bool(enabled),
        can_ask_online=bool(enabled),
        can_explore_locally=bool(enabled),
        can_save_cloud=bool(enabled and can_manage),
        can_manage=bool(can_manage),
    )


def _pending_prepare_task(db: Session, material_id: str, session_id: str) -> PptAiTaskRecord | None:
    return db.scalar(
        select(PptAiTaskRecord)
        .where(
            PptAiTaskRecord.material_id == material_id,
            PptAiTaskRecord.session_id == session_id,
            PptAiTaskRecord.kind == "ai_learn_prepare",
            PptAiTaskRecord.status.in_(("queued", "running")),
        )
        .order_by(PptAiTaskRecord.created_at.desc())
        .limit(1)
    )


def build_learning_page(
    db: Session,
    *,
    material: MaterialRecord,
    session_id: str,
    page_no: int,
    node_id: str | None = None,
) -> LearningPage:
    """只读投影：没有缓存/编译内容时返回 unprepared，不调用模型。"""

    from .learning_context import document_revision_for

    generated_at = now_iso()
    bundle_row = latest_bundle_row(db, session_id, material.id)
    pending = _pending_prepare_task(db, material.id, session_id)
    document_revision = document_revision_for(
        material.id, fallback=bundle_row.source_revision if bundle_row is not None else 0
    )
    if bundle_row is None:
        return LearningPage(
            material_id=material.id,
            page_no=page_no,
            document_revision=document_revision,
            source_hash=hash_json({"material_id": material.id, "revision": document_revision}),
            state="preparing" if pending is not None else "unprepared",
            items=[],
            pending_task_id=pending.id if pending is not None else None,
            capabilities=_capabilities(can_manage=True),
            note="本页学习内容尚未准备；原稿继续可读。" if pending is None else "正在整理公式与实验。",
            generated_at=generated_at,
        )
    bundle = get_bundle(db, bundle_row.id, session_id, material.id)
    branch = baseline_branch_row(db, bundle.bundle_id, session_id, material.id)
    nodes = [
        node
        for node in bundle.compiled.nodes
        if node.source.page == page_no and (node_id is None or node.node_id == node_id)
    ]
    items: list[LearningItem] = []
    for node in nodes:
        descriptor = descriptor_for_node(node, material_id=material.id, bundle=bundle)
        state = _item_state(node, descriptor)
        items.append(
            LearningItem(
                item_id=node.node_id,
                node_id=node.node_id,
                region_id=node.region_id,
                title=node.title,
                state=state,
                support_status=state,
                descriptor=descriptor,
                baseline_values={
                    parameter.concept_id: (branch.canonical_values or {}).get(
                        parameter.concept_id, parameter.default
                    )
                    for parameter in node.parameters
                },
                explanation_ready=True,
                experiment_ready=state == "ready",
                manual_review_reason="；".join(item.prompt for item in descriptor.review_items[:3]),
            )
        )
    if pending is not None:
        page_state: LearningState = "preparing"
    elif not items:
        page_state = "unsupported"
    elif any(item.state == "ready" for item in items):
        page_state = "ready"
    elif any(item.state == "explanation_only" for item in items):
        page_state = "explanation_only"
    elif any(item.state == "needs_review" for item in items):
        page_state = "needs_review"
    else:
        page_state = "unsupported"
    return LearningPage(
        material_id=material.id,
        page_no=page_no,
        document_revision=document_revision,
        source_hash=bundle.source_hash,
        bundle_id=bundle.bundle_id,
        bundle_revision=bundle.bundle_revision,
        branch_id=branch.id if branch is not None else None,
        branch_revision=branch.revision if branch is not None else None,
        branch_kind=(branch.kind if branch is not None else None),  # type: ignore[arg-type]
        state=page_state,
        items=items,
        pending_task_id=pending.id if pending is not None else None,
        capabilities=_capabilities(can_manage=True),
        note=(
            "本页没有可执行交互；原稿继续可读。"
            if not items
            else "学习内容来自当前课件基准；练习不会改写原稿。"
        ),
        generated_at=generated_at,
    )


def _snapshot(material: MaterialRecord) -> SourceSnapshot:
    return build_source_snapshot(material.id, title=material.title or "")


def handle_learning_prepare_task(
    db: Session,
    material: MaterialRecord,
    task: PptAiTaskRecord,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    """复用现有规划/编译：只让已确认（supported/explanation_only）内容进入 ready。"""

    snapshot = _snapshot(material)
    expected = payload.get("expected_document_revision")
    if isinstance(expected, int) and expected != snapshot.document_revision:
        return {"__status__": "superseded", "__stage__": "superseded", "reason": "文档已更新；本次准备未挂载。"}
    task.input_version = snapshot.document_revision
    task.input_hash = snapshot.source_hash
    cache: dict[str, Any] = {}
    extraction = extract_regions(snapshot, cache=load_region_cache(material.id), cache_out=cache)
    try:
        save_region_cache(material.id, cache)
    except OSError:
        logger.warning("区域缓存写入失败（material=%s）", material.id)
    budget = CallBudget(
        max_calls=int(get_settings().ppt_ai_task_max_calls), used_calls=int(task.budget_used or 0)
    )
    plan = plan_interactions(
        extraction,
        snapshot,
        budget=budget,
        client=PPTAIClient(),
        purpose=str(payload.get("purpose") or "按页准备学习内容"),
        on_model_attempt=attempt_callback(task.id),
    )
    save_plan(db, session_id=task.session_id, material_id=material.id, plan=plan)
    try:
        bundle = compile_plan(
            plan,
            REGISTRY,
            bundle_revision=_next_bundle_revision(db, material.id),
            snapshot=snapshot,
        )
    except CompileStaleError as exc:
        return {"__status__": "superseded", "__stage__": "superseded", "reason": str(exc)}
    except CompileError as exc:
        raise ValueError(str(exc)) from exc
    if not bundle.compiled.nodes:
        return {
            "__status__": "needs_review",
            "__stage__": "no_nodes",
            "plan_id": plan.plan_id,
            "reason": "没有可确认的学习内容；原稿仍可阅读。",
            "node_count": 0,
            "budget_used": budget.used_calls,
        }
    save_bundle(db, session_id=task.session_id, material_id=material.id, bundle=bundle)
    branch = create_branch(
        db,
        session_id=task.session_id,
        material_id=material.id,
        bundle=bundle,
        status="active",
        kind="baseline",
        title="课件基准",
        learning={"source": "learning_prepare", "plan_id": plan.plan_id},
    )
    task.budget_used = budget.used_calls
    return {
        "plan_id": plan.plan_id,
        "bundle_id": bundle.bundle_id,
        "bundle_revision": bundle.bundle_revision,
        "branch_id": branch.id,
        "node_count": len(bundle.compiled.nodes),
        "pages": sorted({node.source.page for node in bundle.compiled.nodes}),
        "budget_used": budget.used_calls,
    }


def _next_bundle_revision(db: Session, material_id: str) -> int:
    from sqlalchemy import func

    current = db.scalar(
        select(func.max(PptAiBundleRecord.bundle_revision)).where(
            PptAiBundleRecord.material_id == material_id
        )
    )
    return int(current or 0) + 1


__all__ = [
    "LEARNING_CONTRACT_VERSION",
    "build_learning_page",
    "descriptor_for_node",
    "handle_learning_prepare_task",
]
