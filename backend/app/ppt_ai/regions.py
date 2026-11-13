"""区域提取、覆盖表与按内容哈希的增量缓存。

核心原则：

- 页面是否已有交互动画不决定其他区域是否需要识别；
- 原生图表/表格/OMML 公式优先；图片文字走 OCR 证据，纯图片进入视觉/人工核对；
- 装饰图（整页背景、小图标）不伪造实验；
- 布局移动只更新区域 bbox 与 node_id，不改变语义哈希；内容变化才让相关缓存失效。
"""

from __future__ import annotations

import json
import logging
import math
import re
from pathlib import Path
from typing import Any, Callable, Mapping

from ..settings import DATA_DIR
from .evidence import build_anchor, build_provenance, evidence_item
from .source_snapshot import normalized_bbox, page_dimensions
from .types import (
    BBox,
    CoverageEntry,
    Region,
    RegionExtractionResult,
    RegionIssue,
    SourceSnapshot,
)
from .util import hash_json, semantic_content_hash, stable_id

logger = logging.getLogger(__name__)

EXTRACTOR_VERSION = "ppt-ai.regions.2"
CACHE_DIR = DATA_DIR / "ppt-ai" / "regions"

_MATH_CUES = ("∫", "∑", "√", "∞", "π", "sin", "cos", "tan", "log", "ln", "exp", "lim", "d/d", "∂")
_FORMULA_EQ = re.compile(r"[A-Za-zα-ωΑ-Ω]\s*[=<>]\s*[^=]")
_MATRIX = re.compile(
    r"(?:\[\s*\[.*?\]\s*,\s*\[.*?\]\s*\]|\[\s*-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?){2,}\s*\]|"
    r"\b\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s*;\s*\d+(?:\.\d+)?\s+\d+(?:\.\d+)?)"
)
_ALGORITHM = re.compile(r"(BFS|DFS|广度优先|深度优先|邻接|队列|queue|入队|出队|edge|edges|→|->)", re.I)
_DATA_STRUCTURE = re.compile(
    r"(栈|队列|push|pop|enqueue|dequeue|排序|冒泡|插入排序|bubble|insertion|链表|哈希|stack)", re.I
)
_PHYSICS = re.compile(
    r"(抛体|平抛|斜抛|projectile|弹簧|简谐|振动|spring|oscillat|重力加速度|初速度)", re.I
)
_NETWORK = re.compile(
    r"(神经网络|neural|MLP|感知机|激活函数|权重|前向|反向传播|\bReLU\b|softmax|sigmoid|tanh|卷积|池化|conv|pool)",
    re.I,
)
_OPTIMIZATION = re.compile(
    r"(梯度|gradient|最速下降|学习率|learning\s*rate|迭代|优化|minimi[sz]e|maximi[sz]e|最小二乘|least\s*squares|拟合|残差|牛顿法|newton)",
    re.I,
)
_CAPTION = re.compile(r"^\s*(图|表|Figure|Fig\.|Table|注[:：])", re.I)


def _page_text_blob(page: Mapping[str, Any]) -> str:
    parts: list[str] = []
    for element in page.get("elements", []):
        if not isinstance(element, Mapping):
            continue
        for key in ("text", "math_text"):
            value = element.get(key)
            if isinstance(value, str) and value.strip():
                parts.append(value.strip())
        chart = element.get("chart_data")
        if isinstance(chart, Mapping) and isinstance(chart.get("title"), str):
            parts.append(chart["title"])
    return "\n".join(parts)


def _looks_mathy(text: str) -> bool:
    if not text.strip():
        return False
    compact = re.sub(r"\s+", "", text)
    if any(cue in compact for cue in _MATH_CUES):
        return True
    if "=" in compact and re.search(r"[0-9]", compact):
        return True
    if re.search(r"[0-9]\s*[+\-*/^]\s*[0-9A-Za-z]", compact):
        return True
    if re.fullmatch(r"[A-Za-z]\s*\([A-Za-z0-9+\-*/^().,\s]+\)\s*=\s*.+", compact):
        return True
    return False


def _category_for_text(text: str) -> str:
    if _DATA_STRUCTURE.search(text):
        return "data_structure"
    if _PHYSICS.search(text):
        return "physics"
    if _ALGORITHM.search(text):
        return "algorithm"
    if _NETWORK.search(text):
        return "network"
    if _OPTIMIZATION.search(text):
        return "optimization"
    if _MATRIX.search(text):
        return "matrix"
    if _FORMULA_EQ.search(text) or any(cue in text for cue in _MATH_CUES):
        return "formula"
    return "text"


def _chart_semantic(data: Mapping[str, Any]) -> dict[str, Any]:
    categories = data.get("categories")
    series = data.get("series")
    return {
        "chart_type": data.get("chart_type"),
        "title": data.get("title"),
        "categories": [str(item) for item in categories] if isinstance(categories, list) else [],
        "series": [
            {
                "name": str(item.get("name") or ""),
                "values": [value for value in item.get("values", []) if isinstance(value, (int, float))],
            }
            for item in (series if isinstance(series, list) else [])
            if isinstance(item, Mapping)
        ],
    }


def _table_semantic(data: Mapping[str, Any]) -> dict[str, Any]:
    headers = data.get("headers")
    rows = data.get("rows")
    return {
        "headers": [str(item) for item in headers] if isinstance(headers, list) else [],
        "rows": [
            [str(cell) for cell in row]
            for row in (rows if isinstance(rows, list) else [])
            if isinstance(row, list)
        ][:200],
    }


def _chart_excerpt(data: Mapping[str, Any]) -> str:
    title = str(data.get("title") or "").strip()
    series = data.get("series")
    names = [str(item.get("name") or "").strip() for item in (series if isinstance(series, list) else []) if isinstance(item, Mapping)]
    names = [name for name in names if name]
    text = title or " / ".join(names)
    if not text:
        categories = data.get("categories")
        text = " / ".join(str(item) for item in (categories if isinstance(categories, list) else [])[:6])
    return text


def _element_semantic(element: Mapping[str, Any], node: Mapping[str, Any] | None) -> tuple[str, dict[str, Any], str, str]:
    """返回 ``(category, semantic, excerpt, source_kind)``。"""

    if node is not None:
        if isinstance(node.get("chart"), Mapping) and node.get("chart"):
            data = node["chart"]
            return "chart", {"chart": _chart_semantic(data), "text": _chart_excerpt(data)}, _chart_excerpt(data), "native"
        if isinstance(node.get("table"), list) and node.get("table"):
            data = {"headers": [], "rows": node["table"]}
            return "table", {"table": data, "text": " | ".join(str(c) for c in node["table"][0]) if node["table"] else ""}, (
                " | ".join(str(c) for c in node["table"][0]) if node["table"] else "表格"
            ), "native"
        node_text = str(node.get("text") or "")
        interaction = node.get("interaction")
        if isinstance(interaction, Mapping) and interaction.get("kind") == "formula":
            expression = interaction.get("expression") or node_text
            return "formula", {"formula": str(expression), "text": node_text}, str(expression), "user_input"

    chart = element.get("chart_data")
    if isinstance(chart, Mapping) and chart:
        return "chart", {"chart": _chart_semantic(chart), "text": _chart_excerpt(chart)}, _chart_excerpt(chart), "native"
    table = element.get("table_data")
    if isinstance(table, Mapping) and table:
        semantic = _table_semantic(table)
        headers = semantic["headers"]
        return "table", {"table": semantic, "text": " | ".join(headers)}, " | ".join(headers) or "表格", "native"
    math_text = element.get("math_text")
    text = str(element.get("text") or "")
    recognition = element.get("image_recognition")
    image_text = str(recognition.get("text") or "") if isinstance(recognition, Mapping) else ""
    matrix = recognition.get("matrix") if isinstance(recognition, Mapping) else None
    combined = "\n".join(part for part in (str(math_text or ""), text, image_text) if part.strip())
    if math_text:
        return "formula", {"formula": str(math_text), "text": combined[:4000]}, str(math_text), "native"
    kind = element.get("kind")
    if kind == "picture":
        if matrix:
            return "matrix", {"text": combined[:4000], "matrix": matrix}, combined or "矩阵图片", "ocr"
        ocr_text = image_text.strip() or text.strip()
        if ocr_text:
            category = _category_for_text(ocr_text)
            return category, {"text": combined[:4000], "formula": ocr_text if category == "formula" else None}, ocr_text, "ocr"
        return "image", {"text": ""}, str(element.get("name") or "图片"), "visual"
    if text.strip():
        category = _category_for_text(text)
        if category in ("data_structure", "physics", "algorithm", "network", "optimization") or _looks_mathy(text):
            formula = text if category == "formula" or _FORMULA_EQ.search(text) else None
            return category, {"text": text[:4000], "formula": formula}, text, "native"
    if kind in ("chart", "table"):
        return "unsupported", {"text": combined[:4000]}, combined[:160] or str(element.get("name") or ""), "native"
    if text.strip():
        return "text", {"text": text[:4000]}, text, "native"
    return "unsupported", {"text": ""}, str(element.get("name") or ""), "native"


def _node_semantic(node: Mapping[str, Any]) -> tuple[str, dict[str, Any], str, str]:
    text = str(node.get("text") or "")
    interaction = node.get("interaction")
    if isinstance(interaction, Mapping):
        if interaction.get("kind") == "formula":
            expression = str(interaction.get("expression") or text)
            return "formula", {"formula": expression, "text": text[:4000]}, expression, "user_input"
        if interaction.get("kind") == "chart" and isinstance(node.get("chart"), Mapping):
            data = node["chart"]
            return "chart", {"chart": _chart_semantic(data), "text": _chart_excerpt(data)}, _chart_excerpt(data), "user_input"
    if isinstance(node.get("chart"), Mapping) and node.get("chart"):
        data = node["chart"]
        return "chart", {"chart": _chart_semantic(data), "text": _chart_excerpt(data)}, _chart_excerpt(data), "native"
    if isinstance(node.get("table"), list) and node.get("table"):
        headers = node["table"][0] if node["table"] else []
        return "table", {"table": {"headers": [], "rows": node["table"]}, "text": " | ".join(str(c) for c in headers)}, (
            " | ".join(str(c) for c in headers) or "表格"
        ), "native"
    if text.strip():
        category = _category_for_text(text)
        if category in ("data_structure", "physics", "algorithm", "network", "optimization") or _looks_mathy(text):
            formula = text if category == "formula" or _FORMULA_EQ.search(text) else None
            return category, {"text": text[:4000], "formula": formula}, text, "native"
    return "unsupported", {"text": text[:4000]}, text, "native"


def _scene_page_map(scene: Mapping[str, Any] | None) -> dict[int, Mapping[str, Any]]:
    result: dict[int, Mapping[str, Any]] = {}
    if not isinstance(scene, Mapping):
        return result
    for page in scene.get("pages", []):
        if isinstance(page, Mapping) and isinstance(page.get("page_no"), int):
            result[page["page_no"]] = page
    return result


def _element_node_map(scene_page: Mapping[str, Any] | None) -> dict[str, Mapping[str, Any]]:
    result: dict[str, Mapping[str, Any]] = {}
    if not scene_page:
        return result
    for node in scene_page.get("nodes", []):
        if not isinstance(node, Mapping):
            continue
        source = node.get("source_element_id")
        if isinstance(source, str) and source:
            result[source] = node
    return result


def _scene_bbox(node: Mapping[str, Any], scene_page: Mapping[str, Any]) -> BBox | None:
    width = scene_page.get("width")
    height = scene_page.get("height")
    if not isinstance(width, (int, float)) or not isinstance(height, (int, float)) or width <= 0 or height <= 0:
        return None
    x = float(node.get("x", 0))
    y = float(node.get("y", 0))
    w = float(node.get("width", 0))
    h = float(node.get("height", 0))
    rotation = math.radians(float(node.get("rotation", 0) or 0))
    cx, cy = x + w / 2, y + h / 2
    points = []
    for px, py in ((x, y), (x + w, y), (x + w, y + h), (x, y + h)):
        points.append(
            (
                cx + (px - cx) * math.cos(rotation) - (py - cy) * math.sin(rotation),
                cy + (px - cx) * math.sin(rotation) + (py - cy) * math.cos(rotation),
            )
        )
    left = min(point[0] for point in points)
    top = min(point[1] for point in points)
    right = max(point[0] for point in points)
    bottom = max(point[1] for point in points)
    return normalized_bbox(
        {"x": left, "y": top, "w": right - left, "h": bottom - top},
        width,
        height,
        unit="scene",
        scene_width=width,
        scene_height=height,
    )


def _union_bbox(first: BBox, second: BBox) -> BBox:
    x0 = min(first.x, second.x)
    y0 = min(first.y, second.y)
    x1 = max(first.x + first.w, second.x + second.w)
    y1 = max(first.y + first.h, second.y + second.h)
    return BBox(x=x0, y=y0, w=max(1e-6, min(1 - x0, x1 - x0)), h=max(1e-6, min(1 - y0, y1 - y0)))


def _is_decorative(element: Mapping[str, Any], bbox: BBox | None) -> bool:
    if element.get("kind") != "picture":
        return False
    if bbox is None:
        return False
    area = bbox.w * bbox.h
    if area >= 0.9:
        return True
    if area <= 0.0015 and not str(element.get("text") or "").strip():
        return True
    return False


def _region_from_parts(
    *,
    snapshot: SourceSnapshot,
    page_no: int,
    bbox: BBox,
    category: str,
    state: str,
    semantic: dict[str, Any],
    excerpt: str,
    source_kind: str,
    element_id: str | None,
    node_id: str | None,
    method: str,
    issues: list[RegionIssue],
) -> Region:
    content_hash = semantic_content_hash({"category": category, "semantic": semantic})
    anchor = build_anchor(
        material_id=snapshot.material_id,
        page=page_no,
        bbox=bbox,
        excerpt=excerpt,
        source_version=snapshot.document_revision,
        semantic_hash=content_hash,
        node_id=node_id,
        element_id=element_id,
    )
    origin = source_kind if source_kind in ("native", "ocr", "user_input") else "model_inference"
    provenance = build_provenance(
        origin,
        evidence=excerpt,
        inference="" if source_kind in ("native", "ocr", "user_input") else "仅检测到图片/图形，需要视觉理解或人工核对",
        method=method,
    )
    region_id = stable_id("region", page_no, element_id or node_id, content_hash)
    return Region(
        region_id=region_id,
        page_no=page_no,
        node_ids=[node_id] if node_id else [],
        element_ids=[element_id] if element_id else [],
        bbox=bbox,
        category=category,
        extraction_state=state,  # type: ignore[arg-type]
        evidence=[
            evidence_item(
                "native" if source_kind == "native" else "ocr" if source_kind == "ocr" else "model",
                method,
                excerpt,
                element_id=element_id,
            )
        ],
        issues=issues,
        semantic_content_hash=content_hash,
        provenance=provenance,
        semantic=semantic,
    )


def _attach_caption(
    region: Region,
    candidates: list[tuple[Mapping[str, Any], BBox]],
    used: set[str],
) -> Region:
    if region.category not in ("formula", "chart", "table", "matrix"):
        return region
    for element, bbox in candidates:
        element_id = str(element.get("element_id") or "")
        if not element_id or element_id in used:
            continue
        text = str(element.get("text") or "").strip()
        if not text or len(text) > 160 or not _CAPTION.match(text):
            continue
        gap = bbox.y - (region.bbox.y + region.bbox.h)
        overlap = min(bbox.x + bbox.w, region.bbox.x + region.bbox.w) - max(bbox.x, region.bbox.x)
        if not (-0.02 <= gap <= 0.06) or overlap < min(bbox.w, region.bbox.w) * 0.4:
            continue
        used.add(element_id)
        region.element_ids.append(element_id)
        region.bbox = _union_bbox(region.bbox, bbox)
        region.semantic["caption"] = text[:500]
        region.semantic_content_hash = semantic_content_hash(
            {"category": region.category, "semantic": region.semantic}
        )
        return region
    return region


def _cache_key(page_no: int, element_id: str, semantic_hash: str) -> str:
    return f"{page_no}:{element_id}:{semantic_hash}"


def load_region_cache(material_id: str) -> dict[str, Any]:
    path = CACHE_DIR / f"{material_id}.json"
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return payload if isinstance(payload, dict) else {}


def save_region_cache(material_id: str, cache: Mapping[str, Any]) -> None:
    path = CACHE_DIR / f"{material_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def extract_regions(
    snapshot: SourceSnapshot,
    *,
    cache: Mapping[str, Any] | None = None,
    math_ocr: Callable[[int, Mapping[str, Any]], str | None] | None = None,
    cache_out: dict[str, Any] | None = None,
) -> RegionExtractionResult:
    pages = snapshot.pages if isinstance(snapshot.pages, list) else []
    scene_pages = _scene_page_map(snapshot.scene_document)
    cache = dict(cache or {})
    new_cache: dict[str, Any] = {}
    regions: list[Region] = []
    coverage: list[CoverageEntry] = []
    global_issues: list[RegionIssue] = []

    for page in pages:
        page_no = page.get("page_no")
        if not isinstance(page_no, int) or page_no < 1:
            continue
        scene_page = scene_pages.get(page_no)
        width, height = page_dimensions(page, scene_page)
        element_nodes = _element_node_map(scene_page)
        coverage_entry = CoverageEntry(page_no=page_no)
        used_elements: set[str] = set()
        caption_candidates: list[tuple[Mapping[str, Any], BBox]] = []

        for element in page.get("elements", []):
            if not isinstance(element, Mapping):
                continue
            element_id = str(element.get("element_id") or "")
            node = element_nodes.get(element_id) if element_id else None
            if node is not None and (node.get("deleted") or node.get("hidden")):
                if element_id:
                    coverage_entry.skipped.append(element_id)
                continue
            bbox = _scene_bbox(node, scene_page) if node is not None and scene_page else None
            if bbox is None:
                raw_bbox = element.get("bbox")
                if isinstance(raw_bbox, Mapping):
                    bbox = normalized_bbox(raw_bbox, width, height, unit="emu")
            if bbox is None:
                continue
            if _is_decorative(element, bbox):
                if element_id:
                    coverage_entry.skipped.append(element_id)
                continue
            if element.get("kind") == "text" and _CAPTION.match(str(element.get("text") or "")):
                caption_candidates.append((element, bbox))
                if element_id:
                    coverage_entry.skipped.append(element_id)
                continue

            category, semantic, excerpt, source_kind = _element_semantic(element, node)
            if category in ("unsupported", "text") and node is None:
                # 普通标题/段落不生成交互区域，但在覆盖表里保留为原生已读取。
                if element_id:
                    coverage_entry.native.append(element_id)
                continue
            if category == "unsupported":
                if element_id:
                    coverage_entry.skipped.append(element_id)
                continue

            if math_ocr is not None and element.get("kind") == "picture" and source_kind == "visual":
                try:
                    extra = math_ocr(page_no, element)
                except Exception:  # noqa: BLE001 - OCR 失败不拖垮区域提取
                    extra = None
                if extra and extra.strip():
                    semantic = {**semantic, "text": extra[:4000], "formula": extra if _looks_mathy(extra) else None}
                    excerpt = extra
                    category = _category_for_text(extra)
                    source_kind = "ocr"

            state = {
                "native": "native",
                "ocr": "ocr",
                "user_input": "native",
                "visual": "visual",
            }.get(source_kind, "manual_review")
            issues: list[RegionIssue] = []
            if state == "visual":
                issues.append(
                    RegionIssue(
                        code="requires_visual_understanding",
                        message="该区域只有图片，未读到可核验文字；需视觉理解或人工核对后才能执行。",
                        severity="warn",
                    )
                )
                coverage_entry.visual.append(element_id or stable_id("region", page_no, bbox.x, bbox.y))
            elif state == "ocr":
                coverage_entry.ocr.append(element_id or stable_id("region", page_no, bbox.x, bbox.y))
            else:
                coverage_entry.native.append(element_id or stable_id("region", page_no, bbox.x, bbox.y))

            cache_key = _cache_key(page_no, element_id or bbox.x, semantic_content_hash({"category": category, "semantic": semantic}))
            cached = cache.get(cache_key)
            if isinstance(cached, Mapping):
                semantic = cached.get("semantic", semantic)
                excerpt = str(cached.get("excerpt") or excerpt)
                issues = [RegionIssue(**item) for item in cached.get("issues", []) if isinstance(item, Mapping)]
            new_cache[cache_key] = {
                "semantic": semantic,
                "excerpt": excerpt,
                "category": category,
                "issues": [issue.model_dump(mode="json") for issue in issues],
                "extractor_version": EXTRACTOR_VERSION,
            }

            region = _region_from_parts(
                snapshot=snapshot,
                page_no=page_no,
                bbox=bbox,
                category=category,
                state=state,
                semantic=semantic,
                excerpt=excerpt,
                source_kind=source_kind,
                element_id=element_id or None,
                node_id=str(node.get("id")) if node is not None and node.get("id") else None,
                method=str(
                    (element.get("recognition_method") if isinstance(element.get("recognition_method"), str) else "")
                    or ("pptx_native" if source_kind == "native" else "local_ocr" if source_kind == "ocr" else "image_context")
                ),
                issues=issues,
            )
            regions.append(region)
            if element_id:
                used_elements.add(element_id)

        # 用户新增/修改的场景节点（没有对应源元素）单独提区。
        for node in scene_page.get("nodes", []) if scene_page else []:
            if not isinstance(node, Mapping) or node.get("deleted") or node.get("hidden"):
                continue
            if node.get("source_element_id"):
                continue
            category, semantic, excerpt, source_kind = _node_semantic(node)
            if category == "unsupported":
                continue
            bbox = _scene_bbox(node, scene_page) if scene_page else None
            if bbox is None:
                continue
            node_id = str(node.get("id") or "")
            region = _region_from_parts(
                snapshot=snapshot,
                page_no=page_no,
                bbox=bbox,
                category=category,
                state="native",
                semantic=semantic,
                excerpt=excerpt,
                source_kind=source_kind,
                element_id=None,
                node_id=node_id or None,
                method="scene_node",
                issues=[],
            )
            regions.append(region)
            coverage_entry.native.append(node_id or region.region_id)

        # 图注只并入紧邻的公式/图表/表格区域；不吞掉普通正文。
        for region in [item for item in regions if item.page_no == page_no]:
            _attach_caption(region, caption_candidates, used_elements)

        if (
            coverage_entry.native
            or coverage_entry.ocr
            or coverage_entry.visual
            or coverage_entry.manual_review
            or coverage_entry.skipped
        ):
            coverage.append(coverage_entry)

    if not regions:
        global_issues.append(
            RegionIssue(
                code="no_interactive_regions",
                message="未发现可执行交互的区域；原页仍可正常阅读。",
                severity="info",
            )
        )

    if cache_out is not None:
        cache_out.update(new_cache)
    return RegionExtractionResult(
        regions=regions,
        coverage=coverage,
        coordinate_system={
            "bbox_unit": "normalized",
            "page_width_unit": "top_left_origin",
            "target": "original_page",
            "notes": "EMU 与场景像素坐标在提取层统一为相对页面的 0—1 坐标；布局移动只更新 bbox。",
        },
        issues=global_issues,
        source_hash=snapshot.source_hash,
        source_revision=snapshot.document_revision,
    )


__all__ = [
    "CACHE_DIR",
    "EXTRACTOR_VERSION",
    "extract_regions",
    "load_region_cache",
    "save_region_cache",
]
