"""Order changes must preserve geometry even when the integrand is zero."""
import pytest
import sympy as sp

from app.labs.double_integral import X, Y, compile_model, solve_double_integral, evaluate_double_integral
from app.labs.expr import parse_expression
from app.labs.manual import build_manual_document, revise_manual_document


@pytest.mark.parametrize('a,b,lo,hi,count,area',[
    ('0','1','0','x+1',2,sp.Rational(3,2)),
    ('0','1','x','2*x',2,sp.Rational(1,2)),
    ('0','1','0','x*(1-x)',1,sp.Rational(1,6)),
    ('-1','1','x^2','1',1,sp.Rational(4,3)),
    ('-1','1','0','x^2',2,sp.Rational(2,3)),
    ('0','1','-x','x',2,sp.Integer(1)),
])
@pytest.mark.parametrize('raw',['1','x+2*y','0'])
def test_quadratic_swap_partitions_preserve_region_and_integral(a,b,lo,hi,count,area,raw):
    model=compile_model(dict(integrand=raw,outer_variable='x',outer_bounds=[a,b],inner_bounds=[lo,hi],swap_order=True))
    swaps=model['swapped'] if isinstance(model['swapped'],list) else [model['swapped']]
    assert len(swaps)==count
    total=0;swapped_area=0
    for part in swaps:
        left,right=[parse_expression(v) for v in part['outer_bounds']]
        low,high=[parse_expression(v,('y',)) for v in part['inner_bounds']]
        assert part['outer_variable']=='y'
        assert part['numeric_verified'] is True
        assert part['region_verified'] is True
        swapped_area+=sp.integrate(high-low,(Y,left,right))
        total+=sp.sympify(part['exact'])
        for fraction in (sp.Rational(1,4),sp.Rational(1,2),sp.Rational(3,4)):
            y=left+(right-left)*fraction
            x=low.subs(Y,y)+(high-low).subs(Y,y)*fraction
            assert float(parse_expression(a))<=float(x)<=float(parse_expression(b))
            assert float(parse_expression(lo).subs(X,x))<=float(y)+1e-10
            assert float(y)<=float(parse_expression(hi).subs(X,x))+1e-10
    assert sp.simplify(swapped_area-area)==0
    assert sp.simplify(total-sp.sympify(model['exact']))==0
    assert any(step['id'].startswith('swap') for step in solve_double_integral(model)['steps'])


def test_manual_split_swap_survives_review_and_uses_correct_variable_order():
    c=dict(integrand='x+2*y',outer_variable='y',outer_lower='-1',outer_upper='1',inner_lower='0',inner_upper='y^2',swap_order='true')
    doc=build_manual_document(lab_id='split',title='',task='double_integral',conditions=c,now_iso='2026-11-14')
    p=doc['problems'][0]
    assert p['manual_input']['result_status']=='complete',p['solution']
    assert len(p['model']['swapped'])==2
    assert all(item['outer_variable']=='x' for item in p['model']['swapped'])
    rebuilt=revise_manual_document(doc,p,dict(outer_lower='0'))
    assert rebuilt['manual_input']['conditions']['outer_lower']=='0'
    assert rebuilt['manual_input']['result_status']=='complete'
    assert rebuilt['states']['step']==0


def test_original_piece_swaps_flatten_multiple_new_regions():
    model=compile_model(dict(integrand='1',outer_variable='x',pieces=[
        dict(outer_bounds=['-1','1'],inner_bounds=['0','x^2']),
        dict(outer_bounds=['1','2'],inner_bounds=['0','1']),
    ],swap_order=True))
    assert len(model['swapped'])==3
    assert all(isinstance(item,dict) for item in model['swapped'])
    assert sum(item['answer_value'] for item in model['swapped'])==pytest.approx(5/3)


def test_legacy_swapped_limits_are_rederived_before_being_shown_as_verified():
    model=compile_model(dict(integrand='1',outer_variable='x',outer_bounds=['0','1'],inner_bounds=['0','x+1']))
    model['swapped']=dict(outer_variable='y',inner_variable='x',outer_bounds=['0','2'],inner_bounds=['y-1','1'],exact='2',answer_value=2,numeric_verified=True,formula_tex='old')
    result=evaluate_double_integral(model,{})
    assert len(result['swapped'])==2
    assert all(part['region_verified'] for part in result['swapped'])
    assert sum(part['answer_value'] for part in result['swapped'])==pytest.approx(3/2)
    steps=solve_double_integral(model)['steps']
    assert all(step.get('latex')!='old' for step in steps)
    assert len(set(step['id'] for step in steps))==len(steps)


def test_unused_far_inverse_branch_does_not_exceed_plot_limits():
    model=compile_model(dict(integrand='1',outer_variable='x',outer_bounds=['0','1'],inner_bounds=['0','1+x+x^2/1000000'],swap_order=True))
    assert len(model['swapped'])==2
    assert sum(part['answer_value'] for part in model['swapped'])==pytest.approx(3/2+1/3000000)


def test_existing_algebraic_boundaries_and_kernel_special_values_still_swap():
    model=compile_model(dict(integrand='1',outer_variable='x',outer_bounds=['0','1'],inner_bounds=['x^2','sqrt(x)'],swap_order=True))
    assert model['swapped']['answer_value']==pytest.approx(1/3)
    model=compile_model(dict(integrand='exp(x^2)',outer_variable='x',outer_bounds=['0','1'],inner_bounds=['0','1'],swap_order=True))
    assert 'erfi' in model['swapped']['exact']
    assert model['swapped']['answer_value']==pytest.approx(model['answer_value'])


def test_internal_boundary_contact_creates_complete_cells_without_double_counting():
    model=compile_model(dict(integrand='1',outer_variable='x',outer_bounds=['0','1'],inner_bounds=['x^2','x^2+(x-1/2)^2'],swap_order=True))
    parts=model['swapped']
    assert len(parts)==5
    assert sum(part['answer_value'] for part in parts)==pytest.approx(1/12)
    assert all(part['region_verified'] for part in parts)
