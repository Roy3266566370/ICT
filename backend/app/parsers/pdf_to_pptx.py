"""PDF → PPTX 转换：让 PDF 复用既有 PPTX 解析 / 渲染 / 识别链路。

每页生成一张幻灯片：
- 画面：把 PDF 页原样（含文字、公式、矢量图）渲染成整页 PNG，保证与原稿一致；
- 文字：文字层的每个文本块还原成文本框（位置、字号、颜色），放在整页图片**下方**，
  肉眼不可见，只供解析 / 识别 / 检索读取，避免字体替换造成错位与乱码。
扫描版 PDF 没有文字层，只会得到整页底图。全程只读 PDF，不执行其中任何脚本。
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.util import Emu, Pt

SLIDE_WIDTH_EMU = 12192000
EMU_PER_PT = 12700
TARGET_IMAGE_WIDTH = 1600
MAX_IMAGE_ZOOM = 3.0


class PdfConvertError(Exception):
    """PDF 无法转换（损坏 / 加密 / 无页面 / 超页数）。"""

    def __init__(self, message: str, *, page_count: int | None = None, limit_pages: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.page_count = page_count
        self.limit_pages = limit_pages


def _import_pymupdf() -> Any:
    try:
        import pymupdf
    except ImportError:
        try:
            import fitz as pymupdf  # type: ignore[no-redef]
        except ImportError as exc:
            raise PdfConvertError("服务器缺少 PDF 解析组件，请安装 PyMuPDF") from exc
    return pymupdf


def _text_blocks(page: Any) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue
        lines: list[str] = []
        sizes: list[float] = []
        first_span: dict[str, Any] | None = None
        for line in block.get("lines", []):
            text = "".join(span.get("text", "") for span in line.get("spans", [])).rstrip()
            if not text.strip():
                continue
            lines.append(text)
            for span in line.get("spans", []):
                if span.get("text", "").strip():
                    sizes.append(float(span.get("size", 12)))
                    first_span = first_span or span
        if not lines or first_span is None:
            continue
        blocks.append(
            {
                "bbox": block["bbox"],
                "lines": lines,
                "size": max(sizes),
                "color": int(first_span.get("color", 0)),
                "bold": bool(int(first_span.get("flags", 0)) & 16),
            }
        )
    return blocks


def _render_page(pymupdf: Any, page: Any) -> bytes:
    zoom = max(1.0, min(MAX_IMAGE_ZOOM, TARGET_IMAGE_WIDTH / max(page.rect.width, 1.0)))
    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
    return pixmap.tobytes("png")


def _extract_page_figures(pymupdf: Any, page: Any) -> list[tuple[tuple[float, float, float, float], bytes]]:
    """提取 PDF 页内嵌的独立插图/图表区域，供下游公式识别与视觉图表提取使用。"""
    rect = page.rect
    page_area = max(rect.width * rect.height, 1.0)
    figures: list[tuple[tuple[float, float, float, float], bytes]] = []
    seen_boxes: list[tuple[float, float, float, float]] = []
    try:
        infos = page.get_image_info(xrefs=True) or []
    except Exception:  # noqa: BLE001
        return figures
    zoom = max(1.5, min(MAX_IMAGE_ZOOM, TARGET_IMAGE_WIDTH / max(rect.width, 1.0)))
    for info in infos:
        bbox = info.get("bbox")
        if not bbox or len(bbox) != 4:
            continue
        x0 = max(rect.x0, float(bbox[0]))
        y0 = max(rect.y0, float(bbox[1]))
        x1 = min(rect.x1, float(bbox[2]))
        y1 = min(rect.y1, float(bbox[3]))
        w, h = x1 - x0, y1 - y0
        area_ratio = (w * h) / page_area
        if w < 40 or h < 30 or not (0.02 <= area_ratio <= 0.85):
            continue
        if any(
            abs(x0 - sx0) < 8 and abs(y0 - sy0) < 8 and abs(x1 - sx1) < 8 and abs(y1 - sy1) < 8
            for sx0, sy0, sx1, sy1 in seen_boxes
        ):
            continue
        seen_boxes.append((x0, y0, x1, y1))
        try:
            clip = pymupdf.Rect(x0, y0, x1, y1)
            crop = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip, alpha=False).tobytes("png")
            figures.append(((x0, y0, x1, y1), crop))
        except Exception:  # noqa: BLE001
            continue
        if len(figures) >= 6:
            break
    return figures


def _add_pdf_tables(slide: Any, page: Any, scale: float, dx: float, dy: float) -> None:
    """用 PyMuPDF 表格检测提取结构化表格，生成原生 PPTX 表格以触发下游表格交互。"""
    if not hasattr(page, "find_tables"):
        return
    try:
        found = page.find_tables()
        tables = getattr(found, "tables", None) or []
    except Exception:  # noqa: BLE001
        return
    for table in tables[:3]:
        try:
            rows = table.extract() or []
            bbox = table.bbox
        except Exception:  # noqa: BLE001
            continue
        cleaned = [[str(cell or "").strip() for cell in row] for row in rows if isinstance(row, list)]
        if len(cleaned) < 2 or not cleaned[0] or len(cleaned[0]) < 2:
            continue
        if not any(cleaned[0]):
            continue
        col_count = min(12, len(cleaned[0]))
        row_count = min(30, len(cleaned))
        x0, y0, x1, y1 = bbox
        shape = slide.shapes.add_table(
            row_count,
            col_count,
            Emu(int(dx + x0 * scale)),
            Emu(int(dy + y0 * scale)),
            Emu(max(int((x1 - x0) * scale), EMU_PER_PT * 20)),
            Emu(max(int((y1 - y0) * scale), EMU_PER_PT * 12)),
        )
        tbl = shape.table
        for r_idx in range(row_count):
            row = cleaned[r_idx]
            for c_idx in range(col_count):
                tbl.cell(r_idx, c_idx).text = row[c_idx] if c_idx < len(row) else ""


def _add_text_box(slide: Any, block: dict[str, Any], scale: float, dx: float, dy: float) -> None:
    x0, y0, x1, y1 = block["bbox"]
    width = (x1 - x0) * scale * 1.08 + 2 * EMU_PER_PT
    box = slide.shapes.add_textbox(
        Emu(int(dx + x0 * scale)),
        Emu(int(dy + y0 * scale)),
        Emu(int(width)),
        Emu(int(max((y1 - y0) * scale, EMU_PER_PT))),
    )
    frame = box.text_frame
    frame.word_wrap = True
    frame.margin_left = frame.margin_right = frame.margin_top = frame.margin_bottom = 0
    font_pt = max(4.0, block["size"] * scale / EMU_PER_PT)
    rgb = block["color"] & 0xFFFFFF
    for index, line in enumerate(block["lines"]):
        paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        run = paragraph.add_run()
        run.text = line
        run.font.size = Pt(round(font_pt, 1))
        run.font.bold = block["bold"]
        run.font.color.rgb = RGBColor((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255)


def pdf_page_count(path: Path) -> int:
    pymupdf = _import_pymupdf()
    try:
        document = pymupdf.open(str(path))
    except Exception as exc:
        raise PdfConvertError("PDF 无法打开，文件可能已损坏") from exc
    try:
        if document.needs_pass or document.is_encrypted:
            raise PdfConvertError("PDF 已加密，无法读取内容")
        return int(document.page_count)
    finally:
        document.close()


def convert_pdf_to_pptx(pdf_path: Path, pptx_path: Path, *, max_pages: int) -> int:
    """把 PDF 转成 PPTX，返回页数。"""

    pymupdf = _import_pymupdf()
    try:
        document = pymupdf.open(str(pdf_path))
    except Exception as exc:
        raise PdfConvertError("PDF 无法打开，文件可能已损坏") from exc
    try:
        if document.needs_pass or document.is_encrypted:
            raise PdfConvertError("PDF 已加密，无法读取内容")
        total = int(document.page_count)
        if total == 0:
            raise PdfConvertError("PDF 没有可读取的页面")
        if total > max_pages:
            raise PdfConvertError(
                f"页数 {total} 超过 {max_pages} 页上限", page_count=total, limit_pages=max_pages
            )

        first = document[0].rect
        slide_w = SLIDE_WIDTH_EMU
        slide_h = max(int(slide_w * first.height / max(first.width, 1.0)), 1)
        presentation = Presentation()
        presentation.slide_width = Emu(slide_w)
        presentation.slide_height = Emu(slide_h)
        blank = presentation.slide_layouts[6]

        for page in document:
            rect = page.rect
            scale = min(slide_w / max(rect.width, 1.0), slide_h / max(rect.height, 1.0))
            dx = (slide_w - rect.width * scale) / 2
            dy = (slide_h - rect.height * scale) / 2
            blocks = _text_blocks(page)
            figures = _extract_page_figures(pymupdf, page)
            image = _render_page(pymupdf, page)
            slide = presentation.slides.add_slide(blank)
            for block in blocks:
                _add_text_box(slide, block, scale, dx, dy)
            _add_pdf_tables(slide, page, scale, dx, dy)
            for (fx0, fy0, fx1, fy1), crop in figures:
                slide.shapes.add_picture(
                    io.BytesIO(crop),
                    Emu(int(dx + fx0 * scale)),
                    Emu(int(dy + fy0 * scale)),
                    Emu(max(1, int((fx1 - fx0) * scale))),
                    Emu(max(1, int((fy1 - fy0) * scale))),
                )
            slide.shapes.add_picture(
                io.BytesIO(image),
                Emu(int(dx)),
                Emu(int(dy)),
                Emu(int(rect.width * scale)),
                Emu(int(rect.height * scale)),
            )

        pptx_path.parent.mkdir(parents=True, exist_ok=True)
        presentation.save(str(pptx_path))
        return total
    finally:
        document.close()
