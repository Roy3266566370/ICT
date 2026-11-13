"""模板包共用构建器：把一次 MatchDecision 变成 InteractionOption。"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from ..conditions import condition_summary
from ..evidence import build_anchor, build_provenance
from ..recognition_types import ConditionSet, MatchDecision, TemplateDescriptor, TemplateParameterSpec
from ..types import (
    InteractionOption,
    PlanParameter,
    PlanReviewItem,
    PlanView,
    Region,
    SourceAnchor,
    SourceSnapshot,
)
from ..util import stable_id


def region_anchor(region: Region, snapshot: SourceSnapshot, excerpt: str | None = None) -> SourceAnchor:
    return build_anchor(
        material_id=snapshot.material_id,
        page=region.page_no,
        bbox=region.bbox,
        excerpt=(excerpt or (region.evidence[0].text if region.evidence else region.category))[:160],
        source_version=snapshot.document_revision,
        semantic_hash=region.semantic_content_hash,
        node_id=region.node_ids[0] if region.node_ids else None,
        element_id=region.element_ids[0] if region.element_ids else None,
    )


def _placeholder(spec: TemplateParameterSpec):
    if spec.type in ("number", "integer"):
        if spec.min is not None and spec.min > 0:
            return spec.min
        return 0 if spec.type == "integer" else 0.0
    if spec.type == "boolean":
        return False
    if spec.type in ("string", "enum"):
        return spec.options[0] if spec.options else ""
    if spec.type in ("number_list", "vector2"):
        length = spec.shape[0] if spec.shape else 2
        return [0.0] * max(1, length)
    rows = spec.shape[0] if spec.shape else 1
    columns = spec.shape[1] if len(spec.shape) > 1 else 1
    return [[0.0] * max(1, columns) for _ in range(max(1, rows))]


def _condition_for(condition_set: ConditionSet, spec: TemplateParameterSpec):
    for key in (spec.name, *spec.source_keys):
        condition = condition_set.by_key().get(key)
        if condition is not None:
            return condition
    return None


def _make_parameter(
    spec: TemplateParameterSpec,
    *,
    value: Any,
    condition,
    option_anchor: SourceAnchor,
    origin_type: str,
    descriptor: TemplateDescriptor,
    index: int,
) -> PlanParameter:
    anchor = condition.source if condition is not None else option_anchor
    excerpt = condition.excerpt if condition is not None else ""
    origin = origin_type
    if origin == "teaching":
        provenance = build_provenance(
            "teaching",
            evidence="",
            inference=f"「{spec.label}」使用教学探针默认值 {value}，需核对后才可自动执行。",
            method=f"template.{descriptor.template_id}",
        )
    elif origin in ("model_inference", "supplement"):
        provenance = build_provenance(
            origin,
            evidence=excerpt,
            inference=f"由匹配器补充「{spec.label}」；原始来源需人工核对。",
            method=f"template.{descriptor.template_id}",
        )
    else:
        provenance = build_provenance(
            "native" if origin in ("native", "ocr") else "user_input",
            evidence=excerpt or f"{spec.label} = {value}",
            inference="",
            method=f"template.{descriptor.template_id}",
        )
    return PlanParameter(
        concept_id=stable_id(
            "concept", descriptor.template_id, option_anchor.page, spec.name, option_anchor.semantic_content_hash
        ),
        id=spec.name,
        label=spec.label,
        type=spec.type,  # type: ignore[arg-type]
        unit=spec.unit,
        default=value,
        min=spec.min,
        max=spec.max,
        step=spec.step,
        options=list(spec.options),
        shape=list(spec.shape),
        source=anchor,
        provenance=provenance,
    )


def make_option(
    *,
    descriptor: TemplateDescriptor,
    decision: MatchDecision,
    condition_set: ConditionSet,
    region: Region,
    snapshot: SourceSnapshot,
    provider: Mapping[str, Any],
    title: str | None = None,
    question: str | None = None,
    purpose: str | None = None,
    support_status: str | None = None,
    support_reason: str = "",
    review_items: Sequence[PlanReviewItem] | None = None,
) -> InteractionOption:
    anchor = region_anchor(region, snapshot)
    parameters: list[PlanParameter] = []
    missing = set(decision.missing)
    conflicts = list(decision.conflicts)
    for spec in descriptor.parameter_specs:
        origin = decision.parameters.get(spec.name)
        condition = _condition_for(condition_set, spec)
        if origin is None:
            if spec.default is None:
                if spec.required:
                    missing.add(spec.name)
                    value = _placeholder(spec)
                    origin_type = "teaching"
                    parameters.append(
                        _make_parameter(
                            spec,
                            value=value,
                            condition=None,
                            option_anchor=anchor,
                            origin_type=origin_type,
                            descriptor=descriptor,
                            index=len(parameters),
                        )
                    )
                continue
            value = spec.default
            origin_type = "teaching"
            if spec.needs_review_on_default and spec.required:
                missing.add(spec.name)
        else:
            value = origin
            origin_type = decision.origin_types.get(spec.name, "native")
            if not isinstance(origin_type, str):
                origin_type = "native"
            invalid = None
            if spec.type in ("number", "integer") and (
                isinstance(value, bool) or not isinstance(value, (int, float))
            ):
                invalid = "不是数值"
            elif spec.type in ("number", "integer"):
                if spec.type == "integer" and not float(value).is_integer():
                    invalid = "必须是整数"
                elif spec.min is not None and float(value) < spec.min:
                    invalid = f"小于下限 {spec.min}"
                elif spec.max is not None and float(value) > spec.max:
                    invalid = f"大于上限 {spec.max}"
            elif spec.type == "enum" and spec.options and str(value) not in spec.options:
                invalid = "不在可选项中"
            else:
                shape = [len(value)] if isinstance(value, list) and value and not isinstance(value[0], list) else (
                    [len(value), len(value[0])] if isinstance(value, list) and value and isinstance(value[0], list) else []
                )
                if spec.shape and shape != spec.shape:
                    invalid = f"形状应为 {spec.shape}，实际为 {shape}"
            if invalid is not None:
                message = f"「{spec.label}」{invalid}；不能直接执行"
                if message not in conflicts:
                    conflicts.append(message)
                missing.add(spec.name)
                value = _placeholder(spec)
                origin_type = "teaching"
        parameters.append(
            _make_parameter(
                spec,
                value=value,
                condition=condition,
                option_anchor=anchor,
                origin_type=origin_type,
                descriptor=descriptor,
                index=len(parameters),
            )
        )

    review = list(review_items or [])
    for name in sorted(missing):
        spec = next((item for item in descriptor.parameter_specs if item.name == name), None)
        review.append(
            PlanReviewItem(
                item_id=stable_id("review", descriptor.template_id, region.region_id, name),
                kind="initial_value",
                prompt=f"缺少「{spec.label if spec else name}」的原文值；请补充或确认教学默认值。",
                required=True,
                blocking=True,
            )
        )
    for conflict in conflicts:
        review.append(
            PlanReviewItem(
                item_id=stable_id("review", descriptor.template_id, region.region_id, conflict[:60]),
                kind="range",
                prompt=f"条件冲突：{conflict}",
                required=True,
                blocking=True,
            )
        )
    if support_status is None:
        support_status = decision.status
    if support_status == "supported" and (missing or conflicts or review):
        support_status = "needs_review"
    if condition_set.blocking() and support_status == "supported":
        support_status = "unsupported"
        support_reason = "源区域无法读到可核验条件；不生成计算交互。"

    views = [PlanView(view_id=stable_id("view", descriptor.template_id, kind), type=kind, title=title_) for kind, title_ in descriptor.views]
    provider_payload = {
        "kind": descriptor.renderer,
        "template_ref": descriptor.ref.as_dict(),
        "parameters": {parameter.id: parameter.default for parameter in parameters},
        "conditions": condition_summary(condition_set),
        **dict(provider),
    }
    return InteractionOption(
        option_id=stable_id("option", region.region_id, descriptor.template_id, descriptor.version),
        region_id=region.region_id,
        title=(title or descriptor.title)[:120],
        question=(question or f"调参数后，{descriptor.title}的结果会怎样变化？")[:500],
        purpose=(purpose or descriptor.description)[:1000],
        operator_id=descriptor.operator_id,
        support_status=support_status,  # type: ignore[arg-type]
        support_reason=support_reason[:1000],
        parameters=parameters,
        views=views,
        bindings=[
            {"view": "metrics", "source": parameter.concept_id, "mode": "readonly"}
            for parameter in parameters
            if parameter.type in ("number", "integer")
        ],
        review_items=review[:40],
        provider=provider_payload,
        source=anchor,
        offline_supported=descriptor.offline_supported,
    )


__all__ = ["make_option", "region_anchor"]
