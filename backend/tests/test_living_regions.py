"""P0 区域层：PDF/PPTX bbox、裁剪资产、page 契约与 asset 白名单。"""

from __future__ import annotations

import io
from pathlib import Path

import pymupdf
import pytest
from PIL import Image
from pptx import Presentation

from app.documents.regions import regions_for_pdf_page, regions_for_pptx_slide
from app.living.blockify import blockify
from app.living.model import validate_block, validate_blocks
from app.living.store import asset_keys, build_document


def _pdf_page_image(page: pymupdf.Page) -> Image.Image:
    scale = max(1.0, 1200 / page.rect.width)
    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
    return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def test_pdf_vector_diagram_gets_normalized_bbox_and_crop(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=400, height=300)
    page.draw_rect(pymupdf.Rect(40, 80, 360, 220), color=(0, 0, 0), width=2)
    page.insert_text((60, 130), "Input -> Model -> Output", fontsize=14)
    regions = regions_for_pdf_page(page, _pdf_page_image(page), tmp_path, "f1", 1)
    document.close()

    assert regions, "矢量流程框应产生一个区域"
    region = regions[0]
    assert region["kind"] == "diagram"
    assert region["source"] == "pdf_vector"
    assert 0 <= region["bbox"][0] < region["bbox"][2] <= 1
    assert 0 <= region["bbox"][1] < region["bbox"][3] <= 1
    assert (tmp_path / "previews" / f"{region['asset_id']}.png").is_file()
    assert "Input" in region["text"]


def test_pdf_formula_text_gets_formula_region(tmp_path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page(width=400, height=300)
    page.insert_text((50, 100), "E = m c^2", fontsize=16)
    regions = regions_for_pdf_page(page, _pdf_page_image(page), tmp_path, "f1", 1)
    document.close()

    formulas = [region for region in regions if region["kind"] == "formula"]
    assert formulas
    assert "=" in formulas[0]["text"]
    assert (tmp_path / "previews" / f"{formulas[0]['asset_id']}.png").is_file()


def test_pptx_picture_gets_caption_and_crop(tmp_path: Path) -> None:
    image_path = tmp_path / "picture.png"
    Image.new("RGB", (200, 120), "white").save(image_path)
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    slide.shapes.add_picture(str(image_path), 914400, 914400, width=4 * 914400, height=2 * 914400)
    slide.shapes.add_textbox(914400, int(3.1 * 914400), 5 * 914400, 400000).text_frame.text = "Figure 1: pipeline"
    preview = Image.new("RGB", (1280, 720), "white")

    regions = regions_for_pptx_slide(
        slide, presentation.slide_width, presentation.slide_height,
        preview, tmp_path, "f1", 1,
    )

    figures = [region for region in regions if region["kind"] == "figure"]
    assert figures
    figure = figures[0]
    assert "Figure 1" in figure["caption"]
    assert figure["source"] == "pptx_picture"
    assert (tmp_path / "previews" / f"{figure['asset_id']}.png").is_file()


def _source_with_regions() -> dict:
    return {
        "files": [{"file_id": "f1", "name": "讲义.pdf", "role": "courseware",
                   "kind": "pdf", "pages": 1, "methods": ["pdf_text"]}],
        "pages": [{
            "file_id": "f1", "page": 1, "text": "第一页", "method": "pdf_text",
            "image_key": "f1_p1", "image_width": 1200, "image_height": 900,
            "preserve_layout": True,
            "regions": [
                {"id": "f1_p1_r1", "kind": "diagram", "bbox": [0.1, 0.2, 0.9, 0.6],
                 "asset_id": "f1_p1_r1", "label": "流程图", "caption": "", "text": "A->B",
                 "source": "pdf_vector", "confidence": 0.7, "latex": None, "block_id": None},
                {"id": "f1_p1_r2", "kind": "formula", "bbox": [0.1, 0.7, 0.4, 0.8],
                 "asset_id": "f1_p1_r2", "label": "公式", "caption": "", "text": "E=mc^2",
                 "source": "pptx_math", "confidence": 0.8, "latex": "E=mc^2", "block_id": None},
            ],
        }],
        "method": "pdf_text",
    }


def test_blockify_keeps_page_regions_and_links_formula_block() -> None:
    blocks, notes = blockify(_source_with_regions())
    validated = validate_blocks(blocks)
    page = next(block for block in validated if block["type"] == "page")
    formula = next(block for block in validated if block["type"] == "formula")

    assert len(page["data"]["regions"]) == 2
    assert formula["source"]["region"] == "f1_p1_r2"
    linked = next(region for region in page["data"]["regions"] if region["id"] == "f1_p1_r2")
    assert linked["block_id"] == formula["id"]
    assert any("可交互区域" in note for note in notes)


def test_page_region_validation_rejects_bad_bbox_and_oversize() -> None:
    base = {"type": "page", "data": {"alt": "页", "image_key": "p1", "collapsed": False}}
    bad = {**base, "data": {**base["data"], "regions": [{
        "id": "r1", "kind": "figure", "bbox": [0.5, 0.5, 0.2, 0.2],
        "asset_id": "r1", "label": "图", "text": "", "source": "pdf_image", "confidence": 0.5,
    }]}}
    with pytest.raises(ValueError):
        validate_block(bad)

    region = {"id": "r1", "kind": "figure", "bbox": [0.1, 0.1, 0.2, 0.2],
              "asset_id": "r1", "label": "图", "text": "", "source": "pdf_image", "confidence": 0.5}
    oversize = {**base, "data": {**base["data"], "regions": [region] * 13}}
    with pytest.raises(ValueError):
        validate_block(oversize)


def test_asset_keys_include_page_region_crops() -> None:
    document = build_document(title="测试", source=_source_with_regions())
    keys = asset_keys(document)
    assert "f1_p1" in keys
    assert "f1_p1_r1" in keys
    assert "f1_p1_r2" in keys


def test_pdf_vector_region_labels_from_text_layer(tmp_path: Path) -> None:
    """矢量图示内部的文字层行应成为相对裁剪图的标签热区。"""
    document = pymupdf.open()
    page = document.new_page(width=400, height=300)
    page.draw_rect(pymupdf.Rect(40, 80, 360, 220), color=(0, 0, 0), width=2)
    page.insert_text((60, 130), "Input -> Model -> Output", fontsize=14)
    regions = regions_for_pdf_page(page, _pdf_page_image(page), tmp_path, "f1", 1)
    document.close()

    region = regions[0]
    labels = region["labels"]
    assert labels, "文字层标签应被提取"
    entry = labels[0]
    assert "Input" in entry["text"]
    x0, y0, x1, y1 = entry["bbox"]
    assert 0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1
    # 文字位于裁剪图上半部（页面 y=130 在区域 y=80..220 的 ~36% 处）
    assert 0.1 < y0 < 0.6


def test_pptx_labels_from_inside_textboxes(tmp_path: Path) -> None:
    """图片框内的文本框是标签；下方图注不是。"""
    image_path = tmp_path / "picture.png"
    Image.new("RGB", (200, 120), "white").save(image_path)
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    slide.shapes.add_picture(str(image_path), 914400, 914400, width=4 * 914400, height=2 * 914400)
    # 框内文本框 → 标签；图片下方图注 → caption，不算标签
    inside = slide.shapes.add_textbox(914400, int(1.2 * 914400), 2 * 914400, 300000)
    inside.text_frame.text = "神经元"
    caption = slide.shapes.add_textbox(914400, int(3.1 * 914400), 5 * 914400, 400000)
    caption.text_frame.text = "Figure 1: pipeline"
    preview = Image.new("RGB", (1280, 720), "white")

    regions = regions_for_pptx_slide(
        slide, presentation.slide_width, presentation.slide_height,
        preview, tmp_path, "f1", 1,
    )
    figure = next(region for region in regions if region["kind"] == "figure")
    texts = [label["text"] for label in figure["labels"]]
    assert "神经元" in texts
    assert all("Figure 1" not in text for text in texts)


def test_fill_region_extras_never_runs_formula_ocr(tmp_path: Path, monkeypatch) -> None:
    """P1.1：公式 OCR 移出上传链路——后处理不调用 _math_ocr，区域保留裁剪图。"""
    from app.labs import extract

    region = {
        "id": "f1_p1_r1", "kind": "formula",
        "bbox": [0.1, 0.1, 0.4, 0.2], "asset_id": "f1_p1_r1",
        "label": "公式", "caption": "", "text": "y=x^2",
        "source": "pdf_formula_text", "confidence": 0.8,
        "latex": None, "labels": [], "block_id": None,
    }
    crop_dir = tmp_path / "analysis" / "regions"
    crop_dir.mkdir(parents=True)
    Image.new("RGB", (200, 80), "white").save(crop_dir / "f1_p1_r1.png")

    calls: list[object] = []
    monkeypatch.setattr(extract, "_math_ocr", lambda img: calls.append(img) or "y = x^{2}")
    extract._fill_region_extras([region], tmp_path, {"labels": 2})
    assert calls == [], "上传链路不应同步跑公式 OCR"
    assert "latex" not in region or region["latex"] is None


def test_fill_region_extras_ocr_labels_for_raster(tmp_path: Path, monkeypatch) -> None:
    """栅格图示区域没有文字层标签时走 OCR 检测框（预算约束保留）。"""
    from app.labs import extract

    region = {
        "id": "f1_p1_r2", "kind": "diagram",
        "bbox": [0.1, 0.1, 0.9, 0.6], "asset_id": "f1_p1_r2",
        "label": "结构图", "caption": "", "text": "",
        "source": "pdf_image", "confidence": 0.6,
        "latex": None, "labels": [], "block_id": None,
    }
    crop_dir = tmp_path / "analysis" / "regions"
    crop_dir.mkdir(parents=True)
    Image.new("RGB", (300, 200), "white").save(crop_dir / "f1_p1_r2.png")

    monkeypatch.setattr(
        extract, "_ocr_detections",
        lambda img, limit=8: [{"text": "CPU", "bbox": [0.2, 0.2, 0.5, 0.4]}],
    )
    extract._fill_region_extras([region], tmp_path, {"labels": 3})
    assert region["labels"] == [{"text": "CPU", "bbox": [0.2, 0.2, 0.5, 0.4]}]

    monkeypatch.setattr(
        extract, "_ocr_detections",
        lambda img, limit=8: pytest.fail("预算耗尽不应再调用"),
    )
    extract._fill_region_extras([region], tmp_path, {"labels": 0})


def test_blockify_formula_region_expression_and_params() -> None:
    """latex → expression/params 写回区域，供函数图使用。"""
    source = _source_with_regions()
    region = source["pages"][0]["regions"][1]
    region["latex"] = "y = x^{2} + a"
    blocks, _notes = blockify(source)
    validated = validate_blocks(blocks)
    page = next(block for block in validated if block["type"] == "page")
    linked = next(r for r in page["data"]["regions"] if r["id"] == "f1_p1_r2")
    assert "x^2" in linked["expression"] and "a" in linked["expression"]
    assert linked["params"] == ["a"]
    assert linked["block_id"]

    # 非一元函数（积分）→ 不留 expression，只落 formula 块
    source2 = _source_with_regions()
    source2["pages"][0]["regions"][1]["latex"] = "\\int_{0}^{1} x^{2} dx"
    blocks2, _ = blockify(source2)
    validated2 = validate_blocks(blocks2)
    page2 = next(block for block in validated2 if block["type"] == "page")
    linked2 = next(r for r in page2["data"]["regions"] if r["id"] == "f1_p1_r2")
    assert "expression" not in linked2
    assert linked2["block_id"]


def test_validate_regions_accepts_labels_and_expression() -> None:
    base = {"type": "page", "data": {"alt": "页", "image_key": "p1", "collapsed": False}}
    region = {
        "id": "r1", "kind": "diagram", "bbox": [0.1, 0.1, 0.5, 0.5],
        "asset_id": "r1", "label": "图", "text": "", "source": "pdf_vector",
        "confidence": 0.6,
        "labels": [{"text": "输入", "bbox": [0.1, 0.1, 0.4, 0.3]}],
        "expression": "x^2 + a", "params": ["a"],
    }
    out = validate_block({**base, "data": {**base["data"], "regions": [region]}})
    saved = out["data"]["regions"][0]
    assert saved["labels"] == [{"text": "输入", "bbox": [0.1, 0.1, 0.4, 0.3]}]
    assert saved["expression"] == "x^2 + a"
    assert saved["params"] == ["a"]

    # 非法标签框被剔除而非拒绝整页
    bad = dict(region, labels=[{"text": "", "bbox": [0, 0, 0.5, 0.5]},
                               {"text": "ok", "bbox": [0.6, 0.6, 0.2, 0.2]}])
    out2 = validate_block({**base, "data": {**base["data"], "regions": [bad]}})
    assert "labels" not in out2["data"]["regions"][0]