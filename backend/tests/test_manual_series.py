import json

import pytest
import sympy as sp

from app.labs.manual import build_manual_document, preview_integral, revise_manual_document
from app.labs.solvers import evaluate_problem


def convergence(term='(-1)^n/sqrt(n)', start='1'):
    return {'term': term, 'index_start': start}


def power(goal='radius', coefficient='1/n', center='0', start='1'):
    return {'goal': goal, 'coefficient': coefficient, 'center': center, 'index_start': start}


def fourier(expression='x', lower='-pi', upper='pi', order='3'):
    return {'expression': expression, 'lower': lower, 'upper': upper, 'order': order}


def document(task, c):
    return build_manual_document(lab_id='series', title='', task=task,
                                 conditions=c, now_iso='2026-11-14')['problems'][0]


def test_convergence_preview_requires_explicit_start_and_term():
    preview = preview_integral('series_convergence', convergence())
    assert preview['label'] == '数项级数敛散性'
    assert preview['conditions'] == {'term': '(-1)^n/sqrt(n)', 'index_start': '1'}
    assert 'n=1' in preview['latex']


@pytest.mark.parametrize('term,start,status', [
    ('(-1)^n/sqrt(n)', '1', 'conditionally_convergent'),
    ('n/(n^2+1)', '1', 'divergent'),
    ('1/(n*log(n))', '2', 'divergent'),
    ('1/n^2', '1', 'absolutely_convergent'),
])
def test_convergence_results_are_symbolic(term, start, status):
    p = document('series_convergence', convergence(term, start))
    assert p['manual_input']['result_status'] == 'complete'
    assert p['manual_input']['series_details']['status'] == status
    assert p['manual_input']['series_details']['index_start'] == int(start)
    assert p['solution']['answer']
    assert sp.simplify(sp.sympify(p['model']['term']) - sp.sympify(term)) == 0
    result = evaluate_problem(p['model'], {})
    assert result['kind'] == 'series_convergence'
    assert result['series_status'] == status


def test_undetermined_convergence_is_saved_without_fake_conclusion():
    p = document('series_convergence', convergence('sin(n)/n'))
    assert p['manual_input']['result_status'] == 'unsupported'
    assert p['manual_input']['series_details']['status'] == 'undetermined'
    assert p['solution']['solution_complete'] is False
    assert '无法判定' in p['solution']['answer']


def test_convergence_preserves_explicit_zero_start():
    p = document('series_convergence', convergence('1/2^n', '0'))
    assert p['manual_input']['series_details']['index_start'] == 0
    assert 'n=0' in p['manual_input']['latex']
    assert p['manual_input']['series_details']['status'] == 'absolutely_convergent'
    assert p['manual_input']['series_details']['sum_value'] == '2'


def test_power_series_radius_endpoints_and_interval():
    p = document('power_series', power())
    details = p['manual_input']['power_details']
    assert p['manual_input']['result_status'] == 'complete'
    assert details['radius'] == '1'
    assert details['interval'] == '[-1, 1)'
    assert details['index_start'] == 1
    assert any(item['label'] == '右端点' and item['status'] == 'divergent' for item in details['endpoints'])
    assert p['model']['coefficient'] == '1/n'
    result = evaluate_problem(p['model'], {})
    assert result['power']['interval'] == '[-1, 1)'


def test_power_series_sum_function_and_unsupported_sum():
    p = document('power_series', power(goal='sum', coefficient='1', start='0'))
    assert p['manual_input']['result_status'] == 'complete'
    assert p['manual_input']['power_details']['sum_function'] == '1/(1 - x)'

    unsupported = document('power_series', power(goal='sum', coefficient='factorial(n)', start='0'))
    assert unsupported['manual_input']['result_status'] == 'unsupported'
    assert unsupported['manual_input']['power_details']['radius'] == '0'
    assert unsupported['manual_input']['power_details']['sum_function'] is None
    assert not unsupported['solution']['answer']


def test_fourier_coefficients_and_endpoint_jump():
    p = document('fourier_series', fourier())
    details = p['manual_input']['fourier_details']
    assert p['manual_input']['result_status'] == 'complete'
    assert details['a0'] == '0'
    assert details['coefficients'][0] == {'n': 1, 'an': '0', 'bn': '2'}
    assert details['endpoint_jump'] is True
    assert 'Dirichlet' in details['convergence_note']
    assert p['model']['defaults']['lower'] == pytest.approx(-float(sp.pi))
    assert p['model']['defaults']['upper'] == pytest.approx(float(sp.pi))
    assert p['model']['defaults']['order'] == 3
    result = evaluate_problem(p['model'], {})
    assert result['kind'] == 'fourier_series'
    assert result['fourier']['a0'] == '0'


def test_fourier_requires_explicit_finite_continuous_interval():
    assert preview_integral('fourier_series', fourier())['label'] == '傅里叶级数'
    with pytest.raises(ValueError):
        preview_integral('fourier_series', fourier(expression='1/x', lower='-1'))
    with pytest.raises(ValueError):
        preview_integral('fourier_series', fourier(lower='pi', upper='-pi'))
    with pytest.raises(ValueError):
        preview_integral('fourier_series', fourier(order='0'))
    with pytest.raises(ValueError):
        preview_integral('fourier_series', fourier(lower='0') | {'extra': 'x'})


@pytest.mark.parametrize('task,c', [
    ('series_convergence', {'term': '1/n'}),
    ('series_convergence', {'term': '1/n', 'index_start': '1.5'}),
    ('series_convergence', {'term': '1/(n-1)', 'index_start': '1'}),
    ('series_convergence', {'term': 'x/n', 'index_start': '1'}),
    ('series_convergence', {'term': '1/n', 'index_start': '1', 'extra': '1'}),
    ('power_series', {'goal': 'radius', 'coefficient': '1/n', 'index_start': '1'}),
    ('power_series', {'goal': 'sum', 'coefficient': '1/n', 'center': '0'}),
    ('power_series', {'goal': 'expand', 'coefficient': '1/n', 'center': '0', 'index_start': '0'}),
    ('power_series', {'goal': 'radius', 'coefficient': '1/n', 'center': 'x', 'index_start': '1'}),
    ('power_series', {'goal': 'radius', 'coefficient': '1/n', 'center': '0', 'index_start': '0'}),
])
def test_invalid_series_conditions_are_rejected_without_defaults(task, c):
    with pytest.raises(ValueError):
        preview_integral(task, c)


def test_review_rebuilds_series_with_new_conditions():
    document_data = build_manual_document(lab_id='series', title='', task='series_convergence',
                                          conditions=convergence('1/n^2'), now_iso='2026-11-14')
    problem = document_data['problems'][0]
    revised = revise_manual_document(document_data, problem,
                                     {'term': '1/n', 'index_start': '1'})
    assert revised['manual_input']['series_details']['status'] == 'divergent'
    assert revised['manual_input']['result_status'] == 'complete'
    assert revised['manual_input']['conditions']['term'] == '1/n'


def test_conditional_convergence_from_later_start_and_power_left_endpoint():
    p = document('series_convergence', convergence('(-1)^n/(n-2)', '3'))
    assert p['manual_input']['result_status'] == 'complete'
    assert p['manual_input']['series_details']['status'] == 'conditionally_convergent'
    assert 'Leibniz' in p['manual_input']['series_details']['method']

    power_document = document('power_series', power(coefficient='1/(n-2)', start='3'))
    details = power_document['manual_input']['power_details']
    assert details['interval'] == '[-1, 1)'
    left = next(item for item in details['endpoints'] if item['label'] == '左端点')
    assert left['status'] == 'conditionally_convergent'
    assert left['included'] is True


def test_tail_undefined_terms_are_rejected_before_classification():
    with pytest.raises(ValueError, match='n=3'):
        preview_integral('series_convergence', convergence('1/(n-3)^2', '1'))
    with pytest.raises(ValueError, match='有限实数'):
        preview_integral('series_convergence', convergence('1/(n*log(n))', '1'))
    with pytest.raises(ValueError, match='无定义'):
        preview_integral('power_series', power(coefficient='1/(n-2)', start='1'))
    assert preview_integral('series_convergence', convergence('1/(n*log(n))', '2'))['label'] == '数项级数敛散性'


def test_tiny_coefficient_ratio_is_not_treated_as_infinite_radius():
    p = document('power_series', power(coefficient='10^(-13*n)', start='0'))
    assert p['manual_input']['result_status'] == 'complete'
    assert p['manual_input']['power_details']['radius'] == '10000000000000'


def test_manual_series_documents_are_json_serializable():
    payload = [document('series_convergence', convergence()),
               document('power_series', power(goal='sum', coefficient='1', start='0')),
               document('fourier_series', fourier())]
    json.dumps(payload, ensure_ascii=False, allow_nan=False)


def test_alternating_series_with_negative_initial_terms_is_conditionally_convergent():
    p = document('series_convergence', convergence('(-1)^n*(n-2)/n^2', '1'))
    details = p['manual_input']['series_details']
    assert p['manual_input']['result_status'] == 'complete'
    assert details['status'] == 'conditionally_convergent'
    assert details['status_label'] == '条件收敛'
    assert 'Leibniz' in details['method']
    assert '从 n=4 起' in details['method']
    assert '条件收敛' in p['solution']['answer']
    assert '发散' not in p['solution']['answer']
    assert details['sum_value'] == '-log(2) + pi**2/6'
    result = evaluate_problem(p['model'], {})
    assert result['series_status'] == 'conditionally_convergent'


def test_divergent_series_does_not_report_a_finite_sum():
    p = document('series_convergence', convergence('n/(n+1)', '1'))
    details = p['manual_input']['series_details']
    assert details['status'] == 'divergent'
    assert details['sum_value'] is None
    assert '发散' in p['solution']['answer']
    assert '和为' not in p['solution']['answer']


def test_fourier_rejects_expression_without_real_domain_on_interval():
    with pytest.raises(ValueError, match='实定义'):
        preview_integral('fourier_series', fourier(expression='sqrt(x)^2', lower='-1', upper='0'))
    p = document('fourier_series', fourier(expression='sqrt(x)^2', lower='0', upper='1'))
    assert p['manual_input']['result_status'] == 'complete'
