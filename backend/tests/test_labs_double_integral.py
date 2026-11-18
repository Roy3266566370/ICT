"""Region, integrand and answer must describe the same original question."""
import json

import pytest
import sympy as sp

from app.labs.recognize import build_problem, _attach_solution
from app.labs.solvers import evaluate_problem

QUESTION = '已知平面有界区域D={(x,y)|y²≤x,x²≤y}，计算二重积分 ∬_D (x-y+1)² dxdy。'


def compiled(text):
    problem = build_problem(text)
    _attach_solution(problem)
    return problem


def test_sample_builds_region_and_integrates_original_integrand():
    p = compiled(QUESTION)
    assert p['status'] == 'ready'
    assert p['model'].get('task') == 'double_integral'
    assert p['model']['inner_bounds'] == ['x^2', 'sqrt(x)']
    assert p['model']['outer_bounds'] == ['0', '1']
    assert p['solution']['answer_value'] == pytest.approx(71/210)
    assert p['solution']['exact'] == '71/210'
    result = evaluate_problem(p['model'], {'slice': 0.25, 'n': 80})
    assert result['slice']['lower'] == pytest.approx(1/16)
    assert result['slice']['upper'] == pytest.approx(1/2)
    assert result['approx'] == pytest.approx(71/210, abs=0.001)
    assert all(c['status'] != 'fail' for c in result['checks'])
    json.dumps(result, allow_nan=False)


def test_explicit_region_does_not_replace_integrand_or_assume_zero_lower_curve():
    p = compiled('区域D={0<=x<=2,x<=y<=2*x}，计算二重积分 ∬_D (x+y) dxdy。')
    assert p['status'] == 'ready'
    assert p['model'].get('task') == 'double_integral'
    assert p['solution']['answer_value'] == pytest.approx(20/3)


@pytest.mark.parametrize('text', [
    '计算二重积分 ∬_D (x+y) dxdy，D是一个有界区域。',
    '区域D={0<=x<=1,x<=y<=x^2}，计算二重积分 ∬_D (x+y) dxdy。',
    '区域D={0<=x<=1,0<=y<=1}，计算二重积分 ∬_D 1/(x-y) dxdy。',
    '区域D={y^3<=x,x^3<=y}，计算二重积分 ∬_D 1 dxdy。',
])
def test_unconfirmed_region_or_unsupported_integrand_never_becomes_one_dimensional_example(text):
    p = compiled(text)
    assert p['status'] == 'needs_review'
    assert p['model'].get('task') == 'double_integral'
    assert not p['model'].get('teaching')
    assert not p['solution']['answer']


def test_image_confirmation_blocks_exact_answer_until_review():
    p = build_problem(QUESTION, pages=[{'page':1, 'requires_formula_confirmation':True}])
    _attach_solution(p)
    assert p['status'] == 'needs_review'
    assert not p['solution']['answer']


@pytest.mark.parametrize('region,restriction', [
    ('0<=x<=1,0<=y<=1','且x+y<=1'),
    ('y^2<=x,x^2<=y','且x<=1/2'),
])
def test_additional_region_restrictions_cannot_be_silently_discarded(region,restriction):
    p = compiled(f'区域D={{{region}}}，{restriction}，计算二重积分 ∬_D 1 dxdy。')
    assert p['status'] == 'needs_review'
    assert not p['solution']['answer']


def test_euler_constant_remains_executable_in_model_and_boundary():
    p = compiled('区域D={0<=x<=1,0<=y<=e*x}，计算二重积分 ∬_D e*(x+y) dxdy。')
    assert p['status'] == 'ready'
    assert 'E' not in p['model']['integrand']
    result = evaluate_problem(p['model'], p['model']['defaults'])
    assert result['exact'] == pytest.approx(float(sp.E**2/3+sp.E**3/6))


@pytest.mark.parametrize('integrand,lower', [('sqrt(x)^2','0'),('x^2/x','0'),('1','sqrt(x)^2'),('1','x^2/x')])
def test_original_expression_domains_are_checked_before_simplification(integrand,lower):
    from app.labs.double_integral import compile_model
    with pytest.raises(ValueError):
        compile_model({'integrand':integrand,'outer_variable':'x','outer_bounds':['-1','1'],'inner_bounds':[lower,'2']})


@pytest.mark.parametrize('outer_bounds,inner_bounds', [(['0','10^50'],['0','1']), (['0','1'],['0','10^50'])])
def test_out_of_plot_budget_coordinates_are_rejected_before_ready(outer_bounds,inner_bounds):
    from app.labs.double_integral import compile_model
    with pytest.raises(ValueError):
        compile_model({'integrand':'0','outer_bounds':outer_bounds,'inner_bounds':inner_bounds})


def test_bare_y_outer_region_and_removable_singularity_numerical_check():
    from app.labs.kernel_models import compile_kernel_problem
    problem = compile_kernel_problem({
        'task': 'double_integral',
        'conditions': {
            'integrand': '(x-y)^2 / (x^2 + y^2)',
            'region_text': 'y-2 <= x <= sqrt(4-y^2), 0 <= y <= 2',
        },
    })
    assert problem['status'] == 'ready'
    assert problem['model']['outer_variable'] == 'y'
    assert problem['solution']['exact'] == '-2 + 2*pi'
    assert problem['solution']['answer_value'] == pytest.approx(2 * 3.141592653589793 - 2, abs=1e-6)
    result = evaluate_problem(problem['model'], problem['model']['defaults'])
    assert all(c['status'] == 'pass' for c in result['checks'])
