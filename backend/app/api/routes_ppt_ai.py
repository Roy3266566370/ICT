"""PPT AI 私有 API（``/api/v1/materials/{material_id}/ai-*``）。

所有读接口只读数据库；生成/重试/编译/实验/验收均使用显式写接口。私有操作沿用
项目现有的归属、Origin、CSRF 与错误封装，不新增通用聊天/画布命令入口。
"""

from __future__ import annotations

import logging
import re
import threading
from typing import Any, Literal, Mapping

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import MaterialRecord
from ..db.ppt_ai_models import (
    PptAiArtifactRecord,
    PptAiBranchRecord,
    PptAiExperimentRecord,
    PptAiPlanRecord,
    PptAiTaskRecord,
    PptAiValidationReportRecord,
)
from ..documents.store import read_document
from ..schemas.errors import ApiError, ErrorCode, missing_field, model_unavailable, resource_unavailable
from ..settings import get_settings
from . import DBDep, SessionDep, WriteDep, API_PREFIX, ok, owned_material
from ..ppt_ai.branches import BranchConflict, create_branch, migrate_branch_state, patch_branch, to_state
from ..ppt_ai.client import PPTAIClient, PPTAIError
from ..ppt_ai.page_lab import (
    PageLabError,
    collect_page_context,
    generate_page_lab,
    load_cached_lab,
    save_cached_lab,
)
from ..ppt_ai.generated_views import GeneratedViewError
from ..ppt_ai.recognition_types import TEMPLATE_CONTRACT_VERSION
from ..ppt_ai.registry import REGISTRY
from ..ppt_ai.template_packs import catalog_snapshot
from ..ppt_ai.relations import (
    RelationConflict,
    RelationCycleError,
    apply_link_decisions_with_remap,
    preview_link_decisions,
    unlink_relation,
)
from ..ppt_ai.snapshots import freeze_interactions, public_projection
from ..ppt_ai.store import (
    artifact_from_row,
    experiment_from_row,
    get_branch_row,
    get_bundle,
    get_bundle_row,
    get_experiment_row,
    get_plan,
    get_report_row,
    baseline_branch_row,
    latest_bundle_row,
    latest_report_row,
    list_branches,
    list_bundles,
    plan_from_row,
    reactivate_bundle,
    repoint_branch_bundle,
    save_bundle,
    task_from_row,
)
from ..ppt_ai.tasks import dispatch_async, enqueue_task, find_by_operation
from ..ppt_ai.types import ExperimentRequest, LinkDecision, PptAITask, TargetRequest, ValidationCase
from ..ppt_ai.util import hash_json, now_iso

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ppt-ai"])

OPERATION_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]{1,100}$")


def _enabled() -> None:
    if not get_settings().ppt_ai_enabled:
        raise ApiError(ErrorCode.FORBIDDEN, "PPT AI 交互增强未开启", status_code=403)


router.dependencies.append(Depends(_enabled))


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PlanCreateBody(StrictBody):
    expected_document_revision: int | None = Field(default=None, ge=0)
    operation_id: str = Field(min_length=1, max_length=100)
    region_ids: list[str] = Field(
        default_factory=list,
        max_length=100,
        description="规划区域 ID（rgn_*）或来源元素 ID（如 p04_s14）；未命中会显式报错",
    )
    purpose: str = Field(default="", max_length=500)


class PlanApplyBody(StrictBody):
    expected_plan_revision: int = Field(ge=1)
    expected_document_revision: int | None = Field(default=None, ge=0)
    operation_id: str = Field(min_length=1, max_length=100)
    # None/空数组都表示“按规划默认选择”：supported 优先，其次 explanation_only。
    # 旧默认值是空数组，会让未显式选择的 apply 编译出 0 节点（S5 复测缺陷）。
    selected_option_ids: list[str] | None = Field(default=None, max_length=100)
    confirmed_option_ids: list[str] = Field(default_factory=list, max_length=100)
    parameter_overrides: dict[str, dict[str, Any]] = Field(default_factory=dict)


class RegionRetryBody(StrictBody):
    expected_document_revision: int | None = Field(default=None, ge=0)
    operation_id: str = Field(min_length=1, max_length=100)
    note: str = Field(default="", max_length=500)


class LinksBody(StrictBody):
    expected_bundle_revision: int = Field(ge=1)
    operation_id: str = Field(min_length=1, max_length=100)
    decisions: list[LinkDecision] = Field(min_length=1, max_length=100)
    # 值来源分支：确认时把该分支的值迁移到新分支；不传则从种子值重建。
    branch_id: str | None = Field(default=None, max_length=96)
    # 当前工作区的值/局部覆盖（可能尚未保存）；确认后原样迁移到新分支。
    values: dict[str, Any] | None = None
    overrides: dict[str, dict[str, Any]] | None = None


class LinksPreviewBody(StrictBody):
    decisions: list[LinkDecision] = Field(min_length=1, max_length=100)
    values: dict[str, Any] | None = None
    overrides: dict[str, dict[str, Any]] | None = None


class UnlinkBody(StrictBody):
    expected_bundle_revision: int = Field(ge=1)
    operation_id: str = Field(min_length=1, max_length=100)
    relation_id: str = Field(min_length=1, max_length=96)
    branch_id: str | None = Field(default=None, max_length=96)
    values: dict[str, Any] | None = None
    overrides: dict[str, dict[str, Any]] | None = None


class RevertBody(StrictBody):
    expected_bundle_revision: int = Field(ge=1)
    operation_id: str = Field(min_length=1, max_length=100)
    target_bundle_id: str = Field(min_length=1, max_length=96)


class ExperimentBody(StrictBody):
    branch_id: str = Field(min_length=1, max_length=96)
    expected_branch_revision: int = Field(ge=1)
    operation_id: str = Field(min_length=1, max_length=100)
    question: str = Field(min_length=3, max_length=1000)
    recipe_hint: Literal["compare", "counterexample", "boundary", "sensitivity"] | None = None
    selection: dict[str, Any] = Field(default_factory=dict)
    allowed_variables: list[str] = Field(default_factory=list, max_length=20)
    ranges: dict[str, list[float]] = Field(default_factory=dict)


class TargetBody(StrictBody):
    branch_id: str = Field(min_length=1, max_length=96)
    expected_branch_revision: int = Field(ge=1)
    operation_id: str = Field(min_length=1, max_length=100)
    node_id: str = Field(min_length=1, max_length=96)
    output: str = Field(min_length=1, max_length=80)
    target_value: float
    target_vector: list[float] | None = Field(default=None, min_length=2, max_length=4)
    variables: list[str] = Field(min_length=1, max_length=8)
    fixed: dict[str, Any] = Field(default_factory=dict)
    constraints: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    ranges: dict[str, list[float]] = Field(default_factory=dict)
    tolerance: float = Field(default=1e-6, gt=0, le=1)
    max_iterations: int = Field(default=200, ge=1, le=2000)


class BranchPatchBody(StrictBody):
    expected_revision: int = Field(ge=1)
    operation_id: str = Field(min_length=1, max_length=100)
    values: dict[str, Any] = Field(default_factory=dict, max_length=100)
    #: 局部覆盖：{node_id: {concept_id: value}}；传空对象表示清除全部覆盖。
    overrides: dict[str, dict[str, Any]] | None = Field(default=None, max_length=200)


class ValidateBody(StrictBody):
    branch_id: str | None = Field(default=None, max_length=96)
    expected_branch_revision: int | None = Field(default=None, ge=1)
    operation_id: str = Field(min_length=1, max_length=100)
    cases: list[ValidationCase] = Field(default_factory=list, max_length=200)
    auto_repair: bool = False
    browser: dict[str, Any] | None = None


class GeneratedViewBody(StrictBody):
    branch_id: str = Field(min_length=1, max_length=96)
    node_id: str = Field(min_length=1, max_length=96)
    requirement: str = Field(min_length=1, max_length=1000)
    operation_id: str = Field(min_length=1, max_length=100)


class ArtifactAcceptanceBody(StrictBody):
    status: Literal["accepted", "rejected"]
    evidence: dict[str, Any] = Field(default_factory=dict)


def _check_operation(operation_id: str) -> None:
    if OPERATION_PATTERN.match(operation_id or "") is None:
        raise missing_field("操作标识不合法", field="operation_id")


def _document_revision(material_id: str) -> int:
    document = read_document(material_id)
    if isinstance(document, dict) and isinstance(document.get("revision"), int):
        return int(document["revision"])
    try:
        from ..ppt_ai.store import get_plan  # noqa: F401

        from ..api.routes_jobs import read_ispec_payload

        payload = read_ispec_payload(material_id) or {}
        revision = payload.get("edit_revision")
        return int(revision) if isinstance(revision, int) else 0
    except Exception:  # noqa: BLE001
        return 0


def _guard_revision(material: MaterialRecord, expected: int | None) -> int:
    current = _document_revision(material.id)
    if expected is not None and expected != current:
        raise ApiError(
            ErrorCode.VERSION_CONFLICT,
            f"文档已更新（当前 revision={current}），请重新载入后再提交",
            status_code=409,
        )
    return current


def _task_response(request: Request, row: PptAiTaskRecord) -> JSONResponse:
    return ok(
        request,
        {
            "task_id": row.id,
            "status": row.status,
            "stage": row.stage,
            "status_url": f"{API_PREFIX}/materials/{row.material_id}/ai-tasks/{row.id}",
        },
        status_code=202,
    )


def _task_row(db: Session, task_id: str, ctx, material: MaterialRecord) -> PptAiTaskRecord:
    row = db.get(PptAiTaskRecord, task_id)
    if row is None or row.session_id != ctx.session_id or row.material_id != material.id:
        raise resource_unavailable()
    return row


def _get_branch(db: Session, branch_id: str, ctx, material: MaterialRecord) -> PptAiBranchRecord:
    return get_branch_row(db, branch_id, ctx.session_id, material.id)


# ---------------------------------------------------------------------------
# 任务
# ---------------------------------------------------------------------------


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/ai-plans",
    status_code=202,
    summary="创建交互规划任务",
)
def create_plan(
    material_id: str, body: PlanCreateBody, request: Request, ctx: WriteDep, db: DBDep
) -> JSONResponse:
    _check_operation(body.operation_id)
    material = owned_material(db, ctx, material_id)
    revision = _guard_revision(material, body.expected_document_revision)
    row = enqueue_task(
        db,
        session_id=ctx.session_id,
        material_id=material.id,
        kind="ai_plan",
        operation_id=body.operation_id,
        input_version=revision,
        input_json={
            "expected_document_revision": body.expected_document_revision,
            "region_ids": body.region_ids,
            "purpose": body.purpose,
        },
    )
    dispatch_async(row.id)
    return _task_response(request, row)


@router.api_route(
    f"{API_PREFIX}/ppt-ai/materials/{{material_id}}/{{rest:path}}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
def wrong_material_ai_prefix(material_id: str, rest: str, ctx: SessionDep) -> None:
    """把常见的错误前缀引到正确端点，避免 404 被误判为会话/归属问题。"""

    raise ApiError(
        ErrorCode.MISSING_FIELD,
        (
            "材料操作端点为 /api/v1/materials/{material_id}/ai-*；"
            f"/api/v1/ppt-ai/materials/{material_id}/ 前缀不存在。"
        ),
        status_code=404,
        details={"material_id": material_id, "path": rest},
    )


@router.get(
    f"{API_PREFIX}/materials/{{material_id}}/ai-tasks/{{task_id}}",
    summary="读取 PPT AI 任务状态（无写副作用）",
)
def get_task(
    material_id: str, task_id: str, request: Request, ctx: SessionDep, db: DBDep
) -> JSONResponse:
    material = owned_material(db, ctx, material_id)
    row = _task_row(db, task_id, ctx, material)
    task: PptAITask = task_from_row(row)
    return ok(request, task.model_dump(mode="json"))


# ---------------------------------------------------------------------------
# 规划
# ---------------------------------------------------------------------------


@router.get(
    f"{API_PREFIX}/materials/{{material_id}}/ai-plans/{{plan_id}}",
    summary="读取交互规划",
)
def get_plan_detail(
    material_id: str, plan_id: str, request: Request, ctx: SessionDep, db: DBDep
) -> JSONResponse:
    material = owned_material(db, ctx, material_id)
    row = get_plan(db, plan_id, ctx.session_id, material.id)
    return ok(request, row.document)


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/ai-plans/{{plan_id}}/apply",
    status_code=202,
    summary="采用规划并编译交互 bundle",
)
def apply_plan(
    material_id: str,
    plan_id: str,
    body: PlanApplyBody,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
) -> JSONResponse:
    _check_operation(body.operation_id)
    material = owned_material(db, ctx, material_id)
    row = get_plan(db, plan_id, ctx.session_id, material.id)
    options = row.document.get("options") if isinstance(row.document, dict) else None
    if not isinstance(options, list) or not options:
        raise missing_field(
            "规划中没有可编译方案（可能是区域过滤未命中）；请重新识别后再采用。",
            field="plan_id",
        )
    if body.expected_plan_revision != row.plan_revision:
        raise ApiError(
            ErrorCode.VERSION_CONFLICT,
            f"规划已更新（当前 revision={row.plan_revision}），请刷新后重试",
            status_code=409,
        )
    revision = _guard_revision(material, body.expected_document_revision)
    task = enqueue_task(
        db,
        session_id=ctx.session_id,
        material_id=material.id,
        kind="ai_rebuild",
        operation_id=body.operation_id,
        input_version=revision,
        input_json={
            "plan_id": plan_id,
            "expected_plan_revision": body.expected_plan_revision,
            "expected_document_revision": body.expected_document_revision,
            "selected_option_ids": body.selected_option_ids or None,
            "confirmed_option_ids": body.confirmed_option_ids,
            "parameter_overrides": body.parameter_overrides,
        },
    )
    dispatch_async(task.id)
    return _task_response(request, task)


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/ai-regions/{{region_id}}/retry",
    status_code=202,
    summary="仅重新识别指定区域",
)
def retry_region(
    material_id: str,
    region_id: str,
    body: RegionRetryBody,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
) -> JSONResponse:
    _check_operation(body.operation_id)
    material = owned_material(db, ctx, material_id)
    revision = _guard_revision(material, body.expected_document_revision)
    task = enqueue_task(
        db,
        session_id=ctx.session_id,
        material_id=material.id,
        kind="ai_plan",
        operation_id=body.operation_id,
        input_version=revision,
        input_json={
            "expected_document_revision": body.expected_document_revision,
            "region_ids": [region_id],
            "purpose": body.note,
        },
    )
    dispatch_async(task.id)
    return _task_response(request, task)


# ---------------------------------------------------------------------------
# Bundle / 关系
# ---------------------------------------------------------------------------


@router.get(
    f"{API_PREFIX}/materials/{{material_id}}/ai-bundles/{{bundle_id}}",
    summary="读取不可变交互 bundle",
)
def get_bundle_detail(
    material_id: str, bundle_id: str, request: Request, ctx: SessionDep, db: DBDep
) -> JSONResponse:
    material = owned_material(db, ctx, material_id)
    get_bundle_row(db, bundle_id, ctx.session_id, material.id)
    bundle = get_bundle(db, bundle_id, ctx.session_id, material.id)
    return ok(request, bundle.model_dump(mode="json"))


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/ai-bundles/{{bundle_id}}/links/preview",
    summary="合并/引用前预览影响（不落库）",
)
def preview_bundle_links(
    material_id: str,
    bundle_id: str,
    body: LinksPreviewBody,
    request: Request,
    ctx: SessionDep,
    db: DBDep,
) -> JSONResponse:
    material = owned_material(db, ctx, material_id)
    get_bundle_row(db, bundle_id, ctx.session_id, material.id)
    bundle = get_bundle(db, bundle_id, ctx.session_id, material.id)
    try:
        result = preview_link_decisions(
            bundle,
            body.decisions,
            values=body.values,
            overrides=body.overrides,
        )
    except RelationConflict as exc:
        raise ApiError(ErrorCode.MISSING_FIELD, str(exc), status_code=422) from exc
    return ok(request, result)


def _migrate_branch_payload(
    db: Session,
    ctx,
    material,
    body: LinksBody | UnlinkBody,
    new_bundle,
    concept_remap: Mapping[str, Any] | None = None,
) -> tuple[str | None, list[str]]:
    """按确认/解除后的新 bundle 迁移分支值；返回 (新分支 ID, 说明)。

    - 值来源优先级：请求体 values/overrides（前端工作区实时值）>
      branch_id 分支已保存值 > 种子值。
    - 派生绑定的本地值在迁移中丢弃；合并成员的值按 remap 归到保留概念。
    """

    source_branch = (
        _get_branch(db, body.branch_id, ctx, material) if body.branch_id else None
    )
    base_values = (
        dict(body.values)
        if body.values is not None
        else dict(source_branch.canonical_values or {})
        if source_branch is not None
        else {}
    )
    base_overrides = (
        dict(body.overrides)
        if body.overrides is not None
        else dict(getattr(source_branch, "overrides_json", None) or {})
        if source_branch is not None
        else {}
    )
    migrated_values, migrated_overrides, notes = migrate_branch_state(
        new_bundle, concept_remap or {}, base_values, base_overrides
    )
    branch = create_branch(
        db,
        session_id=ctx.session_id,
        material_id=material.id,
        bundle=new_bundle,
        status="active",
        values=migrated_values,
        overrides=migrated_overrides,
        parent_branch_id=source_branch.id if source_branch is not None else None,
        kind=(getattr(source_branch, "kind", None) or None)
        if source_branch is not None
        else None,
        title=(getattr(source_branch, "title", "") or "")
        if source_branch is not None
        else "",
        learning=getattr(source_branch, "learning_json", None)
        if source_branch is not None
        else None,
    )
    return branch.id, notes


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/ai-bundles/{{bundle_id}}/links",
    status_code=201,
    summary="确认/拆分跨页关联，生成新 bundle",
)
def confirm_bundle_links(
    material_id: str,
    bundle_id: str,
    body: LinksBody,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
) -> JSONResponse:
    _check_operation(body.operation_id)
    material = owned_material(db, ctx, material_id)
    row = get_bundle_row(db, bundle_id, ctx.session_id, material.id)
    if body.expected_bundle_revision != row.bundle_revision:
        raise ApiError(
            ErrorCode.VERSION_CONFLICT,
            f"bundle 已更新（当前 revision={row.bundle_revision}）",
            status_code=409,
        )
    bundle = get_bundle(db, bundle_id, ctx.session_id, material.id)
    try:
        new_bundle, concept_remap = apply_link_decisions_with_remap(bundle, body.decisions)
    except RelationCycleError as exc:
        raise ApiError(ErrorCode.MISSING_FIELD, str(exc), status_code=422) from exc
    except RelationConflict as exc:
        raise ApiError(ErrorCode.VERSION_CONFLICT, str(exc), status_code=409) from exc
    save_bundle(db, session_id=ctx.session_id, material_id=material.id, bundle=new_bundle)
    notes: list[str] = []
    if all(decision.decision in ("reject", "split") for decision in body.decisions):
        # 拒绝/拆分不改 compiled：分支原样挂到新 bundle（保留 revision 与已调值）。
        source_branch: Any = None
        if body.branch_id and _branch_belongs(db, body.branch_id, ctx, material, bundle_id):
            source_branch = _get_branch(db, body.branch_id, ctx, material)
        repoint_branch_bundle(
            db,
            session_id=ctx.session_id,
            material_id=material.id,
            from_bundle_id=bundle.bundle_id,
            to_bundle_id=new_bundle.bundle_id,
        )
        if source_branch is not None:
            branch_id: str | None = source_branch.id
        else:
            repointed = baseline_branch_row(
                db, new_bundle.bundle_id, ctx.session_id, material.id
            )
            branch_id = repointed.id if repointed is not None else None
    else:
        branch_id, notes = _migrate_branch_payload(
            db, ctx, material, body, new_bundle, concept_remap
        )
    db.commit()
    return ok(
        request,
        {
            "bundle_id": new_bundle.bundle_id,
            "bundle_revision": new_bundle.bundle_revision,
            "branch_id": branch_id,
            "content_hash": new_bundle.content_hash,
            "notes": notes,
        },
        status_code=201,
    )


def _branch_belongs(db: Session, branch_id: str, ctx, material, bundle_id: str) -> bool:
    try:
        branch = _get_branch(db, branch_id, ctx, material)
    except Exception:  # noqa: BLE001 - APIException 由上层统一封装
        return False
    return branch.bundle_id == bundle_id


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/ai-bundles/{{bundle_id}}/links/unlink",
    status_code=201,
    summary="解除一条已确认的派生引用（可逆操作）",
)
def unlink_bundle_relation(
    material_id: str,
    bundle_id: str,
    body: UnlinkBody,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
) -> JSONResponse:
    _check_operation(body.operation_id)
    material = owned_material(db, ctx, material_id)
    row = get_bundle_row(db, bundle_id, ctx.session_id, material.id)
    if body.expected_bundle_revision != row.bundle_revision:
        raise ApiError(
            ErrorCode.VERSION_CONFLICT,
            f"bundle 已更新（当前 revision={row.bundle_revision}）",
            status_code=409,
        )
    bundle = get_bundle(db, bundle_id, ctx.session_id, material.id)
    try:
        new_bundle = unlink_relation(bundle, body.relation_id)
    except RelationCycleError as exc:
        raise ApiError(ErrorCode.MISSING_FIELD, str(exc), status_code=422) from exc
    except RelationConflict as exc:
        raise ApiError(ErrorCode.VERSION_CONFLICT, str(exc), status_code=409) from exc
    save_bundle(db, session_id=ctx.session_id, material_id=material.id, bundle=new_bundle)
    branch_id, notes = _migrate_branch_payload(db, ctx, material, body, new_bundle)
    db.commit()
    return ok(
        request,
        {
            "bundle_id": new_bundle.bundle_id,
            "bundle_revision": new_bundle.bundle_revision,
            "branch_id": branch_id,
            "content_hash": new_bundle.content_hash,
            "notes": notes,
        },
        status_code=201,
    )


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/ai-bundles/{{bundle_id}}/revert",
    status_code=200,
    summary="回退到历史 bundle（撤销整次关联核对，bundle 不可变故可安全回退）",
)
def revert_bundle(
    material_id: str,
    bundle_id: str,
    body: RevertBody,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
) -> JSONResponse:
    _check_operation(body.operation_id)
    material = owned_material(db, ctx, material_id)
    current = get_bundle_row(db, bundle_id, ctx.session_id, material.id)
    if current.status != "active":
        raise ApiError(
            ErrorCode.VERSION_CONFLICT,
            "只能从当前活跃 bundle 回退",
            status_code=409,
        )
    if body.expected_bundle_revision != current.bundle_revision:
        raise ApiError(
            ErrorCode.VERSION_CONFLICT,
            f"bundle 已更新（当前 revision={current.bundle_revision}）",
            status_code=409,
        )
    if body.target_bundle_id == bundle_id:
        raise ApiError(ErrorCode.MISSING_FIELD, "目标 bundle 不能是当前 bundle", status_code=422)
    try:
        target = reactivate_bundle(
            db,
            session_id=ctx.session_id,
            material_id=material.id,
            bundle_id=body.target_bundle_id,
        )
    except Exception:
        raise missing_field("目标 bundle 不存在或不属于该材料", field="target_bundle_id")
    if target.bundle_revision >= current.bundle_revision:
        raise ApiError(
            ErrorCode.MISSING_FIELD,
            "只能回退到更早的 bundle 版本",
            status_code=422,
        )
    db.commit()
    return ok(
        request,
        {
            "bundle_id": target.id,
            "bundle_revision": target.bundle_revision,
        },
    )


# ---------------------------------------------------------------------------
# 补充实验 / 目标反求
# ---------------------------------------------------------------------------


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/ai-bundles/{{bundle_id}}/experiments",
    status_code=202,
    summary="根据追问生成补充实验",
)
def create_experiment(
    material_id: str,
    bundle_id: str,
    body: ExperimentBody,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
) -> JSONResponse:
    _check_operation(body.operation_id)
    material = owned_material(db, ctx, material_id)
    get_bundle_row(db, bundle_id, ctx.session_id, material.id)
    branch = _get_branch(db, body.branch_id, ctx, material)
    if branch.bundle_id != bundle_id:
        raise missing_field("分支不属于该 bundle", field="branch_id")
    if branch.revision != body.expected_branch_revision:
        raise ApiError(
            ErrorCode.VERSION_CONFLICT,
            f"分支已更新（当前 revision={branch.revision}）",
            status_code=409,
        )
    experiment_request = ExperimentRequest(
        question=body.question,
        recipe_hint=body.recipe_hint,
        selection=body.selection,
        allowed_variables=body.allowed_variables,
        ranges=body.ranges,
        expected_branch_revision=body.expected_branch_revision,
        operation_id=body.operation_id,
    )
    task = enqueue_task(
        db,
        session_id=ctx.session_id,
        material_id=material.id,
        kind="ai_experiment",
        operation_id=body.operation_id,
        input_version=branch.revision,
        input_hash=str((branch.evaluation or {}).get("evaluation_hash") or ""),
        input_json={
            "bundle_id": bundle_id,
            "branch_id": body.branch_id,
            "request": experiment_request.model_dump(mode="json"),
        },
    )
    dispatch_async(task.id)
    return _task_response(request, task)


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/ai-bundles/{{bundle_id}}/target-search",
    status_code=202,
    summary="目标反求（结构化目标表单）",
)
def target_search(
    material_id: str,
    bundle_id: str,
    body: TargetBody,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
) -> JSONResponse:
    _check_operation(body.operation_id)
    material = owned_material(db, ctx, material_id)
    get_bundle_row(db, bundle_id, ctx.session_id, material.id)
    branch = _get_branch(db, body.branch_id, ctx, material)
    if branch.bundle_id != bundle_id:
        raise missing_field("分支不属于该 bundle", field="branch_id")
    if branch.revision != body.expected_branch_revision:
        raise ApiError(
            ErrorCode.VERSION_CONFLICT,
            f"分支已更新（当前 revision={branch.revision}）",
            status_code=409,
        )
    target_request = TargetRequest(
        node_id=body.node_id,
        output=body.output,
        target_value=body.target_value,
        target_vector=body.target_vector,
        variables=body.variables,
        fixed=body.fixed,
        constraints=body.constraints,
        ranges=body.ranges,
        tolerance=body.tolerance,
        max_iterations=body.max_iterations,
        operation_id=body.operation_id,
        expected_branch_revision=body.expected_branch_revision,
    )
    task = enqueue_task(
        db,
        session_id=ctx.session_id,
        material_id=material.id,
        kind="ai_target",
        operation_id=body.operation_id,
        input_version=branch.revision,
        input_json={
            "bundle_id": bundle_id,
            "branch_id": body.branch_id,
            "request": target_request.model_dump(mode="json"),
        },
    )
    dispatch_async(task.id)
    return _task_response(request, task)


@router.get(
    f"{API_PREFIX}/materials/{{material_id}}/ai-experiments/{{experiment_id}}",
    summary="读取补充实验",
)
def get_experiment(
    material_id: str, experiment_id: str, request: Request, ctx: SessionDep, db: DBDep
) -> JSONResponse:
    material = owned_material(db, ctx, material_id)
    row = get_experiment_row(db, experiment_id, ctx.session_id, material.id)
    experiment = experiment_from_row(row)
    return ok(request, experiment.model_dump(mode="json"))


# ---------------------------------------------------------------------------
# 分支
# ---------------------------------------------------------------------------


@router.get(
    f"{API_PREFIX}/materials/{{material_id}}/ai-branches/{{branch_id}}",
    summary="读取分支权威状态",
)
def get_branch(
    material_id: str, branch_id: str, request: Request, ctx: SessionDep, db: DBDep
) -> JSONResponse:
    material = owned_material(db, ctx, material_id)
    row = _get_branch(db, branch_id, ctx, material)
    return ok(request, to_state(row).model_dump(mode="json"))


@router.patch(
    f"{API_PREFIX}/materials/{{material_id}}/ai-branches/{{branch_id}}",
    summary="人工参数变更（事务、版本冲突返回 409）",
)
def patch_branch_values(
    material_id: str,
    branch_id: str,
    body: BranchPatchBody,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
) -> JSONResponse:
    _check_operation(body.operation_id)
    if not body.values and body.overrides is None:
        raise missing_field("参数值与局部覆盖不能同时为空", field="values")
    material = owned_material(db, ctx, material_id)
    row = _get_branch(db, branch_id, ctx, material)
    bundle = get_bundle(db, row.bundle_id, ctx.session_id, material.id)
    try:
        updated = patch_branch(
            db,
            row,
            bundle,
            expected_revision=body.expected_revision,
            operation_id=body.operation_id,
            values=body.values,
            overrides=body.overrides,
        )
    except BranchConflict as exc:
        raise ApiError(ErrorCode.VERSION_CONFLICT, str(exc), status_code=409) from exc
    except ValueError as exc:
        raise missing_field(str(exc), field="values") from exc
    return ok(request, to_state(updated).model_dump(mode="json"))


# ---------------------------------------------------------------------------
# 验收 / 报告
# ---------------------------------------------------------------------------


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/ai-bundles/{{bundle_id}}/validate",
    status_code=202,
    summary="自动验收（来源/计算/交互与视觉证据分开记录）",
)
def validate_bundle_task(
    material_id: str,
    bundle_id: str,
    body: ValidateBody,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
) -> JSONResponse:
    _check_operation(body.operation_id)
    material = owned_material(db, ctx, material_id)
    get_bundle_row(db, bundle_id, ctx.session_id, material.id)
    if body.branch_id:
        branch = _get_branch(db, body.branch_id, ctx, material)
        if branch.bundle_id != bundle_id:
            raise missing_field("分支不属于该 bundle", field="branch_id")
        if body.expected_branch_revision is not None and branch.revision != body.expected_branch_revision:
            raise ApiError(ErrorCode.VERSION_CONFLICT, "分支已更新，请刷新后重试", status_code=409)
    task = enqueue_task(
        db,
        session_id=ctx.session_id,
        material_id=material.id,
        kind="ai_verify",
        operation_id=body.operation_id,
        input_json={
            "bundle_id": bundle_id,
            "branch_id": body.branch_id,
            "expected_branch_revision": body.expected_branch_revision,
            "cases": [case.model_dump(mode="json") for case in body.cases],
            "auto_repair": body.auto_repair,
            "browser": body.browser,
        },
    )
    dispatch_async(task.id)
    return _task_response(request, task)


@router.get(
    f"{API_PREFIX}/materials/{{material_id}}/ai-reports/{{report_id}}",
    summary="读取验收报告",
)
def get_report(
    material_id: str, report_id: str, request: Request, ctx: SessionDep, db: DBDep
) -> JSONResponse:
    material = owned_material(db, ctx, material_id)
    row = get_report_row(db, report_id, ctx.session_id, material.id)
    return ok(request, row.report)


# ---------------------------------------------------------------------------
# 专用视图
# ---------------------------------------------------------------------------


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/ai-bundles/{{bundle_id}}/generated-views",
    status_code=202,
    summary="专用视图生成试验（默认关闭）",
)
def create_generated_view(
    material_id: str,
    bundle_id: str,
    body: GeneratedViewBody,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
) -> JSONResponse:
    _check_operation(body.operation_id)
    if not get_settings().ppt_ai_generated_views_enabled:
        raise ApiError(
            ErrorCode.FORBIDDEN,
            "专用视图生成试验未开启；请使用声明式视图，或在完成隔离验收后开启 PPT_AI_GENERATED_VIEWS_ENABLED",
            status_code=403,
        )
    material = owned_material(db, ctx, material_id)
    get_bundle_row(db, bundle_id, ctx.session_id, material.id)
    branch = _get_branch(db, body.branch_id, ctx, material)
    if branch.bundle_id != bundle_id:
        raise missing_field("分支不属于该 bundle", field="branch_id")
    task = enqueue_task(
        db,
        session_id=ctx.session_id,
        material_id=material.id,
        kind="ai_codegen",
        operation_id=body.operation_id,
        input_json={
            "bundle_id": bundle_id,
            "branch_id": body.branch_id,
            "node_id": body.node_id,
            "requirement": body.requirement,
        },
    )
    dispatch_async(task.id)
    return _task_response(request, task)


@router.get(
    f"{API_PREFIX}/materials/{{material_id}}/ai-artifacts/{{artifact_id}}",
    summary="读取专用视图产物",
)
def get_artifact(
    material_id: str, artifact_id: str, request: Request, ctx: SessionDep, db: DBDep
) -> JSONResponse:
    material = owned_material(db, ctx, material_id)
    from ..ppt_ai.store import get_artifact_row

    row = get_artifact_row(db, artifact_id, ctx.session_id, material.id)
    return ok(request, artifact_from_row(row).model_dump(mode="json"))


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/ai-artifacts/{{artifact_id}}/acceptance",
    summary="记录隔离运行验收结果（只接受与产物哈希一致的证据）",
)
def record_artifact_acceptance(
    material_id: str,
    artifact_id: str,
    body: ArtifactAcceptanceBody,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
) -> JSONResponse:
    material = owned_material(db, ctx, material_id)
    from ..ppt_ai.store import get_artifact_row

    row = get_artifact_row(db, artifact_id, ctx.session_id, material.id)
    if body.status == "accepted":
        if body.evidence.get("artifact_hash") != row.content_hash:
            raise missing_field("验收证据与产物哈希不一致", field="evidence.artifact_hash")
        if not body.evidence.get("nonce_ok") or not body.evidence.get("timeout_ok"):
            raise missing_field("专用视图隔离证据不完整", field="evidence")
    row.acceptance_status = body.status
    row.isolation = {**(row.isolation or {}), "acceptance_evidence": body.evidence}
    row.offline_supported = bool(body.status == "accepted" and row.offline_supported)
    db.commit()
    return ok(
        request,
        {
            "artifact_id": row.id,
            "acceptance_status": row.acceptance_status,
            "offline_supported": row.offline_supported,
            "evidence": body.evidence,
        },
    )


# ---------------------------------------------------------------------------
# 总览 / 能力
# ---------------------------------------------------------------------------


@router.get(
    f"{API_PREFIX}/materials/{{material_id}}/ai-active",
    summary="演示页使用的当前交互 bundle/branch（只读）",
)
def get_active(
    material_id: str, request: Request, ctx: SessionDep, db: DBDep
) -> JSONResponse:
    material = owned_material(db, ctx, material_id)
    bundle_row = latest_bundle_row(db, ctx.session_id, material.id)
    if bundle_row is None:
        return ok(
            request,
            {
                "enabled": get_settings().ppt_ai_enabled,
                "generated_views_enabled": get_settings().ppt_ai_generated_views_enabled,
                "learning_enabled": get_settings().ppt_ai_learning_enabled,
                "bundle": None,
                "branch": None,
                "artifacts": [],
            },
        )
    bundle = get_bundle(db, bundle_row.id, ctx.session_id, material.id)
    branch_row = baseline_branch_row(db, bundle.bundle_id, ctx.session_id, material.id)
    artifacts = [
        artifact_from_row(row).model_dump(mode="json")
        for row in db.scalars(
            select(PptAiArtifactRecord)
            .where(
                PptAiArtifactRecord.bundle_id == bundle.bundle_id,
                PptAiArtifactRecord.acceptance_status == "accepted",
            )
            .order_by(PptAiArtifactRecord.created_at.desc())
            .limit(10)
        ).all()
    ]
    return ok(
        request,
        {
            "enabled": get_settings().ppt_ai_enabled,
            "generated_views_enabled": get_settings().ppt_ai_generated_views_enabled,
            "learning_enabled": get_settings().ppt_ai_learning_enabled,
            "bundle": bundle.model_dump(mode="json"),
            "branch": to_state(branch_row).model_dump(mode="json") if branch_row else None,
            "artifacts": artifacts,
        },
    )


@router.get(
    f"{API_PREFIX}/materials/{{material_id}}/ai-overview",
    summary="PPT AI 工作流总览（只读）",
)
def get_overview(
    material_id: str, request: Request, ctx: SessionDep, db: DBDep
) -> JSONResponse:
    material = owned_material(db, ctx, material_id)
    latest_plan = db.scalar(
        select(PptAiPlanRecord)
        .where(
            PptAiPlanRecord.session_id == ctx.session_id,
            PptAiPlanRecord.material_id == material.id,
        )
        .order_by(PptAiPlanRecord.created_at.desc())
        .limit(1)
    )
    bundle_row = latest_bundle_row(db, ctx.session_id, material.id)
    bundle = get_bundle(db, bundle_row.id, ctx.session_id, material.id) if bundle_row else None
    branch_row = (
        baseline_branch_row(db, bundle.bundle_id, ctx.session_id, material.id)
        if bundle is not None
        else None
    )
    report_row = (
        latest_report_row(db, bundle.bundle_id, ctx.session_id, material.id)
        if bundle is not None
        else None
    )
    experiments = []
    artifacts = []
    if bundle is not None:
        experiments = [
            experiment_from_row(row).model_dump(mode="json")
            for row in db.scalars(
                select(PptAiExperimentRecord)
                .where(PptAiExperimentRecord.bundle_id == bundle.bundle_id)
                .order_by(PptAiExperimentRecord.created_at.desc())
                .limit(20)
            ).all()
        ]
        artifacts = [
            artifact_from_row(row).model_dump(mode="json")
            for row in db.scalars(
                select(PptAiArtifactRecord)
                .where(PptAiArtifactRecord.bundle_id == bundle.bundle_id)
                .order_by(PptAiArtifactRecord.created_at.desc())
                .limit(20)
            ).all()
        ]
    frozen = None
    try:
        if bundle is not None:
            frozen_snapshot = freeze_interactions(
                db,
                material=material,
                session_id=ctx.session_id,
                bundle_id=bundle.bundle_id,
                branch_id=branch_row.id if branch_row else None,
            )
            frozen = public_projection(frozen_snapshot)
    except ValueError:
        frozen = None
    return ok(
        request,
        {
            "ai_enabled": get_settings().ppt_ai_enabled,
            "generated_views_enabled": get_settings().ppt_ai_generated_views_enabled,
            "model": PPTAIClient().status(),
            "document_revision": _document_revision(material.id),
            "plan": latest_plan.document if latest_plan is not None else None,
            "plan_created_at": latest_plan.created_at if latest_plan is not None else None,
            "bundle": bundle.model_dump(mode="json") if bundle is not None else None,
            "bundle_summaries": list_bundles(db, ctx.session_id, material.id),
            "branch": to_state(branch_row).model_dump(mode="json") if branch_row else None,
            "branches": list_branches(
                db, bundle.bundle_id, ctx.session_id, material.id
            )
            if bundle is not None
            else [],
            "report": report_row.report if report_row is not None else None,
            "experiments": experiments,
            "artifacts": artifacts,
            "frozen": frozen,
            "capabilities": REGISTRY.list(),
        },
    )


# ---------------------------------------------------------------------------
# 按页 AI 交互实验
# ---------------------------------------------------------------------------

_PAGE_LAB_LOCKS: dict[tuple[str, int], threading.Lock] = {}
_PAGE_LAB_LOCKS_GUARD = threading.Lock()


class PageLabBody(StrictBody):
    force: bool = False


def _page_lab_lock(material_id: str, page_no: int) -> threading.Lock:
    with _PAGE_LAB_LOCKS_GUARD:
        return _PAGE_LAB_LOCKS.setdefault((material_id, page_no), threading.Lock())


def _check_page_no(material, page_no: int) -> None:
    if page_no < 1 or page_no > int(material.page_count or 0):
        raise missing_field("页码超出范围", field="page_no")


@router.get(
    f"{API_PREFIX}/materials/{{material_id}}/pages/{{page_no}}/ai-lab",
    summary="读取本页已生成的 AI 交互实验（无写副作用）",
)
def get_page_lab(
    material_id: str, page_no: int, request: Request, ctx: SessionDep, db: DBDep
) -> JSONResponse:
    material = owned_material(db, ctx, material_id)
    _check_page_no(material, page_no)
    return ok(request, {"lab": load_cached_lab(material.id, page_no), "model": PPTAIClient().status()})


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/pages/{{page_no}}/ai-lab",
    summary="让模型为本页生成可拖动参数的交互实验",
)
def create_page_lab(
    material_id: str, page_no: int, body: PageLabBody, request: Request, ctx: WriteDep, db: DBDep
) -> JSONResponse:
    material = owned_material(db, ctx, material_id)
    _check_page_no(material, page_no)
    lock = _page_lab_lock(material.id, page_no)
    if not lock.acquire(blocking=False):
        raise ApiError(ErrorCode.RATE_LIMITED, "本页的交互正在生成，请稍候", status_code=429)
    try:
        try:
            context = collect_page_context(db, material.id, page_no, material.title or "")
        except PageLabError as exc:
            raise missing_field(str(exc), field="page_no") from exc
        context_hash = hash_json(context)
        if not body.force:
            cached = load_cached_lab(material.id, page_no)
            if cached is not None and cached.get('context_hash') == context_hash:
                return ok(request, {"lab": cached, "cached": True})
        try:
            lab = generate_page_lab(context, client=PPTAIClient())
        except PPTAIError as exc:
            raise model_unavailable(str(exc)) from exc
        except PageLabError as exc:
            raise model_unavailable(str(exc)) from exc
        lab['context_hash'] = context_hash
        save_cached_lab(material.id, page_no, lab)
        return ok(request, {"lab": lab, "cached": False})
    finally:
        lock.release()


@router.get(f"{API_PREFIX}/ppt-ai/capabilities", summary="PPT AI 能力注册表")
def get_capabilities(request: Request) -> JSONResponse:
    return ok(
        request,
        {
            "version": get_settings().app_version,
            "registry": REGISTRY.list(),
            "templates": catalog_snapshot(),
            "template_contract_version": TEMPLATE_CONTRACT_VERSION,
            "model": PPTAIClient().status(),
            "enabled": get_settings().ppt_ai_enabled,
            "hybrid_matching_enabled": get_settings().ppt_ai_hybrid_matching_enabled,
            "generated_views_enabled": get_settings().ppt_ai_generated_views_enabled,
        },
    )


__all__ = ["router"]
