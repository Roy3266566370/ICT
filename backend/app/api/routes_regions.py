"""区域确认 / 纠正的持久化端点（``C-API@1`` P2 追加，见 `contracts/README.md` §3.8.2）。

背景（rebuild-spec §2 第 5 条）：
    "转换结果可确认与纠正"——用户在准备页改的参数值、确认/仅阅读状态，必须
    在工作台读到；此前只写浏览器 ``sessionStorage``，换页/换标签即可丢失。

设计约束：
    1. **不改 9 张共享表**：覆盖写入 ``backend/data/regions/<material_id>.json``，
       形状为 ``{region_id: {status, parameter_overrides, note, updated_at, fact_signature}}``。
    2. **基线只读**：``fixtures/materials/**/regions.json`` 与渲染产物
       ``data/renders/<material_id>/regions.json`` 只读，覆盖在读取时合并。
    3. **识别变化即失效**：每条覆盖保存 ``fact_signature``（页数 + bbox + script_id
       的 sha1 前 12 位）。重新解析后签名变化，旧确认不会被回放。
    4. 写入先落 ``.tmp`` 再 ``os.replace``，避免半截 JSON。

端点：
    - ``GET  /materials/{material_id}/regions``
    - ``PATCH /materials/{material_id}/regions/{region_id}``
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from ..schemas.common import to_iso, utc_now
from ..schemas.errors import ApiError, ErrorCode, missing_field
from ..settings import DATA_DIR, MATERIALS_DIR, RENDERS_DIR
from . import API_PREFIX, DBDep, SessionDep, WriteDep, ok, owned_material

logger = logging.getLogger(__name__)

router = APIRouter(prefix=API_PREFIX, tags=["regions"])

#: 覆盖文件的落盘目录（与 9 张共享表彻底分离）。
REGIONS_DIR = DATA_DIR / "regions"
#: 覆盖文件的 schema 版本（写在文件名之外不额外包一层，保持任务约定的扁平形状）。
OVERRIDE_SCHEMA_VERSION = "1"
#: PATCH 允许写入的两种"人工结论"（``pending`` 表示尚未确认，不落盘）。
ALLOWED_STATUSES: tuple[str, ...] = ("confirmed", "static_only")
#: 材料 id 只允许安全字符，避免拼路径越界（id 由服务端生成，此处是纵深防御）。
MATERIAL_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,96}$")
#: 同目录多条并发写的串行锁（uvicorn 默认单进程多线程）。
_WRITE_LOCK = threading.Lock()
#: 课程材料 id（前端 ``regionData.ts`` 的兜底候选与之保持一致）。
COURSEWARE_MATERIAL_ID = "matrix-courseware"
#: 只有课程件本体及其别名才允许回退到公共示例区域。
#:
#: 真实上传材料的 id 形如 ``mat_<32 位 hex>``，不在白名单内——识别为空时必须
#: 返回空区域，**绝不继承 matrix-courseware 的区域**（P0-01）。
COURSEWARE_MATERIAL_IDS = frozenset({COURSEWARE_MATERIAL_ID, "mat_matrix_courseware"})


# ---------------------------------------------------------------------------
# 请求模型
# ---------------------------------------------------------------------------


class RegionPatchRequest(BaseModel):
    """``PATCH /materials/{id}/regions/{region_id}`` 的请求体。

    ``extra="forbid"``：拼错字段名立即 422，避免"看起来保存成功其实没生效"。
    兼容任务描述里的 camelCase 写法：``parameterOverrides`` 与
    ``parameter_overrides`` 等价（响应一律 snake_case）。
    """

    model_config = ConfigDict(extra="forbid")

    status: Optional[str] = Field(
        default=None,
        description="confirmed | static_only；不传表示不修改已有结论",
    )
    parameter_overrides: Optional[dict[str, Any]] = Field(
        default=None,
        validation_alias=AliasChoices("parameter_overrides", "parameterOverrides"),
        description="被用户修改的参数键（只存改过的键）；传 {} 表示清空",
    )
    note: Optional[str] = Field(default=None, max_length=500, description="纠正备注")


# ---------------------------------------------------------------------------
# JSON 读写（原子写、容错读）
# ---------------------------------------------------------------------------


def _is_record(value: Any) -> bool:
    return isinstance(value, Mapping)


def _read_json(path: Path) -> Any | None:
    """读取 JSON；文件缺失/损坏一律返回 ``None``（不阻断阅读与确认）。"""

    if not path.is_file():
        return None
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError) as exc:
        logger.warning("区域文件 %s 读取失败，按无数据处理：%s", path.name, exc)
        return None


def _override_path(material_id: str) -> Path:
    """材料对应覆盖文件路径；非法 id 直接按"资源不可用"处理（不暴露路径）。"""

    if MATERIAL_ID_PATTERN.match(material_id) is None:
        raise ApiError(
            ErrorCode.SESSION_EXPIRED,
            "资源不可用",
            status_code=404,
        )
    return REGIONS_DIR / f"{material_id}.json"


def _clean_entry(raw: Mapping[str, Any]) -> dict[str, Any] | None:
    """校验并规范化一条覆盖记录；非法记录整条丢弃（宁可回放基线，也不回放坏数据）。"""

    status = raw.get("status")
    params = raw.get("parameter_overrides")
    signature = raw.get("fact_signature")
    updated_at = raw.get("updated_at")
    note = raw.get("note")
    if status is not None and status not in ALLOWED_STATUSES:
        return None
    if params is not None and not _is_record(params):
        return None
    if signature is not None and not isinstance(signature, str):
        return None
    entry: dict[str, Any] = {
        "status": status,
        "parameter_overrides": dict(params) if _is_record(params) else {},
        "note": note if isinstance(note, str) else None,
        "updated_at": updated_at if isinstance(updated_at, str) else None,
        "fact_signature": signature,
    }
    return entry


def read_overrides(material_id: str) -> dict[str, dict[str, Any]]:
    """读取该材料的全部覆盖（``region_id -> entry``）；任何异常都退化为空。"""

    path = _override_path(material_id)
    raw = _read_json(path)
    if not _is_record(raw):
        return {}
    result: dict[str, dict[str, Any]] = {}
    for region_id, item in raw.items():
        if isinstance(region_id, str) and _is_record(item):
            cleaned = _clean_entry(item)
            if cleaned is not None:
                result[region_id] = cleaned
    return result


def write_overrides(material_id: str, overrides: Mapping[str, Mapping[str, Any]]) -> Path:
    """原子写覆盖文件：先写同目录 ``.tmp``，再 ``os.replace`` 覆盖目标。

    ``os.replace`` 在同一文件系统内是原子操作，进程崩溃也不会留下半截 JSON。
    """

    target = _override_path(material_id)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {}
    for region_id, entry in overrides.items():
        payload[region_id] = {
            "status": entry.get("status"),
            "parameter_overrides": dict(entry.get("parameter_overrides") or {}),
            "note": entry.get("note"),
            "updated_at": entry.get("updated_at"),
            "fact_signature": entry.get("fact_signature"),
        }
    tmp = target.with_name(f"{target.name}.{uuid4().hex}.tmp")
    with _WRITE_LOCK:
        try:
            with tmp.open("w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, target)
        finally:
            tmp.unlink(missing_ok=True)
    return target


# ---------------------------------------------------------------------------
# 基线区域与识别指纹
# ---------------------------------------------------------------------------


def _baseline_candidates(material_id: str) -> list[tuple[Path, str]]:
    """基线 ``regions.json`` 的探测顺序。

    1. 渲染产物 ``data/renders/<material_id>/regions.json``（真实上传材料的正式产物）；
    2. 解析产物 ``fixtures/materials/<material_id>/regions.json``（课程材料基线）；
    3. **仅课程件本体**：``fixtures/materials/matrix-courseware/regions.json``。

    第 3 条从"任意材料兜底"收窄为"课程件自身"：真实上传材料若没有自己的区域，
    返回空列表，绝不把公共示例区域当成它的识别结果（P0-01）。
    """

    candidates = [
        (RENDERS_DIR / material_id / "regions.json", "renders"),
        (MATERIALS_DIR / material_id / "regions.json", "fixtures"),
    ]
    if material_id in COURSEWARE_MATERIAL_IDS:
        candidates.append(
            (MATERIALS_DIR / COURSEWARE_MATERIAL_ID / "regions.json", "fixtures:matrix-courseware")
        )
    return candidates


def _extract_regions(raw: Any) -> list[dict[str, Any]]:
    """``regions.json`` 允许 ``[...]`` 或 ``{"regions": [...]}`` 两种形状。"""

    if isinstance(raw, list):
        items: list[Any] = raw
    elif _is_record(raw) and isinstance(raw.get("regions"), list):
        items = raw["regions"]
    else:
        return []
    return [dict(item) for item in items if _is_record(item) and isinstance(item.get("region_id"), str)]


def load_baseline(material_id: str, db_page_count: int) -> tuple[list[dict[str, Any]], str, int]:
    """返回 ``(基线区域, 来源标识, 页数)``；全部缺失时为 ``([], "none", db_page_count)``。"""

    for path, source in _baseline_candidates(material_id):
        regions = _extract_regions(_read_json(path))
        if not regions:
            continue
        page_count = _slide_page_count(path.parent, db_page_count)
        return regions, source, page_count
    return [], "none", max(1, db_page_count)


def _slide_page_count(directory: Path, fallback: int) -> int:
    """从同目录 ``slides.json`` 读页数（渲染产物回退到 ``render.json`` / DB 页数）。

    任务要求指纹里的页数来自 ``slides.json``：页数变化意味着重新解析，
    区域坐标的语义可能整体改变，必须让旧确认失效。
    """

    slides = _read_json(directory / "slides.json")
    if _is_record(slides):
        for key in ("pages", "slides"):
            value = slides.get(key)
            if isinstance(value, list) and value:
                return len(value)
        raw_count = slides.get("page_count")
        if isinstance(raw_count, int) and raw_count > 0:
            return raw_count
    manifest = _read_json(directory / "render.json")
    if _is_record(manifest):
        raw_count = manifest.get("page_count")
        if isinstance(raw_count, int) and raw_count > 0:
            return raw_count
    return max(1, fallback)


def fact_signature(page_count: int, region: Mapping[str, Any]) -> str:
    """识别事实指纹：``sha1(page_count | bbox.x,y,w,h | script_id)[:12]``。

    只包含"区域几何 + 页数 + 渲染组件"三件识别事实，**不含**用户参数：
    用户改参数不会让确认失效；重新解析改变 bbox / script_id / 页数时才会。
    """

    bbox = region.get("bbox")
    bbox_values: list[str] = []
    if _is_record(bbox):
        for key in ("x", "y", "w", "h"):
            bbox_values.append(str(bbox.get(key)))
    else:
        bbox_values = ["", "", "", ""]
    raw = "|".join([str(page_count), *bbox_values, str(region.get("script_id") or "")])
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def material_regions_for_publish(
    material_id: str, db_page_count: int
) -> tuple[list[dict[str, Any]], int]:
    """发布快照用的有效区域（P2-10）。

    与 ``load_baseline`` 的关键差别：**不回退到其它材料**。``load_baseline`` 的第三个
    候选无条件使用课程材料基线（为了准备页兜底），但发布是"把这份材料交给学生"，
    把别的材料的区域挂上去会伪造出处。因此只认：

    1. 渲染产物 ``data/renders/<material_id>/regions.json``；
    2. 材料自身夹具 ``fixtures/materials/<material_id>/regions.json``；
    3. 课程材料（``mat_matrix_courseware``）的既定目录名 ``matrix-courseware``。

    同时合并准备页的确认/纠正覆盖，并过滤掉识别事实已变化的旧结论——
    与 ``GET /materials/{id}/regions`` 的语义一致。
    """

    candidates = [
        RENDERS_DIR / material_id / "regions.json",
        MATERIALS_DIR / material_id / "regions.json",
    ]
    if material_id == COURSEWARE_MATERIAL_ID:
        candidates.append(MATERIALS_DIR / "matrix-courseware" / "regions.json")

    for path in candidates:
        regions = _extract_regions(_read_json(path))
        if not regions:
            continue
        page_count = _slide_page_count(path.parent, db_page_count)
        overrides, _invalidated = _valid_overrides(
            read_overrides(material_id), regions, page_count
        )
        merged = [
            _merge_region(region, overrides.get(str(region["region_id"])))
            for region in regions
        ]
        return merged, page_count
    return [], max(1, db_page_count)


def _find_region(regions: list[dict[str, Any]], region_id: str) -> dict[str, Any] | None:
    for region in regions:
        if region.get("region_id") == region_id:
            return region
    return None


def _effective_status(base_status: Any, entry: Mapping[str, Any] | None) -> str:
    if entry is not None and isinstance(entry.get("status"), str):
        return str(entry["status"])
    return base_status if isinstance(base_status, str) else "pending"


def _merge_region(region: Mapping[str, Any], entry: Mapping[str, Any] | None) -> dict[str, Any]:
    """基线区域 + 有效覆盖 → 对外形状（覆盖值优先，其余字段保持基线）。"""

    payload = dict(region)
    overrides = dict(entry.get("parameter_overrides") or {}) if entry is not None else {}
    base_params = region.get("original_params")
    effective = dict(base_params) if _is_record(base_params) else {}
    effective.update(overrides)
    payload["status"] = _effective_status(region.get("status"), entry)
    payload["original_params"] = effective
    payload["parameter_overrides"] = overrides
    payload["has_override"] = entry is not None
    payload["note"] = entry.get("note") if entry is not None else None
    payload["updated_at"] = entry.get("updated_at") if entry is not None else None
    payload["fact_signature"] = entry.get("fact_signature") if entry is not None else None
    return payload


def _valid_overrides(
    overrides: dict[str, dict[str, Any]],
    regions: list[dict[str, Any]],
    page_count: int,
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    """过滤掉"区域已不存在"或"识别事实已变化"的覆盖，返回 ``(有效覆盖, 失效 id)``。

    指纹不符时不删除磁盘记录（GET 只读），但**绝不出现在响应里**；
    下次 PATCH 会以新签名重写，旧结论不会被回放。
    """

    valid: dict[str, dict[str, Any]] = {}
    invalidated: list[str] = []
    for region_id, entry in overrides.items():
        region = _find_region(regions, region_id)
        if region is None:
            invalidated.append(region_id)
            continue
        if entry.get("fact_signature") != fact_signature(page_count, region):
            invalidated.append(region_id)
            continue
        valid[region_id] = entry
    return valid, invalidated


# ---------------------------------------------------------------------------
# 端点
# ---------------------------------------------------------------------------


@router.get("/materials/{material_id}/regions", summary="材料区域清单（含用户覆盖）")
def list_material_regions(
    material_id: str, request: Request, ctx: SessionDep, db: DBDep
) -> JSONResponse:
    """返回该材料全部区域；``original_params`` 已合并用户在准备页的确认值。

    前端只用 ``region_id / status / parameter_overrides`` 覆盖本地基线，
    因此响应同时保留 ``has_override`` / ``updated_at`` 便于详情面板标注来源。
    """

    material = owned_material(db, ctx, material_id)
    regions, source, page_count = load_baseline(material.id, material.page_count)
    overrides, invalidated = _valid_overrides(read_overrides(material.id), regions, page_count)
    if invalidated:
        logger.info(
            "材料 %s 有 %d 条区域覆盖因识别事实变化而失效：%s",
            material.id,
            len(invalidated),
            ",".join(sorted(invalidated)),
        )
    payload = {
        "material_id": material.id,
        "baseline_source": source,
        "page_count": page_count,
        "regions": [_merge_region(region, overrides.get(str(region["region_id"]))) for region in regions],
        "invalidated_region_ids": invalidated,
    }
    return ok(request, payload)


@router.patch(
    "/materials/{material_id}/regions/{region_id}",
    summary="确认 / 纠正单个区域（状态与参数覆盖）",
)
def patch_material_region(
    material_id: str,
    region_id: str,
    payload: RegionPatchRequest,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
) -> JSONResponse:
    """写入一条区域覆盖；空覆盖 + 无状态 = 清除该区域的确认（恢复原稿）。

    错误约定（与任务书一致）：
    - 跨会话访问他人材料 → 404 ``SESSION_EXPIRED``（复用 ``owned_material``）；
    - 区域不存在 → 404 ``MISSING_FIELD``；
    - 非法 ``status`` → 422 ``MISSING_FIELD``。
    """

    material = owned_material(db, ctx, material_id)
    regions, _source, page_count = load_baseline(material.id, material.page_count)
    region = _find_region(regions, region_id)
    if region is None:
        raise ApiError(
            ErrorCode.MISSING_FIELD,
            "区域不存在或已被重新识别，请刷新准备页后重试",
            status_code=404,
            details={"region_id": region_id},
        )
    if payload.status is not None and payload.status not in ALLOWED_STATUSES:
        raise missing_field(
            "status 只能取 confirmed 或 static_only",
            allowed=list(ALLOWED_STATUSES),
            region_id=region_id,
        )

    signature = fact_signature(page_count, region)
    stored = read_overrides(material.id)
    previous = stored.get(region_id)
    # 识别事实已变化：旧确认整条作废，从基线重新开始（不回放旧参数）。
    if previous is not None and previous.get("fact_signature") != signature:
        previous = None

    status = payload.status if payload.status is not None else (previous or {}).get("status")
    if payload.parameter_overrides is not None:
        overrides = dict(payload.parameter_overrides)
    else:
        overrides = dict((previous or {}).get("parameter_overrides") or {})
    note = payload.note if payload.note is not None else (previous or {}).get("note")

    cleared = payload.note is None and payload.status is None and payload.parameter_overrides == {}
    if cleared:
        stored.pop(region_id, None)
    else:
        stored[region_id] = _clean_entry(
            {
                "status": status,
                "parameter_overrides": overrides,
                "note": note,
                "updated_at": to_iso(utc_now()),
                "fact_signature": signature,
            }
        ) or {}
    write_overrides(material.id, stored)
    entry = stored.get(region_id)
    logger.info(
        "会话 %s 更新材料 %s 区域 %s：status=%s，覆盖参数 %d 个%s",
        ctx.session_id,
        material.id,
        region_id,
        status,
        len(overrides),
        "（已清除）" if entry is None else "",
    )
    return ok(
        request,
        {
            "region_id": region_id,
            "status": _effective_status(region.get("status"), entry),
            "parameter_overrides": dict((entry or {}).get("parameter_overrides") or {}),
            "note": (entry or {}).get("note"),
            "updated_at": (entry or {}).get("updated_at"),
            "fact_signature": (entry or {}).get("fact_signature"),
        },
    )


__all__ = [
    "ALLOWED_STATUSES",
    "OVERRIDE_SCHEMA_VERSION",
    "REGIONS_DIR",
    "RegionPatchRequest",
    "fact_signature",
    "load_baseline",
    "material_regions_for_publish",
    "read_overrides",
    "router",
    "write_overrides",
]