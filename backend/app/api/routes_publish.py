"""发布与只读交付端点（P2-10 / P2-11）。

背景：
    整改判定第 3 条指出"没有发布、没有分享链接、没有学生端入口"。本模块补齐这条断链：

    - ``POST   /api/v1/materials/{material_id}/publish``  生成不可枚举的 ``share_id``，
      并把**当前**的 ``regions + ispecs + 页图清单`` 冻结进 ``shares.snapshot_json``。
    - ``GET    /api/v1/p/{share_id}``                     公开读取发布快照（无需会话）。
    - ``GET    /api/v1/p/{share_id}/pages/{page_no}``     公开只读页图（只认快照里的文件名）。
    - ``DELETE /api/v1/materials/{material_id}/publish``  撤销该材料的全部活链接。
    - ``POST   /api/v1/materials/{material_id}/export-html`` 单文件静态 HTML（断网可开）。

为什么公开端点有两套路径：
    浏览器里 ``/p/<share_id>`` 是**前端路由**（学生入口，见 ``frontend/src/routes.tsx``）；
    而 XHR 必须打到 ``/api/v1/p/<share_id>``，否则生产环境的前端静态托管
    （``try_files ... /index.html``）会把 JSON 请求也回成 ``index.html``。
    因此：``/api/v1/p/...`` 是前端实际使用的主路径，``/p/...`` 是同一处理函数的公开别名
    （方便直接调用后端验收，也让任务书里的 ``GET /p/{share_id}`` 字面成立）。

安全边界（硬要求）：
    1. 公开响应**只**包含教学内容：标题、页图、区域、iSpec；绝不含 ``session_id``、
       ``material_id``、教师邮箱、文件系统路径、``source_filename``。
    2. 页图不把 ``data/renders`` 暴露成静态目录：文件名来自快照，且必须在
       ``pages_dir(material_id)``（或课程材料的只读 ``fixtures/pages``）之内，
       经过 ``PAGE_IMAGE_PATTERN`` 白名单二次校验。
    3. ``share_id`` 用 ``secrets.token_urlsafe(12)``（96 bit），不可预测、不可枚举。
    4. 已撤销 / 不存在 / 材料已过期一律 404 ``SESSION_EXPIRED``/"资源不可用"
       （沿用既有 8 个错误码，不新增）。

快照化范围：
    ``regions``（已合并准备页确认的参数，但去掉覆盖元数据）、``ispecs``（由知识对象文档
    合成的只读规格）、``pages``（页号 + 页图文件名）、``title / page_count``。
    教师之后修改材料、重新识别或再次确认参数，都不会改变已发布链接的内容。
"""

from __future__ import annotations

import base64
import hashlib
import html
import json
import logging
import re
import time
import secrets
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import KnowledgeObjectRecord, MaterialRecord, ShareRecord
from ..render import (
    PAGE_IMAGE_PATTERN,
    existing_page_images,
    pages_dir,
    read_render_manifest,
)
from ..documents.store import read_document
from ..ppt_ai.learning_types import LearningPublishSelection
from ..schemas.common import is_expired, to_iso, utc_now
from ..schemas.errors import resource_unavailable,missing_field
from ..settings import FIXTURE_PAGES_DIR, UPLOAD_DIR
from . import API_PREFIX, DBDep, WriteDep, ok, owned_material
from .routes_regions import COURSEWARE_MATERIAL_ID, material_regions_for_publish

logger = logging.getLogger(__name__)

router = APIRouter(tags=["publish"])

#: 公开分享的 API 前缀（前端 XHR 使用；与前端路由 ``/p/:shareId`` 区分开）。
PUBLIC_API_PREFIX = f"{API_PREFIX}/p"
#: 公开分享的裸路径别名（任务书字面要求 ``GET /p/{share_id}``）。
PUBLIC_ALIAS_PREFIX = "/p"
#: 快照结构版本；写入 ``snapshot_json.schema_version``。
SNAPSHOT_SCHEMA_VERSION = "share_snapshot_v1"
#: 单文件导出允许内联的页图总字节上限（避免 60 页 × 数 MB 生成超大 HTML）。
MAX_INLINE_IMAGE_BYTES = 12 * 1024 * 1024
#: 导出 HTML 的固定下载名（不含材料 id / 标题，避免把教师侧标识写进文件名）。
EXPORT_FILENAME = "xiangsheng-export.html"
#: 页图响应缓存时间（秒）；URL 含 share_id，天然按分享隔离。
PAGE_CACHE_SECONDS = 600
#: 公开响应里允许出现的区域字段白名单（其余字段是教师侧确认元数据）。
SAFE_REGION_FIELDS: tuple[str, ...] = (
    "region_id",
    "page",
    "bbox",
    "coordinate_system",
    "script_id",
    "status",
    "original_params",
    "linked_texts",
    "assets",
    "notes",
)
#: iSpec 里可直接调节的标量类型。
SCALAR_PARAMETER_TYPES: frozenset[str] = frozenset({"integer", "decimal", "number"})


# ---------------------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------------------


def new_share_id() -> str:
    """生成 96 bit 的 URL-safe 分享标识（16 字符，不可预测、不可枚举）。"""

    return secrets.token_urlsafe(12)


def _page_no(file_name: str) -> int | None:
    """从 ``sNN.png`` / ``sNN_erased.png`` 中取页码；非法文件名返回 ``None``。"""

    match = PAGE_IMAGE_PATTERN.match(Path(file_name).name)
    if match is None:
        return None
    try:
        return int(match.group("page_no"))
    except (TypeError, ValueError):
        return None


def _is_erased(file_name: str) -> bool:
    return Path(file_name).name.endswith("_erased.png")


def _page_search_dirs(material_id: str) -> list[Path]:
    """页图只允许来自该材料的渲染产物目录；课程材料额外允许只读夹具目录。"""

    directories = [pages_dir(material_id)]
    if material_id == COURSEWARE_MATERIAL_ID:
        directories.append(FIXTURE_PAGES_DIR)
    return directories


def _find_page_file(material_id: str, file_name: str) -> Path | None:
    """在允许的目录内定位页图（白名单文件名 + 目录内二次校验）。"""

    name = Path(str(file_name)).name
    if PAGE_IMAGE_PATTERN.match(name) is None:
        return None
    for directory in _page_search_dirs(material_id):
        base = directory.resolve()
        target = (base / name).resolve()
        try:
            target.relative_to(base)
        except ValueError:
            # 即使文件名被篡改成 ``../x.png``，也不能越出产物目录。
            continue
        if target.is_file():
            return target
    return None


def _collect_pages(material_id: str, page_count: int) -> list[dict[str, Any]]:
    """收集该材料**当前**可公开的页图清单（只存文件名，不存路径）。

    来源顺序：``render.json`` → 扫描 ``data/renders/<id>/pages`` → 课程材料只读夹具
    ``fixtures/pages``。每个文件名都必须真实存在，避免发布出"占位链接"。
    """

    images: dict[int, str] = {}
    erased: dict[int, str] = {}

    manifest = read_render_manifest(material_id)
    if isinstance(manifest, Mapping):
        for entry in manifest.get("pages") or []:
            if not isinstance(entry, Mapping):
                continue
            file_name = Path(str(entry.get("file") or "")).name
            page_no = _page_no(file_name)
            if page_no is None or _is_erased(file_name):
                continue
            if _find_page_file(material_id, file_name) is None:
                continue
            images.setdefault(page_no, file_name)
            raw_erased = entry.get("erased_file")
            if isinstance(raw_erased, str) and raw_erased:
                erased_name = Path(raw_erased).name
                if (
                    _page_no(erased_name) == page_no
                    and _is_erased(erased_name)
                    and _find_page_file(material_id, erased_name) is not None
                ):
                    erased[page_no] = erased_name

    if not images:
        # ``render.json`` 缺失时直接扫描产物目录；擦除底图同样要登记，
        # 否则分享页无法切换到"原页已擦除"的交互底图。
        for path in existing_page_images(material_id):
            page_no = _page_no(path.name)
            if page_no is None:
                continue
            if _is_erased(path.name):
                erased.setdefault(page_no, path.name)
            else:
                images[page_no] = path.name

    if not images and material_id == COURSEWARE_MATERIAL_ID and FIXTURE_PAGES_DIR.is_dir():
        for path in sorted(FIXTURE_PAGES_DIR.glob("s*.png")):
            page_no = _page_no(path.name)
            if page_no is None:
                continue
            if _is_erased(path.name):
                erased.setdefault(page_no, path.name)
            else:
                images[page_no] = path.name

    limit = max(1, page_count) if page_count > 0 else 0
    items: list[dict[str, Any]] = []
    for page_no in sorted(images):
        if limit > 0 and page_no > limit:
            continue
        items.append(
            {
                "page_no": page_no,
                "image": images[page_no],
                "erased_image": erased.get(page_no),
            }
        )
    return items


# ---------------------------------------------------------------------------
# 快照：区域
# ---------------------------------------------------------------------------


def _safe_region(region: Mapping[str, Any]) -> dict[str, Any]:
    """区域 → 快照形状：白名单裁剪，去掉教师侧确认元数据与材料标识。"""

    safe: dict[str, Any] = {}
    for key in SAFE_REGION_FIELDS:
        if key in region:
            safe[key] = region[key]
    assets = region.get("assets")
    if isinstance(assets, Mapping):
        safe["assets"] = {
            "page_image": Path(str(assets.get("page_image") or "")).name,
            "erased_image": Path(str(assets.get("erased_image") or "")).name,
        }
    # ``linked_texts`` 里只保留前端渲染所需字段（不允许透传额外字段）。
    raw_texts = region.get("linked_texts")
    if isinstance(raw_texts, list):
        texts: list[dict[str, Any]] = []
        for item in raw_texts:
            if not isinstance(item, Mapping):
                continue
            texts.append(
                {
                    "element_id": item.get("element_id"),
                    "bbox": item.get("bbox"),
                    "template": item.get("template"),
                    "kind": item.get("kind"),
                }
            )
        safe["linked_texts"] = texts
    return safe


# ---------------------------------------------------------------------------
# 快照：iSpec（由知识对象文档合成）
# ---------------------------------------------------------------------------


def _safe_key(raw: Any, fallback: str) -> str:
    """把任意 id 归一成 ``[A-Za-z0-9_]``，避免 iSpec 变量名无法被模板引用。"""

    text = str(raw or "").strip()
    key = re.sub(r"[^A-Za-z0-9_]", "_", text)[:48].strip("_")
    return key or fallback


def _number_or_none(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if value != value or value in (float("inf"), float("-inf")):  # NaN / inf
        return None
    return float(value)


def _matrix_values(value: Any) -> list[float] | None:
    """``[[a,b],[c,d]]`` → 4 个标量；形状不符返回 ``None``。"""

    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return None
    values: list[float] = []
    for row in value:
        if not isinstance(row, (list, tuple)) or len(row) != 2:
            return None
        for item in row:
            number = _number_or_none(item)
            if number is None:
                return None
            values.append(number)
    return values


def _ispec_source(document: Mapping[str, Any], parameter: Mapping[str, Any]) -> dict[str, Any]:
    """参数来源：优先按 ``source_ref_ids`` 找到真实页码与原文摘录。

    不伪造来源：找不到时用对象标题占位，并标为 ``inferred``（"系统推断"而非"原文提取"）。
    """

    title = str(document.get("title") or "对象参数")[:160]
    refs = document.get("source_refs")
    by_id: dict[Any, Mapping[str, Any]] = {}
    if isinstance(refs, list):
        for ref in refs:
            if isinstance(ref, Mapping) and ref.get("id") is not None:
                by_id[ref.get("id")] = ref

    raw_ids = parameter.get("source_ref_ids")
    if isinstance(raw_ids, list):
        for ref_id in raw_ids:
            ref = by_id.get(ref_id)
            if not isinstance(ref, Mapping):
                continue
            page = ref.get("page")
            excerpt = ref.get("excerpt")
            provenance = ref.get("provenance")
            status = (
                "confirmed"
                if provenance == "user_confirmed"
                else "original"
                if provenance == "original"
                else "manual_demo"
                if provenance == "manual_demo"
                else "inferred"
            )
            return {
                "page": page if isinstance(page, int) and page > 0 else 1,
                "element_id": ref.get("element_id")
                if isinstance(ref.get("element_id"), str)
                else None,
                "bbox": None,
                "status": status,
                "excerpt": str(excerpt)[:160] if isinstance(excerpt, str) and excerpt else title,
            }
    return {
        "page": 1,
        "element_id": None,
        "bbox": None,
        "status": "inferred",
        "excerpt": title,
    }


def _scalar_ispec_parameter(
    parameter: Mapping[str, Any],
    identifier: str,
    label: str,
    default: Any,
    *,
    document: Mapping[str, Any],
) -> dict[str, Any] | None:
    """标量参数 → iSpec ``SpecParameter``；布尔/枚举/文本都按可编辑控件处理。"""

    raw_type = str(parameter.get("type") or "")
    if isinstance(default, bool):
        kind = "boolean"
    elif raw_type == "integer" and _number_or_none(default) is not None:
        kind = "integer"
        default = int(round(float(default)))
    elif _number_or_none(default) is not None and (
        raw_type in SCALAR_PARAMETER_TYPES or raw_type == ""
    ):
        kind = "number"
    elif isinstance(default, str):
        kind = "string"
    else:
        return None

    payload: dict[str, Any] = {
        "id": identifier,
        "label": label,
        "type": kind,
        "unit": str(parameter.get("unit") or ""),
        "default": default,
        "source": _ispec_source(document, parameter),
    }
    if kind in ("number", "integer"):
        raw_range = parameter.get("range")
        if isinstance(raw_range, Mapping):
            minimum = _number_or_none(raw_range.get("min"))
            maximum = _number_or_none(raw_range.get("max"))
            step = _number_or_none(raw_range.get("step"))
            if minimum is not None:
                payload["min"] = minimum
            if maximum is not None:
                payload["max"] = maximum
            if step is not None and step > 0:
                payload["step"] = step
    return payload


MATRIX_SLOTS: tuple[tuple[str, int], ...] = (("a11", 0), ("a12", 1), ("a21", 2), ("a22", 3))


def document_to_ispec(
    document: Mapping[str, Any], index: int
) -> dict[str, Any]:
    """知识对象文档 → 只读 iSpec（``spec_version=1.0``）。

    仓库当前没有独立的 iSpec 产物；这里从 ``C-KO@1`` 的 ``parameters`` 合成：

    - 标量参数原样映射（number/integer/boolean/string）；
    - ``matrix2`` 展开成 ``a11/a12/a21/a22`` 四个可拖参数（学生能直接调矩阵）；
    - ``vector2`` / ``force_list`` / ``graph`` 等结构化参数不伪造标量，交给原页交互；
    - 生成 ``table``（当前参数）与 ``text``（参数摘要）两个视图。

    不做任何"结论计算"（如 det/特征值）——没有原文证据的派生量不写进分享产物。
    """

    title = str(document.get("title") or "")[:120]
    raw_params = document.get("parameters")
    parameters: list[dict[str, Any]] = []
    text_lines: list[str] = []
    used_ids: set[str] = set()

    def unique(identifier: str) -> str:
        candidate = identifier
        counter = 2
        while candidate in used_ids:
            candidate = f"{identifier}_{counter}"
            counter += 1
        used_ids.add(candidate)
        return candidate

    if isinstance(raw_params, list):
        for raw in raw_params:
            if not isinstance(raw, Mapping):
                continue
            name = str(raw.get("name") or raw.get("id") or "参数")[:60]
            base_id = _safe_key(raw.get("id"), "param")

            matrix = _matrix_values(raw.get("value"))
            if matrix is not None and raw.get("type") == "matrix2":
                keys: list[str] = []
                # 展开后的每个元素是标量：把 type 改成 number，避免矩阵类型被再次拒绝。
                scalar_raw = dict(raw)
                scalar_raw["type"] = "number"
                for suffix, position in MATRIX_SLOTS:
                    identifier = unique(f"{base_id}_{suffix}")
                    keys.append(identifier)
                    payload = _scalar_ispec_parameter(
                        scalar_raw,
                        identifier,
                        f"{name} · {suffix}",
                        matrix[position],
                        document=document,
                    )
                    if payload is not None:
                        parameters.append(payload)
                if len(keys) == 4:
                    text_lines.append(
                        "%s = [[{{%s}}, {{%s}}], [{{%s}}, {{%s}}]]"
                        % (name, keys[0], keys[1], keys[2], keys[3])
                    )
                continue

            identifier = unique(base_id)
            payload = _scalar_ispec_parameter(
                raw,
                identifier,
                name,
                raw.get("value"),
                document=document,
            )
            if payload is None:
                used_ids.discard(identifier)
                continue
            parameters.append(payload)
            text_lines.append("%s = {{%s}}" % (name, identifier))

    views: list[dict[str, Any]] = []
    if parameters:
        views.append(
            {
                "type": "table",
                "columns": [str(item["id"]) for item in parameters],
                "title": "当前参数",
            }
        )
        views.append(
            {
                "type": "text",
                "template": "\n".join(text_lines),
                "title": "参数摘要",
            }
        )
    else:
        views.append(
            {
                "type": "text",
                "template": "该对象没有可离线调节的标量参数；请在原始页面中查看。",
                "title": "说明",
            }
        )

    spec: dict[str, Any] = {
        "spec_version": "1.0",
        "object_id": f"spec_{index}",
        "kind": "parametric",
        "parameters": parameters,
        "views": views,
        "notes": "由万象对象文档合成的只读规格，仅用于分享与离线导出。",
    }
    if title:
        spec["title"] = title
    return spec


def _build_ispecs(db: Session, material_id: str) -> list[dict[str, Any]]:
    """读取材料的知识对象，逐个合成 iSpec；对象文档异常时跳过并告警。"""

    from .routes_jobs import read_ispec_payload
    from ..ispec.persistence import load_values
    from ..ispec.validator import validate_ispec
    from copy import deepcopy

    parsed = (read_ispec_payload(material_id) or {}).get("ispecs", [])
    specs = [deepcopy(spec) for spec in parsed if isinstance(spec, dict) and not validate_ispec(spec)]
    if specs:
        saved = load_values(material_id)
        for spec in specs:
            values = saved.get(spec["object_id"], {}).get("values", {})
            for parameter in spec.get("parameters", []):
                if parameter["id"] in values:
                    parameter["default"] = values[parameter["id"]]
        return specs
    rows = db.scalars(
        select(KnowledgeObjectRecord)
        .where(KnowledgeObjectRecord.material_id == material_id)
        .order_by(KnowledgeObjectRecord.created_at.asc())
    ).all()
    specs: list[dict[str, Any]] = []
    for index, row in enumerate(rows, start=1):
        document = row.document
        if not isinstance(document, Mapping):
            logger.warning("材料 %s 的对象 %s 文档不是对象，已跳过分享合成", material_id, row.id)
            continue
        specs.append(document_to_ispec(document, index))
    return specs


# ---------------------------------------------------------------------------
# 快照构建与公开投影
# ---------------------------------------------------------------------------


def build_snapshot(
    db: Session,
    material: MaterialRecord,
    selection: LearningPublishSelection | None = None,
) -> dict[str, Any]:
    """把材料**当前**状态冻结成发布快照（不含任何教师侧标识）。

    可选 ``selection`` 显式选择课件基准/练习/仅原稿；旧调用无请求体时保持兼容。
    """

    regions, region_page_count = material_regions_for_publish(
        material.id, material.page_count
    )
    pages = _collect_pages(material.id, max(region_page_count, material.page_count))
    from ..documents.presentation import apply_document_specs,freeze_document
    ispecs = apply_document_specs(material.id,_build_ispecs(db, material.id))
    from .routes_jobs import read_ispec_payload
    layouts = (read_ispec_payload(material.id) or {}).get("page_layouts", [])
    by_no = {item.get("page_no"): item for item in layouts}
    existing = {page['page_no'] for page in pages}
    for page_no in by_no:
        if page_no not in existing:
            pages.append({'page_no': page_no, 'image': None, 'erased_image': None})
    for page in pages:
        layout = by_no.get(page["page_no"], {})
        page["width"] = layout.get("width") or 12192000
        page["height"] = layout.get("height") or 6858000
        page["elements"] = layout.get("elements", [])
        page["title"] = layout.get("title") or f'第 {page["page_no"]} 页'
    # PPT AI：发布时冻结选定的完整 bundle + branch；没有新交互时保持旧材料行为。
    if selection is not None:
        from ..ppt_ai.learning_publish import PublishSelectionError, freeze_for_selection

        try:
            frozen_payload = freeze_for_selection(
                db,
                material=material,
                session_id=material.session_id,
                selection=selection,
            )
        except PublishSelectionError as error:
            raise missing_field(str(error)) from error
        if not frozen_payload.get("can_publish"):
            raise missing_field(str(frozen_payload.get("blocked_reason") or "学习内容尚未通过验收"))
        ppt_ai_snapshot = frozen_payload.get("snapshot")
        if ppt_ai_snapshot is not None:
            current_revision = int((read_document(material.id) or {}).get('revision') or 0)
            if int(ppt_ai_snapshot.get("bundle", {}).get("source_revision", -1)) != current_revision:
                raise missing_field('交互 bundle 基于旧文档版本；请重新识别/编译后再发布')
    else:
        try:
            from ..ppt_ai.snapshots import SnapshotConflict, freeze_interactions, public_projection
            frozen = freeze_interactions(
                db,
                material=material,
                session_id=material.session_id,
                # 旧调用没有 LearningPublishSelection，不等于授权公开全部个人实验：
                # 未明确选择的候选实验/个人提问一律不进入公开快照（handoff §6.2/§8.2）。
                experiment_ids=[],
            )
            if frozen is not None:
                current_revision = int((read_document(material.id) or {}).get('revision') or 0)
                if frozen.document_revision != current_revision:
                    raise missing_field('交互 bundle 基于旧文档版本；请重新识别/编译后再发布')
            ppt_ai_snapshot = public_projection(frozen)
        except SnapshotConflict as error:
            raise missing_field(str(error)) from error
    try:scene_document=freeze_document(material.id)
    except (ValueError,OSError) as error:raise missing_field(str(error)) from error
    edited={p['page_no']:p for p in (scene_document or {}).get('pages',[])}
    for number,scene in edited.items():
        if not any(p['page_no']==number for p in pages):pages.append({'page_no':number,'width':scene['width']*12700,'height':scene['height']*12700})
    for page in pages:
        if page['page_no'] in edited:
            scene=edited[page['page_no']]
            # An edited page is delivered exclusively through its current scene.
            page.update(image=None,erased_image=None,elements=[],title=next((n['text'][:80] for n in scene['nodes'] if n.get('text')),f'第 {page["page_no"]} 页'))
    regions=[r for r in regions if r.get('page') not in edited]
    order=(scene_document or {}).get('page_order')
    if order:
        pages_by_no={page['page_no']:page for page in pages}
        pages=[pages_by_no.get(n,{'page_no':n,'image':None,'erased_image':None}) for n in order]
        regions=[region for region in regions if region.get('page') in pages_by_no and region.get('page') in order]
        page_count=len(order)
    else:
        pages.sort(key=lambda page: page['page_no'])
        page_count=max(1,material.page_count,region_page_count,*(item["page_no"] for item in pages))

    return {
        "schema_version": SNAPSHOT_SCHEMA_VERSION,
        "published_at": to_iso(utc_now()),
        "title": material.title,
        "page_count": page_count,
        "regions": [_safe_region(region) for region in regions],
        "ispecs": ispecs,
        "pages": pages,
        "scene_document": scene_document,
        "source_pptx_sha256": _source_pptx_hash(material.id),
        "ppt_ai": ppt_ai_snapshot,
    }


def _source_pptx_hash(material_id: str) -> str:
    path = UPLOAD_DIR / material_id / "original.pptx"
    if not path.is_file():
        return ""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _page_url(share_id: str, page_no: int, *, erased: bool = False) -> str:
    suffix = "?variant=erased" if erased else ""
    return f"{PUBLIC_API_PREFIX}/{share_id}/pages/{page_no}{suffix}"


def public_payload(share: ShareRecord) -> dict[str, Any]:
    """快照 + 公开页图 URL（学生端只读形状）。

    区域里的 ``assets`` 被替换为公开端点 URL，前端可以直接交给 ``PageCanvas``；
    除此之外不追加任何内部字段（material_id / session_id / 路径都不出现）。
    """

    snapshot = share.snapshot_json if isinstance(share.snapshot_json, Mapping) else {}
    raw_pages = snapshot.get("pages")
    page_items = [item for item in raw_pages if isinstance(item, Mapping)] if isinstance(raw_pages, list) else []

    by_page: dict[int, Mapping[str, Any]] = {}
    pages: list[dict[str, Any]] = []
    for item in page_items:
        page_no = item.get("page_no")
        if not isinstance(page_no, int):
            continue
        by_page[page_no] = item
        erased = item.get("erased_image")
        pages.append(
            {
                "page_no": page_no,
                "image_url": _page_url(share.share_id, page_no) if item.get('image') else None,
                "title": item.get("title") if isinstance(item.get("title"), str) else None,
                "width": item.get("width", 12192000),
                "height": item.get("height", 6858000),
                "elements": item.get("elements", []),
                "erased_image_url": (
                    _page_url(share.share_id, page_no, erased=True)
                    if isinstance(erased, str) and erased
                    else None
                ),
            }
        )

    raw_regions = snapshot.get("regions")
    regions: list[dict[str, Any]] = []
    if isinstance(raw_regions, list):
        for raw in raw_regions:
            if not isinstance(raw, Mapping):
                continue
            # 纵深防御：即使 snapshot_json 被篡改/旧版本写入，公开投影仍只输出白名单字段。
            region = _safe_region(raw)
            page_no = region.get("page")
            page_item = by_page.get(page_no) if isinstance(page_no, int) else None
            region["assets"] = {
                "page_image": _page_url(share.share_id, page_no)
                if page_item is not None and isinstance(page_no, int)
                else "",
                "erased_image": _page_url(share.share_id, page_no, erased=True)
                if page_item is not None
                and isinstance(page_item.get("erased_image"), str)
                and page_item.get("erased_image")
                and isinstance(page_no, int)
                else "",
            }
            regions.append(region)

    ispecs = snapshot.get("ispecs")
    from ..documents.presentation import public_document
    return {
        "scene_document": public_document(snapshot.get('scene_document')),
        "ppt_ai": snapshot.get('ppt_ai'),
        "schema_version": snapshot.get("schema_version", SNAPSHOT_SCHEMA_VERSION),
        "published_at": snapshot.get("published_at"),
        "title": snapshot.get("title", ""),
        "page_count": snapshot.get("page_count", 1),
        "pages": pages,
        "regions": regions,
        "ispecs": list(ispecs) if isinstance(ispecs, list) else [],
    }


def load_shared(db: Session, share_id: str) -> tuple[ShareRecord, MaterialRecord]:
    """按 ``share_id`` 取活链接；不存在 / 已撤销 / 材料已过期一律 404。"""

    share = db.get(ShareRecord, share_id)
    if share is None or share.revoked_at is not None:
        raise resource_unavailable()
    material = db.get(MaterialRecord, share.material_id)
    if material is None or is_expired(material.expires_at):
        raise resource_unavailable()
    return share, material


# ---------------------------------------------------------------------------
# 发布端点
# ---------------------------------------------------------------------------


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/publish",
    status_code=201,
    summary="发布材料并生成只读分享链接",
)
def publish_material(
    material_id: str,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
    body: LearningPublishSelection | None = None,
) -> JSONResponse:
    """冻结当前材料状态并返回 ``share_id`` / ``share_url``。

    每次发布都新建一条 ``shares`` 记录：旧链接仍指向旧快照，直到被
    ``DELETE /materials/{id}/publish`` 统一撤销。这让"发布"成为显式的快照动作，
    而不是对实时材料的透明代理。
    """

    material = owned_material(db, ctx, material_id)
    started = time.monotonic()
    snapshot = build_snapshot(db, material, body)
    elapsed = time.monotonic() - started
    share_id = new_share_id()
    db.add(
        ShareRecord(
            share_id=share_id,
            material_id=material.id,
            session_id=ctx.session_id,
            created_at=to_iso(utc_now()),
            revoked_at=None,
            snapshot_json=snapshot,
        )
    )
    db.commit()
    logger.info(
        "会话 %s 发布材料 %s → share=%s（区域 %d，对象 %d，页图 %d，快照 %.2fs）",
        ctx.session_id,
        material.id,
        share_id,
        len(snapshot["regions"]),
        len(snapshot["ispecs"]),
        len(snapshot["pages"]),
        elapsed,
    )
    return ok(
        request,
        {"share_id": share_id, "share_url": f"{PUBLIC_ALIAS_PREFIX}/{share_id}"},
        status_code=201,
    )


@router.delete(
    f"{API_PREFIX}/materials/{{material_id}}/publish",
    summary="撤销该材料的全部分享链接",
)
def revoke_material_shares(
    material_id: str, request: Request, ctx: WriteDep, db: DBDep
) -> JSONResponse:
    """把该材料所有未撤销的分享写 ``revoked_at``（幂等；重复调用返回 0）。"""

    material = owned_material(db, ctx, material_id)
    rows = db.scalars(
        select(ShareRecord).where(
            ShareRecord.material_id == material.id,
            ShareRecord.revoked_at.is_(None),
        )
    ).all()
    revoked_at = to_iso(utc_now())
    for row in rows:
        row.revoked_at = revoked_at
    db.commit()
    logger.info("会话 %s 撤销材料 %s 的 %d 条分享链接", ctx.session_id, material.id, len(rows))
    return ok(request, {"revoked": len(rows), "revoked_at": revoked_at})


# ---------------------------------------------------------------------------
# 公开读取端点
# ---------------------------------------------------------------------------


def _shared_payload_response(
    request: Request, share_id: str, db: Session
) -> JSONResponse:
    share, _material = load_shared(db, share_id)
    return ok(request, public_payload(share))


def _shared_page_response(
    share_id: str, page_no: int, db: Session, variant: str
) -> FileResponse:
    share, material = load_shared(db, share_id)
    snapshot = share.snapshot_json if isinstance(share.snapshot_json, Mapping) else {}
    raw_pages = snapshot.get("pages")
    items = [item for item in raw_pages if isinstance(item, Mapping)] if isinstance(raw_pages, list) else []
    target_item = next(
        (item for item in items if item.get("page_no") == page_no),
        None,
    )
    if target_item is None:
        raise resource_unavailable()
    want_erased = variant == "erased"
    raw_name = target_item.get("erased_image") if want_erased else target_item.get("image")
    if not isinstance(raw_name, str) or not raw_name:
        raise resource_unavailable()
    target = _find_page_file(material.id, raw_name)
    if target is None:
        raise resource_unavailable()
    return FileResponse(
        path=str(target),
        media_type="image/png",
        headers={"Cache-Control": f"private, max-age={PAGE_CACHE_SECONDS}"},
    )


@router.get(f"{PUBLIC_API_PREFIX}/{{share_id}}", summary="公开读取发布快照（无需会话）")
def get_shared_snapshot(
    share_id: str, request: Request, db: DBDep
) -> JSONResponse:
    """学生端入口数据：只含教学内容，不含任何教师侧标识。"""

    return _shared_payload_response(request, share_id, db)


@router.get(
    f"{PUBLIC_API_PREFIX}/{{share_id}}/pages/{{page_no}}",
    summary="公开只读页图（无需会话）",
)
def get_shared_page(
    share_id: str,
    page_no: int,
    db: DBDep,
    variant: str = Query(default="page", description="page | erased"),
) -> FileResponse:
    """只读页图；文件名来自快照白名单，绝不把 ``data/renders`` 当静态目录。"""

    return _shared_page_response(share_id, page_no, db, variant)


# --- 裸路径别名：``GET /p/{share_id}``（任务书字面要求；不进 OpenAPI） ---


@router.get(f"{PUBLIC_ALIAS_PREFIX}/{{share_id}}", include_in_schema=False)
def get_shared_snapshot_alias(
    share_id: str, request: Request, db: DBDep
) -> JSONResponse:
    return _shared_payload_response(request, share_id, db)


@router.get(
    f"{PUBLIC_ALIAS_PREFIX}/{{share_id}}/pages/{{page_no}}",
    include_in_schema=False,
)
def get_shared_page_alias(
    share_id: str,
    page_no: int,
    db: DBDep,
    variant: str = Query(default="page", description="page | erased"),
) -> FileResponse:
    return _shared_page_response(share_id, page_no, db, variant)


# ---------------------------------------------------------------------------
# P2-11：单文件静态导出（自包含 HTML，断网可开）
# ---------------------------------------------------------------------------

#: 导出页面的样式（内联，断网无需外部字体/框架）。
EXPORT_CSS = """
:root{--ink:#12203a;--muted:#5b6880;--line:#dfe5ee;--bg:#f7f9fc;--card:#ffffff;--accent:#2f5bea;}
*{box-sizing:border-box}
body{margin:0;font-family:"PingFang SC","Microsoft YaHei",system-ui,-apple-system,"Segoe UI",sans-serif;
  color:var(--ink);background:var(--bg);line-height:1.6}
header{position:sticky;top:0;z-index:5;background:rgba(255,255,255,.94);border-bottom:1px solid var(--line);
  padding:14px 20px;backdrop-filter:blur(6px)}
header h1{margin:0;font-size:20px;letter-spacing:.01em}
header p{margin:4px 0 0;color:var(--muted);font-size:13px}
main{max-width:1180px;margin:0 auto;padding:20px}
section{margin:0 0 28px}
h2{font-size:16px;margin:0 0 12px}
.pages{display:grid;gap:14px}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
figure img{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:contain;background:#fff}
figcaption{padding:8px 12px;color:var(--muted);font-size:12px;border-top:1px solid var(--line)}
.spec{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 16px}
.spec h3{margin:0 0 10px;font-size:15px}
.params{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px 18px;margin:0 0 14px}
.param{display:grid;grid-template-columns:1fr auto;gap:4px 8px;font-size:13px;color:var(--muted)}
.param span{grid-column:1/-1;color:var(--ink)}
.param input[type=range]{width:100%}
.param output{font-variant-numeric:tabular-nums;color:var(--ink)}
table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
th,td{border:1px solid var(--line);padding:6px 8px;text-align:right;white-space:nowrap;overflow:auto}
th:first-child,td:first-child{text-align:left}
th{background:#f2f5fb;font-weight:600}
.text-view{white-space:pre-wrap;margin:10px 0 0;padding:10px 12px;background:#f5f7fb;border-radius:8px;font-size:13px}
.degrade{margin:8px 0 0;color:var(--muted);font-size:12px}
footer{max-width:1180px;margin:0 auto;padding:8px 20px 28px;color:var(--muted);font-size:12px}
.placeholder{display:grid;place-items:center;aspect-ratio:16/9;background:#eef2f9;border:1px dashed var(--line);
  border-radius:10px;color:var(--muted);font-size:13px;text-align:center;padding:16px}
@media (max-width:720px){main{padding:12px}.params{grid-template-columns:1fr}}
"""

#: 导出运行时（vanilla JS，无任何外部依赖）。
#:
#: 只支持 ``table`` / ``text`` 视图按参数联动；``figure`` 降级为内联静态页图，
#: ``vega`` 无法离线渲染，显式提示"已降级为静态页面图"。
EXPORT_RUNTIME_JS = r"""
(function () {
  'use strict';
  var dataEl = document.getElementById('export-data');
  if (dataEl === null) return;
  var data;
  try { data = JSON.parse(dataEl.textContent || '{}'); } catch (err) { data = {}; }
  var specs = Array.isArray(data.specs) ? data.specs : [];
  var values = {};

  function key(specIndex, id) { return specIndex + ':' + id; }

  function fmt(value) {
    if (typeof value === 'number') {
      if (!isFinite(value)) return '—';
      var rounded = Math.round(value * 1e4) / 1e4;
      return String(rounded);
    }
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (value === null || value === undefined) return '—';
    return String(value);
  }

  function readInput(input) {
    if (input.type === 'checkbox') return input.checked;
    if (input.type === 'range' || input.type === 'number') {
      var parsed = Number(input.value);
      return isFinite(parsed) ? parsed : 0;
    }
    return input.value;
  }

  function lookup(specIndex, id) {
    var k = key(specIndex, id);
    return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : undefined;
  }

  function updateOutputs() {
    var nodes = document.querySelectorAll('[data-for]');
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      var raw = node.getAttribute('data-for') || '';
      var cut = raw.indexOf(':');
      if (cut < 0) continue;
      node.textContent = fmt(lookup(Number(raw.slice(0, cut)), raw.slice(cut + 1)));
    }
  }

  function updateTables() {
    var cells = document.querySelectorAll('[data-cell]');
    for (var i = 0; i < cells.length; i += 1) {
      var cell = cells[i];
      var raw = cell.getAttribute('data-cell') || '';
      var cut = raw.indexOf(':');
      if (cut < 0) continue;
      var value = lookup(Number(raw.slice(0, cut)), raw.slice(cut + 1));
      cell.textContent = value === undefined ? '—' : fmt(value);
    }
  }

  function updateTexts() {
    var nodes = document.querySelectorAll('[data-text]');
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      var raw = node.getAttribute('data-text') || '';
      var specIndex = Number(raw);
      var template = node.getAttribute('data-template') || '';
      node.textContent = template.replace(/\{\{\s*([A-Za-z0-9_.\-]+)\s*\}\}/g, function (_match, id) {
        var value = lookup(specIndex, id);
        return value === undefined ? '—' : fmt(value);
      });
    }
  }

  function render() {
    updateOutputs();
    updateTables();
    updateTexts();
  }

  function selfTest() {
    var query = new URLSearchParams(window.location.search);
    if (query.get('selftest') !== '1') return;
    var result = 'FAIL';
    try {
      var input = document.querySelector('[data-param]');
      var textNode = document.querySelector('[data-text]');
      var cell = document.querySelector('[data-cell]');
      if (input === null) {
        // 没有可调参数时，表格/文本只要已渲染即视为可用。
        result = (textNode !== null || cell !== null) ? 'PASS' : 'FAIL';
      } else {
        var before = [textNode === null ? '' : textNode.textContent, cell === null ? '' : cell.textContent].join('|');
        if (input.type === 'range' || input.type === 'number') {
          var step = Number(input.getAttribute('step'));
          if (!isFinite(step) || step <= 0) step = 1;
          var next = Number(input.value) + step;
          var min = Number(input.getAttribute('min'));
          var max = Number(input.getAttribute('max'));
          if (isFinite(min) && next < min) next = min;
          if (isFinite(max) && next > max) next = max;
          input.value = String(next);
        } else if (input.type === 'checkbox') {
          input.checked = !input.checked;
        } else {
          input.value = String(input.value) + '1';
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        var after = [textNode === null ? '' : textNode.textContent, cell === null ? '' : cell.textContent].join('|');
        result = before !== after ? 'PASS' : 'FAIL';
      }
    } catch (err) {
      result = 'FAIL: ' + (err && err.message ? err.message : 'error');
    }
    document.body.setAttribute('data-selftest', result);
    var out = document.getElementById('selftest-output');
    if (out !== null) out.textContent = 'self-test: ' + result;
  }

  function boot() {
    var inputs = document.querySelectorAll('[data-param]');
    for (var i = 0; i < inputs.length; i += 1) {
      var input = inputs[i];
      var raw = input.getAttribute('data-param') || '';
      var cut = raw.indexOf(':');
      if (cut < 0) continue;
      var specIndex = Number(raw.slice(0, cut));
      var id = raw.slice(cut + 1);
      values[key(specIndex, id)] = readInput(input);
      (function (node, index, paramId) {
        node.addEventListener('input', function () {
          values[key(index, paramId)] = readInput(node);
          render();
        });
      })(input, specIndex, id);
    }
    render();
    selfTest();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
"""


def _format_default(value: Any) -> str:
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, (int, float)):
        return str(round(float(value), 4))
    return str(value)


def _param_control(marker: str, parameter: Mapping[str, Any]) -> str:
    """生成一个自包含的参数控件（range / number / checkbox / text）。"""

    safe_marker = html.escape(marker, quote=True)
    label = html.escape(str(parameter.get("label") or parameter.get("id") or "参数"))
    kind = parameter.get("type")
    default = parameter.get("default")

    if kind == "boolean":
        checked = " checked" if bool(default) else ""
        return (
            f'<label class="param"><span>{label}</span>'
            f'<input type="checkbox" data-param="{safe_marker}"{checked}>'
            f"<output></output></label>"
        )

    if kind in ("number", "integer"):
        minimum = _number_or_none(parameter.get("min"))
        maximum = _number_or_none(parameter.get("max"))
        step = _number_or_none(parameter.get("step")) or 1
        value = _number_or_none(default)
        if value is None:
            value = minimum if minimum is not None else 0.0
        if minimum is not None and maximum is not None and minimum <= maximum:
            return (
                f'<label class="param"><span>{label}</span>'
                f'<input type="range" data-param="{safe_marker}" '
                f'min="{minimum}" max="{maximum}" step="{step}" value="{value}">'
                f'<output data-for="{safe_marker}">{_format_default(value)}</output></label>'
            )
        return (
            f'<label class="param"><span>{label}</span>'
            f'<input type="number" data-param="{safe_marker}" step="{step}" value="{value}">'
            f'<output data-for="{safe_marker}">{_format_default(value)}</output></label>'
        )

    return (
        f'<label class="param"><span>{label}</span>'
        f'<input type="text" data-param="{safe_marker}" value="{html.escape(str(default))}">'
        f"<output></output></label>"
    )


def _spec_page(spec: Mapping[str, Any]) -> int | None:
    """对象所在页：优先 anchor，其次第一个参数的来源页。"""

    anchor = spec.get("anchor")
    if isinstance(anchor, Mapping) and isinstance(anchor.get("page"), int):
        return anchor["page"]
    raw_parameters = spec.get("parameters")
    for parameter in raw_parameters if isinstance(raw_parameters, list) else []:
        if not isinstance(parameter, Mapping):
            continue
        source = parameter.get("source")
        if isinstance(source, Mapping) and isinstance(source.get("page"), int):
            return source["page"]
    return None


def _dataset_rows(spec: Mapping[str, Any], dataset_id: Any) -> list[list[Any]]:
    """取 ``datasets[]`` 里的原始行；没有该数据集时返回空列表。"""

    raw_datasets = spec.get("datasets")
    for dataset in raw_datasets if isinstance(raw_datasets, list) else []:
        if not isinstance(dataset, Mapping) or dataset.get("id") != dataset_id:
            continue
        raw_rows = dataset.get("rows")
        return [row for row in raw_rows if isinstance(row, list)] if isinstance(raw_rows, list) else []
    return []


_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")


def _render_text_preview(spec: Mapping[str, Any], template: str) -> tuple[str, list[str]]:
    """把 text 模板渲染成初始文本；返回 ``(文本, 无法离线求值的派生量)``。

    占位符只可能是参数或派生量：参数用默认值填，派生量需要运行时按 ``expressions``
    求值，离线导出不做重算，交给调用方给出说明。
    """

    defaults: dict[str, Any] = {}
    raw_parameters = spec.get("parameters")
    for parameter in raw_parameters if isinstance(raw_parameters, list) else []:
        if isinstance(parameter, Mapping) and isinstance(parameter.get("id"), str):
            defaults[parameter["id"]] = parameter.get("default")

    derived = sorted({name for name in _PLACEHOLDER.findall(template) if name not in defaults})
    if derived:
        return template, derived

    def replace(match: re.Match[str]) -> str:
        return _format_default(defaults.get(match.group(1), ""))

    return _PLACEHOLDER.sub(replace, template), []


def _spec_export_html(spec: Mapping[str, Any], index: int, static_page_src: str | None) -> str:
    """单个 iSpec 的导出区块：参数 + table + text + figure/vega 降级提示。"""

    title = html.escape(str(spec.get("title") or f"对象 {index + 1}"))
    parts: list[str] = [f'<article class="spec"><h3>{title}</h3>']

    raw_parameters = spec.get("parameters")
    parameters = [item for item in raw_parameters if isinstance(item, Mapping)] if isinstance(raw_parameters, list) else []
    if parameters:
        parts.append('<div class="params">')
        for parameter in parameters:
            identifier = parameter.get("id")
            if not isinstance(identifier, str) or not identifier:
                continue
            parts.append(_param_control(f"{index}:{identifier}", parameter))
        parts.append("</div>")

    raw_views = spec.get("views")
    views = [item for item in raw_views if isinstance(item, Mapping)] if isinstance(raw_views, list) else []
    has_figure = False
    for view in views:
        view_type = view.get("type")
        if view_type == "table":
            raw_columns = view.get("columns")
            columns = [str(item) for item in raw_columns] if isinstance(raw_columns, list) else []
            head = "".join(f"<th>{html.escape(column)}</th>" for column in columns)
            rows = _dataset_rows(spec, view.get("dataset"))
            if rows:
                # 有 dataset 就渲染真实行：导出的表格必须是原文数据，不是空占位。
                body = "".join(
                    "<tr>"
                    + "".join(f"<td>{html.escape(str(cell))}</td>" for cell in row)
                    + "</tr>"
                    for row in rows[:200]
                )
                parts.append(
                    f'<table data-table="{index}"><thead><tr>{head}</tr></thead>'
                    f"<tbody>{body}</tbody></table>"
                )
            else:
                cells = "".join(
                    f'<td data-cell="{index}:{html.escape(column, quote=True)}">—</td>'
                    for column in columns
                )
                parts.append(
                    f'<table data-table="{index}"><thead><tr>{head}</tr></thead>'
                    f"<tbody><tr>{cells}</tr></tbody></table>"
                )
        elif view_type == "text":
            template = str(view.get("template") or "")
            preview, derived = _render_text_preview(spec, template)
            if derived:
                # 派生量（如 det、变换后的坐标）由前端按 expressions 实时求值，
                # 离线导出不重算——宁可写清楚，也不要在导出物里摆一串 "—"。
                parts.append(
                    '<p class="degrade">这段结论用到派生量（'
                    + html.escape("、".join(derived))
                    + "），离线导出不重算，请在网页版查看。</p>"
                )
            else:
                parts.append(
                    f'<p class="text-view" data-text="{index}" '
                    f'data-template="{html.escape(template, quote=True)}">'
                    f"{html.escape(preview)}</p>"
                )
        elif view_type == "figure":
            has_figure = True
            if static_page_src is not None:
                parts.append(
                    f'<figure><img src="{static_page_src}" alt="静态页面图">'
                    f"<figcaption>图形视图已降级为静态页面图（离线导出不包含交互图形运行时）。</figcaption></figure>"
                )
            else:
                parts.append('<p class="degrade">图形视图已降级：导出产物中没有可内联的页面图。</p>')
        elif view_type == "vega":
            parts.append(
                '<p class="degrade">vega 图表需要联网渲染，已降级为静态页面图；'
                "表格与文本仍可离线交互。</p>"
            )

    if not has_figure and static_page_src is not None:
        parts.append(
            f'<figure><img src="{static_page_src}" alt="静态页面图">'
            f"<figcaption>原始页面（静态图，离线查看）。</figcaption></figure>"
        )
    parts.append("</article>")
    return "".join(parts)


def _inline_pages(snapshot: Mapping[str, Any], material_id: str) -> list[dict[str, Any]]:
    """把页图内联为 data URI；累计超过上限后停止内联并给出说明。"""

    raw_pages = snapshot.get("pages")
    items = [item for item in raw_pages if isinstance(item, Mapping)] if isinstance(raw_pages, list) else []
    inlined: list[dict[str, Any]] = []
    total = 0
    for item in items:
        page_no = item.get("page_no")
        file_name = item.get("image")
        if not isinstance(page_no, int) or not isinstance(file_name, str):
            continue
        path = _find_page_file(material_id, file_name)
        if path is None:
            continue
        try:
            payload = path.read_bytes()
        except OSError:
            continue
        if total + len(payload) > MAX_INLINE_IMAGE_BYTES:
            inlined.append({"page_no": page_no, "src": None, "note": "页图过大，未内联"})
            continue
        total += len(payload)
        inlined.append(
            {
                "page_no": page_no,
                "src": "data:image/png;base64," + base64.b64encode(payload).decode("ascii"),
                "note": None,
            }
        )
    return inlined


def _render_legacy_standalone_html(snapshot: Mapping[str, Any], material_id: str) -> str:
    """生成单文件 HTML（内联 CSS/JS/JSON/页图），断网或 ``file://`` 直接可开。"""

    title = html.escape(str(snapshot.get("title") or "万象课程材料"))
    published_at = html.escape(str(snapshot.get("published_at") or ""))
    pages = _inline_pages(snapshot, material_id)
    # 每个对象用它自己那一页的页图降级，不能全用第 1 页（否则多页材料会张冠李戴）。
    page_src_by_no = {
        item["page_no"]: item["src"]
        for item in pages
        if isinstance(item.get("src"), str) and item["src"]
    }
    first_src = next(iter(page_src_by_no.values()), None)

    page_blocks: list[str] = []
    for item in pages:
        page_no = item["page_no"]
        src = item.get("src")
        if isinstance(src, str) and src:
            page_blocks.append(
                f'<figure><img src="{src}" alt="第 {page_no} 页">'
                f"<figcaption>第 {page_no} 页</figcaption></figure>"
            )
        else:
            page_blocks.append(
                f'<div class="placeholder">第 {page_no} 页页图未内联（{html.escape(str(item.get("note") or "不可用"))}）。</div>'
            )
    if not pages:
        page_blocks.append(
            '<div class="placeholder">该材料没有可导出的页面图；下方对象视图仍可离线交互。</div>'
        )

    raw_specs = snapshot.get("ispecs")
    specs = [item for item in raw_specs if isinstance(item, Mapping)] if isinstance(raw_specs, list) else []
    spec_blocks = [
        _spec_export_html(spec, index, page_src_by_no.get(_spec_page(spec) or -1, first_src))
        for index, spec in enumerate(specs)
    ]
    if not spec_blocks:
        spec_blocks.append(
            '<article class="spec"><h3>对象视图</h3>'
            '<p class="degrade">该材料尚未生成知识对象；导出仅包含静态页面图。</p></article>'
        )

    export_data = {
        "title": snapshot.get("title", ""),
        "published_at": snapshot.get("published_at"),
        "specs": [
            {
                "title": spec.get("title"),
                "parameters": [
                    {
                        key: parameter.get(key)
                        for key in ("id", "label", "type", "min", "max", "step", "default", "unit")
                        if key in parameter
                    }
                    for parameter in (spec.get("parameters") or [])
                    if isinstance(parameter, Mapping)
                ],
            }
            for spec in specs
        ],
    }
    data_json = json.dumps(export_data, ensure_ascii=False).replace("</", "<\\/")

    return "".join(
        [
            "<!doctype html>",
            '<html lang="zh-CN">',
            "<head>",
            '<meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width, initial-scale=1">',
            '<meta name="robots" content="noindex, nofollow">',
            f"<title>{title} · 万象只读导出</title>",
            f"<style>{EXPORT_CSS}</style>",
            "</head>",
            "<body>",
            "<header>",
            f"<h1>{title}</h1>",
            f"<p>只读导出 · 发布快照 {published_at} · 断网可直接打开</p>",
            "</header>",
            "<main>",
            '<section aria-label="原始页面">',
            "<h2>原始页面</h2>",
            '<div class="pages">',
            "".join(page_blocks),
            "</div>",
            "</section>",
            '<section aria-label="对象视图">',
            "<h2>对象视图（表格与文本可离线交互）</h2>",
            "".join(spec_blocks),
            "</section>",
            "</main>",
            '<footer>由万象发布 · 只读</footer>',
            '<pre id="selftest-output" hidden></pre>',
            f'<script id="export-data" type="application/json">{data_json}</script>',
            f"<script>{EXPORT_RUNTIME_JS}</script>",
            "</body>",
            "</html>",
        ]
    )


def render_standalone_html(snapshot: Mapping[str, Any], material_id: str) -> str:
    from ..offline import render_offline_deck
    return render_offline_deck(snapshot,material_id,_find_page_file)


@router.post(
    f"{API_PREFIX}/materials/{{material_id}}/export-html",
    summary="导出单文件静态 HTML（断网可开）",
)
def export_material_html(
    material_id: str,
    request: Request,
    ctx: WriteDep,
    db: DBDep,
    body: LearningPublishSelection | None = None,
) -> Response:
    """冻结当前参数，内联全部页图和与在线页面共用的运行时，不创建公开链接。"""

    material = owned_material(db, ctx, material_id)
    snapshot = build_snapshot(db, material, body)
    html_text = render_standalone_html(snapshot, material.id)
    logger.info(
        "会话 %s 导出材料 %s 为单文件 HTML（%d 字节）",
        ctx.session_id,
        material.id,
        len(html_text.encode("utf-8")),
    )
    return Response(
        content=html_text,
        media_type="text/html; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{EXPORT_FILENAME}"',
            "Cache-Control": "no-store",
        },
    )


__all__ = [
    "EXPORT_FILENAME",
    "PUBLIC_ALIAS_PREFIX",
    "PUBLIC_API_PREFIX",
    "SNAPSHOT_SCHEMA_VERSION",
    "build_snapshot",
    "document_to_ispec",
    "load_shared",
    "new_share_id",
    "public_payload",
    "render_standalone_html",
    "router",
]
