import copy
from app.api.routes_labs import _apply_composite
from app.labs import orchestrator
from app.labs.ai_solve import attach_interactive_model, review_ai_conditions
from app.labs.recognize import build_problem


def test_failed_orchestration_preserves_local_model():
    p = build_problem('计算定积分 ∫_0^2 x^2 dx。')
    document = {'problems': [p], 'status': 'ready'}
    before = copy.deepcopy(p)
    _apply_composite(document, {'status': '失败', 'solve': {'steps': []}})
    assert document['problems'][0] == before
    assert document['status'] == 'ready'


def test_separate_endpoints_create_executable_plan():
    given = [dict(id='A0', ref='expression', value='x^2'), dict(id='A1', ref='lower', value=0),
             dict(id='A2', ref='upper', value=2), dict(id='A3', ref='variable', value='x')]
    mapping = orchestrator._mapping_for_ai_goal('计算定积分', given)
    # Variable is an explicit source condition, never a guessed constant.
    mapping['fields']['variable'] = 'A3'
    u = dict(given=given, asked=[dict(id='Q1', goal='计算定积分')], mapping={'Q1': mapping})
    plan = orchestrator.deterministic_plan('', u)
    assert plan['steps'][0]['inputs']['upper']['ref'] == 'A2'
    assert not orchestrator.validate_plan(plan, u)['errors']


def test_missing_ai_condition_is_editable_and_recomputed(monkeypatch):
    from app.labs import ai_contract, ai_solve
    from app.labs.ai_solve import run_kernel
    monkeypatch.setattr(ai_solve, 'run_kernel', run_kernel)
    p = build_problem('自然语言积分题')
    data = dict(question='积分', conditions=[], uncertainties=['缺上限'],
                model=dict(kind='kernel', task='integral', conditions=dict(expression='x^2', variable='x', lower=0)), unsupported_reason='')
    p['ai_solution'] = ai_contract.finish_understanding(data, p)
    assert not attach_interactive_model(p, p['ai_solution'])
    assert any(c['id'] == 'upper' for c in p['recognition']['conditions'])
    rebuilt = review_ai_conditions(p, {'upper': '2'}, {})
    assert rebuilt['status'] == 'ready'
    assert rebuilt['model']['modeling_task'] == 'integral'
    assert rebuilt['ai_solution']['agent_understanding']['model']['conditions']['upper'] == 2


def test_ode_plot_controls_change_evaluation():
    from app.labs.kernel_models import compile_kernel_problem
    from app.labs.ode import evaluate_ode
    p = compile_kernel_problem({'task': 'ode', 'conditions': {'equation': "y'=y", 'initial_conditions': ['y(0)=1']}})
    assert {v['id'] for v in p['model']['params']} == {'x_min', 'x_max'}
    result = evaluate_ode(p['model'], {'x_min': -1, 'x_max': 1})
    assert result['domain'] == {'x_min': -1, 'x_max': 1}


def test_fourier_truncation_control_recomputes_partial_sum():
    from app.labs.kernel_models import compile_kernel_problem
    from app.labs.series import evaluate_fourier
    p = compile_kernel_problem({'task': 'fourier_series', 'conditions': {'expression': 'x', 'lower': '-pi', 'upper': 'pi', 'order': 3}})
    assert p['model']['params'][0]['id'] == 'order'
    result = evaluate_fourier(p['model'], {'order': 1})
    assert result['fourier']['order'] == 1
