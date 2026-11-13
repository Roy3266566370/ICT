"""P4 regressions: numerical series, power series and Fourier series."""
from __future__ import annotations

import json
import math

import pytest

from app.labs.ai_solve import compute_plan
from app.labs.series import solve_fourier, solve_power_series, solve_series_convergence


def series_plan(**conditions):
    return compute_plan({'kind': 'kernel', 'task': 'series_convergence', 'conditions': conditions})


def power_plan(**conditions):
    return compute_plan({'kind': 'kernel', 'task': 'power_series', 'conditions': conditions})


def fourier_plan(**conditions):
    return compute_plan({'kind': 'kernel', 'task': 'fourier_series', 'conditions': conditions})


@pytest.mark.parametrize('term,status', [
    ('1/n^2', 'absolutely_convergent'),
    ('1/n', 'divergent'),
    ('(-1)^n/n', 'conditionally_convergent'),
    ('(-1)^n/n^2', 'absolutely_convergent'),
    ('n/factorial(n)', 'absolutely_convergent'),
])
def test_numerical_series_classification(term, status):
    result = series_plan(term=term)
    assert result['interactive_solution']['series_status'] == status
    assert result['interactive_solution']['solution_complete'] is True
    assert all(check['status'] != 'fail' for check in result['checks'])


def test_unknown_numerical_series_is_not_marked_convergent():
    with pytest.raises(ValueError):
        series_plan(term='sin(n)/n')


def test_power_series_radius_and_endpoints():
    result = power_plan(goal='radius', coefficient='1/n')
    solution = result['interactive_solution']
    assert solution['radius'] == '1'
    assert solution['interval'] == '[-1, 1)'
    assert solution['solution_complete'] is True
    assert any(item['label'] == '右端点' and item['status'] == 'divergent' for item in solution['endpoint_status'])


def test_power_series_infinite_radius_and_zero_radius():
    infinite = power_plan(goal='radius', coefficient='1/factorial(n)')
    assert infinite['interactive_solution']['radius'] == 'oo'
    assert infinite['interactive_solution']['interval'] == '(-∞, +∞)'

    zero = power_plan(goal='radius', coefficient='factorial(n)')
    assert zero['interactive_solution']['radius'] == '0'
    assert zero['interactive_solution']['interval'] == '{0}'
    assert zero['interactive_solution']['solution_complete'] is True


def test_power_series_sum_functions():
    geometric = power_plan(goal='sum', coefficient='1')
    assert '1/(1 - x)' in geometric['answer']
    assert geometric['interactive_solution']['sum_function'] == '1/(1 - x)'

    arithmetic = power_plan(goal='sum', coefficient='n')
    assert 'x/(1 - x)^2' in arithmetic['interactive_solution']['sum_function']


def test_power_series_expansion():
    result = power_plan(goal='expand', expression='exp(x)', center='0', order=4)
    assert result['interactive_solution']['solution_complete'] is True
    assert 'x^4/24' in result['answer']
    assert len(result['interactive_solution']['coefficients']) == 5


@pytest.mark.parametrize('expression', ['x', 'x^2'])
def test_fourier_coefficients_for_centered_interval(expression):
    result = fourier_plan(expression=expression, lower='-pi', upper='pi', order=3)
    solution = result['interactive_solution']
    assert solution['solution_complete'] is True
    assert solution['fourier']['a0'] is not None
    if expression == 'x':
        assert solution['fourier']['coefficients'][0] == {'n': 1, 'an': '0', 'bn': '2'}
    else:
        assert solution['fourier']['a0'] == '2*pi**2/3'


def test_fourier_discontinuity_note_and_json():
    result = fourier_plan(expression='x', lower='-pi', upper='pi', order=2)
    assert result['interactive_solution']['fourier']['endpoint_jump'] is True
    assert 'Dirichlet' in result['interactive_solution']['fourier']['convergence_note']
    json.dumps(result, ensure_ascii=False, allow_nan=False)


def test_local_text_routes_series_power_and_fourier():
    from app.labs.recognize import build_problem, _attach_solution
    cases = {
        '判断级数 ∑ 1/n^2 的敛散性。': 'series_convergence',
        '求幂级数 ∑ x^n/n 的收敛半径。': 'power_series',
        '求幂级数 ∑ x^n 的和函数。': 'power_series',
        '将 f(x)=x 在 [-pi,pi] 上展开为傅里叶级数。': 'fourier_series',
    }
    for text, task in cases.items():
        problem = build_problem(text)
        _attach_solution(problem)
        assert problem['model']['task'] == task
        assert problem['status'] == 'ready'
        assert problem['solution']['answer']


def test_p4_invalid_conditions_are_rejected():
    with pytest.raises(ValueError):
        power_plan(goal='radius')
    with pytest.raises(ValueError):
        power_plan(goal='expand', expression='exp(x)', order=0)
    with pytest.raises(ValueError):
        fourier_plan(expression='x', lower='1', upper='0')
    with pytest.raises(ValueError):
        series_plan(term='1/n', index_start=-1)
