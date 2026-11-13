"""区域 → 最小 ConditionSet。"""

from __future__ import annotations

import re
from typing import Any, Mapping

from ..evidence import build_anchor
from ..recognition_types import (
    ConditionItem,
    ConditionSet,
    ConditionUncertainty,
    VariableBinding,
)
from ..types import Region, SourceSnapshot
from ..util import hash_json, semantic_content_hash, stable_id
from .normalize import (
    clean_text,
    detect_activation,
    detect_mode,
    detect_pool_mode,
    detect_sort_algorithm,
    normalize_formula,
    normalize_key,
    normalizes_to_si,
    parse_double_integrand,
    parse_expression,
    parse_grid,
    parse_interval,
    parse_number_list,
    parse_number_matrix,
    parse_operations,
    parse_pairs,
    scalar_assignments,
)

_ROLE_BY_KEY = {
    "v0": ["parameter"],
    "x0": ["state", "parameter"],
    "y0": ["state", "parameter"],
    "angle_deg": ["parameter"],
    "g": ["constant"],
    "t": ["independent"],
    "m": ["parameter"],
    "k": ["parameter"],
    "order": ["parameter"],
    "x_eval": ["independent"],
    "max_iter": ["control"],
    "stride": ["control"],
    "padding": ["control"],
    "capacity": ["control"],
    "upstream": ["parameter"],
    "ax": ["parameter"],
    "bx": ["parameter"],
    "ay": ["parameter"],
    "by": ["parameter"],
    "nx": ["control"],
    "ny": ["control"],
    "xs": ["independent"],
    "ys": ["dependent"],
    "matrix": ["state"],
    "kernel": ["parameter"],
    "initial": ["state"],
    "values": ["state"],
    "operations": ["control"],
    "window": ["parameter"],
}

_LABEL_BY_KEY = {
    "v0": "初速度",
    "x0": "初值 / 展开点",
    "y0": "初始高度",
    "angle_deg": "角度",
    "g": "重力加速度",
    "t": "时刻",
    "m": "质量",
    "k": "劲度系数",
    "order": "阶数",
    "x_eval": "估计点",
    "max_iter": "迭代次数",
    "stride": "步长",
    "padding": "填充",
    "capacity": "容量",
    "upstream": "上游梯度",
    "ax": "x 下限",
    "bx": "x 上限",
    "ay": "y 下限",
    "by": "y 上限",
    "nx": "x 网格数",
    "ny": "y 网格数",
    "xs": "x 数据",
    "ys": "y 数据",
    "matrix": "输入矩阵",
    "kernel": "卷积核",
    "initial": "初始序列",
    "values": "列表",
    "operations": "操作序列",
    "window": "池化窗口",
    "expression": "函数表达式",
}


def _anchor(region: Region, snapshot: SourceSnapshot, excerpt: str):
    return build_anchor(
        material_id=snapshot.material_id,
        page=region.page_no,
        bbox=region.bbox,
        excerpt=(excerpt or region.category)[:160],
        source_version=snapshot.document_revision,
        semantic_hash=region.semantic_content_hash,
        node_id=region.node_ids[0] if region.node_ids else None,
        element_id=region.element_ids[0] if region.element_ids else None,
    )


def _condition(
    *,
    region: Region,
    snapshot: SourceSnapshot,
    key: str,
    kind: str,
    value: Any = None,
    raw_value: Any = None,
    unit: str = "",
    normalized_value: Any = None,
    normalized_unit: str = "",
    excerpt: str = "",
    origin_type: str = "native",
    confidence: float = 1.0,
    note: str = "",
    index: int = 0,
    shape: list[int] | None = None,
) -> ConditionItem:
    anchor = _anchor(region, snapshot, excerpt)
    roles = _ROLE_BY_KEY.get(key, [])
    return ConditionItem(
        condition_id=stable_id("cond", region.region_id, key, str(index), excerpt[:40]),
        kind=kind,  # type: ignore[arg-type]
        key=key,
        label=_LABEL_BY_KEY.get(key, key),
        raw_value=raw_value,
        value=value,
        unit=unit,
        normalized_unit=normalized_unit,
        normalized_value=normalized_value,
        origin_type=origin_type,  # type: ignore[arg-type]
        excerpt=clean_text(excerpt)[:500],
        source=anchor,
        confidence=confidence,
        roles=roles,  # type: ignore[arg-type]
        shape=shape or [],
        note=note,
    )


def _shape_of(value: Any) -> list[int]:
    if isinstance(value, list) and value and isinstance(value[0], list):
        return [len(value), len(value[0])]
    if isinstance(value, list):
        return [len(value)]
    return []


def _extract_math_conditions(region: Region, snapshot: SourceSnapshot) -> list[ConditionItem]:
    conditions: list[ConditionItem] = []
    text = clean_text(region.semantic.get("text") or "")
    formula = normalize_formula(region.semantic.get("formula") or "")
    if not formula and re.search(r"(?:f\s*\(\s*x\s*\)|y)\s*=", text):
        formula = text
    if formula:
        expression = parse_expression(formula)
        if "∫∫" in text or "二重积分" in text:
            integrand = parse_double_integrand(text)
            if integrand:
                expression = integrand
        conditions.append(
            _condition(
                region=region,
                snapshot=snapshot,
                key="expression",
                kind="formula",
                value=expression or formula,
                raw_value=formula,
                excerpt=formula,
                origin_type="native",
                note="公式原文；规范化仅改符号，不改语义。",
            )
        )

    # key = value [unit]
    for index, (key, value, unit, excerpt) in enumerate(scalar_assignments(text)):
        normalized_value, normalized_unit, note = normalizes_to_si(key, value, unit)
        conditions.append(
            _condition(
                region=region,
                snapshot=snapshot,
                key=key,
                kind="value",
                value=float(value),
                raw_value=f"{value:g} {unit}".strip(),
                unit=unit,
                normalized_value=float(normalized_value),
                normalized_unit=normalized_unit,
                excerpt=excerpt,
                note=note or ("已按原单位保存" if not unit else ""),
                index=index,
            )
        )

    # 数值数组 / 矩阵 / 点列
    values_list = parse_number_list(text)
    if values_list:
        if any(keyword in text for keyword in ("初始栈", "初始队列", "初始列表", "初始序列")):
            list_key = "initial"
        elif "x 数据" in text or "x数据" in text:
            list_key = "xs"
        else:
            list_key = "values"
        conditions.append(
            _condition(
                region=region,
                snapshot=snapshot,
                key=list_key,
                kind="number_list",
                value=values_list,
                raw_value=values_list,
                excerpt=text[:200],
                shape=_shape_of(values_list),
            )
        )
    matrices: list[list[list[float]]] = []
    for match in re.finditer(r"\[\s*\[.*?\]\s*\]", normalize_formula(text)):
        candidate = normalize_formula(match.group(0))
        matrix = parse_number_matrix(candidate)
        if matrix and not any(matrix == existing for existing in matrices):
            matrices.append(matrix)
    for index, matrix in enumerate(matrices[:2]):
        key = "matrix" if index == 0 else "kernel"
        conditions.append(
            _condition(
                region=region,
                snapshot=snapshot,
                key=key,
                kind="number_matrix",
                value=matrix,
                raw_value=matrix,
                excerpt=text[:200],
                shape=_shape_of(matrix),
                index=index,
            )
        )
    pairs = parse_pairs(text)
    if pairs and not any(item.key in ("xs", "ys") for item in conditions):
        xs = [pair[0] for pair in pairs]
        ys = [pair[1] for pair in pairs]
        conditions.extend(
            [
                _condition(
                    region=region,
                    snapshot=snapshot,
                    key="xs",
                    kind="number_list",
                    value=xs,
                    raw_value=xs,
                    excerpt=text[:200],
                    shape=[len(xs)],
                ),
                _condition(
                    region=region,
                    snapshot=snapshot,
                    key="ys",
                    kind="number_list",
                    value=ys,
                    raw_value=ys,
                    excerpt=text[:200],
                    shape=[len(ys)],
                ),
            ]
        )
    for variable in ("x", "y"):
        interval = parse_interval(text, variable)
        if interval is not None:
            low, high = interval
            conditions.extend(
                [
                    _condition(
                        region=region,
                        snapshot=snapshot,
                        key=f"a{variable}",
                        kind="interval",
                        value=low,
                        raw_value=f"{low:g}",
                        excerpt=text[:200],
                    ),
                    _condition(
                        region=region,
                        snapshot=snapshot,
                        key=f"b{variable}",
                        kind="interval",
                        value=high,
                        raw_value=f"{high:g}",
                        excerpt=text[:200],
                    ),
                ]
            )
    return conditions


def _extract_application_conditions(region: Region, snapshot: SourceSnapshot) -> list[ConditionItem]:
    text = clean_text(region.semantic.get("text") or "")
    conditions: list[ConditionItem] = []
    operations = parse_operations(text)
    if operations:
        conditions.append(
            _condition(
                region=region,
                snapshot=snapshot,
                key="operations",
                kind="operations",
                value=operations,
                raw_value=operations,
                excerpt=text[:200],
            )
        )
    mode = detect_mode(text)
    if mode and any(keyword in text for keyword in ("栈", "队列", "stack", "queue", "push", "pop", "enqueue", "dequeue")):
        conditions.append(
            _condition(
                region=region,
                snapshot=snapshot,
                key="mode",
                kind="value",
                value=mode,
                raw_value=mode,
                excerpt=text[:200],
            )
        )
    activation = detect_activation(text)
    if activation:
        conditions.append(
            _condition(
                region=region,
                snapshot=snapshot,
                key="activation",
                kind="value",
                value=activation,
                raw_value=activation,
                excerpt=text[:200],
            )
        )
    algorithm = detect_sort_algorithm(text)
    if algorithm:
        conditions.append(
            _condition(
                region=region,
                snapshot=snapshot,
                key="algorithm",
                kind="value",
                value=algorithm,
                raw_value=algorithm,
                excerpt=text[:200],
            )
        )
    pool_mode = detect_pool_mode(text)
    if pool_mode and any(keyword in text for keyword in ("卷积", "池化", "conv", "pool")):
        conditions.append(
            _condition(
                region=region,
                snapshot=snapshot,
                key="mode",
                kind="value",
                value=pool_mode,
                raw_value=pool_mode,
                excerpt=text[:200],
            )
        )
    # 泰勒阶数、估计点、牛顿迭代次数等只在对应上下文提取，避免把普通 n 当阶数。
    lower = text.casefold()
    if "泰勒" in text or "taylor" in lower:
        order = re.search(r"(?:阶数|展开阶数|order)\s*(?:n|k)?\s*[=:：]\s*(\d{1,2})", text, re.I)
        if order is None:
            order = re.search(r"(\d{1,2})\s*阶", text)
        if order:
            conditions.append(
                _condition(
                    region=region,
                    snapshot=snapshot,
                    key="order",
                    kind="value",
                    value=int(order.group(1)),
                    raw_value=order.group(0),
                    excerpt=text[:200],
                )
            )
        eval_point = re.search(r"(?:估计点|求值点|计算)\s*x\s*=\s*(-?\d+(?:\.\d+)?)", text)
        if eval_point:
            conditions.append(
                _condition(
                    region=region,
                    snapshot=snapshot,
                    key="x_eval",
                    kind="value",
                    value=float(eval_point.group(1)),
                    raw_value=eval_point.group(0),
                    excerpt=text[:200],
                )
            )
    if "牛顿" in text or "newton" in lower:
        iterations = re.search(r"(?:迭代|最多)\s*(\d{1,3})\s*(?:次|步)", text)
        if iterations:
            conditions.append(
                _condition(
                    region=region,
                    snapshot=snapshot,
                    key="max_iter",
                    kind="value",
                    value=int(iterations.group(1)),
                    raw_value=iterations.group(0),
                    excerpt=text[:200],
                )
            )
    grid = parse_grid(text)
    if grid and ("二重" in text or "网格" in text or "∫∫" in text):
        conditions.extend(
            [
                _condition(region=region, snapshot=snapshot, key="nx", kind="value", value=grid[0], raw_value=grid[0], excerpt=text[:200]),
                _condition(region=region, snapshot=snapshot, key="ny", kind="value", value=grid[1], raw_value=grid[1], excerpt=text[:200]),
            ]
        )
    if "平抛" in text and "angle_deg" not in {item.key for item in conditions}:
        conditions.append(
            _condition(
                region=region,
                snapshot=snapshot,
                key="angle_deg",
                kind="assumption",
                value=0.0,
                raw_value="平抛",
                excerpt="平抛",
                note="“平抛”即抛射角为 0°，由原文术语确定。",
            )
        )
    if any(keyword in text for keyword in ("静止释放", "由静止", "初速度为零")) and "v0" not in {item.key for item in conditions}:
        conditions.append(
            _condition(
                region=region,
                snapshot=snapshot,
                key="v0",
                kind="assumption",
                value=0.0,
                raw_value="静止释放",
                excerpt="静止释放",
                note="“静止释放”即初速度为 0，由原文术语确定。",
            )
        )
    # 池化窗口 2×2：作为 kernel 的形状提示，不伪造核数值。
    window = re.search(r"(?:池化窗口|窗口)\s*(\d)\s*[x×*]\s*(\d)", text)
    if window:
        rows, columns = int(window.group(1)), int(window.group(2))
        if 1 <= rows <= 8 and 1 <= columns <= 8:
            conditions.append(
                _condition(
                    region=region,
                    snapshot=snapshot,
                    key="window",
                    kind="value",
                    value=[rows, columns],
                    raw_value=window.group(0),
                    excerpt=text[:200],
                    note="池化窗口形状；不伪造池化核数值。",
                )
            )
    return conditions


def _variables(conditions: list[ConditionItem]) -> list[VariableBinding]:
    bindings: list[VariableBinding] = []
    seen: set[str] = set()
    for condition in conditions:
        if not condition.key or condition.key in seen or not condition.roles:
            continue
        seen.add(condition.key)
        type_ = "number_matrix" if isinstance(condition.value, list) and condition.value and isinstance(condition.value[0], list) else "number_list" if isinstance(condition.value, list) else "number"
        bindings.append(
            VariableBinding(
                name=condition.key,
                role=condition.roles[0],
                type=type_,
                unit=condition.normalized_unit or condition.unit,
                condition_id=condition.condition_id,
            )
        )
    return bindings


def extract_conditions(snapshot: SourceSnapshot, regions: list[Region]) -> list[ConditionSet]:
    result: list[ConditionSet] = []
    for region in regions:
        conditions = [
            *_extract_math_conditions(region, snapshot),
            *_extract_application_conditions(region, snapshot),
        ]
        # 去重：同 key/同值只保留第一条 native 条件，保留原文来源。
        deduped: list[ConditionItem] = []
        seen: set[tuple[str, str]] = set()
        for condition in conditions:
            marker = (condition.key, str(condition.normalized_value if condition.normalized_value is not None else condition.value))
            if marker in seen:
                continue
            seen.add(marker)
            deduped.append(condition)
        uncertainties: list[ConditionUncertainty] = []
        if region.extraction_state in ("visual", "manual_review"):
            uncertainties.append(
                ConditionUncertainty(
                    code="unreadable_source",
                    message="该区域只有图片/图形，未能读到可核验条件。",
                    severity="blocking",
                )
            )
        text = clean_text(region.semantic.get("text") or "")
        formula = normalize_formula(region.semantic.get("formula") or "")
        payload = {
            "region_id": region.region_id,
            "page_no": region.page_no,
            "text": text,
            "formula": formula,
            "conditions": [
                {
                    "key": item.key,
                    "kind": item.kind,
                    "value": item.value,
                    "normalized_value": item.normalized_value,
                    "unit": item.normalized_unit or item.unit,
                    "origin": item.origin_type,
                }
                for item in deduped
            ],
        }
        result.append(
            ConditionSet(
                region_id=region.region_id,
                page_no=region.page_no,
                category=region.category,
                text=text[:8000],
                formula=formula[:4000],
                conditions=deduped,
                variables=_variables(deduped),
                assumptions=[str(region.semantic.get("caption") or "")] if region.semantic.get("caption") else [],
                uncertainties=uncertainties,
                source_hash=snapshot.source_hash,
                condition_hash=hash_json(payload),
            )
        )
    return result


def merge_condition_sets(sets: list[ConditionSet]) -> list[ConditionSet]:
    """同页相同内容哈希的条件集合并；跨页不自动合并。"""
    grouped: dict[tuple[int, str], ConditionSet] = {}
    for condition_set in sets:
        key = (condition_set.page_no, condition_set.condition_hash)
        if key not in grouped:
            grouped[key] = condition_set
    return list(grouped.values())


__all__ = ["extract_conditions", "merge_condition_sets"]
