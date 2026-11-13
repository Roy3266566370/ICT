"""万象工坊端点：作品存取、发布、画廊与 fork 再创作。

- ``POST /works`` / ``GET /works`` / ``GET|PATCH|DELETE /works/{id}``：画布文档 CRUD（乐观锁）；
- ``POST /works/{id}/publish`` → 快照分享；
- ``GET /work-shares``：公开画廊（无需会话可读）；
- ``GET /work-shares/{sid}`` / ``POST /work-shares/{sid}/fork``：播放器与"在工坊里改造"。

快照语义与活页一致：发布后改原作不影响已发链接。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..db.models import WorkshopShareRecord, WorkshopWorkRecord
from ..schemas.common import iso_after, to_iso, utc_now
from ..schemas.errors import missing_field, resource_unavailable, version_conflict
from ..settings import get_settings
from . import API_PREFIX, DBDep, SessionDep, WriteDep, ok

router = APIRouter(prefix=API_PREFIX, tags=["workshop"])


class CreateWorkRequest(BaseModel):
    title: str = Field(default="", max_length=120)
    document: dict[str, Any] | None = None


class PatchWorkRequest(BaseModel):
    expected_revision: int = Field(ge=1)
    title: str | None = Field(default=None, max_length=120)
    document: dict[str, Any] | None = None


def _owned(db: Any, ctx: Any, work_id: str) -> WorkshopWorkRecord:
    row = db.get(WorkshopWorkRecord, work_id)
    if row is None or row.session_id != ctx.session_id:
        raise resource_unavailable()
    return row


def _public_share(db: Any, share_id: str) -> WorkshopShareRecord:
    row = db.get(WorkshopShareRecord, share_id)
    if row is None or row.revoked_at is not None:
        raise resource_unavailable()
    return row


# ---------------------------------------------------------------------------
# 作品 CRUD
# ---------------------------------------------------------------------------


@router.post("/works", status_code=201, summary="保存新作品")
def create_work(payload: CreateWorkRequest, request: Request, ctx: WriteDep, db: DBDep) -> JSONResponse:
    from ..workshop.model import validate_canvas_doc
    from ..workshop.store import new_work_id

    try:
        doc = validate_canvas_doc(payload.document or {})
    except ValueError as exc:
        raise missing_field(str(exc)) from exc
    if payload.title:
        doc["title"] = payload.title.strip()[:120]
    now = to_iso(utc_now())
    expires = iso_after(get_settings().material_retention_hours, base=utc_now())
    row = WorkshopWorkRecord(
        id=new_work_id(),
        session_id=ctx.session_id,
        title=doc["title"] or "未命名作品",
        node_count=len(doc["nodes"]),
        revision=1,
        document=doc,
        created_at=now,
        updated_at=now,
        expires_at=expires,
    )
    db.add(row)
    db.commit()
    return ok(request, {"work_id": row.id, "revision": row.revision, "document": doc}, status_code=201)


@router.get("/works", summary="我的作品列表")
def list_works(request: Request, ctx: SessionDep, db: DBDep) -> JSONResponse:
    from ..workshop.store import summary

    rows = list(
        db.scalars(
            select(WorkshopWorkRecord)
            .where(WorkshopWorkRecord.session_id == ctx.session_id)
            .order_by(WorkshopWorkRecord.updated_at.desc())
        ).all()
    )
    return ok(request, {"works": [summary(r) for r in rows]})


@router.get("/works/{work_id}", summary="读取作品文档")
def get_work(work_id: str, request: Request, ctx: SessionDep, db: DBDep) -> JSONResponse:
    row = _owned(db, ctx, work_id)
    return ok(request, {"work_id": row.id, "revision": row.revision, "document": row.document,
                        "forked_from_share": row.forked_from_share})


@router.patch("/works/{work_id}", summary="保存作品（乐观锁）")
def patch_work(
    work_id: str, payload: PatchWorkRequest, request: Request, ctx: WriteDep, db: DBDep
) -> JSONResponse:
    from ..workshop.model import validate_canvas_doc

    row = _owned(db, ctx, work_id)
    if int(payload.expected_revision) != int(row.revision):
        raise version_conflict(f"作品已被修改（当前 revision={row.revision}），请刷新后再保存")
    doc = row.document
    if payload.document is not None:
        try:
            doc = validate_canvas_doc(payload.document)
        except ValueError as exc:
            raise missing_field(str(exc)) from exc
    if payload.title is not None:
        doc["title"] = payload.title.strip()[:120] or doc.get("title")
    row.document = doc
    row.title = str(doc.get("title") or row.title)
    row.node_count = len(doc.get("nodes") or [])
    row.revision = int(row.revision) + 1
    row.updated_at = to_iso(utc_now())
    db.commit()
    return ok(request, {"work_id": row.id, "revision": row.revision, "document": row.document})


@router.delete("/works/{work_id}", status_code=204, summary="删除作品")
def delete_work(work_id: str, request: Request, ctx: WriteDep, db: DBDep) -> JSONResponse:
    row = _owned(db, ctx, work_id)
    db.query(WorkshopShareRecord).filter(WorkshopShareRecord.work_id == row.id).delete()
    db.delete(row)
    db.commit()
    from . import empty

    return empty(request)  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# 发布 / 画廊 / fork
# ---------------------------------------------------------------------------


@router.post("/works/{work_id}/publish", status_code=201, summary="发布作品到画廊")
def publish_work(work_id: str, request: Request, ctx: WriteDep, db: DBDep) -> JSONResponse:
    from ..workshop.store import new_share_id, snapshot

    row = _owned(db, ctx, work_id)
    share_id = new_share_id()
    snap = snapshot(row, share_id=share_id)
    db.add(
        WorkshopShareRecord(
            share_id=share_id,
            work_id=row.id,
            session_id=ctx.session_id,
            title=row.title,
            node_count=row.node_count,
            forks=0,
            created_at=to_iso(utc_now()),
            snapshot_json=snap,
        )
    )
    db.commit()
    return ok(
        request,
        {"share_id": share_id, "share_url": f"/work-shares/{share_id}", "published_at": snap["published_at"]},
        status_code=201,
    )


@router.get("/work-shares", summary="公开画廊：已发布作品列表")
def gallery(request: Request, db: DBDep, limit: int = 60) -> JSONResponse:
    from ..workshop.store import share_summary

    rows = list(
        db.scalars(
            select(WorkshopShareRecord)
            .where(WorkshopShareRecord.revoked_at.is_(None))
            .order_by(WorkshopShareRecord.created_at.desc())
            .limit(max(1, min(200, limit)))
        ).all()
    )
    return ok(request, {"items": [share_summary(r) for r in rows]})


@router.get("/work-shares/{share_id}", summary="读取发布作品快照（无需会话）")
def get_share(share_id: str, request: Request, db: DBDep) -> JSONResponse:
    row = _public_share(db, share_id)
    return ok(request, row.snapshot_json)


@router.post("/work-shares/{share_id}/fork", status_code=201, summary="fork 发布作品为自己的作品")
def fork_share(share_id: str, request: Request, ctx: WriteDep, db: DBDep) -> JSONResponse:
    from ..workshop.store import new_work_id

    share = _public_share(db, share_id)
    doc = dict((share.snapshot_json or {}).get("document") or {})
    if not doc:
        raise resource_unavailable("作品快照为空")
    doc["title"] = f"{share.title} · 改造"[:120]
    now = to_iso(utc_now())
    expires = iso_after(get_settings().material_retention_hours, base=utc_now())
    row = WorkshopWorkRecord(
        id=new_work_id(),
        session_id=ctx.session_id,
        title=doc["title"],
        node_count=len(doc.get("nodes") or []),
        revision=1,
        document=doc,
        forked_from_share=share.share_id,
        created_at=now,
        updated_at=now,
        expires_at=expires,
    )
    share.forks = int(share.forks or 0) + 1
    db.add(row)
    db.commit()
    return ok(request, {"work_id": row.id, "revision": 1, "forked_from_share": share.share_id}, status_code=201)


@router.delete("/work-shares/{share_id}", status_code=204, summary="撤销发布")
def revoke_share(share_id: str, request: Request, ctx: WriteDep, db: DBDep) -> JSONResponse:
    row = _public_share(db, share_id)
    if row.session_id != ctx.session_id:
        raise resource_unavailable()
    row.revoked_at = to_iso(utc_now())
    db.commit()
    from . import empty

    return empty(request)  # type: ignore[return-value]


__all__ = ["router"]
