"""流程图：图结构校验、视觉证据匹配、PPTX 连接线确定性转译。"""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image
from pptx import Presentation
from pptx.enum.shapes import MSO_CONNECTOR
from pptx.util import Emu

from app.documents.regions import regions_for_pptx_slide
from app.living.diagram import (
    cache_key,
    diagram_from_shapes,
    diagram_from_vision,
    validate_diagram,
)


def _doc(nodes=None, edges=None, **kw):
    return {
        "nodes": nodes or [
            {"id": "a", "label": "输入", "x": 0.2, "y": 0.3, "shape": "rect"},
            {"id": "b", "label": "输出", "x": 0.8, "y": 0.7, "shape": "oval"},
        ],
        "edges": edges or [{"from": "a", "to": "b", "label": "经过"}],
        **kw,
    }


def test_validate_diagram_normalizes_and_caps() -> None:
    doc = validate_diagram(_doc(
        nodes=[{"id": "a", "label": "  输入 框 ", "x": -0.5, "y": 1.8, "shape": "DIAMOND"},
               {"id": "b", "label": "x" * 100, "x": 0.5, "y": 0.5, "shape": "weird"}],
        edges=[{"from": "a", "to": "b"}, {"from": "a", "to": "ghost"},
               {"from": "a", "to": "a"}, {"from": "b", "to": "a", "label": "回"}],
        order=["b", "ghost", "a", "a"],
        warnings=["w1", " ", "w3"],
        confidence=7,
    ))
    assert doc["nodes"][0]["shape"] == "diamond"
    assert doc["nodes"][0]["x"] == 0.0 and doc["nodes"][0]["y"] == 1.0
    assert doc["nodes"][1]["shape"] == "rect" and len(doc["nodes"][1]["label"]) == 60
    assert [e["from"] + e["to"] for e in doc["edges"]] == ["ab", "ba"], "悬空/自环边剔除"
    assert doc["order"] == ["b", "a"]
    assert doc["warnings"] == ["w1", "w3"]
    assert doc["confidence"] == 1.0


def test_validate_diagram_rejects_bad_input() -> None:
    with pytest.raises(ValueError):
        validate_diagram({"nodes": []})
    with pytest.raises(ValueError):
        validate_diagram(_doc(nodes=[{"id": "a", "label": "", "x": 0, "y": 0},
                                     {"id": "a", "label": "b", "x": 1, "y": 1}]))
    with pytest.raises(ValueError):
        validate_diagram(_doc(nodes=[{"id": f"n{i}", "label": "", "x": 0, "y": 0}
                                     for i in range(41)]))


def test_diagram_from_vision_evidence_matching() -> None:
    """节点文字应在 OCR 证据里出现；大面积缺失 → 置信度降级 + 警告。"""
    good = diagram_from_vision(_doc(), evidence=["输入数据进入", "输出结果", "经过处理"])
    assert good["confidence"] == 0.5 and not good["warnings"]

    bad = diagram_from_vision(
        _doc(nodes=[{"id": "a", "label": "完全无关", "x": 0.2, "y": 0.3},
                    {"id": "b", "label": "也不沾边", "x": 0.8, "y": 0.7},
                    {"id": "c", "label": "输入", "x": 0.5, "y": 0.5}]),
        evidence=["输入数据进入", "输出结果"],
    )
    assert bad["confidence"] <= 0.35
    assert any("OCR 证据" in w for w in bad["warnings"])


def test_diagram_from_shapes_precise_and_proximity() -> None:
    items = [
        {"entry_id": "10", "box": [0.1, 0.1, 0.3, 0.3], "text": "开始"},
        {"entry_id": "11", "box": [0.6, 0.1, 0.9, 0.3], "text": "处理"},
        {"entry_id": "12", "box": [0.3, 0.6, 0.7, 0.9], "text": "结束",
         "shape_kind": "oval"},
    ]
    connectors = [
        # 精确连接点：shape_id 10 → 11
        {"begin_id": "10", "end_id": "11"},
        # 无连接点 → 端点邻近匹配（n2 中心 0.75,0.2 / n3 中心 0.5,0.75）
        {"begin": [0.74, 0.22], "end": [0.52, 0.73]},
        # 挂不上节点的线被丢弃
        {"begin": [0.0, 0.0], "end": [0.01, 0.01]},
    ]
    doc = diagram_from_shapes(items, connectors)
    assert doc is not None
    assert len(doc["nodes"]) == 3 and len(doc["edges"]) == 2
    pairs = {(e["from"], e["to"]) for e in doc["edges"]}
    assert ("n1", "n2") in pairs and ("n2", "n3") in pairs
    assert doc["nodes"][2]["shape"] == "oval"
    assert doc["cache_key"] == "pptx_shapes"

    # 没有连接线 → 不成图
    assert diagram_from_shapes(items, []) is None


def _pptx_with_connector() -> Presentation:
    """顶层两个文本框 + 一条连接线（无组合）→ 连接线簇。"""
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    slide.shapes.add_textbox(Emu(914400), Emu(914400), Emu(1500000), Emu(600000)
                             ).text_frame.text = "开始"
    slide.shapes.add_textbox(Emu(5400000), Emu(914400), Emu(1500000), Emu(600000)
                             ).text_frame.text = "结束"
    slide.shapes.add_connector(
        MSO_CONNECTOR.STRAIGHT, Emu(2500000), Emu(1200000), Emu(5350000), Emu(1200000))
    return prs


def test_pptx_top_level_connector_cluster_makes_diagram(tmp_path: Path) -> None:
    prs = _pptx_with_connector()
    slide = prs.slides[0]
    preview = Image.new("RGB", (1280, 720), "white")
    regions = regions_for_pptx_slide(
        slide, prs.slide_width, prs.slide_height, preview, tmp_path, "f1", 1)
    assert regions, "文本框+连接线应聚成流程图区域"
    region = regions[0]
    assert region["kind"] == "diagram" and region["source"] == "pptx_connectors"
    diagram = region.get("diagram")
    assert diagram is not None, "确定性转译应直接给出 diagram"
    labels = {node["label"] for node in diagram["nodes"]}
    assert labels == {"开始", "结束"}
    assert len(diagram["edges"]) == 1


def test_cache_key_stable() -> None:
    a = cache_key(b"png-bytes", model="m1")
    assert a == cache_key(b"png-bytes", model="m1")
    assert a != cache_key(b"png-bytes", model="m2")
    assert a != cache_key(b"other", model="m1")
