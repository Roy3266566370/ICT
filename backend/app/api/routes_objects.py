"""对象端点（``C-API@1`` #12–#14；R5-AC3/AC4/AC5、R10-AC6/AC7、R12-AC3）。

- ``GET /objects/{object_id}``（#12）：对象文档 + 最新校验报告（``checks_summary``）。
- ``PUT /objects/{object_id}/model``（#13）：保存模型，带乐观锁：
  * ``expected_version``（契约字段）必须等于库中 ``model_version``；
  * 额外的 ``If-Match`` 头（兼容 ``"3"`` / ``W/"3"`` / ``"3:12"``）与
    ``X-Base-Revision`` 头作为补充锁（见回报中的契约缺口 C-T10-02）；
  * 冲突 → 409 ``VERSION_CONFLICT``，``details.current`` 回传库中当前对象供前端合并。
  成功时：结构变更（模板/config/绑定/来源/参数形态）→ ``model_version + 1`` 且
  ``revision`` 归 0，并新增 ``object_versions`` 留档；仅数值变更 → 只推进 ``revision``。
- ``POST /objects/{object_id}/compile``（#14）：同步预检（缺参/越界/未知模板立即报错）+
  202 返回 ``job_id``，由 ``BackgroundTasks`` 推进 ``compiling → validating → ready``
  并把报告写入 ``checks``。

所有读请求走会话归属校验（他人对象 → 404 + ``SESSION_EXPIRED``，不暴露存在性，D2）；
所有写请求走 ``WriteDep``（Origin + CSRF）。
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy import select, update

from ..db.models import (

    JobRecord,
    KnowledgeObjectRecord,
    ObjectVersionRecord,
)
from ..db.session import session_scope
from ..schemas.api_models import (
    CompileAccepted,
    CompileRequest,
    ObjectEnvelope,

    PutModelRequest,
)
from ..schemas.common import to_iso, utc_now
from ..schemas.errors import (

    from_validation_error,
    missing_field,
    model_unavailable,
)
from ..schemas.knowledge_object import KnowledgeObject
from . import API_PREFIX, DBDep, SessionDep, WriteDep, ok, owned_object
from ._object_helpers import (
    api_error_from,
    build_validation_report,
    compute_result,
    conflict_for,
    kernel_error_boundary,
    latest_check_row,
    persist_check,
    stale_report,
    structural_signature,
    template_of,
    validate_parameter_ranges,
)
from .routes_jobs import IllegalStateTransition, mark_failed, transition

logger = logging.getLogger(__name__)

router = APIRouter(prefix=API_PREFIX, tags=["objects"])


# ---------------------------------------------------------------------------
# 小工具
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return to_iso(utc_now())



def _refresh_record(db: Any, object_id: str) -> KnowledgeObjectRecord:
    """冲突时重新读取库中最新状态（rollback 已让身份映射失效）。"""

    fresh = db.get(KnowledgeObjectRecord, object_id)
    if fresh is None:  # pragma: no cover - 冲突前刚校验过归属
        raise model_unavailable("对象在保存过程中被删除，请重新载入")
    return fresh


def _parse_lock_header(raw: str) -> tuple[tuple[str, int], ...] | None:
    """解析 ``If-Match``：支持 ``"3"`` / ``W/"3"`` / ``"3:12"`` 三种写法。

    ``"mv:rev"`` 形态同时锁 ``model_version`` 与 ``revision``，这样"只改数值"的保存
    （不推进 ``model_version``）也能被检出为过期基线。

    :returns: 需要比对的条件元组；无法解析时返回 ``None``。
    """

    token = raw.strip()
    if token.startswith("W/"):
        token = token[2:].strip()
    token = token.strip('"').strip()
    if not token:
        return None
    if ":" in token:
        model_text, _, revision_text = token.partition(":")
        try:
            return (
                ("model_version", int(model_text)),
                ("revision", int(revision_text)),
            )
        except ValueError:
            return None
    try:
        return (("model_version", int(token)),)
    except ValueError:
        return None


def _assert_put_preconditions(
    request: Request, record: KnowledgeObjectRecord, expected_version: int
) -> None:
    """乐观锁：``expected_version`` 为主，``If-Match`` / ``X-Base-Revision`` 为补充。"""

    if expected_version != record.model_version:
        raise conflict_for(record)

    raw_if_match = request.headers.get("if-match")
    if raw_if_match:
        conditions = _parse_lock_header(raw_if_match)
        if conditions is None:
            raise missing_field("If-Match 头格式不合法", header="If-Match", value=raw_if_match)
        for kind, value in conditions:
            current = record.model_version if kind == "model_version" else record.revision
            if value != current:
                raise conflict_for(
                    record,
                    f"内容版本已变化（If-Match 的 {kind} 不匹配），请重新载入后确认",
                )

    base_revision = request.headers.get("x-base-revision")
    if base_revision:
        try:
            revision_value = int(base_revision.strip())
        except ValueError:
            raise missing_field(
                "X-Base-Revision 头格式不合法", header="X-Base-Revision", value=base_revision
            ) from None
        if revision_value != record.revision:
            raise conflict_for(record, "参数版本已变化（base_revision 不匹配），请重新载入后确认")


def _object_version_row(
    db: Any, object_id: str, model_version: int
) -> ObjectVersionRecord | None:
    return db.scalars(
        select(ObjectVersionRecord)
        .where(
            ObjectVersionRecord.object_id == object_id,
            ObjectVersionRecord.model_version == model_version,
        )
        .limit(1)
    ).first()


# ---------------------------------------------------------------------------
# 端点 #12：读取对象
# ---------------------------------------------------------------------------


@router.get("/objects/{object_id}", summary="读取对象与最新校验（端点 #12）")
def get_object(object_id: str, request: Request, ctx: SessionDep, db: DBDep) -> JSONResponse:
    """返回对象当前文档与最新校验报告；``is_stale`` 按当前版本动态计算。"""

    record = owned_object(db, ctx, object_id)
    # 稳定取"最近报告"：优先绑定当前版本者，其次 created_at 倒序、同秒 rowid 倒序（P1 修复）。
    latest = latest_check_row(db, record.id, record.model_version, record.revision)
    report = (
        stale_report(latest.report, record.model_version, record.revision)
        if latest is not None
        else None
    )
    payload = {
        "object": KnowledgeObject.model_validate(record.document).model_dump(mode="json"),
        "checks_summary": report,
    }
    return ok(request, payload)


# ---------------------------------------------------------------------------
# 端点 #13：保存模型（乐观锁 + 版本推进）
# ---------------------------------------------------------------------------


@router.put("/objects/{object_id}/model", summary="保存对象模型（端点 #13）")
def put_object_model(
    object_id: str,
    body: PutModelRequest,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
) -> JSONResponse:
    """保存模型；结构变更推进 ``model_version``，仅数值变更推进 ``revision``。"""

    record = owned_object(db, ctx, object_id)
    _assert_put_preconditions(request, record, body.expected_version)

    stored_document = record.document if isinstance(record.document, dict) else {}
    document: dict[str, Any] = body.object.model_dump(mode="json")
    if document.get("object_id") != object_id:
        raise missing_field(
            "请求体 object.object_id 必须与路径一致", field="object_id"
        )

    # 归属与创建时间由服务端持有：客户端不得通过 PUT 改写材料归属或创建时间。
    document["object_id"] = object_id
    document["material_id"] = stored_document.get("material_id")
    created_at = stored_document.get("created_at")
    if isinstance(created_at, str) and created_at:
        document["created_at"] = created_at
    document["updated_at"] = _now_iso()

    # 参数范围：越界 → 422 MISSING_FIELD（details.field 精确到参数 / 分量）。
    with kernel_error_boundary():
        validate_parameter_ranges(document)

    structural = structural_signature(stored_document) != structural_signature(document)
    new_model_version = record.model_version + 1 if structural else record.model_version
    new_revision = 0 if structural else record.revision + 1
    document["model_version"] = new_model_version
    document["revision"] = new_revision

    try:
        KnowledgeObject.model_validate(document)
    except ValidationError as exc:
        raise from_validation_error(exc) from exc

    # 条件更新：WHERE 带 expected_version，保证并发两次 PUT 只有一次成功（真正乐观锁）。
    result = db.execute(
        update(KnowledgeObjectRecord)
        .where(
            KnowledgeObjectRecord.id == object_id,
            KnowledgeObjectRecord.model_version == body.expected_version,
        )
        .values(
            template_id=document["template_id"],
            kernel_version=document["kernel_version"],
            model_version=new_model_version,
            revision=new_revision,
            validation_profile=document["validation_profile"],
            document=document,
            updated_at=document["updated_at"],
        )
    )
    if result.rowcount != 1:
        db.rollback()
        raise conflict_for(_refresh_record(db, object_id))

    if structural:
        # 结构版本留档：新 ``model_version`` 一行，绝不原地覆盖历史（R5-AC4）。
        if _object_version_row(db, object_id, new_model_version) is None:
            db.add(
                ObjectVersionRecord(
                    id=f"ver_{uuid4().hex}",
                    object_id=object_id,
                    model_version=new_model_version,
                    revision=new_revision,
                    document=document,
                    created_at=document["updated_at"],
                )
            )
    db.commit()

    logger.info(
        "会话 %s 保存对象 %s：%s（model_version=%d，revision=%d）",
        ctx.session_id,
        object_id,
        "结构变更" if structural else "仅数值变更",
        new_model_version,
        new_revision,
    )
    saved = ObjectEnvelope(object=KnowledgeObject.model_validate(document))
    return ok(request, saved.model_dump(mode="json"))


# ---------------------------------------------------------------------------
# 端点 #14：编译（预检同步 + 任务异步推进）
# ---------------------------------------------------------------------------


def run_compile_job(job_id: str) -> None:
    """``BackgroundTasks`` 入口：``compiling → validating → ready``，报告写入 ``checks``。

    任务在建单时即为 ``compiling``：``jobs`` 的状态机（T7 的 ``ALLOWED_TRANSITIONS``）
    只允许 ``queued → parsing``，不存在 ``queued → compiling`` 迁移；而 §2.3.5 的编译
    时序正是 ``POST /compile (202) → compiling → validating → ready``。
    """

    with session_scope() as db:
        job = db.get(JobRecord, job_id)
        if job is None:
            logger.warning("编译任务 %s 不存在，跳过推进", job_id)
            return
        if job.stage != "compiling":
            logger.info("编译任务 %s 当前阶段 %s，跳过推进（幂等）", job_id, job.stage)
            return

        record = db.get(KnowledgeObjectRecord, job.object_id) if job.object_id else None
        try:
            if record is None:
                raise missing_field("对象不存在，无法编译", field="object_id")
            document = record.document
            validate_parameter_ranges(document)
            result = compute_result(document)
            report = build_validation_report(
                document,
                result,
                record.model_version,
                record.revision,
                current_model_version=record.model_version,
                current_revision=record.revision,
            )
        except Exception as exc:  # noqa: BLE001 - 后台任务不得把异常抛给无人处理的调用栈
            mapped = api_error_from(exc)
            if mapped is None:
                logger.exception("编译任务 %s 未预期失败", job_id)
                mapped = model_unavailable("编译任务处理失败，可稍后重试")
            mark_failed(db, job, None, mapped)
            return

        try:
            transition(db, job, "validating", progress_pct=None)
            persist_check(db, record, report)
            db.commit()
            transition(db, job, "ready", progress_pct=100)
        except IllegalStateTransition:
            logger.error("编译任务 %s 在 validating 阶段发生非法迁移", job_id)
        except Exception as exc:  # noqa: BLE001 - 留档失败也必须落成 failed 事实
            mapped = api_error_from(exc)
            if mapped is None:
                logger.exception("编译任务 %s 留档失败", job_id)
                mapped = model_unavailable("编译任务留档失败，可稍后重试")
            mark_failed(db, job, None, mapped)


@router.post(
    "/objects/{object_id}/compile",
    status_code=202,
    summary="编译并校验对象（端点 #14）",
)
def compile_object(
    object_id: str,
    body: CompileRequest,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
    background_tasks: BackgroundTasks,
) -> JSONResponse:
    """同步预检后返回 202 + ``job_id``；前端按 #10 轮询任务状态。"""

    record = owned_object(db, ctx, object_id)
    if body.model_version != record.model_version:
        raise conflict_for(record)

    document = record.document if isinstance(record.document, dict) else {}
    with kernel_error_boundary():
        template_of(document)  # 非白名单 → 422 UNSUPPORTED_TEMPLATE
        validate_parameter_ranges(document)
        result = compute_result(document)
        build_validation_report(document, result, record.model_version, record.revision)

    if record.material_id is None:
        # ``jobs.material_id`` 非空（§2.1.1 表结构），无材料归属时无法建任务（缺口 C-T10-01）。
        raise missing_field("对象未关联材料，无法创建编译任务", field="material_id")

    now = _now_iso()
    job_id = f"job_{uuid4().hex}"
    db.add(
        JobRecord(
            id=job_id,
            session_id=ctx.session_id,
            material_id=record.material_id,
            object_id=object_id,
            kind="compile",
            # 编译任务直接进入 compiling：状态机不允许 queued→compiling（见 run_compile_job）。
            stage="compiling",
            attempt=1,
            progress_pct=None,
            created_at=now,
            updated_at=now,
        )
    )
    db.commit()

    background_tasks.add_task(run_compile_job, job_id)
    logger.info("会话 %s 提交编译任务 %s（object=%s）", ctx.session_id, job_id, object_id)
    return ok(request, CompileAccepted(job_id=job_id), status_code=202)


__all__ = ["router", "run_compile_job"]