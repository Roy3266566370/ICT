import pytest
import sympy as sp

from app.labs.manual import build_manual_document, preview_integral


def document(**conditions):
    return build_manual_document(lab_id='t', title='', task='integral_function',
                                 conditions=conditions, now_iso='2026-11-18')['problems'][0]


@pytest.mark.parametrize('function,lower,upper,expected', [
    ('exp(-t^2)', '0', 'x', 'exp(-x**2)'),
    ('sin(t)', '0', 'x^2', '2*x*sin(x**2)'),
    ('t', 'x', 'x^2', '2*x**3-x'),
    ('1/(1+t^2)', 'x', '2*x', '2/(1+4*x**2)-1/(1+x**2)'),
])
def test_integral_function_derivative_matches_fundamental_theorem(function, lower, upper, expected):
    p = document(expression=function, lower_expression=lower, upper_expression=upper)
    assert p['manual_input']['result_status'] == 'complete'
    assert sp.simplify(sp.sympify(p['solution']['exact']) - sp.sympify(expected)) == 0
    assert p['solution']['integral_function_details']['verification_level'] == 'symbolic'


def test_integral_function_point_value_is_symbolically_evaluated_and_numerically_checked():
    p = document(expression='1/(1+t^2)', lower_expression='x', upper_expression='2*x', point='1')
    assert p['manual_input']['result_status'] == 'complete'
    assert sp.simplify(sp.sympify(p['solution']['integral_function_details']['value']) + sp.Rational(1, 10)) == 0
    details = p['solution']['integral_function_details']
    assert details['verification_level'] == 'numeric'
    assert details['numeric_check'] == pytest.approx(-0.1, abs=1e-6)


@pytest.mark.parametrize('conditions', [
    dict(expression='x*t', lower_expression='0', upper_expression='x'),
    dict(expression='t', lower_expression='0', upper_expression='t'),
    dict(expression='t', lower_expression='0'),
    dict(expression='t', lower_expression='0', upper_expression='x', point='t'),
])
def test_integral_function_rejects_mixed_variables_or_missing_bounds(conditions):
    with pytest.raises(ValueError):
        preview_integral('integral_function', conditions)


def test_integral_function_keeps_constant_bounds_and_zero_derivative():
    p = document(expression='t^2', lower_expression='0', upper_expression='1')
    assert p['manual_input']['result_status'] == 'complete'
    assert sp.sympify(p['solution']['exact']) == 0
