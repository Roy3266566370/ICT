"""P2 regressions: non-polynomial double integrals, partitions, order swaps and polar."""
from __future__ import annotations

import json
import math

import pytest

from app.labs.ai_solve import compute_plan
from app.labs.double_integral import compile_model, evaluate_double_integral, solve_double_integral
from app.labs.recognize import _attach_solution, build_problem
from app.labs.solvers import evaluate_problem


def strip(integrand, lower='0', upper='1', inner_lower='0', inner_upper='1', **extra):
    return compile_model({
        'integrand': integrand, 'outer_variable': 'x',
        'outer_bounds': [lower, upper], 'inner_bounds': [inner_lower, inner_upper], **extra,
    })


@pytest.mark.parametrize('integrand,expected', [
    ('sin(x)', 1 - math.cos(1)),
    ('exp(x+y)', (math.e - 1) ** 2),
    ('1/(1+x^2)', math.pi / 4),
    ('sqrt(x)', 2 / 3),
    ('log(x)', -1.0),
    ('sin(x)/x', 0.946083070367183),
])
def test_non_polynomial_integrands_are_symbolically_integrated_and_checked(integrand, expected):
    model = strip(integrand)
    assert model['answer_value'] == pytest.approx(expected, rel=1e-8)
    result = evaluate_double_integral(model, {'n': 60})
    assert result['approx'] == pytest.approx(expected, abs=0.02)
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize('integrand,bounds', [
    ('1/(x-y)', ['0', '1', '0', '1']),
    ('1/x', ['0', '1', '0', '1']),
    ('sqrt(x)', ['-1', '1', '0', '1']),
    ('log(x)', ['-1', '1', '0', '1']),
])
def test_internal_singularity_or_domain_gap_is_never_passed(integrand, bounds):
    with pytest.raises(ValueError):
        strip(integrand, *bounds)


def test_piecewise_regions_sum_each_piece_and_keep_regions_separate():
    model = compile_model({
        'integrand': 'x+y',
        'pieces': [
            {'outer_bounds': ['0', '1'], 'inner_bounds': ['0', 'x']},
            {'outer_bounds': ['1', '2'], 'inner_bounds': ['0', '2-x']},
        ],
    })
    assert model['region_kind'] == 'pieces'
    assert len(model['pieces']) == 2
    assert model['answer_value'] == pytest.approx(4 / 3)
    result = evaluate_double_integral(model, {'slice': 0.5, 'n': 40})
    assert len(result['pieces']) == 2
    assert result['approx'] == pytest.approx(4 / 3, abs=0.01)


def test_piece_overlap_is_rejected():
    with pytest.raises(ValueError, match='重叠'):
        compile_model({
            'integrand': '1',
            'pieces': [
                {'outer_bounds': ['0', '2'], 'inner_bounds': ['0', '1']},
                {'outer_bounds': ['1', '3'], 'inner_bounds': ['0', '1']},
            ],
        })


@pytest.mark.parametrize('inner_bounds', [['0', 'x'], ['x^2', 'x']])
def test_order_swap_derives_new_limits_and_verifies_numerically(inner_bounds):
    model = strip('x+y', inner_lower=inner_bounds[0], inner_upper=inner_bounds[1], swap_order=True)
    swapped = model['swapped']
    assert swapped is not None
    assert swapped['outer_variable'] == 'y'
    assert swapped['answer_value'] == pytest.approx(model['answer_value'])
    assert swapped['numeric_verified'] is True


def test_order_swap_is_rejected_when_boundaries_are_not_monotone():
    with pytest.raises(ValueError, match='换序'):
        strip('1', inner_lower='0', inner_upper='x*(1-x)', swap_order=True)


@pytest.mark.parametrize('integrand,polar,expected', [
    ('1', {'theta_bounds': ['0', '2*pi'], 'r_bounds': ['0', '1']}, math.pi),
    ('x^2+y^2', {'theta_bounds': ['0', '2*pi'], 'r_bounds': ['0', '1']}, math.pi / 2),
    ('1', {'theta_bounds': ['0', '2*pi'], 'r_bounds': ['1', '2']}, 3 * math.pi),
    ('1', {'theta_bounds': ['0', 'pi/2'], 'r_bounds': ['0', '1']}, math.pi / 4),
    ('exp(-(x^2+y^2))', {'theta_bounds': ['0', '2*pi'], 'r_bounds': ['0', '1']}, math.pi * (1 - math.exp(-1))),
])
def test_polar_integrals_include_jacobian_and_numeric_check(integrand, polar, expected):
    model = compile_model({'integrand': integrand, 'polar': polar})
    assert model['region_kind'] == 'polar'
    assert model['answer_value'] == pytest.approx(expected, rel=1e-8)
    result = evaluate_double_integral(model, {'n': 60})
    assert result['polar']['jacobian'] == 'r'
    assert len(result['polar']['outer_points']) == 121
    assert result['approx'] == pytest.approx(expected, abs=0.03)


def test_polar_trigonometric_boundary_is_supported():
    model = compile_model({
        'integrand': '1',
        'polar': {'theta_bounds': ['-pi/2', 'pi/2'], 'r_bounds': ['0', '2*cos(theta)']},
    })
    assert model['answer_value'] == pytest.approx(math.pi)
    result = evaluate_double_integral(model, {'n': 60})
    assert result['approx'] == pytest.approx(math.pi, abs=0.03)


def test_polar_invalid_radius_or_direction_is_rejected():
    with pytest.raises(ValueError):
        compile_model({'integrand': '1', 'polar': {'theta_bounds': ['0', '2*pi'], 'r_bounds': ['1', '0']}})
    with pytest.raises(ValueError):
        compile_model({'integrand': '1', 'polar': {'theta_bounds': ['1', '0'], 'r_bounds': ['0', '1']}})
    with pytest.raises(ValueError):
        compile_model({'integrand': '1', 'polar': {'theta_bounds': ['0', '2*pi'], 'r_bounds': ['-1', '1']}})
    with pytest.raises(ValueError):
        compile_model({'integrand': '1', 'polar': {'theta_bounds': ['0', '2*pi'], 'r_bounds': ['0', '1']}, 'swap_order': True})


def test_local_text_routes_non_polynomial_and_polar_regions():
    cases = {
        '区域D={x^2+y^2<=1}，计算二重积分 ∬_D 1 dxdy。': ('polar', 'pi'),
        '区域D={x^2+y^2<=1,x>=0,y>=0}，计算二重积分 ∬_D 1 dxdy。': ('polar', 'pi/4'),
        '区域D={0<=x<=1,0<=y<=1}，计算二重积分 ∬_D sin(x) dxdy。': ('strip', '1 - cos(1)'),
        '区域D={0<=x<=1,0<=y<=x^2}，计算二重积分 ∬_D 1 dxdy。': ('strip', '1/3'),
    }
    for text, (region_kind, answer) in cases.items():
        problem = build_problem(text)
        _attach_solution(problem)
        assert problem['status'] == 'ready'
        assert problem['model']['region_kind'] == region_kind
        assert problem['solution']['answer'] == answer


def test_local_text_rejects_denominator_singularity_instead_of_polynomial_fallback():
    problem = build_problem('区域D={0<=x<=1,0<=y<=1}，计算二重积分 ∬_D 1/(x-y) dxdy。')
    _attach_solution(problem)
    assert problem['status'] == 'needs_review'
    assert not problem['solution']['answer']


def test_declarative_p2_plans_are_checkable_and_json_serializable():
    plans = [
        {'integrand': 'sin(x)', 'outer_variable': 'x', 'outer_bounds': ['0', '1'], 'inner_bounds': ['0', '1']},
        {'integrand': '1', 'pieces': [
            {'outer_bounds': ['0', '1'], 'inner_bounds': ['0', 'x']},
            {'outer_bounds': ['1', '2'], 'inner_bounds': ['0', '2-x']},
        ]},
        {'integrand': 'x^2+y^2', 'polar': {'theta_bounds': ['0', '2*pi'], 'r_bounds': ['0', '1']}},
        {'integrand': 'x+y', 'outer_variable': 'x', 'outer_bounds': ['0', '1'],
         'inner_bounds': ['x^2', 'x'], 'swap_order': True},
    ]
    for conditions in plans:
        result = compute_plan({'kind': 'kernel', 'task': 'double_integral', 'conditions': conditions})
        assert result['answer']
        assert not any(check['status'] == 'fail' for check in result['checks'])
        json.dumps(result, ensure_ascii=False, allow_nan=False)


def test_evaluate_problem_uses_region_specific_fields():
    pieces = compile_model({
        'integrand': '1', 'pieces': [
            {'outer_bounds': ['0', '1'], 'inner_bounds': ['0', 'x']},
            {'outer_bounds': ['1', '2'], 'inner_bounds': ['0', '2-x']},
        ]})
    result = evaluate_problem(pieces, pieces['defaults'])
    assert result['region_kind'] == 'pieces'
    assert len(result['pieces']) == 2

    polar = compile_model({'integrand': '1', 'polar': {'theta_bounds': ['0', '2*pi'], 'r_bounds': ['0', '1']}})
    polar_result = evaluate_problem(polar, polar['defaults'])
    assert polar_result['region_kind'] == 'polar'
    assert polar_result['polar']['jacobian'] == 'r'
    assert polar_result['approx'] == pytest.approx(math.pi, abs=0.05)
