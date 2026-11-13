"""P1 regressions: limits, Taylor, high-order derivatives and function study."""
from __future__ import annotations

import pytest

from app.labs.ai_solve import compute_plan
from app.labs.extract import text_source
from app.labs.recognize import build_lab_document
from app.labs.assistant import check_attempt
from app.labs.solvers import evaluate_problem, solve_problem


def plan(task: str, **conditions):
    return compute_plan({"kind": "kernel", "task": task, "conditions": conditions})


def study_model(text: str) -> dict:
    source = text_source(text, lab_id="p1")
    document = build_lab_document(
        lab_id="p1", title="test", source=source, files=source["files"],
        now_iso="2026-11-12T00:00:00Z",
    )
    return document["problems"][0]


def test_two_sided_limit_and_one_sided_difference():
    result = plan("limit", expression="sin(x)/x", variable="x", point=0)
    solution = result["interactive_solution"]
    assert solution["solution_status"] == "complete"
    assert solution["answer_value"] == pytest.approx(1.0)
    assert "1" in result["answer"]

    jump = plan("limit", expression="abs(x)/x", variable="x", point=0)
    assert jump["interactive_solution"]["limit_status"] == "does_not_exist"
    assert jump["interactive_solution"]["answer_value"] is None
    assert "不存在" in jump["answer"]

    left = plan("limit", expression="abs(x)/x", variable="x", point=0, side="left")
    assert left["interactive_solution"]["answer_value"] == pytest.approx(-1.0)


def test_infinite_limit_is_not_reported_as_existing_finite_limit():
    result = plan("limit", expression="1/x", variable="x", point=0)
    solution = result["interactive_solution"]
    assert solution["limit_status"] == "does_not_exist"
    assert solution["answer_value"] is None
    assert "+∞" in result["answer"] and "-∞" in result["answer"]

    one_side = plan("limit", expression="1/x", variable="x", point=0, side="left")
    assert one_side["interactive_solution"]["answer_value"] is None
    assert "-∞" in one_side["answer"]

    infinite_point = plan("limit", expression="x^2", variable="x", point="-oo")
    assert "发散到 +∞" in infinite_point["answer"]


def test_oscillating_limit_is_marked_nonexistent():
    result = plan("limit", expression="sin(1/x)", variable="x", point=0)
    assert result["interactive_solution"]["limit_status"] == "does_not_exist"
    assert "振荡" in result["answer"]


def test_limit_respects_one_sided_real_domain():
    result = plan("limit", expression="log(x)", variable="x", point=0)
    assert result["interactive_solution"]["limit_status"] == "does_not_exist"
    assert "实定义域" in result["answer"]
    right = plan("limit", expression="log(x)", variable="x", point=0, side="right")
    assert right["interactive_solution"]["limit_status"] == "infinite"
    assert "-∞" in right["answer"]


def test_limit_interactive_side_switch_recomputes_one_sided_value():
    model = plan("limit", expression="abs(x)/x", variable="x", point=0)["interactive_model"]
    left = evaluate_problem(model, {"side": "left"})
    right = evaluate_problem(model, {"side": "right"})
    assert left["limit"]["value"]["value"] == pytest.approx(-1.0)
    assert right["limit"]["value"]["value"] == pytest.approx(1.0)


def test_taylor_expansion_and_coefficients():
    result = plan("taylor", expression="exp(x)", variable="x", point=0, order=3)
    solution = result["interactive_solution"]
    assert solution["solution_status"] == "complete"
    assert "x^3/6" in result["answer"]
    assert solution["remainder_order"] == 4
    assert [item["value"] for item in solution["coefficients"]] == ["1", "1", "1/2", "1/6"]

    shifted = plan("taylor", expression="log(x)", variable="x", point=1, order=2)
    assert shifted["interactive_solution"]["solution_status"] == "complete"
    assert "x=1" in shifted["answer"]
    assert shifted["interactive_solution"]["coefficients"][0]["value"] == "0"


def test_taylor_rejects_singular_expansion_point():
    with pytest.raises(ValueError):
        plan("taylor", expression="log(x)", variable="x", point=0, order=3)
    with pytest.raises(ValueError):
        plan("taylor", expression="abs(x)", variable="x", point=0, order=1)
    with pytest.raises(ValueError):
        plan("taylor", expression="exp(x)", variable="x", point=0, order=0)


def test_higher_order_derivative_expression_and_value():
    result = plan("higher_derivative", expression="x^4", variable="x", order=2, point=1)
    solution = result["interactive_solution"]
    assert solution["solution_status"] == "complete"
    assert "12*x^2" in result["answer"]
    assert solution["answer_value"] == pytest.approx(12.0)

    fourth = plan("higher_derivative", expression="sin(x)", variable="x", order=4)
    assert "sin(x)" in fourth["answer"]


def test_distribution_high_order_derivative_is_not_passed():
    with pytest.raises(ValueError):
        plan("higher_derivative", expression="abs(x)", variable="x", order=2)
    with pytest.raises(ValueError):
        plan("higher_derivative", expression="abs(x)", variable="x", order=1, point=0)
    with pytest.raises(ValueError):
        plan("higher_derivative", expression="x^2", variable="x", order=0)


def test_function_study_monotonicity_extrema_and_inflection():
    result = plan("function_study", expression="x^3-3*x", variable="x")
    solution = result["interactive_solution"]
    assert solution["solution_status"] == "complete"
    study = solution["study"]
    assert {(item["kind"], item["interval"]) for item in study["monotonic"]} == {
        ("increasing", "(-∞, -1)"),
        ("decreasing", "(-1, 1)"),
        ("increasing", "(1, +∞)"),
    }
    assert {(item["point"], item["classification"]) for item in study["extrema"]} == {
        ("-1", "maximum"), ("1", "minimum"),
    }
    assert study["inflections"] == [{"point": "0", "value": "0"}]
    assert "拐点：(0, 0)" in result["answer"]


def test_function_study_asymptotes_for_rational_function():
    result = plan("function_study", expression="(x^2+1)/x", variable="x")
    study = result["interactive_solution"]["study"]
    assert study["asymptotes"]["vertical"] == ["x=0"]
    assert any(item.startswith("y=1*x") for item in study["asymptotes"]["oblique"])


def test_function_study_horizontal_asymptote_and_finite_interval():
    horizontal = plan("function_study", expression="exp(-x^2)", variable="x")
    assert horizontal["interactive_solution"]["study"]["asymptotes"]["horizontal"] == ["y=0"]

    bounded = plan("function_study", expression="sin(x)", variable="x", lower=0, upper=3.14)
    study = bounded["interactive_solution"]["study"]
    assert len(study["monotonic"]) == 2
    assert study["extrema"]


def test_linear_function_study_is_complete_and_has_no_false_asymptote():
    result = plan("function_study", expression="x", variable="x")
    study = result["interactive_solution"]["study"]
    assert result["interactive_solution"]["solution_status"] == "complete"
    assert study["monotonic"] == [
        {"kind": "increasing", "label": "单调递增", "interval": "(-∞, +∞)", "from": None, "to": None}
    ]
    assert study["asymptotes"]["horizontal"] == []
    assert study["asymptotes"]["oblique"] == []


def test_periodic_family_without_interval_is_not_passed():
    with pytest.raises(ValueError):
        plan("function_study", expression="tan(x)", variable="x")


def test_function_study_with_vertical_asymptote_on_finite_interval():
    result = plan("function_study", expression="tan(x)", variable="x", lower=0, upper=2)
    study = result["interactive_solution"]["study"]
    assert study["asymptotes"]["vertical"] == ["x=pi/2"]


@pytest.mark.parametrize("task,conditions", [
    ("limit", {"expression": "x", "variable": "x", "point": 0, "side": "around"}),
    ("function_study", {"expression": "x^2", "variable": "x", "lower": 0}),
    ("function_study", {"expression": "x^2", "variable": "x", "lower": 2, "upper": 1}),
])
def test_invalid_p1_conditions_are_rejected(task, conditions):
    with pytest.raises(ValueError):
        plan(task, **conditions)


def test_local_text_recognition_routes_p1_tasks():
    cases = {
        "求极限 lim_{x→0} (1-cos(x))/x^2。": "limit",
        "求 f(x)=e^x 在 x=0 处的三阶泰勒展开。": "taylor",
        "求 f(x)=x^4 的二阶导数，在 x=1 处的值。": "higher_derivative",
        "讨论 f(x)=x^3-3x 的单调区间、凹凸区间、拐点和渐近线。": "function_study",
    }
    for text, expected in cases.items():
        problem = study_model(text)
        assert problem["model"]["task"] == expected
        assert problem["status"] == "ready"
        assert problem["solution"]["answer"]


def test_p1_attempt_grading_uses_symbolic_meaning():
    limit_plan = plan("limit", expression="1/x", variable="x", point=0)
    limit_problem = {"subject": "calculus", "model": limit_plan["interactive_model"],
                     "solution": limit_plan["interactive_solution"]}
    assert check_attempt(limit_problem, {}, answer="不存在")["correct"]

    taylor_plan = plan("taylor", expression="exp(x)", variable="x", point=0, order=3)
    taylor_problem = {"subject": "calculus", "model": taylor_plan["interactive_model"],
                      "solution": taylor_plan["interactive_solution"]}
    grading = check_attempt(taylor_problem, {}, answer="P_3(x)=1+x+x^2/2+x^3/6")
    assert grading["correct"]

    higher_plan = plan("higher_derivative", expression="x^4", variable="x", order=2, point=1)
    higher_problem = {"subject": "calculus", "model": higher_plan["interactive_model"],
                      "solution": higher_plan["interactive_solution"]}
    assert check_attempt(higher_problem, {}, answer="12")["correct"]
