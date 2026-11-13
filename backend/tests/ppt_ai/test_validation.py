"""T09/T10：专用视图静态边界、验收报告与有限修复。"""

from __future__ import annotations

import pytest

from types import SimpleNamespace

from app.ppt_ai.generated_views import (
    FORBIDDEN_PROGRAM_TOKENS,
    GeneratedViewError,
    generate_artifact,
    validate_program_static,
)
from app.ppt_ai.repair import repair_bundle
from app.ppt_ai.types import ValidationCase
from app.ppt_ai.validation import validate_bundle
from tests.ppt_ai import helpers


def test_validation_report_separates_categories() -> None:
    _extraction, _plan, bundle = helpers.bundle_for(helpers.chart_snapshot())
    report = validate_bundle(bundle)
    assert report.status == "needs_review"
    assert report.summary["fail"] == 0
    assert report.summary["not_covered"] >= 1
    categories = {rule["category"] for rule in report.rules}
    assert {"source", "math", "program", "interaction", "visual"} <= categories
    assert report.browser["status"] == "skipped"
    assert report.bundle_hash


def test_validation_case_with_residual() -> None:
    _extraction, _plan, bundle = helpers.bundle_for(helpers.chart_snapshot())
    node = helpers.node_of(bundle, "native.chart")
    report = validate_bundle(
        bundle,
        [
            ValidationCase(
                case_id="case_rows",
                target={"node_id": node.node_id},
                inputs={},
                actions=[],
                expected={"rows": 4},
                tolerance=1e-6,
            )
        ],
    )
    case_rule = next(item for item in report.rules if item["rule_id"].startswith("case.case_rows"))
    assert case_rule["status"] == "pass"


def test_browser_failure_marks_report_failed() -> None:
    _extraction, _plan, bundle = helpers.bundle_for(helpers.chart_snapshot())
    report = validate_bundle(
        bundle,
        browser={"status": "failed", "checks": [{"id": "console", "status": "fail"}]},
    )
    assert report.status == "failed"
    assert report.browser["status"] == "failed"


def test_repair_clamps_out_of_range_default_and_keeps_source() -> None:
    _extraction, _plan, bundle = helpers.bundle_for(helpers.integral_snapshot())
    broken = bundle.model_copy(deep=True)
    node = broken.compiled.nodes[0]
    parameter = next(item for item in node.parameters if item.id == "n")
    parameter.default = 999
    broken.seed_values[parameter.concept_id] = 999
    report = validate_bundle(broken)
    assert report.status == "failed"
    repaired, record = repair_bundle(broken, report)
    assert repaired is not None
    assert record["status"] == "repaired"
    fixed = next(item for item in repaired.compiled.nodes[0].parameters if item.id == "n")
    assert fixed.default <= 80
    assert repaired.compiled.nodes[0].source.excerpt == broken.compiled.nodes[0].source.excerpt
    after = validate_bundle(repaired)
    assert after.status != "failed"


def test_repair_does_not_invent_source_for_missing_excerpt() -> None:
    _extraction, _plan, bundle = helpers.bundle_for(helpers.chart_snapshot())
    broken = bundle.model_copy(deep=True)
    broken.compiled.nodes[0].source.excerpt = ""
    report = validate_bundle(broken)
    assert report.status == "failed"
    repaired, record = repair_bundle(broken, report)
    assert repaired is None
    assert record["status"] in ("no_repair", "failed")


def test_forbidden_program_tokens_are_rejected() -> None:
    for token in FORBIDDEN_PROGRAM_TOKENS:
        program = f"function render(input) {{ {token}; return {{version:'ppt-ai.view.1',nodes:[],interactions:[]}}; }}"
        with pytest.raises(GeneratedViewError):
            validate_program_static(program)
    validate_program_static("function render(input) { return {version:'ppt-ai.view.1',nodes:[],interactions:[]}; }")


def test_generated_artifact_is_disabled_by_default_and_valid_when_enabled(monkeypatch) -> None:
    _extraction, _plan, bundle = helpers.bundle_for(helpers.integral_snapshot())
    branch = SimpleNamespace(canonical_values=dict(bundle.seed_values))
    with pytest.raises(GeneratedViewError):
        generate_artifact(bundle, branch, node_id=bundle.compiled.nodes[0].node_id, requirement="展示积分面积")
    monkeypatch.setattr(
        "app.ppt_ai.generated_views.get_settings",
        lambda: SimpleNamespace(ppt_ai_generated_views_enabled=True, ppt_ai_view_timeout_ms=200),
    )
    artifact = generate_artifact(bundle, branch, node_id=bundle.compiled.nodes[0].node_id, requirement="展示积分面积")
    assert artifact.acceptance_status == "pending"
    assert artifact.offline_supported is True
    assert artifact.ast["nodes"]
    assert "render" in artifact.program
