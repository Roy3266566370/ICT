import pytest
import sympy as sp
from app.labs.manual import build_manual_document, preview_integral, revise_manual_document
from app.labs.solvers import evaluate_problem

def document(equation,conditions='',variable='x'):
    return build_manual_document(lab_id='t',title='',task='ode',conditions=dict(equation=equation,independent_variable=variable,initial_conditions=conditions),now_iso='2026-11-13')

@pytest.mark.parametrize('equation,conditions,variable,expected', [
 ("y'=y",'y(0)=1','x','exp(x)'),
 ("y'+y=x",'y(0)=1','x','x-1+2*exp(-x)'),
 ("y'=x*y",'y(0)=1','x','exp(x^2/2)'),
 ("y''+y=0","y(0)=0\ny'(0)=1",'x','sin(x)'),
 ("y''+2*y'+y=0","y(0)=1\ny'(0)=0",'x','(x+1)*exp(-x)'),
 ("y'''=0","y(0)=1\ny'(0)=2\ny''(0)=6",'x','1+2*x+3*x^2'),
 ("y'=y",'y(1/3)=1','x','exp(x-1/3)'),
 ("y''+y=0","y(pi/2)=1\ny'(pi/2)=0",'x','sin(x)'),
 ("y'=y",'y(0)=1','t','exp(t)'),
])
def test_real_ode_questions(equation,conditions,variable,expected):
    p=document(equation,conditions,variable)['problems'][0]
    assert p['manual_input']['result_status']=='complete',p['solution']
    from app.labs.expr import parse_expression
    assert sp.simplify(parse_expression(p['solution']['particular_solution'],(variable,))-parse_expression(expected,(variable,)))==0
    assert p['solution']['residual_verified'] is True
    assert p['solution']['initial_conditions_verified'] is True
    assert p['manual_input']['conditions']['initial_conditions']==conditions
    result=evaluate_problem(p['model'],p['model']['defaults'])
    assert len(result['series'])>0

def test_no_initial_conditions_keeps_constants_and_no_example_curve():
    p=document("y'=y")['problems'][0]
    assert p['solution']['free_constants'] is True
    assert 'C1' in p['solution']['general_solution']
    assert p['solution'].get('plot_expression') is None
    assert p['manual_input']['conditions']['initial_conditions']==''

def test_partial_conditions_do_not_claim_unique_particular_solution():
    p=document("y''+y=0",'y(0)=0')['problems'][0]
    assert p['solution']['free_constants'] is True
    assert p['solution']['particular_solution'] is None

def test_blowup_domain_and_original_equation_pole():
    p=document("y'=y^2",'y(0)=1')['problems'][0]
    assert p['manual_input']['result_status']=='complete'
    assert p['solution']['plot_window']['x_max']<1
    p=document("y'=y/x",'y(0)=0')['problems'][0]
    assert p['manual_input']['result_status']=='unsupported'
    assert p['solution'].get('plot_expression') is None

@pytest.mark.parametrize('equation,conditions',[("y'=y",'y(0)=1\ny(0)=2'),("y'=y",'y(1/2)=1\ny(0.5)=2'),("y'=y",'bad'),('y=x',''),("y''''=0",'')])
def test_malformed_or_conflicting_conditions_not_dropped(equation,conditions):
    with pytest.raises(ValueError):document(equation,conditions)

def test_multiple_solution_branches_not_replaced_by_first():
    p=document("(y')^2=4")['problems'][0]
    assert p['manual_input']['result_status']=='unsupported'
    assert '分支' in p['manual_input']['result_note']

def test_revision_can_clear_initial_conditions():
    d=document("y'=y",'y(0)=1')
    p=revise_manual_document(d,d['problems'][0],{'initial_conditions':''})
    assert p['solution']['free_constants'] is True
    assert p['manual_input']['conditions']['initial_conditions']==''

def test_original_cancelled_ode_denominator_is_not_filled():
    p=document("(x/x)*y'=1",'y(0)=0')['problems'][0]
    assert p['manual_input']['result_status']=='unsupported'
    assert '分母为零' in p['manual_input']['result_note']
    assert p['manual_input']['ode_details']['initial_conditions']==['y(0)=0']

def test_dependent_argument_must_match_independent_variable():
    with pytest.raises(ValueError):document("y(t)'=y",'y(0)=1','x')

def test_dependent_denominator_pole_is_not_cancelled():
    p=document("(y/y)*y'=1",'y(0)=0')['problems'][0]
    assert p['manual_input']['result_status']=='unsupported'
    assert '分母为零' in p['manual_input']['result_note']


def test_original_equation_domain_at_initial_point_is_checked():
    p = document("sqrt(x)^2*y'=x", 'y(-1)=0')['problems'][0]
    assert p['manual_input']['result_status'] == 'unsupported'
    assert p['solution']['answer'] == ''
    assert p['solution']['particular_solution'] is None
    assert p['solution']['residual_verified'] is False
    assert p['solution']['initial_conditions_verified'] is False
    assert '实定义' in p['manual_input']['result_note']


def test_solution_domain_excludes_derivative_singular_endpoint():
    p = document("sqrt(y)*y'=1", 'y(0)=1')['problems'][0]
    assert p['manual_input']['result_status'] == 'complete'
    assert p['solution']['solution_domain'] == '(-2/3, +∞)'

    p = document("y*y'=1", 'y(0)=1')['problems'][0]
    assert p['manual_input']['result_status'] == 'complete'
    assert p['solution']['solution_domain'] == '(-1/2, +∞)'


def test_original_equation_requires_real_values_of_y_and_derivatives_at_initial_point():
    p = document("sqrt(y)^2*y'=1", 'y(0)=-1')['problems'][0]
    assert p['manual_input']['result_status'] == 'unsupported'
    assert p['solution']['answer'] == ''
    assert '实定义' in p['manual_input']['result_note']

    p = document("log(y)*y'=1", 'y(0)=-1')['problems'][0]
    assert p['manual_input']['result_status'] == 'unsupported'
    assert p['solution']['answer'] == ''
    assert '实定义' in p['manual_input']['result_note']

    p = document("sqrt(y')=x", "y(0)=0\ny'(0)=-1")['problems'][0]
    assert p['manual_input']['result_status'] == 'unsupported'
    assert p['solution']['answer'] == ''
    assert '实定义' in p['manual_input']['result_note']


@pytest.mark.parametrize('equation,conditions,domain', [
    ("log(y)-log(y)+y'=1", 'y(0)=1', '(-1, +∞)'),
    ("log(y)-log(y)+y'=1", 'y(0)=2', '(-2, +∞)'),
    ("sqrt(y)^2+y'=y-1", 'y(0)=1', '(-∞, 1]'),
])
def test_solution_domain_preserves_original_equation_restrictions(equation, conditions, domain):
    p = document(equation, conditions)['problems'][0]
    assert p['manual_input']['result_status'] == 'complete'
    assert p['solution']['solution_domain'] == domain
