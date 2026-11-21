"""活页 blockify / enrich / model 的纯函数测试（无 IO、无数据库）。"""

from __future__ import annotations

import pytest

from app.living.blockify import blockify
from app.living.enrich import suggest_for_blocks
from app.living.model import (
    apply_suggestion,
    build_problem_snapshot,
    dismiss_suggestion,
    make_suggestion,
    validate_block,
    validate_blocks,
)


def _source(*, text: str, image_key: str | None = None, method: str = "plain_text") -> dict:
    return {
        "files": [
            {
                "file_id": "f1", "name": "讲义.pdf", "role": "courseware",
                "kind": "pdf", "stored_name": "f1.pdf", "pages": 1,
                "chars": len(text), "methods": [method],
            }
        ],
        "pages": [
            {
                "file_id": "f1", "page": 1, "text": text,
                "method": method, "image_key": image_key,
            }
        ],
        "method": method,
    }


class TestBlockify:
    def test_slide_pdf_preserves_layout_and_compact_page_structure(self) -> None:
        source = _source(text="《课程》\n51\nMulti-head Self-attention\nq\nk\nv", image_key="f1_p1")
        source["pages"][0]["preserve_layout"] = True
        source["pages"][0].update(image_width=1200, image_height=900)
        blocks, _ = blockify(source)
        assert len(blocks) == 4
        assert blocks[1]["data"]["heading"] == "第 1 页 · Multi-head Self-attention"
        assert blocks[2]["data"]["collapsed"] is False
        assert validate_blocks(blocks)[2]["data"]["height"] == 900
        assert validate_blocks(blocks)[3]["data"]["collapsed"] is True

    def test_text_becomes_section_and_text_blocks(self) -> None:
        blocks, notes = blockify(_source(text="第一章\n\n行列式的定义与性质。"))
        kinds = [b["type"] for b in blocks]
        assert kinds[0] == "section"
        assert kinds.count("text") >= 1
        assert notes == []

    def test_page_image_block_is_floor_and_collapsed_when_text_exists(self) -> None:
        blocks, _ = blockify(_source(text="第二页内容", image_key="f1_p2"))
        page_block = next(b for b in blocks if b["type"] == "page")
        assert page_block.get("floor") is True
        assert page_block["data"]["collapsed"] is True
        assert page_block["source"]["page"] == 1

    def test_page_without_text_stays_expanded(self) -> None:
        blocks, _ = blockify(_source(text="", image_key="f1_p1"))
        page_block = next(b for b in blocks if b["type"] == "page")
        assert page_block["data"]["collapsed"] is False

    def test_display_formula_becomes_formula_block(self) -> None:
        blocks, _ = blockify(_source(text="前面\n\n$$A^{-1}=\\frac{1}{\\det A}\\mathrm{adj}(A)$$\n\n后面"))
        kinds = [b["type"] for b in blocks]
        assert "formula" in kinds
        formula = next(b for b in blocks if b["type"] == "formula")
        assert "A^{-1}" in formula["data"]["latex"]

    def test_empty_page_gets_placeholder(self) -> None:
        blocks, _ = blockify(_source(text=""))
        assert any(b["type"] == "text" and "没有读取到文字" in b["data"]["md"] for b in blocks)

    def test_ocr_pages_produce_note(self) -> None:
        _, notes = blockify(_source(text="扫描页", method="pdf_ocr"))
        assert any("OCR" in n for n in notes)

    def test_problem_lines_split_for_suggestion_granularity(self) -> None:
        text = "本章讲解线性方程组。\n解方程组：2x+y-z=8，-3x-y+2z=-11，-2x+y+2z=-3\n例题完。"
        blocks, _ = blockify(_source(text=text))
        texts = [b["data"]["md"] for b in blocks if b["type"] == "text"]
        assert any("解方程组" in t and "本章" not in t for t in texts)


class TestEnrich:
    def test_lecture_explanation_is_not_a_solver_problem(self) -> None:
        block = {"id": "lecture", "type": "text", "data": {
            "md": "神经网络的通用近似定理\n理解神经网络的函数逼近能力，分析网络结构。", "collapsed": True}}
        assert not suggest_for_blocks([block])

    def test_problem_text_gets_lab_suggestion(self) -> None:
        text = "解方程组：2x+y-z=8，-3x-y+2z=-11，-2x+y+2z=-3"
        blocks, _ = blockify(_source(text=text))
        suggestions = suggest_for_blocks(blocks)
        labs = [s for s in suggestions if s["kind"] == "lab"]
        assert labs, "应检测到线性代数题目"
        assert labs[0]["status"] == "pending"
        assert labs[0]["proposal"]["text"].startswith("解方程组")

    def test_plain_prose_gets_no_lab_suggestion(self) -> None:
        blocks, _ = blockify(_source(text="今天天气很好，我们去公园散步聊天。"))
        assert [s for s in suggest_for_blocks(blocks) if s["kind"] == "lab"] == []

    def test_inline_display_math_gets_formula_suggestion(self) -> None:
        text = "由公式 $$E=mc^2$$ 可知质量与能量等价。"
        blocks, _ = blockify(_source(text=text))
        suggestions = suggest_for_blocks(blocks)
        formulas = [s for s in suggestions if s["kind"] == "formula"]
        assert formulas
        assert "E=mc^2" in formulas[0]["proposal"]["latex"]


class TestModel:
    def test_attention_activation_keeps_original_and_source(self) -> None:
        blocks, _ = blockify(_source(text="自注意力机制利用 Query 与 Key 的匹配对 Value 加权。"))
        suggestions = suggest_for_blocks(blocks)
        suggestion = next(s for s in suggestions if s["kind"] == "canvas_object")
        anchor = next(b for b in blocks if b["id"] == suggestion["block_id"])
        document = {"blocks": blocks, "suggestions": suggestions}
        inserted = apply_suggestion(document, suggestion["id"])["inserted"]
        assert inserted[0] == anchor
        # attention 建议物化为真实 v1 画布的 attentionSim 节点，不再是黑盒模板标记
        doc = inserted[1]["data"]["doc"]
        assert doc["version"] == 1
        assert any(n["type"] == "attentionSim" for n in doc["nodes"])
        assert inserted[1]["source"] == anchor["source"]
        validate_blocks(document["blocks"])

    def test_validate_blocks_rejects_dup_id(self) -> None:
        with pytest.raises(ValueError):
            validate_blocks([
                {"id": "b1", "type": "text", "data": {"md": "a"}},
                {"id": "b1", "type": "text", "data": {"md": "b"}},
            ])

    @pytest.mark.parametrize("kind", [None, "", "  ", 123, True, [], {}, "x" * 129, "lab ", "x\x00"])
    def test_validate_block_rejects_bad_type(self, kind) -> None:
        with pytest.raises(ValueError):
            validate_block({"type": kind, "data": {}})

    def test_unknown_block_is_lossless_and_detached(self) -> None:
        import json
        raw = {"id": "future", "type": "vendor.future.v2", "floor": True,
               "source": {"file_id": "f1", "page": 1},
               "data": {"html": '<script>alert(1)</script><img src=x onerror="alert(2)">',
                        "nested": [None, False, 2, 1.5, {"中文": "原样"}],
                        "type": "lab", "problem": {}, "stored_name": "opaque"}}
        result = validate_block(raw)
        assert result == raw
        assert validate_block(json.loads(json.dumps(result))) == raw
        result["data"]["nested"].append("changed")
        assert result != raw

    @pytest.mark.parametrize("data", [None, [], "x", {"x": float("nan")},
        {"x": float("inf")}, {"x": (1, 2)}, {1: "x"}, {"x": object()}])
    def test_unknown_requires_json_object(self, data) -> None:
        with pytest.raises(ValueError):
            validate_block({"type": "future", "data": data})

    def test_unknown_payload_limits(self) -> None:
        from app.living.model import MAX_OPAQUE_BYTES, MAX_OPAQUE_DEPTH, MAX_OPAQUE_NODES
        exact = {"x": "a" * (MAX_OPAQUE_BYTES - 8)}
        assert validate_block({"type": "future", "data": exact})["data"] == exact
        deep = {}
        for _ in range(MAX_OPAQUE_DEPTH + 1):
            deep = {"x": deep}
        cyclic = {}
        cyclic["self"] = cyclic
        for data in ({"x": "a" * (MAX_OPAQUE_BYTES - 7)}, deep, cyclic,
                     {"x": [0] * MAX_OPAQUE_NODES}):
            with pytest.raises(ValueError):
                validate_block({"type": "future", "data": data})
        blocks = [{"id": str(i), "type": "future", "data": exact} for i in range(16)]
        assert len(validate_blocks(blocks)) == 16
        with pytest.raises(ValueError):
            validate_blocks(blocks + [{"id": "extra", "type": "future", "data": {}}])

    @pytest.mark.parametrize("kind,data", [("lab", {}), ("canvas", {}),
        ("canvas", {"doc": {"nodes": [], "template": "ai_model"}}),
        ("embed", {"url": "javascript:alert(1)"})])
    def test_known_types_cannot_fall_back_to_opaque(self, kind, data) -> None:
        with pytest.raises(ValueError):
            validate_block({"type": kind, "data": data})

    @pytest.mark.parametrize("patch", [{"value": "nan"}, {"min": "-inf"},
        {"max": float("inf")}, {"value": True}, {"value": None},
        {"value": "bad"}, {"min": 4}, {"min": 5}, {"value": 5}, {"value": -1}])
    def test_quiz_rejects_invalid_numeric_range(self, patch) -> None:
        with pytest.raises(ValueError):
            validate_block({"type": "quiz", "data": patch})

    @pytest.mark.parametrize("url", ["https://", "http:///path", "//example.com", "https://a:99999",
        "https://a:bad", "https://a:", "https://a:0", "https://user:pass@a", "https://a/\nfoo",
        "https://a b", "https://[bad]", "https://a\\b", "https://a/" + "x" * 2000, 123])
    def test_embed_rejects_invalid_url(self, url) -> None:
        with pytest.raises(ValueError):
            validate_block({"type": "embed", "data": {"url": url}})

    @pytest.mark.parametrize("url", ["", "https://example.com/a?q=1#f", "http://localhost:8080",
                                   "https://[::1]:443/path", "HTTPS://example.com"])
    def test_embed_accepts_valid_url(self, url) -> None:
        assert validate_block({"type": "embed", "data": {"url": url}})["data"]["url"] == url

    def test_legacy_known_blocks_remain_idempotent(self) -> None:
        blocks = [{"id": kind, "type": kind, "data": data} for kind, data in [
            ("page", {"image_key": "p1", "width": 800, "height": 600}),
            ("text", {"md": "旧文档"}), ("figure", {"asset_id": "f1"}),
            ("formula", {"latex": "x^2"}), ("section", {"heading": "章节"}),
            ("lab", {"problem": {"model": {}}}),
            ("canvas", {"doc": {"nodes": [], "template": "attention"}}),
            ("quiz", {}), ("checkpoint", {}), ("embed", {})]]
        normalized = validate_blocks(blocks)
        assert validate_blocks(normalized) == normalized
        assert normalized[7]["data"]["value"] == 1.0
        assert validate_block({"type": "quiz", "data": {"min": 10, "max": 20, "value": 10}})["data"]["value"] == 10

    def test_apply_lab_suggestion_inserts_lab_block(self) -> None:
        text = "解方程组：2x+y-z=8，-3x-y+2z=-11，-2x+y+2z=-3"
        blocks, _ = blockify(_source(text=text))
        suggestions = suggest_for_blocks(blocks)
        lab = next(s for s in suggestions if s["kind"] == "lab")
        document = {
            "blocks": validate_blocks(blocks),
            "suggestions": suggestions,
            "provenance": {"conversion": {"accepted": 0}},
        }
        result = apply_suggestion(document, lab["id"])
        inserted = result["inserted"]
        assert len(inserted) == 1 and inserted[0]["type"] == "lab"
        problem = inserted[0]["data"]["problem"]
        assert problem["subject"] == "linear_algebra"
        assert problem["model"]["engine"] == "gauss_v1"
        assert "states" not in problem
        assert lab["status"] == "accepted"

    def test_dismiss_marks_suggestion(self) -> None:
        blocks, _ = blockify(_source(text="由公式 $$E=mc^2$$ 可知。"))
        suggestions = suggest_for_blocks(blocks)
        target = next(s for s in suggestions if s["kind"] == "formula")
        document = {"blocks": blocks, "suggestions": suggestions}
        dismiss_suggestion(document, target["id"])
        assert target["status"] == "dismissed"
        with pytest.raises(ValueError):
            dismiss_suggestion(document, target["id"])

    def test_formula_suggestion_materializes_split(self) -> None:
        text = "前半句 $$x^2+y^2=1$$ 后半句"
        blocks, _ = blockify(_source(text=text))
        suggestions = suggest_for_blocks(blocks)
        formula = next(s for s in suggestions if s["kind"] == "formula")
        document = {"blocks": validate_blocks(blocks), "suggestions": suggestions}
        result = apply_suggestion(document, formula["id"])
        kinds = [b["type"] for b in result["inserted"]]
        assert kinds == ["text", "formula", "text"]

    def test_problem_snapshot_is_solvable(self) -> None:
        problem = build_problem_snapshot("求矩阵 A=[[2,1],[1,3]] 的逆矩阵")
        assert problem["subject"] == "linear_algebra"
        assert (problem.get("solution") or {}).get("answer_vector") is not None

    def test_snapshot_raises_for_non_problem(self) -> None:
        with pytest.raises(ValueError):
            build_problem_snapshot("今天天气很好去公园散步")

    @pytest.mark.parametrize("heading", [
        "LINEAR ALGEBRA • SPACE VIEW",
        "THE WHOLE MAP",
        "CHAPTER 01",
    ])
    def test_snapshot_rejects_needs_review_hollow_heading(self, heading: str) -> None:
        with pytest.raises(ValueError, match="条件"):
            build_problem_snapshot(heading)
