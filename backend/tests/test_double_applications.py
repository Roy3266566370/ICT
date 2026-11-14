import json
import pytest
from app.labs.double_applications import preview, solve


def c(kind='mass', **kw):
    return dict(integrand='1',outer_variable='x',outer_lower='0',outer_upper='1',inner_lower='0',inner_upper='1',application=kind,**kw)


@pytest.mark.parametrize('kind,extra,values', [('mass',{},[1]),('centroid',{},[1,.5,.5]),('inertia',{'inertia_axis':'x'},[1,1/3]),('inertia',{'inertia_axis':'origin'},[1,2/3])])
def test_square(kind,extra,values):
    result=solve(c(kind,**extra))
    assert result['solution_complete']
    assert [v['value'] for v in result['double_extension']['values']]==pytest.approx(values)
    json.dumps(result)


def test_probability():
    data=c('probability',event_outer_lower='0',event_outer_upper='1/2',event_inner_lower='0',event_inner_upper='x')
    data.update(integrand='2',inner_upper='x')
    assert solve(data)['answer_value']==pytest.approx(.25)
    assert '事件' in preview(data)['question']


@pytest.mark.parametrize('patch',[{'extra':'x'},{'application':'bad'},{'application':'inertia'},{'region_mode':'affine'}])
def test_invalid(patch):
    with pytest.raises(ValueError): preview({**c(),**patch})


def test_nonnegative_zero_and_probability_guards():
    for patch in ({'integrand':'-1'},{'application':'centroid','integrand':'0'}):
        assert not solve({**c(),**patch})['solution_complete']
    data=c('probability',event_outer_lower='0',event_outer_upper='1',event_inner_lower='0',event_inner_upper='1')
    assert not solve({**data,'integrand':'2'})['solution_complete']
    with pytest.raises(ValueError): preview({**data,'event_outer_upper':'2'})


def test_original_domain_preserved():
    assert not solve({**c('inertia',inertia_axis='y'),'integrand':'1/x'})['solution_complete']

@pytest.mark.parametrize('patch,expected', [({'application':'inertia','inertia_axis':'y'},1/3),({'integrand':'x'},.5),({'region_mode':'pieces','pieces_text':'0;1/2;0;1\n1/2;1;0;1'},1),({'region_mode':'polar','theta_lower':'0','theta_upper':'2*pi','radius_lower':'0','radius_upper':'1'},3.141592653589793)])
def test_modes_and_axis(patch,expected):
    data={**c(),**patch}
    if patch.get('region_mode') in ('pieces','polar'):
        for key in ('outer_lower','outer_upper','inner_lower','inner_upper'): data.pop(key)
    if patch.get('region_mode')=='polar': data.pop('outer_variable')
    assert solve(data)['answer_value']==pytest.approx(expected)


def test_no_sampling_nonnegativity_proof():
    # A tiny negative interval must not pass just because common grid samples miss it.
    result=solve({**c(),'integrand':'(x-1/37)^2-1/1000000'})
    assert not result['solution_complete']


def test_nonnegative_polynomial_and_zero_inertia():
    assert solve({**c(),'integrand':'1-x'})['answer_value']==pytest.approx(.5)
    assert solve({**c('inertia',inertia_axis='origin'),'integrand':'0'})['answer_value']==0


def test_event_interior_escape_and_extra_conditions():
    data=c('probability',event_outer_lower='0',event_outer_upper='1',event_inner_lower='0',event_inner_upper='1+x*(1-x)')
    with pytest.raises(ValueError): preview(data)
    with pytest.raises(ValueError): preview({**c(),'density':'1'})
    with pytest.raises(ValueError): preview({**c(),'inertia_axis':'x'})


def test_application_specific_process_and_approximation_are_not_mass_answer():
    centroid=solve(c('centroid'))
    assert centroid.get('approx')==''
    assert any(step['id']=='centroid_moments' for step in centroid['steps'])
    inertia=solve(c('inertia',inertia_axis='origin'))
    assert float(inertia['approx'])==pytest.approx(2/3)
    assert any(step['id']=='inertia_moment' for step in inertia['steps'])
    probability=solve(c('probability',event_outer_lower='0',event_outer_upper='1/2',event_inner_lower='0',event_inner_upper='1'))
    assert float(probability['approx'])==pytest.approx(1/2)
    assert any(step['id']=='probability_event' for step in probability['steps'])


def test_univariate_density_nonnegativity_uses_actual_projection_interval():
    result=solve({**c(),'integrand':'log(x)','outer_lower':'1','outer_upper':'e'})
    assert result['solution_complete'],result
    assert result['answer_value']==pytest.approx(1)
