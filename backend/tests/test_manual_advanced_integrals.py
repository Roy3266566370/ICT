import math
import pytest
from app.labs.manual import build_manual_document, preview_integral, revise_manual_document


def doc(task, c):
    return build_manual_document(lab_id='advanced', title='', task=task, conditions=c, now_iso='2026-11-14')


def strip(**patch):
    return dict(integrand='x+2*y', outer_variable='x', outer_lower='0', outer_upper='1', inner_lower='0', inner_upper='x', **patch)


@pytest.mark.parametrize('c,value,kind', [
    (dict(integrand='x+y', region_mode='pieces', outer_variable='x', pieces_text='0;1;0;x\n1;2;0;2-x'), 4/3, 'pieces'),
    (dict(integrand='x^2+y^2', region_mode='polar', theta_lower='0', theta_upper='2*pi', radius_lower='0', radius_upper='1'), math.pi/2, 'polar'),
    (strip(swap_order='true'), 2/3, 'strip'),
])
def test_advanced_manual_roundtrip(c, value, kind):
    d=doc('double_integral', c); p=d['problems'][0]
    assert p['manual_input']['result_status']=='complete', p['solution']
    assert p['solution']['answer_value']==pytest.approx(value)
    assert p['manual_input']['conditions']==c
    assert p['model']['region_kind']==kind
    assert p['manual_input']['double_details']['region_kind']==kind
    if c.get('swap_order'): assert p['model']['swapped']['numeric_verified']
    rebuilt=revise_manual_document(d,p,{'integrand':'1'})
    assert rebuilt['manual_input']['result_status']=='complete'


@pytest.mark.parametrize('f,a,b,status,value', [
    ('exp(-x)','0','oo','complete',1),
    ('exp(x)','-∞','0','complete',1),
    ('1/(1+x^2)','-oo','+inf','complete',math.pi),
    ('1/sqrt(x)','0','1','complete',2),
    ('1/x','-1','1','divergent',None),
    ('1/x','1','oo','divergent',None),
])
def test_manual_improper_integrals(f,a,b,status,value):
    c=dict(expression=f,variable='x',lower=a,upper=b,integral_mode='improper')
    p=doc('integral',c)['problems'][0]
    assert p['manual_input']['result_status']==status, p['solution']
    if value is not None: assert p['solution']['answer_value']==pytest.approx(value)
    assert p['model']['params']==[]


@pytest.mark.parametrize('c', [
    dict(integrand='1',region_mode='pieces',outer_variable='x',pieces_text='0;2;0;1\n1;3;0;1'),
    dict(integrand='1',region_mode='polar',theta_lower='0',theta_upper='4*pi',radius_lower='0',radius_upper='1'),
    dict(integrand='1',region_mode='polar',theta_lower='0',theta_upper='pi',radius_lower='-1',radius_upper='1'),
])
def test_bad_advanced_regions_rejected(c):
    with pytest.raises(ValueError): preview_integral('double_integral',c)


def test_uncertified_original_polar_expression_never_cancels_to_answer():
    c=dict(integrand='(x-y)/(x-y)',region_mode='polar',theta_lower='0',theta_upper='2*pi',radius_lower='0',radius_upper='1')
    p=doc('double_integral',c)['problems'][0]
    assert p['manual_input']['result_status']=='unsupported'


def test_improper_domain_gap_rejected():
    with pytest.raises(ValueError):
        preview_integral('integral',dict(expression='sqrt(x)',variable='x',lower='-1',upper='oo',integral_mode='improper'))


@pytest.mark.parametrize('raw,a,b,lo,hi,status,value',[
    ('exp(-x-y)','0','oo','0','oo','complete',1),
    ('1/sqrt(x)/sqrt(y)','0','1','0','1','complete',4),
    ('1/x','0','1','0','1','divergent',None),
    ('1/(x*y)','-1','1','-1','1','unsupported',None),
    ('1/(x*y)','1','oo','1','oo','divergent',None),
    ('x-x','0','oo','0','oo','complete',0),
])
def test_double_improper_product_regions(raw,a,b,lo,hi,status,value):
    c=dict(integrand=raw,region_mode='improper',outer_variable='x',outer_lower=a,outer_upper=b,inner_lower=lo,inner_upper=hi)
    p=doc('double_integral',c)['problems'][0]
    assert p['manual_input']['result_status']==status,p['solution']
    if value is not None: assert p['solution']['answer_value']==pytest.approx(value)
    from app.labs.solvers import evaluate_problem
    result=evaluate_problem(p['model'],{})
    if value is not None: assert result['exact']==pytest.approx(value)
    assert result['approx'] is None
    assert result['rects']==[]


def test_unsupported_swap_keeps_full_original_without_partial_answer():
    c={**strip(swap_order='true'),'integrand':'1','inner_upper':'x*(1-x)*(x+1)'}
    p=doc('double_integral',c)['problems'][0]
    assert p['manual_input']['result_status']=='unsupported'
    assert p['manual_input']['conditions']==c
    assert not p['solution']['answer']
    assert '换序' in p['manual_input']['result_note']


def test_each_piece_can_be_swapped_and_reverse_order_preserves_coordinates():
    c=dict(integrand='x+2*y',region_mode='pieces',outer_variable='y',pieces_text='0;1;0;y\n1;2;0;2-y',swap_order='true')
    p=doc('double_integral',c)['problems'][0]
    assert p['solution']['answer_value']==pytest.approx(7/3)
    assert len(p['model']['swapped'])==2
    assert all(s['outer_variable']=='x' and s['numeric_verified'] for s in p['model']['swapped'])


def test_theta_boundary_and_original_nonreal_domain():
    c=dict(integrand='1',region_mode='polar',theta_lower='-pi/2',theta_upper='pi/2',radius_lower='0',radius_upper='2*cos(theta)')
    p=doc('double_integral',c)['problems'][0]
    assert p['solution']['answer_value']==pytest.approx(math.pi)
    c=dict(integrand='sqrt(-x)*sqrt(-x)',region_mode='improper',outer_variable='x',outer_lower='0',outer_upper='1',inner_lower='0',inner_upper='1')
    p=doc('double_integral',c)['problems'][0]
    assert p['manual_input']['result_status']=='unsupported'


def test_polar_annulus_excludes_origin_without_canceling_original_poles():
    c=dict(integrand='1/(x^2+y^2)',region_mode='polar',theta_lower='0',theta_upper='2*pi',radius_lower='1',radius_upper='2')
    p=doc('double_integral',c)['problems'][0]
    assert p['manual_input']['result_status']=='complete',p['solution']
    assert p['solution']['answer_value']==pytest.approx(2*math.pi*math.log(2))
    c['integrand']='(x-y)/(x-y)'
    assert doc('double_integral',c)['problems'][0]['manual_input']['result_status']=='unsupported'


def test_unevaluated_infinite_integral_is_not_a_proof_of_divergence():
    c=dict(expression='abs(sin(x))*exp(-x)',variable='x',lower='0',upper='oo',integral_mode='improper')
    p=doc('integral',c)['problems'][0]
    # The integrand is bounded above by exp(-x); unknown closed form is not divergence.
    assert p['manual_input']['result_status']=='unsupported'
    assert not p['solution']['answer']
