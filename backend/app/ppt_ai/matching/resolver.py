"""程序裁决：把规则候选、模型建议与原文证据合成 MatchDecision。"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from ..conditions.validate import validate_template_conditions
from ..recognition_types import (
    ConditionSet,
    MatchCandidate,
    MatchDecision,
    ModelProposal,
    TemplateDescriptor,
)


def _numeric_equal(expected: Any, actual: Any) -> bool:
    if isinstance(expected, bool) or isinstance(actual, bool):
        return expected == actual
    if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
        return abs(float(expected) - float(actual)) <= max(1e-9, abs(float(expected)) * 1e-6)
    if isinstance(expected, list) and isinstance(actual, list):
        return len(expected) == len(actual) and all(_numeric_equal(a, b) for a, b in zip(expected, actual))
    return expected == actual


def _candidate_for(
    candidates: Sequence[MatchCandidate],
    template_id: str,
    version: str,
) -> MatchCandidate | None:
    for candidate in candidates:
        if candidate.template_ref.id == template_id and candidate.template_ref.version == version:
            return candidate
    return None


def resolve_match(
    condition_set: ConditionSet,
    candidates: Sequence[MatchCandidate],
    proposal: ModelProposal | None,
    templates: Mapping[str, TemplateDescriptor],
) -> MatchDecision:
    if not candidates:
        return MatchDecision(
            region_id=condition_set.region_id,
            status="explanation_only",
            condition_hash=condition_set.condition_hash,
            reason="没有召回到已登记模板；保留原稿说明。",
        )

    rule = candidates[0]
    rule_template = templates.get(rule.template_ref.id)
    rule_validation = validate_template_conditions(condition_set, rule_template) if rule_template else None
    model_candidate = None
    model_used = False
    conflicts: list[str] = []
    if proposal is not None and not proposal.abstain:
        for item in proposal.candidates:
            if _candidate_for(candidates, item.template_ref.id, item.template_ref.version) is not None:
                model_candidate = item
                model_used = True
                break

    chosen = rule
    chosen_template = rule_template
    chosen_validation = rule_validation
    model_disagrees = False
    if model_candidate is not None:
        model_template = templates.get(model_candidate.template_ref.id)
        if model_template is None:
            model_used = False
        else:
            model_validation = validate_template_conditions(condition_set, model_template)
            if model_candidate.template_ref.id != rule.template_ref.id:
                model_disagrees = True
                # 强规则且条件完整时以原文证据优先；否则交给模型候选。
                if rule.strong_rule and (rule_validation is not None and rule_validation.complete):
                    chosen = rule
                    chosen_template = rule_template
                    chosen_validation = rule_validation
                elif model_validation.complete:
                    chosen = next(
                        (
                            item
                            for item in candidates
                            if item.template_ref.id == model_candidate.template_ref.id
                            and item.template_ref.version == model_candidate.template_ref.version
                        ),
                        rule,
                    )
                    chosen_template = model_template
                    chosen_validation = model_validation
                conflicts.append(
                    f"模型建议 {model_candidate.template_ref.id} 与规则首选 {rule.template_ref.id} 不一致，需核对。"
                )
            else:
                chosen = rule
                chosen_template = model_template
                chosen_validation = model_validation
    if chosen_validation is None or chosen_template is None:
        return MatchDecision(
            region_id=condition_set.region_id,
            status="unsupported",
            candidates=list(candidates),
            condition_hash=condition_set.condition_hash,
            reason="候选模板未登记或缺少参数契约。",
            rule_strong=rule.strong_rule,
        )

    parameters = dict(chosen_validation.values)
    origin_types = dict(chosen_validation.origin_types)
    condition_ids = list(chosen_validation.sources.values())
    missing = list(chosen_validation.missing)
    for item in chosen_validation.conflicts:
        if item not in conflicts:
            conflicts.append(item)
    if rule.conflicts:
        conflicts.extend(item for item in rule.conflicts if item not in conflicts)
    if chosen.missing:
        missing.extend(item for item in chosen.missing if item not in missing)

    if model_candidate is not None and model_used and model_candidate.template_ref.id == chosen.template_ref.id:
        specs = {spec.name: spec for spec in chosen_template.parameter_specs}
        condition_by_id = {condition.condition_id: condition for condition in condition_set.conditions}
        for parameter in model_candidate.parameters:
            spec = specs.get(parameter.name)
            if spec is None:
                conflicts.append(f"模型提交了未声明参数：{parameter.name}")
                continue
            if parameter.source_condition_id:
                source = condition_by_id.get(parameter.source_condition_id)
                if source is None:
                    conflicts.append(f"模型引用了不存在的来源：{parameter.name}")
                    continue
                expected = source.normalized_value if source.normalized_value is not None else source.value
                if expected is None or not _numeric_equal(expected, parameter.value):
                    conflicts.append(
                        f"模型把「{spec.label}」提取为 {parameter.value}，原文是 {expected}；不自动采用模型值。"
                    )
                    continue
                parameters[parameter.name] = expected
                origin_types[parameter.name] = source.origin_type
                if source.condition_id not in condition_ids:
                    condition_ids.append(source.condition_id)
            elif parameter.origin_type in ("supplement", "teaching", "user_input"):
                if parameter.value is not None and spec.type in ("number", "integer") and not isinstance(parameter.value, (int, float)):
                    conflicts.append(f"模型补充的「{spec.label}」不是数值")
                    continue
                parameters[parameter.name] = parameter.value
                origin_types[parameter.name] = parameter.origin_type
                if parameter.name in missing:
                    missing.remove(parameter.name)
            else:
                conflicts.append(f"模型参数「{spec.label}」缺少来源编号，不能作为执行依据。")
                if parameter.name not in missing:
                    missing.append(parameter.name)
        for item in model_candidate.missing:
            if item not in missing:
                missing.append(item)
        for item in model_candidate.conflicts:
            if item not in conflicts:
                conflicts.append(item)

    blocking = condition_set.blocking()
    if blocking:
        return MatchDecision(
            region_id=condition_set.region_id,
            status="unsupported",
            template_ref=chosen.template_ref,
            condition_hash=condition_set.condition_hash,
            parameters=parameters,
            origin_types=origin_types,
            condition_ids=condition_ids,
            missing=missing,
            conflicts=conflicts + [item.message for item in blocking],
            candidates=list(candidates),
            model_used=model_used,
            rule_strong=rule.strong_rule,
            reason="源区域只有图片/图形，无法核验条件。",
        )

    if conflicts:
        status = "needs_review"
        reason = "；".join(conflicts)[:1000]
    elif missing:
        status = "needs_review"
        reason = "缺少必需条件：" + "、".join(missing)
    elif model_used and model_disagrees:
        status = "needs_review"
        reason = "规则与模型给出不同模板且无法仅凭原文消除冲突。"
    elif chosen.strong_rule or (model_used and model_candidate is not None):
        status = "supported"
        reason = "模板、参数与来源均通过程序核验。"
    else:
        status = "needs_review"
        reason = "候选规则强度不足，需核对后再执行。"
    for item in missing:
        if item not in reason:
            reason = (reason + "；缺少 " + item)[:1000]
            break
    return MatchDecision(
        region_id=condition_set.region_id,
        status=status,  # type: ignore[arg-type]
        template_ref=chosen.template_ref,
        condition_hash=condition_set.condition_hash,
        parameters=parameters,
        origin_types=origin_types,
        condition_ids=condition_ids,
        missing=missing,
        conflicts=conflicts,
        candidates=list(candidates),
        model_used=model_used,
        rule_strong=rule.strong_rule,
        reason=reason,
    )


__all__ = ["resolve_match"]
