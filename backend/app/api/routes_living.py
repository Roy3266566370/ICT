"""万象活页端点。

- ``POST /pages``：任意文件上传（PDF / 图片 / PPTX / 文本）→ 保真块 + 激活建议；
- ``POST /pages/text``：粘贴文字直接生成活页；
- ``GET /pages/{id}`` / ``PATCH``：文档读取与块级编辑（乐观锁）；
- ``POST /pages/{id}/suggestions/{sid}/accept|dismiss``：激活建议物化/忽略；
- ``POST /pages/{id}/lab-block``：粘贴题目直接生成实验块（服务端求解后冻结）；
- ``GET /pages/{id}/assets/{key}``：页图资产（白名单）；
- ``POST /pages/{id}/publish`` → ``GET /page-shares/{sid}``：发布与公开读取；
- ``POST /page-shares/{sid}/progress`` / ``GET /pages/{id}/insights``：学情回流。

所有识别与求解都由本地确定性引擎完成；公开快照不含会话与文件系统路径。
"""

from __future__ import annotations

import logging
import shutil
import copy
import threading
import json
from typing import Any

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from uuid import uuid4

from ..db.models import LivingPageRecord, LivingProgressRecord, LivingShareRecord
from ..schemas.common import iso_after, to_iso, utc_now
from ..schemas.errors import (
    invalid_file,
    limit_exceeded,
    missing_field,
    model_unavailable,
    resource_unavailable,
    version_conflict,
)
from ..settings import LIVING_DIR, get_settings
from . import API_PREFIX, DBDep, SessionDep, WriteDep, ok

logger = logging.getLogger(__name__)

router = APIRouter(prefix=API_PREFIX, tags=["living"])

MAX_UPLOAD_BYTES = 70 * 1024 * 1024
_AI_LOCK = threading.Lock()
_AI_PAGES: set[str] = set()


# ---------------------------------------------------------------------------
# 请求体
# ---------------------------------------------------------------------------


class TextPageRequest(BaseModel):
    title: str = Field(default="", max_length=120)
    text: str = Field(min_length=1, max_length=200000)


class PagePatch(BaseModel):
    expected_revision: int = Field(ge=1)
    title: str | None = Field(default=None, max_length=120)
    blocks: list[dict[str, Any]] | None = None
    settings: dict[str, Any] | None = None
    variables: dict[str, Any] | None = None


class LabBlockRequest(BaseModel):
    text: str = Field(min_length=4, max_length=8000)


class AIModelRequest(BaseModel):
    block_id: str = Field(min_length=1, max_length=64)
    expected_revision: int = Field(ge=1)
    instruction: str = Field(default="", max_length=1000)
    force: bool = False


class AIRecommendationRequest(BaseModel):
    expected_revision: int = Field(ge=1)
    force: bool = False


class RegionOcrRequest(BaseModel):
    expected_revision: int = Field(ge=1)


class ProgressRequest(BaseModel):
    block_id: str = Field(min_length=1, max_length=64)
    patch: dict[str, Any] = Field(default_factory=dict)


class GradeRequest(BaseModel):
    answer: str = Field(default="", max_length=2000)
    expected: str = Field(default="", max_length=2000)
    mode: str = Field(default="exact", max_length=16)


# ---------------------------------------------------------------------------
# 文档与权限
# ---------------------------------------------------------------------------


def _owned_page(db: Any, ctx: Any, page_id: str) -> LivingPageRecord:
    row = db.get(LivingPageRecord, page_id)
    if row is None or row.session_id != ctx.session_id:
        raise resource_unavailable()
    return row


def _preview_path(page_id: str, key: str) -> Any:
    return LIVING_DIR / page_id / "previews" / f"{key}.png"


def _read_upload(upload: UploadFile, limit: int = MAX_UPLOAD_BYTES) -> bytes:
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


def _new_record(db: Any, ctx: Any, document: dict[str, Any]) -> LivingPageRecord:
    now = utc_now()
    expires = iso_after(get_settings().material_retention_hours, base=now)
    record = LivingPageRecord(
        id=document["page_id"],
        session_id=ctx.session_id,
        title=str(document.get("title") or ""),
        block_count=len(document.get("blocks") or []),
        revision=int(document.get("revision") or 1),
        document=document,
        created_at=document["created_at"],
        updated_at=document["updated_at"],
        expires_at=expires,
    )
    db.add(record)
    db.commit()
    return record


def _touch(record: LivingPageRecord) -> None:
    document = record.document
    document["revision"] = int(document.get("revision") or 1) + 1
    document["updated_at"] = to_iso(utc_now())
    record.document = document
    record.revision = int(document["revision"])
    record.title = str(document.get("title") or record.title)
    record.block_count = len(document.get("blocks") or [])
    record.updated_at = str(document["updated_at"])


def _assert_revision(record: LivingPageRecord, expected: int) -> None:
    if int(expected) != int(record.revision):
        raise version_conflict(
            f"文档已被修改（当前 revision={record.revision}），请刷新后再编辑"
        )


def _build_from_source(request: Request, db: Any, ctx: Any,
                       source: dict[str, Any], title: str, page_id: str | None = None) -> JSONResponse:
    from ..living.store import build_document

    document = build_document(title=title, source=source, page_id=page_id)
    record = _new_record(db, ctx, document)
    return ok(request, record.document, status_code=201)


# ---------------------------------------------------------------------------
# 创建与读取
# ---------------------------------------------------------------------------


@router.post("/pages", status_code=201, summary="上传文件生成活页")
def create_page(
    request: Request,
    ctx: WriteDep,
    db: DBDep,
    title: str = Form(default=""),
    files: list[UploadFile] = File(...),
) -> JSONResponse:
    from ..labs.extract import ExtractError, extract_files

    settings = get_settings()
    if len(files) > settings.lab_max_files:
        raise limit_exceeded(f"最多同时上传 {settings.lab_max_files} 个文件")
    from ..living.model import new_page_id

    page_id = new_page_id()
    uploads: list[tuple[str, str, str, bytes]] = []
    for index, upload in enumerate(files):
        name = upload.filename or f"file_{index + 1}"
        data = _read_upload(upload)
        uploads.append((f"f{index + 1}", name, "courseware", data))
    try:
        source = extract_files(uploads, lab_id=page_id, root=LIVING_DIR,
                               max_pages=100, preserve_layout=True)
        return _build_from_source(request, db, ctx, source, title, page_id)
    except ExtractError as exc:
        shutil.rmtree(LIVING_DIR / page_id, ignore_errors=True)
        raise invalid_file(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - 识别失败不留下半成品
        shutil.rmtree(LIVING_DIR / page_id, ignore_errors=True)
        logger.exception("活页文件解析失败 page=%s", page_id)
        raise invalid_file(f"文件解析失败：{type(exc).__name__}") from exc


@router.post("/pages/text", status_code=201, summary="粘贴文字生成活页")
def create_page_from_text(
    payload: TextPageRequest, request: Request, ctx: WriteDep, db: DBDep
) -> JSONResponse:
    from ..living.store import text_page_source

    source = text_page_source(payload.text, lab_id="")
    return _build_from_source(request, db, ctx, source, payload.title)


@router.get("/pages", summary="我的活页列表")
def list_pages(request: Request, ctx: SessionDep, db: DBDep) -> JSONResponse:
    from ..living.store import summary

    rows = list(
        db.scalars(
            select(LivingPageRecord)
            .where(LivingPageRecord.session_id == ctx.session_id)
            .order_by(LivingPageRecord.updated_at.desc())
        ).all()
    )
    return ok(request, {"pages": [summary(row.document) for row in rows]})


@router.get("/pages/{page_id}", summary="读取活页文档")
def get_page(page_id: str, request: Request, ctx: SessionDep, db: DBDep) -> JSONResponse:
    record = _owned_page(db, ctx, page_id)
    return ok(request, record.document)


# ---------------------------------------------------------------------------
# 编辑
# ---------------------------------------------------------------------------


@router.patch("/pages/{page_id}", summary="编辑活页（标题/块序列/设置）")
def patch_page(
    page_id: str, payload: PagePatch, request: Request, ctx: WriteDep, db: DBDep
) -> JSONResponse:
    from ..living.model import validate_blocks

    record = _owned_page(db, ctx, page_id)
    _assert_revision(record, payload.expected_revision)
    document = dict(record.document)
    if payload.title is not None:
        document["title"] = payload.title.strip()[:120] or document.get("title")
    if payload.blocks is not None:
        try:
            document["blocks"] = validate_blocks(payload.blocks)
        except ValueError as exc:
            raise missing_field(str(exc)) from exc
    if payload.settings is not None:
        allowed = {"answers_visible", "allow_fork", "collect_progress"}
        current = dict(document.get("settings") or {})
        for key in allowed:
            if key in payload.settings:
                current[key] = payload.settings[key]
        document["settings"] = current
    if payload.variables is not None:
        from ..living.model import validate_variables
        try:
            document["variables"] = validate_variables(payload.variables)
        except ValueError as exc:
            raise missing_field(str(exc)) from exc
    record.document = document
    _touch(record)
    db.commit()
    return ok(request, record.document)


@router.post("/pages/{page_id}/regions/{region_id}/formula-ocr",
             summary="按需识别公式区域裁剪图（结果缓存回文档）")
def recognize_region_formula(
    page_id: str, region_id: str, payload: RegionOcrRequest,
    request: Request, ctx: WriteDep, db: DBDep,
) -> JSONResponse:
    """P1.1：公式 OCR 移出上传链路——老师点击时才跑一次本地识别，
    ``latex/expression/params`` 缓存回文档，同一区域不重复调用。"""
    record = _owned_page(db, ctx, page_id)
    _assert_revision(record, payload.expected_revision)
    document = dict(record.document)
    region: dict[str, Any] | None = None
    for block in document.get("blocks") or []:
        if block.get("type") != "page":
            continue
        for candidate in (block.get("data") or {}).get("regions") or []:
            if isinstance(candidate, dict) and candidate.get("id") == region_id:
                region = candidate
    if region is None:
        raise invalid_file("区域不存在，请刷新活页")
    if region.get("kind") != "formula":
        raise invalid_file("只有公式区域支持公式识别")
    if not str(region.get("latex") or "").strip():
        from PIL import Image

        crop = None
        for path in (LIVING_DIR / page_id / "analysis" / "regions" / f"{region_id}.png",
                     _preview_path(page_id, region_id)):
            if not path.is_file():
                continue
            try:
                with Image.open(path) as image:
                    crop = image.convert("RGB")
            except Exception:  # noqa: BLE001 - 试下一个候选路径
                continue
            break
        if crop is None:
            raise invalid_file("区域裁剪已不存在，请重新上传原材料")
        from ..labs.extract import _math_ocr

        latex = _math_ocr(crop)
        if not latex:
            raise invalid_file("公式识别没有得到结果，请换更清晰的裁剪或手动录入")
        region["latex"] = str(latex)[:4000]
        from ..living.blockify import _function_from_latex

        expression, params = _function_from_latex(region["latex"])
        if expression:
            region["expression"] = expression
            if params:
                region["params"] = params
        record.document = document
        _touch(record)
        db.commit()
    return ok(request, record.document)


@router.post("/pages/{page_id}/suggestions/{suggestion_id}/accept",
             summary="接受激活建议并物化为活块")
def accept_suggestion(
    page_id: str, suggestion_id: str, request: Request, ctx: WriteDep, db: DBDep
) -> JSONResponse:
    from ..living.model import apply_suggestion

    record = _owned_page(db, ctx, page_id)
    document = dict(record.document)
    try:
        result = apply_suggestion(document, suggestion_id)
    except ValueError as exc:
        raise missing_field(str(exc)) from exc
    record.document = document
    _touch(record)
    db.commit()
    return ok(request, {"document": record.document, "inserted": result["inserted"]})


@router.post("/pages/{page_id}/suggestions/{suggestion_id}/dismiss",
             summary="忽略一条激活建议")
def dismiss_suggestion(
    page_id: str, suggestion_id: str, request: Request, ctx: WriteDep, db: DBDep
) -> JSONResponse:
    from ..living.model import dismiss_suggestion as dismiss

    record = _owned_page(db, ctx, page_id)
    document = dict(record.document)
    try:
        dismiss(document, suggestion_id)
    except ValueError as exc:
        raise missing_field(str(exc)) from exc
    record.document = document
    _touch(record)
    db.commit()
    return ok(request, record.document)


@router.post("/pages/{page_id}/lab-block", status_code=201,
             summary="粘贴题目文本直接生成实验块")
def create_lab_block(
    page_id: str, payload: LabBlockRequest, request: Request, ctx: WriteDep, db: DBDep
) -> JSONResponse:
    """编辑器"插入实验块"：服务端识别+求解后返回冻结块，由前端并入 PATCH。"""

    _owned_page(db, ctx, page_id)  # 仅校验归属；块由前端经 PATCH 落位
    from ..living.model import build_problem_snapshot, new_block_id, validate_block

    try:
        problem = build_problem_snapshot(payload.text)
        block = validate_block({
            "id": new_block_id(),
            "type": "lab",
            "data": {
                "problem": problem,
                "engine_params": dict((problem.get("model") or {}).get("defaults") or {}),
            },
        })
    except ValueError as exc:
        raise missing_field(str(exc)) from exc
    return ok(request, {"block": block}, status_code=201)


# ---------------------------------------------------------------------------
# 资产与分享
# ---------------------------------------------------------------------------


@router.post("/living/grade", summary="判分点作答核对（表达式等价/数值/文本）")
def grade_checkpoint(payload: GradeRequest, request: Request, ctx: SessionDep) -> JSONResponse:
    from ..living.grade import grade_answer

    return ok(request, grade_answer(payload.answer, payload.expected, payload.mode))


@router.get("/living/ai-status", summary="活页 AI 生成能力")
def living_ai_status(request: Request, ctx: SessionDep) -> JSONResponse:
    from ..model_profiles import vision_profile
    from ..ppt_ai.client import PPTAIClient

    client = PPTAIClient()
    available = client.available()
    return ok(request, {
        "available": available,
        "model": client.settings.llm_model if available else "",
        "vision": vision_profile().status(),
    })


@router.post("/pages/{page_id}/ai-models", summary="根据活页内容自主设计交互模型（产出待激活建议）")
def create_ai_model(page_id: str, payload: AIModelRequest, request: Request,
                    ctx: WriteDep, db: DBDep) -> JSONResponse:
    """AI 生成只产出 ``pending`` 的 ``canvas_object`` 建议（template=page_lab），

    老师在前端点击"激活"后由 ``apply_suggestion`` 物化为可编辑的
    ``pageLabSim`` 画布块——不再直接写入不可编辑的 ``ai_model`` 黑盒块。
    """
    from ..living.ai import (existing_ai_block, model_context, pending_ai_suggestion,
                             propose_model)
    from ..living.model import MAX_SUGGESTIONS, validate_suggestion
    from ..ppt_ai.client import PPTAIError
    from ..ppt_ai.page_lab import PageLabError
    from ..schemas.errors import ApiError, ErrorCode

    record = _owned_page(db, ctx, page_id)
    _assert_revision(record, payload.expected_revision)
    document = copy.deepcopy(record.document)
    try:
        context, input_hash = model_context(document, payload.block_id, payload.instruction)
    except ValueError as exc:
        raise missing_field(str(exc)) from exc
    if not payload.force:
        pending = pending_ai_suggestion(document, payload.block_id)
        if pending and (pending.get("proposal") or {}).get("input_hash") == input_hash:
            return ok(request, {"document": document, "suggestion": pending, "cached": True})
        old = existing_ai_block(document, payload.block_id)
        if old is not None:
            doc = (old.get("data") or {}).get("doc") or {}
            old_hash = str(doc.get("input_hash") or "")
            if not old_hash and doc.get("version") == 1:
                for node in doc.get("nodes") or []:
                    if not isinstance(node, dict) or node.get("type") != "pageLabSim":
                        continue
                    try:
                        old_hash = str(json.loads(str(node.get("payload") or "")).get("input_hash") or "")
                    except ValueError:
                        continue
                    break
            if old_hash == input_hash:
                return ok(request, {"document": document, "block": old, "cached": True})
    pending_count = sum(1 for s in document.get("suggestions") or [] if s.get("status") == "pending")
    if pending_count >= MAX_SUGGESTIONS:
        raise limit_exceeded("待激活建议数量已达上限，请先处理现有建议")
    with _AI_LOCK:
        if page_id in _AI_PAGES:
            raise ApiError(ErrorCode.RATE_LIMITED, "这份活页正在生成交互，请等待当前模型完成")
        _AI_PAGES.add(page_id)
    try:
        # 网络等待期间释放数据库事务；写入时用 revision 做原子比较。
        db.rollback()
        try:
            suggestion = propose_model(document, payload.block_id, payload.instruction, context, input_hash)
        except (PPTAIError, PageLabError, ValueError) as exc:
            raise model_unavailable(str(exc)) from exc
        suggestions = [
            s for s in document.get("suggestions") or []
            if not (s.get("status") == "pending" and s.get("block_id") == payload.block_id
                    and s.get("kind") == "canvas_object"
                    and (s.get("proposal") or {}).get("template") == "page_lab")
        ]
        suggestions.append(validate_suggestion(suggestion))
        document["suggestions"] = suggestions
        document["revision"] += 1
        document["updated_at"] = to_iso(utc_now())
        result = db.execute(update(LivingPageRecord).where(
            LivingPageRecord.id == page_id, LivingPageRecord.session_id == ctx.session_id,
            LivingPageRecord.revision == payload.expected_revision,
        ).values(document=document, revision=document["revision"], block_count=len(document["blocks"]),
                 updated_at=document["updated_at"]))
        if result.rowcount != 1:
            db.rollback()
            raise version_conflict("生成期间活页已有修改，请刷新后重试；已有内容已保留")
        db.commit()
        return ok(request, {"document": document, "suggestion": document["suggestions"][-1], "cached": False})
    finally:
        with _AI_LOCK:
            _AI_PAGES.discard(page_id)


@router.post("/pages/{page_id}/ai-recommendations", summary="AI 挑选适合交互的知识点")
def recommend_ai_models(page_id: str, payload: AIRecommendationRequest, request: Request,
                        ctx: WriteDep, db: DBDep) -> JSONResponse:
    from ..living.ai import recommend_models, RECOMMENDATION_VERSION
    from ..ppt_ai.client import PPTAIError
    from ..ppt_ai.util import hash_json
    from ..schemas.errors import ApiError, ErrorCode

    record = _owned_page(db, ctx, page_id)
    _assert_revision(record, payload.expected_revision)
    document = copy.deepcopy(record.document)
    input_hash = hash_json({"version": RECOMMENDATION_VERSION, "title": document["title"], "blocks": document["blocks"]})
    cache_path = LIVING_DIR / page_id / "ai-recommendations.json"
    if not payload.force:
        try:
            cache = json.loads(cache_path.read_text(encoding="utf-8"))
            if cache.get("input_hash") == input_hash:
                return ok(request, {**cache["result"], "revision": document["revision"], "cached": True})
        except (OSError, ValueError, AttributeError, KeyError):
            pass
    with _AI_LOCK:
        if page_id in _AI_PAGES:
            raise ApiError(ErrorCode.RATE_LIMITED, "这份活页正在分析或生成交互，请稍候")
        _AI_PAGES.add(page_id)
    try:
        db.rollback()
        try:
            result = recommend_models(document)
        except (PPTAIError, ValueError) as exc:
            raise model_unavailable(str(exc)) from exc
        _assert_revision(_owned_page(db, ctx, page_id), payload.expected_revision)
        temporary = cache_path.with_suffix(f".{uuid4().hex}.tmp")
        try:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            temporary.write_text(json.dumps({"input_hash": input_hash, "result": result}, ensure_ascii=False), encoding="utf-8")
            temporary.replace(cache_path)
        except OSError:
            logger.warning("活页 AI 筛选缓存未保存 page=%s", page_id)
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
        return ok(request, {**result, "revision": document["revision"], "cached": False})
    finally:
        with _AI_LOCK:
            _AI_PAGES.discard(page_id)


@router.get("/pages/{page_id}/assets/{key}", summary="活页页图资产")
def get_page_asset(
    page_id: str, key: str, request: Request, ctx: SessionDep, db: DBDep
) -> FileResponse:
    from ..living.store import asset_keys

    record = _owned_page(db, ctx, page_id)
    if key not in asset_keys(record.document):
        raise resource_unavailable()
    return FileResponse(_preview_path(page_id, key), media_type="image/png",
                        filename=f"{key}.png")


@router.post("/pages/{page_id}/publish", status_code=201, summary="发布只读活页")
def publish_page(
    page_id: str, request: Request, ctx: WriteDep, db: DBDep
) -> JSONResponse:
    from ..living.store import new_share_id, snapshot

    record = _owned_page(db, ctx, page_id)
    share_id = new_share_id()
    snap = snapshot(record.document, share_id=share_id)
    db.add(
        LivingShareRecord(
            share_id=share_id,
            page_id=record.id,
            session_id=ctx.session_id,
            created_at=to_iso(utc_now()),
            snapshot_json=snap,
        )
    )
    db.commit()
    return ok(
        request,
        {"share_id": share_id, "share_url": f"/page-shares/{share_id}",
         "published_at": snap["published_at"]},
        status_code=201,
    )


def _public_share(share_id: str, db: Any) -> LivingShareRecord:
    row = db.get(LivingShareRecord, share_id)
    if row is None or row.revoked_at is not None:
        raise resource_unavailable()
    return row


@router.get("/page-shares/{share_id}", summary="读取公开活页快照（无需会话）")
def get_public_page(share_id: str, request: Request, db: DBDep) -> JSONResponse:
    row = _public_share(share_id, db)
    return ok(request, row.snapshot_json)


@router.get("/page-shares/{share_id}/assets/{key}", summary="公开活页资产")
def get_public_asset(
    share_id: str, key: str, request: Request, db: DBDep
) -> FileResponse:
    from ..living.store import asset_keys

    row = _public_share(share_id, db)
    if key not in asset_keys(row.snapshot_json):
        raise resource_unavailable()
    return FileResponse(_preview_path(row.page_id, key), media_type="image/png",
                        filename=f"{key}.png")


# ---------------------------------------------------------------------------
# 学生进度与学情
# ---------------------------------------------------------------------------

_PROGRESS_KEYS = {"quiz_guess", "checkpoint_attempts", "lab_states", "notes"}


def _load_or_insert_progress(
    db: Any, share_id: str, session_id: str, now: str
) -> LivingProgressRecord:
    """取回 (share_id, session_id) 的进度行；没有就插入。

    学生端会并发上报多个块，两个请求同时看到"没有行"时后者插入会撞
    ``ix_living_progress_share_session``——回滚后重读胜出方的行继续合并。
    """

    row = db.scalar(
        select(LivingProgressRecord).where(
            LivingProgressRecord.share_id == share_id,
            LivingProgressRecord.session_id == session_id,
        )
    )
    if row is not None:
        return row
    row = LivingProgressRecord(
        id=f"lp_{uuid4().hex[:24]}",
        share_id=share_id,
        session_id=session_id,
        blocks={},
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        row = db.scalar(
            select(LivingProgressRecord).where(
                LivingProgressRecord.share_id == share_id,
                LivingProgressRecord.session_id == session_id,
            )
        )
        if row is None:
            raise resource_unavailable("进度记录异常")
    return row


@router.post("/page-shares/{share_id}/progress", summary="上报学生端块进度")
def report_progress(
    share_id: str, payload: ProgressRequest, request: Request, ctx: WriteDep, db: DBDep
) -> JSONResponse:
    share = _public_share(share_id, db)
    snapshot = share.snapshot_json or {}
    block_ids = {b.get("id") for b in (snapshot.get("blocks") or [])}
    if payload.block_id not in block_ids:
        raise missing_field("块不存在")
    now = to_iso(utc_now())
    row = _load_or_insert_progress(db, share_id, ctx.session_id, now)
    blocks = dict(row.blocks or {})
    entry = dict(blocks.get(payload.block_id) or {})
    entry["visited_at"] = entry.get("visited_at") or now
    patch = payload.patch or {}
    for key in _PROGRESS_KEYS:
        if key not in patch:
            continue
        value = patch[key]
        if key == "checkpoint_attempts" and isinstance(value, list):
            entry[key] = (entry.get(key) or []) + [
                {
                    "answer": str(a.get("answer") or "")[:1200],
                    "correct": bool(a.get("correct")),
                    "created_at": now,
                }
                for a in value[-10:]
                if isinstance(a, dict)
            ]
        elif key == "quiz_guess":
            try:
                entry[key] = float(value)
            except (TypeError, ValueError):
                continue
        elif key == "lab_states" and isinstance(value, dict):
            entry[key] = value
        elif key == "notes" and isinstance(value, str):
            entry[key] = value[:2400]
    blocks[payload.block_id] = entry
    row.blocks = blocks
    row.updated_at = now
    db.add(row)
    db.commit()
    return ok(request, {"block_id": payload.block_id, "saved": True})


@router.get("/pages/{page_id}/insights", summary="活页学情聚合（仅所有者）")
def page_insights(
    page_id: str, request: Request, ctx: SessionDep, db: DBDep
) -> JSONResponse:
    record = _owned_page(db, ctx, page_id)
    shares = list(
        db.scalars(
            select(LivingShareRecord).where(LivingShareRecord.page_id == record.id)
        ).all()
    )
    share_ids = [s.share_id for s in shares]
    progress_rows: list[LivingProgressRecord] = []
    if share_ids:
        progress_rows = list(
            db.scalars(
                select(LivingProgressRecord).where(
                    LivingProgressRecord.share_id.in_(share_ids)
                )
            ).all()
        )
    per_block: dict[str, dict[str, Any]] = {}
    viewers: set[str] = set()
    for row in progress_rows:
        viewers.add(row.session_id)
        for block_id, entry in (row.blocks or {}).items():
            stat = per_block.setdefault(block_id, {
                "visits": 0, "quiz_guesses": [], "checkpoint_attempts": 0,
                "checkpoint_correct": 0, "last_active": None,
            })
            if not isinstance(entry, dict):
                continue
            stat["visits"] += 1
            if entry.get("quiz_guess") is not None:
                stat["quiz_guesses"].append(entry["quiz_guess"])
            attempts = entry.get("checkpoint_attempts") or []
            stat["checkpoint_attempts"] += len(attempts)
            stat["checkpoint_correct"] += sum(1 for a in attempts if a.get("correct"))
            ts = entry.get("visited_at")
            if isinstance(ts, str) and (stat["last_active"] is None or ts > stat["last_active"]):
                stat["last_active"] = ts
    return ok(request, {
        "shares": len(share_ids),
        "viewers": len(viewers),
        "blocks": per_block,
    })


# ---------------------------------------------------------------------------
# 删除
# ---------------------------------------------------------------------------


@router.delete("/pages/{page_id}", status_code=204)
def delete_page(
    page_id: str, request: Request, ctx: WriteDep, db: DBDep
) -> JSONResponse:
    record = _owned_page(db, ctx, page_id)
    share_rows = list(
        db.scalars(
            select(LivingShareRecord).where(LivingShareRecord.page_id == record.id)
        ).all()
    )
    for share in share_rows:
        db.execute(
            delete(LivingProgressRecord).where(
                LivingProgressRecord.share_id == share.share_id
            )
        )
    db.execute(delete(LivingShareRecord).where(LivingShareRecord.page_id == record.id))
    db.delete(record)
    db.commit()
    shutil.rmtree(LIVING_DIR / page_id, ignore_errors=True)
    from . import empty

    return empty(request)  # type: ignore[return-value]
