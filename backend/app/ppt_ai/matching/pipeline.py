"""混合匹配流水线：条件 → 召回 → 模型建议 → 程序裁决 → 模板选项。"""

from __future__ import annotations

from typing import Mapping, Sequence

from ..conditions import extract_conditions
from ..recognition_types import ConditionSet, MatchDecision, ModelProposal
from ..template_packs import TEMPLATE_CATALOG, TEMPLATES_BY_ID, build_option_for_decision
from ..types import InteractionOption, Region, SourceSnapshot
from .recall import recall_candidates
from .resolver import resolve_match


def resolve_requested_regions(
    requested: Sequence[str], regions: Sequence[Region]
) -> tuple[set[str], list[str]]:
    """把重识别请求的 ``region_ids`` 解析为实际区域。

    同时接受规划区域 ID（``rgn_*``）和来源元素 ID（``p04_s14`` 这类 iSpec
    ``object_id`` 中常见的 element_id）：同一元素可能只属于一个区域。返回
    ``(命中的区域 ID 集合, 未命中的请求项)``，未命中项由调用方显式报错，
    避免过滤后得到空规划却不提示。
    """

    matched: set[str] = set()
    unmatched: list[str] = []
    for item in requested:
        hits = {
            region.region_id
            for region in regions
            if item == region.region_id or item in region.element_ids
        }
        if hits:
            matched.update(hits)
        else:
            unmatched.append(item)
    return matched, unmatched


def match_conditions(
    condition_sets: Sequence[ConditionSet],
    proposals: Mapping[str, ModelProposal] | None = None,
) -> tuple[dict[str, list], dict[str, MatchDecision]]:
    """返回 ``(candidates_by_region, decisions_by_region)``。"""
    candidates_by_region: dict[str, list] = {}
    decisions: dict[str, MatchDecision] = {}
    proposals = proposals or {}
    for condition_set in condition_sets:
        candidates = recall_candidates(condition_set, TEMPLATE_CATALOG)
        candidates_by_region[condition_set.region_id] = candidates
        decisions[condition_set.region_id] = resolve_match(
            condition_set,
            candidates,
            proposals.get(condition_set.region_id),
            TEMPLATES_BY_ID,
        )
    return candidates_by_region, decisions


def build_template_options(
    condition_sets: Sequence[ConditionSet],
    regions: Sequence[Region],
    snapshot: SourceSnapshot,
    decisions: Mapping[str, MatchDecision],
) -> dict[str, InteractionOption]:
    by_id = {region.region_id: region for region in regions}
    options: dict[str, InteractionOption] = {}
    for condition_set in condition_sets:
        decision = decisions.get(condition_set.region_id)
        region = by_id.get(condition_set.region_id)
        if decision is None or region is None or decision.template_ref is None:
            continue
        option = build_option_for_decision(decision, condition_set, region, snapshot)
        if option is None:
            continue
        option.provider["matching"] = {
            "status": decision.status,
            "reason": decision.reason,
            "condition_hash": decision.condition_hash,
            "model_used": decision.model_used,
            "rule_strong": decision.rule_strong,
            "top_candidate": (
                {
                    "template_id": decision.candidates[0].template_ref.id,
                    "score": decision.candidates[0].score,
                    "recalls": decision.candidates[0].recalls,
                }
                if decision.candidates
                else None
            ),
            "candidate_count": len(decision.candidates),
        }
        options[condition_set.region_id] = option
    return options


def run_hybrid_matching(
    snapshot: SourceSnapshot,
    regions: Sequence[Region],
    proposals: Mapping[str, ModelProposal] | None = None,
) -> dict[str, object]:
    condition_sets = extract_conditions(snapshot, list(regions))
    candidates, decisions = match_conditions(condition_sets, proposals)
    options = build_template_options(condition_sets, regions, snapshot, decisions)
    return {
        "conditions": condition_sets,
        "candidates": candidates,
        "decisions": decisions,
        "options": options,
    }


__all__ = [
    "build_template_options",
    "match_conditions",
    "resolve_requested_regions",
    "run_hybrid_matching",
]
