"""跨页语义关系：候选核对、确认/拆分与新 bundle（不就地篡改旧 bundle）。

确认阶段按「概念组」处理：一次合并一组同名出现，派生引用则把下游参数
绑定到上游输出。任何会产生依赖环或定义域空集的改动都会被拒绝，并在
``/links/preview`` 中先给出影响范围。
"""

from __future__ import annotations

import logging
from typing import Any, Mapping, Sequence

from . import REGISTRY_VERSION, SCHEMA_VERSION
from .contracts import validate_contract
from .evaluation import declared_output_value, default_values, evaluate_model
from .linking import (
    canonical_unit,
    convert_parameter_to_unit,
    convert_to_unit,
    dependency_order,
)
from .types import (
    CanonicalValue,
    CanonicalValues,
    CompiledNode,
    CompiledPayload,
    InteractionBundle,
    LinkDecision,
    ModelRelation,
    SemanticGraph,
)
from .util import hash_json, new_id, now_iso, stable_id

logger = logging.getLogger(__name__)


class RelationConflict(ValueError):
    pass


class RelationCycleError(RelationConflict):
    def __init__(self, message: str, cycles: list[list[str]]) -> None:
        super().__init__(message)
        self.cycles = cycles


def _candidate_members(candidate: Any) -> list[str]:
    members = list(candidate.concept_ids or [])
    for item in (candidate.left_concept_id, candidate.right_concept_id):
        if item and item not in members:
            members.append(item)
    return members


def _candidate_for(bundle: InteractionBundle, candidate_id: str) -> Any:
    candidate = next(
        (item for item in bundle.graph.candidates if item.candidate_id == candidate_id), None
    )
    if candidate is None:
        raise RelationConflict(f"关联候选不存在：{candidate_id}")
    return candidate


def _record_resolution(
    graph: SemanticGraph, candidate: Any, decision: LinkDecision, note: str
) -> None:
    graph.conflicts.append(
        {
            "candidate_id": candidate.candidate_id,
            "decision": decision.decision,
            "relation_type": candidate.relation_type,
            "note": decision.note or note,
        }
    )
    graph.candidates = [
        item for item in graph.candidates if item.candidate_id != candidate.candidate_id
    ]


def _merged_unit(candidate: Any, chosen: str, fallback: str) -> str:
    for occurrence in candidate.occurrences or []:
        if occurrence.get("concept_id") == chosen:
            return str(occurrence.get("unit") or "")
    for occurrence in candidate.occurrences or []:
        if occurrence.get("unit") is not None:
            return str(occurrence.get("unit") or "")
    return fallback


def _candidate_value(candidate: Any, chosen: str) -> CanonicalValue | None:
    for occurrence in candidate.occurrences or []:
        if occurrence.get("concept_id") == chosen:
            value = occurrence.get("default")
            return value if isinstance(value, (int, float, bool, str, list)) else None
    for occurrence in candidate.occurrences or []:
        value = occurrence.get("default")
        if isinstance(value, (int, float, bool, str, list)):
            return value
    return None


def _merged_domain(
    graph: SemanticGraph,
    compiled: CompiledPayload,
    members: Sequence[str],
    target_unit: str,
) -> tuple[float | None, float | None]:
    lowers: list[float] = []
    uppers: list[float] = []
    for node in graph.nodes:
        if node.concept_id not in members:
            continue
        if node.domain.get("min") is not None:
            converted = convert_to_unit(float(node.domain["min"]), node.unit, target_unit)
            lowers.append(converted if converted is not None else float(node.domain["min"]))
        if node.domain.get("max") is not None:
            converted = convert_to_unit(float(node.domain["max"]), node.unit, target_unit)
            uppers.append(converted if converted is not None else float(node.domain["max"]))
    for node in compiled.nodes:
        for parameter in node.parameters:
            if parameter.concept_id not in members:
                continue
            if parameter.min is not None:
                converted = convert_to_unit(float(parameter.min), parameter.unit, target_unit)
                lowers.append(converted if converted is not None else float(parameter.min))
            if parameter.max is not None:
                converted = convert_to_unit(float(parameter.max), parameter.unit, target_unit)
                uppers.append(converted if converted is not None else float(parameter.max))
    lower = max(lowers) if lowers else None
    upper = min(uppers) if uppers else None
    if lower is not None and upper is not None and lower > upper:
        raise RelationConflict(
            f"合并后概念定义域为空：[{lower:g}, {upper:g}]，请先统一范围或拆分。"
        )
    return lower, upper


def _apply_same_parameter(
    graph: SemanticGraph,
    compiled: CompiledPayload,
    candidate: Any,
    decision: LinkDecision,
    concept_remap: dict[str, str] | None = None,
) -> tuple[dict[str, CanonicalValue], list[str]]:
    members = _candidate_members(candidate)
    if concept_remap:
        # 同批先执行的合并可能已经改写过概念 ID；按当前映射解析成员。
        members = [concept_remap.get(member, member) for member in members]
    if len(members) < 2:
        raise RelationConflict("合并候选至少需要两个概念。")
    linked = {
        parameter.concept_id
        for node in compiled.nodes
        for parameter in node.parameters
        if parameter.concept_id in members and parameter.binding.mode == "linked"
    }
    if linked:
        raise RelationConflict(
            "这些概念已被派生引用：" + "、".join(sorted(linked)) + "；请先拆分派生引用再合并。"
        )
    chosen = decision.concept_id or candidate.left_concept_id
    if chosen not in members:
        existing = {
            node.concept_id for node in graph.nodes
        } | {
            parameter.concept_id
            for node in compiled.nodes
            for parameter in node.parameters
        }
        if chosen in existing:
            raise RelationConflict(
                f"目标概念 ID“{chosen}”已被其他概念使用，请换一个保留名称。"
            )
        source = next((node for node in graph.nodes if node.concept_id == members[0]), None)
        if source is None:
            raise RelationConflict(f"概念不存在：{members[0]}")
        graph.nodes.append(source.model_copy(update={"concept_id": chosen}, deep=True))
    fallback_unit = next((node.unit for node in graph.nodes if node.concept_id == chosen), "")
    target_unit = _merged_unit(candidate, chosen, fallback_unit)
    lower, upper = _merged_domain(graph, compiled, members, target_unit)

    notes: list[str] = []
    # 编译参数：改名、统一单位、收紧定义域。超出交集的页面保留原范围并明确提示。
    for node in compiled.nodes:
        for parameter in node.parameters:
            if parameter.concept_id not in members:
                continue
            original_unit = parameter.unit
            if not convert_parameter_to_unit(parameter, target_unit):
                raise RelationConflict(
                    f"参数“{parameter.label}”的单位 {original_unit or '（无）'} "
                    f"无法换算为 {target_unit or '（无）'}，请拆分或先统一单位。"
                )
            if parameter.type in ("number", "integer"):
                default_number = (
                    float(parameter.default)
                    if isinstance(parameter.default, (int, float))
                    and not isinstance(parameter.default, bool)
                    else None
                )
                if lower is not None and (default_number is None or default_number >= lower):
                    parameter.min = lower
                elif lower is not None and default_number is not None:
                    notes.append(
                        f"第 {parameter.source.page} 页参数“{parameter.label}”的默认值 "
                        f"{default_number:g} 低于合并定义域下界 {lower:g}。"
                    )
                if upper is not None and (default_number is None or default_number <= upper):
                    parameter.max = upper
                elif upper is not None and default_number is not None:
                    notes.append(
                        f"第 {parameter.source.page} 页参数“{parameter.label}”的默认值 "
                        f"{default_number:g} 高于合并定义域上界 {upper:g}。"
                    )
            if parameter.concept_id != chosen:
                parameter.concept_id = chosen
                parameter.binding = parameter.binding.model_copy(
                    update={"mode": "free", "concept_id": "", "factor": 1.0}
                )
    # 图节点保留每个出现位置（全局变量面板需要），概念 ID 统一到 chosen。
    anchors = []
    for node in graph.nodes:
        if node.concept_id in members:
            node.concept_id = chosen
            node.unit = target_unit
            node.domain = {
                "min": lower if lower is not None else node.domain.get("min"),
                "max": upper if upper is not None else node.domain.get("max"),
            }
            anchors.append(node.source)
    if decision.value is not None:
        chosen_value = decision.value
        if (
            decision.value_concept_id
            and decision.value_concept_id != chosen
            and isinstance(chosen_value, (int, float))
            and not isinstance(chosen_value, bool)
        ):
            source_unit = next(
                (
                    str(occurrence.get("unit") or "")
                    for occurrence in candidate.occurrences or []
                    if occurrence.get("concept_id") == decision.value_concept_id
                ),
                target_unit,
            )
            converted = convert_to_unit(float(chosen_value), source_unit, target_unit)
            if converted is not None:
                chosen_value = converted
    else:
        chosen_value = _candidate_value(candidate, chosen)
    # 只有用户显式选择值时才覆盖种子；否则保留分支里已调好的值或合并后的默认值。
    seed_patch: dict[str, CanonicalValue] = (
        {chosen: chosen_value}
        if decision.value is not None and chosen_value is not None
        else {}
    )
    # 记录成员→chosen 的映射，供同批后续决策（派生候选）与分支值迁移解析旧 ID。
    if concept_remap is not None:
        for member in members:
            if member != chosen:
                concept_remap[member] = chosen
        # 之前合并到本组成员的概念也要跟着指向新的 chosen。
        for old, current in list(concept_remap.items()):
            if current in members:
                concept_remap[old] = chosen
    graph.relations = [
        relation
        for relation in graph.relations
        if not (
            relation.type == "same_parameter" and set(relation.inputs or []) & set(members)
        )
    ]
    graph.relations.append(
        ModelRelation(
            relation_id=stable_id("candidate", "relation", *sorted(members), chosen),
            type="same_parameter",
            inputs=sorted(set(members)),
            outputs=[chosen],
            source=anchors[:16],
            review_status="confirmed",
            note=decision.note or "用户确认跨页同一概念。",
        )
    )
    return seed_patch, notes


def _find_output_node(compiled: CompiledPayload, concept_id: str) -> tuple[CompiledNode, Any] | None:
    for node in compiled.nodes:
        for output in node.outputs:
            if output.concept_id == concept_id:
                return node, output
    return None


def _apply_derived(
    graph: SemanticGraph,
    compiled: CompiledPayload,
    candidate: Any,
    decision: LinkDecision,
    concept_remap: dict[str, str] | None = None,
) -> tuple[dict[str, CanonicalValue], list[str]]:
    source = None
    if candidate.source_node_id:
        source = next(
            (node for node in compiled.nodes if node.node_id == candidate.source_node_id), None
        )
    output = None
    if source is not None and candidate.source_output:
        output = next(
            (item for item in source.outputs if item.key == candidate.source_output), None
        )
    if source is None or output is None:
        found = _find_output_node(compiled, candidate.left_concept_id)
        if found is None:
            raise RelationConflict(f"派生输出不存在：{candidate.left_concept_id}")
        source, output = found
    # 同批先执行的合并可能把参数概念 ID 改写到了新 ID；按当前映射解析目标概念。
    right = candidate.right_concept_id
    if concept_remap and right in concept_remap:
        right = concept_remap[right]
    # 绑定共享该概念的“全部”参数：只绑首个会让同一概念在不同页读不同值。
    targets = [
        (node, parameter)
        for node in compiled.nodes
        for parameter in node.parameters
        if parameter.concept_id == right
    ]
    notes: list[str] = []
    if targets:
        for _node, parameter in targets:
            if (
                parameter.binding.mode == "linked"
                and parameter.binding.concept_id
                and parameter.binding.concept_id != output.concept_id
            ):
                raise RelationConflict(
                    f"参数“{parameter.label}”已绑定其他派生输出"
                    f"（{parameter.binding.concept_id}）；请先解除原引用再确认。"
                )
            if parameter.type != output.type:
                raise RelationConflict(
                    f"输出“{output.name}”类型 {output.type} 与参数“{parameter.label}”"
                    f"类型 {parameter.type} 不一致，已拒绝绑定。"
                )
            source_unit, source_factor = canonical_unit(output.unit)
            target_unit_name, target_factor = canonical_unit(parameter.unit)
            if source_unit != target_unit_name:
                raise RelationConflict(
                    f"输出单位 {output.unit or '（无）'} 与参数单位 "
                    f"{parameter.unit or '（无）'} 不可换算，已拒绝绑定。"
                )
        for node, parameter in targets:
            _source_unit, source_factor = canonical_unit(output.unit)
            _target_unit_name, target_factor = canonical_unit(parameter.unit)
            factor = (source_factor / target_factor) if target_factor else 1.0
            parameter.binding = parameter.binding.model_copy(
                update={
                    "mode": "linked",
                    "concept_id": output.concept_id,
                    "factor": factor,
                }
            )
        if candidate.conflict_note:
            notes.append(candidate.conflict_note)
    anchors = [source.source]
    for node, _parameter in targets:
        if node.source not in anchors:
            anchors.append(node.source)
    graph.relations = [
        relation
        for relation in graph.relations
        if not (
            relation.type == "derived_from"
            and right in (relation.outputs or [])
        )
    ]
    graph.relations.append(
        ModelRelation(
            relation_id=stable_id(
                "candidate", "derived-relation", output.concept_id, right
            ),
            type="derived_from",
            inputs=[output.concept_id],
            outputs=[right],
            operator_id=source.operator_id,
            source=anchors[:16],
            review_status="confirmed",
            note=decision.note or f"用户确认“{output.name}”输出供下游使用。",
        )
    )
    return {}, notes


def _apply_decisions(
    bundle: InteractionBundle,
    decisions: Sequence[LinkDecision],
    *,
    enforce_cycles: bool = True,
) -> tuple[SemanticGraph, CompiledPayload, dict[str, CanonicalValue], list[dict[str, Any]], dict[str, str]]:
    graph = bundle.graph.model_copy(deep=True)
    compiled = bundle.compiled.model_copy(deep=True)
    seed_patch: dict[str, CanonicalValue] = {}
    diagnostics: list[dict[str, Any]] = []
    concept_remap: dict[str, str] = {}
    resolved = [
        (decision, _candidate_for(bundle, decision.candidate_id))
        for decision in decisions
    ]
    for decision, _candidate in resolved:
        if (
            decision.expected_graph_revision is not None
            and decision.expected_graph_revision != graph.graph_revision
        ):
            raise RelationConflict("关系图已在其他窗口更新，请刷新后重试")
    # 固定处理顺序：先同名合并、再派生引用、最后拒绝/拆分。
    # 否则「先派生后合并」会因合并拒绝 linked 成员而批量报错（顺序敏感）。
    ordered = sorted(
        resolved,
        key=lambda item: (
            0 if item[0].decision == "confirm" and item[1].relation_type != "derived_from"
            else 1 if item[0].decision == "confirm"
            else 2
        ),
    )
    for decision, candidate in ordered:
        if decision.decision == "reject":
            _record_resolution(graph, candidate, decision, "用户拒绝该关联，保持独立概念。")
            continue
        if decision.decision == "split":
            _record_resolution(graph, candidate, decision, "用户认为同名异义，拆分为独立概念。")
            continue
        if candidate.relation_type == "derived_from":
            patch, notes = _apply_derived(graph, compiled, candidate, decision, concept_remap)
        else:
            patch, notes = _apply_same_parameter(graph, compiled, candidate, decision, concept_remap)
        seed_patch.update(patch)
        diagnostics.append(
            {
                "candidate_id": candidate.candidate_id,
                "relation_type": candidate.relation_type,
                "notes": notes,
                "conflict": candidate.conflict,
            }
        )
        graph.candidates = [
            item for item in graph.candidates if item.candidate_id != candidate.candidate_id
        ]
    graph.graph_revision += 1
    graph.conflicts = graph.conflicts[-200:]
    order, cycles = dependency_order(
        compiled.nodes, [node.node_id for node in compiled.nodes]
    )
    graph.dependency_order = order
    if cycles and enforce_cycles:
        titles = {node.node_id: node.title for node in compiled.nodes}
        detail = "；".join(" → ".join(titles.get(node_id, node_id) for node_id in cycle) for cycle in cycles)
        raise RelationCycleError(f"该关联会产生依赖环：{detail}", cycles)
    return graph, compiled, seed_patch, diagnostics, concept_remap


def _build_bundle(
    bundle: InteractionBundle,
    graph: SemanticGraph,
    compiled: CompiledPayload,
    seed_patch: Mapping[str, CanonicalValue] | None = None,
) -> InteractionBundle:
    seed_values: CanonicalValues = {}
    for node in compiled.nodes:
        for parameter in node.parameters:
            if parameter.binding.mode == "linked":
                continue
            seed_values[parameter.concept_id] = bundle.seed_values.get(
                parameter.concept_id, parameter.default
            )
    for concept_id, value in (seed_patch or {}).items():
        seed_values[concept_id] = value
    payload = {
        "material_id": bundle.material_id,
        "bundle_revision": bundle.bundle_revision + 1,
        "source_revision": bundle.source_revision,
        "source_hash": bundle.source_hash,
        "registry_version": REGISTRY_VERSION,
        "plans": [plan.model_dump(mode="json") for plan in bundle.plans],
        "graph": graph.model_dump(mode="json"),
        "compiled": compiled.model_dump(mode="json"),
        "seed_values": seed_values,
    }
    new_bundle = InteractionBundle(
        bundle_id=new_id("bundle"),
        bundle_revision=bundle.bundle_revision + 1,
        schema_version=SCHEMA_VERSION,
        material_id=bundle.material_id,
        source_revision=bundle.source_revision,
        source_hash=bundle.source_hash,
        registry_version=REGISTRY_VERSION,
        status="active",
        content_hash=hash_json(payload),
        plans=bundle.plans,
        graph=graph,
        compiled=compiled,
        seed_values=seed_values,
        created_at=now_iso(),
    )
    validate_contract("manifest", new_bundle.model_dump(mode="json"))
    return new_bundle


def apply_link_decisions_with_remap(
    bundle: InteractionBundle, decisions: list[LinkDecision]
) -> tuple[InteractionBundle, dict[str, str]]:
    """把核对结果编译为新的不可变 bundle，并返回旧概念 → 新概念映射。

    映射供路由层把当前分支值迁移到新分支（合并会改写参数的概念 ID）。
    """

    graph, compiled, seed_patch, diagnostics, concept_remap = _apply_decisions(
        bundle, decisions
    )
    new_bundle = _build_bundle(bundle, graph, compiled, seed_patch)
    logger.info(
        "PPT AI 关联核对：%d 条决定，生成 bundle %s（revision %d），诊断 %d 条",
        len(decisions),
        new_bundle.bundle_id,
        new_bundle.bundle_revision,
        len(diagnostics),
    )
    return new_bundle, concept_remap


def apply_link_decisions(bundle: InteractionBundle, decisions: list[LinkDecision]) -> InteractionBundle:
    """把核对结果编译为新的不可变 bundle（bundle_revision + 1）。"""

    new_bundle, _remap = apply_link_decisions_with_remap(bundle, decisions)
    return new_bundle


def unlink_relation(bundle: InteractionBundle, relation_id: str) -> InteractionBundle:
    """解除一条已确认的派生引用：参数恢复自由，关系从图中移除。

    同名合并不支持单条解除（成员 ID 已被改写）；那种情况用 bundle 回退撤销整次核对。
    """

    graph = bundle.graph.model_copy(deep=True)
    compiled = bundle.compiled.model_copy(deep=True)
    relation = next(
        (item for item in graph.relations if item.relation_id == relation_id), None
    )
    if relation is None:
        raise RelationConflict(f"关系不存在：{relation_id}")
    if relation.type != "derived_from":
        raise RelationConflict(
            "同名合并不支持单条解除；请用 bundle 回退撤销整次核对。"
        )
    freed: list[str] = []
    for node in compiled.nodes:
        for parameter in node.parameters:
            if (
                parameter.binding.mode == "linked"
                and parameter.binding.concept_id in (relation.inputs or [])
                and parameter.concept_id in (relation.outputs or [])
            ):
                parameter.binding = parameter.binding.model_copy(
                    update={"mode": "free", "concept_id": "", "factor": 1.0}
                )
                freed.append(parameter.label)
    graph.relations = [
        item for item in graph.relations if item.relation_id != relation.relation_id
    ]
    graph.graph_revision += 1
    graph.conflicts.append(
        {
            "candidate_id": relation.relation_id,
            "decision": "unlink",
            "relation_type": relation.type,
            "note": "用户解除派生引用"
            + (f"（{ '、'.join(freed[:8]) }）" if freed else "（页面声明对照）")
            + "。",
        }
    )
    graph.conflicts = graph.conflicts[-200:]
    order, cycles = dependency_order(
        compiled.nodes, [node.node_id for node in compiled.nodes]
    )
    graph.dependency_order = order
    if cycles:
        titles = {node.node_id: node.title for node in compiled.nodes}
        detail = "；".join(" → ".join(titles.get(node_id, node_id) for node_id in cycle) for cycle in cycles)
        raise RelationCycleError(f"解除引用后仍存在依赖环：{detail}", cycles)
    new_bundle = _build_bundle(bundle, graph, compiled)
    logger.info(
        "PPT AI 解除派生引用：%s，生成 bundle %s（revision %d），释放 %d 个参数",
        relation_id,
        new_bundle.bundle_id,
        new_bundle.bundle_revision,
        len(freed),
    )
    return new_bundle


def _result_changes(
    before: Mapping[str, Any], after: Mapping[str, Any], node: CompiledNode
) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    for output in node.outputs:
        left = declared_output_value(before, output)
        right = declared_output_value(after, output)
        if left == right:
            continue
        changes.append(
            {
                "key": output.key,
                "concept_id": output.concept_id,
                "label": output.name,
                "before": left,
                "after": right,
            }
        )
    if changes:
        return changes
    before_metrics = {
        str(item.get("id")): item.get("value")
        for item in before.get("metrics", [])
        if isinstance(item, Mapping)
    }
    after_metrics = {
        str(item.get("id")): item.get("value")
        for item in after.get("metrics", [])
        if isinstance(item, Mapping)
    }
    for key in sorted(set(before_metrics) | set(after_metrics)):
        if before_metrics.get(key) == after_metrics.get(key):
            continue
        changes.append(
            {
                "key": key,
                "concept_id": "",
                "label": key,
                "before": before_metrics.get(key),
                "after": after_metrics.get(key),
            }
        )
    return changes[:8]


def preview_link_decisions(
    bundle: InteractionBundle,
    decisions: Sequence[LinkDecision],
    *,
    values: CanonicalValues | None = None,
    overrides: Mapping[str, CanonicalValues] | None = None,
) -> dict[str, Any]:
    """在分支值上做一次假设合并并对比快照；不落库、不修改入参。"""

    base_values = dict(
        values if values is not None else (bundle.seed_values or default_values(bundle))
    )
    before = evaluate_model(bundle, base_values, overrides=overrides)
    graph, compiled, seed_patch, diagnostics, concept_remap = _apply_decisions(
        bundle, decisions, enforce_cycles=False
    )
    preview_bundle = bundle.model_copy(
        update={"graph": graph, "compiled": compiled}, deep=True
    )
    after_values = dict(base_values)
    # 与确认路径同一套迁移规则：合并成员的分支值迁移到保留概念，避免预览 ≠ 实际。
    for old_concept, new_concept in concept_remap.items():
        if old_concept not in after_values:
            continue
        if new_concept not in after_values:
            after_values[new_concept] = after_values[old_concept]
        del after_values[old_concept]
    for concept_id, value in seed_patch.items():
        after_values.setdefault(concept_id, value)
    for decision in decisions:
        if decision.decision != "confirm" or decision.value is None:
            continue
        candidate = next(
            (item for item in bundle.graph.candidates if item.candidate_id == decision.candidate_id),
            None,
        )
        if candidate is not None:
            chosen = decision.concept_id or candidate.left_concept_id
            after_values[chosen] = seed_patch.get(chosen, decision.value)
    after = evaluate_model(preview_bundle, after_values, overrides=overrides)
    _order, cycles = dependency_order(
        compiled.nodes, [node.node_id for node in compiled.nodes]
    )
    affected_nodes: list[dict[str, Any]] = []
    affected_pages: set[int] = set()
    for node in compiled.nodes:
        before_result = before.derived.get(node.node_id, {})
        after_result = after.derived.get(node.node_id, {})
        if hash_json(before_result) == hash_json(after_result):
            continue
        affected_nodes.append(
            {
                "node_id": node.node_id,
                "title": node.title,
                "page": node.source.page,
                "changes": _result_changes(before_result, after_result, node),
                "before_hash": hash_json(before_result),
                "after_hash": hash_json(after_result),
            }
        )
        affected_pages.add(node.source.page)
    conflict_items: list[dict[str, Any]] = []
    for decision in decisions:
        candidate = next(
            (item for item in bundle.graph.candidates if item.candidate_id == decision.candidate_id),
            None,
        )
        if candidate is not None and candidate.conflict:
            conflict_items.append(
                {
                    "candidate_id": candidate.candidate_id,
                    "relation_type": candidate.relation_type,
                    "note": candidate.conflict_note,
                }
            )
    for diagnostic in diagnostics:
        for note in diagnostic.get("notes", []):
            conflict_items.append(
                {
                    "candidate_id": diagnostic["candidate_id"],
                    "relation_type": diagnostic["relation_type"],
                    "note": note,
                }
            )
    return {
        "ok": not cycles,
        "cycles": cycles,
        "cycle_nodes": [
            {
                "node_id": node_id,
                "title": next(
                    (node.title for node in compiled.nodes if node.node_id == node_id), node_id
                ),
            }
            for cycle in cycles
            for node_id in cycle
        ],
        "conflicts": conflict_items,
        "diagnostics": diagnostics,
        "affected_nodes": affected_nodes,
        "affected_pages": sorted(affected_pages),
        "before": {
            "evaluation_hash": before.evaluation_hash,
            "values": before.values,
            "derived_values": before.derived_values,
        },
        "after": {
            "evaluation_hash": after.evaluation_hash,
            "values": after.values,
            "derived_values": after.derived_values,
        },
    }


__all__ = [
    "RelationConflict",
    "RelationCycleError",
    "apply_link_decisions",
    "apply_link_decisions_with_remap",
    "preview_link_decisions",
    "unlink_relation",
]
