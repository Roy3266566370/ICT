"""材料端点（``C-API@1`` #5–#9；R2-AC2/AC4/AC5、R3-AC1/AC2/AC6、R4-AC2/AC3）。

- ``POST /materials``：multipart 上传，先做**廉价且确定**的校验再入队：
  >70MB → 413 ``LIMIT_EXCEEDED``；``vbaProject.bin`` → 400 ``INVALID_FILE``；
  >100 页 → 413；加密 / 损坏 / 路径越界 → 400。只读 ZIP 目录，**不执行任何宏**（R12-AC1）。
- ``GET /materials``：当前会话材料列表 + 保留到期时间。
- ``GET /materials/{id}``：材料详情（原文、候选、对象、任务）。
- ``DELETE /materials/{id}``：立即不可访问并 204（R2-AC4）。
- ``GET /materials/{id}/assets/{asset_id}``：受鉴权取图，asset 必须属于该材料（§2.2.7 行为 6）。
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import threading
import zipfile
from pathlib import Path
from collections.abc import Mapping, Sequence
from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, File, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..db.models import (
    CheckRecord,
    ElementRecord,
    JobRecord,
    KnowledgeObjectRecord,
    MaterialRecord,
    ObjectVersionRecord,
    PageRecord,
    RunRecord,
    ShareRecord,
)
from ..ispec.persistence import clear_values, save_values
from ..parsers.pdf_to_pptx import PdfConvertError, convert_pdf_to_pptx
from ..project_package import MAX_PACKAGE_BYTES, ProjectPackageError, build_project_archive, import_project_archive
from ..documents.presentation import apply_document_specs,current_document
from ..schemas.api_models import (
    CandidateObject,
    MaterialSummary,
    SlideElement,
    SlidePage,
    UploadAccepted,
)
from ..schemas.common import iso_after, to_iso, utc_now
from ..schemas.errors import invalid_file, limit_exceeded, missing_field, resource_unavailable
from ..schemas.knowledge_object import KnowledgeObject

from ..render import (
    PAGE_IMAGE_PATTERN,
    READINESS_READABLE,
    existing_page_images,
    pages_dir,
    read_render_manifest,
    render_dir,
)
from ..settings import DATA_DIR, PPT_DIR, REPO_ROOT, UPLOAD_DIR, get_settings
from . import (
    API_PREFIX,
    DBDep,
    SessionDep,
    WriteDep,
    clamp_limit,
    empty,
    ok,
    owned_material,
)
from .routes_jobs import (
    UPLOADED_FILE_NAME,
    build_job_status,
    read_ispec_payload,
    run_upload_job,
    write_ispec_payload,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix=API_PREFIX, tags=["materials"])

#: 合法的幻灯片条目（只数页数，不解析 XML）。
SLIDE_ENTRY_PATTERN = re.compile(r"^ppt/slides/slide\d+\.xml$")
#: OOXML 包必备条目（R3-AC1 的 ZIP 结构校验）。
CONTENT_TYPES_ENTRY = "[Content_Types].xml"
#: 读文件分块大小（1MB）。
CHUNK_SIZE = 1024 * 1024
#: 图片资源的扩展名白名单 → Content-Type（端点 #9 只允许 png/jpeg）。
IMAGE_MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}
#: 页图接口只允许 PNG（渲染链路产物固定为 png）。
RENDER_PAGE_MEDIA_TYPE = "image/png"
#: 页图宽度白名单（px）：前三个给缩略图，后三个给阅读器主画面。
THUMBNAIL_WIDTHS = (240, 320, 480, 960, 1280, 1600)
#: 缩略图缓存子目录（位于 ``pages_dir(material_id)/thumbs``）。
THUMBNAIL_DIR_NAME = "thumbs"
#: 带 ``v`` 版本参数时页图/缩略图可长期缓存（文件内容随 bytes 版本变化）。
RENDER_CACHE_CONTROL = "private, max-age=31536000, immutable"
#: 内部状态 → 对外 ``MaterialStatus`` 投影。
#:
#: ``readable`` 是渲染链路的内部状态（页图已落盘即可读，§3.1），但 ``C-API@1`` 的
#: ``MaterialStatus`` 只有 4 个取值（additionalProperties/枚举都不可扩展），
#: 因此对外投影为 ``awaiting_confirmation``——语义一致：页面可浏览、等待用户确认。
PUBLIC_STATUS_MAP: dict[str, str] = {READINESS_READABLE: "awaiting_confirmation"}


#: 任务已走完上传链路（无论成功或失败）的阶段集合。
_TERMINAL_JOB_STAGES = frozenset({"awaiting_confirmation", "ready", "failed"})


def public_material_status(raw: str, job_stage: str | None = None) -> str:
    """把内部材料状态投影为契约允许的取值。

    ``readable`` 只表示页图已落盘，并不代表识别（extracting）已完成；
    对外必须结合最新任务阶段：识别期间仍是 ``processing``，任务失败则是
    ``failed``，只有任务到达 ``awaiting_confirmation``/``ready`` 才是
    ``awaiting_confirmation``。否则前端会提前停止轮询并看到空的 iSpec。
    """

    if raw != READINESS_READABLE:
        return raw
    if job_stage in (None, "awaiting_confirmation", "ready"):
        return "awaiting_confirmation"
    if job_stage == "failed":
        return "failed"
    return "processing"


# ---------------------------------------------------------------------------
# 上传前校验
# ---------------------------------------------------------------------------


def _assert_pptx_extension(filename: str | None) -> str:
    """扩展名必须是 ``.pptx``（宏文件 ``.pptm`` 直接拒绝，R3-AC2）。"""

    name = (filename or "").strip()
    if not name:
        raise invalid_file("缺少文件名，请重新选择文件")
    if not name.lower().endswith(".pptx"):
        raise invalid_file("只接受 .pptx 文件（宏文件 .pptm 等不受支持）", filename=name)
    return name


def _assert_upload_extension(filename: str | None) -> str:
    """扩展名必须是 ``.pptx`` 或 ``.pdf``；PDF 会在落盘后转成 PPTX 再走同一条链路。"""

    name = (filename or "").strip()
    if name.lower().endswith(".pdf"):
        return name
    return _assert_pptx_extension(name)


def _convert_pdf_upload(pdf_path: Path, pptx_path: Path) -> int:
    """校验魔数后把 PDF 转成 ``original.pptx``，返回页数；转换后删除 PDF 副本。"""

    try:
        with pdf_path.open("rb") as handle:
            if not handle.read(1024).lstrip().startswith(b"%PDF"):
                raise invalid_file("这不是有效的 PDF 文件，文件可能已损坏或扩展名被改动")
        try:
            return convert_pdf_to_pptx(
                pdf_path, pptx_path, max_pages=get_settings().max_slide_pages
            )
        except PdfConvertError as exc:
            if exc.limit_pages is not None:
                raise limit_exceeded(
                    exc.message, page_count=exc.page_count, limit_pages=exc.limit_pages
                ) from exc
            raise invalid_file(exc.message) from exc
        except Exception as exc:
            logger.exception("PDF 转换失败")
            raise invalid_file("PDF 转换失败，文件可能已损坏或包含不支持的内容") from exc
    finally:
        pdf_path.unlink(missing_ok=True)


def _save_upload_limited(upload: UploadFile, target: Path) -> int:
    """流式落盘并强制 70MB 上限；超限立即删除半成品并返回 413。"""

    settings = get_settings()
    target.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    try:
        with target.open("wb") as handle:
            while True:
                chunk = upload.file.read(CHUNK_SIZE)
                if not chunk:
                    break
                total += len(chunk)
                if total > settings.max_upload_bytes:
                    raise limit_exceeded(
                        f"文件超过 {settings.max_upload_bytes // (1024 * 1024)}MB 上限",
                        limit_bytes=settings.max_upload_bytes,
                        actual_bytes=total,
                    )
                handle.write(chunk)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    if total == 0:
        target.unlink(missing_ok=True)
        raise invalid_file("上传文件为空")
    return total


def inspect_pptx_archive(path: Path) -> int:
    """只读 ZIP 目录做结构校验，返回页数。

    :raises ApiError: ``INVALID_FILE``（400）或 ``LIMIT_EXCEEDED``（413）。
    """

    settings = get_settings()
    try:
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
    except zipfile.BadZipFile as exc:
        raise invalid_file("不是有效的 ZIP/OOXML 包，文件可能已损坏") from exc
    except OSError as exc:
        raise invalid_file("文件无法读取，请重新上传") from exc

    names = [info.filename.replace("\\", "/") for info in infos]
    if not names:
        raise invalid_file("文件包为空")

    for info, raw_name in zip(infos, names):
        # 路径越界（绝对路径或 ..）会指向包外，必须拒绝（R3-AC2）。
        if raw_name.startswith("/") or raw_name.startswith("../") or "/../" in raw_name:
            raise invalid_file("文件包含路径越界条目，已拒绝", entry=raw_name[:80])
        if raw_name.endswith("vbaProject.bin"):
            # 宏项目存在即拒绝；系统绝不执行宏（R12-AC1）。
            raise invalid_file("检测到宏项目 vbaProject.bin，系统不执行宏，已拒绝", entry="vbaProject.bin")
        if info.flag_bits & 0x1:
            raise invalid_file("文件已加密，无法读取内容")

    unzipped = sum(info.file_size for info in infos)
    if unzipped > settings.max_unzipped_bytes:
        raise limit_exceeded(
            "解压后体积超过上限",
            limit_bytes=settings.max_unzipped_bytes,
            actual_bytes=unzipped,
        )

    if CONTENT_TYPES_ENTRY not in names:
        raise invalid_file("不是有效的 PPTX：缺少 [Content_Types].xml")

    page_count = sum(1 for name in names if SLIDE_ENTRY_PATTERN.match(name))
    if page_count > settings.max_slide_pages:
        raise limit_exceeded(
            f"页数 {page_count} 超过 {settings.max_slide_pages} 页上限",
            page_count=page_count,
            limit_pages=settings.max_slide_pages,
        )
    return page_count


# ---------------------------------------------------------------------------
# 序列化助手
# ---------------------------------------------------------------------------


#: 材料统计：对象数、模板归属、运行数（一次查询批量取，避免列表 N+1）。
MaterialStats = dict[str, dict[str, Any]]


def material_stats(db: Session, material_ids: Sequence[str]) -> MaterialStats:
    """按材料批量统计 ``object_count`` / ``template_id`` / ``run_count``。

    ``template_id`` 只在材料已确定模板时返回（``ready`` 且有对象），否则为 ``None``，
    由 ``summary_payload`` 省略该键（对齐 openapi 的 P1 可选追加字段说明）。
    """

    stats: MaterialStats = {
        material_id: {"object_count": 0, "template_id": None, "run_count": 0}
        for material_id in material_ids
    }
    if not material_ids:
        return stats

    object_rows = db.execute(
        select(
            KnowledgeObjectRecord.material_id,
            KnowledgeObjectRecord.template_id,
        ).where(KnowledgeObjectRecord.material_id.in_(list(material_ids)))
    ).all()
    for material_id, template_id in object_rows:
        entry = stats.get(material_id)
        if entry is None:
            continue
        entry["object_count"] += 1
        if entry["template_id"] is None:
            entry["template_id"] = template_id

    run_rows = db.execute(
        select(KnowledgeObjectRecord.material_id, func.count(RunRecord.id))
        .join(RunRecord, RunRecord.object_id == KnowledgeObjectRecord.id)
        .where(KnowledgeObjectRecord.material_id.in_(list(material_ids)))
        .group_by(KnowledgeObjectRecord.material_id)
    ).all()
    for material_id, run_count in run_rows:
        entry = stats.get(material_id)
        if entry is not None:
            entry["run_count"] = int(run_count or 0)
    return stats


def material_summary(
    db: Session,
    material: MaterialRecord,
    stats: Mapping[str, Any] | None = None,
    *,
    job_stage: str | None = None,
) -> MaterialSummary:
    """ORM → ``MaterialSummary``（端点 #6/#7 共用）。"""

    entry = stats if stats is not None else material_stats(db, [material.id]).get(material.id, {})
    if job_stage is None and material.status == READINESS_READABLE:
        latest = _latest_job(db, material.id)
        job_stage = latest.stage if latest is not None else None
    return MaterialSummary(
        material_id=material.id,
        title=material.title,
        status=public_material_status(material.status, job_stage),  # type: ignore[arg-type]
        page_count=material.page_count,
        created_at=material.created_at,
        expires_at=material.expires_at,
        object_count=int(entry.get("object_count") or 0),
        template_id=entry.get("template_id"),  # 未确定模板时为 None → 序列化时省略
        run_count=int(entry.get("run_count") or 0),
    )


def summary_payload(summary: MaterialSummary) -> dict[str, Any]:
    """``MaterialSummary`` → JSON；P1 可选字段为 ``None`` 时省略键（不是 null）。"""

    payload = summary.model_dump(mode="json")
    for optional_key in ("template_id", "run_count"):
        if payload.get(optional_key) is None:
            payload.pop(optional_key, None)
    return payload


def _latest_job(db: Session, material_id: str) -> JobRecord | None:
    return db.scalars(
        select(JobRecord)
        .where(JobRecord.material_id == material_id)
        .order_by(JobRecord.created_at.desc(), JobRecord.id.desc())
        .limit(1)
    ).first()


def _latest_job_stages(db: Session, material_ids: Sequence[str]) -> dict[str, str]:
    """批量取每个材料最新任务的阶段（材料列表避免逐行查询）。"""

    if not material_ids:
        return {}
    rows = db.execute(
        select(JobRecord.material_id, JobRecord.stage)
        .where(JobRecord.material_id.in_(list(material_ids)))
        .order_by(JobRecord.created_at.desc(), JobRecord.id.desc())
    ).all()
    stages: dict[str, str] = {}
    for material_id, stage in rows:
        stages.setdefault(material_id, stage)
    return stages


def _slides(db: Session, material_id: str) -> list[SlidePage]:
    """从 ``pages`` + ``elements`` 还原结构化页面（首版不做整页位图，D1）。"""

    pages = db.scalars(
        select(PageRecord)
        .where(PageRecord.material_id == material_id)
        .order_by(PageRecord.page_no.asc())
    ).all()
    if not pages:
        return []
    elements = db.scalars(
        select(ElementRecord)
        .where(ElementRecord.material_id == material_id)
        .order_by(ElementRecord.page_no.asc(), ElementRecord.element_id.asc())
    ).all()
    by_page: dict[int, list[ElementRecord]] = {}
    for element in elements:
        by_page.setdefault(element.page_no, []).append(element)

    render_pages = {p["page_no"]: p for p in _render_pages_payload(material_id)}
    spec_payload = read_ispec_payload(material_id) or {}
    layouts = {p["page_no"]: p for p in spec_payload.get("page_layouts", [])}
    result: list[SlidePage] = []
    for page in pages:
        page_elements = by_page.get(page.page_no, [])
        asset_id = None
        for element in page_elements:
            if element.asset_id:
                asset_id = element.asset_id
                break
        if asset_id is None:
            asset_id = page.image_asset_id
        render_page = render_pages.get(page.page_no)
        render_bytes = render_page.get("bytes") if render_page else None
        result.append(
            SlidePage(
                page_no=page.page_no,
                title=page.title,
                paragraphs=list(page.paragraphs or []),
                elements=[
                    SlideElement(
                        element_id=element.element_id,
                        kind=element.kind,  # type: ignore[arg-type]
                        name=element.name,
                        bbox={
                            "x": element.bbox_x,
                            "y": element.bbox_y,
                            "w": element.bbox_w,
                            "h": element.bbox_h,
                        },
                        text=element.text,
                        asset_id=element.asset_id,
                    )
                    for element in page_elements
                ],
                excerpt=page.excerpt,
                # 契约写"相对路径，前端拼 /materials/{id}/assets/{asset_id}"；无图时为 null。
                image_url=(f"{API_PREFIX}/materials/{material_id}/{render_page['image_url']}"
                           if render_page else None),
                render_bytes=int(render_bytes) if isinstance(render_bytes, int) else None,
                width=layouts.get(page.page_no, {}).get("width") or 12192000,
                height=layouts.get(page.page_no, {}).get("height") or 6858000,
            )
        )
    return result


def _objects(db: Session, material_id: str) -> list[KnowledgeObject]:
    """对象文档在写入时已按 C-KO@1 校验；读取时再校验一次，异常项跳过并告警。"""

    records = db.scalars(
        select(KnowledgeObjectRecord)
        .where(KnowledgeObjectRecord.material_id == material_id)
        .order_by(KnowledgeObjectRecord.created_at.asc())
    ).all()
    objects: list[KnowledgeObject] = []
    for record in records:
        try:
            objects.append(KnowledgeObject.model_validate(record.document))
        except ValidationError:
            logger.error("对象 %s 的文档不符合 C-KO@1，已在详情中跳过", record.id)
    return objects


def _candidates(material: MaterialRecord) -> list[CandidateObject]:
    """候选对象在写入时已投影为契约形状；读取时逐条校验，非法项汇总告警后跳过。"""

    candidates: list[CandidateObject] = []
    skipped = 0
    for item in material.candidates or []:
        try:
            candidates.append(CandidateObject.model_validate(item))
        except ValidationError:
            skipped += 1
    if skipped:
        logger.warning("材料 %s 有 %d 条候选对象不符合契约，已跳过", material.id, skipped)
    return candidates


def _retention_expires_at(db: Session, ctx_session_id: str) -> str:
    """材料统一保留到期时间：取当前会话最晚的一份，无材料时按保留策略顺延。"""

    latest = db.scalar(
        select(func.max(MaterialRecord.expires_at)).where(
            MaterialRecord.session_id == ctx_session_id
        )
    )
    if isinstance(latest, str) and latest:
        return latest
    return iso_after(get_settings().material_retention_hours)


# ---------------------------------------------------------------------------
# 端点 #5–#9
# ---------------------------------------------------------------------------


@router.post("/materials", status_code=202, summary="上传 PPTX / PDF 并建任务（端点 #5）")
def upload_material(
    request: Request,
    ctx: WriteDep,
    db: DBDep,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(..., description=".pptx 或 .pdf 文件，<= 70MB"),
) -> JSONResponse:
    """校验后立即返回 202，解析推进交给 ``BackgroundTasks``（R3-AC1/AC3）。"""

    filename = _assert_upload_extension(file.filename)
    is_pdf = filename.lower().endswith(".pdf")
    settings = get_settings()
    now = utc_now()
    now_iso = to_iso(now)
    material_id = f"mat_{uuid4().hex}"
    job_id = f"job_{uuid4().hex}"
    target = UPLOAD_DIR / material_id / UPLOADED_FILE_NAME

    try:
        if is_pdf:
            pdf_target = target.with_suffix(".pdf")
            size = _save_upload_limited(file, pdf_target)
            page_count = _convert_pdf_upload(pdf_target, target)
        else:
            size = _save_upload_limited(file, target)
        page_count = inspect_pptx_archive(target)
    except Exception:
        # 校验失败不留下任何半成品（材料/任务也不入库）。
        shutil.rmtree(target.parent, ignore_errors=True)
        raise

    db.add(
        MaterialRecord(
            id=material_id,
            session_id=ctx.session_id,
            title=Path(filename).stem,
            status="processing",
            page_count=page_count,
            source_filename=filename,
            clone_of_example_id=None,
            candidates=[],
            created_at=now_iso,
            expires_at=iso_after(settings.material_retention_hours, base=now),
        )
    )
    db.flush()  # jobs.material_id 引用 materials.id，父行必须先落库
    job = JobRecord(
        id=job_id,
        session_id=ctx.session_id,
        material_id=material_id,
        kind="upload",
        stage="queued",
        attempt=1,
        progress_pct=None,
        created_at=now_iso,
        updated_at=now_iso,
    )
    db.add(job)
    db.commit()

    background_tasks.add_task(run_upload_job, job_id)
    logger.info(
        "会话 %s 上传 %s（%d 字节，%d 页）→ material=%s job=%s",
        ctx.session_id,
        filename,
        size,
        page_count,
        material_id,
        job_id,
    )
    return ok(request, UploadAccepted(material_id=material_id, job_id=job_id), status_code=202)


@router.get("/materials", summary="材料列表（端点 #6）")
def list_materials(
    request: Request,
    ctx: SessionDep,
    db: DBDep,
    limit: int | None = Query(default=None, ge=1, description="默认 20，最大 50"),
) -> JSONResponse:
    """当前会话的材料列表；分页超限按 50 处理，不报错（§2.2.7 行为 5）。"""

    effective = clamp_limit(limit)
    rows = list(
        db.scalars(
            select(MaterialRecord)
            .where(MaterialRecord.session_id == ctx.session_id)
            .order_by(MaterialRecord.created_at.desc(), MaterialRecord.id.desc())
            .limit(effective)
        ).all()
    )
    stats = material_stats(db, [row.id for row in rows])
    job_stages = _latest_job_stages(db, [row.id for row in rows])
    payload = {
        "items": [
            summary_payload(
                material_summary(db, row, stats.get(row.id), job_stage=job_stages.get(row.id))
            )
            for row in rows
        ],
        "retention_expires_at": _retention_expires_at(db, ctx.session_id),
    }
    return ok(request, payload)


#: Job stages that mean a conversion is already being worked on or has failed.
_NON_UPGRADE_JOB_STAGES = frozenset(
    {'queued', 'parsing', 'rendering', 'extracting', 'failed'}
)


def should_upgrade_conversion(
    conversion_version: object,
    job_stage: str | None,
    material_status: str,
    source_exists: bool,
) -> bool:
    """Only legacy, successfully finished materials may auto-upgrade once.

    A failed job must not be re-queued by a read request, otherwise every GET
    restarts the expensive conversion and keeps the material uneditable.
    """
    if not source_exists or conversion_version == 3:
        return False
    if job_stage in _NON_UPGRADE_JOB_STAGES:
        return False
    return material_status not in ('processing', 'failed')


@router.get("/materials/{material_id}", summary="材料详情（端点 #7）")
def get_material(
    material_id: str, request: Request, ctx: SessionDep, db: DBDep, background_tasks: BackgroundTasks
) -> JSONResponse:
    """包含原文页、对象、候选与任务；``awaiting_confirmation`` 阶段供前端准备页（R3-AC6）。"""

    material = owned_material(db, ctx, material_id)
    job = _latest_job(db, material.id)
    # Existing uploads should gain the fixed conversion pipeline when reopened,
    # instead of requiring the user to repeatedly upload the same document.
    from ..editing import working_path
    spec_payload = read_ispec_payload(material.id) or {}
    if should_upgrade_conversion(
        spec_payload.get('conversion_version'),
        job.stage if job is not None else None,
        material.status,
        working_path(material.id).is_file(),
    ):
        now = to_iso(utc_now())
        job = JobRecord(id=f'job_{uuid4().hex}', session_id=ctx.session_id, material_id=material.id,
                        kind='upload', stage='queued', attempt=1, progress_pct=None,
                        created_at=now, updated_at=now)
        db.add(job)
        material.status = 'processing'
        db.commit()
        background_tasks.add_task(run_upload_job, job.id)
    stats = material_stats(db, [material.id]).get(material.id)
    payload = {
        "material": summary_payload(
            material_summary(db, material, stats, job_stage=job.stage if job is not None else None)
        ),
        "slides": _slides(db, material.id),
        "objects": _objects(db, material.id),
        "candidates": _candidates(material),
        # MaterialDetail.job 是 required + nullable：无任务时显式 null。
        "job": build_job_status(job) if job is not None else None,
        "ispecs": apply_document_specs(material.id,(read_ispec_payload(material.id) or {}).get("ispecs", [])),
        "scene_document": current_document(material.id),
        "edit_revision": (read_ispec_payload(material.id) or {}).get("edit_revision", 0),
        "render": {key: value for key, value in (read_render_manifest(material.id) or {}).items()
                   if key in ("render_engine", "fidelity", "render_status", "errors", "page_size")},
    }
    return ok(request, payload)


class ISpecParameterConfirmBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["confirm", "edit"] = "confirm"
    value: Any = None
    note: str = Field(default="", max_length=500)


def _validate_confirmed_value(parameter: Mapping[str, Any], value: Any) -> Any:
    type_ = str(parameter.get("type") or "number")
    if type_ in ("number", "integer"):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("参数必须是数值")
        number = float(value)
        if type_ == "integer" and not number.is_integer():
            raise ValueError("参数必须是整数")
        minimum, maximum = parameter.get("min"), parameter.get("max")
        if isinstance(minimum, (int, float)) and number < float(minimum):
            raise ValueError("参数小于允许范围")
        if isinstance(maximum, (int, float)) and number > float(maximum):
            raise ValueError("参数大于允许范围")
        return int(number) if type_ == "integer" else number
    if type_ == "boolean":
        if not isinstance(value, bool):
            raise ValueError("参数必须是布尔值")
        return value
    text = str(value)
    options = parameter.get("options")
    if type_ == "enum" and isinstance(options, list) and text not in options:
        raise ValueError("参数不在可选项中")
    return text


@router.post(
    "/materials/{material_id}/ispecs/{object_id}/parameters/{parameter_id}/confirm",
    summary="确认或修改 iSpec 推断参数（写入 user_checks）",
)
def confirm_ispec_parameter(
    material_id: str,
    object_id: str,
    parameter_id: str,
    body: ISpecParameterConfirmBody,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
) -> JSONResponse:
    """只修改 iSpec 派生参数来源，不改原稿；确认后可信报告逐项重算。"""

    from ..ppt_ai.util import hash_json, now_iso
    from ..trust import build_trust_report, page_texts_from_payload

    material = owned_material(db, ctx, material_id)
    payload = read_ispec_payload(material.id) or {}
    specs = payload.get("ispecs") if isinstance(payload.get("ispecs"), list) else []
    spec = next(
        (item for item in specs if isinstance(item, dict) and item.get("object_id") == object_id),
        None,
    )
    if spec is None:
        raise resource_unavailable()
    parameter = next(
        (
            item
            for item in spec.get("parameters", [])
            if isinstance(item, dict) and item.get("id") == parameter_id
        ),
        None,
    )
    if parameter is None:
        raise resource_unavailable()
    source = parameter.get("source") if isinstance(parameter.get("source"), dict) else {}
    before = parameter.get("default")
    after = before
    if body.action == "edit":
        if body.value is None:
            raise missing_field("修改参数时缺少 value", field="value")
        try:
            after = _validate_confirmed_value(parameter, body.value)
        except ValueError as exc:
            raise missing_field(str(exc), field="value") from exc
        parameter.setdefault("source_default", before)
        parameter["default"] = after
    checked_at = now_iso()
    before_hash = hash_json(before)
    after_hash = hash_json(after)
    checks = source.get("user_checks") if isinstance(source.get("user_checks"), list) else []
    checked = None
    if body.action == "confirm" and source.get("status") == "confirmed":
        # 同值重复确认是幂等操作：不追加新的 user_check，避免记录无限膨胀。
        for item in reversed(checks[-20:]):
            if (
                isinstance(item, Mapping)
                and item.get("decision") == "confirm"
                and item.get("before_hash") == before_hash
                and item.get("after_hash") == after_hash
            ):
                checked = dict(item)
                break
    if checked is None:
        checked = {
            "check_id": f"trc_{hash_json([object_id, parameter_id, body.action, before, after, checked_at])[:12]}",
            "decision": "edit" if body.action == "edit" else "confirm",
            "note": body.note[:500],
            "checked_at": checked_at,
            "before_hash": before_hash,
            "after_hash": after_hash,
        }
        source["status"] = "confirmed"
        source["user_checks"] = [*checks[-19:], checked]
        parameter["source"] = source
        write_ispec_payload(material.id, payload)
        if body.action == "edit":
            save_values(material.id, object_id, {parameter_id: after})
    trust = build_trust_report(spec, page_texts_from_payload(payload))
    return ok(
        request,
        {
            "object_id": object_id,
            "parameter_id": parameter_id,
            "value": after,
            "user_check": checked,
            "trust": trust,
        },
    )


@router.get("/materials/{material_id}/project-package", summary="导出 .xsproj 工程包")
def download_project_package(
    material_id: str,
    request: Request,
    ctx: SessionDep,
    db: DBDep,
) -> Response:
    material = owned_material(db, ctx, material_id)
    data = build_project_archive(material, read_ispec_payload(material.id) or {})
    filename = f"{material.id}.xsproj"
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/project-packages/import", status_code=201, summary="导入 .xsproj 工程包")
def import_project_package_endpoint(
    request: Request,
    ctx: WriteDep,
    db: DBDep,
    file: UploadFile = File(..., description=".xsproj 工程包，<= 64MB"),
) -> JSONResponse:
    # sync def：FastAPI 在线程池执行，解压不再阻塞事件循环。
    data = file.file.read(MAX_PACKAGE_BYTES + 1)
    if len(data) > MAX_PACKAGE_BYTES:
        raise limit_exceeded("工程包超过 64MB")
    try:
        result = import_project_archive(data, session_id=ctx.session_id, db=db)
    except ProjectPackageError as exc:
        raise missing_field(str(exc)) from exc
    return ok(request, result, status_code=201)


@router.delete("/materials/{material_id}", status_code=204, summary="删除材料（端点 #8）")
def delete_material(material_id: str, request: Request, ctx: WriteDep, db: DBDep) -> Response:
    """立即令材料及其派生资源不可访问，返回 204 无体（R2-AC4）。"""

    material = owned_material(db, ctx, material_id)
    object_ids = list(
        db.scalars(
            select(KnowledgeObjectRecord.id).where(
                KnowledgeObjectRecord.material_id == material.id
            )
        ).all()
    )
    if object_ids:
        db.execute(delete(CheckRecord).where(CheckRecord.object_id.in_(object_ids)))
        db.execute(delete(RunRecord).where(RunRecord.object_id.in_(object_ids)))
        db.execute(
            delete(ObjectVersionRecord).where(ObjectVersionRecord.object_id.in_(object_ids))
        )
        db.execute(
            delete(KnowledgeObjectRecord).where(KnowledgeObjectRecord.id.in_(object_ids))
        )
    db.execute(delete(ElementRecord).where(ElementRecord.material_id == material.id))
    db.execute(delete(PageRecord).where(PageRecord.material_id == material.id))
    db.execute(delete(JobRecord).where(JobRecord.material_id == material.id))
    # 发布快照随材料一起删除：可见链接与"材料不可访问"必须同时成立（P2-10）。
    db.execute(delete(ShareRecord).where(ShareRecord.material_id == material.id))
    db.delete(material)
    db.commit()

    # 原件与预览一并清理；失败不影响 204（离开数据库即不可访问）。
    shutil.rmtree(UPLOAD_DIR / material_id, ignore_errors=True)
    shutil.rmtree(render_dir(material_id), ignore_errors=True)
    # 区域确认/纠正的覆盖文件（P2 追加端点写入）随材料一起清理，避免孤儿数据。
    (DATA_DIR / "regions" / f"{material_id}.json").unlink(missing_ok=True)
    # 识别层 iSpec 产物随材料一起清理（离开数据库即不可访问）。
    (DATA_DIR / "ispecs" / f"{material_id}.json").unlink(missing_ok=True)
    # 用户保存的 iSpec 参数值（§10.1 第 5 步）随材料一起清理，避免孤儿数据。
    clear_values(material_id)
    logger.info("会话 %s 删除材料 %s（级联对象 %d 个）", ctx.session_id, material_id, len(object_ids))
    return empty(request)


@router.get(
    "/materials/{material_id}/assets/{asset_id}",
    summary="受鉴权的图片资源（端点 #9）",
)
def get_material_asset(
    material_id: str, asset_id: str, request: Request, ctx: SessionDep, db: DBDep
) -> FileResponse:
    """只允许读取**属于该材料**的图片，禁止用路径拼接直接读文件（§2.2.7 行为 6）。"""

    material = owned_material(db, ctx, material_id)
    element = db.scalars(
        select(ElementRecord)
        .where(ElementRecord.material_id == material.id, ElementRecord.asset_id == asset_id)
        .limit(1)
    ).first()
    if element is None or not element.asset_file:
        raise resource_unavailable()

    resolved = (REPO_ROOT / element.asset_file).resolve()
    allowed = False
    for base in (render_dir(material.id).resolve(), PPT_DIR.resolve()):
        try:
            resolved.relative_to(base)
            allowed = True
        except ValueError:
            continue
    if not allowed:
        raise resource_unavailable()
    if not resolved.is_file():
        raise resource_unavailable()

    media_type = IMAGE_MEDIA_TYPES.get(resolved.suffix.lower())
    if media_type is None:
        raise resource_unavailable()
    return FileResponse(path=str(resolved), media_type=media_type, filename=resolved.name)


#: 渲染清单里页图 URL 的前缀（与 `assets/{asset_id}` 同一套前端拼接方式）。
RENDER_URL_PREFIX = "renders"


def _render_pages_payload(material_id: str) -> list[dict[str, Any]]:
    """从 ``render.json``（缺失时扫描落盘页图）组装页清单。

    文件名一律取 ``Path(...).name`` 并以 ``PAGE_IMAGE_PATTERN`` 校验，
    即使 ``render.json`` 被篡改也无法越过产物目录。
    """

    manifest = read_render_manifest(material_id)
    items: list[dict[str, Any]] = []

    if manifest is not None:
        for entry in manifest.get("pages") or []:
            if not isinstance(entry, Mapping):
                continue
            file_name = Path(str(entry.get("file") or "")).name
            if PAGE_IMAGE_PATTERN.match(file_name) is None:
                continue
            erased_name: str | None = None
            raw_erased = entry.get("erased_file")
            if isinstance(raw_erased, str) and raw_erased:
                candidate = Path(raw_erased).name
                if PAGE_IMAGE_PATTERN.match(candidate) is not None:
                    erased_name = candidate
            try:
                page_no = int(entry.get("page_no") or 0)
            except (TypeError, ValueError):
                page_no = 0
            items.append(
                {
                    "page_no": page_no,
                    "image_url": f"{RENDER_URL_PREFIX}/{file_name}",
                    "bytes": entry.get("bytes"),
                    "erased_image_url": (
                        f"{RENDER_URL_PREFIX}/{erased_name}" if erased_name else None
                    ),
                }
            )
        if items:
            return items

    # 兜底：render.json 缺失或损坏时直接扫描产物目录（只认 sNN.png 形状）。
    for path in existing_page_images(material_id):
        if path.name.endswith("_erased.png"):
            continue
        match = PAGE_IMAGE_PATTERN.match(path.name)
        if match is None:
            continue
        erased_path = path.with_name(f"s{int(match.group('page_no')):02d}_erased.png")
        items.append(
            {
                "page_no": int(match.group("page_no")),
                "image_url": f"{RENDER_URL_PREFIX}/{path.name}",
                "bytes": path.stat().st_size,
                "erased_image_url": (
                    f"{RENDER_URL_PREFIX}/{erased_path.name}"
                    if erased_path.is_file()
                    else None
                ),
            }
        )
    return items


@router.get("/materials/{material_id}/renders", summary="渲染产物清单（端点 #9b，只读）")
def list_material_renders(
    material_id: str, request: Request, ctx: SessionDep, db: DBDep
) -> JSONResponse:
    """返回该材料的整页底图清单、引擎与保真度（§3.1/§3.2）。

    渲染失败不隐藏材料：``readable`` 为真时页面仍可读，``reason`` 说明降级原因。
    """

    material = owned_material(db, ctx, material_id)
    manifest = read_render_manifest(material.id) or {}
    pages = _render_pages_payload(material.id)
    raw_errors = manifest.get("errors")
    errors = [str(item) for item in raw_errors] if isinstance(raw_errors, list) else []
    try:
        manifest_page_count = int(manifest.get("page_count") or 0)
    except (TypeError, ValueError):
        manifest_page_count = 0

    payload = {
        "material_id": material.id,
        "engine": manifest.get("render_engine"),
        "fidelity": manifest.get("fidelity"),
        "status": manifest.get("render_status"),
        "readable": bool(pages) or material.status == READINESS_READABLE,
        "page_count": len(pages) or manifest_page_count,
        "page_size": manifest.get("page_size"),
        "background": manifest.get("background"),
        "pages": pages,
        "reason": ("；".join(errors) if errors else None),
        "rendered_at": manifest.get("rendered_at"),
    }
    return ok(request, payload)


#: 每个缩略图目标路径一把锁：并发请求同一张图时只生成一次。
_thumbnail_locks: dict[Path, threading.Lock] = {}
_thumbnail_locks_guard = threading.Lock()


def _thumbnail_lock(destination: Path) -> threading.Lock:
    with _thumbnail_locks_guard:
        return _thumbnail_locks.setdefault(destination, threading.Lock())


def _write_webp_thumbnail(source: Path, destination: Path, width: int) -> None:
    """按宽度等比生成 WebP；先写临时文件再 ``os.replace``，避免读到半个文件。"""

    from PIL import Image

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.{uuid4().hex}.tmp")
    try:
        with Image.open(source) as opened:
            opened.load()
            image = opened
            if image.width > width:
                height = max(1, round(image.height * width / image.width))
                image = image.resize((width, height), Image.Resampling.LANCZOS)
            if image.mode not in ("RGB", "RGBA"):
                image = image.convert("RGB")
            quality = 85 if width >= 960 else 80
            image.save(temporary, format="WEBP", quality=quality, method=4)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def _ensure_thumbnail(source: Path, destination: Path, width: int) -> bool:
    """确保缩略图已落盘；生成失败时返回 ``False``，由调用方回退到整页图。"""

    lock = _thumbnail_lock(destination)
    with lock:
        if destination.is_file() and destination.stat().st_size > 0:
            try:
                # 源图被重新渲染覆盖时（文件名不变、bytes 变化）也要重建缓存。
                if destination.stat().st_mtime_ns >= source.stat().st_mtime_ns:
                    return True
            except OSError:
                pass
        try:
            _write_webp_thumbnail(source, destination, width)
            return True
        except Exception:  # noqa: BLE001 - 缩略图是可选优化，失败不阻断阅读
            logger.warning("缩略图生成失败：%s", destination, exc_info=True)
            return False


@router.get(
    "/materials/{material_id}/renders/{file_name}",
    summary="受鉴权的整页/擦除页图（端点 #9c）",
)
def get_material_render_page(
    material_id: str,
    file_name: str,
    request: Request,
    ctx: SessionDep,
    db: DBDep,
    w: int | None = Query(
        default=None,
        description=f"可选页图宽度（px），仅支持 {THUMBNAIL_WIDTHS}",
    ),
    v: str | None = Query(
        default=None,
        max_length=64,
        description="页图版本（渲染产物的 bytes），用于不可变长缓存",
    ),
) -> FileResponse:
    """只允许读**属于该材料**的 ``sNN.png`` / ``sNN_erased.png``。

    不把 ``data/renders`` 暴露为静态目录：路径由服务端拼接并在产物目录内二次校验，
    文件名不匹配白名单一律 ``SESSION_EXPIRED``/资源不可用（不暴露是否存在）。

    带 ``w`` 时按需生成并缓存 WebP 缩略图；带 ``v`` 时允许浏览器长期缓存。
    """

    material = owned_material(db, ctx, material_id)
    if PAGE_IMAGE_PATTERN.match(file_name) is None:
        raise resource_unavailable()

    base = pages_dir(material.id).resolve()
    target = (base / file_name).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        raise resource_unavailable() from None
    if not target.is_file():
        raise resource_unavailable()

    headers = {"Cache-Control": RENDER_CACHE_CONTROL} if v else None

    if w is not None:
        if w not in THUMBNAIL_WIDTHS:
            raise invalid_file(
                "缩略图宽度不支持", requested=w, allowed=list(THUMBNAIL_WIDTHS)
            )
        thumbnail = (base / THUMBNAIL_DIR_NAME / f"{target.stem}_w{w}.webp").resolve()
        try:
            thumbnail.relative_to(base)
        except ValueError:
            raise resource_unavailable() from None
        if _ensure_thumbnail(target, thumbnail, w):
            return FileResponse(
                path=str(thumbnail),
                media_type="image/webp",
                filename=thumbnail.name,
                headers=headers,
            )

    return FileResponse(
        path=str(target),
        media_type=RENDER_PAGE_MEDIA_TYPE,
        filename=file_name,
        headers=headers,
    )


__all__ = [
    "IMAGE_MEDIA_TYPES",
    "PUBLIC_STATUS_MAP",
    "RENDER_PAGE_MEDIA_TYPE",
    "RENDER_URL_PREFIX",
    "SLIDE_ENTRY_PATTERN",
    "inspect_pptx_archive",
    "material_summary",
    "public_material_status",
    "router",
]
