"""条件集合的程序核验：类型、形状、单位、定义域与缺失项。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..recognition_types import ConditionSet, TemplateDescriptor, TemplateParameterSpec


@dataclass(slots=True)
class ConditionValidation:
    values: dict[str, Any] = field(default_factory=dict)
    missing: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)
    sources: dict[str, str] = field(default_factory=dict)
    origin_types: dict[str, str] = field(default_factory=dict)

    @property
    def complete(self) -> bool:
        return not self.missing and not self.conflicts


def _lookup(condition_set: ConditionSet, spec: TemplateParameterSpec) -> tuple[Any, str | None, str | None]:
    keys = {
        condition_set_key
        for condition_set_key in (spec.name, *spec.source_keys)
        if condition_set_key
    }
    by_key = condition_set.by_key()
    for key in keys:
        condition = by_key.get(key)
        if condition is None:
            continue
        value = condition.normalized_value if condition.normalized_value is not None else condition.value
        if value is not None:
            return value, condition.condition_id, condition.origin_type
    return None, None, None


def _shape(value: Any) -> list[int]:
    if isinstance(value, list) and value and isinstance(value[0], list):
        return [len(value), len(value[0])]
    if isinstance(value, list):
        return [len(value)]
    return []


def _type_ok(spec: TemplateParameterSpec, value: Any) -> bool:
    if spec.type == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if spec.type == "integer":
        return isinstance(value, (int, float)) and not isinstance(value, bool) and float(value).is_integer()
    if spec.type == "boolean":
        return isinstance(value, bool)
    if spec.type in ("string", "enum"):
        return isinstance(value, str)
    if spec.type in ("number_list", "vector2"):
        return isinstance(value, list) and bool(value) and all(isinstance(item, (int, float)) and not isinstance(item, bool) for item in value)
    if spec.type in ("number_matrix", "matrix2"):
        return (
            isinstance(value, list)
            and bool(value)
            and all(isinstance(row, list) and row for row in value)
            and all(isinstance(item, (int, float)) and not isinstance(item, bool) for row in value for item in row)
        )
    return False


def validate_template_conditions(
    condition_set: ConditionSet,
    descriptor: TemplateDescriptor,
) -> ConditionValidation:
    result = ConditionValidation()
    for spec in descriptor.parameter_specs:
        value, condition_id, origin_type = _lookup(condition_set, spec)
        if value is None:
            if spec.required:
                result.missing.append(spec.name)
            if spec.default is not None:
                result.values[spec.name] = spec.default
                result.origin_types[spec.name] = "teaching"
            continue
        if not _type_ok(spec, value):
            result.conflicts.append(f"{spec.label} 的类型不符合模板要求（{spec.type}）")
            continue
        if spec.type == "enum" and spec.options and str(value) not in spec.options:
            result.conflicts.append(f"{spec.label} 不在允许值 {spec.options} 中")
            continue
        shape = _shape(value)
        if spec.shape and shape != spec.shape:
            result.conflicts.append(f"{spec.label} 的形状应为 {spec.shape}，实际为 {shape}")
            continue
        if spec.min is not None and isinstance(value, (int, float)) and not isinstance(value, bool) and float(value) < spec.min:
            result.conflicts.append(f"{spec.label} 小于允许下限 {spec.min}")
            continue
        if spec.max is not None and isinstance(value, (int, float)) and not isinstance(value, bool) and float(value) > spec.max:
            result.conflicts.append(f"{spec.label} 大于允许上限 {spec.max}")
            continue
        result.values[spec.name] = value
        result.origin_types[spec.name] = origin_type or "native"
        if condition_id:
            result.sources[spec.name] = condition_id
    return result


def condition_summary(condition_set: ConditionSet) -> dict[str, Any]:
    """进入 provider 的无隐私摘要；不含 material_id/bbox 等来源定位。"""
    return {
        "contract_version": condition_set.contract_version,
        "condition_hash": condition_set.condition_hash,
        "items": [
            {
                "id": item.condition_id,
                "key": item.key,
                "label": item.label,
                "value": item.normalized_value if item.normalized_value is not None else item.value,
                "unit": item.normalized_unit or item.unit,
                "origin_type": item.origin_type,
                "excerpt": item.excerpt,
                "confidence": item.confidence,
            }
            for item in condition_set.conditions
        ],
        "variables": [
            {
                "name": variable.name,
                "role": variable.role,
                "type": variable.type,
                "unit": variable.unit,
            }
            for variable in condition_set.variables
        ],
        "uncertainties": [
            {"code": item.code, "message": item.message, "severity": item.severity}
            for item in condition_set.uncertainties
        ],
    }


__all__ = ["ConditionValidation", "condition_summary", "validate_template_conditions"]
