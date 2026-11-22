"""第三批：引导模式 SymPy 中间步骤纠错 + ink2latex 笔迹序列通道测试。"""
from app.labs import ink
from app.labs.assistant import check_attempt
from app.labs.step_checker import diagnose_intermediate_step


def test_step_checker_diagnoses_algebraic_equality_and_errors():
    problem = {"subject": "calculus", "model": {"kind": "limit", "variable": "x", "expression": "(x^2-1)/(x-1)"}, "solution": {}}

    ok = diagnose_intermediate_step(problem, {}, "(x^2-1)/(x-1) = x+1")
    assert ok["correct"] is True
    assert "等价" in ok["feedback"]

    sign_err = diagnose_intermediate_step(problem, {}, "-(x+1) = x+1")
    assert sign_err["correct"] is False
    assert "正负号" in sign_err["feedback"]

    factor_err = diagnose_intermediate_step(problem, {}, "2*(x+1) = x+1")
    assert factor_err["correct"] is False
    assert "常数倍" in factor_err["feedback"]


def test_step_checker_diagnoses_integral_and_derivative_steps_via_check_attempt():
    integral_problem = {
        "subject": "calculus",
        "model": {"kind": "integral", "variable": "x", "expression": "x^2"},
        "solution": {"exact": "8/3", "answer": "8/3"},
    }
    good_anti = check_attempt(integral_problem, {}, answer="x^3/3", kind="step")
    assert good_anti["correct"] is True
    assert "原函数" in good_anti["feedback"]

    missing_factor = check_attempt(integral_problem, {}, answer="x^3", kind="step")
    assert missing_factor["correct"] is False
    assert "常数倍" in missing_factor["feedback"]

    deriv_problem = {
        "subject": "calculus",
        "model": {"kind": "derivative", "variable": "x", "expression": "sin(2*x)"},
        "solution": {},
    }
    good_deriv = check_attempt(deriv_problem, {}, answer="2*cos(2*x)", kind="step")
    assert good_deriv["correct"] is True

    forgot_chain = check_attempt(deriv_problem, {}, answer="cos(2*x)", kind="step")
    assert forgot_chain["correct"] is False
    assert "常数倍" in forgot_chain["feedback"]


def test_ink_stroke_normalization_and_ink2latex_dispatch(monkeypatch):
    strokes = [
        {"points": [[10, 10], [20, 20], [30, 30], [40, 40]], "width": 2.4},
        {"points": [[40, 10], [30, 20], [20, 30], [10, 40]], "width": 2.4},
    ]
    norm = ink.normalize_stroke_sequence(strokes)
    assert len(norm) == 2
    assert norm[0][0] == (0.0, 0.0)
    assert norm[0][-1] == (1.0, 1.0)

    monkeypatch.setattr(ink, "_ink2latex_recognize", lambda _s: r"x^2 + 1")
    result = ink.ink_to_formula(strokes)
    assert result["supported"] is True
    assert result["recognition_method"] == "ink2latex"
    assert result["node_type"] == "functionSource"

    # ink2latex 不可用时无缝回退到栅格 OCR
    monkeypatch.setattr(ink, "_ink2latex_recognize", lambda _s: None)
    monkeypatch.setattr(ink, "_math_ocr", lambda _img, loose=False: r"\sin(x)")
    fallback = ink.ink_to_formula(strokes)
    assert fallback["supported"] is True
    assert fallback["recognition_method"] == "raster_ocr"
    assert fallback["expression"] == "sin(x)"
