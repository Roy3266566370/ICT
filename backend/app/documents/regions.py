"""Deterministic page-region extraction for living pages.

The living page keeps the original page image as the fidelity floor.  This
module adds the missing element layer: normalized bounding boxes, cropped
assets, captions and a conservative region kind.  No model calls happen here.

Bounding boxes are normalized to ``0..1`` so the same coordinates survive any
preview resize or CSS width.  Crops are written next to the page previews and
must be whitelisted by ``living.store.asset_keys`` before they can be served.
"""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any, Sequence

from PIL import Image

MAX_REGIONS_PER_PAGE = 8
MAX_FORMULA_REGIONS = 3
MAX_REGION_TEXT = 2000
MAX_REGION_LABELS = 8
MAX_LABEL_TEXT = 40
MIN_AREA_RATIO = 0.01
MAX_AREA_RATIO = 0.90
REGION_PADDING_PX = 3

_MATH_SIGNAL = re.compile(r"[=^_∫∑∏√≤≥≈]|\\frac|\\sqrt")
_MATH_FONT = re.compile(r"(cm|math|symbol|mtmi|mtsy|stix|euler)", re.I)
_CJK = re.compile(r"[\u4e00-\u9fff]")
_DIAGRAM_WORDS = (
    "流程", "架构", "结构", "模块", "网络", "编码", "解码", "输入", "输出",
    "步骤", "开始", "结束", "判断", "循环", "注意力", "训练", "推理",
    "编码器", "解码器", "卷积", "池化", "线性层", "→", "->",
)
_INLINE_LATEX = re.compile(r"\$\$(.+?)\$\$|\$(.+?)\$|\\\[(.+?)\\\]", re.S)


def _finite(value: Any) -> bool:
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError, OverflowError):
        return False


def _normalize_box(box: Sequence[Any], width: float, height: float) -> list[float] | None:
    if width <= 0 or height <= 0 or len(box) < 4:
        return None
    values = [float(value) for value in box[:4]]
    if not all(math.isfinite(value) for value in values):
        return None
    x0, y0, x1, y1 = (values[0] / width, values[1] / height,
                      values[2] / width, values[3] / height)
    x0, x1 = sorted((x0, x1))
    y0, y1 = sorted((y0, y1))
    x0, y0 = max(0.0, x0), max(0.0, y0)
    x1, y1 = min(1.0, x1), min(1.0, y1)
    if x1 - x0 < 0.004 or y1 - y0 < 0.004:
        return None
    return [round(x0, 6), round(y0, 6), round(x1, 6), round(y1, 6)]


def _area(box: Sequence[float]) -> float:
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])


def _iou(left: Sequence[float], right: Sequence[float]) -> float:
    x0, y0 = max(left[0], right[0]), max(left[1], right[1])
    x1, y1 = min(left[2], right[2]), min(left[3], right[3])
    if x1 <= x0 or y1 <= y0:
        return 0.0
    intersection = (x1 - x0) * (y1 - y0)
    union = _area(left) + _area(right) - intersection
    return intersection / union if union > 0 else 0.0


def _contained(inner: Sequence[float], outer: Sequence[float]) -> float:
    area = _area(inner)
    if area <= 0:
        return 0.0
    x0, y0 = max(inner[0], outer[0]), max(inner[1], outer[1])
    x1, y1 = min(inner[2], outer[2]), min(inner[3], outer[3])
    if x1 <= x0 or y1 <= y0:
        return 0.0
    return ((x1 - x0) * (y1 - y0)) / area


def _pixel_box(box: Sequence[float], width: int, height: int, *, pad: int = REGION_PADDING_PX) -> tuple[int, int, int, int]:
    x0 = max(0, int(round(box[0] * width)) - pad)
    y0 = max(0, int(round(box[1] * height)) - pad)
    x1 = min(width, int(round(box[2] * width)) + pad)
    y1 = min(height, int(round(box[3] * height)) + pad)
    return x0, y0, x1, y1


def _save_crop(image: Image.Image, lab_dir: Path, key: str, box: Sequence[float],
               *, pad: int = REGION_PADDING_PX) -> str | None:
    pixel = _pixel_box(box, image.width, image.height, pad=pad)
    if pixel[2] - pixel[0] < 8 or pixel[3] - pixel[1] < 8:
        return None
    crop = image.crop(pixel).convert("RGB")
    analysis = lab_dir / "analysis" / "regions" / f"{key}.png"
    analysis.parent.mkdir(parents=True, exist_ok=True)
    crop.save(analysis, format="PNG", compress_level=3)
    preview = crop
    if preview.width > 1400:
        ratio = 1400 / preview.width
        preview = preview.resize((1400, max(1, int(preview.height * ratio))), Image.LANCZOS)
    target = lab_dir / "previews" / f"{key}.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    preview.save(target, format="PNG", compress_level=3)
    return key


def _plausible_caption(text: str) -> bool:
    content = (text or "").strip()
    if len(content) < 2:
        return False
    if re.fullmatch(r"\d+\s*/\s*\d+", content):
        return False
    if re.fullmatch(r"[第]?\s*\d+\s*[页頁]?", content):
        return False
    if re.fullmatch(r"[\d\s.,:：%×xX/·\-—–→⇒=]+", content):
        return False
    if (content.isupper() and not _CJK.search(content) and len(content) <= 40
            and not content.startswith(("FIGURE", "TABLE"))):
        return False
    return True


def _first_line(text: str, limit: int = 80) -> str:
    line = next((part.strip() for part in (text or "").splitlines()
                 if part.strip() and _plausible_caption(part)), "")
    return line[:limit]


def _join_text(parts: Sequence[str], limit: int = MAX_REGION_TEXT) -> str:
    return "\n".join(part.strip() for part in parts if part and part.strip())[:limit]


def _looks_like_diagram(text: str) -> bool:
    content = (text or "").strip()
    if len(content) < 4:
        return False
    lowered = content.lower()
    if any(word in lowered for word in _DIAGRAM_WORDS):
        return True
    return content.count("\n") >= 2 and len(content) >= 12


def _latex_from_text(text: str) -> str | None:
    match = _INLINE_LATEX.search(text or "")
    if match is None:
        return None
    value = next((group for group in match.groups() if group), "").strip()
    return value[:4000] or None


def _relative_box(inner: Sequence[float], outer: Sequence[float]) -> list[float] | None:
    """子框换算到区域裁剪坐标（0..1 相对 outer），供标签热区定位。"""
    width = outer[2] - outer[0]
    height = outer[3] - outer[1]
    if width <= 0 or height <= 0:
        return None
    x0 = max(0.0, min(1.0, (inner[0] - outer[0]) / width))
    y0 = max(0.0, min(1.0, (inner[1] - outer[1]) / height))
    x1 = max(0.0, min(1.0, (inner[2] - outer[0]) / width))
    y1 = max(0.0, min(1.0, (inner[3] - outer[1]) / height))
    if x1 - x0 < 0.01 or y1 - y0 < 0.01:
        return None
    return [round(x0, 6), round(y0, 6), round(x1, 6), round(y1, 6)]


def _label_entry(text: str, inner: Sequence[float], outer: Sequence[float]) -> dict[str, Any] | None:
    content = _first_line(text, MAX_LABEL_TEXT)
    if not content:
        return None
    box = _relative_box(inner, outer)
    if box is None or _area(box) > 0.7:
        return None
    return {"text": content, "bbox": box}


def _dedupe_labels(labels: list[dict[str, Any]], limit: int = MAX_REGION_LABELS) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for label in sorted(labels, key=lambda item: (item["bbox"][1], item["bbox"][0])):
        key = label["text"].strip().lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(label)
        if len(out) >= limit:
            break
    return out


def _accepts(regions: Sequence[dict[str, Any]], box: Sequence[float]) -> bool:
    for existing in regions:
        if _iou(box, existing["bbox"]) > 0.55 or _contained(box, existing["bbox"]) > 0.82:
            return False
    return True


def _cap_regions(regions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(regions) <= MAX_REGIONS_PER_PAGE:
        return sorted(regions, key=lambda item: (item["bbox"][1], item["bbox"][0]))
    ranked = sorted(
        regions,
        key=lambda item: (float(item.get("confidence") or 0) * max(0.01, _area(item["bbox"])), _area(item["bbox"])),
        reverse=True,
    )[:MAX_REGIONS_PER_PAGE]
    return sorted(ranked, key=lambda item: (item["bbox"][1], item["bbox"][0]))


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------


def _pdf_text_blocks(page: Any) -> list[dict[str, Any]]:
    try:
        raw_blocks = page.get_text("dict").get("blocks", [])
    except Exception:  # noqa: BLE001 - 文字层异常不影响图形区域
        return []
    blocks: list[dict[str, Any]] = []
    for block in raw_blocks:
        if not isinstance(block, dict) or block.get("type") != 0:
            continue
        try:
            box = [float(value) for value in block.get("bbox", [])]
        except (TypeError, ValueError):
            continue
        if len(box) != 4:
            continue
        lines: list[str] = []
        fonts: set[str] = set()
        for line in block.get("lines", []) or []:
            text = "".join(str(span.get("text") or "") for span in line.get("spans", []) or [])
            if text.strip():
                lines.append(text)
            for span in line.get("spans", []) or []:
                font = span.get("font")
                if isinstance(font, str) and font:
                    fonts.add(font)
        text = "\n".join(lines).strip()
        if not text:
            continue
        blocks.append({"bbox": box, "text": text, "fonts": sorted(fonts),
                       "lines": len(lines)})
    return blocks


def _norm_block(box: Sequence[float], width: float, height: float) -> list[float] | None:
    return _normalize_box(box, width, height)


def _caption_for_box(box: Sequence[float], blocks: Sequence[dict[str, Any]],
                     width: float, height: float) -> str:
    best: tuple[float, str] | None = None
    for block in blocks:
        if not _plausible_caption(str(block.get("text") or "")):
            continue
        other = _norm_block(block["bbox"], width, height)
        if other is None:
            continue
        if _contained(other, box) > 0.5:
            continue
        if other[1] > 0.90 or other[3] > 0.975 or other[3] - other[1] > 0.10:
            continue  # 页脚/正文段不是图注
        gap = other[1] - box[3]
        if gap < -0.004 or gap > 0.055:
            continue
        overlap = min(other[2], box[2]) - max(other[0], box[0])
        if overlap < min(other[2] - other[0], box[2] - box[0]) * 0.25:
            continue
        if best is None or gap < best[0]:
            best = (gap, block["text"])
    return _first_line(best[1], 300) if best else ""


def _pdf_labels(page: Any, box: Sequence[float], width: float,
                height: float) -> list[dict[str, Any]]:
    """区域内文字层行 → 标签热区（相对裁剪图归一化）。

    矢量图示的标签本来就在文字层里，直接取行级 bbox 比再跑一次 OCR 准确。
    """
    rect = (box[0] * width, box[1] * height, box[2] * width, box[3] * height)
    try:
        raw = page.get_text("dict", clip=rect)
    except Exception:  # noqa: BLE001 - 标签缺失不阻断区域
        return []
    labels: list[dict[str, Any]] = []
    for block in raw.get("blocks", []) or []:
        if not isinstance(block, dict) or block.get("type") != 0:
            continue
        for line in block.get("lines", []) or []:
            spans = line.get("spans", []) or []
            text = "".join(str(span.get("text") or "") for span in spans).strip()
            if not text or len(text) > MAX_LABEL_TEXT:
                continue
            line_box = line.get("bbox")
            if not isinstance(line_box, (list, tuple)) or len(line_box) < 4:
                continue
            normalized = _norm_block(
                [float(line_box[0]), float(line_box[1]),
                 float(line_box[2]), float(line_box[3])],
                width, height,
            )
            if normalized is None or _contained(normalized, box) < 0.5:
                continue
            entry = _label_entry(text, normalized, box)
            if entry is not None:
                labels.append(entry)
    return _dedupe_labels(labels)


def _formula_score(block: dict[str, Any], width: float, height: float) -> float:
    text = str(block.get("text") or "")
    compact = re.sub(r"\s+", "", text)
    if not compact or len(compact) > 300:
        return 0.0
    box = block["bbox"]
    box_width = max(1.0, float(box[2] - box[0]))
    box_height = max(1.0, float(box[3] - box[1]))
    if box_width < width * 0.04 or box_height < height * 0.012:
        return 0.0
    if box_width * box_height > width * height * 0.35:
        return 0.0
    if int(block.get("lines") or 0) > 4:
        return 0.0
    cjk = len(_CJK.findall(compact))
    if cjk > 8:
        return 0.0
    signal = bool(_MATH_SIGNAL.search(text))
    font_hit = any(_MATH_FONT.search(font) for font in block.get("fonts") or [])
    if not signal and not font_hit:
        return 0.0
    math_chars = sum(
        1 for char in compact
        if char in "=+-−×÷^_∫∑∏√∞≤≥≠≈→←↔()[]{}<>|/\\"
        or char in "αβγδθλμπσφω"
        or char.isdigit()
    )
    ratio = math_chars / len(compact)
    if not signal and ratio < 0.25:
        return 0.0
    score = 0.35 + ratio * 0.45 + (0.12 if font_hit else 0.0)
    return min(0.95, score)


def regions_for_pdf_page(page: Any, image: Image.Image, lab_dir: Path,
                         file_id: str, page_no: int) -> list[dict[str, Any]]:
    """Extract conservative interactive regions from one PDF page."""

    try:
        width, height = float(page.rect.width), float(page.rect.height)
    except Exception:  # noqa: BLE001
        return []
    if width <= 0 or height <= 0 or image.width <= 0 or image.height <= 0:
        return []

    text_blocks = _pdf_text_blocks(page)
    regions: list[dict[str, Any]] = []
    counter = 0

    def add(kind: str, box: Sequence[float], *, source: str, text: str = "",
            caption: str = "", label: str = "", confidence: float = 0.5,
            latex: str | None = None,
            labels: list[dict[str, Any]] | None = None) -> None:
        nonlocal counter
        if not _accepts(regions, box):
            return
        counter += 1
        key = f"{file_id}_p{page_no}_r{counter}"
        if _save_crop(image, lab_dir, key, box) is None:
            return
        regions.append({
            "id": key,
            "kind": kind,
            "bbox": [round(float(value), 6) for value in box],
            "asset_id": key,
            "label": (label or "图示")[:200],
            "caption": caption[:300],
            "text": text[:MAX_REGION_TEXT],
            "source": source,
            "confidence": round(max(0.0, min(1.0, confidence)), 3),
            "latex": latex,
            "labels": labels or [],
            "block_id": None,
        })

    # Vector diagrams and charts.  cluster_drawings joins neighbouring paths;
    # the ratio guard drops full-page borders and tiny decorative rules.
    try:
        clusters = page.cluster_drawings()
    except Exception:  # noqa: BLE001
        clusters = []
    for rect_like in clusters or []:
        try:
            x0, y0, x1, y1 = (float(rect_like[0]), float(rect_like[1]),
                              float(rect_like[2]), float(rect_like[3]))
        except (TypeError, ValueError, IndexError):
            continue
        box = _normalize_box([x0, y0, x1, y1], width, height)
        if box is None:
            continue
        area = _area(box)
        if area < 0.02 or area > MAX_AREA_RATIO:
            continue
        if box[2] - box[0] < 0.08 or box[3] - box[1] < 0.05:
            continue
        if box[3] < 0.06 or box[1] > 0.94:
            continue
        try:
            text = page.get_text("text", clip=(x0, y0, x1, y1)).strip()
        except Exception:  # noqa: BLE001
            text = ""
        if not text and area < 0.05:
            continue
        caption = _caption_for_box(box, text_blocks, width, height)
        kind = "diagram" if _looks_like_diagram(text) or _looks_like_diagram(caption) else "figure"
        if (kind == "figure" and text and "\n" not in text and len(text) <= 40
                and box[3] - box[1] < 0.15):
            # 单行标题框/装饰横幅不是可操作图示。
            continue
        add(kind, box, source="pdf_vector", text=text, caption=caption,
            label=_first_line(caption or text) or "矢量图",
            confidence=0.62 if text else 0.5,
            labels=_pdf_labels(page, box, width, height))

    # Raster figures.  Full-page scans/backgrounds stay represented by the
    # page image itself and are not turned into a second full-page hotspot.
    try:
        images = page.get_image_info()
    except Exception:  # noqa: BLE001
        images = []
    for info in images or []:
        if not isinstance(info, dict):
            continue
        try:
            box = _normalize_box(info.get("bbox", []), width, height)
        except (TypeError, ValueError):
            box = None
        if box is None:
            continue
        area = _area(box)
        if area < 0.02 or area > 0.85:
            continue
        if box[2] - box[0] < 0.06 or box[3] - box[1] < 0.06:
            continue
        if box[3] < 0.06 or box[1] > 0.94:
            continue
        if any(_iou(box, existing["bbox"]) > 0.5 for existing in regions):
            continue
        caption = _caption_for_box(box, text_blocks, width, height)
        kind = "diagram" if _looks_like_diagram(caption) else "figure"
        add(kind, box, source="pdf_image", text=caption, caption=caption,
            label=_first_line(caption) or "插图", confidence=0.58)

    # Formula candidates stay local (a crop + text), never a whole-page OCR.
    formula_count = 0
    for block in text_blocks:
        if formula_count >= MAX_FORMULA_REGIONS:
            break
        score = _formula_score(block, width, height)
        if score <= 0:
            continue
        box = _norm_block(block["bbox"], width, height)
        if box is None:
            continue
        if any(_contained(box, existing["bbox"]) > 0.7 for existing in regions):
            continue
        before = len(regions)
        add("formula", box, source="pdf_text_math", text=block["text"],
            label="公式", confidence=score, latex=_latex_from_text(block["text"]))
        if len(regions) > before:
            formula_count += 1

    return _cap_regions(regions)


# ---------------------------------------------------------------------------
# PPTX
# ---------------------------------------------------------------------------


def _pptx_text(shape: Any) -> str:
    try:
        if getattr(shape, "has_text_frame", False):
            return str(shape.text_frame.text or "").strip()
    except Exception:  # noqa: BLE001
        pass
    return ""


def _pptx_box(bbox: dict[str, Any], slide_w: float, slide_h: float) -> list[float] | None:
    if slide_w <= 0 or slide_h <= 0:
        return None
    try:
        return _normalize_box(
            [bbox.get("x", 0), bbox.get("y", 0),
             float(bbox.get("x", 0)) + float(bbox.get("w", 0)),
             float(bbox.get("y", 0)) + float(bbox.get("h", 0))],
            slide_w, slide_h,
        )
    except (TypeError, ValueError):
        return None


def _pptx_caption(box: Sequence[float], entries: Sequence[dict[str, Any]],
                  slide_w: float, slide_h: float) -> str:
    return _caption_for_box(
        box,
        [{"bbox": [entry["bbox"][0], entry["bbox"][1],
                   entry["bbox"][0] + entry["bbox"][2],
                   entry["bbox"][1] + entry["bbox"][3]], "text": entry["text"]}
         for entry in entries if entry["text"]],
        slide_w, slide_h,
    )


def _pptx_labels(box: Sequence[float], entries: Sequence[dict[str, Any]],
                 *, descendants_of: int | None = None) -> list[dict[str, Any]]:
    """区域内部文本框 → 标签热区（相对裁剪图归一化）。

    组合图示只收其后代形状；图片/松散图示收落入框内的自由文本框。
    """
    labels: list[dict[str, Any]] = []
    for item in entries:
        if descendants_of is not None and item["shape_index"] != descendants_of:
            continue
        inner = item["box"]
        text = str(item.get("text") or "").strip()
        if not text or inner is None or _contained(inner, box) < 0.5:
            continue
        entry = _label_entry(text, inner, box)
        if entry is not None:
            labels.append(entry)
    return _dedupe_labels(labels)


_PPTX_AUTO_SHAPES: dict[str, str] = {}


def _shape_kind(shape: Any) -> str:
    """autoshape → 流程图节点形状；非 autoshape → rect。"""
    if not _PPTX_AUTO_SHAPES:
        try:
            from pptx.enum.shapes import MSO_SHAPE
            _PPTX_AUTO_SHAPES.update({
                str(MSO_SHAPE.DIAMOND): "diamond",
                str(MSO_SHAPE.OVAL): "oval",
                str(MSO_SHAPE.ROUNDED_RECTANGLE): "rounded",
                str(MSO_SHAPE.SNIP_ROUNDED_RECTANGLE): "rounded",
            })
        except Exception:  # noqa: BLE001
            _PPTX_AUTO_SHAPES[""] = "rect"
    try:
        return _PPTX_AUTO_SHAPES.get(str(shape.auto_shape_type), "rect")
    except Exception:  # noqa: BLE001
        return "rect"


_DRAWING_NS = "{http://schemas.openxmlformats.org/drawingml/2006/main}"


def _open_arrow_path(element: Any) -> Any:
    if element is None:
        return None
    for end in ("headEnd", "tailEnd"):
        marker = element.find(".//" + _DRAWING_NS + end)
        if marker is not None and marker.get("type") not in (None, "none"):
            break
    else:
        return None
    paths = element.findall(".//" + _DRAWING_NS + "custGeom/" + _DRAWING_NS
                            + "pathLst/" + _DRAWING_NS + "path")
    if len(paths) == 1 and paths[0].find(_DRAWING_NS + "close") is None:
        return paths[0]
    return None


def _connector_ends(entry: dict[str, Any], slide_w: float,
                    slide_h: float) -> dict[str, Any] | None:
    """连接线 → 幻灯片级 0..1 端点 + 可选精确连接点（stCxn/endCxn 形状 id）。

    没有连接点时用连接线自身 bbox + ``flipH/flipV`` 近似首尾。
    """
    element = entry["shape"].element
    ends: dict[str, Any] = {}
    try:
        from ..parsers.pptx_parser import _A_NS
        st = element.find(".//" + _A_NS + "stCxn")
        ed = element.find(".//" + _A_NS + "endCxn")
        if st is not None:
            ends["begin_id"] = str(st.get("id") or "")
        if ed is not None:
            ends["end_id"] = str(ed.get("id") or "")
    except Exception:  # noqa: BLE001
        pass
    try:
        raw = entry.get("bbox") or []
        x0, y0 = float(raw[0]), float(raw[1])
        x1, y1 = x0 + float(raw[2]), y0 + float(raw[3])
        xfrm = element.find(".//{http://schemas.openxmlformats.org/drawingml/2006/main}xfrm")
        flip_h = xfrm is not None and str(xfrm.get("flipH") or "") in ("1", "true")
        flip_v = xfrm is not None and str(xfrm.get("flipV") or "") in ("1", "true")
        bx, ex = (x1, x0) if flip_h else (x0, x1)
        by, ey = (y1, y0) if flip_v else (y0, y1)
        path = _open_arrow_path(element)
        if path is not None:
            points = path.findall(".//" + _DRAWING_NS + "pt")
            pw, ph = float(path.get("w", "0")), float(path.get("h", "0"))
            if len(points) < 2 or pw <= 0 or ph <= 0:
                return None
            start, finish = points[0], points[-1]
            bx, ex = (bx + (ex - bx) * float(pt.get("x")) / pw for pt in (start, finish))
            by, ey = (by + (ey - by) * float(pt.get("y")) / ph for pt in (start, finish))
        head = element.find(".//" + _DRAWING_NS + "headEnd")
        tail = element.find(".//" + _DRAWING_NS + "tailEnd")
        if (head is not None and head.get("type") not in (None, "none")
                and (tail is None or tail.get("type") in (None, "none"))):
            bx, ex = ex, bx
            by, ey = ey, by
            ends["begin_id"], ends["end_id"] = ends.get("end_id"), ends.get("begin_id")
        ends["begin"] = [round(bx / slide_w, 4), round(by / slide_h, 4)]
        ends["end"] = [round(ex / slide_w, 4), round(ey / slide_h, 4)]
    except Exception:  # noqa: BLE001
        if "begin" not in ends:
            return None
    return ends


def _rel_box(box: Sequence[float], region_box: Sequence[float]) -> list[float]:
    w = max(1e-6, region_box[2] - region_box[0])
    h = max(1e-6, region_box[3] - region_box[1])
    return [round(max(0.0, min(1.0, (box[0] - region_box[0]) / w)), 4),
            round(max(0.0, min(1.0, (box[1] - region_box[1]) / h)), 4),
            round(max(0.0, min(1.0, (box[2] - region_box[0]) / w)), 4),
            round(max(0.0, min(1.0, (box[3] - region_box[1]) / h)), 4)]


def _rel_pt(point: Sequence[float], region_box: Sequence[float]) -> list[float]:
    w = max(1e-6, region_box[2] - region_box[0])
    h = max(1e-6, region_box[3] - region_box[1])
    return [round(max(0.0, min(1.0, (point[0] - region_box[0]) / w)), 4),
            round(max(0.0, min(1.0, (point[1] - region_box[1]) / h)), 4)]


def _is_connector(item: dict[str, Any]) -> bool:
    tag = str(getattr(getattr(item["shape"], "element", None), "tag", "") or "")
    return tag.endswith("}cxnSp") or _open_arrow_path(item["shape"].element) is not None


def _pptx_diagram(items_in: Sequence[dict[str, Any]],
                  connectors_in: Sequence[dict[str, Any]],
                  region_box: Sequence[float], slide_w: float,
                  slide_h: float) -> dict[str, Any] | None:
    """带文字形状 + 连接线（幻灯片级坐标）→ 区域相对坐标的确定性 diagram。"""
    from ..living.diagram import diagram_from_shapes

    items = [{
        "entry_id": str(getattr(item["shape"], "shape_id", "") or ""),
        "box": _rel_box(item["box"], region_box),
        "text": item["text"],
        "shape_kind": _shape_kind(item["shape"]),
    } for item in items_in
        if item.get("text") and isinstance(item.get("box"), Sequence)]
    connectors: list[dict[str, Any]] = []
    for item in connectors_in:
        ends = _connector_ends(item, slide_w, slide_h)
        if ends is None:
            continue
        connectors.append({
            "begin": _rel_pt(ends["begin"], region_box),
            "end": _rel_pt(ends["end"], region_box),
            "begin_id": ends.get("begin_id"),
            "end_id": ends.get("end_id"),
        })
    return diagram_from_shapes(items, connectors)


_CONNECT_NEAR = 0.10  # 幻灯片归一化坐标下，连接线端点吸附节点的最大距离


def _pptx_connector_clusters(entries: Sequence[dict[str, Any]],
                             slide_w: float, slide_h: float
                             ) -> list[tuple[list[dict[str, Any]], list[dict[str, Any]]]]:
    """顶层「文本框 + 连接线」聚类（无组合的流程图）。

    每条连接线通过 stCxn/endCxn 或端点邻近解析两端节点；共享节点的
    连接线并查成簇。返回 ``(节点条目, 连接线条目)`` 列表。
    """
    connectors = [item for item in entries if _is_connector(item)]
    if not connectors:
        return []
    sid_map = {str(getattr(item["shape"], "shape_id", "") or ""): item
               for item in entries if not _is_connector(item)}
    nodes = [item for item in entries
             if not _is_connector(item) and item.get("text") and item.get("box")]

    def near(point: Sequence[float]) -> dict[str, Any] | None:
        best: tuple[float, dict[str, Any] | None] = (float("inf"), None)
        for item in nodes:
            box = item["box"]
            cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
            dist = (point[0] - cx) ** 2 + (point[1] - cy) ** 2
            if dist < best[0]:
                best = (dist, item)
        return best[1] if best[0] <= _CONNECT_NEAR ** 2 else None

    # 连接线 → 两端节点；并查集按共享节点聚类
    parent = list(range(len(connectors)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a: int, b: int) -> None:
        parent[find(a)] = find(b)

    ends_of: list[tuple[dict[str, Any] | None, dict[str, Any] | None]] = []
    owner_of: dict[int, int] = {}
    for index, item in enumerate(connectors):
        ends = _connector_ends(item, slide_w, slide_h)
        begin = ends.get("begin") if ends else None
        end = ends.get("end") if ends else None
        a = sid_map.get(ends.get("begin_id", "")) or (near(begin) if begin else None)
        b = sid_map.get(ends.get("end_id", "")) or (near(end) if end else None)
        ends_of.append((a, b))
        for node in (a, b):
            if node is None:
                continue
            key = id(node)
            if key in owner_of:
                union(index, owner_of[key])
            else:
                owner_of[key] = index

    clusters: dict[int, tuple[set[int], list[dict[str, Any]]]] = {}
    for index, (a, b) in enumerate(ends_of):
        if a is None or b is None or a is b:
            continue  # 两端都挂不上节点 → 不是流程图边
        root = find(index)
        ids, bucket = clusters.setdefault(root, (set(), []))
        ids.update(id(node) for node in (a, b))
        bucket.append(connectors[index])
    out: list[tuple[list[dict[str, Any]], list[dict[str, Any]]]] = []
    for ids, bucket in clusters.values():
        member = [item for item in nodes if id(item) in ids]
        if len(member) >= 2:
            out.append((member, bucket))
    return out


def _cluster_box(items: Sequence[dict[str, Any]],
                 connectors: Sequence[dict[str, Any]]) -> list[float] | None:
    boxes = [item["box"] for item in [*items, *connectors]]
    boxes = [b for b in boxes if isinstance(b, Sequence) and len(b) == 4]
    if not boxes:
        return None
    x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
    x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
    if x1 - x0 < 0.02 or y1 - y0 < 0.02:
        return None
    pad = 0.01
    return [max(0.0, x0 - pad), max(0.0, y0 - pad),
            min(1.0, x1 + pad), min(1.0, y1 + pad)]


def regions_for_pptx_slide(slide: Any, slide_w: float, slide_h: float,
                           preview: Image.Image, lab_dir: Path, file_id: str,
                           page_no: int) -> list[dict[str, Any]]:
    """Extract figure/diagram regions from native PPTX shapes.

    Group transforms are handled by the shared parser walker; this keeps the
    coordinates exact even when authors build diagrams from grouped shapes.
    """

    from ..parsers.pptx_parser import _classify, _omml_text, _walk_shapes

    if slide_w <= 0 or slide_h <= 0 or preview.width <= 0 or preview.height <= 0:
        return []
    entries: list[dict[str, Any]] = []
    try:
        walked = list(_walk_shapes(list(slide.shapes), page_no=page_no,
                                   parent_transform=(1.0, 1.0, 0.0, 0.0)))
    except Exception:  # noqa: BLE001 - 异常形状不阻断整页
        walked = []
    for shape, shape_index, element_id, group_path, bbox in walked:
        kind, reason = _classify(shape)
        text = _pptx_text(shape)
        box = _pptx_box(bbox, slide_w, slide_h)
        area = _area(box) if box else 0.0
        entries.append({
            "shape": shape, "shape_index": shape_index, "element_id": element_id,
            "group_path": group_path, "bbox": [bbox.get("x", 0), bbox.get("y", 0),
                                               bbox.get("w", 0), bbox.get("h", 0)],
            "box": box, "area": area, "kind": kind, "reason": reason, "text": text,
        })

    regions: list[dict[str, Any]] = []
    consumed: set[str] = set()
    counter = 0

    def add(kind: str, box: Sequence[float], *, source: str, text: str = "",
            caption: str = "", label: str = "", confidence: float = 0.5,
            latex: str | None = None,
            labels: list[dict[str, Any]] | None = None,
            diagram: dict[str, Any] | None = None) -> None:
        nonlocal counter
        if not _accepts(regions, box):
            return
        counter += 1
        key = f"{file_id}_p{page_no}_r{counter}"
        if _save_crop(preview, lab_dir, key, box) is None:
            return
        regions.append({
            "id": key,
            "kind": kind,
            "bbox": [round(float(value), 6) for value in box],
            "asset_id": key,
            "label": (label or "图示")[:200],
            "caption": caption[:300],
            "text": text[:MAX_REGION_TEXT],
            "source": source,
            "confidence": round(max(0.0, min(1.0, confidence)), 3),
            "latex": latex,
            "labels": labels or [],
            "block_id": None,
            **({"diagram": diagram} if diagram else {}),
        })

    # Native groups with several labelled children are the strongest signal
    # for a diagram; their child pictures should not become separate hotspots.
    for entry in entries:
        if entry["kind"] != "group" or entry["group_path"] is not None:
            continue
        if entry["box"] is None or not (0.05 <= entry["area"] <= 0.85):
            continue
        descendants = [
            item for item in entries
            if item["shape_index"] == entry["shape_index"]
            and item["element_id"] != entry["element_id"]
        ]
        text_children = [item for item in descendants if item["text"] and item["kind"] in ("text", "shape")]
        non_group = [item for item in descendants if item["kind"] != "group"]
        if len(text_children) < 2 or len(non_group) < 3:
            continue
        labels = [item["text"] for item in text_children]
        text = _join_text(labels)
        caption = _pptx_caption(entry["box"], [item for item in entries
                                                if item["element_id"] not in consumed],
                                slide_w, slide_h)
        add("diagram", entry["box"], source="pptx_group", text=text, caption=caption,
            label=_first_line(caption or text) or "分组图示", confidence=0.64,
            labels=_pptx_labels(entry["box"], entries, descendants_of=entry["shape_index"]),
            diagram=_pptx_diagram(
                [d for d in descendants if not _is_connector(d)],
                [d for d in descendants if _is_connector(d)],
                entry["box"], slide_w, slide_h))
        consumed.update(item["element_id"] for item in descendants)

    # 顶层「文本框 + 连接线」簇（没组合起来的流程图）→ 确定性 diagram
    for member, connectors in _pptx_connector_clusters(entries, slide_w, slide_h):
        if any(item["element_id"] in consumed for item in member):
            continue
        box = _cluster_box(member, connectors)
        if box is None:
            continue
        diagram = _pptx_diagram(member, connectors, box, slide_w, slide_h)
        if diagram is None:
            continue
        text = _join_text([item["text"] for item in member])
        add("diagram", box, source="pptx_connectors", text=text,
            label=_first_line(text) or "流程图", confidence=0.7,
            labels=_pptx_labels(box, member), diagram=diagram)
        consumed.update(item["element_id"] for item in member)
        consumed.update(item["element_id"] for item in connectors)

    # Adjacent short text boxes are candidates only; do not infer edges from position.
    candidates = [
        item for item in entries
        if item["group_path"] is None and item["element_id"] not in consumed
        and item["kind"] in ("text", "shape") and item["box"]
        and 0.003 <= item["area"] <= 0.08 and 0 < len(item["text"]) <= 40
        and "\n" not in item["text"]
    ]

    def adjacent(left, right):
        a, b = left["box"], right["box"]
        gap_x = max(0, a[0] - b[2], b[0] - a[2])
        gap_y = max(0, a[1] - b[3], b[1] - a[3])
        return (gap_x <= 0.14 and abs(a[1] + a[3] - b[1] - b[3]) <= 0.07
                or gap_y <= 0.14 and abs(a[0] + a[2] - b[0] - b[2]) <= 0.10)

    while candidates and len(regions) < MAX_REGIONS_PER_PAGE:
        cluster = [candidates.pop(0)]
        for item in cluster:
            neighbors = [candidate for candidate in candidates if adjacent(item, candidate)]
            cluster.extend(neighbors)
            for neighbor in neighbors:
                candidates.remove(neighbor)
        if not 3 <= len(cluster) <= 12:
            continue
        box = _cluster_box(cluster, [])
        if box is not None:
            text = _join_text([item["text"] for item in cluster])
            add("diagram", box, source="pptx_text_cluster", text=text,
                label=_first_line(text), confidence=0.45, labels=_pptx_labels(box, cluster))

    # SmartArt is opaque to python-pptx; keep the exact shape box for the
    # vision pass instead of dropping the diagram.
    for entry in entries:
        if entry["reason"] != "smartart_not_parsed" or entry["element_id"] in consumed:
            continue
        if entry["box"] is None or entry["area"] < 0.05:
            continue
        add("diagram", entry["box"], source="pptx_smartart", text=entry["text"],
            label=_first_line(entry["text"]) or "SmartArt 图示", confidence=0.45,
            labels=_pptx_labels(entry["box"], [entry]))
        consumed.add(entry["element_id"])

    # Native pictures.  Captions come from a text shape directly below.
    for entry in entries:
        if entry["kind"] != "picture" or entry["element_id"] in consumed:
            continue
        if entry["box"] is None or not (0.02 <= entry["area"] <= 0.85):
            continue
        if entry["box"][2] - entry["box"][0] < 0.06 or entry["box"][3] - entry["box"][1] < 0.06:
            continue
        caption = _pptx_caption(entry["box"], [item for item in entries if item["text"]],
                                slide_w, slide_h)
        kind = "diagram" if _looks_like_diagram(caption) else "figure"
        add(kind, entry["box"], source="pptx_picture", text=caption,
            caption=caption, label=_first_line(caption) or "插图", confidence=0.6,
            labels=_pptx_labels(entry["box"], entries))

    # OMML formulas are exact text, so a small formula hotspot is safe.  The
    # cap prevents every inline symbol from turning into a region.
    formulas = 0
    for entry in entries:
        if formulas >= 2 or entry["element_id"] in consumed:
            continue
        if entry["box"] is None or not (0.004 <= entry["area"] <= 0.3):
            continue
        omml = _omml_text(entry["shape"])
        if not omml:
            continue
        latex = None
        try:
            from ..labs.extract import _shape_text
            raw = _shape_text(entry["shape"])
            latex = _latex_from_text(raw or "")
        except Exception:  # noqa: BLE001 - OMML 读取失败时保留文字区域
            latex = None
        formulas += 1
        add("formula", entry["box"], source="pptx_math", text=entry["text"] or omml,
            label="公式", confidence=0.66, latex=latex)

    return _cap_regions(regions)


# ---------------------------------------------------------------------------
# Raster images
# ---------------------------------------------------------------------------


def regions_for_image(image: Image.Image, lab_dir: Path, file_id: str,
                      text: str = "", math_text: str | None = None,
                      labels: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """One whole-image region until raster layout analysis lands.

    A full-image hotspot is still useful: it opens the crop and its OCR text,
    and formula screenshots can be classified without inventing sub-boxes.
    """

    if image.width <= 0 or image.height <= 0:
        return []
    box = [0.01, 0.01, 0.99, 0.99]
    key = f"{file_id}_p1_r1"
    if _save_crop(image, lab_dir, key, box, pad=0) is None:
        return []
    content = (text or "").strip()
    cjk = len(_CJK.findall(content))
    kind = "formula" if math_text and cjk <= 8 else "figure"
    return [{
        "id": key,
        "kind": kind,
        "bbox": box,
        "asset_id": key,
        "label": _first_line(content) or ("公式图" if kind == "formula" else "上传的图片"),
        "caption": _first_line(content, 300),
        "text": content[:MAX_REGION_TEXT],
        "source": "image",
        "confidence": 0.35,
        "latex": math_text if kind == "formula" else None,
        "labels": labels or [],
        "block_id": None,
    }]


__all__ = [
    "MAX_REGIONS_PER_PAGE",
    "regions_for_image",
    "regions_for_pdf_page",
    "regions_for_pptx_slide",
]