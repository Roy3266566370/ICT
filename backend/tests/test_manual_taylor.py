import pytest
import sympy as sp
from app.labs.manual import build_manual_document
from app.labs.solvers import evaluate_problem

def build(expression,point='0',order='3',variable='x'):
    return build_manual_document(lab_id='t',title='',task='taylor',conditions=dict(expression=expression,variable=variable,point=point,order=order),now_iso='2026-11-13')['problems'][0]

@pytest.mark.parametrize('expression,point,order,coefficients', [
 ('exp(x)','0','3',['1','1','1/2','1/6']),
 ('sin(x)','pi','3',['0','-1','0','1/6']),
 ('x^2','1/3','2',['1/9','2/3','1']),
 ('log(x)','1','3',['0','1','-1/2','1/3']),
 ('sin(t)','pi/2','2',['1','0','-1/2']),
])
def test_exact_points_and_coefficients(expression,point,order,coefficients):
    p=build(expression,point,order,'t' if 't' in expression and expression!='exp(x)' else 'x')
    assert p['manual_input']['result_status']=='complete',p['solution']
    data=p['manual_input']['taylor_details']
    assert data['point']==point
    assert [c['value'] for c in data['coefficients']]==coefficients
    assert p['manual_input']['conditions']['point']==point
    result=evaluate_problem(p['model'],p['model']['defaults'])
    assert result['taylor']['coefficients']==pytest.approx([float(sp.sympify(c)) for c in coefficients])

def test_remainder_is_not_always_next_big_o():
    p=build('abs(x)^(5/2)','0','2')
    assert p['manual_input']['result_status']=='complete',p['solution']
    assert p['manual_input']['taylor_details']['remainder_kind']=='little_o'
    assert p['manual_input']['taylor_details']['error_bound'] is None

def test_exact_polynomial_and_local_error_bound():
    assert build('x^2','1/3','3')['manual_input']['taylor_details']['remainder_kind']=='exact'
    p=build('log(x)','1','2')
    d=p['manual_input']['taylor_details']
    assert sp.sympify(d['window_lower'])>0
    assert d['error_bound'] is not None
    assert '不等于' in d['range_note']

@pytest.mark.parametrize('expression,point', [('sin(x)/x','0'), ('log(x)','0'), ('sqrt(x)','0'), ('abs(x)','0'), ('-x^2*(x/x)','0')])
def test_no_filled_holes_or_nondifferentiable_point(expression,point):
    p=build(expression,point,'2')
    assert p['manual_input']['result_status']=='unsupported'

@pytest.mark.parametrize('point,order', [('', '3'),('x','3'),('0','0'),('0','11')])
def test_invalid_fields(point,order):
    with pytest.raises(ValueError):build('exp(x)',point,order)

def test_lagrange_bound_controls_actual_errors_in_reported_window():
    p=build('exp(x)','0','3')
    d=p['manual_input']['taylor_details']
    bound=float(sp.sympify(d['error_bound']))
    x=sp.Symbol('x',real=True)
    polynomial=sum(sp.sympify(c['value'])*x**c['order'] for c in d['coefficients'])
    for point in [-1,-sp.Rational(1,2),sp.Rational(1,2),1]:
        assert float(abs(sp.exp(point)-polynomial.subs(x,point)))<=bound

def test_exact_point_and_coefficients_survive_revision_and_exploration():
    from app.labs.manual import revise_manual_document
    d=build_manual_document(lab_id='t',title='',task='taylor',conditions=dict(expression='sin(x)',variable='x',point='pi',order='3'),now_iso='2026-11-13')
    original=d['problems'][0]
    evaluated=evaluate_problem(original['model'],{**original['model']['defaults'],'order':2})
    assert evaluated['taylor']['coefficients']==pytest.approx([0,-1,0])
    revised=revise_manual_document(d,original,{'point':'pi/2','order':'2'})
    assert [c['value'] for c in revised['manual_input']['taylor_details']['coefficients']]==['1','0','-1/2']
    assert original['manual_input']['taylor_details']['point']=='pi'
