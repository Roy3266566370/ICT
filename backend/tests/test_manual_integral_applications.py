import pytest
import sympy as sp
from app.labs.manual import build_manual_document, preview_integral, revise_manual_document

def document(task,expression,lower,upper,region='between_axis',axis='x'):
    c=dict(expression=expression,lower=lower,upper=upper,region_kind=region)
    if task=='rotation_volume':c['rotation_axis']=axis
    return build_manual_document(lab_id='t',title='',task=task,conditions=c,now_iso='2026-11-13')

@pytest.mark.parametrize('task,expression,a,b,region,expected',[
 ('geometric_area','x','-1','1','between_axis','1'),
 ('geometric_area','x','-1','1','vertical_inequality','1/2'),
 ('rotation_volume','x','-1','1','between_axis','2*pi/3'),
 ('rotation_volume','x','-1','1','vertical_inequality','pi/3'),
 ('geometric_area','-2','0','2','between_axis','4'),
 ('geometric_area','-2','0','2','vertical_inequality','0'),
 ('rotation_volume','-2','0','2','between_axis','8*pi'),
 ('rotation_volume','-2','0','2','vertical_inequality','0'),
 ('geometric_area','sin(x)','-pi','pi','between_axis','4'),
 ('rotation_volume','sin(x)','-pi','pi','between_axis','pi**2'),
 ('geometric_area','x^2','0','1/3','between_axis','1/81'),
 ('geometric_area','0','0','1','between_axis','0'),
 ('rotation_volume','0','0','1','vertical_inequality','0'),
 ('geometric_area','sqrt(x)','0','1','between_axis','2/3'),
])
def test_real_geometry_questions(task,expression,a,b,region,expected):
    p=document(task,expression,a,b,region)['problems'][0]
    assert p['manual_input']['result_status']=='complete'
    assert sp.simplify(sp.sympify(p['solution']['exact'])-sp.sympify(expected))==0
    assert p['manual_input']['conditions']['region_kind']==region
    assert p['manual_input']['conditions']['lower']==a
    assert p['manual_input']['conditions']['upper']==b
    assert float(p['solution']['answer_value'])>=0
    if task=='rotation_volume':assert p['manual_input']['conditions']['rotation_axis']=='x'

@pytest.mark.parametrize('expression,a,b', [('1/x','-1','1'),('(x^2-1)/(x-1)','0','2'),('sqrt(x)','-1','1'),('x','1','0'),('x','0','0')])
def test_no_reversed_or_invalid_region(expression,a,b):
    with pytest.raises(ValueError):document('geometric_area',expression,a,b)

@pytest.mark.parametrize('conditions', [dict(expression='x',lower='0',upper='1',region_kind='between_axis'),dict(expression='x',lower='0',upper='1',region_kind='between_axis',rotation_axis='y'),dict(expression='x',lower='0',upper='1',region_kind='between_axis',rotation_axis='x',inner_radius='1')])
def test_axis_missing_unsupported_or_extra_not_ignored(conditions):
    with pytest.raises(ValueError):preview_integral('rotation_volume',conditions)

def test_revision_changes_region_not_just_label():
    d=document('geometric_area','x','-1','1')
    p=revise_manual_document(d,d['problems'][0],{'region_kind':'vertical_inequality'})
    assert p['solution']['exact']=='1/2'
    assert p['manual_input']['geometry_details']['effective_intervals']==[['0','1']]

def test_multiple_sign_changes_are_all_split_and_isolated_fiber_is_retained():
    p=document('geometric_area','x^3-x','-2','2')['problems'][0]
    assert p['solution']['exact']=='5'
    assert set(p['manual_input']['geometry_details']['zero_points'])=={'-1','0','1'}
    p=document('geometric_area','-x^2','-1','1','vertical_inequality')['problems'][0]
    assert p['solution']['exact']=='0'
    assert p['manual_input']['geometry_details']['zero_points']==['0']
    assert p['manual_input']['geometry_details']['effective_intervals']==[]

def test_cancelled_product_hole_is_not_filled_for_area():
    with pytest.raises(ValueError):document('geometric_area','-x^2*(x/x)','-1','1')
