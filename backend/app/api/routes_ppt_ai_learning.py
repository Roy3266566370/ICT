"""原页学习私有 API（``/api/v1/materials/{material_id}/ai-learning*``）。

读接口无生成副作用；准备、讲解、提问、执行、保存练习与预览均为显式写/任务接口。
全部沿用现有归属、Origin、CSRF 与错误封装；关闭开关时入口不可用，但原阅读照常。
"""

from __future__ import annotations

import logging
import re
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from ..db.models import MaterialRecord
from ..schemas.errors import ApiError, ErrorCode, missing_field, model_unavailable
from ..settings import get_settings
from . import API_PREFIX, DBDep, SessionDep, WriteDep, ok, owned_material
from ..ppt_ai.learning import build_learning_page
from ..ppt_ai.learning_practices import list_practices
from ..ppt_ai.learning_types import LearningContext, LearningPublishSelection
from ..ppt_ai.client import PPTAIError
from ..ppt_ai.page_qa import answer_question, collect_pages
from ..ppt_ai.tasks import dispatch_async, enqueue_task
from ..ppt_ai.util import now_iso

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ppt-ai-learning"])

OPERATION_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]{1,100}$")


def _ppt_ai_enabled() -> None:
    if not get_settings().ppt_ai_enabled:
        raise ApiError(ErrorCode.FORBIDDEN, "PPT AI 交互增强未开启", status_code=403)


router.dependencies.append(Depends(_ppt_ai_enabled))


def _learning_enabled() -> None:
    if not get_settings().ppt_ai_learning_enabled:
        raise ApiError(
            ErrorCode.FORBIDDEN,
            "原页学习入口未开启；原稿阅读、编辑与高级管理仍可使用",
            status_code=403,
        )


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PageQuestionTurn(StrictBody):
    question: str = Field(min_length=1, max_length=2000)
    answer: str = Field(min_length=1, max_length=6000)


class PageQuestionBody(StrictBody):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    history: list[PageQuestionTurn] = Field(default_factory=list, max_length=4)


PAGE_QA_PATH = f"{API_PREFIX}/materials/{{material_id}}/pages/{{page_no}}/learning-qa"


def _page_qa_context(db: DBDep, material_id: str, page_no: int):
    _learning_enabled()
    pages = collect_pages(db, material_id, page_no)
    if not pages:
        raise missing_field("页码超出范围", field="page_no")
    return pages


@router.get(PAGE_QA_PATH, summary="准备本页与相邻页的问答上下文")
def prepare_page_question(material_id: str, page_no: int, request: Request, ctx: SessionDep, db: DBDep) -> JSONResponse:
    material = owned_material(db, ctx, material_id)
    pages = _page_qa_context(db, material.id, page_no)
    return ok(request, {"pages": [
        {"page_no": page["page_no"], "title": page["title"], "has_image": bool(page["_image"])}
        for page in pages
    ]})


@router.post(PAGE_QA_PATH, summary="用视觉模型回答课件问题")
def ask_page_question(material_id: str, page_no: int, body: PageQuestionBody, request: Request, ctx: WriteDep, db: DBDep) -> JSONResponse:
    material = owned_material(db, ctx, material_id)
    pages = _page_qa_context(db, material.id, page_no)
    db.rollback()  # Release the database connection before the model request.
    try:
        answer = answer_question(page_no, pages, body.question, [turn.model_dump() for turn in body.history])
    except PPTAIError as error:
        raise model_unavailable(str(error)) from error
    return ok(request, answer.model_dump())


class PrepareBody(StrictBody):
    expected_document_revision: int | None = Field(default=None, ge=0)
    region_ids: list[str] = Field(default_factory=list, max_length=100)
    purpose: str = Field(default="", max_length=500)
    operation_id: str = Field(min_length=1, max_length=100)


class ExplanationBody(StrictBody):
    context: LearningContext
    mode: Literal["concept", "change"] = "concept"
    operation_id: str = Field(min_length=1, max_length=100)


class QuestionBody(StrictBody):
    context: LearningContext
    question: str = Field(min_length=1, max_length=2000)
    suggested_action: Literal[
        "explain", "run_experiment", "solve_target", "compare", "counterexample"
    ] | None = None
    operation_id: str = Field(min_length=1, max_length=100)


class ExecuteBody(StrictBody):
    context: LearningContext
    operation_id: str = Field(min_length=1, max_length=100)


class PracticeBody(StrictBody):
    context: LearningContext
    title: str = Field(default="", max_length=200)
    operation_id: str = Field(min_length=1, max_length=100)


class PreviewBody(StrictBody):
    selection: LearningPublishSelection


class VerifyBody(StrictBody):
    bundle_id: str = Field(min_length=1, max_length=96)
    expected_bundle_revision: int = Field(ge=1)
    branch_id: str = Field(min_length=1, max_length=96)
    expected_branch_revision: int = Field(ge=1)
    expected_document_revision: int | None = Field(default=None, ge=0)
    selected_learning_item_ids: list[str] = Field(default_factory=list, max_length=200)
    operation_id: str = Field(min_length=1, max_length=100)


def _check_operation(operation_id: str) -> None:
    if OPERATION_PATTERN.match(operation_id or "") is None:
        raise missing_field("操作标识不合法", field="operation_id")


def _task_response(request: Request, row, material: MaterialRecord) -> JSONResponse:
    return ok(
        request,
        {
            "task_id": row.id,
            "status": row.status,
            "stage": row.stage,
            "status_url": f"{API_PREFIX}/materials/{material.id}/ai-tasks/{row.id}",
        },
        status_code=202,
    )


@router.get(
    f"{API_PREFIX}/materials/{{material_id}}/ai-learning",
    summary="按页读取学习呈现（只读，不调用模型）",
)
def get_learning_page(
    material_id: str,
    request: Request,
    ctx: SessionDep,
    db: DBDep,
    page_no: int = Query(default=1, ge=1, le=500),
    node_id: str | None = Query(default=None, max_length=96),
) -> JSONResponse:
    material = owned_material(db, ctx, material_id)
    page = build_learning_page(
        db, material=material, session_id=ctx.session_id, page_no=page_no, node_id=node_id
    )
    return ok(request, page.model_dump(mode="json"))


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/ai-learning/prepare",
    status_code=202,
    summary="准备本页学习内容（复用规划/编译，异步）",
)
def prepare_learning(
    material_id: str, body: PrepareBody, request: Request, ctx: WriteDep, db: DBDep
) -> JSONResponse:
    _learning_enabled()
    _check_operation(body.operation_id)
    material = owned_material(db, ctx, material_id)
    task = enqueue_task(
        db,
        session_id=ctx.session_id,
        material_id=material.id,
        kind="ai_learn_prepare",
        operation_id=body.operation_id,
        input_version=body.expected_document_revision or 0,
        input_json={
            "expected_document_revision": body.expected_document_revision,
            "region_ids": body.region_ids,
            "purpose": body.purpose,
        },
    )
    dispatch_async(task.id)
    return _task_response(request, task, material)


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/ai-learning/explanations",
    status_code=202,
    summary="生成或复用与当前条件匹配的讲解",
)
def create_explanation(
    material_id: str, body: ExplanationBody, request: Request, ctx: WriteDep, db: DBDep
) -> JSONResponse:
    _learning_enabled()
    _check_operation(body.operation_id)
    material = owned_material(db, ctx, material_id)
    task = enqueue_task(
        db,
        session_id=ctx.session_id,
        material_id=material.id,
        kind="ai_learn_explain",
        operation_id=body.operation_id,
        input_hash=body.context.input_hash or "",
        input_json={
            "context": body.context.model_dump(mode="json"),
            "mode": body.mode,
        },
    )
    dispatch_async(task.id)
    return _task_response(request, task, material)


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/ai-learning/questions",
    status_code=202,
    summary="当前上下文提问（受限意图；返回答案卡或待确认草案）",
)
def create_question(
    material_id: str, body: QuestionBody, request: Request, ctx: WriteDep, db: DBDep
) -> JSONResponse:
    _learning_enabled()
    _check_operation(body.operation_id)
    material = owned_material(db, ctx, material_id)
    task = enqueue_task(
        db,
        session_id=ctx.session_id,
        material_id=material.id,
        kind="ai_learn_question",
        operation_id=body.operation_id,
        input_hash=body.context.input_hash or "",
        input_json={
            "context": body.context.model_dump(mode="json"),
            "question": body.question,
            "suggested_action": body.suggested_action,
        },
    )
    dispatch_async(task.id)
    return _task_response(request, task, material)


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/ai-learning/actions/{{action_id}}/execute",
    status_code=202,
    summary="执行已落库的学习草案（显式确认后）",
)
def execute_action(
    material_id: str,
    action_id: str,
    body: ExecuteBody,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
) -> JSONResponse:
    _learning_enabled()
    _check_operation(body.operation_id)
    material = owned_material(db, ctx, material_id)
    task = enqueue_task(
        db,
        session_id=ctx.session_id,
        material_id=material.id,
        kind="ai_learn_execute",
        operation_id=body.operation_id,
        input_hash=body.context.input_hash or "",
        input_json={
            "action_id": action_id,
            "context": body.context.model_dump(mode="json"),
        },
    )
    dispatch_async(task.id)
    return _task_response(request, task, material)


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/ai-learning/practices",
    status_code=202,
    summary="保存个人探索（独立 practice 分支，不改课件基准）",
)
def create_practice(
    material_id: str, body: PracticeBody, request: Request, ctx: WriteDep, db: DBDep
) -> JSONResponse:
    _learning_enabled()
    _check_operation(body.operation_id)
    material = owned_material(db, ctx, material_id)
    task = enqueue_task(
        db,
        session_id=ctx.session_id,
        material_id=material.id,
        kind="ai_learn_practice",
        operation_id=body.operation_id,
        input_hash=body.context.input_hash or "",
        input_json={
            "context": body.context.model_dump(mode="json"),
            "title": body.title,
        },
    )
    dispatch_async(task.id)
    return _task_response(request, task, material)


@router.get(
    f"{API_PREFIX}/materials/{{material_id}}/ai-learning/practices",
    summary="列出本人保存的探索（不含他人记录）",
)
def get_practices(
    material_id: str,
    request: Request,
    ctx: SessionDep,
    db: DBDep,
    bundle_id: str | None = Query(default=None, max_length=96),
) -> JSONResponse:
    material = owned_material(db, ctx, material_id)
    items = list_practices(
        db, session_id=ctx.session_id, material_id=material.id, bundle_id=bundle_id
    )
    return ok(
        request,
        {"items": [item.model_dump(mode="json") for item in items], "count": len(items)},
    )


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/ai-learning/validate",
    status_code=202,
    summary="服务端受信浏览器验证（生成临时离线 HTML 并实际点击）",
)
def verify_learning_runtime(
    material_id: str, body: VerifyBody, request: Request, ctx: WriteDep, db: DBDep
) -> JSONResponse:
    _learning_enabled()
    _check_operation(body.operation_id)
    material = owned_material(db, ctx, material_id)
    task = enqueue_task(
        db,
        session_id=ctx.session_id,
        material_id=material.id,
        kind="ai_learn_verify",
        operation_id=body.operation_id,
        input_json={
            "bundle_id": body.bundle_id,
            "expected_bundle_revision": body.expected_bundle_revision,
            "branch_id": body.branch_id,
            "expected_branch_revision": body.expected_branch_revision,
            "expected_document_revision": body.expected_document_revision,
            "selected_learning_item_ids": body.selected_learning_item_ids,
        },
    )
    dispatch_async(task.id)
    return _task_response(request, task, material)


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/ai-learning/preview",
    summary="接收者预览（与正式分享共用冻结逻辑；不创建公开链接）",
)
def preview_learning(
    material_id: str, body: PreviewBody, request: Request, ctx: WriteDep, db: DBDep
) -> JSONResponse:
    _learning_enabled()
    material = owned_material(db, ctx, material_id)
    from ..ppt_ai.learning_publish import preview_publication

    result = preview_publication(
        db,
        material=material,
        session_id=ctx.session_id,
        selection=body.selection,
    )
    return ok(request, result)


@router.get(
    f"{API_PREFIX}/materials/{{material_id}}/ai-learning/health",
    summary="学习入口能力（供前端决定是否显示入口）",
)
def learning_health(material_id: str, request: Request, ctx: SessionDep, db: DBDep) -> JSONResponse:
    material = owned_material(db, ctx, material_id)
    return ok(
        request,
        {
            "pp_enabled": get_settings().ppt_ai_enabled,
            "learning_enabled": get_settings().ppt_ai_learning_enabled,
            "material_id": material.id,
            "checked_at": now_iso(),
        },
    )


__all__ = ["router"]
