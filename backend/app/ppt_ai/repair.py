"""有检查依据的有限修复：只在候选副本上执行，默认最多一次。

可修复：参数范围/步长、默认值越界、枚举值不在选项、无效 ViewAST、说明型算子
误带参数。不可修复：来源冲突、公式含义不清、未知业务/数学关系——这些进入人工核对。
"""

from __future__ import annotations

import logging
from typing import Any, Mapping

from . import REGISTRY_VERSION, SCHEMA_VERSION
from .contracts import ContractError, validate_contract, validate_view_ast
from .types import InteractionBundle, ValidationReport
from .util import hash_json, new_id, now_iso

logger = logging.getLogger(__name__)


def _bundle_payload(bundle: InteractionBundle) -> dict[str, Any]:
    return {
        "material_id": bundle.material_id,
        "bundle_revision": bundle.bundle_revision + 1,
        "source_revision": bundle.source_revision,
        "source_hash": bundle.source_hash,
        "registry_version": REGISTRY_VERSION,
        "plans": [plan.model_dump(mode="json") for plan in bundle.plans],
        "graph": bundle.graph.model_dump(mode="json"),
        "compiled": bundle.compiled.model_dump(mode="json"),
        "seed_values": bundle.seed_values,
    }


def _fix_parameter(parameter) -> bool:
    changed = False
    if parameter.type == "number" or parameter.type == "integer":
        if parameter.min is not None and parameter.max is not None and parameter.min > parameter.max:
            parameter.min, parameter.max = parameter.max, parameter.min
            changed = True
        if parameter.step is not None and parameter.step <= 0:
            parameter.step = 1.0
            changed = True
        if isinstance(parameter.default, (int, float)) and not isinstance(parameter.default, bool):
            value = float(parameter.default)
            if parameter.min is not None and value < parameter.min:
                parameter.default = int(parameter.min) if parameter.type == "integer" else parameter.min
                changed = True
            elif parameter.max is not None and value > parameter.max:
                parameter.default = int(parameter.max) if parameter.type == "integer" else parameter.max
                changed = True
        elif parameter.default is not None:
            fallback = parameter.min if parameter.min is not None else 0
            parameter.default = int(fallback) if parameter.type == "integer" else float(fallback)
            changed = True
    elif parameter.type == "enum" and parameter.options and str(parameter.default) not in parameter.options:
        parameter.default = parameter.options[0]
        changed = True
    return changed


def repair_bundle(bundle: InteractionBundle, report: ValidationReport) -> tuple[InteractionBundle | None, dict[str, Any]]:
    repaired = bundle.model_copy(deep=True)
    fixes: list[str] = []
    for node in repaired.compiled.nodes:
        if node.operator_id == "explain.text" and node.parameters:
            node.parameters = []
            fixes.append(f"{node.node_id}: 移除说明型算子的参数")
        for parameter in node.parameters:
            if _fix_parameter(parameter):
                fixes.append(f"{node.node_id}.{parameter.id}: 修正范围/默认值")
        valid_views = []
        for view in node.views:
            ast = view.get("ast") if isinstance(view, Mapping) else None
            if ast is not None:
                try:
                    validate_view_ast(ast, registered_bindings=[parameter.concept_id for parameter in node.parameters])
                except ContractError as exc:
                    fixes.append(f"{node.node_id}.{view.get('view_id')}: 移除无效 ViewAST（{exc}）")
                    view = dict(view)
                    view.pop("ast", None)
            valid_views.append(view)
        node.views = valid_views
    for parameter_node in repaired.graph.nodes:
        if parameter_node.concept_id not in repaired.seed_values:
            repaired.seed_values[parameter_node.concept_id] = parameter_node.default
            fixes.append(f"graph.{parameter_node.concept_id}: 补齐种子值")
    for node in repaired.compiled.nodes:
        for parameter in node.parameters:
            if parameter.concept_id not in repaired.seed_values:
                repaired.seed_values[parameter.concept_id] = parameter.default
                fixes.append(f"{node.node_id}.{parameter.concept_id}: 补齐种子值")
                continue
            seed = repaired.seed_values[parameter.concept_id]
            if isinstance(seed, (int, float)) and not isinstance(seed, bool):
                if (parameter.min is not None and seed < parameter.min) or (
                    parameter.max is not None and seed > parameter.max
                ):
                    repaired.seed_values[parameter.concept_id] = parameter.default
                    fixes.append(f"{node.node_id}.{parameter.concept_id}: 修正越界种子值")
    if not fixes:
        return None, {"status": "no_repair", "fixes": [], "reason": "没有可自动修复的字段"}

    payload = _bundle_payload(repaired)
    repaired = repaired.model_copy(
        update={
            "bundle_id": new_id("bundle"),
            "bundle_revision": bundle.bundle_revision + 1,
            "content_hash": hash_json(payload),
            "created_at": now_iso(),
            "status": "active",
        }
    )
    try:
        validate_contract("manifest", repaired.model_dump(mode="json"))
    except ContractError as exc:
        return None, {"status": "failed", "fixes": fixes, "reason": f"修复后契约仍不通过：{exc}"}
    logger.info("PPT AI 有限修复：%d 项，生成候选 bundle %s", len(fixes), repaired.bundle_id)
    return repaired, {
        "status": "repaired",
        "fixes": fixes[:50],
        "before_hash": bundle.content_hash,
        "after_hash": repaired.content_hash,
        "candidate_bundle_id": repaired.bundle_id,
        "candidate_bundle_revision": repaired.bundle_revision,
    }


__all__ = ["repair_bundle"]
