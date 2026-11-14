import pytest
import sympy as sp
from app.labs.manual import preview_integral, build_manual_document
from app.labs.solvers import evaluate_problem

def build(equation,px,py=None):
    c=dict(implicit_expression=equation,point_x=px)
    if py is not None:c['point_y']=py
    return build_manual_document(lab_id='t',title='',task='implicit_normal',conditions=c,now_iso='2026-11-13')['problems'][0]

@pytest.mark.parametrize('equation,px,py,tangent,normal', [
 ('y=x^2','0',None,'horizontal','vertical'),
 ('x^2+y^2=1','1','0','vertical','horizontal'),
 ('x^2+y^2=1','0','1','horizontal','vertical'),
 ('x^2+y^2=1','0','-1','horizontal','vertical'),
 ('y=x^2','1/3',None,'oblique','oblique'),
 ('y=sin(x)','pi',None,'oblique','oblique'),
 ('x=y^2','0','0','vertical','horizontal'),
])
def test_real_line_questions(equation,px,py,tangent,normal):
    p=build(equation,px,py)
    g=p['manual_input']['line_geometry']
    assert g['tangent_direction']==tangent
    assert g['normal_direction']==normal
    assert p['manual_input']['conditions']['point_x']==px
    assert p['manual_input']['result_status']=='complete'
    assert p['solution']['tangent_tex'] != p['solution']['normal_tex']
    result=evaluate_problem(p['model'],p['model']['defaults'])
    points=[v for v in result['series'] if v['y'] is not None]
    assert len(points)>10
    if tangent=='vertical': assert max(v['y'] for v in points)>float(g['point_y']) and min(v['y'] for v in points)<float(g['point_y'])

@pytest.mark.parametrize('equation,px,py', [
 ('x^2+y^2=1','0',None), ('x^2+y^2=1','0','0'),
 ('y^2=x^2','0','0'), ('y=abs(x)','0','0'),
 ('y=(x^2-1)/(x-1)','1','2'),
])
def test_ambiguous_invalid_or_singular_not_guessed(equation,px,py):
    with pytest.raises(ValueError): build(equation,px,py)

def test_opposite_circle_branches_give_opposite_oblique_directions():
    upper=build('x^2+y^2=1','3/5','4/5')
    lower=build('x^2+y^2=1','3/5','-4/5')
    assert upper['model']['normal_slope']=='4/3'
    assert lower['model']['normal_slope']=='-4/3'
    assert upper['manual_input']['line_geometry']['point_y']=='4/5'
    assert lower['manual_input']['line_geometry']['point_y']=='-4/5'

def test_exact_oblique_slope_and_vertical_line_equation():
    p=build('y=x^2','1/3')
    assert p['model']['normal_slope']=='-3/2'
    assert '2}{3' in p['solution']['tangent_tex']
    p=build('x^2+y^2=1','1','0')
    assert p['solution']['tangent_tex']=='x=1'
    p=build('y=x^2','0')
    assert p['solution']['normal_tex']=='x=0'

def test_revise_complete_point_selects_another_branch():
    from app.labs.manual import revise_manual_document
    d=build_manual_document(lab_id='t',title='',task='implicit_normal',conditions=dict(implicit_expression='x^2+y^2=1',point_x='3/5',point_y='4/5'),now_iso='2026-11-13')
    revised=revise_manual_document(d,d['problems'][0],{'point_y':'-4/5'})
    assert revised['model']['normal_slope']=='-4/3'
    assert revised['manual_input']['line_geometry']['point_y']=='-4/5'
