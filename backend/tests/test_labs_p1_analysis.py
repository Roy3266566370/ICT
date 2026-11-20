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

def test_ocr_trailing_answer_blank_is_not_part_of_limit_expression():
    """题尾 `（）` / `()` 是答题空，不能并进极限表达式。"""
    from app.labs.recognize import build_problem, _attach_solution
    p = build_problem('1.求极限lim(x→0) sinx/x（）。')
    assert p['model']['task'] == 'limit'
    _attach_solution(p)
    assert p['status'] == 'ready'
    assert p['solution']['answer'] == '极限为 1'

    p2 = build_problem('2. 求极限lim(x→0)(1-cosx)/x^2（）。')
    _attach_solution(p2)
    assert p2['status'] == 'ready'
    assert p2['solution']['answer'] == '极限为 1/2'

def test_ocr_parameter_limit_paren_form_fraction_target_and_juxtaposed_param():
    """`lim(x→0)` 括号式、目标值 `1/6` 分数、`ax` 连写参数都要被参数极限内核接住。"""
    from app.labs.recognize import build_problem, _attach_solution
    from app.labs.parameter_limit import _parse_limit, build_parameter_limit_from_text

    parsed = _parse_limit('已知lim(x→0)(x-sin(ax))/x^3=1/6，求参数a。')
    assert parsed is not None
    assert parsed[3] == pytest.approx(1/6)

    p = build_problem('6.已知lim(x→0)sin(ax)/x=2，求参数a。')
    _attach_solution(p)
    assert p['status'] == 'ready'
    assert p['solution']['answer'] == 'a=2'
    assert p['model'].get('modeling_task') == 'parameter_limit'


def test_round7_ocr_series_variants():
    # OCR 实测变体：全角）混配、ln→In 大写 I 误读、Σ 整吞
    from app.labs.recognize import build_problem, _attach_solution
    p = build_problem('18.（8分）判断级数1/(nInn）（n=2起）的敛散性。\n解：')
    model = p.get('model') or {}
    assert p.get('subject') == 'calculus', (p.get('subject'), model.get('engine'))
    assert model.get('engine') == 'series_v1' and model.get('task') == 'series_convergence'
    _attach_solution(p)
    assert '发散' in ((p.get('solution') or {}).get('answer') or '')

    p2 = build_problem('17.（6分）判断级数n/(n^2+1）的敛散性。\n解：')
    _attach_solution(p2)
    assert (p2.get('model') or {}).get('engine') == 'series_v1'
    assert '发散' in ((p2.get('solution') or {}).get('answer') or '')

    p3 = build_problem('16．（8分）判断级数E(-1)^n/(nInn）（n=2起）的敛散性，\n是绝对收敛还是条件收敛？\n解：')
    _attach_solution(p3)
    assert (p3.get('model') or {}).get('engine') == 'series_v1'
    assert '条件收敛' in ((p3.get('solution') or {}).get('answer') or '')

    p4 = build_problem('20．（10分）求幂级数x^n/(n+1）的和函数。\n解：')
    _attach_solution(p4)
    assert (p4.get('model') or {}).get('engine') == 'power_series_v1'
    assert 'ln' in ((p4.get('solution') or {}).get('answer') or '')


def test_round7_ocr_ode_box_glyph():
    # OCR 把三阶导 y''' 读成 y口
    from app.labs.recognize import build_problem, _attach_solution
    p = build_problem('25．（8分）求微分方程y口-y"=0的通解。\n解：')
    _attach_solution(p)
    assert (p.get('model') or {}).get('engine') == 'ode_v1'
    ans = (p.get('solution') or {}).get('answer') or ''
    assert 'C3' in ans and 'exp(x)' in ans


def test_round7_case_garbage_ln_exemption():
    from app.labs.source_recovery import assess_text_quality
    # nInn（ln 的 I 误读）可恢复，不应按大小写混杂判 untrusted
    quality = assess_text_quality('判断级数1/(nInn）（n=2起）的敛散性',
                                  pages=[{'image_key': 'k', 'page': 1, 'file_id': 'f'}])
    assert quality['untrusted'] is False or all('混杂' not in i for i in quality['issues'])


def test_round8_parametric_and_polar():
    from app.labs.recognize import build_problem, _attach_solution

    # 黏连三角 sint/cost + 符号点 t=π/2
    p = build_problem('设x=t-sint,y=1-cost，求t=π/2处dy/dx的值。')
    _attach_solution(p)
    assert (p.get('model') or {}).get('task') == 'parametric_derivative'
    assert '1' in ((p.get('solution') or {}).get('answer') or '')

    # d^2y/dx^2 二阶 + 数字点
    p2 = build_problem('设x=t^2,y=t^3，求d^2y/dx^2在t=1处的值。')
    _attach_solution(p2)
    assert '3/4' in ((p2.get('solution') or {}).get('answer') or '')

    # 缺研究点 → blocking，不落 tangent fallback
    p3 = build_problem('设x=a(t-sint),y=a(1-cost)，求dy/dx。')
    m3 = p3.get('model') or {}
    assert m3.get('task') == 'parametric_derivative' and m3.get('engine') == 'manual_v1'
    assert any(a.get('severity') == 'blocking' and 't=t0' in (a.get('question') or '')
               for a in (p3.get('recognition') or {}).get('ambiguities', []))

    # 心形线无显式界 → 约定 [0,2π]
    p4 = build_problem('求心形线r=1+cosθ所围图形的面积。')
    _attach_solution(p4)
    assert '3*pi/2' in ((p4.get('solution') or {}).get('answer') or '')

    # cos3θ 黏连 + 玫瑰线一瓣显式界
    p5 = build_problem('求三叶玫瑰线r=cos3θ一瓣(θ∈[-π/6,π/6])的面积。')
    _attach_solution(p5)
    assert 'pi/12' in ((p5.get('solution') or {}).get('answer') or '')


def test_round8_improper_paren_notation():
    from app.labs.recognize import build_problem, _attach_solution
    # ∫(a,∞) f dx 括号区间记法
    p = build_problem('计算反常积分∫(1,+∞) dx/x^2。')
    _attach_solution(p)
    assert (p.get('solution') or {}).get('answer') == '1'
    # ∫(a,b) dx/f 微分前置记法 → 被积函数 1/f
    p2 = build_problem('计算反常积分∫(0,1) dx/sqrt(1-x)。')
    _attach_solution(p2)
    assert (p2.get('solution') or {}).get('answer') == '2'


def test_round8_inverse_derivative_point_and_fallback():
    from app.labs.recognize import build_problem, _attach_solution
    # 反函数在 y=y0 处 → 定点反函数导数
    p = build_problem('设f(x)=x^3+x，求其反函数在y=2处的导数。')
    _attach_solution(p)
    assert (p.get('model') or {}).get('kind') == 'inverse_derivative'
    assert '0.25' in ((p.get('solution') or {}).get('answer') or '') or '1/4' in ((p.get('solution') or {}).get('answer') or '')
    # 无研究点 + "求导数" → 回退普通求导给通式，不静默发明 y0=0
    p2 = build_problem('利用反函数求导法则求y=arcsinx的导数。')
    _attach_solution(p2)
    m2 = p2.get('model') or {}
    assert m2.get('kind') == 'derivative'
    assert 'sqrt' in ((p2.get('solution') or {}).get('answer') or '') or 'asin' in ((p2.get('solution') or {}).get('answer') or '')


def test_round8_fourier_abs():
    from app.labs.recognize import build_problem, _attach_solution
    p = build_problem('将函数f(x)=|x|在[-π,π]上展开为傅里叶级数。')
    _attach_solution(p)
    assert (p.get('model') or {}).get('task') == 'fourier_series'
    assert 'pi' in ((p.get('solution') or {}).get('answer') or '')


def test_round8_ocr_brace_integral_and_theta_bounds():
    """OCR 实测变体：∫→{( 括号区间、θ∈→θE、π→T。"""
    from app.labs.recognize import build_problem, _attach_solution
    from app.labs.source_recovery import assess_text_quality

    # {(1,+∞） 不判括号失衡（{ 是 ∫ 的误读）
    quality = assess_text_quality('计算反常积分{(1,+∞）dx/x^2。',
                                  pages=[{'image_key': 'k', 'page': 1, 'file_id': 'f'}])
    assert all('括号' not in i for i in quality['issues'])

    p = build_problem('计算反常积分{(1,+∞）dx/x^2。')
    _attach_solution(p)
    assert (p.get('model') or {}).get('kind') == 'integral'
    assert (p.get('solution') or {}).get('answer') == '1'

    p2 = build_problem('计算反常积分{(0,1）dx/√(1-x)。')
    _attach_solution(p2)
    assert (p2.get('solution') or {}).get('answer') == '2'

    p3 = build_problem('求三叶玫瑰线r=cos3θ一瓣(θE[-T/6,π/6]）的面积')
    _attach_solution(p3)
    assert p3['model']['task'] == 'polar_area'
    assert p3['status'] == 'needs_review'
    assert not p3['solution']['answer']
    from app.labs.recognize import rebuild_problem
    corrected = rebuild_problem(p3, files=[], text=p3['text'].replace('-T/6', '-π/6'))
    assert corrected['status'] == 'ready'
    assert 'pi/12' in corrected['solution']['answer']
