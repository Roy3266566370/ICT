"""统一求值：同一组 canonical values 驱动所有编译节点。

后端求值用于目标反求、补充实验、验收与发布冻结；前端运行时按相同契约重算，
两者都读取同一份输入与算子版本。任何异常都进入 ``violations``，不以 0 冒充无定义。
"""

from __future__ import annotations

import logging
import math
from typing import Any, Mapping, Sequence

import sympy as sp

from ..labs.expr import ExprError, parse_expression, safe_float, to_latex
from ..labs.solvers import SolveError, evaluate_problem
from .linking import affected_node_ids, dependency_order
from .types import (
    CanonicalValue,
    CanonicalValues,
    CompiledNode,
    EvaluationSnapshot,
    InteractionBundle,
    OutputSpec,
)
from .util import hash_json

logger = logging.getLogger(__name__)

KERNEL_VERSION = "ppt-ai.kernel.1"
MAX_PLOT_POINTS = 241


class EvaluationError(ValueError):
    pass


def _numeric(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _values_match(left: float, right: float) -> bool:
    return abs(left - right) <= max(1e-9, abs(left) * 1e-9)


def _array_value(value: Any, type_: str) -> tuple[list[int], str | None]:
    if type_ == "number_list":
        if not isinstance(value, list) or not value:
            return [], "number_list 必须是非空数组"
        if any(_numeric(item) is None for item in value):
            return [], "number_list 只能包含有限数值"
        return [len(value)], None
    if type_ == "vector2":
        if not isinstance(value, list) or len(value) != 2 or any(_numeric(item) is None for item in value):
            return [], "vector2 必须是两个有限数值"
        return [2], None
    if not isinstance(value, list) or not value:
        return [], "number_matrix 必须是非空二维数组"
    widths: list[int] = []
    for row in value:
        if not isinstance(row, list) or not row:
            return [], "number_matrix 的每一行必须是非空数组"
        if any(_numeric(item) is None for item in row):
            return [], "number_matrix 只能包含有限数值"
        widths.append(len(row))
    if len(set(widths)) != 1:
        return [], "number_matrix 各行长度必须一致"
    if len(value) > 32 or widths[0] > 1024:
        return [], "number_matrix 超过尺寸上限"
    if type_ == "matrix2" and (len(value) != 2 or widths[0] != 2):
        return [], "matrix2 必须是 2×2 矩阵"
    return [len(value), widths[0]], None


def _parameter_values(node: CompiledNode, canonical: CanonicalValues) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    values: dict[str, Any] = {}
    violations: list[dict[str, Any]] = []
    for parameter in node.parameters:
        raw = canonical.get(parameter.concept_id, parameter.default)
        if parameter.type in ("number_list", "number_matrix", "matrix2", "vector2"):
            chosen = raw
            shape, error = _array_value(chosen, parameter.type)
            if error:
                violations.append({"node_id": node.node_id, "parameter": parameter.id, "message": error})
                chosen = parameter.default
                shape, error = _array_value(chosen, parameter.type)
            if error:
                violations.append({"node_id": node.node_id, "parameter": parameter.id, "message": error})
            else:
                if parameter.shape and list(shape) != parameter.shape:
                    violations.append(
                        {
                            "node_id": node.node_id,
                            "parameter": parameter.id,
                            "message": f"数组形状应为 {parameter.shape}，实际为 {shape}",
                        }
                    )
                values[parameter.id] = chosen
            continue
        if isinstance(raw, list):
            violations.append(
                {
                    "node_id": node.node_id,
                    "parameter": parameter.id,
                    "message": "标量参数收到数组值",
                }
            )
            raw = parameter.default
        if parameter.type == "number" and isinstance(raw, (int, float)) and not isinstance(raw, bool):
            number = float(raw)
            if not math.isfinite(number):
                violations.append({"node_id": node.node_id, "parameter": parameter.id, "message": "参数不是有限数值"})
                number = float(parameter.default)
            if parameter.min is not None and number < parameter.min:
                violations.append({"node_id": node.node_id, "parameter": parameter.id, "message": "参数小于允许范围"})
            if parameter.max is not None and number > parameter.max:
                violations.append({"node_id": node.node_id, "parameter": parameter.id, "message": "参数大于允许范围"})
            values[parameter.id] = number
        elif parameter.type == "integer" and isinstance(raw, (int, float)) and not isinstance(raw, bool):
            number = float(raw)
            if not math.isfinite(number):
                violations.append({"node_id": node.node_id, "parameter": parameter.id, "message": "参数不是有限数值"})
                number = float(parameter.default)
            if parameter.min is not None and number < parameter.min:
                violations.append({"node_id": node.node_id, "parameter": parameter.id, "message": "参数小于允许范围"})
            if parameter.max is not None and number > parameter.max:
                violations.append({"node_id": node.node_id, "parameter": parameter.id, "message": "参数大于允许范围"})
            values[parameter.id] = int(round(number))
        else:
            allowed = parameter.type in ("number", "integer", "boolean", "string", "enum")
            if not allowed:
                violations.append({"node_id": node.node_id, "parameter": parameter.id, "message": "参数类型未登记"})
            values[parameter.id] = raw
    return values, violations


def _expression_result(node: CompiledNode, provider: Mapping[str, Any], values: Mapping[str, Any]) -> dict[str, Any]:
    expression_text = str(provider.get("expression") or "")
    variables = [str(item) for item in provider.get("variables", []) if isinstance(item, str)] or ["x"]
    symbols = {name: sp.Symbol(name, real=True) for name in variables}
    expression = parse_expression(expression_text, variables)
    substituted = expression
    for name, symbol in symbols.items():
        substituted = substituted.subs(symbol, values.get(name, 1.0))
    current = safe_float(substituted)
    x_name = "x" if "x" in symbols else variables[0]
    x_min = float(node.parameters[[p.id for p in node.parameters].index(x_name)].min) if x_name in [p.id for p in node.parameters] and node.parameters[[p.id for p in node.parameters].index(x_name)].min is not None else -5.0
    x_max = float(node.parameters[[p.id for p in node.parameters].index(x_name)].max) if x_name in [p.id for p in node.parameters] and node.parameters[[p.id for p in node.parameters].index(x_name)].max is not None else 5.0
    x_symbol = symbols[x_name]
    function = sp.lambdify(x_symbol, expression.subs({symbols[key]: value for key, value in values.items() if key != x_name}), "math")
    series = []
    for index in range(MAX_PLOT_POINTS):
        x = x_min + (x_max - x_min) * index / (MAX_PLOT_POINTS - 1)
        try:
            y = float(function(x))
        except Exception:  # noqa: BLE001 - 无定义点留空
            y = None
        if y is not None and not math.isfinite(y):
            y = None
        series.append({"x": round(x, 6), "y": None if y is None else round(y, 6)})
    metrics = [{"id": "value", "label": "当前值", "value": "—" if current is None else f"{current:.8g}"}]
    return {
        "subject": "calculus",
        "kind": "expression",
        "expression": expression_text,
        "latex": to_latex(expression),
        "value": current,
        "series": series,
        "domain": {"x_min": x_min, "x_max": x_max},
        "metrics": metrics,
        "checks": [
            {
                "id": "finite",
                "label": "表达式有有限值",
                "status": "pass" if current is not None else "fail",
                "detail": "已按同一表达式求值。" if current is not None else "当前参数下没有有限值。",
            }
        ],
        "trace": [],
        "notes": ["只采样已识别表达式；曲线外观不作为函数证据。"],
    }


def _chart_result(node: CompiledNode, provider: Mapping[str, Any], values: Mapping[str, Any]) -> dict[str, Any]:
    chart = provider.get("chart") if isinstance(provider.get("chart"), Mapping) else {}
    categories = [str(item) for item in chart.get("categories", [])]
    series = [item for item in chart.get("series", []) if isinstance(item, Mapping)]
    selected = str(values.get("category") or "全部")
    indexes = [index for index, category in enumerate(categories) if selected == "全部" or category == selected]
    rows: list[list[Any]] = []
    for item in series:
        values_list = item.get("values", [])
        for index in indexes:
            if index < len(values_list) and isinstance(values_list[index], (int, float)):
                rows.append([categories[index], str(item.get("name") or ""), values_list[index]])
    numeric = [row[2] for row in rows if isinstance(row[2], (int, float))]
    metrics = [
        {"id": "rows", "label": "数据点", "value": str(len(rows))},
        {"id": "sum", "label": "总计", "value": f"{sum(numeric):.8g}" if numeric else "—"},
        {"id": "max", "label": "最大值", "value": f"{max(numeric):.8g}" if numeric else "—"},
    ]
    return {
        "subject": "chart",
        "rows": rows,
        "columns": ["category", "series", "value"],
        "metrics": metrics,
        "checks": [{"id": "source_match", "label": "数值来自原生图表", "status": "pass", "detail": "未经视觉拟合。"}],
        "trace": [],
        "notes": ["分类与数值来自 PPTX 原生 chart。"],
    }


def _table_result(node: CompiledNode, provider: Mapping[str, Any], values: Mapping[str, Any]) -> dict[str, Any]:
    headers = [str(item) for item in provider.get("headers", [])]
    rows = [[str(cell) for cell in row] for row in provider.get("rows", []) if isinstance(row, list)]
    selected = str(values.get("filter_column") or "全部")
    index = headers.index(selected) if selected in headers else None
    filtered = rows
    summary = [
        {"id": "columns", "label": "列数", "value": str(len(headers))},
        {"id": "rows", "label": "行数", "value": str(len(filtered))},
    ]
    if index is not None:
        non_empty = sum(1 for row in rows if index < len(row) and row[index].strip())
        summary.append({"id": "non_empty", "label": f"{selected} 非空", "value": str(non_empty)})
    return {
        "subject": "table",
        "headers": headers,
        "rows": filtered,
        "metrics": summary,
        "checks": [{"id": "source_match", "label": "单元格来自原生表格", "status": "pass", "detail": "未经视觉识别。"}],
        "trace": [],
        "notes": ["表头与单元格来自 PPTX 原生 table。"],
    }


def _matrix_result(node: CompiledNode, provider: Mapping[str, Any], values: Mapping[str, Any]) -> dict[str, Any]:
    matrix = provider.get("matrix") if isinstance(provider.get("matrix"), list) else [[1, 0], [0, 1]]
    cells = [[float(matrix[row][column]) for column in range(2)] for row in range(2)]
    for row in range(2):
        for column in range(2):
            key = f"a{row + 1}{column + 1}"
            if key in values:
                cells[row][column] = float(values[key])
    vector = provider.get("vector") if isinstance(provider.get("vector"), list) else None
    if vector:
        vector = [float(values.get("v1", vector[0])), float(values.get("v2", vector[1]))]
    det = cells[0][0] * cells[1][1] - cells[0][1] * cells[1][0]
    product = None
    if vector:
        product = [
            round(cells[0][0] * vector[0] + cells[0][1] * vector[1], 8),
            round(cells[1][0] * vector[0] + cells[1][1] * vector[1], 8),
        ]
    inverse = None
    if abs(det) > 1e-12:
        inverse = [
            [round(cells[1][1] / det, 8), round(-cells[0][1] / det, 8)],
            [round(-cells[1][0] / det, 8), round(cells[0][0] / det, 8)],
        ]
    geometry = None
    if vector is not None and product is not None:
        vx, vy = vector
        ax, ay = product
        norm_v = math.hypot(vx, vy)
        norm_av = math.hypot(ax, ay)
        cross = vx * ay - vy * ax
        dot = vx * ax + vy * ay
        zero_vector = norm_v <= 1e-12
        av_zero = norm_av <= 1e-12
        collinear = False
        ratio = None
        eigenvalue = None
        if not zero_vector:
            if av_zero:
                collinear = True
                eigenvalue = 0.0
            elif abs(cross) <= 1e-9 * max(1.0, norm_v * norm_av):
                collinear = True
                ratio = dot / (norm_v * norm_v)
                eigenvalue = ratio
        geometry = {
            "matrix": cells,
            "vector": vector,
            "product": product,
            "zero_vector": zero_vector,
            "av_zero": av_zero,
            "collinear": collinear,
            "ratio": None if ratio is None else round(ratio, 10),
            "eigenvalue": None if eigenvalue is None else round(eigenvalue, 10),
            "is_eigenvector": bool(collinear),
            "message": (
                "零向量不能作为特征向量。"
                if zero_vector
                else "Av=0：这是一个非零特征向量，特征值为 0。"
                if av_zero
                else f"共线，倍率 {ratio:.6g}。"
                if collinear and ratio is not None
                else "Av 与 v 不共线，当前向量不是特征向量。"
            ),
        }
    metrics = [
        {"id": "det", "label": "行列式", "value": f"{det:.8g}"},
        {"id": "invertible", "label": "可逆", "value": "是" if inverse is not None else "否"},
    ]
    if geometry is not None:
        metrics.append(
            {
                "id": "collinear",
                "label": "与 Av 共线",
                "value": "是" if geometry["collinear"] else "否",
            }
        )
        if geometry["ratio"] is not None:
            metrics.append({"id": "ratio", "label": "倍率", "value": f"{geometry['ratio']:.8g}"})
    checks = [
        {
            "id": "invertible",
            "label": "矩阵可逆性",
            "status": "pass" if inverse is not None else "warn",
            "detail": "存在逆矩阵。" if inverse is not None else "行列式为 0；不强行取逆。",
        }
    ]
    if geometry is not None:
        checks.append(
            {
                "id": "eigen_direction",
                "label": "特征方向",
                "status": "pass" if geometry["is_eigenvector"] and not geometry["zero_vector"] else "warn",
                "detail": geometry["message"],
            }
        )
    return {
        "subject": "matrix",
        "matrix": cells,
        "vector": vector,
        "product": product,
        "inverse": inverse,
        "det": det,
        "geometry": geometry,
        "metrics": metrics,
        "checks": checks,
        "trace": [],
        "notes": ["矩阵元素来自原稿或用户核对。"],
    }


def _change_of_basis_result(
    node: CompiledNode, provider: Mapping[str, Any], values: Mapping[str, Any]
) -> dict[str, Any]:
    matrix = provider.get("matrix") if isinstance(provider.get("matrix"), list) else [[1, 0], [0, 1]]
    cells = [[float(matrix[row][column]) for column in range(2)] for row in range(2)]
    for row in range(2):
        for column in range(2):
            key = f"a{row + 1}{column + 1}"
            if key in values:
                cells[row][column] = float(values[key])
    basis_raw = provider.get("basis")
    if isinstance(basis_raw, list) and len(basis_raw) == 2 and all(
        isinstance(row, list) and len(row) == 2 for row in basis_raw
    ):
        basis = [[float(basis_raw[row][column]) for column in range(2)] for row in range(2)]
        angle = None
    else:
        angle = float(values.get("basis_angle_deg", provider.get("basis_angle_deg", 0.0)))
        radians = math.radians(angle)
        basis = [
            [round(math.cos(radians), 12), round(-math.sin(radians), 12)],
            [round(math.sin(radians), 12), round(math.cos(radians), 12)],
        ]
    P = sp.Matrix(basis)
    A = sp.Matrix(cells)
    det_p = float(P.det())
    det_a = float(A.det())
    trace_a = float(A.trace())
    invertible = abs(det_p) > 1e-12
    metrics = [
        {"id": "trace", "label": "迹 tr(A)", "value": f"{trace_a:.8g}"},
        {"id": "det", "label": "行列式 det(A)", "value": f"{det_a:.8g}"},
        {"id": "basis_det", "label": "det(P)", "value": f"{det_p:.8g}"},
        {"id": "invertible", "label": "基可逆", "value": "是" if invertible else "否"},
    ]
    checks = [
        {
            "id": "basis_invertible",
            "label": "坐标基可逆",
            "status": "pass" if invertible else "warn",
            "detail": "P 可逆，存在坐标逆映射。" if invertible else "P 不可逆；不显示逆矩阵或伪造结果。",
        }
    ]
    inverse_basis = None
    transformed = None
    coordinates = None
    invariants = None
    vector = provider.get("vector") if isinstance(provider.get("vector"), list) else [1, 2]
    x_world = [float(values.get("x1", vector[0])), float(values.get("x2", vector[1]))]
    ax_world = [
        cells[0][0] * x_world[0] + cells[0][1] * x_world[1],
        cells[1][0] * x_world[0] + cells[1][1] * x_world[1],
    ]
    if invertible:
        inverse_basis = [[round(float(P.inv()[row, column]), 10) for column in range(2)] for row in range(2)]
        B = P.inv() * A * P
        transformed = [[round(float(B[row, column]), 10) for column in range(2)] for row in range(2)]
        coord_vector = P.inv() * sp.Matrix(x_world)
        coords_ax_vector = P.inv() * sp.Matrix(ax_world)
        coords = [round(float(coord_vector[index]), 10) for index in range(2)]
        coords_ax = [round(float(coords_ax_vector[index]), 10) for index in range(2)]
        mapped = B * sp.Matrix(coords)
        coordinates = {
            "x": coords,
            "Ax": coords_ax,
            "B_maps_x_to": [round(float(mapped[index]), 10) for index in range(2)],
        }
        eigenvalues = sorted(float(value) for value in A.eigenvals().keys())
        invariants = {
            "trace": round(trace_a, 10),
            "det": round(det_a, 10),
            "eigenvalues": eigenvalues,
            "transformed_trace": round(float(B.trace()), 10),
            "transformed_det": round(float(B.det()), 10),
        }
        if abs(float(B.trace()) - trace_a) > 1e-8 or abs(float(B.det()) - det_a) > 1e-8:
            checks.append(
                {
                    "id": "invariants_preserved",
                    "label": "迹与行列式保持不变",
                    "status": "fail",
                    "detail": "换基后不变量不一致，结果不可用于教学。",
                }
            )
        else:
            checks.append(
                {
                    "id": "invariants_preserved",
                    "label": "迹与行列式保持不变",
                    "status": "pass",
                    "detail": f"tr(B)={float(B.trace()):.6g}，det(B)={float(B.det()):.6g}。",
                }
            )
    return {
        "subject": "matrix",
        "kind": "change_of_basis",
        "matrix": cells,
        "basis_angle_deg": angle,
        "basis": basis,
        "inverse_basis": inverse_basis,
        "transformed": transformed,
        "coordinates": coordinates,
        "invariants": invariants,
        "world": {"x": x_world, "Ax": ax_world},
        "metrics": metrics,
        "checks": checks,
        "trace": [],
        "notes": ["A 与换基关系来自原稿或用户确认；旋转基由声明的角度生成。"],
    }


def evaluate_node(node: CompiledNode, canonical: CanonicalValues) -> dict[str, Any]:
    values, violations = _parameter_values(node, canonical)
    provider = node.provider if isinstance(node.provider, Mapping) else {}
    kind = provider.get("kind")
    result: dict[str, Any] = {}
    try:
        if kind == "lab":
            model = provider.get("model") if isinstance(provider.get("model"), Mapping) else {}
            result = evaluate_problem(model, values)
        elif kind == "expression":
            result = _expression_result(node, provider, values)
        elif kind == "chart":
            result = _chart_result(node, provider, values)
        elif kind == "table":
            result = _table_result(node, provider, values)
        elif kind == "matrix":
            result = _matrix_result(node, provider, values)
        elif kind == "change_of_basis":
            result = _change_of_basis_result(node, provider, values)
        elif kind == "explain":
            result = {
                "subject": "explain",
                "text": str(provider.get("text") or "")[:4000],
                "metrics": [],
                "checks": [],
                "trace": [],
            }
        elif kind in (
            "taylor", "double_integral", "newton_1d", "least_squares",
            "stack_queue", "sorting", "activation", "conv_pool", "projectile", "spring",
        ):
            from .templates_kernels import evaluate_template

            result = evaluate_template(str(kind), provider, values)
            if isinstance(result.get("error"), str) and "error" in result:
                violations.append({"node_id": node.node_id, "message": str(result["error"])})
        else:
            raise EvaluationError(f"未知 provider：{kind}")
    except (SolveError, ExprError, EvaluationError, ValueError, TypeError) as exc:
        violations.append({"node_id": node.node_id, "message": f"求值失败：{exc}"})
        result = {"subject": "error", "metrics": [], "checks": [], "trace": [], "error": str(exc)}
    checks = result.get("checks") if isinstance(result.get("checks"), list) else []
    return {
        "values": values,
        "result": result,
        "checks": checks,
        "violations": violations,
    }


def declared_output_value(result: Mapping[str, Any], output: OutputSpec) -> CanonicalValue | None:
    """按 OutputSpec 从求值结果取一个可被下游引用的值；取不到就不写。"""

    value = result.get(output.key)
    if output.type in ("vector2", "number_list", "number_matrix", "matrix2"):
        if isinstance(value, list) and value:
            return value  # type: ignore[return-value]
    elif output.type in ("number", "integer"):
        number = _numeric(value)
        if number is not None:
            return number
    elif output.type == "boolean" and isinstance(value, bool):
        return value
    elif output.type in ("string", "enum") and isinstance(value, str):
        return value
    if output.type in ("number", "integer"):
        metrics = result.get("metrics")
        if isinstance(metrics, list):
            for metric in metrics:
                if not isinstance(metric, Mapping) or metric.get("id") != output.key:
                    continue
                try:
                    number = float(str(metric.get("value")).replace("−", "-"))
                except (TypeError, ValueError):
                    return None
                return number if math.isfinite(number) else None
    return None


def declaration_checks(
    bundle: InteractionBundle,
    derived_values: Mapping[str, CanonicalValue],
) -> list[dict[str, Any]]:
    """运行时对照已确认的页面声明：改参数使输出偏离原稿声明时持续报警。

    只比对经 ``derived_from`` 关系确认过的声明；未确认的声明不产生检查。
    """

    declarations = {
        node.concept_id: node
        for node in bundle.graph.nodes
        if node.semantic_role == "declaration"
    }
    if not declarations:
        return []
    checks: list[dict[str, Any]] = []
    for relation in bundle.graph.relations:
        if relation.type != "derived_from":
            continue
        declaration = next(
            (declarations[concept_id] for concept_id in relation.outputs or [] if concept_id in declarations),
            None,
        )
        if declaration is None or not relation.inputs:
            continue
        declared = _numeric(declaration.default)
        computed = _numeric(derived_values.get(relation.inputs[0]))
        if declared is None or computed is None:
            continue
        matched = _values_match(declared, computed)
        checks.append(
            {
                "id": f"declaration_match_{relation.relation_id[:24]}",
                "label": f"页面声明对照：{declaration.name}",
                "status": "pass" if matched else "fail",
                "detail": (
                    f"页面写 {declared:g}，当前算出 {computed:.8g}，一致。"
                    if matched
                    else f"页面写 {declared:g}，当前算出 {computed:.8g}；参数已使输出偏离原稿声明。"
                ),
            }
        )
    return checks


def _node_canonical(
    node: CompiledNode,
    values: CanonicalValues,
    derived_values: Mapping[str, CanonicalValue],
    overrides: Mapping[str, CanonicalValue] | None = None,
) -> CanonicalValues:
    canonical = dict(values)
    for parameter in node.parameters:
        binding = parameter.binding
        if binding.mode == "linked" and binding.concept_id in derived_values:
            value = derived_values[binding.concept_id]
            factor = float(binding.factor or 1.0)
            if factor != 1.0:
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    value = value * factor
                elif isinstance(value, list):
                    value = [
                        [item * factor for item in row] if isinstance(row, list) else row * factor
                        for row in value
                        if isinstance(row, (int, float, list))
                    ]
            canonical[parameter.concept_id] = value
    if overrides:
        for concept_id, value in overrides.items():
            canonical[concept_id] = value
    return canonical


def _evaluation_hash(
    derived: Mapping[str, Any],
    checks: Sequence[dict[str, Any]],
    violations: Sequence[dict[str, Any]],
    derived_values: Mapping[str, CanonicalValue],
) -> str:
    payload: dict[str, Any] = {
        "derived": derived,
        "checks": list(checks),
        "violations": list(violations),
    }
    # 没有派生输出时保持历史哈希口径不变，旧分支快照仍可复用。
    if derived_values:
        payload["derived_values"] = derived_values
    return hash_json(payload)


def _evaluate_in_order(
    bundle: InteractionBundle,
    values: CanonicalValues,
    *,
    order: Sequence[str],
    overrides: Mapping[str, CanonicalValues] | None,
    previous: EvaluationSnapshot | None,
    recompute: set[str],
    branch_revision: int,
    base_violations: Sequence[dict[str, Any]] = (),
) -> tuple[EvaluationSnapshot, dict[str, dict[str, Any]]]:
    nodes = {node.node_id: node for node in bundle.compiled.nodes}
    derived: dict[str, Any] = {}
    derived_values: dict[str, CanonicalValue] = {}
    per_node_violations: dict[str, list[dict[str, Any]]] = {}
    cached = previous.derived if previous is not None else {}
    cached_values = previous.derived_values if previous is not None else {}
    cached_violations: dict[str, list[dict[str, Any]]] = {}
    if previous is not None:
        for item in previous.violations:
            node_id = str(item.get("node_id") or "")
            cached_violations.setdefault(node_id, []).append(dict(item))
    for node_id in order:
        node = nodes.get(node_id)
        if node is None:
            continue
        if previous is not None and node_id not in recompute and node_id in cached:
            result = cached[node_id]
            derived[node.node_id] = result
            for output in node.outputs:
                if output.concept_id in cached_values:
                    derived_values[output.concept_id] = cached_values[output.concept_id]
            per_node_violations[node.node_id] = cached_violations.get(node_id, [])
            continue
        local_overrides = (overrides or {}).get(node_id) or {}
        canonical = _node_canonical(node, values, derived_values, local_overrides)
        missing = [
            {
                "node_id": node.node_id,
                "parameter": parameter.id,
                "message": f"上游输出 {parameter.binding.concept_id} 没有可用值，已使用本页默认值。",
            }
            for parameter in node.parameters
            if parameter.binding.mode == "linked"
            and parameter.binding.concept_id not in derived_values
            and parameter.concept_id not in local_overrides
        ]
        evaluated = evaluate_node(node, canonical)
        derived[node.node_id] = evaluated["result"]
        per_node_violations[node.node_id] = [*missing, *evaluated["violations"]]
        for output in node.outputs:
            output_value = declared_output_value(evaluated["result"], output)
            if output_value is not None:
                derived_values[output.concept_id] = output_value
    all_checks: list[dict[str, Any]] = []
    violations: list[dict[str, Any]] = [dict(item) for item in base_violations]
    trace: list[dict[str, Any]] = []
    for node_id in order:
        if node_id not in derived:
            continue
        checks = derived[node_id].get("checks") if isinstance(derived[node_id], Mapping) else None
        if isinstance(checks, list):
            all_checks.extend(item for item in checks if isinstance(item, dict))
        violations.extend(per_node_violations.get(node_id, []))
        node_trace = derived[node_id].get("trace") if isinstance(derived[node_id], Mapping) else None
        if isinstance(node_trace, list):
            trace.extend(item for item in node_trace if isinstance(item, dict))
    # 页面声明对照：每次求值都按最终派生值重新比对，不随节点缓存漂移。
    all_checks.extend(declaration_checks(bundle, derived_values))
    input_hash = (
        hash_json(values)
        if not overrides
        else hash_json({"values": values, "overrides": overrides})
    )
    return (
        EvaluationSnapshot(
            input_hash=input_hash,
            evaluation_hash=_evaluation_hash(derived, all_checks, violations, derived_values),
            branch_revision=max(1, int(branch_revision)),
            values=values,
            derived=derived,
            derived_values=derived_values,
            trace=trace,
            checks=all_checks,
            violations=violations,
            stop_reason="evaluated" if not violations else "violations",
            kernel_version=KERNEL_VERSION,
        ),
        derived,
    )


def node_order(bundle: InteractionBundle) -> tuple[list[str], list[list[str]]]:
    declared = bundle.graph.dependency_order
    order, cycles = dependency_order(bundle.compiled.nodes, declared or None)
    return order, cycles


def evaluate_model(
    bundle: InteractionBundle,
    values: CanonicalValues,
    *,
    branch_revision: int = 1,
    overrides: Mapping[str, CanonicalValues] | None = None,
) -> EvaluationSnapshot:
    order, cycles = node_order(bundle)
    base_violations: list[dict[str, Any]] = []
    if cycles:
        base_violations.append(
            {
                "code": "dependency_cycle",
                "message": "节点依赖成环，已拒绝按拓扑序求值：" + "；".join(" → ".join(cycle) for cycle in cycles),
                "nodes": cycles,
            }
        )
        order = [node.node_id for node in bundle.compiled.nodes]
    snapshot, _derived = _evaluate_in_order(
        bundle,
        values,
        order=order,
        overrides=overrides,
        previous=None,
        recompute={node.node_id for node in bundle.compiled.nodes},
        branch_revision=branch_revision,
        base_violations=base_violations,
    )
    return snapshot


def evaluate_model_incremental(
    bundle: InteractionBundle,
    values: CanonicalValues,
    previous: EvaluationSnapshot | None,
    changed_concepts: Sequence[str],
    *,
    branch_revision: int | None = None,
    overrides: Mapping[str, CanonicalValues] | None = None,
    changed_overrides: Sequence[str] = (),
) -> tuple[EvaluationSnapshot, set[str]]:
    """只重算受影响节点；结果必须与全量求值完全一致（见属性测试）。"""

    has_linked = any(
        parameter.binding.mode == "linked"
        for node in bundle.compiled.nodes
        for parameter in node.parameters
    )
    has_outputs = any(node.outputs for node in bundle.compiled.nodes)
    if previous is None or not previous.derived or (
        (has_linked or has_outputs) and not previous.derived_values
    ):
        snapshot = evaluate_model(
            bundle,
            values,
            branch_revision=branch_revision or 1,
            overrides=overrides,
        )
        return snapshot, {node.node_id for node in bundle.compiled.nodes}
    order, cycles = node_order(bundle)
    if cycles:
        snapshot = evaluate_model(
            bundle,
            values,
            branch_revision=branch_revision or previous.branch_revision,
            overrides=overrides,
        )
        return snapshot, {node.node_id for node in bundle.compiled.nodes}
    affected = affected_node_ids(bundle.compiled.nodes, changed_concepts)
    affected.update(changed_overrides)
    if not affected:
        # 输入没被任何节点使用：只更新输入哈希，派生结果沿用。
        snapshot = previous.model_copy(
            update={
                "values": values,
                "input_hash": (
                    hash_json(values)
                    if not overrides
                    else hash_json({"values": values, "overrides": overrides})
                ),
                "branch_revision": max(1, int(branch_revision or previous.branch_revision)),
            }
        )
        return snapshot, set()
    recompute = set(affected)
    changed = True
    while changed:
        changed = False
        for node in bundle.compiled.nodes:
            if node.node_id in recompute:
                continue
            for parameter in node.parameters:
                if parameter.binding.mode == "linked" and parameter.binding.concept_id:
                    producer = next(
                        (
                            item
                            for item in bundle.compiled.nodes
                            if any(output.concept_id == parameter.binding.concept_id for output in item.outputs)
                        ),
                        None,
                    )
                    if producer is not None and producer.node_id in recompute:
                        recompute.add(node.node_id)
                        changed = True
                        break
    snapshot, _derived = _evaluate_in_order(
        bundle,
        values,
        order=order,
        overrides=overrides,
        previous=previous,
        recompute=recompute,
        branch_revision=branch_revision or previous.branch_revision,
    )
    return snapshot, recompute


def default_values(bundle: InteractionBundle) -> CanonicalValues:
    values: CanonicalValues = {}
    for node in bundle.compiled.nodes:
        for parameter in node.parameters:
            if parameter.binding.mode == "linked":
                continue
            values.setdefault(parameter.concept_id, parameter.default)
    return values


def numeric_output(result: Mapping[str, Any], output: str = "") -> float | None:
    """从节点求值结果取一个可比较的数值输出。"""

    if output:
        value = result.get(output)
        number = _numeric(value)
        if number is not None:
            return number
        for metric in result.get("metrics", []) if isinstance(result.get("metrics"), list) else []:
            if isinstance(metric, Mapping) and metric.get("id") == output:
                try:
                    return float(str(metric.get("value")).replace("−", "-"))
                except (TypeError, ValueError):
                    return None
    for key in ("exact", "value", "approx", "loss", "det", "best_value", "answer_value"):
        number = _numeric(result.get(key))
        if number is not None:
            return number
    for metric in result.get("metrics", []) if isinstance(result.get("metrics"), list) else []:
        if not isinstance(metric, Mapping):
            continue
        if metric.get("id") in ("rows", "columns", "count", "data_points"):
            continue
        try:
            return float(str(metric.get("value")).replace("−", "-"))
        except (TypeError, ValueError):
            continue
    return None


def node_by_id(bundle: InteractionBundle, node_id: str) -> CompiledNode:
    for node in bundle.compiled.nodes:
        if node.node_id == node_id:
            return node
    raise EvaluationError(f"节点不存在：{node_id}")


def input_values_for_node(node: CompiledNode, canonical: CanonicalValues) -> CanonicalValues:
    values: CanonicalValues = {}
    for parameter in node.parameters:
        values[parameter.concept_id] = canonical.get(parameter.concept_id, parameter.default)
    return values


__all__ = [
    "EvaluationError",
    "KERNEL_VERSION",
    "declared_output_value",
    "declaration_checks",
    "default_values",
    "evaluate_model",
    "evaluate_model_incremental",
    "evaluate_node",
    "input_values_for_node",
    "node_by_id",
    "node_order",
    "numeric_output",
]
