import pytest
from app.labs.manual import build_manual_document, preview_integral, revise_manual_document
from app.labs.solvers import evaluate_problem


def conditions(integrand='x+y',outer='x',a='0',b='1',lo='0',hi='x'):
    return dict(integrand=integrand,outer_variable=outer,outer_lower=a,outer_upper=b,inner_lower=lo,inner_upper=hi)


def document(c):
    return build_manual_document(lab_id='double',title='',task='double_integral',conditions=c,now_iso='2026-11-13')


@pytest.mark.parametrize('c,exact',[
    (conditions(),'1/2'),
    (conditions(outer='y',lo='y',hi='1'),'1/2'),
    (conditions('x+2*y'),'2/3'),
    (conditions('x+2*y',outer='y',lo='y',hi='1'),'2/3'),
    (conditions('x+y',b='2',lo='x',hi='2*x'),'20/3'),
    (conditions('1',lo='x^2',hi='sqrt(x)'),'1/3'),
    (conditions('1',a='1/3',b='pi',hi='1'),'pi - 1/3'),
    (conditions('x-y',lo='0',hi='1'),'0'),
    (conditions('1',lo='x',hi='x'),'0'),
    (conditions('exp(x+y)',lo='0',hi='1'),'(1 - E)^2'),
])
def test_regions_bounds_and_exact_results(c,exact):
    p=document(c)['problems'][0]
    assert p['manual_input']['result_status']=='complete',p['solution']
    import sympy as sp
    assert sp.simplify(sp.sympify(p['solution']['exact'],locals={'e':sp.E})-sp.sympify(exact))==0
    assert p['manual_input']['conditions']==c
    assert p['model']['outer_variable']==c['outer_variable']
    assert p['model']['variables']==['x','y']
    assert p['model']['inner_variable']==('y' if c['outer_variable']=='x' else 'x')
    assert p['model']['outer_bounds']==[c['outer_lower'],c['outer_upper']]
    assert p['manual_input']['double_details']['region_verified']
    result=evaluate_problem(p['model'],{'n':20})
    assert result['task']=='double_integral'
    assert result['exact']==pytest.approx(p['solution']['answer_value'])


@pytest.mark.parametrize('patch',[
    {'outer_lower':''},{'inner_lower':''},{'outer_upper':'0'},
    {'outer_lower':'1','outer_upper':'0'},{'outer_lower':'y'},
    {'inner_upper':'y'},{'outer_variable':'z'},
    {'inner_lower':'x','inner_upper':'x^2'},
    {'inner_lower':'0','inner_upper':'(x-1/3)*(x-2/5)'},
    {'inner_upper':'sqrt(x-1/2)'},
    {'inner_upper':'(x^2-1/4)/(x-1/2)'},
    {'pieces':[]},{'extra_constraint':'x+y<=1'},
])
def test_invalid_or_incomplete_region_is_not_changed_to_pass(patch):
    with pytest.raises(ValueError):
        preview_integral('double_integral',{**conditions(),**patch})


def test_domain_not_certified_does_not_become_exact_answer_after_cancellation():
    for raw in ('(x-y)/(x-y)','sqrt(x-y)','1/(x-1/37)^2'):
        c=conditions(raw,lo='0',hi='1')
        p=document(c)['problems'][0]
        assert p['manual_input']['result_status']=='unsupported'
        assert not p['solution']['answer']
        assert p['manual_input']['conditions']==c
        assert p['manual_input']['double_details']['region_verified']
        assert not p['solution'].get('answer_value')


def test_unfinished_inner_integral_is_saved_without_fake_numeric_answer():
    c=conditions('exp(x*y)',lo='0',hi='1')
    p=document(c)['problems'][0]
    assert p['manual_input']['conditions']==c
    assert p['manual_input']['result_status']=='complete',p['solution']
    assert p['manual_input']['double_details']['continuous_verified']


def test_review_rebuilds_every_boundary_and_preserves_order():
    doc=document(conditions('1',lo='x',hi='2*x'))
    p=revise_manual_document(doc,doc['problems'][0],{'outer_upper':'2'})
    assert p['manual_input']['conditions']['inner_lower']=='x'
    assert p['model']['inner_bounds']==['x','2*x']
    assert p['solution']['exact']=='2'
    assert p['states']['step']==0


def test_kernel_special_function_result_is_displayed_without_user_parser_reparse():
    p=document(conditions('exp(x^2)',lo='0',hi='1'))['problems'][0]
    assert p['manual_input']['result_status']=='complete',p['solution']
    assert 'erfi' in p['solution']['exact_latex']
    assert p['manual_input']['double_details']['inner_integral_latex']


def test_nonreal_original_boundary_cannot_be_canceled_into_real_curve():
    with pytest.raises(ValueError):
        preview_integral('double_integral',conditions('1',lo='sqrt(-1)*sqrt(-1)*x',hi='1'))


@pytest.mark.parametrize('raw,a,b', [('sqrt(x)','0','1'),('log(x)','1','2'),('1/(1+x^2)','0','1')])
def test_common_continuous_integrands_are_not_rejected_by_global_domain_restriction(raw,a,b):
    p=document(conditions(raw,a=a,b=b,lo='0',hi='1'))['problems'][0]
    assert p['manual_input']['result_status']=='complete',p['solution']


def test_kernel_failure_keeps_region_and_unfinished_state(monkeypatch):
    from app.labs import manual_double_integral
    def fail(_):
        raise ValueError('内层积分未得到闭式结果')
    monkeypatch.setattr(manual_double_integral,'compile_model',fail)
    c=conditions();p=document(c)['problems'][0]
    assert p['manual_input']['conditions']==c
    assert p['manual_input']['result_status']=='unsupported'
    assert '内层积分' in p['manual_input']['result_note']
    assert not p['solution']['answer']
    assert p['manual_input']['double_details']['continuous_verified']
