"""T01：契约、来源与类型边界。"""

from __future__ import annotations

import copy

import pytest
from pydantic import ValidationError

from app.ppt_ai.contracts import ContractError, validate_contract, validate_view_ast
from app.ppt_ai.types import BBox, Provenance, SourceAnchor
from tests.ppt_ai import helpers


def test_region_plan_and_bundle_pass_contracts() -> None:
    extraction, plan, bundle = helpers.bundle_for(helpers.integral_snapshot())
    validate_contract("region", extraction.model_dump(mode="json"))
    validate_contract("plan", plan.model_dump(mode="json"))
    validate_contract("manifest", bundle.model_dump(mode="json"))


def test_extra_fields_are_rejected() -> None:
    extraction, _plan, _bundle = helpers.bundle_for(helpers.chart_snapshot())
    payload = extraction.model_dump(mode="json")
    payload["unexpected"] = "not allowed"
    with pytest.raises(ContractError):
        validate_contract("region", payload)


def test_invalid_bbox_is_rejected() -> None:
    with pytest.raises(ValidationError):
        BBox(x=0.8, y=0.2, w=0.4, h=0.2)
    with pytest.raises(ValidationError):
        BBox(x=0.1, y=0.2, w=0, h=0.2)


def test_direct_source_requires_evidence() -> None:
    with pytest.raises(ValidationError):
        Provenance(origin_type="native", evidence="", inference="")
    with pytest.raises(ValidationError):
        Provenance(origin_type="model_inference", evidence="", inference="")


def test_dangling_view_binding_is_rejected() -> None:
    ast = {
        "version": "ppt-ai.view.1",
        "nodes": [
            {"id": "t", "type": "text", "x": 10, "y": 10, "text": "hi", "binding": "cpt_missing"},
        ],
        "interactions": [],
    }
    with pytest.raises(ContractError):
        validate_view_ast(ast, registered_bindings=["cpt_ok"])
    validate_view_ast(ast, registered_bindings=["cpt_missing", "cpt_ok"])


def test_view_ast_forbids_script_and_duplicate_ids() -> None:
    scripted = {
        "version": "ppt-ai.view.1",
        "nodes": [{"id": "x", "type": "text", "x": 1, "y": 1, "text": "a", "onclick": "alert(1)"}],
        "interactions": [],
    }
    with pytest.raises(ContractError):
        validate_view_ast(scripted)
    duplicated = {
        "version": "ppt-ai.view.1",
        "nodes": [
            {"id": "same", "type": "text", "x": 1, "y": 1, "text": "a"},
            {"id": "same", "type": "text", "x": 2, "y": 2, "text": "b"},
        ],
        "interactions": [],
    }
    with pytest.raises(ContractError):
        validate_view_ast(duplicated)


def test_old_material_without_fields_remains_readable() -> None:
    # 旧材料不需要新字段；快照为空时区域提取应给出可读的“未识别”结论。
    empty = helpers.snapshot("mat_old")
    from app.ppt_ai.regions import extract_regions

    result = extract_regions(empty)
    assert result.regions == []
    assert result.issues[0].code == "no_interactive_regions"


def test_bundle_content_hash_changes_with_content() -> None:
    _extraction, _plan, bundle = helpers.bundle_for(helpers.chart_snapshot())
    changed = bundle.model_copy(deep=True)
    changed.seed_values = {key: ("全部" if index else "一月") for index, key in enumerate(changed.seed_values)}
    from app.ppt_ai.util import hash_json

    assert hash_json(bundle.model_dump(mode="json")) != hash_json(changed.model_dump(mode="json"))
