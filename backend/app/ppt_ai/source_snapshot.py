"""构造 PPT AI 的不可变来源快照与内容哈希。

来源优先级：

1. 当前自由编辑文档（布局与内容以用户当前修改为准）；
2. 上传原件的解析产物（重新解析 ``original.pptx``，并附上识别层 OCR 证据）；
3. 只读夹具 ``fixtures/materials/<id>/slides.json``；
4. 最后退回已落盘的 ``page_layouts``（仅文字/页码，缺图表数据）。

快照只保留内容与几何；像素坐标、EMU 与 PPT 原生坐标在这一层统一为相对页面
的 0—1 值。``source_hash`` 用于缓存与过期判断，不把文件名当作身份。
"""

from __future__ import annotations

import json
import logging
import math
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

from ..documents.store import read_document
from ..schemas.common import to_iso, utc_now
from ..settings import EXAMPLES_DIR, FIXTURES_DIR, MATERIALS_DIR, UPLOAD_DIR
from .types import BBox, SourceSnapshot
from .util import hash_json, semantic_content_hash

logger = logging.getLogger(__name__)

#: 解析缓存只驻留内存；原件更新（mtime/size 变化）即失效。
_CACHE_LOCK_ENABLED = True


def _safe_material(material_id: str) -> bool:
    import re

    return bool(re.fullmatch(r"[A-Za-z0-9_-]{1,96}", material_id or ""))


def _compact_node(node: Mapping[str, Any]) -> dict[str, Any]:
    """场景节点压成快照需要的字段；去掉图片 data URI 等大字段。"""

    keys = (
        "id",
        "type",
        "x",
        "y",
        "width",
        "height",
        "rotation",
        "text",
        "base_text",
        "table",
        "chart",
        "interaction",
        "source_element_id",
        "source_shape_id",
        "shape",
        "hidden",
        "deleted",
        "z",
    )
    compact: dict[str, Any] = {}
    for key in keys:
        value = node.get(key)
        if key in ("text", "base_text") and isinstance(value, str):
            compact[key] = value[:20000]
        elif key in ("table", "chart", "interaction") and value is not None:
            compact[key] = value
        elif key in ("x", "y", "width", "height", "rotation", "z") and isinstance(value, (int, float)):
            compact[key] = float(value)
        elif key in ("hidden", "deleted") and isinstance(value, bool):
            compact[key] = value
        elif key in ("id", "type", "source_element_id", "source_shape_id", "shape") and isinstance(value, str):
            compact[key] = value
    return compact


def _scene_document(material_id: str) -> dict[str, Any] | None:
    document = read_document(material_id)
    if not isinstance(document, dict):
        return None
    pages = []
    for page in document.get("pages", []):
        if not isinstance(page, Mapping):
            continue
        pages.append(
            {
                "page_no": page.get("page_no"),
                "width": page.get("width"),
                "height": page.get("height"),
                "modified": bool(page.get("modified")),
                "nodes": [
                    _compact_node(node)
                    for node in page.get("nodes", [])
                    if isinstance(node, Mapping)
                ],
            }
        )
    return {
        "revision": int(document.get("revision") or 0),
        "pages": pages,
        "applied_operations": list(document.get("applied_operations", []))[-100:],
    }


def _attach_image_recognition(payload: dict[str, Any], recognition: Mapping[str, Any]) -> None:
    if not recognition:
        return
    for page in payload.get("pages", []):
        if not isinstance(page, Mapping):
            continue
        for element in page.get("elements", []):
            if not isinstance(element, dict):
                continue
            evidence = recognition.get(element.get("element_id"))
            if not isinstance(evidence, Mapping):
                continue
            element["image_recognition"] = {
                "text": str(evidence.get("text") or "")[:8000],
                "matrix": evidence.get("matrix"),
                "method": str(evidence.get("method") or "local_ocr"),
                "reason": evidence.get("reason"),
            }


def _recognized_payload(material_id: str, recognition: Mapping[str, Any]) -> dict[str, Any] | None:
    """读取已落盘的识别 payload（取 image_recognition 与 page_layouts 兜底）。"""

    try:
        from ..api.routes_jobs import read_ispec_payload

        payload = read_ispec_payload(material_id)
    except Exception:  # noqa: BLE001
        payload = None
    if not isinstance(payload, dict):
        return None
    if not payload.get("image_recognition"):
        payload["image_recognition"] = dict(recognition or {})
    return payload


@lru_cache(maxsize=32)
def _parse_cached(path_text: str, mtime_ns: int, size: int) -> dict[str, Any] | None:
    try:
        from ..parsers.pptx_parser import parse_pptx

        result = parse_pptx(Path(path_text))
    except Exception as exc:  # noqa: BLE001 - 解析失败回退到已落盘产物
        logger.warning("PPT AI 重新解析失败（%s）：%s", Path(path_text).name, type(exc).__name__)
        return None
    payload = result[1] if isinstance(result, tuple) and len(result) > 1 else result
    if isinstance(payload, Mapping):
        return dict(payload)
    return None


def _original_path(material_id: str) -> Path | None:
    root = UPLOAD_DIR / material_id
    for name in ("original.pptx", "document/source.pptx", "edited.pptx"):
        path = root / name
        if path.is_file():
            return path
    return None


def _fixture_payload(material_id: str) -> dict[str, Any] | None:
    candidates = [
        MATERIALS_DIR / material_id / "slides.json",
        EXAMPLES_DIR / material_id / "slides.json",
    ]
    for path in candidates:
        if path.is_file():
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(payload, dict):
                return payload
    return None


def _payload_from_layouts(layout_payload: Mapping[str, Any]) -> dict[str, Any]:
    pages = []
    for layout in layout_payload.get("page_layouts", []) or []:
        if not isinstance(layout, Mapping):
            continue
        pages.append(
            {
                "page_no": layout.get("page_no"),
                "title": layout.get("title") or "",
                "width": layout.get("width") or 12192000,
                "height": layout.get("height") or 6858000,
                "elements": [
                    {
                        **{
                            key: element.get(key)
                            for key in ("element_id", "kind", "bbox", "text", "name")
                        },
                        "math_text": None,
                        "chart_data": None,
                        "table_data": None,
                    }
                    for element in layout.get("elements", [])
                    if isinstance(element, Mapping)
                ],
            }
        )
    return {"pages": pages, "slides": pages}


def load_parse_payload(material_id: str) -> dict[str, Any]:
    """加载材料的解析快照（不修改原件，不依赖文件名推断内容）。"""

    if not _safe_material(material_id):
        return {"pages": [], "slides": []}
    recognized = _recognized_payload(material_id, {})
    recognition = (recognized or {}).get("image_recognition") or {}

    original = _original_path(material_id)
    if original is not None:
        try:
            stat = original.stat()
            payload = _parse_cached(str(original), stat.st_mtime_ns, stat.st_size)
        except OSError:
            payload = None
        if payload is not None:
            _attach_image_recognition(payload, recognition)
            return payload

    fixture = _fixture_payload(material_id)
    if fixture is not None:
        _attach_image_recognition(fixture, recognition)
        return fixture

    if recognized is not None:
        payload = _payload_from_layouts(recognized)
        _attach_image_recognition(payload, recognition)
        return payload

    return {"pages": [], "slides": []}


def _page_list(payload: Mapping[str, Any]) -> list[dict[str, Any]]:
    raw = payload.get("pages")
    if not isinstance(raw, list):
        raw = payload.get("slides")
    if not isinstance(raw, list):
        return []
    pages = []
    for page in raw:
        if not isinstance(page, Mapping):
            continue
        page_no = page.get("page_no")
        if isinstance(page_no, bool) or not isinstance(page_no, int) or page_no < 1:
            continue
        pages.append(dict(page))
    return pages


def _semantic_element(element: Mapping[str, Any]) -> dict[str, Any]:
    recognition = element.get("image_recognition")
    if isinstance(recognition, Mapping):
        image_text = str(recognition.get("text") or "")
        matrix = recognition.get("matrix")
    else:
        image_text = ""
        matrix = None
    return {
        "kind": element.get("kind"),
        "text": element.get("text"),
        "math_text": element.get("math_text"),
        "chart_data": element.get("chart_data"),
        "table_data": element.get("table_data"),
        "image_text": image_text[:8000],
        "matrix": matrix,
    }


def _semantic_scene(scene: Mapping[str, Any] | None) -> dict[str, Any]:
    if not isinstance(scene, Mapping):
        return {}
    pages = []
    for page in scene.get("pages", []):
        if not isinstance(page, Mapping):
            continue
        nodes = []
        for node in page.get("nodes", []):
            if not isinstance(node, Mapping) or node.get("deleted") or node.get("hidden"):
                continue
            nodes.append(
                {
                    "id": node.get("id"),
                    "type": node.get("type"),
                    "text": node.get("text"),
                    "table": node.get("table"),
                    "chart": node.get("chart"),
                    "interaction": node.get("interaction"),
                }
            )
        pages.append({"page_no": page.get("page_no"), "nodes": nodes})
    return {"pages": pages}


def build_source_snapshot(material_id: str, *, title: str = "") -> SourceSnapshot:
    payload = load_parse_payload(material_id)
    pages = _page_list(payload)
    scene = _scene_document(material_id)
    document_revision = int((scene or {}).get("revision") or payload.get("edit_revision") or 0)
    semantic_payload = {
        "title": title,
        "pages": [
            {
                "page_no": page.get("page_no"),
                "title": page.get("title"),
                "elements": [_semantic_element(element) for element in page.get("elements", []) if isinstance(element, Mapping)],
            }
            for page in pages
        ],
        "scene": _semantic_scene(scene),
    }
    source_hash = semantic_content_hash(semantic_payload)
    return SourceSnapshot(
        material_id=material_id,
        document_revision=document_revision,
        source_hash=source_hash,
        pages=pages,
        scene_document=scene,
        parse_payload=payload,
        page_count=len(pages),
        title=title,
    )


def source_version_of(snapshot: SourceSnapshot) -> int:
    return int(snapshot.document_revision)


def normalized_bbox(
    bbox: Mapping[str, Any],
    page_width: float,
    page_height: float,
    *,
    unit: str = "emu",
    scene_width: float | None = None,
    scene_height: float | None = None,
) -> BBox | None:
    """把 EMU 或场景像素 bbox 转成 0—1 坐标；非法值返回 ``None``。"""

    try:
        x = float(bbox.get("x", 0))
        y = float(bbox.get("y", 0))
        w = float(bbox.get("w", 0))
        h = float(bbox.get("h", 0))
    except (TypeError, ValueError):
        return None
    if unit == "scene":
        width = float(scene_width or page_width)
        height = float(scene_height or page_height)
    else:
        width = float(page_width)
        height = float(page_height)
    if width <= 0 or height <= 0 or w <= 0 or h <= 0:
        return None
    x0 = max(0.0, min(1.0, x / width))
    y0 = max(0.0, min(1.0, y / height))
    x1 = max(0.0, min(1.0, (x + w) / width))
    y1 = max(0.0, min(1.0, (y + h) / height))
    if x1 - x0 < 1e-6 or y1 - y0 < 1e-6:
        return None
    try:
        return BBox(x=x0, y=y0, w=x1 - x0, h=y1 - y0)
    except ValueError:
        return None


def page_dimensions(page: Mapping[str, Any], scene_page: Mapping[str, Any] | None = None) -> tuple[float, float]:
    width = page.get("width")
    height = page.get("height")
    if isinstance(width, (int, float)) and width > 0 and isinstance(height, (int, float)) and height > 0:
        return float(width), float(height)
    if scene_page:
        sw = scene_page.get("width")
        sh = scene_page.get("height")
        if isinstance(sw, (int, float)) and sw > 0 and isinstance(sh, (int, float)) and sh > 0:
            return float(sw), float(sh)
    return 12192000.0, 6858000.0


def now_iso() -> str:
    return to_iso(utc_now())


__all__ = [
    "build_source_snapshot",
    "load_parse_payload",
    "normalized_bbox",
    "page_dimensions",
    "semantic_content_hash",
    "source_version_of",
]
