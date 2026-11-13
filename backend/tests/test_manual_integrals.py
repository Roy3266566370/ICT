import copy

import pytest
import sympy as sp


def preview(task='integral', **conditions):
    from app.labs.manual import preview_integral
    return preview_integral(task, conditions)


def test_preview_validates_and_formats_without_running_kernel(monkeypatch):
    import app.labs.kernel_models as kernels
    monkeypatch.setattr(kernels, 'compile_kernel_problem', lambda *_: pytest.fail('预览不应计算'))
    result = preview(expression='sin(x)', variable='x', lower='0', upper='pi')
    assert result['conditions']['upper'] == 'pi'
    assert r'\pi' in result['latex']
    assert result['task'] == 'integral'


@pytest.mark.parametrize('task,conditions', [
    ('integral', {'expression':'x^2','variable':'x','upper':'2'}),
    ('integral', {'expression':'x^2','variable':'x','lower':'x','upper':'2'}),
    ('integral', {'expression':'x^2','variable':'x','lower':'0','upper':'oo'}),
    ('integral', {'expression':'y^2','variable':'x','lower':'0','upper':'2'}),
    ('integral', {'expression':'sin(','variable':'x','lower':'0','upper':'2'}),
    ('antiderivative', {'expression':'x','variable':'x','lower':'0','upper':'1'}),
    ('limit', {'expression':'x','variable':'x'}),
])
def test_invalid_or_unconsumed_conditions_are_rejected(task, conditions):
    from app.labs.manual import preview_integral
    with pytest.raises(ValueError):
        preview_integral(task, conditions)


@pytest.mark.parametrize('conditions,expected', [
    ({'expression':'x^2','variable':'x','lower':'0','upper':'2'}, sp.Rational(8,3)),
    ({'expression':'sin(x)','variable':'x','lower':'0','upper':'pi'}, sp.Integer(2)),
    ({'expression':'t','variable':'t','lower':'1/3','upper':'2/3'}, sp.Rational(1,6)),
    ({'expression':'x','variable':'x','lower':'2','upper':'0'}, sp.Integer(-2)),
])
def test_confirmed_input_reaches_kernel_and_preserves_exact_bounds(conditions, expected):
    from app.labs.manual import build_manual_document
    original = copy.deepcopy(conditions)
    doc = build_manual_document(lab_id='lab_manual', title='', task='integral', conditions=conditions, now_iso='2026-11-13T00:00:00Z')
    p = doc['problems'][0]
    assert conditions == original
    assert sp.simplify(sp.sympify(p['solution']['exact']) - expected) == 0
    assert p['model']['engine'] == 'riemann_v1'
    assert p['manual_input']['confirmed'] is True
    assert p['states']['scenarios'][0]['params'] == p['model']['defaults']
    assert p['status'] == 'ready'
    assert not p['model']['teaching']
    assert not any(c['provenance'] == 'teaching' for c in p['recognition']['conditions'])


def test_antiderivative_keeps_constant_and_verification_without_inventing_bounds():
    from app.labs.manual import build_manual_document
    d = build_manual_document(lab_id='lab_manual', title='', task='antiderivative',
        conditions={'expression':'x*cos(x)','variable':'x'}, now_iso='2026-11-13T00:00:00Z')
    p = d['problems'][0]
    assert p['model']['engine'] == 'antiderivative_v1'
    assert '+C' in p['solution']['answer']
    assert any(s['id'] == 'verify' for s in p['solution']['steps'])
    assert 'lower' not in p['model']['defaults']
    assert 'upper' not in p['manual_input']['conditions']


def test_reversed_integral_evaluation_matches_signed_exact_answer():
    from app.labs.manual import build_manual_document
    from app.labs.solvers import evaluate_problem
    d = build_manual_document(lab_id='t', title='', task='integral',
        conditions={'expression':'x','variable':'x','lower':'2','upper':'0'}, now_iso='now')
    p = d['problems'][0]
    r = evaluate_problem(p['model'], p['model']['defaults'])
    assert r['exact'] == -2
    assert r['approx'] == -2


@pytest.mark.parametrize('expression', ['log(x)-log(x)', 'sqrt(x)^2'])
def test_original_domain_cannot_be_lost_by_preview_simplification(expression):
    with pytest.raises(ValueError, match='定义域'):
        preview(expression=expression, variable='x', lower='-1', upper='1')


def test_original_formula_is_preserved_in_preview_when_domain_is_valid():
    p = preview(expression='sqrt(x)^2', variable='x', lower='0', upper='1')
    assert p['conditions']['expression'] == 'sqrt(x)^2'


def test_exact_domain_boundary_is_preserved_in_saved_evaluation():
    from app.labs.manual import build_manual_document
    from app.labs.solvers import evaluate_problem
    d = build_manual_document(lab_id='t', title='', task='integral',
        conditions={'expression':'sqrt(x-1/3)','variable':'x','lower':'1/3','upper':'1'}, now_iso='now')
    p = d['problems'][0]
    r = evaluate_problem(p['model'], p['model']['defaults'])
    assert r['exact'] == pytest.approx(float(4*sp.sqrt(6)/27))


def test_changed_interval_still_uses_original_function_domain():
    from app.labs.manual import build_manual_document
    from app.labs.solvers import evaluate_problem
    d = build_manual_document(lab_id='t', title='', task='integral',
        conditions={'expression':'sqrt(x)^2','variable':'x','lower':'0','upper':'1'}, now_iso='now')
    p = d['problems'][0]
    assert p['model']['expression'] == 'sqrt(x)^2'
    r = evaluate_problem(p['model'], {**p['model']['defaults'], 'lower':-1})
    assert r['exact'] is None
