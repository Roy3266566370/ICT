"""题目交互实验室端点。

与课件材料入口并列，但使用独立的数据表与文件目录：

- ``POST /labs``：PDF / 图片 / PPTX / 文本多文件上传，按用途拆分；
- ``POST /labs/text``：粘贴题目文字，便于快速核对与自动化测试；
- ``GET /labs`` / ``GET /labs/{id}``：列表与完整文档；
- ``PATCH /labs/{id}``：保存参数、步骤、情景、笔记与尝试（乐观锁）；
- ``POST /labs/{id}/review``：学生核对/修正条件后重新编译题目；
- ``POST /labs/{id}/assistant``：基于当前步骤的本地讲解；模型增强需显式开启；
- ``POST /labs/{id}/attempts``：检查一次尝试并写回学习记录；
- ``POST /labs/{id}/share``：生成只读快照；``GET /lab-shares/{share_id}`` 公开读取。

本地模型由确定性引擎计算。旧学习助手的模型增强由 ``LAB_AI_ENABLED`` 控制；
``ai-solve`` 由工作台在本地识别失败后自动触发，也支持显式重试，分别保存内核计算与 AI 参考结果。
公开快照不包含会话、Cookie 或文件系统路径。
"""

from __future__ import annotations

import logging
import re
import shutil
import copy
import threading
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update

from ..db.models import LabRecord, LabShareRecord
from ..schemas.common import iso_after, to_iso, utc_now
from ..schemas.errors import (
    invalid_file,
    limit_exceeded,
    missing_field,
    model_unavailable,
    resource_unavailable,
    version_conflict,
)
from ..settings import LABS_DIR, get_settings
from . import API_PREFIX, DBDep, SessionDep, WriteDep, ok

logger = logging.getLogger(__name__)

router = APIRouter(prefix=API_PREFIX, tags=["labs"])

PREVIEW_KEY = re.compile(r"^f\d+_p\d+$")
SUBJECTS = {"calculus", "optimization", "algorithm", "deep_learning", "linear_algebra", "operating_system"}
_AI_SOLVE_LOCK = threading.Lock()
_AI_SOLVING: set[str] = set()


# ---------------------------------------------------------------------------
# 请求体
# ---------------------------------------------------------------------------


class TextLabRequest(BaseModel):
    title: str = Field(default="", max_length=120)
    text: str = Field(min_length=1, max_length=200000)
    subject: str | None = None


class ManualLabRequest(BaseModel):
    task: Literal['integral', 'antiderivative', 'derivative', 'limit', 'higher_derivative', 'continuity', 'implicit_normal', 'function_study', 'taylor', 'geometric_area', 'rotation_volume', 'ode', 'multivariable', 'multivariable_extrema', 'double_integral', 'triple_integral', 'series_convergence', 'power_series', 'fourier_series', 'space_geometry', 'curve_surface_integral', 'proof']
    conditions: dict[str, Any]
    title: str = Field(default='', max_length=120)
    confirmed: bool = False


class LabStatePatch(BaseModel):
    expected_revision: int = Field(ge=1)
    selected_problem_id: str | None = None
    state: dict[str, Any] | None = None


class ReviewRequest(BaseModel):
    problem_id: str
    text: str | None = Field(default=None, max_length=200000)
    subject: str | None = None
    condition_values: dict[str, Any] = Field(default_factory=dict)
    ambiguity_answers: dict[str, str] = Field(default_factory=dict)


class AssistantRequest(BaseModel):
    question: str = Field(default="", max_length=2000)
    mode: str = Field(default="explore", pattern="^(explore|guided|solution)$")
    step: int = Field(default=0, ge=0, le=400)
    params: dict[str, Any] = Field(default_factory=dict)
    selected: dict[str, Any] | None = None
    hint_level: int | None = Field(default=None, ge=1, le=3)
    use_ai: bool = False


class AttemptRequest(BaseModel):
    answer: str = Field(min_length=1, max_length=2000)
    field: str = Field(default="", max_length=32)
    params: dict[str, Any] = Field(default_factory=dict)
    kind: str = Field(default="numeric", max_length=24)
    problem_id: str | None = None


class AISolveRequest(BaseModel):
    problem_id: str = Field(min_length=1, max_length=64)
    expected_revision: int = Field(ge=1)
    mode: str = Field(default="auto", pattern="^(auto|direct)$")
    force: bool = False


# ---------------------------------------------------------------------------
# 文档与权限
# ---------------------------------------------------------------------------


def _lab_payload(record: LabRecord) -> dict[str, Any]:
    from ..ppt_ai.client import PPTAIClient
    document = copy.deepcopy(record.document)
    document.setdefault("capabilities", {})["ai_solver_configured"] = (get_settings().lab_understanding_provider == 'ollama' or PPTAIClient().available())
    return document


def _owned_lab(db: Any, ctx: Any, lab_id: str) -> LabRecord:
    row = db.get(LabRecord, lab_id)
    if row is None or row.session_id != ctx.session_id:
        raise resource_unavailable()
    return row


def _problem(document: dict[str, Any], problem_id: str | None = None) -> dict[str, Any]:
    problems = document.get("problems") or []
    target_id = problem_id or document.get("selected_problem_id")
    for problem in problems:
        if problem.get("problem_id") == target_id:
            return problem
    if problems:
        return problems[0]
    raise missing_field("实验室没有可用的题目")


def _document_needs_review(problem: dict[str, Any]) -> bool:
    return any(
        item.get("severity") == "blocking" and not item.get("resolved")
        for item in (problem.get("recognition") or {}).get("ambiguities") or []
    )


def _read_upload(upload: UploadFile, limit: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = upload.file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise limit_exceeded(f"单个文件超过 {limit // (1024 * 1024)}MB 上限")
        chunks.append(chunk)
    if total == 0:
        raise invalid_file("上传文件为空")
    return b"".join(chunks)


def _new_lab_record(
    *,
    db: Any,
    ctx: Any,
    document: dict[str, Any],
    title: str,
) -> LabRecord:
    now = utc_now()
    expires = iso_after(get_settings().material_retention_hours, base=now)
    record = LabRecord(
        id=document["lab_id"],
        session_id=ctx.session_id,
        title=title,
        subject=str(document.get("subject") or "unknown"),
        status=str(document.get("status") or "ready"),
        problem_count=int(document.get("problem_count") or 1),
        revision=int(document.get("revision") or 1),
        document=document,
        created_at=document["created_at"],
        updated_at=document["updated_at"],
        expires_at=expires,
    )
    db.add(record)
    db.commit()
    return record


def _touch(record: LabRecord, document: dict[str, Any]) -> None:
    document["revision"] = int(document.get("revision") or 1) + 1
    document["updated_at"] = to_iso(utc_now())
    problem = _problem(document)
    document["subject"] = problem.get("subject") or document.get("subject")
    document["status"] = problem.get("status") or document.get("status")
    record.document = document
    record.revision = int(document["revision"])
    record.title = str(document.get("title") or record.title)
    record.subject = str(document.get("subject") or record.subject)
    record.status = str(document.get("status") or record.status)
    record.problem_count = int(document.get("problem_count") or record.problem_count)
    record.updated_at = str(document["updated_at"])


def _build_and_store(
    *,
    request: Request,
    db: Any,
    ctx: Any,
    lab_id: str,
    title: str,
    source: dict[str, Any],
    files: list[dict[str, Any]],
    subject_hint: str | None = None,
) -> JSONResponse:
    from ..labs.recognize import RecognitionError, build_lab_document
    from ..labs.ai import LabAI

    now = to_iso(utc_now())
    try:
        document = build_lab_document(
            lab_id=lab_id,
            title=title,
            source=source,
            files=files,
            now_iso=now,
            subject_hint=subject_hint,
            max_problems=12,
        )
    except RecognitionError as exc:
        raise invalid_file(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - 识别失败不留下半成品
        logger.exception("实验室识别失败 lab=%s", lab_id)
        raise invalid_file(f"题目识别失败：{type(exc).__name__}") from exc
    ai_ready = LabAI().available()
    document.setdefault("capabilities", {})["ai_configured"] = ai_ready
    document["capabilities"]["ai_note"] = (
        "已配置模型增强，但只有你显式选择“使用模型增强”时才会调用。"
        if ai_ready
        else "本地识别与本地导师；模型增强未开启。"
    )
    from ..ppt_ai.client import PPTAIClient
    document["capabilities"]["ai_solver_configured"] = (get_settings().lab_understanding_provider == 'ollama' or PPTAIClient().available())
    record = _new_lab_record(db=db, ctx=ctx, document=document, title=title)
    return ok(request, record.document, status_code=201)


# ---------------------------------------------------------------------------
# 创建与读取
# ---------------------------------------------------------------------------


@router.get("/labs/capabilities", summary="题目实验室能力与限制")
def lab_capabilities(request: Request, ctx: SessionDep) -> JSONResponse:
    from ..labs.kernel_models import task_catalog
    _ = ctx
    from ..labs.ai import LabAI

    settings = get_settings()
    ai_ready = LabAI().available()
    return ok(
        request,
        {
            "formats": ["pdf", "png", "jpg", "jpeg", "webp", "pptx", "txt", "md", "csv"],
            "roles": [
                {"id": "problem", "label": "题目"},
                {"id": "data", "label": "补充数据"},
                {"id": "attempt", "label": "我的解答"},
                {"id": "reference", "label": "参考答案"},
                {"id": "courseware", "label": "课件"},
            ],
            "subjects": [
                {"id": "calculus", "label": "微积分"},
                {"id": "optimization", "label": "最优化"},
                {"id": "algorithm", "label": "数据结构与算法"},
                {"id": "deep_learning", "label": "深度学习"},
                {"id": "linear_algebra", "label": "线性代数"},
                {"id": "operating_system", "label": "操作系统"},
            ],
            'modeling_tasks':task_catalog(),
            "max_files": settings.lab_max_files,
            "max_pages": settings.lab_max_pages,
            "max_text_chars": settings.lab_max_text_chars,
            "max_upload_bytes": settings.max_upload_bytes,
            "ai_configured": ai_ready,
            "ai_enabled": settings.lab_ai_enabled,
            "ai_default": False,
            "note": "优先本地识别与求解；未识别题目在工作台自动使用已配置模型理解、建模与计算。学习助手的模型增强仍需显式开启并勾选。",
        },
    )


@router.post('/labs/manual/preview', summary='校验手动输入并生成题目确认预览')
def preview_manual_lab(request: Request, ctx: WriteDep, body: ManualLabRequest) -> JSONResponse:
    from ..labs.manual import preview_integral
    try:
        preview = preview_integral(body.task, body.conditions)
    except (ValueError, TypeError, ArithmeticError) as exc:
        raise missing_field(str(exc)) from exc
    return ok(request, preview)


@router.post('/labs/manual', status_code=201, summary='按用户确认的积分条件调用内核并建立实验')
def create_manual_lab(request: Request, ctx: WriteDep, db: DBDep, body: ManualLabRequest) -> JSONResponse:
    from ..labs.manual import build_manual_document
    if not body.confirmed:
        raise missing_field('请先确认公式、积分变量和条件，再开始计算')
    try:
        document = build_manual_document(lab_id=f'lab_{uuid4().hex}', title=body.title,
            task=body.task, conditions=body.conditions, now_iso=to_iso(utc_now()))
    except (ValueError, TypeError, ArithmeticError) as exc:
        raise missing_field('当前输入未能完成计算：' + str(exc)) from exc
    record = _new_lab_record(db=db, ctx=ctx, document=document, title=document['title'])
    return ok(request, record.document, status_code=201)


@router.post("/labs/text", status_code=201, summary="粘贴题目文字并建立实验室")
def create_text_lab(request: Request, ctx: WriteDep, db: DBDep, body: TextLabRequest) -> JSONResponse:
    settings = get_settings()
    text = body.text.strip()
    if len(text) > settings.lab_max_text_chars:
        raise limit_exceeded(f"题目文字超过 {settings.lab_max_text_chars} 字上限")
    if not text:
        raise missing_field("题目文字为空")
    lab_id = f"lab_{uuid4().hex}"
    from ..labs.extract import text_source

    source = text_source(text, lab_id=lab_id)
    title = (body.title or text.splitlines()[0] or "题目实验室")[:120]
    subject = body.subject if body.subject in SUBJECTS else None
    return _build_and_store(
        request=request,
        db=db,
        ctx=ctx,
        lab_id=lab_id,
        title=title,
        source=source,
        files=source["files"],
        subject_hint=subject,
    )


@router.post("/labs", status_code=201, summary="上传 PDF/图片/PPTX 并识别一道或多道题")
def create_lab_from_files(
    request: Request,
    ctx: WriteDep,
    db: DBDep,
    files: list[UploadFile] = File(...),
    roles: list[str] = Form([]),
    title: str = Form(""),
    subject: str = Form(""),
) -> JSONResponse:
    settings = get_settings()
    if not files:
        raise invalid_file("没有选择文件")
    if len(files) > settings.lab_max_files:
        raise limit_exceeded(f"最多同时上传 {settings.lab_max_files} 个文件")
    normalized_roles = [role if role in {"problem", "data", "attempt", "reference", "courseware"} else "problem" for role in roles]
    if not normalized_roles:
        normalized_roles = ["problem"] * len(files)
    if len(normalized_roles) > len(files):
        normalized_roles = normalized_roles[: len(files)]
    while len(normalized_roles) < len(files):
        normalized_roles.append("problem")

    lab_id = f"lab_{uuid4().hex}"
    lab_dir = LABS_DIR / lab_id
    try:
        uploads: list[tuple[str, str, str, bytes]] = []
        for index, upload in enumerate(files):
            name = upload.filename or f"file-{index + 1}"
            data = _read_upload(upload, settings.max_upload_bytes)
            uploads.append((f"f{index + 1}", name, normalized_roles[index], data))
        from ..labs.extract import ExtractError, extract_files

        source = extract_files(uploads, lab_id=lab_id)
        files_meta = source["files"]
        resolved_title = (title or Path(files[0].filename or "题目实验室").stem)[:120]
        return _build_and_store(
            request=request,
            db=db,
            ctx=ctx,
            lab_id=lab_id,
            title=resolved_title,
            source=source,
            files=files_meta,
            subject_hint=subject if subject in SUBJECTS else None,
        )
    except Exception:
        shutil.rmtree(lab_dir, ignore_errors=True)
        raise


@router.get("/labs", summary="当前会话的实验室列表")
def list_labs(request: Request, ctx: SessionDep, db: DBDep) -> JSONResponse:
    rows = list(
        db.scalars(
            select(LabRecord)
            .where(LabRecord.session_id == ctx.session_id)
            .order_by(LabRecord.updated_at.desc(), LabRecord.id.desc())
            .limit(30)
        ).all()
    )
    from ..labs.store import summary

    return ok(request, {"items": [summary(row.document) for row in rows]})


@router.get("/labs/{lab_id}", summary="读取实验室完整文档")
def get_lab(lab_id: str, request: Request, ctx: SessionDep, db: DBDep) -> JSONResponse:
    record = _owned_lab(db, ctx, lab_id)
    return ok(request, _lab_payload(record))


@router.patch("/labs/{lab_id}", summary="保存参数、步骤、情景、笔记与尝试")
def update_lab(lab_id: str, request: Request, ctx: WriteDep, db: DBDep, body: LabStatePatch) -> JSONResponse:
    record = _owned_lab(db, ctx, lab_id)
    document = dict(record.document)
    if body.expected_revision != int(document.get("revision") or 1):
        raise version_conflict("实验室内容已更新，请重新载入后再保存", current_revision=document.get("revision"))
    if body.selected_problem_id:
        target = next(
            (item for item in document.get("problems") or [] if item.get("problem_id") == body.selected_problem_id),
            None,
        )
        if target is None:
            raise missing_field("选择的题目不存在")
        document["selected_problem_id"] = body.selected_problem_id
    problem = _problem(document, document.get("selected_problem_id"))
    from ..labs.store import save_state

    try:
        state = save_state(
            document,
            problem.get("problem_id"),
            body.state if body.state is not None else (problem.get("states") or {}),
        )
    except ValueError as exc:
        raise missing_field(str(exc)) from exc
    _touch(record, document)
    db.commit()
    return ok(request, {"revision": document["revision"], "document": record.document, "state": state})


@router.post("/labs/{lab_id}/review", summary="核对或修正条件后重新编译题目")
def review_lab(lab_id: str, request: Request, ctx: WriteDep, db: DBDep, body: ReviewRequest) -> JSONResponse:
    record = _owned_lab(db, ctx, lab_id)
    document = dict(record.document)
    target = next(
        (item for item in document.get("problems") or [] if item.get("problem_id") == body.problem_id),
        None,
    )
    if target is None:
        raise missing_field("题目不存在")
    if body.subject and body.subject not in SUBJECTS and body.subject != "unknown":
        raise missing_field("不支持的题目类型")
    from ..labs.recognize import rebuild_problem
    from ..labs.store import save_state

    try:
        if target.get('manual_input'):
            if (body.text is not None and body.text.strip() != target['text'].strip()) or body.subject not in (None, 'calculus'):
                raise ValueError('手动积分题请通过公式和条件字段修正，不重新识别题干')
            from ..labs.manual import revise_manual_document
            rebuilt = revise_manual_document(document, target, body.condition_values)
        else:
            rebuilt = rebuild_problem(
                target,
                files=(document.get("source") or {}).get("files") or [],
                text=body.text,
                subject=body.subject,
                condition_values=body.condition_values,
                ambiguity_answers=body.ambiguity_answers,
            )
    except Exception as exc:  # noqa: BLE001 - 修正内容仍保留在原文里
        raise missing_field(f"修正后的条件无法建立模型：{exc}") from exc
    if (target.get('ai_solution') or {}).get('agent_understanding') and not body.condition_values and (not body.subject or body.subject == target['subject']) and (body.text is None or body.text.strip() == target['text'].strip()):
        # A confirmation must preserve the visual model instead of rebuilding from OCR.
        rebuilt = copy.deepcopy(target)
        for ambiguity in rebuilt['recognition']['ambiguities']:
            if ambiguity.get('id') == 'source_formula_confirmation' and body.ambiguity_answers.get(ambiguity['id']) == 'confirmed':
                ambiguity.update(resolved=True, answer='confirmed')
        from ..labs.local_agent import finish_understanding
        from ..labs.ai_solve import attach_interactive_model
        rebuilt['ai_solution'] = finish_understanding(rebuilt['ai_solution']['agent_understanding'], rebuilt)
        attach_interactive_model(rebuilt, rebuilt['ai_solution'])
    replace_index = next(
        index for index, item in enumerate(document["problems"]) if item.get("problem_id") == body.problem_id
    )
    document["problems"][replace_index] = rebuilt
    document["selected_problem_id"] = body.problem_id
    save_state(document, body.problem_id, rebuilt.get("states") or {})
    _touch(record, document)
    db.commit()
    return ok(request, record.document)


@router.post("/labs/{lab_id}/assistant", summary="按当前步骤讲解；默认本地导师")
def lab_assistant(lab_id: str, request: Request, ctx: WriteDep, db: DBDep, body: AssistantRequest) -> JSONResponse:
    record = _owned_lab(db, ctx, lab_id)
    document = record.document
    problem = _problem(document, document.get("selected_problem_id"))
    from ..labs.ai import LabAI
    from ..labs.assistant import ask
    from ..labs.store import normalize_params
    from ..labs.solvers import evaluate_problem

    model = problem.get("model") or {}
    params = normalize_params(body.params, model)
    if _document_needs_review(problem):
        return ok(
            request,
            {
                "answer": "这道题还有需要核对的关键条件。先在左侧“条件与识别”里确认区间、初始点或图数据，再让我展开讲解。",
                "local": True,
                "context": {"blocked": True},
            },
        )
    try:
        evaluation = evaluate_problem(model, params)
    except Exception as exc:  # noqa: BLE001
        raise missing_field(f"当前参数无法计算：{type(exc).__name__}") from exc
    result = ask(
        problem,
        evaluation,
        question=body.question.strip(),
        mode=body.mode,
        step=body.step,
        selected=body.selected,
        hint_level=body.hint_level,
        use_ai=bool(body.use_ai),
        ai=LabAI(),
    )
    return ok(request, result)


@router.post("/labs/{lab_id}/attempts", summary="检查学生尝试并写回学习记录")
def lab_attempt(lab_id: str, request: Request, ctx: WriteDep, db: DBDep, body: AttemptRequest) -> JSONResponse:
    record = _owned_lab(db, ctx, lab_id)
    document = dict(record.document)
    problem = _problem(document, body.problem_id or document.get("selected_problem_id"))
    if body.problem_id and problem.get("problem_id") != body.problem_id:
        raise missing_field("题目不存在")
    ai_attempt = body.field == "ai_solution"
    if not ai_attempt and _document_needs_review(problem):
        raise missing_field("先核对关键条件，再提交尝试")
    from ..labs.assistant import check_attempt
    from ..labs.store import normalize_params, save_state
    from ..labs.solvers import evaluate_problem

    model = problem.get("model") or {}
    params = normalize_params(body.params, model)
    if ai_attempt:
        from ..labs.ai_solve import check_ai_answer
        try:
            checked = check_ai_answer(problem, body.answer.strip())
        except ValueError as exc:
            raise missing_field(str(exc)) from exc
    else:
        try:
            evaluation = evaluate_problem(model, params)
        except Exception as exc:  # noqa: BLE001
            raise missing_field(f"当前参数无法计算：{type(exc).__name__}") from exc
        checked = check_attempt(problem, evaluation, answer=body.answer.strip(), field=body.field, kind=body.kind)
    state = dict(problem.get("states") or {})
    attempts = list(state.get("attempts") or [])
    attempt = {
        "id": f"att_{uuid4().hex[:12]}",
        "answer": body.answer.strip()[:1200],
        "correct": bool(checked.get("correct")),
        "feedback": str(checked.get("feedback") or "")[:2000],
        "field": body.field or "numeric",
        "created_at": to_iso(utc_now()),
    }
    attempts.append(attempt)
    state["attempts"] = attempts[-40:]
    save_state(document, problem.get("problem_id"), state)
    _touch(record, document)
    db.commit()
    return ok(request, {"attempt": attempt, "checked": checked, "document": record.document})


@router.post("/labs/{lab_id}/ai-solve", summary="AI 理解题意、内核计算或直接参考解答")
def solve_lab_with_ai(lab_id: str, body: AISolveRequest, request: Request, ctx: WriteDep, db: DBDep) -> JSONResponse:
    from ..labs.ai_solve import solve_with_ai, attach_interactive_model, VERSION
    from ..ppt_ai.client import PPTAIError
    from ..ppt_ai.util import hash_json
    from ..schemas.errors import ApiError, ErrorCode
    record = _owned_lab(db, ctx, lab_id)
    if record.revision != body.expected_revision:
        raise version_conflict("题目或学习记录已有修改，请先同步再求解")
    document = copy.deepcopy(record.document)
    target = next((p for p in document["problems"] if p["problem_id"] == body.problem_id), None)
    if target is None:
        raise missing_field("题目不存在")
    from ..labs.local_agent import input_hash as local_input_hash
    local = get_settings().lab_understanding_provider == 'ollama'
    input_hash = local_input_hash(target, lab_id, body.mode) if local else hash_json({
        "version": VERSION, "text": target["text"], "mode": body.mode,
        "ambiguities": target["recognition"].get("ambiguities") or []})
    if not body.force and (target.get("ai_solution") or {}).get("input_hash") == input_hash:
        return ok(request, {"document": _lab_payload(record), "cached": True})
    with _AI_SOLVE_LOCK:
        if lab_id in _AI_SOLVING:
            raise ApiError(ErrorCode.RATE_LIMITED, "当前实验室正在进行 AI 求解，请稍候")
        _AI_SOLVING.add(lab_id)
    try:
        db.rollback()
        try:
            result = solve_with_ai(target, mode=body.mode, lab_id=lab_id)
        except (PPTAIError, ValueError) as exc:
            raise model_unavailable(str(exc)) from exc
        result["input_hash"] = input_hash
        target["ai_solution"] = result
        target["recognition"]["ai_used"] = True
        if attach_interactive_model(target, result):
            result['input_hash'] = local_input_hash(target, lab_id, body.mode) if local else hash_json({'version':VERSION, 'text':target['text'], 'mode':body.mode,
                                             'ambiguities':target['recognition'].get('ambiguities') or []})
            if document.get('selected_problem_id') == target['problem_id']:
                document.update(subject=target['subject'], status=target['status'])
        document["revision"] += 1
        document["updated_at"] = to_iso(utc_now())
        written = db.execute(update(LabRecord).where(LabRecord.id == lab_id, LabRecord.session_id == ctx.session_id,
            LabRecord.revision == body.expected_revision).values(document=document, revision=document["revision"], updated_at=document["updated_at"]))
        if written.rowcount != 1:
            db.rollback()
            raise version_conflict("AI 求解期间题目或学习记录已修改，已保留原有内容，请重新载入")
        db.commit()
        return ok(request, {"document": _lab_payload(_owned_lab(db, ctx, lab_id)), "cached": False})
    finally:
        with _AI_SOLVE_LOCK:
            _AI_SOLVING.discard(lab_id)


# ---------------------------------------------------------------------------
# 文件预览
# ---------------------------------------------------------------------------


def _preview_path(lab_id: str, preview_key: str) -> Path:
    if PREVIEW_KEY.match(preview_key) is None:
        raise resource_unavailable()
    base = (LABS_DIR / lab_id / "previews").resolve()
    target = (base / f"{preview_key}.png").resolve()
    try:
        target.relative_to(base)
    except ValueError:
        raise resource_unavailable() from None
    if not target.is_file():
        raise resource_unavailable()
    return target


@router.get("/labs/{lab_id}/preview/{preview_key}", summary="受鉴权的题目页预览")
def lab_preview(lab_id: str, preview_key: str, ctx: SessionDep, db: DBDep) -> FileResponse:
    record = _owned_lab(db, ctx, lab_id)
    from ..labs.store import preview_keys

    if preview_key not in preview_keys(record.document):
        raise resource_unavailable()
    return FileResponse(_preview_path(lab_id, preview_key), media_type="image/png", filename=f"{preview_key}.png")


# ---------------------------------------------------------------------------
# 分享
# ---------------------------------------------------------------------------


@router.post("/labs/{lab_id}/share", status_code=201, summary="生成只读学习成果分享")
def share_lab(lab_id: str, request: Request, ctx: WriteDep, db: DBDep) -> JSONResponse:
    record = _owned_lab(db, ctx, lab_id)
    from ..labs.store import new_share_id, shared_snapshot

    share_id = new_share_id()
    snapshot = shared_snapshot(record.document, share_id=share_id)
    db.add(
        LabShareRecord(
            share_id=share_id,
            lab_id=record.id,
            session_id=ctx.session_id,
            created_at=to_iso(utc_now()),
            snapshot_json=snapshot,
        )
    )
    db.commit()
    return ok(
        request,
        {"share_id": share_id, "share_url": f"/lab-share/{share_id}", "published_at": snapshot["published_at"]},
        status_code=201,
    )


@router.delete("/labs/{lab_id}/share", summary="撤销该实验室的全部分享")
def revoke_lab_shares(lab_id: str, request: Request, ctx: WriteDep, db: DBDep) -> JSONResponse:
    record = _owned_lab(db, ctx, lab_id)
    now = to_iso(utc_now())
    rows = list(db.scalars(select(LabShareRecord).where(LabShareRecord.lab_id == record.id)).all())
    for row in rows:
        row.revoked_at = now
    db.commit()
    return ok(request, {"revoked": len(rows), "revoked_at": now})


def _public_share(share_id: str, db: Any) -> LabShareRecord:
    row = db.get(LabShareRecord, share_id)
    if row is None or row.revoked_at is not None:
        raise resource_unavailable()
    return row


@router.get("/lab-shares/{share_id}", summary="读取公开的实验室快照（无需会话）")
def get_public_lab(share_id: str, request: Request, db: DBDep) -> JSONResponse:
    row = _public_share(share_id, db)
    return ok(request, row.snapshot_json)


@router.get("/lab-shares/{share_id}/preview/{preview_key}", summary="公开分享的题目页预览")
def get_public_lab_preview(share_id: str, preview_key: str, db: DBDep) -> FileResponse:
    row = _public_share(share_id, db)
    from ..labs.store import preview_keys

    if preview_key not in preview_keys(row.snapshot_json):
        raise resource_unavailable()
    return FileResponse(
        _preview_path(row.lab_id, preview_key),
        media_type="image/png",
        filename=f"{preview_key}.png",
    )


# ---------------------------------------------------------------------------
# 删除
# ---------------------------------------------------------------------------


@router.delete("/labs/{lab_id}", status_code=204)
def delete_lab(lab_id: str, request: Request, ctx: WriteDep, db: DBDep) -> JSONResponse:
    record = _owned_lab(db, ctx, lab_id)
    db.execute(delete(LabShareRecord).where(LabShareRecord.lab_id == record.id))
    db.delete(record)
    db.commit()
    shutil.rmtree(LABS_DIR / lab_id, ignore_errors=True)
    from . import empty

    return empty(request)  # type: ignore[return-value]


__all__ = ["router"]
