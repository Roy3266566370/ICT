import sympy as sp
from app.labs.extrema import solve_extrema


def solve(expression):
    return solve_extrema({'typed_conditions': {'expression': expression, 'variables': 'x,y', 'operation': 'unconstrained'}})


def test_exam_periodic_stationary_families_are_complete():
    result = solve('x*exp(cos(y))+x^2/2')
    assert result['solution_complete'] is True
    data = result['extrema_details']
    assert data['stationary_complete'] and data['classification_complete']
    assert sorted(p['classification'] for p in data['candidates']) == ['minimum', 'saddle']
    k = sp.Symbol('k', integer=True)
    for p in data['candidates']:
        x, y = [sp.sympify(v, locals={'k': k}) for v in p['point']]
        assert y.has(k)
        assert sp.simplify(x + sp.exp(sp.cos(y))) == 0
        assert p['residual_verified'] is True
    assert 'k' in result['answer'] and '整数' in result['answer']
    assert '无局部极大值' in result['answer']


def test_changed_coefficients_and_frequency_are_not_exam_specific():
    result = solve('2*x^2+3*x*exp(2*sin(3*y+1))+7')
    assert result['solution_complete'] is True
    assert sorted(p['classification'] for p in result['extrema_details']['candidates']) == ['minimum', 'saddle']
    assert {sp.simplify(sp.sympify(p['value'])) for p in result['extrema_details']['candidates']} == {7-sp.Rational(9,8)*sp.exp(4), 7-sp.Rational(9,8)*sp.exp(-4)}


def test_concave_quadratic_reverses_extremum_classification():
    result = solve('-x^2+2*x*exp(cos(2*y))')
    assert result['solution_complete'] is True
    assert sorted(p['classification'] for p in result['extrema_details']['candidates']) == ['maximum', 'saddle']


def test_unrecognized_or_hidden_domain_objectives_stay_unverified():
    for expression in ('x^2/2+x*exp(cos(y^2))', 'x^2/2+x*exp(cos(y))+1/y', 'x^2/2+x*(2+sin(y))', 'x^2/2+x*exp(cos(y))+sin(y)'):
        assert solve(expression)['solution_complete'] is False
