"""纯文字/位图课件的离线结构启发式与覆盖统计。"""

from __future__ import annotations

from app.ispec import build_ispecs_detailed
from app.ispec.text_structure import build_text_structure_specs

PAGE_W = 12192000
PAGE_H = 6858000


def _text(element_id: str, text: str, *, x: float, y: float, w: float = 1000000, h: float = 200000) -> dict:
    return {
        "element_id": element_id,
        "kind": "text",
        "text": text,
        "bbox": {"x": x, "y": y, "w": w, "h": h},
        "table_data": None,
        "chart_data": None,
        "math_text": None,
    }


def test_delimited_text_builds_inferred_table() -> None:
    page = {
        "page_no": 3,
        "width": PAGE_W,
        "height": PAGE_H,
        "elements": [
            _text(
                "p03_s01",
                "姓名 | 科目 | 分数\n张三 | 数学 | 95\n李四 | 物理 | 88",
                x=100000,
                y=100000,
                w=6000000,
            )
        ],
    }
    specs = build_text_structure_specs(page, "mat_text")
    assert len(specs) == 1
    spec = specs[0]
    assert spec["kind"] == "filter"
    assert spec["datasets"][0]["columns"] == ["姓名", "科目", "分数"]
    assert spec["datasets"][0]["rows"] == [["张三", "数学", "95"], ["李四", "物理", "88"]]
    assert spec["parameters"][0]["source"]["status"] == "inferred"
    assert spec["parameters"][0]["source"]["excerpt"] == "姓名 | 科目 | 分数"
    assert "分隔符" in spec["notes"]


def test_bbox_grid_text_builds_inferred_table() -> None:
    page = {
        "page_no": 2,
        "width": PAGE_W,
        "height": PAGE_H,
        "elements": [
            _text("p02_s00", "姓名", x=100000, y=100000, w=1000000),
            _text("p02_s01", "科目", x=1500000, y=100000, w=1000000),
            _text("p02_s02", "分数", x=3000000, y=100000, w=1000000),
            _text("p02_s03", "张三", x=100000, y=400000, w=1000000),
            _text("p02_s04", "数学", x=1500000, y=400000, w=1000000),
            _text("p02_s05", "95", x=3000000, y=400000, w=1000000),
            _text("p02_s06", "李四", x=100000, y=700000, w=1000000),
            _text("p02_s07", "物理", x=1500000, y=700000, w=1000000),
            _text("p02_s08", "88", x=3000000, y=700000, w=1000000),
        ],
    }
    specs = build_text_structure_specs(page, "mat_grid")
    assert len(specs) == 1
    spec = specs[0]
    assert spec["datasets"][0]["rows"] == [["张三", "数学", "95"], ["李四", "物理", "88"]]
    assert spec["anchor"]["element_id"] == "p02_s00"
    assert "布局推断" in spec["notes"]


def test_ocr_text_table_marks_source_inferred() -> None:
    page = {
        "page_no": 5,
        "width": PAGE_W,
        "height": PAGE_H,
        "elements": [
            {
                "element_id": "p05_s02",
                "kind": "picture",
                "text": "红 | 白\n40 | 30",
                "recognition_method": "local_ocr",
                "bbox": {"x": 100000, "y": 100000, "w": 2000000, "h": 1000000},
            }
        ],
    }
    specs = build_text_structure_specs(page, "mat_ocr")
    assert len(specs) == 1
    assert specs[0]["parameters"][0]["source"]["status"] == "inferred"
    assert "OCR" in specs[0]["notes"]


def test_ocr_box_layout_recovers_table_without_delimiters() -> None:
    def box(x0: float, y0: float, x1: float, y1: float) -> list[list[float]]:
        return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

    rows = [
        {"box": box(0, 0, 90, 20), "text": "商品", "score": 0.95},
        {"box": box(100, 0, 180, 20), "text": "销量", "score": 0.95},
        {"box": box(0, 30, 90, 50), "text": "苹果", "score": 0.95},
        {"box": box(100, 30, 180, 50), "text": "40", "score": 0.95},
        {"box": box(0, 60, 90, 80), "text": "香蕉", "score": 0.95},
        {"box": box(100, 60, 180, 80), "text": "30", "score": 0.95},
    ]
    page = {
        "page_no": 6,
        "width": PAGE_W,
        "height": PAGE_H,
        "elements": [
            {
                "element_id": "p06_s03",
                "kind": "picture",
                "text": "商品 销量\n苹果 40\n香蕉 30",
                "recognition_method": "local_ocr",
                "image_recognition": {
                    "text": "商品 销量\n苹果 40\n香蕉 30",
                    "rows": rows,
                    "method": "local_ocr",
                },
                "bbox": {"x": 100000, "y": 100000, "w": 2000000, "h": 1500000},
            }
        ],
    }
    specs = build_text_structure_specs(page, "mat_ocr_grid")
    assert len(specs) == 1
    spec = specs[0]
    assert spec["datasets"][0]["rows"] == [["苹果", "40"], ["香蕉", "30"]]
    assert spec["parameters"][0]["source"]["status"] == "inferred"
    assert spec["parameters"][0]["source"]["excerpt"] == "商品 销量"
    assert "OCR" in spec["notes"]


def test_prose_only_page_reports_text_only_coverage() -> None:
    payload = {
        "slides": [
            {
                "page_no": 1,
                "width": PAGE_W,
                "height": PAGE_H,
                "elements": [
                    _text(
                        "p01_s00",
                        "本页只讲解概念，没有公式、表格或可恢复的结构关系。",
                        x=100000,
                        y=100000,
                        w=8000000,
                    )
                ],
            }
        ]
    }
    result = build_ispecs_detailed(payload, material_id="mat_prose")
    assert result.ispecs == []
    coverage = result.recognition["coverage"]
    assert coverage["pages_text_only"] == 1
    assert "文字/位图" in result.recognition["reason"]


def test_ocr_formula_uses_inferred_source_status() -> None:
    payload = {
        "slides": [
            {
                "page_no": 1,
                "width": PAGE_W,
                "height": PAGE_H,
                "elements": [
                    {
                        "element_id": "p01_s00",
                        "kind": "picture",
                        "text": "y = 2*x + 1",
                        "recognition_method": "local_ocr",
                        "bbox": {"x": 100000, "y": 100000, "w": 2000000, "h": 1000000},
                    }
                ],
            }
        ]
    }
    result = build_ispecs_detailed(payload, material_id="mat_ocr_formula")
    assert result.ispecs == []
    assert result.recognition["coverage"]["pages_with_interactions"] == 0
