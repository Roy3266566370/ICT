"""全表联动：概念规范化、分组候选、依赖拓扑与派生引用。

本模块只做纯函数计算，不读写数据库：

- ``group_same_parameter_candidates`` 把 n 个同名出现聚成一个组候选；
- ``dependency_order`` 用节点间 binding 生成拓扑序，并用 Tarjan 找环；
- ``derived_candidates`` 把算子声明的输出与下游参数/页面数值声明配对；
- ``affected_node_ids`` 沿反向边给出增量求值的影响范围。
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from collections import defaultdict, deque
from typing import Any, Iterable, Mapping, Sequence

from .conditions.normalize import normalize_quantity
from .types import (
    CanonicalValue,
    CompiledNode,
    LinkCandidate,
    ModelNode,
    OutputSpec,
    PlanParameter,
    SourceSnapshot,
)
from .util import hash_json, stable_id

OUTPUT_CONCEPT_PREFIX = "out:"

_GREEK = {
    "α": "alpha",
    "β": "beta",
    "γ": "gamma",
    "δ": "delta",
    "ε": "epsilon",
    "ζ": "zeta",
    "η": "eta",
    "θ": "theta",
    "ι": "iota",
    "κ": "kappa",
    "λ": "lambda",
    "μ": "mu",
    "ν": "nu",
    "ξ": "xi",
    "π": "pi",
    "ρ": "rho",
    "σ": "sigma",
    "τ": "tau",
    "υ": "upsilon",
    "φ": "phi",
    "χ": "chi",
    "ψ": "psi",
    "ω": "omega",
    "Δ": "delta",
    "Σ": "sigma",
    "Ω": "omega",
}

#: 只去掉结构化修饰词；「面积」「速度」等语义词不删，避免把 A 和面积 A 误合并。
_MODIFIERS = ("矩阵", "变换", "参数", "数值", "变量", "向量")
_EN_MODIFIERS = re.compile(r"\b(?:matrix|transformation|parameter|value|variable|vector)\b")
_UNITLESS = {"", "无", "—", "-", "单位", "1"}

_ALIASES = {
    "行列式": "det",
    "迹": "trace",
    "斜率": "slope",
    "截距": "intercept",
    "决定系数": "r_squared",
    "误差": "error",
    "近似值": "approx",
    "解析值": "exact",
    "射程": "range",
    "最高点": "apex",
    "梯度范数": "grad_norm",
    "当前损失": "loss",
    "激活值": "activation_value",
    "矩阵乘积": "product",
    "逆矩阵": "inverse",
    "函数值": "value",
    "切线斜率": "slope",
    "黎曼和": "approx",
    "网格值": "numeric",
    "二阶导": "curvature",
}

_DECLARATION_PATTERN = re.compile(
    r"^\s*(?P<name>[\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9_ ]{0,15}?)\s*[=＝]\s*"
    r"(?P<value>[−-]?\d+(?:\.\d+)?)\s*$"
)


def output_concept_id(node_id: str, key: str) -> str:
    value = f"{OUTPUT_CONCEPT_PREFIX}{node_id}:{key}"
    if len(value) <= 96:
        return value
    return f"out:{stable_id('concept', 'output', node_id, key)}"


def build_node_outputs(node_id: str, outputs: Iterable[OutputSpec]) -> list[OutputSpec]:
    result: list[OutputSpec] = []
    for item in outputs:
        result.append(
            item.model_copy(
                update={
                    "concept_id": output_concept_id(node_id, item.key),
                    "name": item.name or item.key,
                },
                deep=True,
            )
        )
    return result


def normalize_concept_name(text: Any) -> str:
    value = unicodedata.normalize("NFKC", str(text or "")).casefold()
    value = re.sub(r"[（(][^）)]{0,24}[）)]\s*$", "", value)
    for source, target in _GREEK.items():
        value = value.replace(source.casefold(), target)
    for modifier in _MODIFIERS:
        value = value.replace(modifier, "")
    value = _EN_MODIFIERS.sub("", value)
    value = re.sub(r"[\s_\-—–·.,，。:：;；'\"“”‘’\[\]{}<>《》/\\]+", "", value)
    value = _ALIASES.get(value, value)
    return value


def canonical_unit(unit: str) -> tuple[str, float]:
    if str(unit or "").strip() in _UNITLESS:
        return "", 1.0
    converted, target, _note = normalize_quantity(1.0, unit)
    factor = converted if math.isfinite(converted) and converted > 0 else 1.0
    return target, factor


def _shape_of(type_: str, default: CanonicalValue) -> list[int]:
    if type_ in ("number_list",) and isinstance(default, list):
        return [len(default)]
    if type_ == "vector2":
        return [2]
    if type_ in ("number_matrix", "matrix2") and isinstance(default, list):
        rows = [row for row in default if isinstance(row, list)]
        return [len(rows), len(rows[0]) if rows else 0]
    return []


def convert_to_unit(value: float, unit: str, target_unit: str) -> float | None:
    source_name, source_factor = canonical_unit(unit)
    target_name, target_factor = canonical_unit(target_unit)
    if source_name != target_name or not target_factor:
        return None
    return round(float(value) * source_factor / target_factor, 12)


def _canonical_default(type_: str, default: CanonicalValue, factor: float) -> Any:
    if isinstance(default, bool) or isinstance(default, str):
        return default
    if isinstance(default, (int, float)):
        return round(float(default) * factor, 12)
    return json.loads(json.dumps(default, sort_keys=True))


def _values_equal(left: Any, right: Any) -> bool:
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return abs(float(left) - float(right)) <= max(1e-9, abs(float(left)) * 1e-9)
    return left == right


def _domain_intersection(items: Sequence[ModelNode]) -> tuple[float | None, float | None, bool]:
    lowers: list[float] = []
    uppers: list[float] = []
    for item in items:
        factor = canonical_unit(item.unit)[1]
        if item.domain.get("min") is not None:
            lowers.append(float(item.domain["min"]) * factor)
        if item.domain.get("max") is not None:
            uppers.append(float(item.domain["max"]) * factor)
    lower = max(lowers) if lowers else None
    upper = min(uppers) if uppers else None
    empty = lower is not None and upper is not None and lower > upper
    return lower, upper, empty


def _occurrence(item: ModelNode) -> dict[str, Any]:
    return {
        "concept_id": item.concept_id,
        "name": item.name,
        "page": item.source.page,
        "excerpt": item.source.excerpt,
        "default": item.default,
        "unit": item.unit,
        "type": item.type,
        "shape": _shape_of(item.type, item.default),
    }


def group_same_parameter_candidates(
    nodes: Sequence[ModelNode],
    *,
    limit: int = 500,
) -> list[LinkCandidate]:
    """按规范化概念聚类，返回「一组一个」的合并候选（不自动合并）。"""

    buckets: dict[tuple[str, str, tuple[int, ...], str], list[ModelNode]] = defaultdict(list)
    for node in nodes:
        if node.semantic_role in ("declaration", "derived_output"):
            continue
        normalized = normalize_concept_name(node.name)
        if not normalized:
            continue
        unit_name, _factor = canonical_unit(node.unit)
        buckets[
            (normalized, node.type, tuple(_shape_of(node.type, node.default)), unit_name)
        ].append(node)

    candidates: list[LinkCandidate] = []
    for (normalized, type_, shape, unit_name), items in buckets.items():
        if len(items) < 2:
            continue
        # 同一元素上的同名参数不互相配对；不同元素/页才可能是共享概念。
        origins = {(item.source.page, item.source.element_id or item.concept_id) for item in items}
        if len(origins) < 2:
            continue
        factors = {canonical_unit(item.unit)[1] for item in items}
        defaults = [
            _canonical_default(item.type, item.default, canonical_unit(item.unit)[1])
            for item in items
        ]
        default_conflict = any(
            not _values_equal(defaults[index], defaults[0]) for index in range(1, len(defaults))
        )
        lower, upper, empty_domain = _domain_intersection(items)
        pages = sorted({item.source.page for item in items})
        adjacent = any(
            abs(left.source.page - right.source.page) <= 1
            for left in items
            for right in items
            if left.concept_id != right.concept_id
        )
        notes: list[str] = []
        if default_conflict:
            notes.append("默认值不同，合并前必须确认使用哪一个值。")
        if empty_domain:
            notes.append(f"合并后定义域为空：[{lower}, {upper}]。")
        conflict = bool(notes)
        if len(factors) > 1:
            notes.append("单位不同但可换算，已按规范单位比较。")
        concept_ids = sorted({item.concept_id for item in items})
        occurrences = [_occurrence(item) for item in items]
        reason = (
            f"规范化名称“{normalized or items[0].name}”一致，共 {len(items)} 处"
            f"（第 {'/'.join(str(page) for page in pages)} 页）"
            f"{'，相邻页' if adjacent else ''}；单位与类型相同，形状 {list(shape) or '标量'}。"
        )
        if len(factors) > 1:
            reason += " 单位可换算。"
        confidence = 0.78 if adjacent else 0.68
        if default_conflict:
            confidence -= 0.1
        candidates.append(
            LinkCandidate(
                candidate_id=stable_id("candidate", "group", *concept_ids),
                left_concept_id=concept_ids[0],
                right_concept_id=concept_ids[1],
                concept_ids=concept_ids,
                occurrences=occurrences,
                normalized_name=normalized,
                relation_type="same_parameter",
                reason=reason[:500],
                confidence=max(0.3, min(0.95, round(confidence, 3))),
                conflict=conflict,
                conflict_note=" ".join(notes)[:500],
            )
        )
        if len(candidates) >= limit:
            break
    candidates.sort(key=lambda item: (-item.confidence, item.candidate_id))
    return candidates[:limit]


# ---------------------------------------------------------------------------
# 依赖图
# ---------------------------------------------------------------------------


def _producer_map(nodes: Sequence[CompiledNode]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for node in nodes:
        for output in node.outputs:
            mapping[output.concept_id] = node.node_id
    return mapping


def _edges(nodes: Sequence[CompiledNode]) -> dict[str, set[str]]:
    producers = _producer_map(nodes)
    edges: dict[str, set[str]] = {node.node_id: set() for node in nodes}
    for node in nodes:
        for parameter in node.parameters:
            binding = parameter.binding
            if binding.mode != "linked":
                continue
            producer = producers.get(binding.concept_id)
            if producer is not None:
                edges[producer].add(node.node_id)
    return edges


def _tarjan(adjacency: Mapping[str, set[str]]) -> list[list[str]]:
    index = 0
    stack: list[str] = []
    on_stack: set[str] = set()
    indexes: dict[str, int] = {}
    low: dict[str, int] = {}
    components: list[list[str]] = []

    def strongconnect(vertex: str) -> None:
        nonlocal index
        indexes[vertex] = low[vertex] = index
        index += 1
        stack.append(vertex)
        on_stack.add(vertex)
        for neighbour in adjacency.get(vertex, ()):  # type: ignore[union-attr]
            if neighbour not in indexes:
                strongconnect(neighbour)
                low[vertex] = min(low[vertex], low[neighbour])
            elif neighbour in on_stack:
                low[vertex] = min(low[vertex], indexes[neighbour])
        if low[vertex] == indexes[vertex]:
            component: list[str] = []
            while True:
                item = stack.pop()
                on_stack.discard(item)
                component.append(item)
                if item == vertex:
                    break
            components.append(component)

    for vertex in adjacency:
        if vertex not in indexes:
            strongconnect(vertex)
    return components


def dependency_order(
    nodes: Sequence[CompiledNode],
    preferred: Sequence[str] | None = None,
) -> tuple[list[str], list[list[str]]]:
    """返回 ``(拓扑序, 环)``；检测到环时拓扑序为空列表（调用方需自行回退）。"""

    adjacency = _edges(nodes)
    cycles = [
        sorted(component)
        for component in _tarjan(adjacency)
        if len(component) > 1
    ]
    for node_id, targets in adjacency.items():
        if node_id in targets:
            cycles.append([node_id])
    if cycles:
        return [], cycles

    indegree = {node_id: 0 for node_id in adjacency}
    for targets in adjacency.values():
        for target in targets:
            indegree[target] += 1
    order_index = {
        node_id: index for index, node_id in enumerate(preferred or [node.node_id for node in nodes])
    }
    fallback = len(order_index)
    ready = deque(
        sorted(
            (item for item, degree in indegree.items() if degree == 0),
            key=lambda item: order_index.get(item, fallback),
        )
    )
    order: list[str] = []
    while ready:
        current = ready.popleft()
        order.append(current)
        for target in sorted(
            adjacency[current], key=lambda item: order_index.get(item, fallback)
        ):
            indegree[target] -= 1
            if indegree[target] == 0:
                ready.append(target)
    if len(order) != len(adjacency):
        return order, [sorted(set(adjacency) - set(order))]
    return order, []


def affected_node_ids(nodes: Sequence[CompiledNode], changed_concepts: Iterable[str]) -> set[str]:
    """沿「输入概念 → 节点 → 派生概念」的反向边求影响范围。"""

    consumers: dict[str, set[str]] = defaultdict(set)
    outputs: dict[str, list[str]] = {}
    for node in nodes:
        outputs[node.node_id] = [output.concept_id for output in node.outputs]
        for parameter in node.parameters:
            consumers[parameter.concept_id].add(node.node_id)
            if parameter.binding.mode == "linked" and parameter.binding.concept_id:
                consumers[parameter.binding.concept_id].add(node.node_id)
    affected: set[str] = set()
    queue = deque(changed_concepts)
    seen = set(queue)
    while queue:
        concept = queue.popleft()
        for node_id in consumers.get(concept, set()):
            if node_id in affected:
                continue
            affected.add(node_id)
            for output in outputs.get(node_id, []):
                if output not in seen:
                    seen.add(output)
                    queue.append(output)
    return affected


# ---------------------------------------------------------------------------
# 派生候选 / 页面数值声明
# ---------------------------------------------------------------------------


def scan_numeric_declarations(
    snapshot: SourceSnapshot | None,
    outputs: Sequence[OutputSpec],
    *,
    material_id: str,
    source_version: int,
) -> list[ModelNode]:
    """扫描页面文字里的 ``det = 3`` 这类声明，只保留与已登记输出同名的项。"""

    if snapshot is None or not outputs:
        return []
    known = {}
    for output in outputs:
        known.setdefault(normalize_concept_name(output.name), output)
        known.setdefault(normalize_concept_name(output.key), output)
    declarations: list[ModelNode] = []
    seen: set[tuple[int, str, float]] = set()
    for page in snapshot.pages:
        page_no = int(page.get("page_no") or 0)
        if page_no < 1:
            continue
        width = float(page.get("width") or 0) or 1.0
        height = float(page.get("height") or 0) or 1.0
        for element in page.get("elements", []):
            if not isinstance(element, Mapping):
                continue
            text = str(element.get("text") or "")
            if not text or len(text) > 400:
                continue
            for line in text.splitlines():
                match = _DECLARATION_PATTERN.match(line)
                if match is None:
                    continue
                name = match.group("name").strip()
                normalized = normalize_concept_name(name)
                output = known.get(normalized)
                if output is None:
                    continue
                try:
                    value = float(match.group("value").replace("−", "-"))
                except ValueError:
                    continue
                key = (page_no, normalized, round(value, 9))
                if key in seen:
                    continue
                seen.add(key)
                bbox = _normalized_bbox(element.get("bbox"), width, height)
                if bbox is None:
                    continue
                from .evidence import build_anchor, build_provenance

                anchor = build_anchor(
                    material_id=material_id,
                    page=page_no,
                    bbox=bbox,
                    excerpt=line.strip(),
                    source_version=source_version,
                    semantic_hash=hash_json({"text": line.strip(), "page": page_no}),
                    element_id=str(element.get("element_id") or "") or None,
                )
                declarations.append(
                    ModelNode(
                        concept_id=stable_id(
                            "concept", "declaration", material_id, page_no, name, value
                        ),
                        name=f"{name} 的页面声明",
                        type="number",
                        unit=output.unit,
                        dimension="scalar",
                        domain={},
                        default=value,
                        source=anchor,
                        semantic_role="declaration",
                        provenance=build_provenance(
                            "native", evidence=line.strip(), method="page_declaration"
                        ),
                    )
                )
    return declarations


def _normalized_bbox(raw: Any, width: float, height: float) -> dict[str, float] | None:
    if not isinstance(raw, Mapping):
        return None
    try:
        x = float(raw.get("x", 0))
        y = float(raw.get("y", 0))
        w = float(raw.get("w", 0))
        h = float(raw.get("h", 0))
    except (TypeError, ValueError):
        return None
    if w <= 0 or h <= 0:
        return None
    if x <= 1 and y <= 1 and w <= 1 and h <= 1 and (x + w) <= 1.000001:
        return {"x": x, "y": y, "w": w, "h": h}
    if width <= 0 or height <= 0:
        return None
    x0 = max(0.0, min(1.0, x / width))
    y0 = max(0.0, min(1.0, y / height))
    x1 = max(0.0, min(1.0, (x + w) / width))
    y1 = max(0.0, min(1.0, (y + h) / height))
    if x1 <= x0 or y1 <= y0:
        return None
    return {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}


def _output_numeric(result: Mapping[str, Any], key: str) -> float | None:
    value = result.get(key)
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value)):
        return float(value)
    metrics = result.get("metrics")
    if isinstance(metrics, list):
        for metric in metrics:
            if isinstance(metric, Mapping) and metric.get("id") == key:
                try:
                    number = float(str(metric.get("value")).replace("−", "-"))
                except (TypeError, ValueError):
                    return None
                return number if math.isfinite(number) else None
    return None


def derived_candidates(
    nodes: Sequence[CompiledNode],
    results: Mapping[str, Mapping[str, Any]],
    declarations: Sequence[ModelNode],
) -> list[LinkCandidate]:
    """把「某节点输出 → 下游参数/页面声明」生成为派生候选。"""

    candidates: list[LinkCandidate] = []
    outputs_by_name: dict[str, list[tuple[CompiledNode, Any, float | None]]] = {}
    entries: list[tuple[CompiledNode, Any, float | None]] = []
    for source in nodes:
        for output in source.outputs:
            output_value = _output_numeric(results.get(source.node_id, {}), output.key)
            entry = (source, output, output_value)
            entries.append(entry)
            for name in {normalize_concept_name(output.name), normalize_concept_name(output.key)}:
                if name:
                    outputs_by_name.setdefault(name, []).append(entry)

    for target in nodes:
        for parameter in target.parameters:
            if parameter.binding.mode == "linked":
                continue
            normalized = normalize_concept_name(parameter.label)
            if not normalized:
                continue
            factor_target = canonical_unit(parameter.unit)[1]
            target_unit = canonical_unit(parameter.unit)[0]
            for source, output, output_value in outputs_by_name.get(normalized, []):
                if source.node_id == target.node_id:
                    continue
                if parameter.type != output.type:
                    continue
                source_unit, factor_source = canonical_unit(output.unit)
                if source_unit != target_unit:
                    continue
                expected = (
                    float(output_value) * factor_source / factor_target
                    if output_value is not None and factor_target
                    else None
                )
                conflict = False
                note = ""
                if (
                    expected is not None
                    and isinstance(parameter.default, (int, float))
                    and not isinstance(parameter.default, bool)
                    and not _values_equal(float(parameter.default), expected)
                ):
                    conflict = True
                    note = (
                        f"页面参数默认值 {parameter.default:g} 与当前输出 "
                        f"{expected:.8g} 不一致，确认后链接到输出。"
                    )
                candidates.append(
                    LinkCandidate(
                        candidate_id=stable_id(
                            "candidate", "derived", output.concept_id, parameter.concept_id
                        ),
                        left_concept_id=output.concept_id,
                        right_concept_id=parameter.concept_id,
                        concept_ids=[output.concept_id, parameter.concept_id],
                        occurrences=[
                            {
                                "concept_id": output.concept_id,
                                "name": output.name,
                                "page": source.source.page,
                                "excerpt": source.source.excerpt,
                                "default": output_value,
                                "unit": output.unit,
                                "type": output.type,
                                "shape": _shape_of(output.type, []),
                                "node_id": source.node_id,
                            },
                            _occurrence_from_parameter(target, parameter),
                        ],
                        normalized_name=normalized,
                        relation_type="derived_from",
                        source_node_id=source.node_id,
                        source_output=output.key,
                        target_node_id=target.node_id,
                        target_parameter_id=parameter.id,
                        reason=(
                            f"第 {source.source.page} 页的输出“{output.name}”与第 "
                            f"{target.source.page} 页参数“{parameter.label}”同名。"
                        ),
                        confidence=0.66,
                        conflict=conflict,
                        conflict_note=note,
                    )
                )

    for source, output, output_value in entries:
        output_name = normalize_concept_name(output.name)
        for declaration in declarations:
            if declaration.semantic_role != "declaration":
                continue
            # 名称形如「<原概念> 的页面声明」：去掉完整后缀再比对，
            # 避免概念名本身含“的”（如“矩阵的秩”）被从中间截断。
            declared_name = declaration.name
            if declared_name.endswith("的页面声明"):
                declared_name = declared_name[: -len("的页面声明")].rstrip()
            if normalize_concept_name(declared_name) != output_name:
                continue
            declared = float(declaration.default) if isinstance(declaration.default, (int, float)) else None
            conflict = False
            note = ""
            if output_value is not None and declared is not None and not _values_equal(output_value, declared):
                conflict = True
                note = (
                    f"页面写“{declared:g}”，当前节点算出 {output_value:.8g}；"
                    "确认后只记录对照，不改写原稿。"
                )
            candidates.append(
                LinkCandidate(
                    candidate_id=stable_id(
                        "candidate", "declaration", output.concept_id, declaration.concept_id
                    ),
                    left_concept_id=output.concept_id,
                    right_concept_id=declaration.concept_id,
                    concept_ids=[output.concept_id, declaration.concept_id],
                    normalized_name=output_name,
                    relation_type="derived_from",
                    source_node_id=source.node_id,
                    source_output=output.key,
                    reason=(
                        f"第 {declaration.source.page} 页文字声明“{declaration.source.excerpt}”，"
                        f"对应第 {source.source.page} 页的“{output.name}”输出。"
                    ),
                    confidence=0.62,
                    conflict=conflict,
                    conflict_note=note,
                    declared_value=declared,
                )
            )
    return candidates


def _occurrence_from_parameter(node: CompiledNode, parameter: PlanParameter) -> dict[str, Any]:
    return {
        "concept_id": parameter.concept_id,
        "name": parameter.label,
        "page": parameter.source.page,
        "excerpt": parameter.source.excerpt,
        "default": parameter.default,
        "unit": parameter.unit,
        "type": parameter.type,
        "shape": _shape_of(parameter.type, parameter.default),
        "node_id": node.node_id,
    }


# ---------------------------------------------------------------------------
# 单位换算
# ---------------------------------------------------------------------------


def convert_parameter_to_unit(parameter: PlanParameter, target_unit: str) -> bool:
    """把参数默认值和范围换算到目标单位；不可换算时返回 ``False``。"""

    source_unit, source_factor = canonical_unit(parameter.unit)
    target_name, target_factor = canonical_unit(target_unit)
    if source_unit != target_name:
        return False
    if parameter.unit == target_unit:
        return True
    if not target_factor:
        return False
    ratio = source_factor / target_factor
    parameter.unit = target_unit
    if isinstance(parameter.default, (int, float)) and not isinstance(parameter.default, bool):
        parameter.default = round(float(parameter.default) * ratio, 12)
    if parameter.min is not None:
        parameter.min = round(float(parameter.min) * ratio, 12)
    if parameter.max is not None:
        parameter.max = round(float(parameter.max) * ratio, 12)
    if parameter.step is not None:
        parameter.step = round(float(parameter.step) * abs(ratio), 12)
    return True


__all__ = [
    "OUTPUT_CONCEPT_PREFIX",
    "affected_node_ids",
    "canonical_unit",
    "build_node_outputs",
    "convert_parameter_to_unit",
    "convert_to_unit",
    "dependency_order",
    "derived_candidates",
    "group_same_parameter_candidates",
    "normalize_concept_name",
    "output_concept_id",
    "scan_numeric_declarations",
]
