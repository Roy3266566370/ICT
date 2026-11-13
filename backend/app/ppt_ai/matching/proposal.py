"""受限模型候选建议：只允许在召回候选中排序、提取参数与来源，不生成计算代码。"""

from __future__ import annotations

import logging
from typing import Any, Callable, Mapping, Sequence

from ..client import PPTAIClient, PPTAIError
from ..recognition_types import (
    ConditionSet,
    MatchCandidate,
    ModelCandidateProposal,
    ModelParameterProposal,
    ModelProposal,
    TemplateDescriptor,
)
from ..types import CallBudget

logger = logging.getLogger(__name__)

MATCH_SCHEMA_VERSION = "ppt-ai.match.1"
MAX_REGIONS_PER_CALL = 12


def _request_payload(
    condition_sets: Sequence[ConditionSet],
    candidates: Mapping[str, Sequence[MatchCandidate]],
    templates: Mapping[str, TemplateDescriptor],
) -> dict[str, Any]:
    regions: list[dict[str, Any]] = []
    for condition_set in condition_sets[:MAX_REGIONS_PER_CALL]:
        region_candidates = candidates.get(condition_set.region_id, [])
        if not region_candidates:
            continue
        regions.append(
            {
                "region_id": condition_set.region_id,
                "page_no": condition_set.page_no,
                "category": condition_set.category,
                "text": condition_set.text[:1200],
                "formula": condition_set.formula[:800],
                "conditions": [
                    {
                        "condition_id": item.condition_id,
                        "key": item.key,
                        "value": item.normalized_value if item.normalized_value is not None else item.value,
                        "unit": item.normalized_unit or item.unit,
                        "excerpt": item.excerpt[:160],
                    }
                    for item in condition_set.conditions[:40]
                ],
                "candidates": [
                    {
                        "template_id": candidate.template_ref.id,
                        "version": candidate.template_ref.version,
                        "title": templates[candidate.template_ref.id].title
                        if candidate.template_ref.id in templates
                        else "",
                        "description": templates[candidate.template_ref.id].description
                        if candidate.template_ref.id in templates
                        else "",
                        "required_conditions": list(templates[candidate.template_ref.id].required_conditions)
                        if candidate.template_ref.id in templates
                        else [],
                    }
                    for candidate in region_candidates
                ],
            }
        )
    return {"regions": regions}


def _validator(
    condition_sets: Mapping[str, ConditionSet],
    candidates: Mapping[str, Sequence[MatchCandidate]],
    templates: Mapping[str, TemplateDescriptor],
):
    def validate(data: dict[str, Any]) -> None:
        regions = data.get("regions")
        if not isinstance(regions, list):
            raise ValueError("regions 必须是数组")
        if len(regions) > MAX_REGIONS_PER_CALL:
            raise ValueError("regions 超过上限")
        for region in regions:
            if not isinstance(region, Mapping):
                raise ValueError("region 必须是对象")
            region_id = region.get("region_id")
            if region_id not in condition_sets:
                raise ValueError("未知 region_id")
            allowed = {
                (candidate.template_ref.id, candidate.template_ref.version)
                for candidate in candidates.get(str(region_id), [])
            }
            if region.get("abstain") is True:
                continue
            proposed = region.get("candidates")
            if not isinstance(proposed, list):
                raise ValueError("candidates 必须是数组")
            if len(proposed) > 3:
                raise ValueError("每个区域最多 3 个模型候选")
            for item in proposed:
                if not isinstance(item, Mapping):
                    raise ValueError("候选必须是对象")
                ref = item.get("template_ref") if isinstance(item.get("template_ref"), Mapping) else item
                template_id = str(ref.get("id") or ref.get("template_id") or "")
                version = str(ref.get("version") or "")
                if (template_id, version) not in allowed:
                    raise ValueError(f"模型选择了未召回/未登记模板：{template_id}@{version}")
                descriptor = templates.get(template_id)
                if descriptor is None:
                    raise ValueError("模板未登记")
                names = {spec.name for spec in descriptor.parameter_specs}
                parameters = item.get("parameters")
                if not isinstance(parameters, list):
                    raise ValueError("parameters 必须是数组")
                for parameter in parameters:
                    if not isinstance(parameter, Mapping):
                        raise ValueError("parameter 必须是对象")
                    if str(parameter.get("name") or "") not in names:
                        raise ValueError("模型提交了模板未声明的参数")
                    if len(str(parameter.get("note") or "")) > 300:
                        raise ValueError("参数说明过长")
                if len(str(item.get("rationale") or "")) > 1000:
                    raise ValueError("选择理由过长")
        return None

    return validate


def propose_matches(
    condition_sets: Sequence[ConditionSet],
    candidates: Mapping[str, Sequence[MatchCandidate]],
    templates: Mapping[str, TemplateDescriptor],
    client: PPTAIClient | None,
    budget: CallBudget,
    on_attempt: Callable[[int], None] | None = None,
) -> dict[str, Any]:
    """返回 ``{"proposals": [...], "used_calls": n, "error": str | None}``。"""
    requests = _request_payload(condition_sets, candidates, templates)
    if not requests["regions"]:
        return {"proposals": [], "used_calls": 0, "error": None}
    if client is None or not client.available():
        return {"proposals": [], "used_calls": 0, "error": "model_unavailable"}
    if budget.remaining <= 0:
        return {"proposals": [], "used_calls": 0, "error": "budget_exhausted"}
    try:
        response = client.generate_json(
            "match_propose",
            requests,
            MATCH_SCHEMA_VERSION,
            budget,
            validator=_validator(
                {condition_set.region_id: condition_set for condition_set in condition_sets},
                candidates,
                templates,
            ),
            instructions=(
                "只对给定候选排序；每个区域最多 3 个候选。参数必须给出 source_condition_id 或明确标记 "
                "origin_type=supplement。原文没有的数值不得声称来自原文。不能返回模板之外的计算代码。"
            ),
            on_attempt=on_attempt,
        )
    except PPTAIError as exc:
        logger.info("PPT AI 混合匹配建议跳过：%s", exc.kind)
        return {"proposals": [], "used_calls": budget.used_calls, "error": exc.kind}

    proposals: list[ModelProposal] = []
    for region in response.data.get("regions", []):
        if not isinstance(region, Mapping):
            continue
        region_id = str(region.get("region_id") or "")
        if region_id not in {item.region_id for item in condition_sets}:
            continue
        if region.get("abstain") is True:
            proposals.append(ModelProposal(region_id=region_id, abstain=True, reason=str(region.get("reason") or "")[:500]))
            continue
        items = []
        for raw in region.get("candidates", [])[:3]:
            if not isinstance(raw, Mapping):
                continue
            ref = raw.get("template_ref") if isinstance(raw.get("template_ref"), Mapping) else raw
            template_id = str(ref.get("id") or ref.get("template_id") or "")
            descriptor = templates.get(template_id)
            if descriptor is None:
                continue
            parameters = []
            for parameter in raw.get("parameters", [])[:40]:
                if not isinstance(parameter, Mapping):
                    continue
                try:
                    parameters.append(
                        ModelParameterProposal(
                            name=str(parameter.get("name") or ""),
                            value=parameter.get("value"),
                            source_condition_id=(
                                str(parameter.get("source_condition_id"))
                                if parameter.get("source_condition_id")
                                else None
                            ),
                            origin_type=str(parameter.get("origin_type") or "model_inference"),  # type: ignore[arg-type]
                            note=str(parameter.get("note") or "")[:300],
                        )
                    )
                except ValueError:
                    continue
            try:
                items.append(
                    ModelCandidateProposal(
                        template_ref=descriptor.ref,
                        parameters=parameters,
                        missing=[str(item)[:80] for item in raw.get("missing", [])[:40]],
                        conflicts=[str(item)[:200] for item in raw.get("conflicts", [])[:40]],
                        rationale=str(raw.get("rationale") or "")[:1000],
                        confidence=float(raw.get("confidence") or 0.5),
                    )
                )
            except (ValueError, TypeError):
                continue
        try:
            proposals.append(
                ModelProposal(
                    region_id=region_id,
                    abstain=False,
                    candidates=items,
                    reason=str(region.get("reason") or "")[:500],
                )
            )
        except ValueError:
            continue
    return {"proposals": proposals, "used_calls": budget.used_calls, "error": None}


__all__ = ["MATCH_SCHEMA_VERSION", "MAX_REGIONS_PER_CALL", "propose_matches"]
