"""Phase 1 活变量 / callout / bindings / 判分端点的纯函数测试（无 IO、无数据库）。"""

from __future__ import annotations

import pytest

from app.living.grade import grade_answer
from app.living.model import validate_block, validate_variables


def _block(kind: str, data: dict, **extra: object) -> dict:
    return {"id": "blk_t", "type": kind, "data": data, **extra}


# ---------------------------------------------------------------------------
# variables
# ---------------------------------------------------------------------------


class TestValidateVariables:
    def test_number_normalizes(self) -> None:
        out = validate_variables({"eta": {"label": "学习率", "type": "number", "value": 0.05, "min": 0, "max": 1, "step": 0.01, "unit": ""}})
        assert out["eta"]["value"] == pytest.approx(0.05)
        assert out["eta"]["min"] == 0 and out["eta"]["max"] == 1
        assert "unit" not in out["eta"]  # 空单位不落库

    def test_select_defaults_to_first_option(self) -> None:
        out = validate_variables({"mode": {"type": "select", "options": ["线性", "非线性"], "value": "不存在"}})
        assert out["mode"]["value"] == "线性"

    def test_rejects_bad_name_and_range(self) -> None:
        with pytest.raises(ValueError):
            validate_variables({"1eta": {"type": "number", "value": 0}})
        with pytest.raises(ValueError):
            validate_variables({"eta": {"type": "number", "value": 0.5, "min": 1, "max": 0}})
        with pytest.raises(ValueError):
            validate_variables({"eta": {"type": "number", "value": 2, "min": 0, "max": 1}})
        with pytest.raises(ValueError):
            validate_variables({"mode": {"type": "select", "options": [], "value": ""}})

    def test_rejects_non_mapping_and_unknown_type(self) -> None:
        with pytest.raises(ValueError):
            validate_variables(["not", "a", "mapping"])
        with pytest.raises(ValueError):
            validate_variables({"x": {"type": "vector", "value": 0}})


# ---------------------------------------------------------------------------
# block 级 bindings / outputs / callout / checkpoint.grading
# ---------------------------------------------------------------------------


class TestBlockBindings:
    def test_bindings_passthrough(self) -> None:
        block = validate_block(_block("quiz", {"question": "q", "min": 0, "max": 1, "value": 0.5},
                                      bindings={"lr": "eta"}))
        assert block["bindings"] == {"lr": "eta"}

    def test_canvas_coordinate_key(self) -> None:
        block = validate_block(_block("quiz", {"question": "q", "min": 0, "max": 1, "value": 0.5},
                                      bindings={"node_a.param_x": "eta"}))
        assert block["bindings"] == {"node_a.param_x": "eta"}

    def test_rejects_bad_var_name(self) -> None:
        with pytest.raises(ValueError):
            validate_block(_block("quiz", {"question": "q", "min": 0, "max": 1, "value": 0.5},
                                  bindings={"x": "not a name!"}))

    def test_outputs_reserved_empty_only(self) -> None:
        block = validate_block(_block("quiz", {"question": "q", "min": 0, "max": 1, "value": 0.5},
                                      outputs={}))
        assert block["outputs"] == {}
        with pytest.raises(ValueError, match="outputs"):
            validate_block(_block("quiz", {"question": "q", "min": 0, "max": 1, "value": 0.5},
                                  outputs={"diverge_step": "trace[-1]"}))


class TestCallout:
    @pytest.mark.parametrize("kind", ["theorem", "proof", "example", "warning"])
    def test_all_kinds(self, kind: str) -> None:
        block = validate_block(_block("callout", {"kind": kind, "title": "t", "md": "正文", "collapsible": True}))
        assert block["data"]["kind"] == kind
        assert block["data"]["collapsible"] is True

    def test_rejects_unknown_kind(self) -> None:
        with pytest.raises(ValueError):
            validate_block(_block("callout", {"kind": "tip", "md": "x"}))

    def test_defaults(self) -> None:
        block = validate_block(_block("callout", {"kind": "theorem"}))
        assert block["data"]["title"] == ""
        assert block["data"]["collapsible"] is False


class TestCheckpointGrading:
    def test_default_exact(self) -> None:
        block = validate_block(_block("checkpoint", {"prompt": "p", "expected": "1/2"}))
        assert block["data"]["grading"] == "exact"

    @pytest.mark.parametrize("mode", ["exact", "expr", "numeric"])
    def test_modes(self, mode: str) -> None:
        block = validate_block(_block("checkpoint", {"prompt": "p", "expected": "x", "grading": mode}))
        assert block["data"]["grading"] == mode

    def test_rejects_unknown_mode(self) -> None:
        with pytest.raises(ValueError):
            validate_block(_block("checkpoint", {"prompt": "p", "grading": "fuzzy"}))


# ---------------------------------------------------------------------------
# grade_answer
# ---------------------------------------------------------------------------


class TestGradeExpr:
    @pytest.mark.parametrize("answer,expected", [
        ("1/2", "0.5"),
        ("0.5", "1/2"),
        ("x^2+C", "C+x^2"),
        ("2x", "x+x"),
        ("x^{2}", "x^2"),
        ("sin(x)^2+cos(x)^2", "1"),
    ])
    def test_equivalent(self, answer: str, expected: str) -> None:
        result = grade_answer(answer, expected, "expr")
        assert result["correct"], f"{answer} vs {expected}: {result.get('reason')}"

    @pytest.mark.parametrize("answer,expected", [
        ("sin(x)", "cos(x)"),
        ("x+1", "x^2"),
        ("1/3", "0.5"),
    ])
    def test_not_equivalent(self, answer: str, expected: str) -> None:
        assert grade_answer(answer, expected, "expr")["correct"] is False

    def test_parse_error_is_reported(self) -> None:
        result = grade_answer("x +* 2", "x", "expr")
        assert result["correct"] is False
        assert result["reason"]


class TestGradeNumeric:
    def test_pure_numeric(self) -> None:
        assert grade_answer("0.5", "1/2", "numeric")["correct"] is True
        assert grade_answer("1e-3", "0.001", "numeric")["correct"] is True

    def test_rejects_symbolic(self) -> None:
        result = grade_answer("x+1", "2", "numeric")
        assert result["correct"] is False
        assert "数值" in (result["reason"] or "")


class TestGradeExact:
    def test_normalized_text(self) -> None:
        assert grade_answer("abc", "ab c", "exact")["correct"] is True
        assert grade_answer("答案A", "答案ａ".replace("ａ", "a"), "exact")["correct"] is True

    def test_not_mathematical(self) -> None:
        assert grade_answer("1/2", "0.5", "exact")["correct"] is False


class TestGradeEdge:
    def test_empty_answer(self) -> None:
        assert grade_answer("", "1", "expr")["correct"] is False
        assert grade_answer("  ", "1", "exact")["correct"] is False

    def test_unknown_mode_falls_back_or_rejects(self) -> None:
        result = grade_answer("a", "a", "unknown_mode")
        assert isinstance(result["correct"], bool)


class TestLockedUntil:
    def test_accepts_submitted_and_correct(self) -> None:
        b1 = validate_block(_block("text", {"md": "x"}, locked_until={"block_id": "blk_q1"}))
        assert b1["locked_until"] == {"block_id": "blk_q1", "rule": "submitted"}
        b2 = validate_block(_block("text", {"md": "x"}, locked_until={"block_id": "blk_q1", "rule": "correct"}))
        assert b2["locked_until"] == {"block_id": "blk_q1", "rule": "correct"}

    def test_rejects_self_or_bad_rule(self) -> None:
        with pytest.raises(ValueError, match="自身"):
            validate_block(_block("text", {"md": "x"}, locked_until={"block_id": "blk_t"}))
        with pytest.raises(ValueError, match="rule"):
            validate_block(_block("text", {"md": "x"}, locked_until={"block_id": "blk_q1", "rule": "viewed"}))
