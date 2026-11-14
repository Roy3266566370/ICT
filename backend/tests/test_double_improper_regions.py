import math
import pytest
from app.labs.manual import build_manual_document, preview_integral, revise_manual_document
from app.labs.solvers import evaluate_problem


def polar(f='exp(-x^2-y^2)',rlo='0',rhi='oo',a='0',b='2*pi'):
    return dict(integrand=f,region_mode='polar_improper',theta_lower=a,theta_upper=b,radius_lower=rlo,radius_upper=rhi)


def strip(f='1/(x+y)',lo='0',hi='x'):
    return dict(integrand=f,region_mode='strip_improper',outer_variable='x',outer_lower='0',outer_upper='1',inner_lower=lo,inner_upper=hi)


def document(c):
    return build_manual_document(lab_id='improper-regions',title='',task='double_integral',conditions=c,now_iso='2026-11-14')


@pytest.mark.parametrize('c,value',[
    (polar(),math.pi),
    (polar(a='0',b='pi/2'),math.pi/4),
    (polar('1/sqrt(x^2+y^2)',rhi='1'),2*math.pi),
    (polar('1/(x^2+y^2)^2',rlo='1'),math.pi),
    (strip(),math.log(2)),
    (strip('1/sqrt(y)'),4/3),
    (strip(hi='1'),2*math.log(2)),
    (strip('-1/(x+y)',hi='1'),-2*math.log(2)),
    (strip('x-y',hi='1'),0),
])
def test_transformed_improper_regions_complete_with_exact_value(c,value):
    p=document(c)['problems'][0]
    assert p['manual_input']['result_status']=='complete',p['solution']
    assert p['solution']['answer_value']==pytest.approx(value)
    assert p['manual_input']['conditions']==c
    assert p['model']['params']==[]
    assert p['manual_input']['double_extension']['kind']==c['region_mode']
    result=evaluate_problem(p['model'],{})
    assert result['exact']==pytest.approx(value)
    assert result['approx'] is None and result['rects']==[]


@pytest.mark.parametrize('c',[polar('1/(x^2+y^2)',rhi='1'),strip('1/(x-y)'),strip('1/(x+y)^2')])
def test_divergence_is_not_a_finite_truncated_value(c):
    p=document(c)['problems'][0]
    assert p['manual_input']['result_status']=='divergent',p['solution']
    assert p['solution']['answer_value'] is None


@pytest.mark.parametrize('patch',[{'theta_upper':'4*pi'},{'radius_lower':'-1'},{'radius_upper':'theta'},{'swap_order':'true'},{'extra_constraint':'x>0'}])
def test_polar_improper_rejects_unconfirmed_or_invalid_conditions(patch):
    with pytest.raises(ValueError):preview_integral('double_integral',{**polar(),**patch})


def test_nonreal_original_subexpressions_do_not_cancel_into_an_answer():
    p=document(polar('sqrt(-x)*sqrt(-x)',rhi='1',b='pi/2'))['problems'][0]
    assert p['manual_input']['result_status']=='unsupported'
    assert not p['solution']['answer']


def test_review_rebuilds_radial_bound_and_resets_state():
    doc=document(polar('1/sqrt(x^2+y^2)',rhi='1'));p=doc['problems'][0]
    revised=revise_manual_document(doc,p,dict(radius_upper='2'))
    assert revised['solution']['answer_value']==pytest.approx(4*math.pi)
    assert revised['states']['step']==0


def test_horizontal_curved_slices_keep_original_x_y_order():
    c={**strip('1/(x+2*y)'), 'outer_variable':'y','inner_upper':'y'}
    assert document(c)['problems'][0]['solution']['answer_value']==pytest.approx(math.log(3/2))


def test_missing_function_is_a_validation_error():
    c=polar();c.pop('integrand')
    with pytest.raises(ValueError):preview_integral('double_integral',c)


@pytest.mark.parametrize('raw',['sqrt(x-y)*sqrt(x-y)','(abs(x-y)+x-y)/(abs(x-y)+x-y)'])
def test_parameter_simplification_never_hides_positive_measure_domain_gaps(raw):
    p=document(strip(raw,hi='1'))['problems'][0]
    assert p['manual_input']['result_status']=='unsupported'
    assert not p['solution']['answer']


def test_polar_odd_function_needs_absolute_convergence_before_zero_answer():
    divergent=document(polar('x'))['problems'][0]
    assert divergent['manual_input']['result_status']=='unsupported'
    assert not divergent['solution']['answer']
    convergent=document(polar('x/(x^2+y^2)^2',rlo='1'))['problems'][0]
    assert convergent['manual_input']['result_status']=='complete',convergent['solution']
    assert convergent['solution']['answer_value']==pytest.approx(0)
