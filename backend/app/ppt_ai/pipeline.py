"""规划与编译任务处理器（``ai_plan`` / ``ai_rebuild``）。"""

from __future__ import annotations

import logging
from typing import Any, Mapping

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db.models import MaterialRecord
from ..db.ppt_ai_models import PptAiBundleRecord, PptAiTaskRecord
from ..settings import get_settings
from .branches import create_branch
from .client import PPTAIClient
from .compiler import CompileError, CompileStaleError, compile_plan
from .contracts import ContractError, schema_available
from .matching.pipeline import resolve_requested_regions
from .model_calls import attempt_callback
from .planner import plan_interactions
from .regions import extract_regions, load_region_cache, save_region_cache
from .registry import REGISTRY
from .source_snapshot import build_source_snapshot
from .store import get_plan, mark_reports_stale, plan_from_row, save_bundle, save_plan
from .types import CallBudget, InteractionPlan, RegionIssue
from .util import hash_json, now_iso

logger = logging.getLogger(__name__)


def _snapshot(material: MaterialRecord):
    return build_source_snapshot(material.id, title=material.title or "")


def _stale_result(reason: str) -> dict[str, Any]:
    return {"__status__": "superseded", "__stage__": "superseded", "reason": reason}


def handle_plan_task(
    db: Session,
    material: MaterialRecord,
    task: PptAiTaskRecord,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    if not schema_available("plan") or not schema_available("region"):
        raise ContractError("PPT AI 契约或校验器不可用，拒绝生成新规划")
    snapshot = _snapshot(material)
    expected_revision = payload.get("expected_document_revision")
    if isinstance(expected_revision, int) and expected_revision != snapshot.document_revision:
        return _stale_result("文档已更新；本次规划基于旧版本，未挂载。")
    task.input_version = snapshot.document_revision
    task.input_hash = snapshot.source_hash
    cache: dict[str, Any] = {}
    cached = load_region_cache(material.id)
    extraction = extract_regions(snapshot, cache=cached, cache_out=cache)
    try:
        save_region_cache(material.id, cache)
    except OSError:
        logger.warning("区域缓存写入失败（material=%s）", material.id)
    budget = CallBudget(
        max_calls=int(get_settings().ppt_ai_task_max_calls),
        used_calls=int(task.budget_used or 0),
    )
    client = PPTAIClient()
    plan = plan_interactions(
        extraction,
        snapshot,
        budget=budget,
        client=client,
        purpose=str(payload.get("purpose") or ""),
        on_model_attempt=attempt_callback(task.id),
    )
    region_ids = payload.get("region_ids")
    if isinstance(region_ids, list) and region_ids:
        requested = [str(item) for item in region_ids]
        allowed, unmatched = resolve_requested_regions(requested, extraction.regions)
        if unmatched:
            available = [region.region_id for region in extraction.regions][:12]
            raise ValueError(
                "未找到指定区域："
                + "、".join(unmatched[:8])
                + "。region_ids 可传规划区域 ID 或来源元素 ID（element_id）；"
                "可用区域示例："
                + "、".join(available)
            )
        plan.options = [option for option in plan.options if option.region_id in allowed]
        selected_pages = {option.source.page for option in plan.options}
        plan.coverage = [entry for entry in plan.coverage if entry.page_no in selected_pages]
        plan.issues.append(
            RegionIssue(
                code="region_filter",
                message=(
                    f"仅重新识别用户指定的 {len(requested)} 项（命中 {len(allowed)} 个区域）。"
                ),
                severity="info",
            )
        )
        if not plan.options:
            raise ValueError(
                "指定区域没有可规划的内容；未保存空规划，请更换区域后重试。"
            )
    save_plan(db, session_id=task.session_id, material_id=material.id, plan=plan)
    task.budget_used = budget.used_calls
    supported = sum(1 for option in plan.options if option.support_status == "supported")
    review = sum(1 for option in plan.options if option.support_status == "needs_review")
    explain = sum(1 for option in plan.options if option.support_status == "explanation_only")
    unsupported = sum(1 for option in plan.options if option.support_status == "unsupported")
    return {
        "plan_id": plan.plan_id,
        "plan_revision": plan.plan_revision,
        "source_revision": plan.source_revision,
        "source_hash": plan.source_hash,
        "region_count": len(extraction.regions),
        "coverage_pages": len(extraction.coverage),
        "option_count": len(plan.options),
        "supported": supported,
        "needs_review": review,
        "explanation_only": explain,
        "unsupported": unsupported,
        "budget_used": budget.used_calls,
        "ai_used": bool(plan.budget.get("ai_used")),
    }


def _next_bundle_revision(db: Session, material_id: str) -> int:
    current = db.scalar(
        select(func.max(PptAiBundleRecord.bundle_revision)).where(
            PptAiBundleRecord.material_id == material_id
        )
    )
    return int(current or 0) + 1


def handle_rebuild_task(
    db: Session,
    material: MaterialRecord,
    task: PptAiTaskRecord,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    plan_id = str(payload.get("plan_id") or "")
    if not plan_id:
        raise ValueError("缺少 plan_id")
    row = get_plan(db, plan_id, task.session_id, material.id)
    plan: InteractionPlan = plan_from_row(row)
    if not plan.options:
        raise ValueError("规划中没有可编译方案（可能是区域过滤未命中）；请重新识别后再采用。")
    expected_plan_revision = payload.get("expected_plan_revision")
    if isinstance(expected_plan_revision, int) and expected_plan_revision != plan.plan_revision:
        return _stale_result("规划已在其他窗口更新，请重新载入。")
    snapshot = _snapshot(material)
    expected_document_revision = payload.get("expected_document_revision")
    if isinstance(expected_document_revision, int) and expected_document_revision != snapshot.document_revision:
        return _stale_result("文档已更新；本次编译基于旧内容，未挂载。")
    if snapshot.source_hash != plan.source_hash or snapshot.document_revision != plan.source_revision:
        return _stale_result("源内容哈希已变化；旧规划不能覆盖新内容。")
    selected = payload.get("selected_option_ids")
    if selected is not None and not isinstance(selected, list):
        raise ValueError("selected_option_ids 必须是数组")
    overrides = payload.get("parameter_overrides") or {}
    if not isinstance(overrides, Mapping):
        raise ValueError("parameter_overrides 必须是对象")
    cleaned_overrides: dict[str, dict[str, Any]] = {}
    for option_id, values in overrides.items():
        if isinstance(values, Mapping):
            cleaned_overrides[str(option_id)] = dict(values)
    try:
        bundle = compile_plan(
            plan,
            REGISTRY,
            bundle_revision=_next_bundle_revision(db, material.id),
            selected_option_ids=[str(item) for item in selected] if selected is not None else None,
            parameter_overrides=cleaned_overrides,
            confirmed_option_ids=[str(item) for item in payload.get("confirmed_option_ids", []) if isinstance(item, str)],
            snapshot=snapshot,
        )
    except CompileStaleError as exc:
        return _stale_result(str(exc))
    except CompileError as exc:
        raise ValueError(str(exc)) from exc
    save_bundle(db, session_id=task.session_id, material_id=material.id, bundle=bundle)
    branch = create_branch(
        db,
        session_id=task.session_id,
        material_id=material.id,
        bundle=bundle,
        status="active",
    )
    mark_reports_stale(db, bundle.bundle_id)
    task.input_version = snapshot.document_revision
    task.input_hash = snapshot.source_hash
    node_count = len(bundle.compiled.nodes)
    return {
        "__status__": "succeeded" if node_count else "needs_review",
        "__stage__": "compiled" if node_count else "no_nodes",
        "bundle_id": bundle.bundle_id,
        "bundle_revision": bundle.bundle_revision,
        "branch_id": branch.id,
        "node_count": node_count,
        "ispec_count": len(bundle.compiled.ispecs),
        "content_hash": bundle.content_hash,
        "reason": "" if node_count else "选中的方案没有可执行节点；原页仍可阅读。",
    }


def plan_summary(plan: InteractionPlan) -> dict[str, Any]:
    return {
        "plan_id": plan.plan_id,
        "plan_revision": plan.plan_revision,
        "source_revision": plan.source_revision,
        "source_hash": plan.source_hash,
        "options": len(plan.options),
        "supported": sum(1 for option in plan.options if option.support_status == "supported"),
        "needs_review": sum(1 for option in plan.options if option.support_status == "needs_review"),
        "explanation_only": sum(1 for option in plan.options if option.support_status == "explanation_only"),
        "unsupported": sum(1 for option in plan.options if option.support_status == "unsupported"),
        "created_at": plan.created_at,
    }


__all__ = ["handle_plan_task", "handle_rebuild_task", "plan_summary"]
