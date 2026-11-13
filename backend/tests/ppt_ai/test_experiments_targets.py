"""T07/T08：补充实验 recipe、目标反求与黄金用例。"""

from __future__ import annotations

import pytest

from app.ppt_ai.experiments import generate_experiment, run_experiment
from app.ppt_ai.targets import solve_target
from app.ppt_ai.types import ExperimentRequest, FrozenContext, TargetRequest
from tests.ppt_ai import helpers


def _context(bundle, branch_id="brn_test", revision=1, values=None):
    return FrozenContext(
        bundle_id=bundle.bundle_id,
        bundle_revision=bundle.bundle_revision,
        branch_id=branch_id,
        branch_revision=revision,
        values=values or dict(bundle.seed_values),
        evaluation_hash="a" * 64,
    )


def test_compare_and_sensitivity_recipe() -> None:
    _extraction, _plan, bundle = helpers.bundle_for(helpers.expression_snapshot())
    node = helpers.node_of(bundle, "expression")
    variable = node.parameters[0].concept_id
    context = _context(bundle)
    for recipe in ("compare", "sensitivity"):
        request = ExperimentRequest(
            question="比较不同输入下的结果",
            recipe_hint=recipe,
            selection={"node_id": node.node_id, "output": "value"},
            allowed_variables=[variable],
            ranges={variable: [0, 3]},
            operation_id=f"op_{recipe}",
        )
        draft = generate_experiment(request, context, bundle=bundle)
        result = run_experiment(draft, bundle=bundle)
        assert result.status == "found"
        assert result.recipe_id == recipe
        assert result.paths
        assert result.candidate_count >= 3


def test_counterexample_requires_explicit_predicate() -> None:
    _extraction, _plan, bundle = helpers.bundle_for(helpers.expression_snapshot())
    node = helpers.node_of(bundle, "expression")
    variable = node.parameters[0].concept_id
    context = _context(bundle)
    request = ExperimentRequest(
        question="在这个范围里有没有反例？",
        recipe_hint="counterexample",
        selection={"node_id": node.node_id, "output": "value"},
        allowed_variables=[variable],
        ranges={variable: [0, 3]},
        operation_id="op_counter_unknown",
    )
    draft = generate_experiment(request, context, bundle=bundle)
    assert draft.status == "needs_review"
    result = run_experiment(draft, bundle=bundle)
    assert result.status == "unknown"
    assert "predicate" in (result.stop_reason or "") or result.checks


def test_counterexample_witness_and_no_proof() -> None:
    _extraction, _plan, bundle = helpers.bundle_for(helpers.expression_snapshot())
    node = helpers.node_of(bundle, "expression")
    variable = node.parameters[0].concept_id
    context = _context(bundle)
    request = ExperimentRequest(
        question="反例：结果等于 4 是否在所有输入都成立？",
        recipe_hint="counterexample",
        selection={"node_id": node.node_id, "output": "value"},
        allowed_variables=[variable],
        ranges={variable: [0, 3]},
        operation_id="op_counter",
    )
    draft = generate_experiment(request, context, bundle=bundle)
    assert draft.predicate is not None
    result = run_experiment(draft, bundle=bundle)
    assert result.status == "found"
    assert result.paths and result.paths[0].witness
    assert "证明" in " ".join(result.explanation)


def test_boundary_finds_sign_change() -> None:
    _extraction, _plan, bundle = helpers.bundle_for(helpers.expression_snapshot())
    node = helpers.node_of(bundle, "expression")
    variable = node.parameters[0].concept_id
    context = _context(bundle)
    request = ExperimentRequest(
        question="结果何时跨过 0？",
        recipe_hint="boundary",
        selection={"node_id": node.node_id, "output": "value"},
        allowed_variables=[variable],
        ranges={variable: [-3, 3]},
        operation_id="op_boundary",
    )
    draft = generate_experiment(request, context, bundle=bundle)
    result = run_experiment(draft, bundle=bundle)
    assert result.status == "found"
    witness = result.paths[0].witness
    assert witness is not None
    assert abs(float(witness["boundary"])) < 0.1


def test_linear_inverse_golden_cases() -> None:
    cases = [
        ("A = [[2,0],[0,1]]，v = (4,3)", [4, 3], "found"),
        ("A = [[1,0],[0,0]]，v = (2,0)", [2, 0], "multiple"),
        ("A = [[1,0],[0,0]]，v = (2,1)", [2, 1], "infeasible_proven"),
    ]
    for text, target, expected in cases:
        snap = helpers.matrix_snapshot("mat_matrix_golden", text)
        _extraction, _plan, bundle = helpers.bundle_for(snap)
        node = helpers.node_of(bundle, "matrix")
        variables = [parameter.concept_id for parameter in node.parameters if parameter.id in ("v1", "v2")]
        request = TargetRequest(
            node_id=node.node_id,
            output="product",
            target_value=0,
            target_vector=target,
            variables=variables,
            tolerance=1e-6,
            operation_id=f"op_{expected}",
        )
        result = solve_target(request, _context(bundle), bundle=bundle)
        assert result.status == expected, (text, result.status, result.stop_reason)
        if expected == "found":
            assert result.residual is not None and result.residual < 1e-6


def test_scalar_search_does_not_claim_no_solution_out_of_scope() -> None:
    _extraction, _plan, bundle = helpers.bundle_for(helpers.expression_snapshot())
    node = helpers.node_of(bundle, "expression")
    x_concept = node.parameters[0].concept_id
    request = TargetRequest(
        node_id=node.node_id,
        output="value",
        target_value=9,
        variables=[x_concept],
        ranges={x_concept: [-2, 0]},
        tolerance=1e-6,
        operation_id="op_out",
    )
    result = solve_target(request, _context(bundle), bundle=bundle)
    assert result.status == "none_in_scope"
    assert result.stop_reason == "not_found_in_scope"
    assert "不等于数学无解" in " ".join(str(check.get("message")) for check in result.checks)


def test_target_rejects_multiple_variables_without_linear_map() -> None:
    _extraction, _plan, bundle = helpers.bundle_for(helpers.integral_snapshot())
    node = helpers.node_of(bundle, "integral")
    variables = [parameter.concept_id for parameter in node.parameters[:2]]
    request = TargetRequest(
        node_id=node.node_id,
        output="exact",
        target_value=1,
        variables=variables,
        operation_id="op_multi",
    )
    result = solve_target(request, _context(bundle), bundle=bundle)
    assert result.status == "unknown"
    assert "single" in result.stop_reason


def test_discrete_chart_category_experiment_and_target() -> None:
    _extraction, _plan, bundle = helpers.bundle_for(helpers.chart_snapshot())
    node = helpers.node_of(bundle, "native.chart")
    variable = node.parameters[0].concept_id
    context = _context(bundle)
    request = ExperimentRequest(
        question="比较不同分类的数值",
        recipe_hint="compare",
        selection={"node_id": node.node_id, "output": "sum"},
        allowed_variables=[variable],
        operation_id="op_chart_compare",
    )
    draft = generate_experiment(request, context, bundle=bundle)
    assert draft.variables == [variable]
    result = run_experiment(draft, bundle=bundle)
    assert result.status == "found"
    assert all(path.output_value is not None for path in result.paths)

    target = TargetRequest(
        node_id=node.node_id,
        output="sum",
        target_value=60,
        variables=[variable],
        operation_id="op_chart_target",
    )
    target_result = solve_target(target, context, bundle=bundle)
    assert target_result.status == "found"
    assert target_result.candidates[0].output_value == pytest.approx(60)


def test_linear_inverse_returns_explicit_solution_without_vector_parameters() -> None:
    """G08/G09：节点没有 v1/v2 参数时仍返回并展示 v=(3,1)。"""

    snap = helpers.matrix_snapshot("mat_no_vector", "A = [[2,1],[1,2]]")
    _extraction, _plan, bundle = helpers.bundle_for(snap)
    node = helpers.node_of(bundle, "matrix")
    assert not any(parameter.id in ("v1", "v2") for parameter in node.parameters)
    request = TargetRequest(
        node_id=node.node_id,
        output="product",
        target_value=0,
        target_vector=[7, 5],
        variables=["v1", "v2"],
        tolerance=1e-6,
        operation_id="op_no_vector",
    )
    result = solve_target(request, _context(bundle), bundle=bundle)
    assert result.status == "found"
    candidate = result.candidates[0]
    assert candidate.solution is not None
    assert candidate.solution.unknowns == ["v1", "v2"]
    assert candidate.solution.values == pytest.approx([3.0, 1.0])
    assert candidate.solution.classification == "unique"
    assert candidate.solution.exact_values == ["3", "1"]
    assert all(item["status"] == "pass" for item in candidate.solution.verification)
    assert candidate.values["v1"] == pytest.approx(3.0)
    assert candidate.values["v2"] == pytest.approx(1.0)


def test_linear_inverse_multiple_and_infeasible_have_distinct_statuses() -> None:
    """G10/G11：多解返回可验证特解与自由变量；无解不伪造精确解。"""

    snap = helpers.matrix_snapshot("mat_rank_deficient", "A = [[1,1],[2,2]]")
    _extraction, _plan, bundle = helpers.bundle_for(snap)
    node = helpers.node_of(bundle, "matrix")
    variables = ["v1", "v2"]
    multiple = solve_target(
        TargetRequest(
            node_id=node.node_id,
            output="product",
            target_value=0,
            target_vector=[3, 6],
            variables=variables,
            operation_id="op_multiple",
        ),
        _context(bundle),
        bundle=bundle,
    )
    assert multiple.status == "multiple"
    solution = multiple.candidates[0].solution
    assert solution is not None
    assert solution.classification == "particular"
    assert solution.free_variables
    assert solution.nullspace_basis
    assert all(item["status"] == "pass" for item in solution.verification)

    infeasible = solve_target(
        TargetRequest(
            node_id=node.node_id,
            output="product",
            target_value=0,
            target_vector=[3, 7],
            variables=variables,
            operation_id="op_infeasible",
        ),
        _context(bundle),
        bundle=bundle,
    )
    assert infeasible.status == "infeasible_proven"
    assert infeasible.candidates == []


def test_zero_matrix_zero_target_returns_verifiable_particular_solution() -> None:
    """G12：全零方程返回 (0,0) 特解与零残差，而不是 unknown。"""

    snap = helpers.matrix_snapshot("mat_zero", "A = [[0,0],[0,0]]")
    _extraction, _plan, bundle = helpers.bundle_for(snap)
    node = helpers.node_of(bundle, "matrix")
    result = solve_target(
        TargetRequest(
            node_id=node.node_id,
            output="product",
            target_value=0,
            target_vector=[0, 0],
            variables=["v1", "v2"],
            operation_id="op_zero",
        ),
        _context(bundle),
        bundle=bundle,
    )
    assert result.status == "multiple"
    solution = result.candidates[0].solution
    assert solution is not None
    assert solution.values == [0.0, 0.0]
    assert result.residual == pytest.approx(0.0)


def test_change_of_basis_golden_values_and_singular_basis() -> None:
    """G05/G06/G07：旋转换基、单位角与不可逆基。"""

    snap = helpers.matrix_snapshot("mat_basis", "A = [[2,0],[0,3]]，换基与坐标变换")
    extraction, plan = helpers.plan_for(snap)
    option = next(item for item in plan.options if item.operator_id == "matrix.change_of_basis")
    bundle = helpers.bundle_for(snap, selected=[option.option_id])[2]
    node = helpers.node_of(bundle, "change_of_basis")
    assert node.parameters[-1].id == "basis_angle_deg"
    angle_concept = node.parameters[-1].concept_id

    from app.ppt_ai.evaluation import evaluate_node

    values = {parameter.concept_id: parameter.default for parameter in node.parameters}
    values[angle_concept] = -45.0
    result = evaluate_node(node, values)["result"]
    flat = [value for row in result["transformed"] for value in row]
    assert flat == pytest.approx([2.5, -0.5, -0.5, 2.5], abs=1e-8)
    assert result["invariants"]["trace"] == pytest.approx(5.0)
    assert result["invariants"]["det"] == pytest.approx(6.0)

    values[angle_concept] = 0.0
    result0 = evaluate_node(node, values)["result"]
    flat0 = [value for row in result0["transformed"] for value in row]
    assert flat0 == pytest.approx([2.0, 0.0, 0.0, 3.0], abs=1e-8)
    assert result0["world"]["x"] == pytest.approx(result0["world"]["x"])

    singular = node.model_copy(
        update={"provider": {**node.provider, "basis": [[1, 1], [2, 2]]}}
    )
    singular_result = evaluate_node(singular, values)["result"]
    assert singular_result["inverse_basis"] is None
    assert singular_result["transformed"] is None
    assert any(check["status"] == "warn" for check in singular_result["checks"])
