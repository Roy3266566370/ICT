"""把规划编译为不可变 InteractionBundle（受限规格 + 登记算子 + 确定性计算）。"""

from __future__ import annotations

import logging
from typing import Any, Mapping, Sequence

from ..ispec.validator import validate_ispec
from . import REGISTRY_VERSION, SCHEMA_VERSION
from .contracts import validate_contract
from .evaluation import (
    EvaluationError,
    KERNEL_VERSION,
    declared_output_value,
    default_values,
    evaluate_node,
)
from .evidence import build_provenance, user_check
from .linking import (
    build_node_outputs,
    dependency_order,
    derived_candidates,
    scan_numeric_declarations,
)
from .planner import build_semantic_graph
from .reconstruction import build_view_ast
from .registry import REGISTRY, CapabilityRegistry, RegistryError
from .types import (
    CanonicalValues,
    CompiledNode,
    CompiledPayload,
    InteractionBundle,
    InteractionOption,
    InteractionPlan,
    ModelNode,
    PlanParameter,
    SemanticGraph,
    SourceSnapshot,
    UserCheck,
)
from .util import hash_json, new_id, now_iso

logger = logging.getLogger(__name__)


class CompileError(ValueError):
    pass


class CompileStaleError(CompileError):
    pass


def _spec_status(parameter: PlanParameter) -> str:
    mapping = {
        "native": "original",
        "ocr": "original",
        "user_input": "confirmed",
        "model_inference": "inferred",
        "teaching": "manual_demo",
        "supplement": "manual_demo",
    }
    return mapping.get(parameter.provenance.origin_type, "inferred")


def _spec_parameter(parameter: PlanParameter) -> dict[str, Any] | None:
    type_map = {
        "number": "number",
        "integer": "integer",
        "boolean": "boolean",
        "enum": "enum",
        "string": "string",
    }
    spec_type = type_map.get(parameter.type)
    if spec_type is None:
        return None
    payload: dict[str, Any] = {
        "id": parameter.id,
        "label": parameter.label,
        "type": spec_type,
        "unit": parameter.unit,
        "default": parameter.default,
        "source": {
            "page": parameter.source.page,
            "element_id": parameter.source.element_id,
            "bbox": None,
            "status": _spec_status(parameter),
            "excerpt": parameter.source.excerpt,
        },
    }
    if parameter.min is not None:
        payload["min"] = parameter.min
    if parameter.max is not None:
        payload["max"] = parameter.max
    if parameter.step is not None and parameter.step > 0:
        payload["step"] = parameter.step
    if spec_type == "enum" and parameter.options:
        payload["options"] = parameter.options
    return payload


def _ispec_projection(node: CompiledNode) -> dict[str, Any] | None:
    parameters = [spec for parameter in node.parameters if (spec := _spec_parameter(parameter)) is not None]
    if not parameters:
        return None
    provider = node.provider if isinstance(node.provider, Mapping) else {}
    kind = provider.get("kind")
    views: list[dict[str, Any]] = []
    datasets: list[dict[str, Any]] = []
    if kind == "chart" and isinstance(provider.get("chart"), Mapping):
        chart = provider["chart"]
        categories = [str(item) for item in chart.get("categories", [])]
        rows: list[list[Any]] = []
        for series in chart.get("series", []) if isinstance(chart.get("series"), list) else []:
            if not isinstance(series, Mapping):
                continue
            for index, value in enumerate(series.get("values", [])):
                if index < len(categories) and isinstance(value, (int, float)):
                    rows.append([categories[index], str(series.get("name") or ""), value])
        datasets.append({"id": "chart_rows", "columns": ["category", "series", "value"], "rows": rows})
        views.append(
            {
                "type": "table",
                "columns": ["category", "series", "value"],
                "title": node.title,
                "dataset": "chart_rows",
            }
        )
    elif kind == "table":
        headers = [str(item) for item in provider.get("headers", [])]
        rows = [[str(cell) for cell in row] for row in provider.get("rows", []) if isinstance(row, list)]
        if headers:
            datasets.append({"id": "table_rows", "columns": headers, "rows": rows})
            views.append({"type": "table", "columns": headers, "title": node.title, "dataset": "table_rows"})
    if not views:
        template = "；".join(f"{parameter.label} = {{{{{parameter.id}}}}}" for parameter in node.parameters)
        views.append({"type": "text", "template": template or node.title, "title": node.title})
    spec = {
        "spec_version": "1.0",
        "object_id": f"pptai_{node.node_id}",
        "title": node.title,
        "kind": "filter" if kind in ("chart", "table") else "parametric",
        "parameters": parameters,
        "expressions": [],
        "datasets": datasets,
        "views": views,
        "constraints": [],
        "checks": [],
        "notes": "由 PPT AI 编译的兼容投影；完整交互以 ppt-ai.2 bundle 为准。",
    }
    if node.source.node_id:
        spec["node_id"] = node.source.node_id
    # iSpec anchor 使用 EMU 坐标；这里拿不到原始页面尺寸，宁可不写锚点，
    # 由 ppt-ai.2 bundle 的原位 bbox 驱动热区，避免用归一化坐标冒充 EMU。
    spec.pop("anchor", None)
    return spec if not validate_ispec(spec) else None


def _apply_overrides(
    option: InteractionOption,
    overrides: Mapping[str, Any],
) -> list[UserCheck]:
    checks: list[UserCheck] = []
    by_id = {parameter.id: parameter for parameter in option.parameters}
    by_concept = {parameter.concept_id: parameter for parameter in option.parameters}
    for key, raw_value in overrides.items():
        parameter = by_id.get(key) or by_concept.get(key)
        if parameter is None:
            raise CompileError(f"参数不存在：{key}")
        range_changed = False
        value = raw_value
        if isinstance(raw_value, Mapping) and "value" in raw_value:
            value = raw_value.get("value")
            if parameter.type in ("number", "integer"):
                if "min" in raw_value and raw_value.get("min") is not None:
                    parameter.min = float(raw_value["min"])
                    range_changed = True
                if "max" in raw_value and raw_value.get("max") is not None:
                    parameter.max = float(raw_value["max"])
                    range_changed = True
                if "step" in raw_value and raw_value.get("step") is not None:
                    step = float(raw_value["step"])
                    if step <= 0:
                        raise CompileError(f"参数 {parameter.label} 的步长必须为正")
                    parameter.step = step
                    range_changed = True
                if parameter.min is not None and parameter.max is not None and parameter.min > parameter.max:
                    raise CompileError(f"参数 {parameter.label} 的最小值大于最大值")
        before = parameter.default
        if parameter.type in ("number", "integer"):
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise CompileError(f"参数 {parameter.label} 必须是数值")
            number = float(value)
            if parameter.type == "integer" and not number.is_integer():
                raise CompileError(f"参数 {parameter.label} 必须是整数")
            if parameter.min is not None and number < parameter.min:
                raise CompileError(f"参数 {parameter.label} 小于允许范围")
            if parameter.max is not None and number > parameter.max:
                raise CompileError(f"参数 {parameter.label} 大于允许范围")
            parameter.default = int(number) if parameter.type == "integer" else number
        elif parameter.type in ("number_list", "number_matrix", "matrix2", "vector2"):
            try:
                validated = PlanParameter.model_validate(
                    {**parameter.model_dump(mode="python"), "default": value}
                )
            except ValueError as exc:
                raise CompileError(f"参数 {parameter.label} 数组值不合法：{exc}") from exc
            parameter.default = validated.default
        elif parameter.type == "boolean":
            if not isinstance(value, bool):
                raise CompileError(f"参数 {parameter.label} 必须是布尔值")
            parameter.default = value
        else:
            text = str(value)
            if parameter.type == "enum" and parameter.options and text not in parameter.options:
                raise CompileError(f"参数 {parameter.label} 不在可选项中")
            parameter.default = text
        from .evidence import provenance_hash

        before_hash = provenance_hash(parameter.provenance)
        parameter.provenance.origin_type = "user_input"
        parameter.provenance.evidence = (
            f"用户核对：{before} → {parameter.default}"
            if not range_changed
            else f"用户核对：{before} → {parameter.default}；范围 [{parameter.min}, {parameter.max}]"
        )
        parameter.provenance.inference = ""
        parameter.provenance.user_checks.append(
            user_check("edit", f"核对参数 {parameter.label}", before_hash, provenance_hash(parameter.provenance))
        )
        parameter.provenance.user_checks = parameter.provenance.user_checks[-50:]
        checks.append(parameter.provenance.user_checks[-1])
        option.review_items = [
            item
            for item in option.review_items
            if not (item.kind in ("initial_value", "range") and parameter.label in item.prompt)
        ]
    if option.review_items:
        option.support_status = "needs_review"
        option.support_reason = "仍有待核对项；在用户确认前不会自动挂载。"
    else:
        option.support_status = "supported"
        option.support_reason = ""
    return checks


def _provider_checks(option: InteractionOption) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    provider = option.provider if isinstance(option.provider, Mapping) else {}
    kind = provider.get("kind")
    if kind == "lab":
        model = provider.get("model")
        if not isinstance(model, Mapping):
            checks.append({"id": "provider", "status": "fail", "message": "Lab 模型缺失"})
        else:
            checks.append({"id": "provider", "status": "pass", "message": "已登记题目求解器模型，由后端内核执行。"})
            if str(model.get("subject") or "") not in ("calculus", "optimization", "algorithm", "deep_learning"):
                checks.append({"id": "subject", "status": "fail", "message": "求解器主题未登记"})
    elif kind == "chart":
        chart = provider.get("chart")
        if not isinstance(chart, Mapping) or not chart.get("categories"):
            checks.append({"id": "provider", "status": "fail", "message": "原生图表分类缺失"})
        else:
            checks.append({"id": "source_match", "status": "pass", "message": "使用 PPTX 原生 chart 数据。"})
    elif kind == "table":
        if not provider.get("headers"):
            checks.append({"id": "provider", "status": "fail", "message": "原生表格表头缺失"})
        else:
            checks.append({"id": "source_match", "status": "pass", "message": "使用 PPTX 原生 table 单元格。"})
    elif kind in ("matrix", "change_of_basis"):
        matrix = provider.get("matrix")
        if not isinstance(matrix, list) or len(matrix) != 2:
            checks.append({"id": "provider", "status": "fail", "message": "矩阵形状不完整"})
        if kind == "change_of_basis" and not isinstance(provider.get("basis_angle_deg"), (int, float)):
            checks.append({"id": "provider", "status": "fail", "message": "换基角度缺失"})
        else:
            checks.append({"id": "dimension", "status": "pass", "message": "2×2 矩阵与向量维度匹配。"})
    elif kind == "expression":
        if not provider.get("expression"):
            checks.append({"id": "provider", "status": "fail", "message": "表达式缺失"})
        else:
            checks.append({"id": "provider", "status": "pass", "message": "受限表达式已登记。"})
    elif kind == "explain":
        checks.append({"id": "provider", "status": "pass", "message": "仅展示原文说明。"})
    elif kind in (
        "taylor", "double_integral", "newton_1d", "least_squares",
        "stack_queue", "sorting", "activation", "conv_pool", "projectile", "spring",
    ):
        from .template_packs import template_for_id

        ref = provider.get("template_ref") if isinstance(provider.get("template_ref"), Mapping) else {}
        template_id = str(ref.get("id") or "") if isinstance(ref, Mapping) else ""
        version = str(ref.get("version") or "") if isinstance(ref, Mapping) else ""
        descriptor = template_for_id(template_id)
        if descriptor is None:
            checks.append({"id": "template", "status": "fail", "message": "模板未登记"})
        elif descriptor.version != version:
            checks.append({"id": "template", "status": "fail", "message": "模板版本不匹配"})
        elif descriptor.renderer != kind:
            checks.append({"id": "template", "status": "fail", "message": "模板渲染器与 provider 不一致"})
        elif descriptor.operator_id != option.operator_id:
            checks.append({"id": "template", "status": "fail", "message": "模板与算子映射不一致"})
        else:
            checks.append({"id": "template", "status": "pass", "message": f"模板 {template_id}@{version} 已登记。"})
    else:
        checks.append({"id": "provider", "status": "fail", "message": "provider 未登记"})
    if option.source.element_id and option.source.excerpt:
        checks.append({"id": "source_evidence", "status": "pass", "message": "区域带有原文摘录。"})
    else:
        checks.append({"id": "source_evidence", "status": "warn", "message": "区域缺少元素或摘录，需人工核对。"})
    return checks


def compile_plan(
    plan: InteractionPlan,
    registry: CapabilityRegistry = REGISTRY,
    *,
    bundle_revision: int = 1,
    selected_option_ids: Sequence[str] | None = None,
    parameter_overrides: Mapping[str, Mapping[str, Any]] | None = None,
    confirmed_option_ids: Sequence[str] | None = None,
    snapshot: SourceSnapshot | None = None,
    graph: SemanticGraph | None = None,
) -> InteractionBundle:
    """编译选中的规划方案；未选中的区域不进入 bundle。"""

    validate_contract("plan", plan.model_dump(mode="json"))
    if snapshot is not None and (
        snapshot.document_revision != plan.source_revision or snapshot.source_hash != plan.source_hash
    ):
        raise CompileStaleError("规划对应的内容版本已变化，请重新识别")
    by_id = {option.option_id: option for option in plan.options}
    if selected_option_ids is None:
        selected = [option for option in plan.options if option.support_status == "supported"]
        if not selected:
            selected = [option for option in plan.options if option.support_status == "explanation_only"]
    else:
        selected = []
        for option_id in selected_option_ids:
            option = by_id.get(option_id)
            if option is None:
                raise CompileError(f"方案不存在：{option_id}")
            if option.support_status == "unsupported":
                raise CompileError(f"方案不可执行：{option_id}")
            selected.append(option)

    overrides = parameter_overrides or {}
    confirmed_ids = set(confirmed_option_ids or [])
    compiled_nodes: list[CompiledNode] = []
    compiled_checks: list[dict[str, Any]] = []
    ispecs: list[dict[str, Any]] = []
    user_checks: list[UserCheck] = []
    default_results: dict[str, dict[str, Any]] = {}

    for option in selected:
        operator = registry.get(option.operator_id)
        option_overrides = overrides.get(option.option_id, {})
        if option_overrides:
            user_checks.extend(_apply_overrides(option, option_overrides))
        provider = option.provider if isinstance(option.provider, Mapping) else {}
        if provider.get("template_ref"):
            option.provider["parameters"] = {
                parameter.id: parameter.default for parameter in option.parameters
            }
        if option.option_id in confirmed_ids:
            blocking = [item for item in option.review_items if item.required and item.blocking]
            for item in option.review_items:
                if item.required and not item.blocking:
                    item.required = False
                    item.answer = "用户已核对"
            if option.support_status == "needs_review":
                if blocking:
                    option.support_reason = "仍有无法绕过的缺失/冲突条件：" + "；".join(
                        item.prompt for item in blocking
                    )[:900]
                else:
                    option.support_status = "supported"
                    option.support_reason = "用户已核对来源、参数与范围。"
        blocking_reviews = [item for item in option.review_items if item.required and item.blocking]
        if blocking_reviews:
            compiled_checks.append(
                {
                    "option_id": option.option_id,
                    "status": "fail",
                    "message": "仍有阻塞条件未解决：" + "；".join(item.prompt for item in blocking_reviews)[:900],
                }
            )
            continue
        if option.operator_id != "explain.text":
            errors = registry.validate_parameters(option.operator_id, option.parameters)
            if errors:
                compiled_checks.append(
                    {"option_id": option.option_id, "status": "fail", "message": "；".join(errors)}
                )
                continue
        provider_checks = _provider_checks(option)
        compiled_checks.extend({"option_id": option.option_id, **item} for item in provider_checks)
        if any(item.get("status") == "fail" for item in provider_checks):
            option.support_status = "unsupported"
            option.support_reason = "；".join(
                str(item.get("message")) for item in provider_checks if item.get("status") == "fail"
            )[:1000]
            continue
        node = CompiledNode(
            node_id=f"ain_{option.option_id}",
            option_id=option.option_id,
            region_id=option.region_id,
            operator_id=option.operator_id,
            title=option.title,
            parameters=option.parameters,
            outputs=build_node_outputs(f"ain_{option.option_id}", operator.derived_outputs),
            views=[],
            provider=option.provider,
            checks=provider_checks,
            offline_supported=operator.offline_supported and option.offline_supported,
            source=option.source,
            learning=option.learning,
        )
        seed = {parameter.concept_id: parameter.default for parameter in option.parameters}
        try:
            evaluated = evaluate_node(node, seed)
        except (EvaluationError, ValueError, TypeError) as exc:
            compiled_checks.append(
                {"option_id": option.option_id, "status": "fail", "message": f"默认值求值失败：{exc}"}
            )
            continue
        if evaluated["violations"]:
            compiled_checks.append(
                {
                    "option_id": option.option_id,
                    "status": "fail",
                    "message": "默认值求值存在违反条件",
                    "evidence": evaluated["violations"],
                }
            )
            continue
        views = []
        for plan_view in option.views:
            view: dict[str, Any] = {
                "view_id": plan_view.view_id,
                "type": plan_view.type,
                "title": plan_view.title,
                "binding": plan_view.binding,
            }
            ast = build_view_ast(
                node.model_dump(mode="json"),
                {"derived": {node.node_id: evaluated["result"]}},
            )
            if ast is not None and plan_view.type in ("curve", "metrics"):
                view["ast"] = ast
            views.append(view)
        node.views = views
        node.checks = [*provider_checks, *evaluated["checks"]]
        default_results[node.node_id] = evaluated["result"]
        compiled_nodes.append(node)
        ispec = _ispec_projection(node)
        if ispec is not None:
            ispecs.append(ispec)

    seed_values: CanonicalValues = {}
    for node in compiled_nodes:
        for parameter in node.parameters:
            if parameter.binding.mode == "linked":
                continue
            seed_values.setdefault(parameter.concept_id, parameter.default)

    semantic_graph = graph.model_copy(deep=True) if graph is not None else build_semantic_graph(selected)

    output_nodes: list[ModelNode] = []
    for node in compiled_nodes:
        result = default_results.get(node.node_id, {})
        for output in node.outputs:
            value = declared_output_value(result, output)
            if value is None:
                value = (
                    0.0
                    if output.type in ("number", "integer")
                    else False
                    if output.type == "boolean"
                    else ""
                    if output.type in ("string", "enum")
                    else []
                )
            output_nodes.append(
                ModelNode(
                    concept_id=output.concept_id,
                    name=output.name,
                    type=output.type,
                    unit=output.unit,
                    dimension={
                        "vector2": "vector",
                        "number_list": "vector",
                        "matrix2": "matrix",
                        "number_matrix": "matrix",
                    }.get(output.type, "scalar"),
                    domain={},
                    default=value,
                    source=node.source,
                    semantic_role="derived_output",
                    provenance=build_provenance(
                        "model_inference",
                        inference=f"由算子 {node.operator_id} 声明的输出“{output.key}”，随节点求值更新。",
                        method="operator_output",
                    ),
                )
            )
    declarations = scan_numeric_declarations(
        snapshot,
        [output for node in compiled_nodes for output in node.outputs],
        material_id=plan.material_id,
        source_version=plan.source_revision,
    )
    known_nodes = {item.concept_id for item in semantic_graph.nodes}
    semantic_graph.nodes.extend(item for item in output_nodes if item.concept_id not in known_nodes)
    semantic_graph.nodes.extend(item for item in declarations if item.concept_id not in known_nodes)
    active_concepts = {
        parameter.concept_id for node in compiled_nodes for parameter in node.parameters
    } | {output.concept_id for node in compiled_nodes for output in node.outputs} | {
        item.concept_id for item in declarations
    }
    if active_concepts:
        semantic_graph.nodes = [
            node for node in semantic_graph.nodes if node.concept_id in active_concepts
        ]
        semantic_graph.candidates = [
            candidate
            for candidate in semantic_graph.candidates
            if candidate.left_concept_id in active_concepts
            and candidate.right_concept_id in active_concepts
        ]
    derived = derived_candidates(compiled_nodes, default_results, declarations)
    existing_candidates = {item.candidate_id for item in semantic_graph.candidates}
    semantic_graph.candidates.extend(
        item for item in derived if item.candidate_id not in existing_candidates
    )
    semantic_graph.candidates = semantic_graph.candidates[:1000]
    semantic_graph.conflicts.extend(
        {"candidate_id": item.candidate_id, "note": item.conflict_note}
        for item in semantic_graph.candidates
        if item.conflict
    )
    semantic_graph.conflicts = semantic_graph.conflicts[-200:]
    order, cycles = dependency_order(
        compiled_nodes, [node.node_id for node in compiled_nodes]
    )
    if cycles:
        compiled_checks.append(
            {
                "status": "fail",
                "message": "节点依赖成环，拒绝上线：" + "；".join(" → ".join(cycle) for cycle in cycles),
            }
        )
    semantic_graph.dependency_order = order

    compiled = CompiledPayload(
        nodes=compiled_nodes,
        order=[node.node_id for node in compiled_nodes],
        ispecs=ispecs,
        checks=compiled_checks,
        resources=[],
    )
    created_at = now_iso()
    payload_for_hash = {
        "material_id": plan.material_id,
        "bundle_revision": bundle_revision,
        "source_revision": plan.source_revision,
        "source_hash": plan.source_hash,
        "registry_version": REGISTRY_VERSION,
        "plans": [plan.model_dump(mode="json")],
        "graph": semantic_graph.model_dump(mode="json"),
        "compiled": compiled.model_dump(mode="json"),
        "seed_values": seed_values,
    }
    content_hash = hash_json(payload_for_hash)
    bundle = InteractionBundle(
        bundle_id=new_id("bundle"),
        bundle_revision=max(1, int(bundle_revision)),
        schema_version=SCHEMA_VERSION,
        material_id=plan.material_id,
        source_revision=plan.source_revision,
        source_hash=plan.source_hash,
        registry_version=REGISTRY_VERSION,
        status="active",
        content_hash=content_hash,
        plans=[plan],
        graph=semantic_graph,
        compiled=compiled,
        seed_values=seed_values,
        created_at=created_at,
    )
    validate_contract("manifest", bundle.model_dump(mode="json"))
    logger.info(
        "PPT AI 编译完成：bundle=%s 节点 %d，iSpec 投影 %d，用户核对 %d",
        bundle.bundle_id,
        len(compiled_nodes),
        len(ispecs),
        len(user_checks),
    )
    return bundle


def bundle_hash(bundle: InteractionBundle) -> str:
    return hash_json(bundle.model_dump(mode="json"))


__all__ = [
    "CompileError",
    "CompileStaleError",
    "KERNEL_VERSION",
    "bundle_hash",
    "compile_plan",
]
