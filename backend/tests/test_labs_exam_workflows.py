"""End-to-end compiler/solver/attempt contracts for the audited original tasks."""
import math
import pytest
from app.labs.extract import text_source
from app.labs.recognize import build_lab_document
from app.labs.recognize import rebuild_problem
from app.labs.solvers import evaluate_problem
from app.labs.assistant import check_attempt, ask


def make(text):
    source = text_source(text, lab_id='exam_workflow')
    document = build_lab_document(lab_id='exam_workflow', title='test', source=source,
                                 files=source['files'], now_iso='2026-11-09T00:00:00Z')
    return document['problems'][0]


def test_original_region_checks_both_subquestions_and_rejects_partial_answer():
    p = make('已知 D={(x,y)|0<=y<=1/(x*sqrt(1+x^2)), x>=1}。求面积和绕 x 轴旋转所成旋转体的体积。')
    assert p['status'] == 'ready'
    assert p['model']['task'] == 'area_volume'
    ev = evaluate_problem(p['model'], p['model']['defaults'])
    assert check_attempt(p, ev, answer='ln(1+sqrt(2)), pi*(1-pi/4)', field='quantities')['correct']
    assert not check_attempt(p, ev, answer='ln(1+sqrt(2))', field='quantities')['correct']


def test_normal_and_geometric_area_attempts_accept_exact_expressions():
    for text, expected, answer in [
        ('曲线 3*x^3=y^5+2*y^3 在 x=1 对应点处的法线斜率为多少？', -11/9, '-11/9'),
        ('曲线 y=-x^3+x^2+2x 与 x 轴围成图形的面积。', 37/12, '37/12'),
    ]:
        p = make(text)
        assert p['status'] == 'ready'
        assert p['solution']['answer_value'] == pytest.approx(expected)
        ev = evaluate_problem(p['model'], p['model']['defaults'])
        assert check_attempt(p, ev, answer=answer)['correct']


def test_heap_choices_and_numeric_sequences_do_not_use_bfs_rules():
    p = make('关键字序列28,22,20,19,8,12,15,5是大根堆，对该堆进行两次删除。\nA.20,19,15,12,8,5\nB.20,19,15,5,8,12')
    assert p['status'] == 'ready'
    ev = evaluate_problem(p['model'], p['model']['defaults'])
    assert check_attempt(p, ev, answer='B', field='heap')['correct']
    assert check_attempt(p, ev, answer='20,19,15,5,8,12', field='heap')['correct']
    assert not check_attempt(p, ev, answer='A', field='heap')['correct']
    explanation = ask(p, ev, question='为什么需要向下筛选？', mode='explore', step=1)['answer']
    assert '堆' in explanation
    assert 'BFS' not in explanation


def test_extremum_single_point_check_is_explicitly_local_and_rejects_saddle():
    p = make('求函数 f(x,y)=x*exp(cos(y))+x^2/2 的极值。')
    assert p['solution']['stationary_complete']
    ev = evaluate_problem(p['model'], p['model']['defaults'])
    good = check_attempt(p, ev, answer='-e, 0', field='stationary_minimum')
    assert good['correct']
    assert '极小' in good['feedback']
    assert not check_attempt(p, ev, answer='-1/e, pi', field='stationary_minimum')['correct']


def test_invalid_geometry_and_implicit_branches_remain_reviewable():
    for text in ['D={(x,y)|0<=y<=1/x,x>=1}，求面积。',
                 '曲线 x^2+y^2=1 在 x=0 处的法线斜率。']:
        p = make(text)
        assert p['status'] == 'needs_review'
        assert not p['solution']['answer']


def test_rotation_about_y_axis_is_supported():
    p = make('D={(x,y)|0<=y<=x,x>=1,x<=2}，求绕 y 轴旋转的体积。')
    assert p['status'] == 'ready'
    assert p['solution']['exact'] == '14*pi/3'


def test_unsupported_conditions_cannot_be_dismissed_as_confirmation():
    p = make('D={(x,y)|0<=y<=x,x>=1,x<=2}，求绕 x=1 旋转的体积。')
    assert p['status'] == 'needs_review'
    rebuilt = rebuild_problem(p, files=[], ambiguity_answers={'exam_rotation_axis': 'y'})
    assert rebuilt['status'] == 'needs_review'
    assert not rebuilt['solution']['answer']


def test_box_constrained_minimum_compares_feasible_boundary_candidates():
    p = make('求函数 f(x,y)=x^2+y^2，1<=x<=2，1<=y<=2，求最小值。')
    assert p['status'] == 'ready'
    assert p['solution']['answer_point'] == [1, 1]
    assert p['solution']['answer_value'] == 2


def test_parameterized_box_stationary_family_cannot_be_silently_skipped():
    p = make('求函数 f(x,y)=(x^2+y^2-1)^2，-2<=x<=2，-2<=y<=2，求最小值。')
    assert p['status'] == 'needs_review'
    assert not p['solution']['answer']
