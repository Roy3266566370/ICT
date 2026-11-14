import json
import pytest
from app.labs.double_affine import preview, solve


def conditions(**kw):
    return dict(integrand='x+y',region_mode='affine',x_map='u+v+1',y_map='v+2',outer_lower='0',outer_upper='1',inner_lower='0',inner_upper='1',**kw) if not kw else {**conditions(),**kw}


def test_translation_shear_and_contour():
    c=conditions()
    r=solve(c)
    assert r['solution_complete'] and r['answer_value']==pytest.approx(4.5)
    points=r['double_extension']['region_points']
    assert len(points)==123 and points[0]==points[-1]
    assert points[0]=={'x':1.0,'y':2.0}
    json.dumps(r,allow_nan=False)


def test_negative_det_and_curved_domain():
    r=solve(conditions(integrand='1',x_map='v',y_map='u',inner_upper='u^2'))
    assert r['solution_complete'] and r['answer_value']==pytest.approx(1/3)


@pytest.mark.parametrize('change',[{'x_map':'u^2'},{'y_map':'2*u+2*v+2'},{'outer_upper':'1/0'},{'inner_upper':'1/(u-u)'},{'x_map':'sqrt(-1)*sqrt(-1)*u'}])
def test_invalid(change):
    with pytest.raises(ValueError): preview(conditions(**change))


def test_incomplete():
    c=conditions();c.pop('inner_lower')
    with pytest.raises(ValueError):preview(c)


@pytest.mark.parametrize('f',['(x-1)/(x-1)','sqrt(x-2)*sqrt(x-2)'])
def test_original_subexpressions(f):
    r=solve(conditions(integrand=f,x_map='u',y_map='v'))
    assert not r['solution_complete'] and r['solution_status']=='unsupported'
    assert r['answer_value'] is None and r['conditions']
    json.dumps(r,allow_nan=False)


def test_zero_and_exact_constant():
    assert solve(conditions(integrand='0'))['answer_value']==0
    assert solve(conditions(integrand='pi/2'))['answer_value']==pytest.approx(3.141592653589793/2)


def test_preview_does_not_integrate(monkeypatch):
    import sympy as sp
    monkeypatch.setattr(sp,'integrate',lambda *a,**k:pytest.fail('preview integrated'))
    assert preview(conditions())['task']=='double_integral'


def test_sqrt_boundary_symbol_rename_and_exact_translation():
    c=conditions(integrand='1',x_map='u+pi/2',y_map='v',inner_upper='sqrt(u)')
    r=solve(c)
    assert r['solution_complete'] and r['answer_value']==pytest.approx(2/3)
    assert r['double_extension']['region_points'][0]['x']==pytest.approx(3.141592653589793/2)


@pytest.mark.parametrize('change',[{'inner_upper':'(u-1)/(u-1)'},{'outer_lower':'sqrt(-1)*sqrt(-1)'},{'x_map':'1/(u-u)+v'},{'inner_lower':0},{'extra':'u'}])
def test_raw_bounds_and_strict_fields(change):
    with pytest.raises(ValueError):preview(conditions(**change))


def test_unproved_function_preserves_original_conditions():
    c=conditions(integrand='1/(x+y+1)')
    r=solve(c)
    assert not r['solution_complete']
    assert c['integrand'] in r['conditions'][0]
    assert r['double_extension']['kind']=='affine'
    assert all(point['x']>=1 for point in r['double_extension']['region_points'])
def test_kernel_special_function_is_not_reparsed_as_user_input():
    result=solve(conditions(integrand='exp(x^2)',x_map='u',y_map='v'))
    assert result['solution_complete'],result
    assert 'erfi' in result['exact_latex']


@pytest.mark.parametrize('patch,value',[
    ({'x_map':'u^2','y_map':'v','integrand':'x+y'},1),
    ({'x_map':'2-u^2','y_map':'v','integrand':'1'},1),
    ({'x_map':'u^2','y_map':'v+u^3','integrand':'1'},1),
    ({'x_map':'u^2','y_map':'v','inner_upper':'u','integrand':'1'},2/3),
    ({'x_map':'u^2','y_map':'v^2','integrand':'1'},1),
])
def test_certified_nonlinear_triangular_or_separable_mapping(patch,value):
    result=solve(conditions(region_mode='change_variables',**patch))
    assert result['solution_complete'],result
    assert result['answer_value']==pytest.approx(value)
    assert result['double_extension']['region_points']


def test_nonlinear_mapping_never_ignores_multiple_cover_or_collapse():
    with pytest.raises(ValueError):preview(conditions(region_mode='change_variables',x_map='u^2',y_map='v',outer_lower='-1'))
    with pytest.raises(ValueError):preview(conditions(region_mode='change_variables',x_map='u',y_map='u^2'))
