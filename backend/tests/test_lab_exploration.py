import pytest
from app.labs.kernel_models import compile_kernel_problem
from app.labs.solvers import evaluate_problem

@pytest.mark.parametrize('task,conditions', [
    ('multivariable_extrema', dict(expression='x^2+y^2',operation='unconstrained',variables='x,y')),
    ('multivariable', dict(expression='x^2+y^2',operation='partial',variables='x,y',partial_variable='x')),
    ('function_study', dict(expression='x^2',variable='x',lower=-2,upper=2)),
])
def test_probe_controls_drive_slice_without_changing_proof(task,conditions):
    p=compile_kernel_problem(dict(task=task,conditions=conditions))
    answer=p['solution']['answer']
    model=p['model']
    assert any(v['id']=='probe_x' for v in model['params'])
    a=evaluate_problem(model,model['defaults'])
    b=evaluate_problem(model,{**model['defaults'],'probe_x':1,'view_radius':2})
    assert a['series'] != b['series']
    assert b['domain']==dict(x_min=-1,x_max=3)
    assert p['solution']['answer']==answer

def test_continuity_point_value_changes_experimental_classification():
    p=compile_kernel_problem(dict(task='continuity',conditions=dict(expression='sin(x)/x',variable='x',point='0',value_mode='undefined')))
    a=evaluate_problem(p['model'],{**p['model']['defaults'],'point_value':1})
    b=evaluate_problem(p['model'],{**p['model']['defaults'],'point_value':2})
    assert a['metrics'][-1]['value']=='连续'
    assert b['metrics'][-1]['value']=='可去间断点'

def test_series_terms_change_partial_sum():
    p=compile_kernel_problem(dict(task='series_convergence',conditions=dict(term='1/n^2',index_start=1)))
    a=evaluate_problem(p['model'],{'terms':5})
    b=evaluate_problem(p['model'],{'terms':10})
    assert len(a['series'])==5 and len(b['series'])==10
    assert a['approx'] < b['approx']


def test_fractional_observation_values_survive_state_normalization():
    from app.labs.store import normalize_params
    p=compile_kernel_problem(dict(task='multivariable_extrema',conditions=dict(expression='x^2+y^2',operation='unconstrained',variables='x,y')))
    saved=normalize_params({'probe_x':0.25,'view_radius':1.5},p['model'])
    assert saved['probe_x']==0.25 and saved['view_radius']==1.5


def test_unbound_goal_does_not_send_unusable_large_plan_to_model(monkeypatch):
    from app.labs import orchestrator
    monkeypatch.setattr('app.labs.staged_understanding.request_json', lambda *a: pytest.fail('unbound plans cannot pass validation'))
    with pytest.raises(ValueError,match='完整条件'):
        orchestrator._ai_plan('缺上限',dict(asked=[dict(id='Q1')],mapping={}),0)


def test_power_radius_has_explicit_partial_sum_observation():
    p=compile_kernel_problem(dict(task='power_series',conditions=dict(goal='radius',coefficient='1',center='0',index_start=0)))
    assert p['model']['observation_partial']
    assert any(v['id']=='view_radius' for v in p['model']['params'])
    r=evaluate_problem(p['model'],{**p['model']['defaults'],'probe_x':0.5})
    assert len(r['series'])==201

def test_space_controls_are_attached_and_retained():
    p=compile_kernel_problem(dict(task='space_geometry',conditions=dict(geometry_kind='point_plane_distance',point=['0','0','0'],plane=['1','0','0','-2'])))
    assert {'view_yaw','view_zoom'} <= {v['id'] for v in p['model']['params']}
    r=evaluate_problem(p['model'],{'view_yaw':45,'view_zoom':1.5})
    assert r['space']['view_yaw']==45 and r['space']['view_zoom']==1.5
