import pytest
import sympy as sp
from app.labs.manual import build_manual_document, preview_integral, revise_manual_document


def document(expression, constraint=None, **extra):
    c = dict(expression=expression, variables='x,y', operation='constrained' if constraint is not None else 'unconstrained', **extra)
    if constraint is not None:
        c['constraint'] = constraint
    return build_manual_document(lab_id='extrema', title='', task='multivariable_extrema', conditions=c, now_iso='2026-11-13')


def problem(*args, **kwargs):
    return document(*args, **kwargs)['problems'][0]


@pytest.mark.parametrize('expression,classes', [
    ('x^2+y^2', ['minimum']), ('-x^2-y^2', ['maximum']),
    ('x^2-y^2', ['saddle']), ('x^4-2*x^2+y^2', ['minimum','minimum','saddle']),
    ('x+y', []),
])
def test_all_unconstrained_stationary_points(expression, classes):
    p = problem(expression)
    d = p['manual_input']['extrema_details']
    assert p['manual_input']['result_status'] == 'complete', p['solution']
    assert d['stationary_complete'] and d['classification_complete']
    assert sorted(row['classification'] for row in d['candidates']) == sorted(classes)
    assert all(row['residual_verified'] for row in d['candidates'])
    assert '局部' in d['scope_note']


def test_degenerate_and_stationary_families_are_not_fake_no_extrema():
    for expression in ('x^4+y^4', '(x-y)^2', '1'):
        p = problem(expression)
        assert p['manual_input']['result_status'] == 'unsupported'
        assert not p['solution']['answer']
    assert problem('x^4+y^4')['manual_input']['extrema_details']['candidates'][0]['classification'] == 'undetermined'


@pytest.mark.parametrize('expression,constraint,classes', [
    ('x*y', 'x+y=2', ['maximum']),
    ('x^2+y^2', 'x+y=1', ['minimum']),
    ('x+y', 'x^2+y^2=1', ['maximum','minimum']),
    ('x', 'y=0', []),
])
def test_constrained_regular_candidates_and_residuals(expression, constraint, classes):
    p = problem(expression, constraint)
    d = p['manual_input']['extrema_details']
    assert p['manual_input']['conditions']['constraint'] == constraint
    assert p['manual_input']['result_status'] == 'complete', p['solution']
    assert d['stationary_complete'] and d['singular_complete']
    assert sorted(row['classification'] for row in d['candidates']) == sorted(classes)
    assert all(row['residual_verified'] and row['constraint_verified'] for row in d['candidates'])


def test_singular_constraint_point_is_not_omitted_by_lagrange():
    p = problem('x+y', 'x^2+y^2=0')
    d = p['manual_input']['extrema_details']
    assert p['manual_input']['result_status'] == 'unsupported'
    assert any(row['point'] == ['0','0'] and row['kind'] == 'singular' and row['constraint_verified'] for row in d['candidates'])
    assert '奇异' in p['manual_input']['result_note']


def test_constraint_family_and_empty_feasible_set_do_not_claim_extrema():
    assert problem('x^2+y^2', 'x^2+y^2=1')['manual_input']['result_status'] == 'unsupported'
    p = problem('x+y', 'x^2+y^2=-1')
    assert p['manual_input']['result_status'] == 'unsupported'
    assert not p['solution']['answer']


@pytest.mark.parametrize('constraint', ['x+y<=1','x+y=1\nx-y=0','x+y=1; x>0','x+y=1, x-y=0','0=0'])
def test_unsupported_constraints_are_rejected_without_dropping_them(constraint):
    with pytest.raises(ValueError):
        problem('x*y', constraint)


def test_nonpolynomial_and_raw_domain_hole_are_preserved_as_unfinished():
    for expression in ('abs(x)+y^2', 'x^2/x+y^2', 'sin(x)+y^2'):
        p = problem(expression)
        assert p['manual_input']['conditions']['expression'] == expression
        assert p['manual_input']['result_status'] == 'unsupported'


def test_complex_coefficients_cannot_be_classified_as_real_extrema():
    p = problem('sqrt(-1)*x+y^2')
    assert p['manual_input']['result_status'] == 'unsupported'


def test_no_hidden_extra_conditions_or_dimension_change():
    with pytest.raises(ValueError):
        problem('x^2+y^2', point='0,0')
    with pytest.raises(ValueError):
        preview_integral('multivariable_extrema', dict(expression='x*y',variables='x,y',operation='unconstrained',constraint='x+y=1'))


def test_variables_accepts_list_for_the_fixed_pair():
    doc = build_manual_document(lab_id='extrema', title='', task='multivariable_extrema',
        conditions=dict(expression='x^2+y^2', operation='unconstrained', variables=['x', 'y']),
        now_iso='2026-11-13')
    problem_row = doc['problems'][0]
    assert problem_row['status'] == 'ready'
    assert '局部极小值' in problem_row['solution']['answer']
    with pytest.raises(ValueError):
        build_manual_document(lab_id='extrema', title='', task='multivariable_extrema',
            conditions=dict(expression='u^2+v^2', operation='unconstrained', variables=['u', 'v']),
            now_iso='2026-11-13')


def test_provider_synonyms_map_to_unconstrained_or_constrained():
    doc = build_manual_document(lab_id='extrema', title='', task='multivariable_extrema',
        conditions=dict(expression='x^2+y^2', operation='local_extrema', variables=['x', 'y']),
        now_iso='2026-11-13')
    assert doc['problems'][0]['model']['typed_conditions']['operation'] == 'unconstrained'
    doc = build_manual_document(lab_id='extrema', title='', task='multivariable_extrema',
        conditions=dict(expression='x*y', operation='conditional', variables=['x', 'y'], constraint='x+y=2'),
        now_iso='2026-11-13')
    assert doc['problems'][0]['model']['typed_conditions']['operation'] == 'constrained'
    assert '局部极大值' in doc['problems'][0]['solution']['answer']


def test_review_recomputes_full_constraint():
    doc = document('x*y', 'x+y=2')
    p = doc['problems'][0]
    revised = revise_manual_document(doc, p, {'constraint':'x+y=4'})
    rows = revised['manual_input']['extrema_details']['candidates']
    assert rows[0]['point'] == ['2','2'] and rows[0]['value'] == '4'
    assert revised['manual_input']['conditions']['constraint'] == 'x+y=4'
    assert revised['states']['step'] == 0


def test_cusp_singular_point_and_degenerate_regular_candidate_remain_visible():
    p = problem('x+y', 'y^2-x^3=0')
    assert any(row['kind'] == 'singular' and row['point'] == ['0','0'] for row in p['manual_input']['extrema_details']['candidates'])
    p = problem('x^4+y^2', 'y=0')
    assert p['manual_input']['result_status'] == 'unsupported'
    assert p['manual_input']['extrema_details']['candidates'][0]['classification'] == 'undetermined'


def test_exact_coefficients_and_constraint_scaling_preserve_classification():
    p = problem('(x-1/3)^2+(y-pi)^2')
    assert p['manual_input']['extrema_details']['candidates'][0]['point'] == ['1/3','pi']
    p = problem('x*y', '-2*x-2*y=-4')
    row=p['manual_input']['extrema_details']['candidates'][0]
    assert row['point'] == ['1','1'] and row['classification'] == 'maximum'


def test_unsolved_polynomial_roots_never_become_complete_empty_candidates():
    from app.labs.extrema import _finite_points, X, Y
    points, complete = _finite_points([X**5-X-1,Y],(X,Y))
    assert not complete and points == []
