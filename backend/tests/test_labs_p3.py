"""P3 regressions: non-polynomial extrema, Lagrange multipliers and ODE combinations."""
from __future__ import annotations

import json
import math

import pytest
import sympy as sp

from app.labs.ai_solve import compute_plan
from app.labs.constrained import build_constrained_problem, solve_constrained_extrema
from app.labs.ode import build_ode_problem, solve_ode
from app.labs.solvers import evaluate_problem, solve_problem


def constrained_plan(expression: str, constraint: str):
    return compute_plan({
        'kind': 'kernel', 'task': 'constrained_extrema',
        'conditions': {'expression': expression, 'variables': ['x', 'y'], 'constraint': constraint},
    })


def ode_plan(**conditions):
    return compute_plan({'kind': 'kernel', 'task': 'ode', 'conditions': conditions})


def test_non_polynomial_extrema_triangulation_closes_shared_exponential_case():
    result = compute_plan({
        'kind': 'kernel', 'task': 'optimization',
        'conditions': {'expression': '(2*x^2-y^2)*exp(x)', 'variables': ['x', 'y'],
                       'goal': 'extrema', 'bounds': {}},
    })
    solution = result['interactive_solution']
    assert solution['stationary_complete'] is True
    assert solution['solution_complete'] is True
    classifications = {item['classification'] for item in solution['stationary_points']}
    assert {'maximum', 'saddle'} <= classifications
    assert '(0, 0)' not in result['answer'] or '鞍点' in result['answer']


def test_parameterized_empty_solveset_is_not_claimed_complete():
    with pytest.raises(ValueError):
        compute_plan({
            'kind': 'kernel', 'task': 'optimization',
            'conditions': {'expression': 'sin(x)*cos(y)', 'variables': ['x', 'y'],
                           'goal': 'extrema', 'bounds': {}},
        })


def test_lagrange_multiplier_linear_constraint_minimum():
    result = constrained_plan('x^2+y^2', 'x+y=1')
    candidates = result['interactive_solution']['candidates']
    assert len(candidates) == 1
    assert candidates[0]['point'] == ['1/2', '1/2']
    assert candidates[0]['classification'] == 'minimum'
    assert float(sp.sympify(candidates[0]['value'])) == pytest.approx(1 / 2)
    assert '极小值' in result['answer']
    assert all(check['status'] != 'fail' for check in result['checks'])


def test_lagrange_multiplier_circle_has_two_minima_and_two_maxima():
    result = constrained_plan('x*y', 'x^2+y^2=1')
    candidates = result['interactive_solution']['candidates']
    assert len(candidates) == 4
    assert sum(1 for item in candidates if item['classification'] == 'minimum') == 2
    assert sum(1 for item in candidates if item['classification'] == 'maximum') == 2


def test_lagrange_multiplier_rejects_inequality_and_wrong_dimension():
    with pytest.raises(ValueError):
        constrained_plan('x+y', 'x+y<=1')
    with pytest.raises(ValueError):
        compute_plan({
            'kind': 'kernel', 'task': 'constrained_extrema',
            'conditions': {'expression': 'x+y+z', 'variables': ['x', 'y', 'z'], 'constraint': 'x+y=1'},
        })


def test_first_order_linear_ode_with_initial_condition_is_verified():
    result = ode_plan(equation="y' = x + y", initial_conditions=['y(0)=1'])
    solution = result['interactive_solution']
    assert solution['solution_status'] == 'complete'
    assert solution['residual_verified'] is True
    assert solution['initial_conditions_verified'] is True
    assert 'exp(x)' in result['answer']


def test_second_order_constant_coefficient_and_euler_odes():
    second = ode_plan(equation="y'' + 2*y' + y = 0", initial_conditions=['y(0)=1', "y'(0)=0"])
    assert second['interactive_solution']['solution_status'] == 'complete'
    assert 'exp(-x)' in second['answer']

    euler = ode_plan(equation="x^2*y'' + x*y' + y = 0", initial_conditions=['y(1)=1', "y'(1)=0"])
    assert euler['interactive_solution']['solution_status'] == 'complete'
    assert 'cos(ln(x))' in euler['answer']


def test_separable_ode_and_geometric_targets():
    area = ode_plan(equation="y' = y", initial_conditions=['y(0)=1'],
                    target_kind='area', target_lower='0', target_upper='1')
    assert area['interactive_solution']['solution_status'] == 'complete'
    assert area['interactive_solution']['target']['status'] == 'complete'
    assert area['interactive_solution']['answer_value'] == pytest.approx(math.e - 1)

    volume = ode_plan(equation="y' = y", initial_conditions=['y(0)=1'],
                      target_kind='volume_x', target_lower='0', target_upper='1')
    assert volume['interactive_solution']['answer_value'] == pytest.approx(math.pi * (math.e ** 2 - 1) / 2)


def test_ode_without_initial_conditions_keeps_general_solution_constants():
    result = ode_plan(equation="y' = x + y")
    solution = result['interactive_solution']
    assert solution['solution_status'] == 'complete'
    assert solution['general_solution'] and 'C1' in solution['general_solution']
    assert solution['particular_solution'] is None


def test_implicit_solution_with_function_in_domain_is_verified():
    result = ode_plan(equation="y' = 1/(x+y)^2", initial_conditions=['y(1)=0'])
    solution = result['interactive_solution']
    assert solution['solution_status'] == 'complete'
    assert solution['residual_verified'] is True
    assert solution['initial_conditions_verified'] is True
    assert 'atan' in result['answer'] and 'pi/4' in result['answer']
    assert solution['particular_solution']


def test_implicit_solution_cannot_claim_a_geometric_target():
    with pytest.raises(ValueError):
        ode_plan(equation="y' = 1/(x+y)^2", initial_conditions=['y(1)=0'],
                 target_kind='area', target_lower='1', target_upper='2')


def test_unsupported_ode_is_not_marked_complete():
    with pytest.raises(ValueError):
        ode_plan(equation="y' = y^2 + x")
    with pytest.raises(ValueError):
        ode_plan(equation="y' = y", order=4)


def test_local_text_recognition_routes_ode_equation_and_initial_value():
    from app.labs.recognize import build_problem, _attach_solution
    problem = build_problem("求微分方程 y' + y = e^x 满足 y(0)=1 的特解。")
    _attach_solution(problem)
    assert problem['model']['task'] == 'ode'
    assert problem['solution']['solution_status'] == 'complete'
    assert 'exp' in problem['solution']['answer']


def test_p3_plans_are_json_serializable_and_have_checks():
    result = constrained_plan('x^2+y^2', 'x+y=1')
    json.dumps(result, ensure_ascii=False, allow_nan=False)
    ode = ode_plan(equation="y' = x + y", initial_conditions=['y(0)=1'],
                   target_kind='value', target_point='1')
    json.dumps(ode, ensure_ascii=False, allow_nan=False)
    assert ode['interactive_solution']['answer_value'] == pytest.approx(2 * math.e - 2)
