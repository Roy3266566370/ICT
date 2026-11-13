"""示例克隆端点（``C-API@1`` #4；R2-AC6）。

- ``POST /api/v1/examples/{example_id}/clone``（auth S + CSRF）：在当前会话中克隆手工示例副本，
  副本标注 ``provenance=manual_demo``，不冒充用户材料解析结果。
- 直接读取 ``fixtures/examples/index.json`` 与对应对象文件，**不依赖解析器**，因此
  解析器缺失时该端点仍然可用（T7 约束 9）。
- ``example_id`` 不在索引内 → ``UNSUPPORTED_TEMPLATE``（422）；
  夹具缺失或对象不符合 ``C-KO@1`` → ``MODEL_UNAVAILABLE``（503）。
"""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from ..db.models import KnowledgeObjectRecord, MaterialRecord, ObjectVersionRecord
from ..schemas.api_models import CloneResult
from ..schemas.common import iso_after, parse_iso, to_iso, utc_now
from ..schemas.errors import model_unavailable, unsupported_template
from ..schemas.knowledge_object import KnowledgeObject
from ..settings import EXAMPLES_DIR, get_settings
from . import API_PREFIX, DBDep, WriteDep, ok
from .routes_templates import load_example_index

logger = logging.getLogger(__name__)

router = APIRouter(prefix=API_PREFIX, tags=["examples"])


def _find_example(index: dict[str, Any], example_id: str) -> dict[str, Any] | None:
    """按 ``example_id`` 定位索引条目。"""

    for entry in index.get("examples", []):
        if isinstance(entry, dict) and entry.get("example_id") == example_id:
            return entry
    return None


def _load_example_object(file_name: str) -> dict[str, Any]:
    """读取示例对象文件；缺失或损坏都降级为 ``MODEL_UNAVAILABLE``（保留静态阅读入口）。"""

    # 只允许读取 EXAMPLES_DIR 下的相对文件名，禁止路径穿越。
    if not file_name or "/" in file_name or "\\" in file_name or file_name.startswith("."):
        raise model_unavailable("示例对象文件名不合法", file=file_name)
    path = EXAMPLES_DIR / file_name
    if not path.is_file():
        raise model_unavailable("示例对象文件缺失，示例暂不可用", file=file_name)
    try:
        with path.open(encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, ValueError) as exc:
        logger.warning("示例对象读取失败：%s（%s）", path, type(exc).__name__)
        raise model_unavailable("示例对象文件无法读取，示例暂不可用", file=file_name) from exc
    if not isinstance(payload, dict):
        raise model_unavailable("示例对象结构不合法，示例暂不可用", file=file_name)
    return payload


@router.post("/examples/{example_id}/clone", status_code=201, summary="克隆手工示例（端点 #4）")
def clone_example(
    example_id: str, request: Request, ctx: WriteDep, db: DBDep
) -> JSONResponse:
    """把示例对象复制成当前会话的私有副本。

    副本获得**新的** ``material_id`` 与 ``object_id``，保证参数值只在同一 ``object_id``
    内共享（R5-AC5）；对象文档仍保留 ``material_id=null`` 与 ``provenance=manual_demo``，
    因为手工示例不来自任何 PPT 解析结果（R2-AC6）。
    """

    index = load_example_index()
    if index is None:
        raise model_unavailable("示例索引缺失，示例暂不可用")

    entry = _find_example(index, example_id)
    if entry is None:
        raise unsupported_template("该示例不存在或暂不支持", example_id=example_id)

    raw_object = _load_example_object(str(entry.get("file") or ""))
    try:
        source_object = KnowledgeObject.model_validate(raw_object)
    except ValidationError as exc:
        # 示例对象是契约夹具，结构不符合 C-KO@1 属于夹具不可用，不是用户输入错误。
        logger.warning("示例对象不符合 C-KO@1：%s（%s 处错误）", example_id, len(exc.errors()))
        raise model_unavailable("示例对象不符合契约，示例暂不可用", example_id=example_id) from exc

    settings = get_settings()
    now = utc_now()
    now_iso = to_iso(now)
    material_id = f"mat_{uuid4().hex}"
    object_id = f"obj_{uuid4().hex}"

    # 克隆对象：只换标识与时间戳，参数/视图/来源全部沿用（provenance 保持 manual_demo）。
    document: dict[str, Any] = source_object.model_dump(mode="json")
    document["object_id"] = object_id
    document["created_at"] = now_iso
    document["updated_at"] = now_iso

    material = MaterialRecord(
        id=material_id,
        session_id=ctx.session_id,
        title=str(entry.get("name") or source_object.title),
        status="ready",
        page_count=0,
        source_filename=None,
        clone_of_example_id=example_id,
        candidates=[],
        created_at=now_iso,
        expires_at=iso_after(settings.material_retention_hours, base=parse_iso(now_iso)),
    )
    db.add(material)
    # SQLAlchemy 的 flush 顺序只依据 relationship，不依据裸外键；父行必须先落库。
    db.flush()
    db.add(
        KnowledgeObjectRecord(
            id=object_id,
            session_id=ctx.session_id,
            material_id=material_id,
            template_id=document["template_id"],
            kernel_version=document["kernel_version"],
            model_version=int(document["model_version"]),
            revision=int(document["revision"]),
            validation_profile=str(document["validation_profile"]),
            document=document,
            created_at=now_iso,
            updated_at=now_iso,
        )
    )
    db.flush()  # object_versions.object_id 引用 knowledge_objects.id
    # 初始结构版本留档，供运行回放与版本冲突判定使用（R5-AC4、R10-AC6）。
    db.add(
        ObjectVersionRecord(
            id=f"ver_{uuid4().hex}",
            object_id=object_id,
            model_version=int(document["model_version"]),
            revision=int(document["revision"]),
            document=document,
            created_at=now_iso,
        )
    )
    db.commit()

    logger.info("会话 %s 克隆示例 %s → material=%s object=%s", ctx.session_id, example_id, material_id, object_id)
    return ok(request, CloneResult(material_id=material_id, object_id=object_id), status_code=201)


__all__ = ["router"]
