"""iSpec 参数值的持久化端点（整改文件 §10.1 第 5 步）。

端点：
    - ``GET /api/v1/materials/{material_id}/ispecs/{object_id}/values``
      读取该材料下某个 iSpec（或共享池）已保存的参数值。
    - ``PUT /api/v1/materials/{material_id}/ispecs/{object_id}/values``
      整体覆盖保存；带 ``expected_updated_at`` 时做乐观锁。

为什么追加而不是改既有端点：
    ``GET /materials/{id}/ispecs`` 返回的是**识别产物**（参数定义 + 默认值），
    用户改过的值属于另一层事实（"人改过什么"），两者混在一起会让"重新识别"
    变成一次静默的数据覆盖。这里用独立文件 ``data/ispec-values/<id>.json`` 承载，
    与 ``data/regions/`` 的覆盖文件同构。

错误约定（与 ``routes_regions`` 一致）：
    - 跨会话访问他人材料 → 404 ``SESSION_EXPIRED``（复用 ``owned_material``）；
    - ``object_id`` 不在该材料的 iSpec / 知识对象里 → 404 ``MISSING_FIELD``；
    - 值非法（非标量、超 500 条）→ 422 ``MISSING_FIELD``；
    - ``expected_updated_at`` 不匹配 → 409 ``VERSION_CONFLICT``，details 带
      ``current_values`` / ``current_updated_at`` 供前端合并。

共享池（§9-4）：
    ``object_id = "__shared__"`` 是保留桶，不做 ispec 归属校验——它承载
    "同一变量在多页出现"的池值，本身不对应任何 iSpec。
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any, Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import KnowledgeObjectRecord, MaterialRecord
from ..ispec.persistence import (
    SHARED_OBJECT_ID,
    InvalidISpecValues,
    VersionConflict,
    load_values,
    save_values,
)
from ..schemas.errors import ApiError, ErrorCode, missing_field, version_conflict
from . import API_PREFIX, DBDep, SessionDep, WriteDep, ok, owned_material
from .routes_jobs import read_ispec_payload

logger = logging.getLogger(__name__)

router = APIRouter(prefix=API_PREFIX, tags=["ispec-values"])

#: PUT 请求体。``extra="forbid"``：拼错字段立即 422，不制造"以为保存了"的假象。
PUT_BODY_EXTRA_FORBIDDEN = ConfigDict(extra="forbid")


class ISpecValuesPutRequest(BaseModel):
    """``PUT .../values`` 的请求体。"""

    model_config = PUT_BODY_EXTRA_FORBIDDEN

    values: dict[str, Any] = Field(
        description="参数 id → 标量值；传 {} 表示清除该 object 已保存的值",
    )
    expected_updated_at: Optional[str] = Field(
        default=None,
        description=(
            "上一次 GET/PUT 拿到的 updated_at；与服务器不一致时返回 409。"
            "不传表示不做乐观锁校验（首次保存或已合并过并发结果）。"
        ),
    )


# ---------------------------------------------------------------------------
# 归属与对象校验
# ---------------------------------------------------------------------------


def known_object_ids(db: Session, material: MaterialRecord) -> set[str]:
    """该材料内合法的 ``object_id`` 集合。

    同时收集两个来源，覆盖两条真实链路：

    1. 识别产物 ``data/ispecs/<material_id>.json`` 里的 ``object_id``（PPT 上传材料）；
    2. ``knowledge_objects`` 表里的对象 id（手工示例克隆 / 已保存模型）。

    两者都查而不是只查其一：识别尚未完成时 (1) 为空，但 (2) 已有对象；
    反之重新识别后旧对象可能已删除，(1) 仍是用户当下看到的 iSpec。
    """

    ids: set[str] = set()
    payload = read_ispec_payload(material.id)
    raw_items = payload.get("ispecs") if payload is not None else None
    if isinstance(raw_items, list):
        for item in raw_items:
            if isinstance(item, Mapping):
                object_id = item.get("object_id")
                if isinstance(object_id, str) and object_id:
                    ids.add(object_id)
    # Free-edited pages add two dynamic families: user-configured node specs and
    # specs re-derived from the current scene. They must accept parameter saves
    # just like upload-time specs.
    from ..documents.presentation import apply_document_specs
    try:
        for spec in apply_document_specs(material.id, raw_items if isinstance(raw_items, list) else []):
            object_id = spec.get('object_id')
            if isinstance(object_id, str) and object_id:
                ids.add(object_id)
    except (ValueError, OSError):
        logger.warning('材料 %s 的动态交互对象读取失败，参数保存暂只覆盖上传产物', material.id)
    ids.update(
        db.scalars(
            select(KnowledgeObjectRecord.id).where(
                KnowledgeObjectRecord.material_id == material.id
            )
        ).all()
    )
    return ids


def _assert_object_exists(
    db: Session, material: MaterialRecord, object_id: str
) -> None:
    """共享池桶总是允许；其余 ``object_id`` 必须属于该材料。"""

    if object_id == SHARED_OBJECT_ID:
        return
    if object_id in known_object_ids(db, material):
        return
    raise ApiError(
        ErrorCode.MISSING_FIELD,
        "该 iSpec 不存在或已被重新识别，请刷新页面后重试",
        status_code=404,
        details={"object_id": object_id},
    )


def _record_payload(object_id: str, entry: Mapping[str, Any] | None) -> dict[str, Any]:
    return {
        "object_id": object_id,
        "values": dict(entry["values"]) if entry is not None else {},
        "updated_at": entry.get("updated_at") if entry is not None else None,
    }


# ---------------------------------------------------------------------------
# 端点
# ---------------------------------------------------------------------------


@router.get(
    "/materials/{material_id}/ispecs/{object_id}/values",
    summary="读取已保存的 iSpec 参数值",
)
def get_ispec_values(
    material_id: str,
    object_id: str,
    request: Request,
    ctx: SessionDep,
    db: DBDep,
) -> JSONResponse:
    """返回 ``{object_id, values, updated_at}``；从未保存过时 ``values`` 为 ``{}``。

    返回空对象而不是 404：前端初始化需要区分"服务器没有值"（回退本地草稿）
    与"对象不存在"（说明页面数据过期）。后者才是 404。
    """

    material = owned_material(db, ctx, material_id)
    _assert_object_exists(db, material, object_id)
    entry = load_values(material.id).get(object_id)
    return ok(request, _record_payload(object_id, entry))


@router.put(
    "/materials/{material_id}/ispecs/{object_id}/values",
    summary="保存 iSpec 参数值（整体覆盖 + 乐观锁）",
)
def put_ispec_values(
    material_id: str,
    object_id: str,
    payload: ISpecValuesPutRequest,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
) -> JSONResponse:
    """保存成功返回新的 ``updated_at``；冲突返回 409 与当前值。"""

    material = owned_material(db, ctx, material_id)
    _assert_object_exists(db, material, object_id)

    try:
        result = save_values(
            material.id,
            object_id,
            payload.values,
            payload.expected_updated_at,
        )
    except VersionConflict as exc:
        raise version_conflict(
            "参数已在别处更新，请合并后重试",
            object_id=object_id,
            current_values=exc.current_values,
            current_updated_at=exc.current_updated_at,
        ) from exc
    except InvalidISpecValues as exc:
        raise missing_field(str(exc), object_id=object_id) from exc

    logger.info(
        "会话 %s 保存材料 %s 的对象 %s 参数：%d 条",
        ctx.session_id,
        material.id,
        object_id,
        len(result["values"]),
    )
    return ok(request, result)


__all__ = [
    "ISpecValuesPutRequest",
    "get_ispec_values",
    "known_object_ids",
    "put_ispec_values",
    "router",
]