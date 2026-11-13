"""校验端点（``C-API@1`` #18–#19；R11-AC3/AC4、R10-AC7）。

- ``POST /objects/{object_id}/validate``（#18）：对**当前对象**同步执行独立校验，
  返回 ``ValidationReport`` 并留档到 ``checks``（不写 ``runs``）。
- ``GET /objects/{object_id}/checks``（#19）：该对象历史报告列表，响应时按对象当前
  ``model_version`` / ``revision`` 动态重算 ``is_stale``（过期不得显示为通过）。

两条端点都按会话做归属校验（他人对象 → 404 + ``SESSION_EXPIRED``，D2）。
"""

from __future__ import annotations

import logging


from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from ..schemas.api_models import ValidateRequest
from . import API_PREFIX, DBDep, SessionDep, WriteDep, clamp_limit, ok, owned_object
from ._object_helpers import (
    build_validation_report,
    compute_result,
    conflict_for,
    kernel_error_boundary,
    persist_check,
    recent_check_rows,
    stale_report,
    validate_parameter_ranges,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix=API_PREFIX, tags=["checks"])


@router.post("/objects/{object_id}/validate", summary="独立校验并留档（端点 #18）")
def validate_object(
    object_id: str,
    body: ValidateRequest,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
) -> JSONResponse:
    """同步执行（D3）：内核重算 + 独立复核，返回报告并写入 ``checks``。"""

    record = owned_object(db, ctx, object_id)
    if body.model_version != record.model_version or body.revision != record.revision:
        raise conflict_for(record)

    document = record.document if isinstance(record.document, dict) else {}
    with kernel_error_boundary():
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

    persist_check(db, record, report)
    db.commit()

    payload = stale_report(report, record.model_version, record.revision)
    summary = payload.get("summary") if isinstance(payload, dict) else None
    logger.info(
        "会话 %s 校验对象 %s（model_version=%d，revision=%d）：%s",
        ctx.session_id,
        object_id,
        record.model_version,
        record.revision,
        summary,
    )
    return ok(request, payload)


@router.get("/objects/{object_id}/checks", summary="历史校验报告（端点 #19）")
def list_checks(
    object_id: str,
    request: Request,
    ctx: SessionDep,
    db: DBDep,
    limit: int | None = Query(default=None, ge=1, description="默认 20，最大 50"),
) -> JSONResponse:
    """最近报告列表（时间倒序，同秒用 rowid 倒序保证 ``[0]`` 就是最新）。

    ``limit`` 为向后兼容的可选扩展，缺省取 20。
    """

    record = owned_object(db, ctx, object_id)
    rows = recent_check_rows(db, record.id, limit=clamp_limit(limit))
    # 报告整份存在 ``checks.report`` JSON 列中，列表一次查完即可，无逐条回查（无 N+1）。
    items = [stale_report(row.report, record.model_version, record.revision) for row in rows]
    return ok(request, {"items": items})


__all__ = ["router"]