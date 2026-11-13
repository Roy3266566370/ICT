"""纯文字/位图课件的离线结构启发式。

真实教学课件常以文本框和图片为主，没有原生 table/chart/OMML。这里只在
**不伪造数值**的前提下，把两类可核验结构转成 filter iSpec：

* 文本框里用 ``|`` 或制表符分隔的表格行；
* 多个短文本元素按 bbox 排成行列的“文本框表格”（同一行 y 接近、同一列 x 接近）。

所有结果都标 ``source.status="inferred"``，notes 明确说明是布局/文本启发式，
需用户核对。检测不到结构时返回空列表，不生成占位交互。
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

SPEC_VERSION = "1.0"
MAX_EXCERPT = 160
MAX_ROWS = 50
MAX_COLUMNS = 8
MAX_CELL_CHARS = 80
MAX_GRID_CELL_CHARS = 24
_NUMBER = re.compile(r"^[-+−]?\d+(?:\.\d+)?%?$")


def _cell(value: Any) -> str:
    return str(value or "").strip()


def _is_number(value: str) -> bool:
    text = value.replace(",", "").replace(" ", "").replace("，", "")
    return bool(_NUMBER.match(text))


def _safe_id(*parts: Any) -> str:
    raw = "_".join(str(part) for part in parts if part not in (None, ""))
    return (re.sub(r"[^A-Za-z0-9_.:-]", "_", raw)[:120].strip("_") or "ispec")


def _passes_table_gates(rows: list[list[str]]) -> bool:
    """保守结构门槛：避免把目录/两栏排版误判成数据表。"""

    header, data = rows[0], rows[1:]
    if not data:
        return False
    width = len(header)
    numeric_columns: list[int] = []
    for column in range(width):
        values = [row[column] for row in data]
        if any(_is_number(value) for value in values) and all(
            not value or _is_number(value) for value in values
        ):
            numeric_columns.append(column)
    numeric_cells = sum(
        1 for row in data for value in row if _is_number(value)
    )
    if numeric_cells < 2:
        return False
    # 纯编号列（01/02/03 + 标题）是目录，不是数据表：必须存在非首列的数值，
    # 即数据值不能只是行号。
    if not any(
        _is_number(row[column])
        for row in data
        for column in range(1, width)
    ):
        return False
    # 至少需要一个“表头不是数字”的数值列，或至少两个数值列。
    if len(numeric_columns) < 2 and not any(
        not _is_number(header[column]) for column in numeric_columns
    ):
        return False
    if all(_is_number(value) for value in header if value):
        return False
    return True


def _delimiter_rows(text: str) -> list[list[str]] | None:
    lines = [line.strip() for line in str(text or "").splitlines() if line.strip()]
    if len(lines) < 2 or len(lines) > MAX_ROWS:
        return None
    for delimiter in ("|", "\t"):
        rows = [[_cell(part) for part in line.split(delimiter)] for line in lines]
        widths = {len(row) for row in rows}
        if len(widths) != 1:
            continue
        width = widths.pop()
        if width < 2 or width > MAX_COLUMNS:
            continue
        if not all(len(cell) <= MAX_CELL_CHARS for row in rows for cell in row):
            continue
        if _passes_table_gates(rows):
            return rows
    return None


def _bbox(element: Mapping[str, Any]) -> dict[str, float] | None:
    box = element.get("bbox")
    if not isinstance(box, Mapping):
        return None
    try:
        x = float(box["x"])
        y = float(box["y"])
        w = float(box["w"])
        h = float(box["h"])
    except (KeyError, TypeError, ValueError):
        return None
    if w <= 0 or h <= 0:
        return None
    return {"x": x, "y": y, "w": w, "h": h, "cy": y + h / 2, "cx": x + w / 2}


def _grid_rows(
    page: Mapping[str, Any],
    elements: Sequence[Mapping[str, Any]],
    covered: set[str],
) -> tuple[list[list[str]], Mapping[str, Any], dict[str, float]] | None:
    candidates: list[tuple[Mapping[str, Any], dict[str, float]]] = []
    for element in elements:
        if str(element.get("element_id") or "") in covered:
            continue
        if element.get("table_data") or element.get("chart_data") or element.get("math_text"):
            continue
        if element.get("kind") not in ("text", "shape"):
            continue
        text = _cell(element.get("text"))
        if not text or len(text) > MAX_GRID_CELL_CHARS:
            continue
        box = _bbox(element)
        if box is None:
            continue
        candidates.append((element, box))
    if len(candidates) < 4:
        return None

    heights = sorted(box["h"] for _, box in candidates)
    tolerance = max(heights[len(heights) // 2] * 0.65, 1.0)
    candidates.sort(key=lambda item: item[1]["cy"])
    clusters: list[list[tuple[Mapping[str, Any], dict[str, float]]]] = []
    for element, box in candidates:
        if not clusters:
            clusters.append([(element, box)])
            continue
        current = clusters[-1]
        center = sum(item[1]["cy"] for item in current) / len(current)
        if abs(box["cy"] - center) <= tolerance:
            current.append((element, box))
        else:
            clusters.append([(element, box)])

    rows: list[list[tuple[Mapping[str, Any], dict[str, float]]]] = []
    for cluster in clusters:
        if len(cluster) < 2:
            continue
        rows.append(sorted(cluster, key=lambda item: item[1]["cx"]))
    if len(rows) < 2:
        return None
    widths = {len(row) for row in rows}
    if len(widths) != 1:
        return None
    width = widths.pop()
    if width < 2 or width > MAX_COLUMNS:
        return None

    page_width = float(page.get("width") or 0)
    column_tolerance = max(
        page_width * 0.06,
        max(box["w"] for _, box in candidates) * 0.75,
    )
    for column in range(width):
        centers = [row[column][1]["cx"] for row in rows]
        if max(centers) - min(centers) > column_tolerance:
            return None

    grid = [[_cell(element.get("text")) for element, _ in row] for row in rows]
    if not _passes_table_gates(grid):
        return None
    boxes = [box for row in rows for _, box in row]
    anchor_bbox = {
        "x": min(box["x"] for box in boxes),
        "y": min(box["y"] for box in boxes),
        "w": max(box["x"] + box["w"] for box in boxes) - min(box["x"] for box in boxes),
        "h": max(box["y"] + box["h"] for box in boxes) - min(box["y"] for box in boxes),
    }
    return grid, rows[0][0][0], anchor_bbox


def _ocr_grid_rows(
    element: Mapping[str, Any],
) -> tuple[list[list[str]], str] | None:
    """从本地 OCR 的文字框行列恢复表格；不依赖图片里的分隔符。"""

    recognition = element.get("image_recognition")
    if not isinstance(recognition, Mapping):
        return None
    raw_rows = recognition.get("rows")
    if not isinstance(raw_rows, list):
        return None
    entries: list[dict[str, Any]] = []
    for item in raw_rows:
        if not isinstance(item, Mapping):
            continue
        box = item.get("box")
        text = _cell(item.get("text"))
        if not isinstance(box, list) or len(box) < 4 or not text or len(text) > MAX_GRID_CELL_CHARS:
            continue
        try:
            xs = [float(point[0]) for point in box]
            ys = [float(point[1]) for point in box]
        except (TypeError, ValueError, IndexError):
            continue
        if not xs or not ys:
            continue
        entries.append(
            {
                "text": text,
                "cx": sum(xs) / len(xs),
                "cy": sum(ys) / len(ys),
                "w": max(xs) - min(xs),
                "h": max(ys) - min(ys),
            }
        )
    if len(entries) < 4:
        return None

    heights = sorted(entry["h"] for entry in entries if entry["h"] > 0)
    tolerance = max(heights[len(heights) // 2] * 0.6, 1.0) if heights else 4.0
    entries.sort(key=lambda entry: entry["cy"])
    lines: list[list[dict[str, Any]]] = []
    for entry in entries:
        if not lines:
            lines.append([entry])
            continue
        center = sum(item["cy"] for item in lines[-1]) / len(lines[-1])
        if abs(entry["cy"] - center) <= tolerance:
            lines[-1].append(entry)
        else:
            lines.append([entry])
    rows = [sorted(line, key=lambda item: item["cx"]) for line in lines if len(line) >= 2]
    if len(rows) < 2:
        return None
    widths = {len(row) for row in rows}
    if len(widths) != 1:
        return None
    width = widths.pop()
    if width < 2 or width > MAX_COLUMNS:
        return None
    max_cell_width = max(entry["w"] for entry in entries)
    column_tolerance = max(max_cell_width * 0.8, 8.0)
    for column in range(width):
        centers = [row[column]["cx"] for row in rows]
        if max(centers) - min(centers) > column_tolerance:
            return None
    grid = [[entry["text"] for entry in row] for row in rows]
    if not _passes_table_gates(grid):
        return None
    ocr_text = str(recognition.get("text") or "")
    excerpt = ocr_text.splitlines()[0].strip() if ocr_text.strip() else " ".join(grid[0])
    return grid, excerpt[:MAX_EXCERPT] or "表格"


def _table_spec(
    *,
    page: Mapping[str, Any],
    material_id: str,
    rows: list[list[str]],
    anchor_element: Mapping[str, Any],
    title: str,
    notes: str,
    excerpt: str | None = None,
    anchor_bbox: Mapping[str, float] | None = None,
) -> dict[str, Any] | None:
    headers = list(rows[0])
    body = [list(row) for row in rows[1:]]
    columns = []
    for header in headers:
        text = _cell(header)
        if text and text not in columns:
            columns.append(text)
    if not columns:
        return None
    page_no = page.get("page_no")
    if not isinstance(page_no, int) or page_no < 1:
        return None
    element_id = anchor_element.get("element_id")
    if excerpt is None:
        excerpt = _cell(anchor_element.get("text")).splitlines()[0] if anchor_element.get("text") else "表格"
    excerpt = excerpt[:MAX_EXCERPT] or "表格"
    dataset_id = f"table_p{page_no:02d}"
    spec: dict[str, Any] = {
        "spec_version": SPEC_VERSION,
        "object_id": _safe_id(
            "ispec", material_id, f"p{page_no:02d}", element_id, "texttable"
        ),
        "title": title,
        "kind": "filter",
        "parameters": [
            {
                "id": "filter_column",
                "label": "筛选列",
                "type": "enum",
                "unit": "",
                "default": "全部",
                "options": ["全部", *columns],
                "source": {
                    "page": page_no,
                    "element_id": element_id if isinstance(element_id, str) else None,
                    "bbox": None,
                    "status": "inferred",
                    "excerpt": excerpt,
                },
            }
        ],
        "expressions": [],
        "datasets": [
            {
                "id": dataset_id,
                "columns": headers,
                "rows": body,
                "source": {
                    "page": page_no,
                    "element_id": element_id if isinstance(element_id, str) else None,
                },
            }
        ],
        "views": [
            {
                "type": "table",
                "columns": headers,
                "title": title,
                "dataset": dataset_id,
            }
        ],
        "constraints": [],
        "checks": [],
        "notes": notes,
    }
    box = dict(anchor_bbox) if anchor_bbox is not None else _bbox(anchor_element)
    if box is not None:
        spec["anchor"] = {
            "page": page_no,
            "element_id": element_id,
            "bbox": {
                "x": float(box["x"]),
                "y": float(box["y"]),
                "w": float(box["w"]),
                "h": float(box["h"]),
            },
        }
    return spec


def build_text_structure_specs(
    page: Mapping[str, Any],
    material_id: str,
    *,
    covered_element_ids: set[str] | None = None,
    limit: int = 2,
) -> list[dict[str, Any]]:
    """从一页文字元素生成文本表格 iSpec；检测不到返回空列表。"""

    covered = set(covered_element_ids or set())
    raw_elements = page.get("elements")
    elements = [item for item in raw_elements if isinstance(item, Mapping)] if isinstance(raw_elements, list) else []
    specs: list[dict[str, Any]] = []
    page_no = page.get("page_no")

    for element in elements:
        if len(specs) >= limit:
            break
        element_id = element.get("element_id")
        if not isinstance(element_id, str) or element_id in covered:
            continue
        if element.get("table_data") or element.get("chart_data") or element.get("math_text"):
            continue
        rows = _delimiter_rows(element.get("text"))
        if rows is None:
            continue
        is_ocr = element.get("recognition_method") == "local_ocr"
        spec = _table_spec(
            page=page,
            material_id=material_id,
            rows=rows,
            anchor_element=element,
            title=f"第 {page_no} 页 · 文本表格（{'OCR ' if is_ocr else ''}需核对）",
            notes=(
                ("由图片本地 OCR 文本按分隔符恢复的表格；" if is_ocr else "由文本框内分隔符恢复的表格；")
                + "行列与数值来自原文，需用户核对后使用。"
            ),
        )
        if spec is not None:
            specs.append(spec)
            covered.add(element_id)

    if specs:
        return specs

    for element in elements:
        if len(specs) >= limit:
            break
        element_id = element.get("element_id")
        if not isinstance(element_id, str) or element_id in covered:
            continue
        if element.get("kind") != "picture":
            continue
        ocr_grid = _ocr_grid_rows(element)
        if ocr_grid is None:
            continue
        rows, excerpt = ocr_grid
        spec = _table_spec(
            page=page,
            material_id=material_id,
            rows=rows,
            anchor_element=element,
            title=f"第 {page_no} 页 · 图片表格（OCR 需核对）",
            notes=(
                "由图片本地 OCR 的文字框行列恢复的表格；"
                "单元格文本来自 OCR，行列关系为布局推断，需用户核对。"
            ),
            excerpt=excerpt,
        )
        if spec is not None:
            specs.append(spec)
            covered.add(element_id)

    if specs:
        return specs

    grid = _grid_rows(page, elements, covered)
    if grid is not None:
        rows, anchor_element, anchor_bbox = grid
        spec = _table_spec(
            page=page,
            material_id=material_id,
            rows=rows,
            anchor_element=anchor_element,
            title=f"第 {page_no} 页 · 文本框表格（需核对）",
            notes=(
                "由多个文本框按页面位置排成的行列恢复的表格；"
                "单元格文本来自原文，行列关系为布局推断，需用户核对。"
            ),
            anchor_bbox=anchor_bbox,
        )
        if spec is not None:
            specs.append(spec)

    return specs


__all__ = ["build_text_structure_specs"]
