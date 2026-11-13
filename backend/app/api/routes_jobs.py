"""任务端点与状态机（``C-API@1`` #10、#11；R3-AC3/AC4/AC5）。

状态机（**只允许**下列迁移，``failed`` 可从任意阶段进入）::

    queued → parsing → rendering → extracting → awaiting_confirmation
           → compiling → validating → ready
    任意阶段 → failed；failed → queued（retry，attempt+1）

要点：

- ``rendering`` 阶段不编造百分比，``progress_pct`` 必须为 ``None``（§2.3.5）。
- 非法迁移不会被静默忽略：写入 ``failed`` + 原因后抛内部错误（T7 验收 6）。
- ``awaiting_confirmation`` 不占 worker：上传任务到此为止，等待用户确认后由 T10 触发编译任务。
- 上传任务在 ``parsing``/``extracting`` 只调用 ``app.parsers`` 的 ``parse_pptx`` /
  ``map_candidates``，不复制解析逻辑；解析器缺失时降级为 ``MODEL_UNAVAILABLE``（503）。
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import zipfile
from xml.etree import ElementTree

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import ElementRecord, JobRecord, MaterialRecord, PageRecord
from ..db.session import session_scope
from ..ispec import filter_valid_ispecs, build_ispecs_detailed
from ..ispec.llm import build_provider
from ..render import READINESS_READABLE, RenderOutcome, render_for_material
from ..schemas.api_models import JOB_STAGE_ORDER, JobError, JobStatus, RetryAccepted
from ..schemas.common import to_iso, utc_now
from ..schemas.errors import (
    ApiError,
    ErrorCode,
    missing_field,
    model_unavailable,
    parse_failed,
    resource_unavailable,
)
from ..settings import DATA_DIR, UPLOAD_DIR
from . import API_PREFIX, DBDep, SessionDep, WriteDep, ok, owned_job, owned_material

logger = logging.getLogger(__name__)

router = APIRouter(prefix=API_PREFIX, tags=["jobs"])

#: 合法迁移表；``failed`` 可从任意阶段进入，``failed → queued`` 由 retry 触发（R3-AC3/AC4）。
ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    stage: frozenset({following, "failed"})
    for stage, following in zip(JOB_STAGE_ORDER, list(JOB_STAGE_ORDER[1:]) + [None])
    if following is not None
}
ALLOWED_TRANSITIONS["validating"] = frozenset({"ready", "failed"})
ALLOWED_TRANSITIONS["ready"] = frozenset({"failed"})
ALLOWED_TRANSITIONS["failed"] = frozenset({"queued"})

#: 阶段 → 进度百分比；``None`` 表示技术上不可计量，不编造数字（§2.3.5）。
STAGE_PROGRESS: dict[str, int | None] = {
    "queued": None,
    "parsing": 15,
    "rendering": None,
    "extracting": 60,
    "awaiting_confirmation": 100,
    "compiling": None,
    "validating": None,
    "ready": 100,
    "failed": None,
}

#: 未传参哨兵：用于区分"不更新 progress_pct"与"显式写 None"。
_UNSET: Any = object()

#: 上传原件在 ``backend/data/uploads/{material_id}/`` 下的文件名。
UPLOADED_FILE_NAME = "original.pptx"
#: 解析器产出中可能出现的页码字段。
ASSET_PAGE_KEY = "page_no"

#: iSpec 产物目录：``backend/data/ispecs/{material_id}.json``（按材料隔离，原子写）。
ISpec_DIR = DATA_DIR / "ispecs"
#: 材料 id 只允许安全字符（id 由服务端生成，这里是纵深防御：防路径穿越）。
MATERIAL_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,96}$")
#: 同目录多条并发写的串行锁（uvicorn 默认单进程多线程）。
_ISPEC_WRITE_LOCK = threading.Lock()


class IllegalStateTransition(RuntimeError):
    """非法状态迁移：已把任务写成 ``failed`` 并记录原因，再抛出供调用方感知。"""

    def __init__(self, job_id: str, previous: str, target: str) -> None:
        self.job_id = job_id
        self.previous = previous
        self.target = target
        super().__init__(f"非法状态迁移：{previous} → {target}（job={job_id}）")


# ---------------------------------------------------------------------------
# 状态迁移
# ---------------------------------------------------------------------------


def can_transition(current: str, target: str) -> bool:
    """判断迁移是否在允许表内。"""

    return target in ALLOWED_TRANSITIONS.get(current, frozenset())


def transition(
    db: Session,
    job: JobRecord,
    target: str,
    *,
    progress_pct: int | None | Any = _UNSET,
) -> None:
    """推进任务阶段并持久化；非法迁移写 ``failed`` 后抛 :class:`IllegalStateTransition`。

    ``progress_pct`` 不传则保留现值；显式传 ``None`` 表示该阶段不可计量（如 ``rendering``）。
    """

    if not can_transition(job.stage, target):
        previous = job.stage
        job.stage = "failed"
        job.error_code = ErrorCode.MISSING_FIELD.value
        job.error_message = f"非法状态迁移：{previous} → {target}"
        job.progress_pct = None
        job.updated_at = to_iso(utc_now())
        db.commit()
        logger.error("任务 %s 发生非法状态迁移：%s → %s", job.id, previous, target)
        raise IllegalStateTransition(job.id, previous, target)

    job.stage = target
    if progress_pct is not _UNSET:
        job.progress_pct = progress_pct if target != "rendering" else None
    job.updated_at = to_iso(utc_now())
    if target == "queued":
        job.progress_pct = None
    db.commit()
    logger.info("任务 %s 进入阶段 %s（attempt=%d）", job.id, target, job.attempt)


def mark_failed(db: Session, job: JobRecord, material: MaterialRecord | None, error: ApiError) -> None:
    """把任务与材料一起写成失败事实；``progress_pct`` 归零为 ``None``。

    特例（§3.1）：材料若已在本轮 ``rendering`` 阶段置为 ``readable``，**保持可读**——
    识别/编译失败只能让任务失败，不能让已生成的整页底图不可访问。
    """

    job.stage = "failed"
    job.error_code = error.code.value
    job.error_message = error.message
    job.progress_pct = None
    job.updated_at = to_iso(utc_now())
    if material is not None and material.status != READINESS_READABLE:
        material.status = "failed"
    db.commit()
    logger.warning(
        "任务 %s 失败（material=%s，code=%s）：%s",
        job.id,
        job.material_id,
        error.code.value,
        error.message,
    )


def build_job_status(job: JobRecord) -> JobStatus:
    """ORM → 契约 ``JobStatus``。"""

    error = None
    if job.error_code:
        try:
            code = ErrorCode(job.error_code)
        except ValueError:  # 历史脏数据不阻断查询
            code = ErrorCode.MODEL_UNAVAILABLE
        error = JobError(code=code, message=job.error_message or "")
    return JobStatus(
        job_id=job.id,
        material_id=job.material_id,
        kind=job.kind,  # type: ignore[arg-type]
        stage=job.stage,  # type: ignore[arg-type]
        attempt=job.attempt,
        progress_pct=job.progress_pct,
        error=error,
        updated_at=job.updated_at,
    )


# ---------------------------------------------------------------------------
# 解析器装配（T11 产物；缺失时降级，不让上传链路 500 裸抛）
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ParserBundle:
    """``C-MAT@1`` 的解析器导出集合。"""

    parse_pptx: Callable[[str], tuple[dict[str, Any], dict[str, Any]]]
    map_candidates: Callable[[str, dict[str, Any]], list[dict[str, Any]]]


def load_parser_bundle() -> ParserBundle | None:
    """尝试导入 ``app.parsers``；未交付、缺函数或导入报错都返回 ``None``。"""

    try:
        from app.parsers import map_candidates, parse_pptx  # noqa: PLC0415 - 缺失属预期路径
    except Exception as exc:  # pragma: no cover - 依赖 T11 交付
        logger.info("解析器不可用：app.parsers 导入失败（%s）", type(exc).__name__)
        return None
    if not callable(parse_pptx) or not callable(map_candidates):
        logger.info("解析器不可用：app.parsers 未导出 parse_pptx/map_candidates")
        return None
    return ParserBundle(parse_pptx=parse_pptx, map_candidates=map_candidates)


def upload_path(material_id: str) -> Path:
    """上传原件的落盘路径（§2.1.1：``backend/data/uploads/{material_id}/``）。"""

    return UPLOAD_DIR / material_id / UPLOADED_FILE_NAME


# ---------------------------------------------------------------------------
# iSpec 产物（识别层 → 前端只消费 iSpec）
# ---------------------------------------------------------------------------


def ispec_path(material_id: str) -> Path:
    """材料对应的 iSpec 文件路径；非法 id 按"资源不可用"处理。"""

    if MATERIAL_ID_PATTERN.match(material_id) is None:
        raise resource_unavailable()
    return ISpec_DIR / f"{material_id}.json"


def write_ispec_payload(material_id: str, payload: Mapping[str, Any]) -> Path:
    """原子写 iSpec 产物：先写同目录 ``.tmp``，再 ``os.replace`` 覆盖。

    ``ensure_ascii=False``：中文图表标题/表头必须保持可读原文。
    """

    target = ispec_path(material_id)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f"{target.name}.{uuid4().hex}.tmp")
    with _ISPEC_WRITE_LOCK:
        try:
            with tmp.open("w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, target)
        finally:
            tmp.unlink(missing_ok=True)
    return target


def read_ispec_payload(material_id: str) -> dict[str, Any] | None:
    """读取 iSpec 产物；缺失/损坏一律返回 ``None``（调用方返回空数组）。"""

    target = ispec_path(material_id)
    if not target.is_file():
        return None
    try:
        with target.open(encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, ValueError) as exc:
        logger.warning("材料 %s 的 iSpec 产物读取失败：%s", material_id, type(exc).__name__)
        return None
    return payload if isinstance(payload, dict) else None


def _persist_ispecs(material: MaterialRecord, slides_payload: Mapping[str, Any]) -> None:
    """``extracting`` 阶段：生成 iSpec 并原子落盘。

    识别失败不阻断上传链路（材料仍可读），只降低识别结论为"未识别"。
    产物为空数组时也必须落盘：显式表达"没有交互区域"，绝不回退示例区域。
    """

    fallback_reason = "识别层未产出 iSpec；未回退到公共示例区域"
    try:
        from ..editing import read_metadata
        from ..ispec.user_config import enrich_recognition, apply_user_interactions
        metadata = read_metadata(material.id)
        enriched, image_recognition, figure_scenes = enrich_recognition(slides_payload, material.id, metadata)
        # 未配置 LLM_PROVIDER / LLM_API_KEY 时 build_provider() 返回 NoopProvider，不联网。
        result = build_ispecs_detailed(enriched, material_id=material.id, llm=build_provider())
        ispecs = result.ispecs
        native_count = len(ispecs)
        ispecs = apply_user_interactions(ispecs, enriched, metadata)
        inferred_extra = len(ispecs) - native_count
        if inferred_extra > 0:
            # 识别结论在 builder 内先于图示启发式计算；补一句最终总数，避免“说 3 个、展示 7 个”。
            reason = result.recognition.get('reason') or ''
            result.recognition['reason'] = reason + f'；另有 {inferred_extra} 个图示启发式对象'
        if figure_scenes:
            reason = result.recognition.get('reason') or ''
            result.recognition['reason'] = reason + f'；{len(figure_scenes)} 张位图读图重建为可操作图形'
        for spec in ispecs:
            if metadata['revision']:
                spec['object_id'] += f'__r{metadata["revision"]}'
        from ..ispec.persistence import migrate_unchanged_values
        previous=(read_ispec_payload(material.id) or {}).get('ispecs',[])
        migrate_unchanged_values(material.id,previous,ispecs)
        errors = result.errors
        recognition = result.recognition
    except Exception:  # noqa: BLE001 - 识别异常不得让材料不可读
        logger.exception("材料 %s 的 iSpec 生成失败，已降级为空识别结果", material.id)
        ispecs = []
        errors = []
        recognition = {"found": False, "reason": fallback_reason}
        image_recognition = {}
        figure_scenes = {}
        metadata = {'revision': 0}

    payload = {
        "schema_version": "1.0",
        "conversion_version": 3,
        "material_id": material.id,
        "ispecs": ispecs,
        "edit_revision": metadata['revision'],
        "image_recognition": image_recognition,
        "figure_scenes": figure_scenes,
        "page_layouts": [{"page_no": page.get("page_no"), "title": page.get("title"), "width": page.get("width"),
                          "height": page.get("height"),
                          "elements": [{key: element.get(key) for key in
                                        ('element_id', 'kind', 'bbox', 'text', 'name')}
                                       for element in page.get('elements', []) if isinstance(element, Mapping)]}
                         for page in slides_payload.get("pages", []) if isinstance(page, Mapping)],
        "recognition": recognition,
        "errors": errors,
        "generated_at": to_iso(utc_now()),
    }
    try:
        write_ispec_payload(material.id, payload)
    except Exception:  # noqa: BLE001 - 落盘失败不阻断上传；端点会返回空识别
        logger.exception("材料 %s 的 iSpec 产物写入失败", material.id)
        return
    logger.info(
        "材料 %s 识别完成：%d 条 iSpec（found=%s）",
        material.id,
        len(ispecs),
        bool(recognition.get("found")) if isinstance(recognition, Mapping) else False,
    )


def _map_parse_error(exc: Exception) -> ApiError:
    """把解析器的 ``ParseError(code, message)`` 映射为 ``ApiError``（§2.2.10）。"""

    raw_code = getattr(exc, "code", None)
    if isinstance(raw_code, str):
        try:
            code = ErrorCode(raw_code)
        except ValueError:
            code = ErrorCode.PARSE_FAILED
        if code in (ErrorCode.INVALID_FILE, ErrorCode.PARSE_FAILED):
            message = getattr(exc, "message", None) or None
            return ApiError(code, message)
    logger.warning("解析器抛出未分类异常：%s", type(exc).__name__)
    return parse_failed()


# ---------------------------------------------------------------------------
# 页面与候选对象落库
# ---------------------------------------------------------------------------


def _page_id() -> str:
    return f"pg_{uuid4().hex[:20]}"


def _element_id() -> str:
    return f"el_{uuid4().hex[:20]}"


def _asset_file_map(slides_payload: Mapping[str, Any]) -> dict[str, str]:
    """``asset_id`` → 相对仓库根的文件路径（如 ``fixtures/ppt/s06_3.png``）。"""

    mapping: dict[str, str] = {}
    for asset in slides_payload.get("assets") or []:
        if not isinstance(asset, Mapping):
            continue
        asset_id = asset.get("asset_id")
        file_name = asset.get("file")
        if isinstance(asset_id, str) and isinstance(file_name, str):
            mapping[asset_id] = file_name
    return mapping


def persist_slides(db: Session, material: MaterialRecord, slides_payload: Mapping[str, Any]) -> int:
    """把 ``slides.json`` 的 pages/assets 落到 ``pages`` + ``elements``，返回页数。

    重复解析（retry）时先清空该材料的旧页与元素，避免重复行。
    """

    pages = slides_payload.get("pages")
    if not isinstance(pages, list):
        raise parse_failed("解析产物缺少 pages 数组", material_id=material.id)

    # retry 会重跑解析，先清空旧页与旧元素，避免重复行。
    for page in db.scalars(select(PageRecord).where(PageRecord.material_id == material.id)).all():
        db.delete(page)
    for element in db.scalars(
        select(ElementRecord).where(ElementRecord.material_id == material.id)
    ).all():
        db.delete(element)
    db.flush()

    asset_files = _asset_file_map(slides_payload)
    from ..render import read_render_manifest
    manifest_assets = ((read_render_manifest(material.id) or {}).get('assets') or {}).get('assets', {})
    for asset in manifest_assets.values():
        for occurrence in asset.get('occurrences', []):
            identifier = f'p{occurrence["page_no"]:02d}_s{occurrence["shape_index"]:02d}'
            asset_files[identifier] = asset['file']
    page_count = 0
    pending_elements: list[tuple[PageRecord, list[dict[str, Any]]]] = []

    # 先装配 page 行，再统一 flush：elements.page_id 是裸外键，flush 顺序不会被自动推导。
    for index, page in enumerate(pages):
        if not isinstance(page, Mapping):
            raise parse_failed(f"第 {index + 1} 条页面结构不合法", material_id=material.id)
        try:
            page_no = int(page.get("page_no", index + 1))
        except (TypeError, ValueError) as exc:
            raise parse_failed("页面缺少合法 page_no", material_id=material.id) from exc
        paragraphs = page.get("paragraphs")
        record = PageRecord(
            id=_page_id(),
            material_id=material.id,
            page_no=page_no,
            title=str(page.get("title") or ""),
            paragraphs=[str(item) for item in paragraphs] if isinstance(paragraphs, list) else [],
            excerpt=str(page.get("excerpt") or ""),
            image_asset_id=None,
        )
        raw_elements = page.get("elements")
        element_items = (
            [item for item in raw_elements if isinstance(item, Mapping)]
            if isinstance(raw_elements, list)
            else []
        )
        for element in element_items:
            asset_id = element.get("asset_id")
            if record.image_asset_id is None and isinstance(asset_id, str):
                record.image_asset_id = asset_id
        db.add(record)
        pending_elements.append((record, element_items))
        page_count += 1

    db.flush()  # pages 先落库，满足 elements.page_id 外键

    for record, element_items in pending_elements:
        for element in element_items:
            bbox = element.get("bbox") or {}
            asset_id = element.get("asset_id")
            db.add(
                ElementRecord(
                    id=_element_id(),
                    material_id=material.id,
                    page_id=record.id,
                    page_no=record.page_no,
                    element_id=str(element.get("element_id") or _element_id()),
                    kind=str(element.get("kind") or "shape"),
                    name=str(element.get("name") or ""),
                    bbox_x=float(bbox.get("x", 0.0) or 0.0),
                    bbox_y=float(bbox.get("y", 0.0) or 0.0),
                    bbox_w=float(bbox.get("w", 0.0) or 0.0),
                    bbox_h=float(bbox.get("h", 0.0) or 0.0),
                    text=(str(element["text"]) if element.get("text") is not None else None),
                    asset_id=asset_id if isinstance(asset_id, str) else None,
                    asset_file=asset_files.get(asset_id) if isinstance(asset_id, str) else None,
                )
            )

    material.page_count = page_count
    db.flush()
    return page_count


#: 候选对象对外只暴露 C-API@1 的四个字段（``additionalProperties: false``）。
CANDIDATE_KEYS: tuple[str, ...] = ("candidate_id", "template_id", "confidence_hint", "fields")
#: 候选字段对外只暴露三个字段。
CANDIDATE_FIELD_KEYS: tuple[str, ...] = ("parameter_id", "name", "status")


def project_candidate(item: Mapping[str, Any]) -> dict[str, Any]:
    """把解析器产出投影为契约形状。

    T11 的 ``map_candidates`` 会附带 ``raw_text`` / ``page`` / ``element_id`` 等额外字段，
    但 C-API@1 的 ``CandidateObject`` 是 ``additionalProperties:false`` 的四字段结构，
    因此这里只保留契约字段（丢弃的信息见回报中的契约缺口清单）。
    """

    fields: list[dict[str, Any]] = []
    raw_fields = item.get("fields")
    if isinstance(raw_fields, list):
        for field in raw_fields:
            if isinstance(field, Mapping):
                fields.append({key: field.get(key) for key in CANDIDATE_FIELD_KEYS})
    return {
        "candidate_id": item.get("candidate_id"),
        "template_id": item.get("template_id"),
        "confidence_hint": item.get("confidence_hint"),
        "fields": fields,
    }


def _persist_candidates(material: MaterialRecord, candidates: list[Any]) -> None:
    """候选对象按契约形状存 JSON 列（C-API@1 CandidateObject）。"""

    valid: list[dict[str, Any]] = []
    for item in candidates:
        if isinstance(item, Mapping):
            valid.append(project_candidate(item))
        else:
            logger.warning("忽略非对象型候选（material=%s）", material.id)
    material.candidates = valid


# ---------------------------------------------------------------------------
# 上传任务推进
# ---------------------------------------------------------------------------


def _render_pages(
    db: Session,
    job: JobRecord,
    material: MaterialRecord,
    source_file: Path,
) -> RenderOutcome | None:
    """``rendering`` 阶段：真渲染整页底图，**页图一出来材料即可读**（§3.1）。

    渲染失败不阻断上传链路：``render_for_material`` 内部已按优先级降级，最终以
    ``svg_fallback`` + ``fidelity: low`` 收尾，并把原因写进 ``render.json``；
    材料照常 ``readable``（结构化内容仍可读），前端据 ``/renders`` 的 fidelity 提示降级。
    """

    transition(db, job, "rendering", progress_pct=None)

    outcome: RenderOutcome | None = None
    try:
        # Read native page dimensions instead of stretching every file to 16:9.
        render_options = {}
        with zipfile.ZipFile(source_file) as archive:
            document = ElementTree.fromstring(archive.read('ppt/presentation.xml'))
            size = document.find('{http://schemas.openxmlformats.org/presentationml/2006/main}sldSz')
            if size is not None:
                cx, cy = int(size.attrib['cx']), int(size.attrib['cy'])
                if cx > 0 and cy > 0:
                    render_options = {'width': 1920, 'height': max(180, min(7680, round(1920*cy/cx))),
                                      'page_size_in': (cx/914400, cy/914400)}
        from ..editing import read_metadata
        outcome = render_for_material(material.id, source_file,
                                      revision=read_metadata(material.id)['revision'], **render_options)
    except Exception:  # noqa: BLE001 - 渲染异常不能让上传任务 500 或材料不可读
        logger.exception("材料 %s 渲染阶段未预期失败，降级为无页图可读", material.id)

    if outcome is not None and outcome.page_count > 0:
        # 渲染页数是最可靠的当前事实；解析完成后用解析结果覆盖。
        material.page_count = outcome.page_count

    # 渲染阶段结束立即置可读，不等识别/编译（§3.1）。
    material.status = READINESS_READABLE
    db.commit()

    if outcome is not None:
        logger.info(
            "材料 %s 渲染就绪：engine=%s fidelity=%s status=%s pages=%d",
            material.id,
            outcome.engine,
            outcome.fidelity,
            outcome.render_status,
            outcome.page_count,
        )
    return outcome


def _run_upload_pipeline(db: Session, job: JobRecord, material: MaterialRecord) -> None:
    """``queued → parsing → rendering → extracting → awaiting_confirmation``。"""

    transition(db, job, "parsing", progress_pct=STAGE_PROGRESS["parsing"])

    from ..editing import working_path
    source_file = working_path(material.id)
    if not source_file.is_file():
        raise parse_failed("上传原件丢失，请重新上传", stage="parsing")

    # 渲染先于识别：整页底图一落盘，材料即可读（§3.1）。
    _render_pages(db, job, material, source_file)

    bundle = load_parser_bundle()
    if bundle is None:
        # 解析器未就绪只影响结构化内容；页图已生成，材料保持可读（§3.1 末条）。
        raise model_unavailable(
            "解析器尚未就绪（规则化解析未交付）；整页底图已生成，可先浏览原始页面",
            stage="parsing",
        )

    try:
        material_payload, slides_payload = bundle.parse_pptx(str(source_file))
    except Exception as exc:
        raise _map_parse_error(exc) from exc

    transition(db, job, "extracting", progress_pct=STAGE_PROGRESS["extracting"])
    page_count = persist_slides(db, material, slides_payload or {})

    # 识别层只产出 iSpec：图表/表格/公式直读；为空即"未识别到交互区域"。
    _persist_ispecs(material, slides_payload or {})

    try:
        candidates = bundle.map_candidates(material.id, slides_payload or {})
    except Exception as exc:  # 候选生成失败不阻断原文阅读，但降级为 MODEL_UNAVAILABLE
        logger.warning("map_candidates 失败：%s", type(exc).__name__)
        raise model_unavailable("规则化候选生成不可用，已保留静态阅读入口", stage="extracting") from exc

    _persist_candidates(material, list(candidates or []))
    if isinstance(material_payload, Mapping):
        title = material_payload.get("title")
        if isinstance(title, str) and title.strip():
            material.title = title.strip()
        parsed_page_count = material_payload.get("page_count")
        if isinstance(parsed_page_count, int) and parsed_page_count >= 0:
            page_count = parsed_page_count
    material.page_count = max(page_count, 0)
    if material.page_count == 0:
        # §2.2.8：python-pptx 抛异常或解析结果 0 页 → PARSE_FAILED（可重试）。
        raise parse_failed("解析结果为 0 页，无法进入确认阶段", stage="extracting")
    material.status = "awaiting_confirmation"

    transition(db, job, "awaiting_confirmation", progress_pct=STAGE_PROGRESS["awaiting_confirmation"])


def run_upload_job(job_id: str) -> None:
    """``BackgroundTasks`` 入口：独立事务推进上传任务，异常一律落到 ``failed``。"""

    with session_scope() as db:
        job = db.get(JobRecord, job_id)
        if job is None:
            logger.warning("任务 %s 不存在，跳过推进", job_id)
            return
        if job.stage != "queued":
            # 只推进排队中的任务，重复调度时幂等退出（避免状态被回放）。
            logger.info("任务 %s 当前阶段 %s，跳过推进", job_id, job.stage)
            return
        material = db.get(MaterialRecord, job.material_id)
        try:
            if material is None:
                raise model_unavailable("材料不存在，请重新上传", stage="parsing")
            _run_upload_pipeline(db, job, material)
        except IllegalStateTransition:
            # transition() 已写 failed 并提交，这里只记录不覆盖。
            logger.error("任务 %s 因非法迁移终止", job_id)
        except ApiError as exc:
            mark_failed(db, job, material, exc)
        except Exception:  # noqa: BLE001 - 后台任务不得把异常抛给无人处理的调用栈
            logger.exception("任务 %s 未预期失败", job_id)
            mark_failed(
                db,
                job,
                material,
                model_unavailable("任务处理失败，可稍后重试"),
            )


# ---------------------------------------------------------------------------
# 端点
# ---------------------------------------------------------------------------


@router.get(
    "/materials/{material_id}/ispecs",
    summary="材料 iSpec 清单（受鉴权 + 归属校验）",
)
def get_material_ispecs(
    material_id: str, request: Request, ctx: SessionDep, db: DBDep
) -> JSONResponse:
    """返回识别层产出的 iSpec 与识别结论。

    **不回退公共示例区域**：真实材料没有 iSpec 时返回空数组 + ``found=false``，
    前端据此显示"未识别到交互区域"。读取产物时再跑一次 Schema 校验，
    非法条目丢弃并在 ``reason`` 中说明（不让坏数据进入运行时）。
    """

    material = owned_material(db, ctx, material_id)
    payload = read_ispec_payload(material.id)
    if payload is None:
        return ok(
            request,
            {
                "material_id": material.id,
                "ispecs": [],
                "recognition": {
                    "found": False,
                    "reason": "尚未完成识别（或材料未产出 iSpec）；不回退到公共示例区域",
                },
            },
        )

    raw_ispecs = payload.get("ispecs")
    items = raw_ispecs if isinstance(raw_ispecs, list) else []
    ispecs, dropped = filter_valid_ispecs(items)

    raw_recognition = payload.get("recognition")
    coverage = None
    if isinstance(raw_recognition, Mapping):
        reason = str(raw_recognition.get("reason") or "")
        if isinstance(raw_recognition.get("coverage"), Mapping):
            coverage = dict(raw_recognition["coverage"])
    else:
        reason = ""
    if dropped:
        reason = (reason or "识别结果不完整") + f"；读取时发现 {len(dropped)} 条非法 iSpec 已丢弃"
    recognition = {"found": bool(ispecs), "reason": reason}
    if coverage is not None:
        recognition["coverage"] = coverage
    return ok(
        request,
        {
            "material_id": material.id,
            "ispecs": ispecs,
            "recognition": recognition,
        },
    )


@router.get("/jobs/{job_id}", summary="任务状态（端点 #10）")
def get_job(job_id: str, request: Request, ctx: SessionDep, db: DBDep) -> JSONResponse:
    """返回任务事实；前端每 2 秒轮询，``ready``/``failed`` 时停止（R3-AC5）。"""

    job = owned_job(db, ctx, job_id)
    return ok(request, build_job_status(job))


@router.post("/jobs/{job_id}/retry", status_code=202, summary="重试任务（端点 #11）")
def retry_job(
    job_id: str,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
    background_tasks: BackgroundTasks,
) -> JSONResponse:
    """为失败任务生成新 ``attempt`` 并回到 ``queued``（R3-AC4）。

    非法重试（任务未失败）返回 ``MISSING_FIELD``，错误细节带当前阶段。
    """

    job = owned_job(db, ctx, job_id)
    if job.stage != "failed":
        raise missing_field("只有失败的任务可以重试", stage=job.stage)

    job.attempt = job.attempt + 1
    job.stage = "queued"
    job.progress_pct = None
    job.error_code = None
    job.error_message = None
    job.updated_at = to_iso(utc_now())
    db.commit()

    if job.kind == "upload":
        background_tasks.add_task(run_upload_job, job.id)
    else:
        # compile/validate 任务的推进属 T10；此处只重置事实，避免误跑上传流水线。
        logger.info("任务 %s 为 %s 类型，重试已排队，等待对应执行器推进", job.id, job.kind)

    logger.info("任务 %s 重试：attempt=%d", job.id, job.attempt)
    return ok(request, RetryAccepted(job_id=job.id, attempt=job.attempt), status_code=202)


#: 供 ``routes_materials`` 复用的导出。
__all__ = [
    "ALLOWED_TRANSITIONS",
    "ISpec_DIR",
    "IllegalStateTransition",
    "STAGE_PROGRESS",
    "UPLOADED_FILE_NAME",
    "build_job_status",
    "can_transition",
    "ispec_path",
    "load_parser_bundle",
    "mark_failed",
    "persist_slides",
    "read_ispec_payload",
    "router",
    "run_upload_job",
    "transition",
    "upload_path",
    "write_ispec_payload",
]
