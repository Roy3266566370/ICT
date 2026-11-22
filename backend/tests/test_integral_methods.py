import sympy as sp

from app.labs.expr import parse_expression
from app.labs.integral_methods import (
    VERIFICATION_NUMERIC,
    VERIFICATION_SYMBOLIC,
    VERIFICATION_UNCONFIRMED,
    antiderivative_verification,
    method_plan,
    plan_steps,
    real_antiderivative,
    verifies_antiderivative,
)


def expression(text, variable='x'):
    return parse_expression(text, (variable,))


def test_substitution_plan_is_checked_and_matches_standard_steps():
    x = sp.Symbol('x', real=True)
    integrand = expression('x*cos(x^2)')
    plan = method_plan(integrand, x)
    assert plan['kind'] == 'substitution'
    assert plan['inner'] == x**2
    assert sp.simplify(plan['result'] - sp.sin(x**2)/2) == 0
    assert verifies_antiderivative(plan['result'], integrand, x)
    steps = plan_steps(plan, x, constant=True)
    assert [step['id'] for step in steps] == [
        'method-substitution',
        'method-substitution-integrate',
        'method-substitution-back',
    ]
    assert '+C' in steps[-1]['latex']


def test_by_parts_plan_avoids_trivial_reciprocal_substitution():
    x = sp.Symbol('x', real=True)
    integrand = expression('x^2*exp(-x)')
    plan = method_plan(integrand, x)
    assert plan['kind'] == 'parts'
    assert plan['u'] == x**2
    assert verifies_antiderivative(plan['result'], integrand, x)
    steps = plan_steps(plan, x, constant=False)
    assert [step['id'] for step in steps] == [
        'method-parts-choose',
        'method-parts-duv',
        'method-parts-formula',
        'method-parts-finish',
    ]
    assert all('+C' not in step['latex'] for step in steps)


def test_non_elementary_or_trivial_transformations_are_not_displayed():
    x = sp.Symbol('x', real=True)
    for text in ('sin(x)/x', 'sin(1/x)', 'x^x', 'exp(cos(x))'):
        assert method_plan(expression(text), x) is None


def test_unevaluated_integral_or_derivative_never_counts_as_verified():
    x = sp.Symbol('x', real=True)
    integrand = expression('exp(cos(x))')
    assert not verifies_antiderivative(sp.Integral(integrand, x), integrand, x)
    assert not verifies_antiderivative(sp.Derivative(integrand, x), integrand, x)
    assert antiderivative_verification(
        sp.Integral(integrand, x), integrand, x)['level'] == VERIFICATION_UNCONFIRMED


def test_verification_levels_separate_symbolic_proof_from_numeric_spot_checks():
    x = sp.Symbol('x', real=True)
    polynomial = expression('x*cos(x^2)')
    symbolic = antiderivative_verification(sp.sin(x**2)/2, polynomial, x)
    assert symbolic == {'level': VERIFICATION_SYMBOLIC, 'symbolic': True, 'numeric': False}

    logarithm = expression('1/(x*log(x))')
    normalized, _ = real_antiderivative(sp.integrate(logarithm, x), logarithm, x)
    numeric = antiderivative_verification(normalized, logarithm, x)
    assert numeric == {'level': VERIFICATION_NUMERIC, 'symbolic': False, 'numeric': True}


def test_numeric_only_method_steps_do_not_claim_symbolic_proof():
    x = sp.Symbol('x', real=True)
    plan = method_plan(expression('1/(x*log(x))'), x)
    assert plan['verification']['level'] == VERIFICATION_NUMERIC
    details = ' '.join(step['detail'] for step in plan_steps(plan, x, constant=True))
    assert '数值抽查不是全域证明' in details


def test_real_log_is_used_only_when_negative_side_stays_real():
    x = sp.Symbol('x', real=True)
    reciprocal = expression('1/x')
    normalized, changed = real_antiderivative(sp.integrate(reciprocal, x), reciprocal, x)
    assert changed is True
    assert sp.simplify(normalized) == sp.log(sp.Abs(x))
    assert verifies_antiderivative(normalized, reciprocal, x)

    logarithm = expression('log(x)^2')
    raw = sp.integrate(logarithm, x)
    unchanged, changed = real_antiderivative(raw, logarithm, x)
    assert changed is False
    assert unchanged == raw


def test_periodic_log_antiderivative_is_normalized_and_verified():
    x = sp.Symbol('x', real=True)
    secant = expression('sec(x)')
    normalized, changed = real_antiderivative(sp.integrate(secant, x), secant, x)
    assert changed is True
    assert normalized.has(sp.Abs)
    assert verifies_antiderivative(normalized, secant, x)


def test_manualintegrate_covers_partial_fractions_cyclic_parts_and_trig_rewrite():
    x = sp.Symbol('x', real=True)
    cases = [
        ('1/(x^2-1)', '恒等变形 / 部分分式拆解'),
        ('exp(x)*sin(x)', '循环分部积分'),
        ('sin(x)^2', '恒等变形 / 部分分式拆解'),
        ('1/(x^2+4)', '反正切标准型积分'),
    ]
    for raw, expected_title_fragment in cases:
        integrand = expression(raw)
        plan = method_plan(integrand, x)
        assert plan is not None, f'expected plan for {raw}'
        assert plan['kind'] == 'manualintegrate'
        assert verifies_antiderivative(plan['result'], integrand, x)
        steps = plan_steps(plan, x, constant=True)
        assert any(expected_title_fragment in step['title'] for step in steps)
        assert steps[-1]['id'] == 'method-manual-verify'
        assert '+C' in steps[-1]['latex']
