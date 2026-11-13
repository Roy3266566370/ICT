"""运行端点（``C-API@1`` #15–#17；R10-AC4/AC5、R11-AC4）。

- ``POST /objects/{object_id}/runs``（#15）：校验 ``model_version`` / ``revision`` 与库中
  一致后，**用确定性内核按冻结的对象重算并覆盖客户端上传的 ``result``**，再写 ``runs``
  与 ``checks``，返回 ``RunSnapshot``（201）。
- ``GET /objects/{object_id}/runs``（#16）：分页列表（默认 20、最大 50），按时间倒序。
- ``GET /runs/{run_id}``（#17）：单次运行详情（回放只读 ``input_snapshot``）。

幂等：同一对象、同一 ``model_version+revision`` 且计算相关字段完全一致的重复提交
直接返回既有快照，不产生重复数据（任务约束 6）。

归属：运行与对象都按会话校验，越权一律 404 + ``SESSION_EXPIRED``（D2，不暴露存在性）。
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select

from ..db.models import KnowledgeObjectRecord, RunRecord
from ..schemas.api_models import CreateRunRequest
from ..schemas.common import to_iso, utc_now
from ..schemas.errors import missing_field, resource_unavailable, version_conflict
from . import API_PREFIX, DBDep, SessionDep, WriteDep, clamp_limit, ok, owned_object
from ._object_helpers import (
    RUN_TABLE_ROWID,
    build_validation_report,
    computation_fingerprint,
    compute_result,
    conflict_for,
    kernel_error_boundary,
    persist_check,
    recent_run_rows,
    run_payload,
    stale_report,
    validate_parameter_ranges,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix=API_PREFIX, tags=["runs"])

#: 幂等判定时回看的历史运行条数（同一版本下通常只有极少数几条）。
IDEMPOTENCY_WINDOW = 10


def owned_run(db: Any, ctx: Any, run_id: str) -> RunRecord:
    """取当前会话的运行；不存在或属他人一律 404 + ``SESSION_EXPIRED``（D2）。"""

    row = db.get(RunRecord, run_id)
    if row is None or row.session_id != ctx.session_id:
        raise resource_unavailable()
    return row


def _find_identical_run(
    db: Any, object_id: str, model_version: int, revision: int, fingerprint: str
) -> RunRecord | None:
    """在最近若干条同版本运行中查找计算指纹完全一致的快照（幂等）。

    同秒内多条运行时同样用 ``rowid`` 兜底排序，保证返回的是最新的那条既有快照。
    """

    rows = db.scalars(
        select(RunRecord)
        .where(
            RunRecord.object_id == object_id,
            RunRecord.model_version == model_version,
            RunRecord.revision == revision,
        )
        .order_by(RunRecord.created_at.desc(), RUN_TABLE_ROWID.desc())
        .limit(IDEMPOTENCY_WINDOW)
    ).all()
    for row in rows:
        snapshot = row.input_snapshot
        if isinstance(snapshot, dict) and computation_fingerprint(snapshot) == fingerprint:
            return row
    return None


def _snapshot_payload(
    *,
    run_id: str,
    object_id: str,
    model_version: int,
    revision: int,
    kernel_version: str,
    input_snapshot: dict[str, Any],
    result: Any,
    report: dict[str, Any] | None,
    created_at: str,
) -> dict[str, Any]:
    """构造与 ``C-RUN@1`` 逐字一致的 ``RunSnapshot`` 响应体。"""

    return {
        "run_id": run_id,
        "object_id": object_id,
        "model_version": model_version,
        "revision": revision,
        "kernel_version": kernel_version,
        "input_snapshot": input_snapshot,
        "result": result,
        "validation_report": report,
        "created_at": created_at,
    }


# ---------------------------------------------------------------------------
# 端点 #15：提交运行
# ---------------------------------------------------------------------------


@router.post(
    "/objects/{object_id}/runs",
    status_code=201,
    summary="提交运行并冻结快照（端点 #15）",
)
def create_run(
    object_id: str,
    body: CreateRunRequest,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
) -> JSONResponse:
    """服务端重算并覆盖 ``result``，写 ``runs`` + ``checks`` 后返回快照。"""

    record = owned_object(db, ctx, object_id)
    if body.model_version != record.model_version or body.revision != record.revision:
        raise conflict_for(record)

    snapshot = body.input_snapshot
    if snapshot.object_id != object_id:
        raise missing_field(
            "input_snapshot.object_id 必须与路径一致", field="input_snapshot.object_id"
        )
    if snapshot.model_version != body.model_version:
        raise missing_field(
            "input_snapshot.model_version 必须与请求体一致",
            field="input_snapshot.model_version",
        )
    if snapshot.revision != body.revision:
        raise missing_field(
            "input_snapshot.revision 必须与请求体一致",
            field="input_snapshot.revision",
        )

    document: dict[str, Any] = snapshot.model_dump(mode="json")
    fingerprint = computation_fingerprint(document)
    stored_document = record.document if isinstance(record.document, dict) else {}
    if fingerprint != computation_fingerprint(stored_document):
        # 版本号相同但内容不同：客户端基于过期参数/结构，按版本冲突处理（§2.3.2）。
        raise version_conflict(
            "input_snapshot 与库中对象不一致（可能基于过期的本地参数），请重新载入后确认",
            current={
                "model_version": record.model_version,
                "revision": record.revision,
                "updated_at": record.updated_at,
                "object": stored_document,
            },
        )

    existing = _find_identical_run(
        db, object_id, body.model_version, body.revision, fingerprint
    )
    if existing is not None:
        logger.info("运行幂等命中：object=%s run=%s", object_id, existing.id)
        return ok(
            request,
            run_payload(existing, record.model_version, record.revision),
            status_code=201,
        )

    # 客户端 result 只用于对比，服务端必定重算覆盖（§2.2.7 行为 3）。
    with kernel_error_boundary():
        validate_parameter_ranges(document)
        result = compute_result(document)
        report = build_validation_report(
            document, result, body.model_version, body.revision
        )

    now = to_iso(utc_now())
    run_id = f"run_{uuid4().hex}"
    db.add(
        RunRecord(
            id=run_id,
            session_id=ctx.session_id,
            object_id=object_id,
            model_version=body.model_version,
            revision=body.revision,
            kernel_version=str(document["kernel_version"]),
            input_snapshot=document,
            result=result,
            validation_report=report,
            created_at=now,
        )
    )
    persist_check(db, record, report)
    db.commit()

    logger.info(
        "会话 %s 保存运行 %s（object=%s，model_version=%d，revision=%d）",
        ctx.session_id,
        run_id,
        object_id,
        body.model_version,
        body.revision,
    )
    return ok(
        request,
        _snapshot_payload(
            run_id=run_id,
            object_id=object_id,
            model_version=body.model_version,
            revision=body.revision,
            kernel_version=str(document["kernel_version"]),
            input_snapshot=document,
            result=result,
            report=stale_report(report, record.model_version, record.revision),
            created_at=now,
        ),
        status_code=201,
    )


# ---------------------------------------------------------------------------
# 端点 #16：运行列表
# ---------------------------------------------------------------------------


@router.get("/objects/{object_id}/runs", summary="运行历史列表（端点 #16）")
def list_runs(
    object_id: str,
    request: Request,
    ctx: SessionDep,
    db: DBDep,
    limit: int | None = Query(default=None, ge=1, description="默认 20，最大 50"),
) -> JSONResponse:
    """当前对象的运行快照列表；``[0]`` 为最新一次运行（同秒用 ``runs.rowid`` 兜底）。

    ``is_stale`` 按对象当前版本动态计算。
    """

    record = owned_object(db, ctx, object_id)
    # 稳定排序：created_at 只有秒级精度，同秒必须用 rowid 还原插入先后（P1 修复）。
    rows = recent_run_rows(db, record.id, limit=clamp_limit(limit))
    # 列表项全部来自同一批 ``runs`` 行的 JSON 列，不再逐条回查（无 N+1）。
    items = [run_payload(row, record.model_version, record.revision) for row in rows]
    return ok(request, {"items": items})


# ---------------------------------------------------------------------------
# 端点 #17：运行详情（回放）
# ---------------------------------------------------------------------------


@router.get("/runs/{run_id}", summary="运行详情与回放（端点 #17）")
def get_run(run_id: str, request: Request, ctx: SessionDep, db: DBDep) -> JSONResponse:
    """回放只读取冻结的 ``input_snapshot``，不被当前参数覆盖（R10-AC5）。

    ``#17`` 按主键取单条，**不依赖列表顺序**；"上一条/下一条运行"由前端按 #16 的
    稳定倒序（``created_at DESC, runs.rowid DESC``）推导。
    """

    run = owned_run(db, ctx, run_id)
    record = db.get(KnowledgeObjectRecord, run.object_id)
    current_model_version = record.model_version if record is not None else run.model_version
    current_revision = record.revision if record is not None else run.revision
    return ok(request, run_payload(run, current_model_version, current_revision))


__all__ = ["owned_run", "router"]