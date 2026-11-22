"""Math-Verify 适配层及判分/对账集成测试。"""
from app.labs.ai_solve import _compare_reference, _matches
from app.labs.assistant import check_attempt
from app.labs.math_verify_adapter import is_available, verify_math_equivalence


def test_math_verify_is_available():
    assert is_available() is True


def test_math_verify_equivalence_cases():
    assert verify_math_equivalence(r"\frac{\sqrt{2}}{2}", "1/sqrt(2)") is True
    assert verify_math_equivalence(r"\frac{\pi}{4}", "pi/4") is True
    assert verify_math_equivalence(r"\ln 2", "log(2)") is True
    assert verify_math_equivalence("[0, 1]", "[0, 1]") is True
    assert verify_math_equivalence(r"\{1, -1\}", r"\{-1, 1\}") is True
    assert verify_math_equivalence("x >= 1", "1 <= x") is True
    assert verify_math_equivalence("x^2 - 1", "(x-1)(x+1)") is True


def test_math_verify_rejects_non_equivalent_answers():
    assert verify_math_equivalence("1/2", "1/3") is False
    assert verify_math_equivalence("sin(x)", "cos(x)") is False
    assert verify_math_equivalence("pi/4", "pi/3") is False


def test_ai_solve_matches_and_compare_reference_support_latex():
    expected = {"kind": "values", "values": ["pi/4"], "variables": []}
    assert _matches(expected, r"\frac{\pi}{4}") is True
    assert _compare_reference(expected, r"$\frac{\pi}{4}$") is True
    assert _compare_reference(expected, r"$\frac{\pi}{3}$") is False


def test_assistant_check_attempt_accepts_equivalent_latex():
    problem = {
        "subject": "calculus",
        "model": {"kind": "integral", "expression": "1/(1+x^2)", "defaults": {"lower": 0, "upper": 1}},
        "solution": {
            "answer": "pi/4",
            "exact": "pi/4",
            "answer_value": 0.7853981634,
            "solution_complete": True,
        },
    }
    checked = check_attempt(problem, {}, answer=r"\frac{\pi}{4}")
    assert checked["correct"] is True
    assert "等价" in checked["feedback"]

    wrong = check_attempt(problem, {}, answer=r"\frac{\pi}{3}")
    assert wrong["correct"] is False
