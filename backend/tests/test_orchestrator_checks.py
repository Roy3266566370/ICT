"""Regression checks for facts that may be passed between solver steps."""
import pytest

from app.labs.capabilities import check_domain, check_sign_segments, check_zeros


@pytest.mark.parametrize('expression,lower,upper', [
    ('sqrt((x-0.501)*(x-0.502))', 0, 1),
    ('(x-0.5)/(x-0.5)', 0, 1),
    ('sqrt(x)^2', -1, 1),
    ('log(x)-log(x)', -1, 1),
])
def test_domain_preserves_original_restrictions(expression, lower, upper):
    result = check_domain(expression, 'x', lower, upper)
    assert result['ok'] is False


def test_domain_polynomial_is_certified():
    result = check_domain('x^2-x', 'x', 0, 2)
    assert result['ok'] and result['complete']


def test_zero_function_does_not_promise_empty_complete_root_list():
    result = check_zeros('0', 'x', 0, 1)
    assert not (result['complete'] and result['zeros'] == [])
    assert result['infinite'] is True


def test_polynomial_roots_remain_complete():
    result = check_zeros('x^2-x', 'x', 0, 2)
    assert result['complete']
    assert result['zeros'] == [0.0, 1.0]


def test_signs_require_explicit_completeness():
    result = check_sign_segments('x^2-x', 'x', 0, 2, [])
    assert not result['complete']


def test_signs_do_not_turn_undefined_midpoint_into_zero():
    result = check_sign_segments('sqrt(x-1)', 'x', 0, 2, [], True)
    assert not result['complete']


def test_signs_with_complete_roots_and_domain():
    result = check_sign_segments('x^2-x', 'x', 0, 2, [0, 1], True)
    assert result['complete']
    assert [s['sign'] for s in result['segments']] == [-1, 1]
