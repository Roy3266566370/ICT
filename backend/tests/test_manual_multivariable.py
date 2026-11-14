import pytest
import sympy as sp
from app.labs.manual import build_manual_document, revise_manual_document

def document(expression,operation='partial',variables='x,y',point=None,partial='x',direction='3,4',convention='forward'):
    c=dict(expression=expression,operation=operation,variables=variables)
    if point is not None:c['point']=point
    if operation=='partial':c['partial_variable']=partial
    if operation=='directional':c.update(direction=direction,direction_limit=convention)
    return build_manual_document(lab_id='t',title='',task='multivariable',conditions=c,now_iso='2026-11-13')

def details(*args,**kwargs):
    p=document(*args,**kwargs)['problems'][0]
    assert p['manual_input']['result_status']=='complete',p['solution']
    return p['manual_input']['multi_details']

@pytest.mark.parametrize('expression,partial,point,value', [('x^2*y+sin(y)','x','1,pi/2','pi'),('exp(x*y)','y','1,0','1'),('x^2+y^2','x',None,None),('abs(x)+y^2','y','0,0','0')])
def test_partial_definitions(expression,partial,point,value):
    d=details(expression,partial=partial,point=point)
    assert d['partials'][0]['value']==value

def test_symbolic_gradient_and_total_differential():
    d=details('x^2*y+sin(y)','gradient')
    assert [p['expression'] for p in d['partials']]==['2*x*y','x^2 + cos(y)']
    d=details('x^2+y^2','differential',point='1,2')
    assert d['differentiability']=='sufficient_c1'
    assert [p['value'] for p in d['partials']]==['2','4']

def test_three_variables_and_exact_coordinates():
    d=details('x*y+z^2','gradient',variables='x,y,z',point='1/3,2,pi')
    assert [p['value'] for p in d['partials']]==['2','1/3','2*pi']

@pytest.mark.parametrize('direction,value', [('3,4','22/5'),('6,8','22/5'),('-3,-4','-22/5')])
def test_normalized_direction_not_velocity(direction,value):
    d=details('x^2+y^2','directional',point='1,2',direction=direction)
    assert value in d['result_latex'] or sp.simplify(sp.sympify(document('x^2+y^2','directional',point='1,2',direction=direction)['problems'][0]['solution']['exact'])-sp.sympify(value))==0
    assert d['method']=='gradient'

def test_partial_existence_does_not_authorize_gradient_formula():
    expression='sqrt(abs(x*y))'
    d=details(expression,'gradient',point='0,0')
    assert [p['value'] for p in d['partials']]==['0','0']
    assert d['differentiability']=='unconfirmed'
    p=document(expression,'differential',point='0,0')['problems'][0]
    assert p['manual_input']['result_status']=='unsupported'
    d=details(expression,'directional',point='0,0',direction='1,1')
    assert d['method']=='definition'
    p=document(expression,'directional',point='0,0',direction='1,1')['problems'][0]
    assert sp.simplify(sp.sympify(p['solution']['exact'])-sp.sqrt(2)/2)==0

def test_direction_conventions_at_nonsmooth_point_are_distinct():
    d=details('abs(x)','directional',point='0,0',direction='1,0',convention='forward')
    assert d['method']=='definition'
    p=document('abs(x)','directional',point='0,0',direction='1,0',convention='two_sided')['problems'][0]
    assert p['manual_input']['result_status']=='unsupported'

@pytest.mark.parametrize('expression,point', [('x/x+y','0,1'),('log(x)+y','0,1'),('sqrt(x)+y','-1,0')])
def test_original_domain_not_filled(expression,point):
    p=document(expression,'gradient',point=point)['problems'][0]
    assert p['manual_input']['result_status']=='unsupported'

@pytest.mark.parametrize('point,direction', [('1','3,4'),('1,2','0,0'),('1,2','1'),('1,2,3','1,2')])
def test_incomplete_or_zero_vectors_rejected(point,direction):
    with pytest.raises(ValueError):document('x+y','directional',point=point,direction=direction)

def test_three_dimensional_direction():
    p=document('x*y+z^2','directional',variables='x,y,z',point='1,2,3',direction='0,0,2')['problems'][0]
    assert p['solution']['exact']=='6'

def test_revision_preserves_direction_and_can_clear_optional_point():
    d=document('x^2+y^2','gradient',point='1,2')
    p=revise_manual_document(d,d['problems'][0],{'point':''})
    assert 'point' not in p['manual_input']['conditions']
    assert p['manual_input']['multi_details']['point'] is None
    d=document('x^2+y^2','directional',point='1,2',direction='3,4')
    p=revise_manual_document(d,d['problems'][0],{'direction':'-3,-4'})
    assert p['solution']['exact']=='-22/5'

def test_unknown_fields_and_missing_definition_are_not_ignored():
    from app.labs.manual import preview_integral
    with pytest.raises(ValueError):preview_integral('multivariable',dict(expression='x+y',variables='x,y',operation='gradient',direction='1,0'))
    with pytest.raises(ValueError):preview_integral('multivariable',dict(expression='x+y',variables='x,y',operation='directional',point='0,0',direction='1,0'))

def test_gradient_requires_all_partial_derivatives():
    p=document('abs(x)+y^2','gradient',point='0,0')['problems'][0]
    assert p['manual_input']['result_status']=='unsupported'
