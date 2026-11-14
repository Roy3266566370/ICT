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
