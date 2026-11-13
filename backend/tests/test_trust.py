"""TrustReport：参数来源、锚点拒收、独立校验、声明一致性与等级。"""

from __future__ import annotations

from app.trust import build_trust_report


def _matrix_spec(*, status: str = "inferred", excerpt: str = "矩阵 [[1, 0], [0, 1]]") -> dict:
    source = {"page": 1, "element_id": "e1", "bbox": None, "status": status, "excerpt": excerpt}
    return {
        "object_id": "spec_matrix",
        "spec_version": "1.0",
        "kind": "geometric",
        "title": "矩阵",
        "parameters": [
            {"id": key, "label": key, "type": "number", "default": value, "source": dict(source)}
            for key, value in (("a", 1), ("b", 0), ("c", 0), ("d", 1))
        ],
        "expressions": [{"id": "det", "expr": "a*d-b*c"}, {"id": "trace", "expr": "a+d"}],
        "views": [{"type": "text", "template": "det = {{det}}"}],
    }


def test_inferred_matrix_is_yellow_then_confirmed_becomes_green() -> None:
    spec = _matrix_spec()
    page_texts = {1: "矩阵 [[1, 0], [0, 1]] det = 1"}
    report = build_trust_report(spec, page_texts)
    assert report["level"] == "yellow"
    assert report["validation"]["status"] == "pass"
    assert all(item["anchor_verified"] for item in report["parameters"])
    assert all(item["status"] == "inferred" for item in report["parameters"])

    for parameter in spec["parameters"]:
        parameter["source"]["status"] = "confirmed"
        parameter["source"]["user_checks"] = [{"decision": "confirm"}]
    confirmed = build_trust_report(spec, page_texts)
    assert confirmed["level"] == "green"
    assert all(item["status"] == "confirmed" for item in confirmed["parameters"])


def test_forged_excerpt_is_red() -> None:
    spec = _matrix_spec(excerpt="原文里根本没有这句话")
    report = build_trust_report(spec, {1: "矩阵 [[1, 0], [0, 1]] det = 1"})
    assert report["level"] == "red"
    assert report["anchor_failures"] >= 1
    assert any(not item["anchor_verified"] for item in report["parameters"])


def test_unsupported_template_is_gray_not_green() -> None:
    spec = {
        "object_id": "spec_text",
        "spec_version": "1.0",
        "kind": "step",
        "parameters": [
            {"id": "x", "label": "x", "type": "number", "default": 1, "source": {"page": 1, "status": "original", "excerpt": "原文"}},
        ],
        "views": [{"type": "text", "template": "x"}],
    }
    report = build_trust_report(spec, {1: "原文 x"})
    assert report["validation"]["status"] == "not_covered"
    assert report["level"] == "gray"


def test_declaration_conflict_turns_red() -> None:
    spec = _matrix_spec()
    report = build_trust_report(spec, {1: "矩阵 [[1, 0], [0, 1]] det = 6"})
    assert report["validation"]["status"] == "pass"
    assert report["declarations"]
    assert report["declarations"][0]["status"] == "fail"
    assert report["level"] == "red"
