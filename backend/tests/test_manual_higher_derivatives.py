import pytest
from app.labs.manual import build_manual_document, preview_integral
from app.labs.solvers import evaluate_problem

def build(expression, order='1', point=None, variable='x'):
    c=dict(expression=expression,variable=variable,order=order)
    if point is not None: c['point']=point
    return build_manual_document(lab_id='test',title='',task='higher_derivative',conditions=c,now_iso='2026-11-13')['problems'][0]

@pytest.mark.parametrize('expression,order,expected', [('x^3','1','3*x^2'), ('sin(x)','1','cos(x)'), ('x^4','2','12*x^2'), ('exp(2*x)','3','8*exp(2*x)'), ('x^2','3','0')])
def test_derivative_functions_without_hidden_point(expression,order,expected):
    p=build(expression,order)
    assert p['manual_input']['result_status']=='complete'
    assert p['solution']['exact']==expected
    assert 'point' not in p['manual_input']['conditions']
    assert 'derivative_point' not in p['model']
    assert evaluate_problem(p['model'],p['model']['defaults'])['kind']=='higher_derivative'

@pytest.mark.parametrize('expression,order,point,expected', [('x^3','2','1/3','2'), ('sin(x)','2','pi/2','-1'), ('log(t)','1','1','1')])
def test_optional_exact_point(expression,order,point,expected):
    p=build(expression,order,point,'t' if 't' in expression else 'x')
    assert p['manual_input']['result_status']=='complete'
    assert p['manual_input']['result_latex']==expected
    assert p['manual_input']['conditions']['point']==point

@pytest.mark.parametrize('order', ['', '0','11','1.5','bad'])
def test_invalid_order(order):
    with pytest.raises(ValueError): build('x^2',order)

@pytest.mark.parametrize('expression,order,point', [('abs(x)','1','0'), ('abs(x)','2',None), ('1/x','2','0'), ('(x^2-1)/(x-1)','1','1')])
def test_no_fake_derivative_at_invalid_point(expression,order,point):
    p=build(expression,order,point)
    assert p['manual_input']['result_status']=='unsupported'

def test_revision_preserves_order_and_does_not_invent_point():
    from app.labs.manual import revise_manual_document
    d=build_manual_document(lab_id='test',title='',task='higher_derivative',conditions=dict(expression='x^4',variable='x',order='1'),now_iso='2026-11-13')
    p=revise_manual_document(d,d['problems'][0],{'order':'2'})
    assert p['solution']['exact']=='12*x^2'
    assert 'point' not in p['manual_input']['conditions']

def test_optional_point_evaluation_keeps_exact_pi_and_can_change_order():
    p=build('sin(x)','2','pi/2')
    result=evaluate_problem(p['model'],p['model']['defaults'])
    assert result['kind']=='higher_derivative'
    assert p['manual_input']['result_latex']=='-1'
    changed=evaluate_problem(p['model'],{**p['model']['defaults'],'order':1})
    assert changed['kind']=='higher_derivative'
    assert p['solution']['derivative_order']==2
