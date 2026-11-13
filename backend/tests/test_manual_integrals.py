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


@pytest.mark.parametrize('expression,lower,upper,expected', [
    ('abs(x)', '-1', '1', sp.Integer(1)),
    ('abs(sin(x))', '0', '2*pi', sp.Integer(4)),
    ('sqrt(x^2)', '-1', '1', sp.Integer(1)),
    ('abs(x^2-1)', '0', '2', sp.Integer(2)),
])
def test_piecewise_smooth_integrands_are_computed(expression, lower, upper, expected):
    from app.labs.manual import build_manual_document
    d = build_manual_document(lab_id='t', title='', task='integral',
        conditions={'expression':expression,'variable':'x','lower':lower,'upper':upper}, now_iso='now')
    p = d['problems'][0]
    assert p['manual_input']['result_status'] == 'complete'
    assert sp.simplify(sp.sympify(p['solution']['exact']) - expected) == 0


@pytest.mark.parametrize('conditions,expected', [
    ({'expression':'exp(x)','variable':'x','lower':'0','upper':'1'}, sp.E - 1),
    ({'expression':'sin(x)/x','variable':'x','lower':'0','upper':'1'}, sp.Si(1)),
    ({'expression':'exp(-x^2)','variable':'x','lower':'0','upper':'1'},
     sp.sqrt(sp.pi)*sp.erf(1)/2),
])
def test_special_function_results_are_kept_as_latex(conditions, expected):
    from app.labs.manual import build_manual_document
    d = build_manual_document(lab_id='t', title='', task='integral', conditions=conditions, now_iso='now')
    p = d['problems'][0]
    assert p['manual_input']['result_status'] == 'complete'
    assert p['manual_input']['result_latex']
    assert sp.simplify(sp.sympify(p['solution']['exact']) - expected) == 0


def test_preserved_structure_latex_has_no_stray_one_factor():
    reciprocal = preview(expression='1/(1+x^2)', variable='x', lower='0', upper='1')
    assert r'\frac{1}{x^{2} + 1}' in reciprocal['latex']
    assert '1 \\frac' not in reciprocal['latex']
    nested = preview(expression='1+1/x', variable='x', lower='1', upper='2')
    assert '1 \\frac' not in nested['latex']
    squared_root = preview(expression='sqrt(x)^2', variable='x', lower='0', upper='1')
    assert r'\left(\sqrt{x}\right)^{2}' in squared_root['latex']


def test_decimal_bounds_are_normalized_to_exact_fractions():
    from app.labs.manual import build_manual_document
    conditions = {'expression':'1/(1+x^2)','variable':'x','lower':'0.5','upper':'1.5'}
    p = preview(**conditions)
    assert p['conditions']['lower'] == '1/2'
    assert p['conditions']['upper'] == '3/2'
    d = build_manual_document(lab_id='t', title='', task='integral', conditions=conditions, now_iso='now')
    solution = d['problems'][0]['solution']
    exact = sp.sympify(solution['exact'])
    assert not exact.atoms(sp.Float)
    assert sp.simplify(exact - (sp.atan(sp.Rational(3, 2)) - sp.atan(sp.Rational(1, 2)))) == 0


@pytest.mark.parametrize('expression,lower,upper,expected', [
    ('1/sqrt(x)', '0', '1', sp.Integer(2)),
    ('1/sqrt(1-x^2)', '-1', '1', sp.pi),
    ('log(x)', '1', 'e', sp.Integer(1)),
    ('x*exp(-x)', '0', '1', 1 - 2*sp.exp(-1)),
])
def test_convergent_endpoint_singularities_are_not_rejected(expression, lower, upper, expected):
    from app.labs.manual import build_manual_document
    d = build_manual_document(lab_id='t', title='', task='integral',
        conditions={'expression':expression,'variable':'x','lower':lower,'upper':upper}, now_iso='now')
    p = d['problems'][0]
    assert p['manual_input']['result_status'] == 'complete'
    assert sp.simplify(sp.sympify(p['solution']['exact']) - expected) == 0


@pytest.mark.parametrize('conditions', [
    {'expression':'1/x','variable':'x','lower':'-1','upper':'1'},
    {'expression':'tan(x)','variable':'x','lower':'0','upper':'pi/2'},
    {'expression':'1/x^2','variable':'x','lower':'0','upper':'1'},
])
def test_divergent_integral_is_reported_as_result_not_missing_condition(conditions):
    from app.labs.manual import build_manual_document
    d = build_manual_document(lab_id='t', title='', task='integral', conditions=conditions, now_iso='now')
    p = d['problems'][0]
    assert p['status'] == 'ready'
    assert p['solution']['solution_status'] == 'divergent'
    assert p['manual_input']['result_status'] == 'divergent'
    assert '发散' in p['manual_input']['result_note']
    assert p['manual_input']['result_answer'] == '发散（积分不存在）'
    assert not any(item['id'] == 'solution_incomplete' for item in p['recognition']['ambiguities'])


@pytest.mark.parametrize('conditions', [
    {'expression':'sin(1/x)','variable':'x','lower':'0','upper':'1'},
    {'expression':'x^x','variable':'x','lower':'1','upper':'2'},
    {'expression':'exp(cos(x))','variable':'x','lower':'0','upper':'pi'},
])
def test_unfinished_integral_is_explicitly_unsupported(conditions):
    from app.labs.manual import build_manual_document
    d = build_manual_document(lab_id='t', title='', task='integral', conditions=conditions, now_iso='now')
    p = d['problems'][0]
    assert p['status'] == 'unsupported'
    assert p['manual_input']['result_status'] == 'unsupported'
    assert p['manual_input']['result_latex'] == ''
    assert p['solution']['answer'] == ''
    assert p['manual_input']['result_note']
    assert not any(item['id'] == 'solution_incomplete' for item in p['recognition']['ambiguities'])


@pytest.mark.parametrize('expression', ['tan(x)', 'sec(x)^2', 'cot(x)', 'csc(x)'])
def test_periodic_domain_does_not_block_antiderivative(expression):
    from app.labs.manual import build_manual_document
    result = preview(task='antiderivative', expression=expression, variable='x')
    assert result['task'] == 'antiderivative'
    d = build_manual_document(lab_id='t', title='', task='antiderivative',
        conditions={'expression':expression,'variable':'x'}, now_iso='now')
    p = d['problems'][0]
    assert p['status'] == 'ready'
    assert p['solution']['solution_status'] == 'complete'
    assert p['solution']['solution_complete'] is True
    assert '+C' in p['solution']['answer']
    assert any(step['id'] == 'verify' for step in p['solution']['steps'])


@pytest.mark.parametrize('expression,step_title', [
    ('x^x', '尝试求原函数（未完成）'),
    ('sin(1/x)', '尝试求原函数（未通过核验）'),
])
def test_unfinished_antiderivative_is_explicitly_unsupported(expression, step_title):
    from app.labs.manual import build_manual_document
    d = build_manual_document(lab_id='t', title='', task='antiderivative',
        conditions={'expression':expression,'variable':'x'}, now_iso='now')
    p = d['problems'][0]
    assert p['status'] == 'unsupported'
    assert p['solution']['solution_status'] == 'unsupported'
    assert p['solution']['solution_complete'] is False
    assert p['solution']['answer'] == ''
    assert p['solution']['exact_latex'] is None
    assert p['manual_input']['result_status'] == 'unsupported'
    assert p['manual_input']['result_latex'] == ''
    assert p['manual_input']['result_answer'] == ''
    assert p['manual_input']['result_note']
    assert p['model'].get('antiderivative_expression') is None
    assert p['manual_input']['verification']['level'] == 'unconfirmed'
    assert p['manual_input']['verification']['label'] == '尚未确认'
    assert any(step['title'] == step_title for step in p['solution']['steps'])
    assert not any(step['id'] == 'verify' for step in p['solution']['steps'])
    assert not any(item['id'] == 'solution_incomplete' for item in p['recognition']['ambiguities'])


def test_verified_special_function_antiderivative_stays_complete():
    from app.labs.manual import build_manual_document
    problem = build_manual_document(lab_id='t', title='', task='antiderivative',
        conditions={'expression':'sin(x)/x','variable':'x'}, now_iso='now')['problems'][0]
    assert problem['status'] == 'ready'
    assert problem['solution']['solution_status'] == 'complete'
    assert problem['solution']['answer'] == 'F(x)=Si(x)+C'
    assert problem['solution']['verification']['level'] == 'symbolic'
    assert any(step['id'] == 'verify' for step in problem['solution']['steps'])


def test_antiderivative_verification_levels_are_exposed_with_honest_labels():
    from app.labs.manual import build_manual_document
    symbolic = build_manual_document(lab_id='t', title='', task='antiderivative',
        conditions={'expression':'x*cos(x^2)','variable':'x'}, now_iso='now')['problems'][0]
    assert symbolic['manual_input']['verification']['level'] == 'symbolic'
    assert symbolic['manual_input']['verification']['label'] == '符号求导核验通过'
    assert symbolic['solution']['verification'] == symbolic['manual_input']['verification']
    verify_step = next(step for step in symbolic['solution']['steps'] if step['id'] == 'verify')
    assert verify_step['title'] == '符号求导核对'

    numeric = build_manual_document(lab_id='t', title='', task='antiderivative',
        conditions={'expression':'1/(x*log(x))','variable':'x'}, now_iso='now')['problems'][0]
    assert numeric['manual_input']['verification']['level'] == 'numeric'
    assert numeric['manual_input']['verification']['label'] == '数值抽查通过（非全域证明）'
    verify_step = next(step for step in numeric['solution']['steps'] if step['id'] == 'verify')
    assert verify_step['title'] == '数值抽查核对'
    assert '不是全域证明' in verify_step['detail']
    assert any('数值抽查' in condition and '不是全域证明' in condition
               for condition in numeric['solution']['conditions'])

    unconfirmed = build_manual_document(lab_id='t', title='', task='antiderivative',
        conditions={'expression':'x^x','variable':'x'}, now_iso='now')['problems'][0]
    assert unconfirmed['manual_input']['verification']['level'] == 'unconfirmed'
    assert unconfirmed['manual_input']['verification']['label'] == '尚未确认'


def test_verified_substitution_and_parts_steps_are_present():
    from app.labs.manual import build_manual_document
    substituted = build_manual_document(lab_id='t', title='', task='antiderivative',
        conditions={'expression':'x*cos(x^2)','variable':'x'}, now_iso='now')['problems'][0]
    assert [step['id'] for step in substituted['solution']['steps'] if step['id'].startswith('method-')] == [
        'method-substitution',
        'method-substitution-integrate',
        'method-substitution-back',
    ]
    assert substituted['solution']['answer'] == 'F(x)=sin(x^2)/2+C'

    parts = build_manual_document(lab_id='t', title='', task='antiderivative',
        conditions={'expression':'x^2*exp(-x)','variable':'x'}, now_iso='now')['problems'][0]
    assert [step['id'] for step in parts['solution']['steps'] if step['id'].startswith('method-')] == [
        'method-parts-choose',
        'method-parts-duv',
        'method-parts-formula',
        'method-parts-finish',
    ]
    assert parts['solution']['steps'][1]['id'] == 'method-parts-choose'
    assert sp.simplify(sp.sympify(parts['solution']['answer'].split('=', 1)[1].replace('+C', ''))
                       - sp.integrate(sp.exp(-sp.Symbol('x'))*sp.Symbol('x')**2, sp.Symbol('x'))) == 0


def test_undefined_method_search_does_not_block_supported_integral():
    from app.labs.manual import build_manual_document
    problem = build_manual_document(lab_id='t', title='', task='integral',
        conditions={'expression':'sin(x)/x','variable':'x','lower':'0','upper':'1'},
        now_iso='now')['problems'][0]
    assert problem['status'] == 'ready'
    assert problem['solution']['solution_status'] == 'complete'
    assert not any(step['id'].startswith('method-') for step in problem['solution']['steps'])


def test_real_log_antiderivative_is_shown_and_reused_by_graph():
    from app.labs.manual import build_manual_document
    from app.labs.solvers import evaluate_problem
    problem = build_manual_document(lab_id='t', title='', task='antiderivative',
        conditions={'expression':'1/x','variable':'x'}, now_iso='now')['problems'][0]
    assert 'Abs' in problem['solution']['answer']
    assert any('log|·|' in condition for condition in problem['solution']['conditions'])
    evaluation = evaluate_problem(problem['model'], {'c': 0.0})
    assert evaluation['headline'].endswith('log(Abs(x))+C')
    values = [point['y'] for point in evaluation['series']]
    assert values and all(value is not None for value in values)


def test_nested_log_antiderivative_keeps_absolute_value_condition():
    from app.labs.manual import build_manual_document
    problem = build_manual_document(lab_id='t', title='', task='antiderivative',
        conditions={'expression':'1/(x*log(x))','variable':'x'}, now_iso='now')['problems'][0]
    assert problem['solution']['answer'] == 'F(x)=log(Abs(log(x)))+C'
    assert any('log|·|' in condition for condition in problem['solution']['conditions'])


def test_special_function_antiderivative_drives_graph_and_constant_shift():
    from app.labs.manual import build_manual_document
    from app.labs.solvers import evaluate_problem
    problem = build_manual_document(lab_id='t', title='', task='antiderivative',
        conditions={'expression':'sin(x)/x','variable':'x'}, now_iso='now')['problems'][0]
    defaults = problem['model']['defaults']
    base = evaluate_problem(problem['model'], {**defaults, 'c': 0.0})
    shifted = evaluate_problem(problem['model'], {**defaults, 'c': 5.0})
    assert base['headline'].endswith('Si(x)+C')
    overlapping = [
        right['y'] - left['y']
        for left, right in zip(base['series'], shifted['series'])
        if left['y'] is not None and right['y'] is not None
    ]
    assert len(overlapping) >= 20
    assert all(abs(value - 5.0) < 1e-6 for value in overlapping)
