import pytest
from app.labs.manual import build_manual_document, preview_integral

@pytest.mark.parametrize('expression,variable,point,expected', [('x^3','x','2',12), ('sin(x)','x','0',1), ('exp(2*x)','x','0',2), ('log(t)','t','1',1), ('x^2+3*x','x','-1',1)])
def test_manual_derivative_real_questions(expression, variable, point, expected):
    doc = build_manual_document(lab_id='test', title='', task='derivative', conditions=dict(expression=expression, variable=variable, point=point), now_iso='2026-11-13')
    p = doc['problems'][0]
    assert p['manual_input']['result_status'] == 'complete'
    assert float(p['solution']['answer']) == pytest.approx(expected)
    assert p['manual_input']['conditions']['point'] == point
    assert p['model']['expression'] == expression
    assert any(step['id'] == 'derivative' for step in p['solution']['steps'])

@pytest.mark.parametrize('expression,point', [('abs(x)','0'), ('1/x','0'), ('sqrt(x)','0'), ('x^2',''), ('x^2','nan')])
def test_manual_derivative_rejects_invalid_or_nondifferentiable(expression, point):
    with pytest.raises(ValueError):
        preview_integral('derivative', dict(expression=expression, variable='x', point=point))


def test_manual_inverse_derivative_uses_preimage_and_reciprocal_slope():
    doc = build_manual_document(lab_id='test', title='', task='inverse_derivative',
        conditions=dict(expression='x^3', variable='x', point='2'), now_iso='2026-11-13')
    p = doc['problems'][0]
    assert p['manual_input']['result_status'] == 'complete'
    assert float(p['solution']['answer']) == pytest.approx(1/(3*2**(2/3)), rel=1e-6)
    assert p['model'].get('inverse_function') is True
    assert p['manual_input']['conditions']['point'] == '2'


def test_manual_inverse_derivative_rejects_multiple_preimages():
    p = build_manual_document(lab_id='test', title='', task='inverse_derivative',
        conditions=dict(expression='x^2', variable='x', point='1'), now_iso='2026-11-13')['problems'][0]
    assert p['manual_input']['result_status'] == 'unsupported'
    assert any('原像' in note for note in p['solution'].get('limitations', []))


def test_manual_parameter_limit_solves_and_verifies_the_parameter():
    doc = build_manual_document(lab_id='test', title='', task='parameter_limit',
        conditions=dict(expression='sin(a*x)/x', variable='x', point='0', parameter='a', target_value='2'),
        now_iso='2026-11-13')
    p = doc['problems'][0]
    assert p['manual_input']['result_status'] == 'complete'
    assert p['solution']['answer'] == 'a=2'
    assert p['manual_input']['conditions']['target_value'] == '2'


def test_manual_parameter_limit_rejects_ambiguous_or_invalid_parameter():
    for conditions in [
        dict(expression='sin(a*x)/x', variable='x', point='0', parameter='x', target_value='2'),
        dict(expression='sin(a*x)/x', variable='x', point='0', parameter='e', target_value='2'),
        dict(expression='sin(x)/x', variable='x', point='0', parameter='a', target_value='2'),
    ]:
        with pytest.raises(ValueError):
            preview_integral('parameter_limit', conditions)
