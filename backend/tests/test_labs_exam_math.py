"""Regression coverage for exam geometry, implicit normals and stationary families."""
import importlib.util
import json
import math

import pytest
import sympy as sp


def api():
    assert importlib.util.find_spec('app.labs.exam_math'), 'exam mathematics kernel is missing'
    from app.labs import exam_math
    return exam_math


def built(text):
    result = api().build_exam_math(text, {}, {})
    assert result is not None
    return result


def test_improper_region_preserves_area_and_revolution_volume():
    item = built('设 D={(x,y)|0<=y<=1/(x*sqrt(1+x^2)),x>=1}，求 D 的面积及绕 x 轴旋转的体积。')
    assert item['recognized']
    solution = api().solve_exam_math(item['model'])
    values = {q['id']: q['value'] for q in solution['quantities']}
    assert values['area'] == pytest.approx(math.asinh(1))
    assert values['volume'] == pytest.approx(math.pi*(1-math.pi/4))
    assert item['model']['improper_upper']
    json.dumps(api().evaluate_exam_math(item['model'], item['model']['defaults']), allow_nan=False)


def test_enclosed_area_splits_at_every_real_axis_crossing():
    item = built('求曲线 y=-x^3+x^2+2*x 与 x 轴围成的图形的面积。')
    solution = api().solve_exam_math(item['model'])
    assert solution['answer_value'] == pytest.approx(37/12)
    assert item['model']['boundary_roots'] == ['-1', '0', '2']
    result = api().evaluate_exam_math(item['model'], item['model']['defaults'])
    assert any(r['height'] < 0 for r in result['rects'])
    assert result['approx'] > 3


def test_geometry_is_not_hardcoded_and_respects_finite_bounds():
    item = built('D={(x,y)|0<=y<=x^2,x>=1,x<=3}，求面积与绕 x 轴旋转体积。')
    solution = api().solve_exam_math(item['model'])
    assert solution['quantities'][0]['value'] == pytest.approx(26/3)
    assert solution['quantities'][1]['value'] == pytest.approx(242*math.pi/5)


def test_volume_only_numeric_preview_uses_disks_not_area():
    item = built('D={(x,y)|0<=y<=x^2,x>=1,x<=3}，求绕 x 轴旋转体积。')
    result = api().evaluate_exam_math(item['model'], {'n':80})
    assert result['approx'] == pytest.approx(242*math.pi/5, rel=0.001)


def test_implicit_curve_normal_uses_partials_and_unique_real_branch():
    item = built('曲线 3*x^3=y^5+2*y^3 在 x=1 处的法线斜率。')
    assert item['recognized']
    solution = api().solve_exam_math(item['model'])
    assert solution['answer_value'] == pytest.approx(-11/9)
    assert item['model']['point_y'] == '1'
    result = api().evaluate_exam_math(item['model'], item['model']['defaults'])
    assert result['point']['slope'] == pytest.approx(-11/9)


def test_multiple_real_implicit_branches_require_confirmation():
    item = built('曲线 x^2+y^2=1 在 x=0 处的法线斜率。')
    assert not item['recognized']
    assert any(a['severity'] == 'blocking' for a in item['ambiguities'])


def test_stationary_classification_keeps_complete_periodic_families():
    model = {'subject': 'optimization', 'variables': ['x','y'], 'expression': 'x*exp(cos(y))+x^2/2'}
    result = api().complete_extrema(model, {'answer': 'old', 'steps': [], 'limitations': []})
    assert result['stationary_complete']
    assert {p['classification'] for p in result['stationary_points']} == {'minimum', 'saddle'}
    assert all('k' in ' '.join(p['coordinates']) for p in result['stationary_points'])
    assert '极大值不存在' in result['answer']
    minima = next(p for p in result['stationary_points'] if p['classification'] == 'minimum')
    assert sp.simplify(sp.sympify(minima['coordinates'][0])+sp.E) == 0
    json.dumps(result, allow_nan=False)


def test_polynomial_stationary_classification_includes_maximum_and_saddle():
    model = {'subject':'optimization','variables':['x','y'],'expression':'x^3-3*x+y^3-3*y'}
    result = api().complete_extrema(model, {'steps': []})
    assert result['stationary_complete']
    assert len(result['stationary_points']) == 4
    assert {p['classification'] for p in result['stationary_points']} == {'minimum','maximum','saddle'}


def test_review_condition_values_choose_implicit_branch():
    item = api().build_exam_math('曲线 x^2+y^2=1 在 x=0 处的法线斜率。', {}, {'condition_values':{'point_y':'1'}})
    assert item['recognized']
    assert item['model']['vertical_normal']
    assert api().solve_exam_math(item['model'])['answer_value'] is None
    assert 'point' not in api().evaluate_exam_math(item['model'], {})


def test_unicode_geometry_retains_exponents_and_root():
    item = built('D={(x,y)|0≤y≤1/(x√(1+x²)),x≥2}，求面积及绕 x 轴旋转的体积。')
    assert item['recognized']
    assert api().solve_exam_math(item['model'])['quantities'][0]['value'] == pytest.approx(math.asinh(0.5))


def test_latex_region_preserves_implicit_multiplication():
    item = built(r'D={(x,y)|0\le y\le \frac{1}{x\sqrt{1+x^2}},x\ge 1}，求面积。')
    assert item['recognized']
    assert api().solve_exam_math(item['model'])['answer_value'] == pytest.approx(math.asinh(1))


def test_unresolved_axis_crossings_use_absolute_integral():
    item = built('D={(x,y)|y=sin(x),x>=0,x<=7}，求与 x 轴之间的面积。')
    assert api().solve_exam_math(item['model'])['answer_value'] == pytest.approx(5-math.cos(7))


def test_divergent_area_stays_reviewable():
    item = built('D={(x,y)|0<=y<=1/x,x>=1}，求面积。')
    assert not item['recognized']
    assert any(a['field'] == 'integral' for a in item['ambiguities'])


def test_unsupported_region_boundary_is_not_assumed_to_be_zero():
    item = built('区域由 y=x^2 与 y=1 围成，求面积。')
    assert not item['recognized']


@pytest.mark.parametrize('curve,point,slope', [('x+y=2',1,1),('x=2*y',4,-2)])
def test_implicit_equation_is_not_mistaken_for_given_point(curve,point,slope):
    item = built(f'曲线 {curve} 在 x={point} 处的法线斜率。')
    assert item['recognized']
    assert item['model']['point_x'] == str(point)
    assert api().solve_exam_math(item['model'])['answer_value'] == pytest.approx(slope)


def test_constrained_extrema_preserves_feasible_base_solution():
    model = {'subject':'optimization','variables':['x','y'],'expression':'x^2+y^2','bounds':{'x':[1,2],'y':[1,2]}}
    base = {'answer':'(1,1), f=2','answer_point':[1,1],'answer_value':2,'steps':[]}
    assert api().complete_extrema(model,base) == base


@pytest.mark.parametrize('function,lower,upper,area,volume', [
    ('x',-1,1,1/2,math.pi/3),
    ('x^2-1',-2,2,8/3,76*math.pi/15),
    ('-x^2-1',-1,2,0,0),
])
def test_vertical_inequality_regions_discard_empty_fibers(function,lower,upper,area,volume):
    item = built(f'D={{0<=y<={function},{lower}<=x<={upper}}}，求面积及绕 x 轴旋转体积。')
    assert item['recognized']
    values = {q['id']:q['value'] for q in api().solve_exam_math(item['model'])['quantities']}
    assert values['area'] == pytest.approx(area)
    assert values['volume'] == pytest.approx(volume)
    result = api().evaluate_exam_math(item['model'], {})
    assert all(p['y'] is None or p['y'] >= 0 for p in result['series'])
    assert all(r['height'] >= 0 for r in result['rects'])
    assert 'effective_intervals' in item['model']


@pytest.mark.parametrize('lower', ['1','-1','x','1/2','sqrt(2)'])
def test_nonzero_or_symbolic_region_lower_bound_requires_review(lower):
    item = built(f'D={{{lower}<=y<=x^2,-1<=x<=1}}，求与 x 轴的面积。')
    assert not item['recognized']
    assert any(a['field']=='region' for a in item['ambiguities'])


@pytest.mark.parametrize('lower', ['1','-1','x','1/2','sqrt(2)'])
def test_separate_nonzero_y_lower_bound_requires_review(lower):
    item = built(f'D={{y<=x^2,y>={lower},-1<=x<=1}}，求与 x 轴的面积。')
    assert not item['recognized']
    assert any(a['field']=='region' for a in item['ambiguities'])


def test_missing_lower_inequality_boundary_is_not_assumed_to_be_axis():
    item = built('D={y<=x^2,0<=x<=1}，求绕 x 轴旋转体积。')
    assert not item['recognized']
    assert any(a['field']=='region' for a in item['ambiguities'])

def test_rotation_volume_chinese_boundary_and_bracket_interval():
    """`曲线y=` 中 y 紧贴汉字无词边界、[0,1] 区间记法，旋转体必须接住。"""
    from app.labs.recognize import build_problem, _attach_solution
    p = build_problem('12.求曲线y=x^2在[0,1]上绕x轴旋转所得旋转体体积（）。')
    _attach_solution(p)
    assert p['model']['task'] == 'area_volume'
    assert p['status'] == 'ready'
    assert 'pi/5' in p['solution']['answer']


def test_implicit_derivative_with_point_routes_to_kernel():
    from app.labs.recognize import build_problem, _attach_solution
    p = build_problem('11.设y由方程x^2+y^2=4确定，则在点(sqrt(2),sqrt(2))处dy/dx=（）。')
    _attach_solution(p)
    assert p['model']['task'] == 'implicit_derivative'
    assert p['status'] == 'ready'
    assert 'dy/dx=-1' in p['solution']['answer']
