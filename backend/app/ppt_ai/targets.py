"""目标反求：线性逆映射与单参数有界搜索。

- 线性映射区分唯一解、多解、无解，返回残差；奇异矩阵不强行取逆。
- 标量搜索只在声明范围内找候选；不收敛/超时不是“数学无解”。
- 有限采样最小值不冒充全局最优；候选先复算，再创建候选分支。
"""

from __future__ import annotations

import logging
import math
import time
from typing import Any, Mapping, Sequence

import sympy as sp
from sqlalchemy.orm import Session

from ..db.models import MaterialRecord
from ..db.ppt_ai_models import PptAiTaskRecord
from ..settings import get_settings
from .branches import create_branch
from .evaluation import EvaluationError, evaluate_model, evaluate_node, numeric_output
from .store import get_branch_row, get_bundle
from .types import (
    CanonicalValues,
    CompiledNode,
    FrozenContext,
    TargetCandidate,
    TargetRequest,
    TargetResult,
    TargetSolution,
)
from .util import now_iso

logger = logging.getLogger(__name__)

ATOL = 1e-8
RTOL = 1e-6
MAX_GRID = 161


def _tolerance(target: float, request: TargetRequest) -> float:
    return max(ATOL, request.tolerance, RTOL * abs(target))


def _node_parameter(node: CompiledNode, concept_id: str):
    for parameter in node.parameters:
        if parameter.concept_id == concept_id or parameter.id == concept_id:
            return parameter
    return None


def _resolve_variables(node: CompiledNode, requested: Sequence[str]) -> list[str]:
    resolved = []
    for item in requested:
        parameter = _node_parameter(node, item)
        if parameter is None:
            raise EvaluationError(f"目标变量不存在：{item}")
        resolved.append(parameter.concept_id)
    return list(dict.fromkeys(resolved))


def _ranges(
    node: CompiledNode, variables: Sequence[str], requested: Mapping[str, list[float]]
) -> dict[str, list[float]]:
    result: dict[str, list[float]] = {}
    for concept_id in variables:
        parameter = _node_parameter(node, concept_id)
        if parameter is None or parameter.type not in ("number", "integer"):
            continue
        if concept_id in requested:
            low, high = requested[concept_id]
            result[concept_id] = [float(low), float(high)]
            continue
        default = float(parameter.default) if isinstance(parameter.default, (int, float)) else 0.0
        low = float(parameter.min) if parameter.min is not None else default - 5.0
        high = float(parameter.max) if parameter.max is not None else default + 5.0
        if high - low > 40:
            low, high = default - 10.0, default + 10.0
        if high <= low:
            high = low + 1.0
        result[concept_id] = [low, high]
    return result


def _matrix_values(node: CompiledNode, values: CanonicalValues) -> list[list[float]]:
    base = node.provider.get("matrix") if isinstance(node.provider.get("matrix"), list) else [[1, 0], [0, 1]]
    matrix = [[float(base[row][column]) for column in range(2)] for row in range(2)]
    for row in range(2):
        for column in range(2):
            parameter = _node_parameter(node, f"a{row + 1}{column + 1}")
            if parameter is not None:
                matrix[row][column] = float(values.get(parameter.concept_id, parameter.default))
    return matrix


def _vector_values(node: CompiledNode, values: CanonicalValues, request: TargetRequest) -> list[float] | None:
    if request.target_vector is not None:
        return [float(item) for item in request.target_vector]
    base = node.provider.get("vector") if isinstance(node.provider.get("vector"), list) else None
    if base:
        result = []
        for index in range(2):
            parameter = _node_parameter(node, f"v{index + 1}")
            if parameter is not None:
                result.append(float(values.get(parameter.concept_id, parameter.default)))
            else:
                result.append(float(base[index]))
        return result
    return None


def _fmt(value: float) -> str:
    if abs(value - round(value)) < 1e-12:
        return str(int(round(value)))
    return f"{value:.10g}"


def _exact(value: float) -> str:
    rational = sp.Rational(value).limit_denominator(1_000_000)
    if rational.q == 1:
        return str(rational.p)
    return f"{rational.p}/{rational.q}"


def _unknown_bindings(node: CompiledNode, request: TargetRequest) -> list[tuple[str, str]]:
    """未知量的 (展示名, 值键)：展示 v1/v2，值仍写入节点 concept_id。"""

    requested = [str(item) for item in request.variables[:2]]
    bindings: list[tuple[str, str]] = []
    for index, item in enumerate(requested):
        parameter = _node_parameter(node, item)
        if parameter is not None and parameter.type in ("number", "integer"):
            bindings.append((parameter.id, parameter.concept_id))
        elif item.lower() in ("v1", "v2", "v", "x1", "x2"):
            bindings.append((item, item))
        else:
            bindings.append((f"v{index + 1}", item))
    while len(bindings) < 2:
        fallback = _node_parameter(node, f"v{len(bindings) + 1}")
        display = f"v{len(bindings) + 1}"
        bindings.append((display, fallback.concept_id if fallback is not None else display))
    return bindings[:2]


def _solution_values(
    candidate_values: CanonicalValues, value_keys: list[str], values: list[float]
) -> CanonicalValues:
    merged = dict(candidate_values)
    for key, value in zip(value_keys, values):
        merged[key] = float(value)
    return merged


def _equations(matrix: list[list[float]], target: list[float], names: list[str]) -> list[str]:
    return [
        f"{_fmt(matrix[row][0])}·{names[0]} + {_fmt(matrix[row][1])}·{names[1]} = {_fmt(target[row])}"
        for row in range(2)
    ]


def _row_verification(
    matrix: list[list[float]], target: list[float], values: list[float], names: list[str]
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for row in range(2):
        left = matrix[row][0] * values[0] + matrix[row][1] * values[1]
        residual = abs(left - target[row])
        items.append(
            {
                "label": f"代回第 {row + 1} 行（{names[0]}, {names[1]}）",
                "expected": _fmt(target[row]),
                "actual": f"{left:.10g}",
                "residual": residual,
                "status": "pass" if residual <= max(ATOL, RTOL * max(1.0, abs(target[row]))) else "fail",
            }
        )
    return items


def _linear_inverse(
    node: CompiledNode,
    request: TargetRequest,
    context: FrozenContext,
    variables: list[str],
) -> TargetResult | None:
    if node.operator_id != "matrix.transform" or request.output not in ("product", "Av", "Ax"):
        return None
    target = _vector_values(node, context.values, request)
    if target is None or len(target) != 2:
        return None
    bindings = _unknown_bindings(node, request)
    names = [name for name, _key in bindings]
    value_keys = [key for _name, key in bindings]
    matrix = _matrix_values(node, context.values)
    A = sp.Matrix(matrix)
    y = sp.Matrix(target)
    det_value = float(A.det())
    residual_tolerance = _tolerance(float(max(abs(value) for value in target)), request)
    method = "linear_inverse"
    if abs(det_value) > 1e-12:
        solution = A.inv() * y
        solution_values = [float(solution[0]), float(solution[1])]
        residual_vector = A * sp.Matrix(solution_values) - y
        residual = float(max(abs(value) for value in residual_vector))
        status = "found" if residual <= residual_tolerance else "unknown"
        candidate_values = _solution_values(dict(context.values), value_keys, solution_values)
        verified = _row_verification(matrix, target, solution_values, names)
        explicit = TargetSolution(
            unknowns=names,
            values=solution_values,
            classification="unique",
            exact_values=[_exact(value) for value in solution_values],
            free_variables=[],
            nullspace_basis=[],
            equations=_equations(matrix, target, names),
            verification=verified,
        )
        candidate = TargetCandidate(
            values=candidate_values,
            output_value=None,
            residual=residual,
            method="unique_inverse",
            solution=explicit,
        )
        return TargetResult(
            status=status,  # type: ignore[arg-type]
            output=request.output,
            target_value=request.target_value,
            candidates=[candidate] if status == "found" else [],
            method=method,
            tolerance=request.tolerance,
            atol=ATOL,
            rtol=RTOL,
            residual=residual,
            search_scope=_ranges(node, variables, request.ranges),
            iterations=1,
            stop_reason="unique_solution" if status == "found" else "residual_exceeds_tolerance",
            checks=[
                {
                    "id": "det",
                    "status": "pass",
                    "message": f"det(A)={det_value:.8g} ≠ 0，存在唯一解。",
                },
                {
                    "id": "residual",
                    "status": "pass" if residual <= residual_tolerance else "fail",
                    "message": f"‖Av−y‖={residual:.3g}。",
                },
            ],
        )
    augmented = A.row_join(y)
    rank_a = A.rank()
    rank_aug = augmented.rank()
    if rank_a == rank_aug:
        # 多解：把自由变量置 0，求一个特解；明确说明解集未完全枚举。
        solution_values: list[float] | None = None
        for row in range(2):
            a = float(A[row, 0])
            b = float(A[row, 1])
            c = float(y[row])
            if abs(a) > 1e-12:
                solution_values = [c / a, 0.0]
                break
            if abs(b) > 1e-12:
                solution_values = [0.0, c / b]
                break
        if solution_values is None:
            # 全零矩阵（或所有行系数为 0）时任意输入都可满足；取可验证的特解 (0,0)。
            zero_candidate = [0.0, 0.0]
            if max(abs(value) for value in (A * sp.Matrix(zero_candidate) - y)) <= 1e-6:
                solution_values = zero_candidate
        if solution_values is not None:
            residual_check = A * sp.Matrix(solution_values) - y
            if max(abs(value) for value in residual_check) > 1e-6:
                solution_values = None
        residual = 0.0
        if solution_values is not None:
            residual = float(max(abs(value) for value in (A * sp.Matrix(solution_values) - y)))
        nullspace = [list(map(float, vector)) for vector in A.nullspace()]
        pivots = set(A.rref()[1])
        free_variables = [names[index] for index in range(2) if index not in pivots]
        candidate_values = (
            _solution_values(dict(context.values), value_keys, solution_values)
            if solution_values is not None
            else dict(context.values)
        )
        explicit = (
            TargetSolution(
                unknowns=names,
                values=solution_values,
                classification="particular",
                exact_values=[_exact(value) for value in solution_values],
                free_variables=free_variables,
                nullspace_basis=nullspace,
                equations=_equations(matrix, target, names),
                verification=_row_verification(matrix, target, solution_values, names),
            )
            if solution_values is not None
            else None
        )
        return TargetResult(
            status="multiple",
            output=request.output,
            target_value=request.target_value,
            candidates=[
                TargetCandidate(
                    values=candidate_values,
                    output_value=None,
                    residual=residual,
                    method="rank_deficient_particular",
                    solution=explicit,
                )
            ]
            if solution_values is not None
            else [],
            method=method,
            tolerance=request.tolerance,
            atol=ATOL,
            rtol=RTOL,
            residual=residual,
            search_scope={},
            iterations=1,
            stop_reason="multiple_solutions",
            checks=[
                {"id": "rank", "status": "pass", "message": f"rank(A)={rank_a}=rank([A|y])，存在多解。"},
                {"id": "residual", "status": "pass", "message": f"特解残差 {residual:.3g}；解集未完全枚举。"},
            ],
        )
    return TargetResult(
        status="infeasible_proven",
        output=request.output,
        target_value=request.target_value,
        candidates=[],
        method=method,
        tolerance=request.tolerance,
        atol=ATOL,
        rtol=RTOL,
        residual=None,
        search_scope={},
        iterations=1,
        stop_reason="inconsistent_linear_system",
        checks=[
            {
                "id": "rank",
                "status": "fail",
                "message": f"rank(A)={rank_a} < rank([A|y])={rank_aug}，线性方程组无精确解。",
            }
        ],
    )


def solve_target(
    request: TargetRequest,
    context: FrozenContext,
    *,
    bundle,
) -> TargetResult:
    node = next((item for item in bundle.compiled.nodes if item.node_id == request.node_id), None)
    if node is None:
        raise EvaluationError(f"节点不存在：{request.node_id}")
    # 先按拓扑求值一次，把上游派生输出解到本节点的 linked 参数上；
    # 否则目标反求会把链接参数退回默认值，得到与页面不一致的结果。
    resolved = dict(context.values)
    try:
        snapshot = evaluate_model(bundle, resolved)
        for parameter in node.parameters:
            binding = parameter.binding
            if binding.mode != "linked" or binding.concept_id not in snapshot.derived_values:
                continue
            value = snapshot.derived_values[binding.concept_id]
            factor = float(binding.factor or 1.0)
            if factor != 1.0 and isinstance(value, (int, float)) and not isinstance(value, bool):
                value = value * factor
            elif factor != 1.0 and isinstance(value, list):
                value = [
                    [cell * factor for cell in row] if isinstance(row, list) else row * factor
                    for row in value
                    if isinstance(row, (int, float, list))
                ]
            resolved[parameter.concept_id] = value
        context = context.model_copy(update={"values": resolved})
    except (EvaluationError, ValueError, TypeError):
        pass
    # 线性逆映射的未知量（v1/v2）可以不在节点参数表中；不能因缺少参数拒绝显式解。
    linear = _linear_inverse(node, request, context, [str(item) for item in request.variables])
    if linear is not None:
        return linear
    variables = _resolve_variables(node, request.variables)
    if len(variables) != 1:
        return TargetResult(
            status="unknown",
            output=request.output,
            target_value=request.target_value,
            candidates=[],
            method="unsupported",
            tolerance=request.tolerance,
            atol=ATOL,
            rtol=RTOL,
            search_scope={},
            stop_reason="first_version_supports_single_scalar_variable",
            checks=[
                {
                    "id": "scope",
                    "status": "not_covered",
                    "message": "首版标量搜索只支持一个可改变量；多变量请先固定其余变量或使用线性逆映射。",
                }
            ],
        )
    variable = variables[0]
    parameter = _node_parameter(node, variable)
    if parameter is not None and parameter.binding.mode == "linked":
        return TargetResult(
            status="unknown",
            output=request.output,
            target_value=request.target_value,
            candidates=[],
            method="unsupported",
            tolerance=request.tolerance,
            atol=ATOL,
            rtol=RTOL,
            search_scope={},
            stop_reason="linked_parameter_not_tunable",
            checks=[{"id": "scope", "status": "not_covered", "message": "联动参数跟随上游输出，不能直接反求。"}],
        )
    tolerance = _tolerance(request.target_value, request)
    fixed_values = dict(context.values)
    for key, value in request.fixed.items():
        fixed_parameter = _node_parameter(node, key)
        if fixed_parameter is not None:
            fixed_values[fixed_parameter.concept_id] = value
    deadline = time.monotonic() + float(get_settings().ppt_ai_task_timeout_s)
    iterations = 0
    if parameter is not None and parameter.type in ("enum", "boolean", "string"):
        options = [False, True] if parameter.type == "boolean" else list(parameter.options) if parameter.type == "enum" else [parameter.default]
        candidates: list[TargetCandidate] = []
        closest: tuple[float, float | None, CanonicalValues] | None = None
        for value in options:
            if time.monotonic() > deadline:
                return TargetResult(status="timeout", output=request.output, target_value=request.target_value,
                                    candidates=candidates, method="discrete_enumeration",
                                    tolerance=request.tolerance, atol=ATOL, rtol=RTOL, residual=None,
                                    search_scope={}, iterations=iterations, stop_reason="timeout")
            values = dict(fixed_values)
            values[variable] = value  # type: ignore[assignment]
            evaluated = evaluate_node(node, values)
            iterations += 1
            output = numeric_output(evaluated["result"], request.output)
            if output is None:
                continue
            residual = abs(output - request.target_value)
            if closest is None or residual < closest[0]:
                closest = (residual, output, values)
            if residual <= tolerance:
                candidates.append(TargetCandidate(values=values, output_value=output, residual=residual, method="discrete_enumeration"))
        if candidates:
            unique = []
            for candidate in candidates:
                if all(candidate.values.get(variable) != other.values.get(variable) for other in unique):
                    unique.append(candidate)
            return TargetResult(status="multiple" if len(unique) > 1 else "found",
                                output=request.output, target_value=request.target_value, candidates=unique,
                                method="discrete_enumeration", tolerance=request.tolerance, atol=ATOL, rtol=RTOL,
                                residual=min(candidate.residual or 0.0 for candidate in unique),
                                search_scope={}, iterations=iterations, stop_reason="discrete_hit",
                                checks=[{"id": "scope", "status": "pass", "message": f"在 {len(options)} 个离散选项中匹配。"}])
        return TargetResult(status="none_in_scope" if closest else "unknown", output=request.output,
                            target_value=request.target_value,
                            candidates=[TargetCandidate(values=closest[2], output_value=closest[1], residual=closest[0], method="closest_discrete")] if closest else [],
                            method="discrete_enumeration", tolerance=request.tolerance, atol=ATOL, rtol=RTOL,
                            residual=closest[0] if closest else None, search_scope={}, iterations=iterations,
                            stop_reason="not_found_in_scope" if closest else "no_finite_outputs",
                            checks=[{"id": "scope", "status": "warn" if closest else "fail",
                                     "message": "离散选项有限，未达到目标不等于数学无解。" if closest else "所有离散选项都没有有限输出。"}])
    ranges = _ranges(node, variables, request.ranges)
    low, high = ranges[variable]

    def evaluate_value(value: float) -> tuple[float | None, dict[str, Any], CanonicalValues]:
        nonlocal iterations
        values = dict(fixed_values)
        values[variable] = value
        evaluated = evaluate_node(node, values)
        iterations += 1
        return numeric_output(evaluated["result"], request.output), evaluated["result"], values

    samples: list[tuple[float, float]] = []
    undefined = 0
    for index in range(MAX_GRID):
        if time.monotonic() > deadline:
            return TargetResult(
                status="timeout",
                output=request.output,
                target_value=request.target_value,
                candidates=[],
                method="grid",
                tolerance=request.tolerance,
                atol=ATOL,
                rtol=RTOL,
                residual=None,
                search_scope={variable: [low, high]},
                iterations=iterations,
                stop_reason="timeout",
            )
        x = low + (high - low) * index / (MAX_GRID - 1)
        output, _result, _values = evaluate_value(x)
        if output is None:
            undefined += 1
            continue
        samples.append((x, output))
        if abs(output - request.target_value) <= tolerance:
            values = dict(fixed_values)
            values[variable] = x
            return TargetResult(
                status="found",
                output=request.output,
                target_value=request.target_value,
                candidates=[
                    TargetCandidate(
                        values=values,
                        output_value=output,
                        residual=abs(output - request.target_value),
                        method="grid_exact",
                    )
                ],
                method="grid",
                tolerance=request.tolerance,
                atol=ATOL,
                rtol=RTOL,
                residual=abs(output - request.target_value),
                search_scope={variable: [low, high]},
                iterations=iterations,
                stop_reason="grid_hit",
                checks=[{"id": "residual", "status": "pass", "message": f"残差 {abs(output - request.target_value):.3g}。"}],
            )
    brackets: list[tuple[float, float]] = []
    for (x1, y1), (x2, y2) in zip(samples, samples[1:]):
        if (y1 - request.target_value) * (y2 - request.target_value) <= 0:
            brackets.append((x1, x2))
            if len(brackets) >= 6:
                break
    candidates: list[TargetCandidate] = []
    for x1, x2 in brackets:
        if len(candidates) >= request.max_iterations:
            break
        if time.monotonic() > deadline:
            return TargetResult(
                status="timeout",
                output=request.output,
                target_value=request.target_value,
                candidates=candidates,
                method="bisection",
                tolerance=request.tolerance,
                atol=ATOL,
                rtol=RTOL,
                residual=None,
                search_scope={variable: [low, high]},
                iterations=iterations,
                stop_reason="timeout",
            )
        left, right = x1, x2
        left_output, _, _ = evaluate_value(left)
        right_output, _, _ = evaluate_value(right)
        if left_output is None or right_output is None:
            continue
        for _ in range(min(request.max_iterations, 80)):
            middle = (left + right) / 2
            output, _result, _values = evaluate_value(middle)
            if output is None:
                left = middle
                continue
            if abs(output - request.target_value) <= tolerance:
                left = right = middle
                break
            if (left_output - request.target_value) * (output - request.target_value) <= 0:
                right = middle
            else:
                left, left_output = middle, output
        values = dict(fixed_values)
        values[variable] = (left + right) / 2
        final_output, _result, _values = evaluate_value(values[variable])
        if final_output is None:
            continue
        residual = abs(final_output - request.target_value)
        candidates.append(
            TargetCandidate(
                values=values,
                output_value=final_output,
                residual=residual,
                method="bisection",
            )
        )
    if candidates:
        distinct = []
        for candidate in candidates:
            if all(abs(candidate.values[variable] - other.values[variable]) > max(tolerance, 1e-6) for other in distinct):
                distinct.append(candidate)
        status = "multiple" if len(distinct) > 1 else "found"
        return TargetResult(
            status=status,  # type: ignore[arg-type]
            output=request.output,
            target_value=request.target_value,
            candidates=distinct[:20],
            method="bisection",
            tolerance=request.tolerance,
            atol=ATOL,
            rtol=RTOL,
            residual=max(candidate.residual or 0.0 for candidate in distinct),
            search_scope={variable: [low, high]},
            iterations=iterations,
            stop_reason="bracketed_roots",
            checks=[
                {
                    "id": "bracket",
                    "status": "pass",
                    "message": f"在声明范围内找到 {len(distinct)} 个有界候选。",
                }
            ],
        )
    best = min(samples, key=lambda item: abs(item[1] - request.target_value)) if samples else None
    if best is None:
        return TargetResult(
            status="unknown",
            output=request.output,
            target_value=request.target_value,
            candidates=[],
            method="grid",
            tolerance=request.tolerance,
            atol=ATOL,
            rtol=RTOL,
            residual=None,
            search_scope={variable: [low, high]},
            iterations=iterations,
            stop_reason="no_finite_outputs",
            checks=[{"id": "output", "status": "fail", "message": "所有采样点都没有有限输出。"}],
        )
    values = dict(fixed_values)
    values[variable] = best[0]
    return TargetResult(
        status="none_in_scope",
        output=request.output,
        target_value=request.target_value,
        candidates=[
            TargetCandidate(
                values=values,
                output_value=best[1],
                residual=abs(best[1] - request.target_value),
                method="closest_grid_point",
            )
        ],
        method="grid",
        tolerance=request.tolerance,
        atol=ATOL,
        rtol=RTOL,
        residual=abs(best[1] - request.target_value),
        search_scope={variable: [low, high]},
        iterations=iterations,
        stop_reason="not_found_in_scope",
        checks=[
            {
                "id": "scope",
                "status": "warn",
                "message": f"在 [{low:g}, {high:g}] 的 {len(samples)} 个有限采样点中未达到目标；这不等于数学无解。",
            }
        ],
    )


def handle_target_task(
    db: Session,
    material: MaterialRecord,
    task: PptAiTaskRecord,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    bundle_id = str(payload.get("bundle_id") or "")
    branch_id = str(payload.get("branch_id") or "")
    request = TargetRequest.model_validate(payload.get("request") or {})
    bundle = get_bundle(db, bundle_id, task.session_id, material.id)
    branch = get_branch_row(db, branch_id, task.session_id, material.id)
    if branch.bundle_id != bundle.bundle_id:
        raise ValueError("分支不属于该 bundle")
    if request.expected_branch_revision is not None and request.expected_branch_revision != branch.revision:
        return {
            "__status__": "superseded",
            "__stage__": "superseded",
            "reason": f"分支已更新（当前 revision={branch.revision}）；目标结果基于旧值，未采用。",
        }
    evaluation = branch.evaluation if isinstance(branch.evaluation, Mapping) else {}
    context_values = dict(branch.canonical_values or {})
    override = payload.get("values")
    if isinstance(override, Mapping) and override:
        context_values.update(override)
    context = FrozenContext(
        bundle_id=bundle.bundle_id,
        bundle_revision=bundle.bundle_revision,
        branch_id=branch.id,
        branch_revision=branch.revision,
        values=context_values,
        evaluation_hash=str(evaluation.get("evaluation_hash") or "0" * 64),
        selection={"node_id": request.node_id, "output": request.output},
        source_projection=[],
    )
    result = solve_target(request, context, bundle=bundle)
    branch_id_out = None
    if result.candidates:
        candidate = result.candidates[0]
        candidate_branch = create_branch(
            db,
            session_id=task.session_id,
            material_id=material.id,
            bundle=bundle,
            values={**context.values, **candidate.values},
            parent_branch_id=branch.id,
            status="candidate",
        )
        branch_id_out = candidate_branch.id
        result = result.model_copy(update={"candidate_branch_id": branch_id_out})
    return {
        "__status__": "succeeded" if result.status in ("found", "multiple", "infeasible_proven") else "needs_review",
        "__stage__": "target_solved",
        "branch_id": branch_id_out,
        "result": result.model_dump(mode="json"),
        "status": result.status,
        "residual": result.residual,
        "iterations": result.iterations,
        "stop_reason": result.stop_reason,
    }


__all__ = ["solve_target", "handle_target_task"]
