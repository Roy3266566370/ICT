"""模板包：识别说明与确定性内核的注册入口。

新增模板时优先新增独立 pack（描述 + provider 构建器），不要把分支塞进主规划函数。
目录完整性在导入时校验；不完整的模板不会进入可用目录。
"""

from __future__ import annotations

from typing import Iterable

from ..recognition_types import TemplateDescriptor
from ..registry import REGISTRY, RegistryError
from . import calculus, data_structures, deep_learning, optimization, physics

KNOWN_RENDERERS = {
    "taylor",
    "double_integral",
    "newton_1d",
    "least_squares",
    "stack_queue",
    "sorting",
    "activation",
    "conv_pool",
    "projectile",
    "spring",
}


class TemplateCatalogError(ValueError):
    pass


def _all_templates() -> tuple[TemplateDescriptor, ...]:
    return (
        *calculus.TEMPLATES,
        *optimization.TEMPLATES,
        *data_structures.TEMPLATES,
        *deep_learning.TEMPLATES,
        *physics.TEMPLATES,
    )


def validate_templates(templates: Iterable[TemplateDescriptor]) -> tuple[TemplateDescriptor, ...]:
    items = tuple(templates)
    seen: set[tuple[str, str]] = set()
    ids: set[str] = set()
    for template in items:
        key = (template.template_id, template.version)
        if key in seen:
            raise TemplateCatalogError(f"模板编号重复：{template.template_id}@{template.version}")
        seen.add(key)
        if template.template_id in ids:
            raise TemplateCatalogError(f"同一模板出现多个启用版本：{template.template_id}")
        ids.add(template.template_id)
        try:
            operator = REGISTRY.get(template.operator_id)
        except RegistryError as exc:
            raise TemplateCatalogError(f"模板 {template.template_id} 对应算子未登记") from exc
        if template.renderer not in KNOWN_RENDERERS:
            raise TemplateCatalogError(f"模板 {template.template_id} 的前端渲染器未登记：{template.renderer}")
        if not template.parameter_specs and template.template_id != "explain.text":
            raise TemplateCatalogError(f"模板 {template.template_id} 没有参数契约")
        names = [spec.name for spec in template.parameter_specs]
        if len(set(names)) != len(names):
            raise TemplateCatalogError(f"模板 {template.template_id} 参数名重复")
        for name in template.required_conditions:
            if name not in names and name not in ("expression",):
                raise TemplateCatalogError(f"模板 {template.template_id} 的必需条件 {name} 没有对应参数")
        for kind, title in template.views:
            if kind not in ("curve", "table", "text", "metrics", "axes", "heatmap", "scene3d"):
                raise TemplateCatalogError(f"模板 {template.template_id} 的视图类型未登记：{kind}")
        if not operator.offline_supported and template.offline_supported:
            raise TemplateCatalogError(f"模板 {template.template_id} 声称离线，但算子不支持离线")
        if not template.min_runtime_version:
            raise TemplateCatalogError(f"模板 {template.template_id} 缺少最低运行时版本")
    return items


TEMPLATE_CATALOG = validate_templates(_all_templates())
TEMPLATES_BY_ID = {template.template_id: template for template in TEMPLATE_CATALOG}
BUILDERS = {
    **calculus.BUILDERS,
    **optimization.BUILDERS,
    **data_structures.BUILDERS,
    **deep_learning.BUILDERS,
    **physics.BUILDERS,
}


def template_for_id(template_id: str) -> TemplateDescriptor | None:
    return TEMPLATES_BY_ID.get(template_id)


def catalog_snapshot() -> list[dict[str, object]]:
    return [
        {
            "template_id": template.template_id,
            "version": template.version,
            "adapter_version": template.adapter_version,
            "operator_id": template.operator_id,
            "renderer": template.renderer,
            "title": template.title,
            "categories": list(template.categories),
            "required_conditions": list(template.required_conditions),
            "parameters": len(template.parameter_specs),
            "offline_supported": template.offline_supported,
            "min_runtime_version": template.min_runtime_version,
            "pilot": template.pilot,
        }
        for template in TEMPLATE_CATALOG
    ]


def build_option_for_decision(decision, condition_set, region, snapshot):
    if decision.template_ref is None:
        return None
    builder = BUILDERS.get(decision.template_ref.id)
    if builder is None:
        return None
    return builder(decision, condition_set, region, snapshot)


__all__ = [
    "BUILDERS",
    "KNOWN_RENDERERS",
    "TEMPLATE_CATALOG",
    "TEMPLATES_BY_ID",
    "TemplateCatalogError",
    "build_option_for_decision",
    "catalog_snapshot",
    "template_for_id",
    "validate_templates",
]
