import pytest
from PIL import Image

from app.labs import extract
from app.labs.ai_solve import compute_plan
from app.labs.recognize import _attach_solution, build_problem, rebuild_problem

OCR_TEXT = "(1+ ax²)s sinx -1\n11. 若lim =6, 则α=\n：0"
MATH_TEXT = (
    r"11\cdot{\begin{array}{l}{{\frac{1+1}{4!}}\displaystyle\int_{x\to0}"
    r"{\frac{(1+a x^{2})^{\sin x}-1}{x^{3}}}=6\,,\ \ \ )\backslash||"
    r"\,a={\frac{\qquad}{\qquad}}\end{array}}"
)
MERGED_TEXT = "11. lim_{x→0}((1+a x^2)^ sin x-1)/(x^3)=6\n若lim =6, 则α="

def plan(target=6):
    return {'kind':'kernel','task':'parameter_limit','conditions':{
        'expression':'((1+a*x^2)^sin(x)-1)/x^3','variable':'x','point':0,'parameter':'a','target_value':target}}

def test_parameter_limit_is_solved_and_substituted_not_copied_from_target():
    for target in (6, 3):
        result=compute_plan(plan(target))
        assert result['exact']==str(target)
        assert result['answer']==f'a={target}'
        assert result['expected']['kind']=='values'
        assert result['interactive_model']['parameter_value']==str(target)

def test_parameter_limit_solves_a_nonidentity_equation():
    p=plan(6)
    p['conditions']['expression']='((1+2*a*x^2)^sin(x)-1)/x^3'
    assert compute_plan(p)['exact']=='3'

def test_parameter_limit_rejects_disagreeing_sides():
    p=plan(6)
    p['conditions']['expression']='a*x/abs(x)'
    with pytest.raises(ValueError): compute_plan(p)


def test_math_ocr_repairs_lim_operator_and_layout_noise():
    cleaned = extract._repair_math_formula(MATH_TEXT, OCR_TEXT)

    assert cleaned.startswith(r"\lim_{x\to0}")
    assert cleaned.endswith("=6")
    display = extract._latex_display(cleaned)
    assert "lim_{x→0}" in display
    assert "(1+a x^2)" in display
    assert display.endswith("=6")


def test_limit_screenshot_becomes_reviewable_parameter_limit_lab(tmp_path, monkeypatch):
    buffer = tmp_path / "limit.png"
    Image.new("RGB", (582, 71), "white").save(buffer)
    monkeypatch.setattr(extract, "_ocr", lambda image: (OCR_TEXT, 0.9))
    monkeypatch.setattr(extract, "_math_ocr", lambda image: MATH_TEXT)

    pages, method = extract._image_pages(buffer.read_bytes(), "f1", tmp_path)

    page = pages[0]
    assert page["text"] == MERGED_TEXT
    assert page["method"] == "image_ocr+math_ocr" == method
    assert page["requires_formula_confirmation"] is True
    problem = build_problem(page["text"], pages=pages)
    assert problem["subject"] == "calculus"
    assert problem["title"] == "已知极限求参数"
    assert problem["model"]["modeling_task"] == "parameter_limit"
    assert problem["model"]["parameter"] == "a"
    assert problem["model"]["parameter_value"] == "6"
    assert [item["id"] for item in problem["recognition"]["conditions"]][-2:] == [
        "parameter", "target_value",
    ]
    _attach_solution(problem)
    assert problem["status"] == "needs_review"
    assert problem["solution"]["answer"] == ""

    reviewed = rebuild_problem(
        problem, files=[], ambiguity_answers={"source_formula_confirmation": "confirmed"},
    )
    assert reviewed["status"] == "ready"
    assert reviewed["solution"]["answer"] == "a=6"
    assert reviewed["solution"]["answer_value"] == 6
    assert [step["id"] for step in reviewed["solution"]["steps"]] == [
        "symbolic-limit", "solve-parameter", "verify-parameter",
    ]


def test_plain_limit_stays_a_limit_instead_of_parameter_solving():
    problem = build_problem("求 lim_{x→0} sin(x)/x")
    _attach_solution(problem)

    assert problem["model"].get("modeling_task") is None
    assert problem["solution"]["answer"].startswith("极限为 1")


def test_derivative_request_is_not_mistaken_for_a_parameter_limit():
    problem = build_problem("已知 lim_{x→0} f(x)/x = 2，求 f'(0)。")

    assert problem["model"].get("modeling_task") is None
    assert problem["status"] == "needs_review"
