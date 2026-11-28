"""定象坊端点：作品存取、发布、画廊与 fork 再创作。

- ``POST /works`` / ``GET /works`` / ``GET|PATCH|DELETE /works/{id}``：画布文档 CRUD（乐观锁）；
- ``POST /works/{id}/publish`` → 快照分享；
- ``GET /work-shares``：公开画廊（无需会话可读）；
- ``GET /work-shares/{sid}`` / ``POST /work-shares/{sid}/fork``：播放器与"在工坊里改造"。

快照语义与活页一致：发布后改原作不影响已发链接。
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, update, or_

from ..db.models import PlazaItemRecord, WorkshopBlueprintRecord, WorkshopShareRecord, WorkshopWorkRecord
from ..schemas.common import iso_after, to_iso, utc_now
from ..schemas.errors import ApiError, ErrorCode, missing_field, model_unavailable, resource_unavailable, version_conflict
from ..settings import get_settings
from ..plaza_seeds import official_work
from .routes_auth import require_auth_session
from .routes_plaza import ListingOptions, item_for_share, list_share, lock_fork, unlist_shares, visible
from ..workshop.store import workshop_cover_meta
from . import API_PREFIX, DBDep, SessionDep, WriteDep, ok, require_session

router = APIRouter(prefix=API_PREFIX, tags=["workshop"])


class CreateWorkRequest(BaseModel):
    title: str = Field(default="", max_length=120)
    document: dict[str, Any] | None = None


class PatchWorkRequest(BaseModel):
    expected_revision: int = Field(ge=1)
    title: str | None = Field(default=None, max_length=120)
    document: dict[str, Any] | None = None


class AiRuleRequest(BaseModel):
    prompt: str = Field(min_length=4, max_length=2000)
    current_payload: dict[str, Any] | None = None
    last_error: str | None = Field(default=None, max_length=1200)
    upstream_hints: list[str] = Field(default_factory=list, max_length=8)


class AiRuleFuseRequest(BaseModel):
    user_prompt: str = Field(min_length=4, max_length=2000)
    nodes_summary: list[dict[str, Any]] = Field(min_length=2, max_length=6)
    wires_summary: list[dict[str, Any]] = Field(default_factory=list, max_length=40)
    external_ports: dict[str, Any] = Field(default_factory=dict)
    current_payload: dict[str, Any] | None = None
    last_error: str | None = Field(default=None, max_length=1200)


class CompositeSummaryRequest(BaseModel):
    nodes_summary: list[dict[str, Any]] = Field(min_length=1, max_length=32)
    wires_summary: list[dict[str, Any]] = Field(default_factory=list, max_length=60)
    ports_summary: list[dict[str, Any]] = Field(default_factory=list, max_length=32)


class AiComposeRequest(BaseModel):
    prompt: str = Field(default="", max_length=2000)
    mode: str = Field(default="compose", pattern="^(compose|wire_existing)$")
    catalog: list[dict[str, Any]] = Field(default_factory=list, max_length=120)
    existing_nodes: list[dict[str, Any]] = Field(default_factory=list, max_length=40)
    existing_wires: list[dict[str, Any]] = Field(default_factory=list, max_length=60)


class SaveBlueprintRequest(BaseModel):
    id: str | None = Field(default=None, max_length=64)
    kind: str = Field(pattern="^(composite|aiRule)$")
    title: str = Field(min_length=1, max_length=120)
    summary: str = Field(default="", max_length=300)
    blueprint: dict[str, Any]


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
    shares = select(WorkshopShareRecord.share_id).where(WorkshopShareRecord.work_id == row.id)
    unlist_shares(db, shares)
    db.query(WorkshopShareRecord).filter(WorkshopShareRecord.work_id == row.id).delete()
    db.delete(row)
    db.commit()
    from . import empty

    return empty(request)  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# 发布 / 画廊 / fork
# ---------------------------------------------------------------------------


@router.post("/works/{work_id}/publish", status_code=201, summary="发布作品到画廊")
def publish_work(work_id: str, request: Request, ctx: WriteDep, db: DBDep,
                 plaza: ListingOptions | None = None) -> JSONResponse:
    from ..workshop.store import new_share_id, snapshot

    row = _owned(db, ctx, work_id)
    auth = require_auth_session(request, db) if plaza else None
    share_id = new_share_id()
    snap = snapshot(row, share_id=share_id)
    snap["forked_from_share"] = row.forked_from_share
    share = WorkshopShareRecord(
        share_id=share_id, work_id=row.id, session_id=ctx.session_id, title=row.title,
        node_count=row.node_count, forks=0, created_at=snap["published_at"], snapshot_json=snap,
    )
    db.add(share)
    entry = list_share(db, "workshop", share, auth.user_id, plaza, title=row.title,
                       cover={"node_count": row.node_count, "origin": row.forked_from_share,
                              **workshop_cover_meta(snap["document"])}) if auth else None
    db.commit()
    return ok(
        request,
        {"share_id": share_id, "share_url": f"/work-shares/{share_id}", "published_at": snap["published_at"],
         **({"plaza_item_id": entry.id} if entry else {})},
        status_code=201,
    )


@router.get("/work-shares", summary="公开画廊：已发布作品列表")
def gallery(request: Request, db: DBDep, limit: int = 60) -> JSONResponse:
    from ..workshop.store import share_summary

    try:
        session_id = require_session(request, db).session_id
    except ApiError:
        session_id = None
    rows = list(
        db.scalars(
            select(WorkshopShareRecord)
            .where(WorkshopShareRecord.revoked_at.is_(None), or_(
                WorkshopShareRecord.session_id == session_id,
                WorkshopShareRecord.share_id.in_(select(PlazaItemRecord.share_id).where(visible())),
            ))
            .order_by(WorkshopShareRecord.created_at.desc())
            .limit(max(1, min(200, limit)))
        ).all()
    )
    response = ok(request, {
        "items": [{**share_summary(row), "can_delete": row.session_id == session_id} for row in rows],
    })
    response.headers["Cache-Control"] = "private, no-store"
    return response


@router.get("/work-shares/{share_id}", summary="读取发布作品快照（无需会话）")
def get_share(share_id: str, request: Request, db: DBDep) -> JSONResponse:
    doc = official_work(share_id)
    if doc:
        return ok(request, {"share_id": share_id, "title": doc["title"], "document": doc})
    row = _public_share(db, share_id)
    listing = item_for_share(db, share_id)
    return ok(request, {**row.snapshot_json, "allow_fork": listing is None or listing.allow_fork})


@router.post("/work-shares/{share_id}/fork", status_code=201, summary="fork 发布作品为自己的作品")
def fork_share(share_id: str, request: Request, ctx: WriteDep, db: DBDep) -> JSONResponse:
    from ..workshop.store import new_work_id

    seed = official_work(share_id)
    share = None if seed else _public_share(db, share_id)
    doc = dict(seed or share.snapshot_json.get("document") or {})
    if not doc:
        raise resource_unavailable(reason="作品快照为空")
    lock_fork(db, share_id)
    doc["title"] = f"{doc.get('title') or (share.title if share else '')} · 改造"[:120]
    now = to_iso(utc_now())
    expires = iso_after(get_settings().material_retention_hours, base=utc_now())
    row = WorkshopWorkRecord(
        id=new_work_id(),
        session_id=ctx.session_id,
        title=doc["title"],
        node_count=len(doc.get("nodes") or []),
        revision=1,
        document=doc,
        forked_from_share=share_id,
        created_at=now,
        updated_at=now,
        expires_at=expires,
    )
    if share:
        updated = db.execute(update(WorkshopShareRecord).where(
            WorkshopShareRecord.share_id == share_id, WorkshopShareRecord.revoked_at.is_(None),
        ).values(forks=WorkshopShareRecord.forks + 1))
        if not updated.rowcount:
            raise resource_unavailable()
    db.add(row)
    db.commit()
    return ok(request, {"work_id": row.id, "revision": 1, "forked_from_share": share_id}, status_code=201)


@router.delete("/work-shares/{share_id}", status_code=204, summary="撤销发布")
def revoke_share(share_id: str, request: Request, ctx: WriteDep, db: DBDep) -> JSONResponse:
    row = _public_share(db, share_id)
    if row.session_id != ctx.session_id:
        raise resource_unavailable()
    unlist_shares(db, [share_id])
    row.revoked_at = to_iso(utc_now())
    db.commit()
    from . import empty

    return empty(request)  # type: ignore[return-value]


@router.post("/workshop/ai-rule-block", summary="自然语言生成 AI 智能计算方块")
def ai_rule_block(payload: AiRuleRequest, request: Request, _ctx: WriteDep) -> JSONResponse:
    from ..workshop.ai_rule import AiRuleUnavailable, generate_ai_rule

    if payload.current_payload is not None:
        try:
            size = len(json.dumps(payload.current_payload, ensure_ascii=False, allow_nan=False))
        except (TypeError, ValueError) as exc:
            raise missing_field("当前规则载荷包含不可序列化数值") from exc
        if size > 60000:
            raise missing_field("当前规则载荷过大，请先精简代码或参数")
    try:
        result = generate_ai_rule(
            payload.prompt,
            current_payload=payload.current_payload,
            last_error=payload.last_error,
            upstream_hints=payload.upstream_hints,
        )
    except AiRuleUnavailable as exc:
        raise model_unavailable(str(exc)) from exc
    return ok(request, result)


@router.post("/workshop/ai-rule-fuse", summary="多选积木 AI 语义融合为单块智能积木")
def ai_rule_fuse(payload: AiRuleFuseRequest, request: Request, _ctx: WriteDep) -> JSONResponse:
    from ..workshop.ai_rule import AiRuleUnavailable, fuse_ai_rule

    try:
        size = len(json.dumps(payload.model_dump(), ensure_ascii=False, allow_nan=False))
    except (TypeError, ValueError) as exc:
        raise missing_field("融合上下文包含不可序列化数值") from exc
    if size > 120_000:
        raise missing_field("选中积木上下文过大，请减少选中数量后重试")
    try:
        result = fuse_ai_rule(
            payload.nodes_summary,
            payload.wires_summary,
            payload.external_ports,
            payload.user_prompt,
            current_payload=payload.current_payload,
            last_error=payload.last_error,
        )
    except AiRuleUnavailable as exc:
        raise model_unavailable(str(exc)) from exc
    return ok(request, result)


@router.post("/workshop/summarize-composite", summary="复合积木 AI 自动命名与一句话摘要")
def summarize_composite_endpoint(payload: CompositeSummaryRequest, request: Request, _ctx: WriteDep) -> JSONResponse:
    from ..workshop.ai_rule import AiRuleUnavailable, summarize_composite

    try:
        result = summarize_composite(
            payload.nodes_summary,
            payload.wires_summary,
            payload.ports_summary,
        )
    except AiRuleUnavailable as exc:
        raise model_unavailable(str(exc)) from exc
    return ok(request, result)


@router.post("/workshop/ai-compose", summary="AI 自动搭积木实验与画布智能连线")
def ai_compose_endpoint(payload: AiComposeRequest, request: Request, _ctx: WriteDep) -> JSONResponse:
    from ..workshop.ai_rule import AiRuleUnavailable, compose_workshop_canvas

    if payload.mode == "compose" and len(payload.prompt.strip()) < 2:
        raise missing_field("请简要描述你想搭建的实验内容")
    if payload.mode == "wire_existing" and len(payload.existing_nodes) < 2:
        raise missing_field("当前画布至少需要 2 个积木才能自动连线")
    try:
        size = len(json.dumps(payload.model_dump(), ensure_ascii=False, allow_nan=False))
    except (TypeError, ValueError) as exc:
        raise missing_field("编排请求包含不可序列化数值") from exc
    if size > 120_000:
        raise missing_field("画布编排上下文过大，请减少节点后重试")
    try:
        result = compose_workshop_canvas(
            payload.prompt.strip() or "将当前画布上的积木按端口类型合理连接成可运行的完整实验",
            mode=payload.mode,
            catalog=payload.catalog,
            existing_nodes=payload.existing_nodes,
            existing_wires=payload.existing_wires,
        )
    except AiRuleUnavailable as exc:
        raise model_unavailable(str(exc)) from exc
    return ok(request, result)


# ---------------------------------------------------------------------------
# 个人蓝图库（突破 localStorage 24 个上限，支持 composite 与 aiRule 持久化）
# ---------------------------------------------------------------------------

MAX_BLUEPRINT_BYTES = 512_000


def _validate_blueprint(kind: str, raw: dict[str, Any]) -> dict[str, Any]:
    from ..workshop.ai_rule import normalize_rule_payload
    from ..workshop.model import validate_canvas_doc

    try:
        serialized = json.dumps(raw, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ValueError("蓝图数据包含不可序列化数值") from exc
    if len(serialized) > MAX_BLUEPRINT_BYTES:
        raise ValueError("蓝图体积超过 512KB 上限，请精简内部对象后保存")

    if kind == "composite":
        sub = raw.get("sub")
        if not isinstance(sub, dict):
            raise ValueError("composite 蓝图缺少 sub 字段")
        # 复用 validate_canvas_doc 对单个 composite 节点做完整结构校验
        validated = validate_canvas_doc({
            "version": 1,
            "title": "blueprint",
            "nodes": [{"id": "bp_root", "type": "composite", "x": 0, "y": 0, "params": {}, "sub": sub}],
            "wires": [],
            "strokes": [],
            "zoom": 1,
        })
        clean_sub = validated["nodes"][0].get("sub")
        if not isinstance(clean_sub, dict):
            raise ValueError("composite 蓝图 sub 结构无效")
        return {"sub": clean_sub}

    # aiRule 类型
    raw_payload = raw.get("payload")
    if isinstance(raw_payload, str):
        try:
            parsed_payload = json.loads(raw_payload)
        except json.JSONDecodeError as exc:
            raise ValueError("aiRule 蓝图 payload 不是合法 JSON") from exc
    elif isinstance(raw_payload, dict):
        parsed_payload = raw_payload
    else:
        raise ValueError("aiRule 蓝图缺少 payload")
    clean_payload = normalize_rule_payload(parsed_payload)
    raw_params = raw.get("params")
    params: dict[str, float] = {}
    if isinstance(raw_params, dict):
        for k, v in raw_params.items():
            if isinstance(k, str) and not isinstance(v, bool) and isinstance(v, (int, float)):
                params[k[:48]] = float(v)
    result: dict[str, Any] = {
        "payload": json.dumps(clean_payload, ensure_ascii=False),
        "params": params,
    }
    if isinstance(raw.get("text"), str):
        result["text"] = raw["text"][:4000]
    return result


def _blueprint_dto(row: WorkshopBlueprintRecord) -> dict[str, Any]:
    return {
        "id": row.id,
        "kind": row.kind,
        "title": row.title,
        "summary": row.summary,
        "blueprint": row.blueprint_json,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


@router.get("/workshop/blueprints", summary="获取我的个人蓝图库")
def list_blueprints(request: Request, ctx: SessionDep, db: DBDep, limit: int = 200) -> JSONResponse:
    rows = list(
        db.scalars(
            select(WorkshopBlueprintRecord)
            .where(WorkshopBlueprintRecord.session_id == ctx.session_id)
            .order_by(WorkshopBlueprintRecord.updated_at.desc())
            .limit(max(1, min(500, limit)))
        ).all()
    )
    return ok(request, {"items": [_blueprint_dto(r) for r in rows]})


@router.post("/workshop/blueprints", status_code=201, summary="保存个人蓝图到云端库")
def save_blueprint(payload: SaveBlueprintRequest, request: Request, ctx: WriteDep, db: DBDep) -> JSONResponse:
    from ..workshop.store import new_blueprint_id

    try:
        clean_bp = _validate_blueprint(payload.kind, payload.blueprint)
    except ValueError as exc:
        raise missing_field(str(exc)) from exc
    now = to_iso(utc_now())
    title = payload.title.strip()[:120] or "未命名蓝图"
    summary = payload.summary.strip()[:300]
    if payload.id:
        existing = db.get(WorkshopBlueprintRecord, payload.id)
        if existing is not None and existing.session_id == ctx.session_id:
            existing.kind = payload.kind
            existing.title = title
            existing.summary = summary
            existing.blueprint_json = clean_bp
            existing.updated_at = now
            db.commit()
            return ok(request, _blueprint_dto(existing), status_code=200)
    row = WorkshopBlueprintRecord(
        id=new_blueprint_id(),
        session_id=ctx.session_id,
        kind=payload.kind,
        title=title,
        summary=summary,
        blueprint_json=clean_bp,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    return ok(request, _blueprint_dto(row), status_code=201)


@router.delete("/workshop/blueprints/{blueprint_id}", status_code=204, summary="删除个人蓝图")
def delete_blueprint(blueprint_id: str, request: Request, ctx: WriteDep, db: DBDep) -> JSONResponse:
    row = db.get(WorkshopBlueprintRecord, blueprint_id)
    if row is None or row.session_id != ctx.session_id:
        raise resource_unavailable()
    db.delete(row)
    db.commit()
    from . import empty

    return empty(request)  # type: ignore[return-value]


__all__ = ["router"]
