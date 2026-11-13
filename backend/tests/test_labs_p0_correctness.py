"""P0 regressions: singular integrals, extrema semantics and result status."""
from __future__ import annotations

import pytest

from app.labs.ai_solve import compute_plan
from app.labs.assistant import check_attempt
from app.labs.domain_analysis import analyze_integral
from app.labs.solvers import SolveError, evaluate_problem, solve_problem
import sympy as sp


def integral_model(expression: str, lower: float, upper: float) -> dict:
    return {
        "engine": "sympy",
        "subject": "calculus",
        "task": "integral",
        "kind": "integral",
        "variable": "x",
        "expression": expression,
        "defaults": {"lower": lower, "upper": upper},
        "params": [],
        "teaching": False,
    }


def optimization_model(expression: str, variables: list[str], bounds: dict, *, goal: str = "extrema") -> dict:
    defaults = {"learning_rate": 0.1, "iterations": 30}
    defaults.update({f"{name}0": 0 for name in variables})
    return {
        "engine": "gradient_descent_v1",
        "subject": "optimization",
        "variables": variables,
        "expression": expression,
        "goal": goal,
        "bounds": bounds,
        "defaults": defaults,
        "domain": {f"{name}_{edge}": value for name in variables for edge, value in (("min", -6), ("max", 6))},
        "params": [],
        "teaching": False,
    }


@pytest.mark.parametrize("expression", ["1/x^2", "1/x"])
def test_interior_pole_never_returns_antiderivative_endpoint_difference(expression):
    solution = solve_problem(integral_model(expression, -1, 1))
    assert solution["solution_status"] == "divergent"
    assert solution["solution_complete"] is False
    assert solution["convergence"] == "divergent"
    assert solution["answer_value"] is None
    assert "发散" in solution["answer"]
    assert solution["answer"] != "-2"
    with pytest.raises(ValueError):
        compute_plan({
            "kind": "kernel", "task": "integral",
            "conditions": {"expression": expression, "variable": "x", "lower": -1, "upper": 1},
        })


def test_interactive_interval_across_pole_is_not_labelled_exact():
    model = integral_model("1/x^2", -1, 1)
    result = evaluate_problem(model, {"lower": -1, "upper": 1, "n": 8})
    assert result["exact"] is None
    assert result["answer"] is None
    assert result["convergence"] == "divergent"
    checks = {item["id"]: item for item in result["checks"]}
    assert checks["domain"]["status"] == "fail"


def test_integrable_endpoint_singularity_keeps_finite_value():
    solution = solve_problem(integral_model("1/sqrt(x)", 0, 1))
    assert solution["convergence"] == "finite"
    assert solution["answer_value"] == pytest.approx(2.0)


def test_real_domain_gap_is_not_claimed_as_negative_area():
    with pytest.raises(SolveError):
        solve_problem(integral_model("log(x)", -1, 1))
    assert analyze_integral(sp.log(sp.Symbol("x", real=True)), sp.Symbol("x", real=True),
                            sp.Integer(-1), sp.Integer(1))["status"] == "undefined"


def test_reversed_interval_is_analyzed_in_increasing_order():
    assert solve_problem(integral_model("exp(1/x)", 1, -1))["convergence"] == "divergent"
    reversed_square = solve_problem(integral_model("x^2", 2, 0))
    assert reversed_square["convergence"] == "finite"
    assert reversed_square["answer_value"] == pytest.approx(-8 / 3)


def test_sympy_segment_sign_bug_is_caught_by_independent_numeric_check():
    solution = solve_problem(integral_model("sin(x)/x", -1, 1))
    assert solution["convergence"] == "finite"
    assert solution["answer_value"] == pytest.approx(1.892166140734366, rel=1e-9)
    assert any("数值复核" in item for item in solution["limitations"])


def test_one_dimensional_extremum_is_classified_locally_and_globally():
    solution = solve_problem(optimization_model("-x^2", ["x"], {}))
    assert solution["solution_status"] == "complete"
    assert solution["stationary_complete"] is True
    points = solution["stationary_points"]
    assert len(points) == 1 and points[0]["classification"] == "maximum"
    assert solution["global_minimum"]["exists"] is False
    assert solution["global_maximum"]["exists"] is True
    assert "无全局最小值" in solution["answer"]
    assert "极小值不存在" not in solution["answer"]
    assert "x*=" not in solution["answer"]


def test_quartic_minimum_reports_no_global_maximum():
    solution = solve_problem(optimization_model("x^2", ["x"], {}))
    assert solution["global_minimum"]["exists"] is True
    assert solution["global_maximum"]["exists"] is False
    assert "无全局最大值" in solution["answer"]


def test_box_extrema_list_every_tied_optimum_and_compare_endpoints():
    solution = solve_problem(optimization_model("-x^2", ["x"], {"x": [-1, 1]}))
    assert solution["solution_status"] == "complete"
    minimum = solution["global_minimum"]
    assert minimum["exists"] is True and minimum["value"] == "-1"
    assert {tuple(item) for item in minimum["points"]} == {("-1",), ("1",)}
    maximum = solution["global_maximum"]
    assert maximum["exists"] is True and maximum["value"] == "0"
    assert maximum["points"] == [["0"]]


def test_derivative_singular_cusp_is_classified_without_false_completeness():
    solution = solve_problem(optimization_model("abs(x)", ["x"], {}))
    assert solution["solution_status"] == "complete"
    point = solution["stationary_points"][0]
    assert point["classification"] == "minimum"


def test_incomplete_two_variable_stationary_set_blocks_passing():
    model = optimization_model("sin(x)*cos(y)", ["x", "y"], {})
    solution = solve_problem(model)
    assert solution["stationary_complete"] is False
    assert solution["solution_status"] == "incomplete"
    assert solution["solution_complete"] is False
    evaluation = evaluate_problem(model, model["defaults"])
    assert any(item["id"] == "completeness" and item["status"] == "fail" for item in evaluation["checks"])
    with pytest.raises(ValueError):
        compute_plan({
            "kind": "kernel", "task": "optimization",
            "conditions": {"expression": "sin(x)*cos(y)", "variables": ["x", "y"],
                           "goal": "extrema", "bounds": {}},
        })


def test_shared_exponential_extremum_is_now_triangulated_completely():
    solution = solve_problem(optimization_model("(2*x^2-y^2)*exp(x)", ["x", "y"], {}))
    assert solution["stationary_complete"] is True
    assert solution["solution_status"] == "complete"
    classifications = {point["classification"] for point in solution["stationary_points"]}
    assert {"maximum", "saddle"} <= classifications


def test_complete_two_variable_classification_still_passes():
    solution = solve_problem(optimization_model("x^3+8*y^3-x*y", ["x", "y"], {}))
    assert solution["stationary_complete"] is True
    assert solution["solution_status"] == "complete"
    classifications = {point["classification"] for point in solution["stationary_points"]}
    assert {"minimum", "saddle"} <= classifications


def test_box_gradient_descent_projects_infeasible_initial_point_before_stopping():
    model = optimization_model("x^2+y^2", ["x", "y"], {"x": [1, 2], "y": [1, 2]}, goal="gradient_descent")
    evaluation = evaluate_problem(model, model["defaults"])
    assert evaluation["trajectory"][0]["point"] == [1.0, 1.0]
    checks = {item["id"]: item for item in evaluation["checks"]}
    assert checks["constraints"]["status"] == "pass"


def test_unfinished_solution_is_not_auto_graded():
    problem = {
        "subject": "calculus",
        "model": {"kind": "integral"},
        "solution": {"answer": "发散（积分不存在）", "solution_status": "divergent", "solution_complete": False},
    }
    result = check_attempt(problem, {}, answer="-2")
    assert result["correct"] is False
    assert "不能自动判分" in result["feedback"]
