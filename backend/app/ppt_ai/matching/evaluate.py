"""对照评估适配：把规则/混合匹配结果转换为可比较的选项列表。"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from ..recognition_types import ModelProposal
from ..types import RegionExtractionResult, SourceSnapshot
from .pipeline import run_hybrid_matching


def _proposals_by_region(raw: Mapping[str, Any] | Sequence[Mapping[str, Any]] | None) -> dict[str, ModelProposal]:
    items: Sequence[Mapping[str, Any]] = ()
    if isinstance(raw, Mapping):
        items = raw.get("proposals", []) if isinstance(raw.get("proposals"), list) else []
    elif isinstance(raw, list):
        items = raw
    result: dict[str, ModelProposal] = {}
    for item in items:
        try:
            proposal = ModelProposal.model_validate(item)
        except ValueError:
            continue
        result[proposal.region_id] = proposal
    return result


def apply_match_mode(
    mode: str,
    extraction: RegionExtractionResult,
    snapshot: SourceSnapshot,
    legacy_options: Sequence[Mapping[str, Any]],
    proposals: Mapping[str, Any] | Sequence[Mapping[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    result = run_hybrid_matching(
        snapshot,
        extraction.regions,
        _proposals_by_region(proposals) if mode == "hybrid" else {},
    )
    template_options = result["options"]
    by_region = {region.region_id for region in extraction.regions}
    output: list[dict[str, Any]] = []
    for region_id in by_region:
        option = template_options.get(region_id)  # type: ignore[union-attr]
        if option is not None:
            output.append(option.model_dump(mode="json"))
            continue
        output.extend(
            dict(item) for item in legacy_options if str(item.get("region_id") or "") == region_id
        )
    return output


__all__ = ["apply_match_mode"]
