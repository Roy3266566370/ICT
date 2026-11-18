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

@pytest.mark.parametrize('conditions', [dict(expression='x',lower='0',upper='1',region_kind='between_axis'),dict(expression='x',lower='0',upper='1',region_kind='between_axis',rotation_axis='x',inner_radius='1')])
def test_axis_missing_or_extra_not_ignored(conditions):
    with pytest.raises(ValueError):preview_integral('rotation_volume',conditions)


@pytest.mark.parametrize('expression,a,b,region,axis,expected',[
 ('x','0','1','between_axis','y','2*pi/3'),
 ('sqrt(x)','0','1','between_axis','y','4*pi/5'),
 ('x^2','0','1','vertical_inequality','y','pi/2'),
 ('x','-1','0','between_axis','y','2*pi/3'),
])
def test_rotation_about_y_axis_uses_shell_method(expression,a,b,region,axis,expected):
    p=document('rotation_volume',expression,a,b,region,axis)['problems'][0]
    assert p['manual_input']['result_status']=='complete'
    assert sp.simplify(sp.sympify(p['solution']['exact'])-sp.sympify(expected))==0
    assert p['manual_input']['geometry_details']['rotation_axis']=='y'


def test_rotation_about_y_axis_rejects_region_crossing_axis():
    with pytest.raises(ValueError, match='y 轴一侧'):
        document('rotation_volume','x','-1','1','between_axis','y')


@pytest.mark.parametrize('upper,lower,a,b,task,axis,expected',[
 ('x','x^2','0','1','geometric_area',None,'1/6'),
 ('x^2','x','0','1','geometric_area',None,'1/6'),
 ('x','x^2','0','1','rotation_volume','x','2*pi/15'),
 ('x','x^2','0','1','rotation_volume','y','pi/6'),
])
def test_region_between_two_curves(upper,lower,a,b,task,axis,expected):
    conditions=dict(expression=upper,lower_expression=lower,lower=a,upper=b,region_kind='between_curves')
    if task=='rotation_volume':conditions['rotation_axis']=axis
    p=build_manual_document(lab_id='t',title='',task=task,conditions=conditions,now_iso='2026-11-13')['problems'][0]
    assert p['manual_input']['result_status']=='complete'
    assert sp.simplify(sp.sympify(p['solution']['exact'])-sp.sympify(expected))==0
    assert p['manual_input']['geometry_details']['lower_expression']==lower


def test_between_curves_axis_volume_requires_region_above_axis():
    conditions=dict(expression='x',lower_expression='-x',lower='0',upper='1',region_kind='between_curves',rotation_axis='x')
    with pytest.raises(ValueError, match='下边界 g'):
        build_manual_document(lab_id='t',title='',task='rotation_volume',conditions=conditions,now_iso='2026-11-13')


def test_between_curves_area_splits_at_intersections():
    conditions=dict(expression='x',lower_expression='x^2',lower='-1',upper='2',region_kind='between_curves')
    p=build_manual_document(lab_id='t',title='',task='geometric_area',conditions=conditions,now_iso='2026-11-13')['problems'][0]
    # |x-x^2| 在 [-1,2] 上的积分：交点为 0、1
    assert sp.simplify(sp.sympify(p['solution']['exact'])-sp.Rational(11,6))==0
    assert set(p['manual_input']['geometry_details']['zero_points'])=={'0','1'}

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
