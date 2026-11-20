import pytest
from app.labs.kernel_models import TASKS
from app.labs.staged_understanding import task_schema, candidate_tasks

@pytest.mark.parametrize('task', ['continuity','multivariable','multivariable_extrema','series_convergence','ode','space_geometry'])
def test_task_schema_covers_every_kernel_field(task):
    schema=task_schema(task)
    assert set(TASKS[task]['required']+TASKS[task]['optional']) <= set(schema['properties'])

@pytest.mark.parametrize('task,text', [('continuity','判断函数在0处的连续性'),('multivariable','求二元函数的方向导数'),('multivariable_extrema','求二元函数的无约束局部极值'),('series_convergence','判断数项级数的敛散性'),('ode','求常微分方程的特解'),('space_geometry','求点到平面的距离')])
def test_specific_math_goals_have_a_task_schema(task,text):
    assert candidate_tasks({'question':text})==[task]


def test_kernel_variables_array_is_normalized_for_all_tasks():
    from app.labs.model_contract import normalize_plan
    plan = normalize_plan({'kind': 'kernel', 'task': 'multivariable', 'conditions': {
        'expression': 'x^2+y^2', 'variables': ['x', 'y'], 'operation': 'gradient', 'point': ['1', '2']}})
    assert plan['conditions']['variables'] == 'x,y'
    plan = normalize_plan({'kind': 'kernel', 'task': 'multivariable_extrema', 'conditions': {
        'expression': 'x^2+y^2', 'variables': ['x', 'y'], 'operation': 'local_extrema'}})
    assert plan['conditions']['variables'] == 'x,y'
    for task, extra in (('constrained_extrema', {'constraint': 'x+y=1'}),
                        ('optimization', {'goal': 'extrema', 'bounds': {}})):
        plan = normalize_plan({'kind': 'kernel', 'task': task, 'conditions': {
            'expression': 'x*y', 'variables': ['x', 'y'], **extra}})
        assert plan['conditions']['variables'] == ['x', 'y']


def test_explicit_missing_initial_condition_cannot_be_invented(monkeypatch):
    from app.labs import staged_understanding as s
    reading=dict(question="求微分方程y'=y的特解，初值条件待补充。",target='特解',subquestions=[],relations=[],uncertainties=[],
        conditions=[dict(id='c1',value="y'=y",excerpt="y'=y")])
    model=dict(task='ode',conditions=dict(equation="y'=y",initial_conditions=['y(0)=99']),bindings=dict(equation=['c1']))
    responses=iter([reading,model])
    monkeypatch.setattr(s,'request_json',lambda *a:next(responses))
    result=s.understand_staged({'text':reading['question']})
    assert result['verification']=='needs_review'
    assert result['computation'] is None
    assert result['agent_understanding']['model']['conditions']['initial_conditions'] is None


def test_plane_equation_compiles_from_source_without_guessing_coefficients():
    from app.labs.source_task_compiler import compile_source_task
    from app.labs.kernel_models import compile_kernel_problem
    reading=dict(conditions=[dict(id='a',value='(0,0,0)'),dict(id='b',value='x-2=0')])
    model=compile_source_task('space_geometry',reading,'求点(0,0,0)到平面 x-2=0 的距离。')
    assert model['conditions']['plane']==['1','0','0','-2']
    assert compile_kernel_problem(model)['solution']['answer']=='点到平面距离 2'


def test_replenishing_function_value_is_not_a_concept_question():
    from app.labs.staged_understanding import unsupported_boundary
    assert unsupported_boundary('判断sin(x)/x在0处的连续性，该点补定义的函数值待补充。')==''


def test_failed_ai_mapping_cannot_leave_an_unverified_local_answer_visible():
    from app.labs.ai_solve import attach_interactive_model
    p=dict(status='ready',solution=dict(answer='教学示例答案'),model={},recognition={})
    result=dict(verification='needs_review',agent_understanding=dict(model=dict(kind='none')))
    assert not attach_interactive_model(p,result)
    assert p['status']=='needs_review' and p['solution']['answer']==''


def test_particular_solution_without_initial_data_is_a_fillable_condition():
    from app.labs.staged_understanding import validate_goal_coverage
    from app.labs.kernel_models import ModelConditionsError
    with pytest.raises(ModelConditionsError) as exc:
        validate_goal_coverage({'question':"求微分方程y'=y的特解"},{'task':'ode','conditions':{'equation':"y'=y"}})
    assert '初值条件' in exc.value.missing_conditions


@pytest.mark.parametrize('task,field', [('continuity','point_value'),('multivariable','direction'),('ode','initial_conditions'),('space_geometry','plane')])
def test_null_optional_missing_field_always_has_a_blocking_form_item(task,field):
    from app.labs.ai_solve import attach_interactive_model
    from app.labs.kernel_models import FIELD_LABELS
    p=dict(model={},recognition={},solution={})
    r=dict(verification='needs_review',missing_conditions=[FIELD_LABELS[field]],agent_understanding=dict(model=dict(task=task,conditions={field:None})))
    attach_interactive_model(p,r)
    assert any(a.get('field')==field and a['severity']=='blocking' for a in p['recognition']['ambiguities'])
    assert len([c for c in p['recognition']['conditions'] if c['id']==field])==1


def test_ode_review_accepts_human_initial_condition_text():
    from app.labs.ai_solve import review_ai_conditions
    from app.labs.ai_contract import finish_understanding
    from app.labs.recognize import build_problem
    p=build_problem("求微分方程y'=y的特解，初值待补充")
    u=dict(question=p['text'],conditions=[],uncertainties=['初值条件'],unsupported_reason='',model=dict(kind='kernel',task='ode',conditions=dict(equation="y'=y",initial_conditions=None)))
    p['ai_solution']=finish_understanding(u,p)
    result=review_ai_conditions(p,{'initial_conditions':'y(0)=2'},{})
    assert result['ai_solution']['verification']=='kernel'
    assert '2*exp(x)' in result['solution']['answer']
