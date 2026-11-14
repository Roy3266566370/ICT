import math
import pytest


def test_limit_keeps_exponent_and_point():
    from app.labs.source_task_compiler import compile_source_task
    reading={'conditions':[{'id':'a','value':'(1+exp(x))/2'}]}
    model=compile_source_task('limit',reading,'求极限 lim(x->0) (((1+exp(x))/2)^(1/tan(x)))。')
    assert '1/tan(x)' in model['conditions']['expression']
    assert model['conditions']['point']==0
    assert 'a' in model['bindings']['expression']


def test_ode_keeps_zero_rhs_and_not_require_initial_conditions():
    from app.labs.source_task_compiler import compile_source_task
    reading={'conditions':[{'id':'a','value':"y'''-2*y''+5*y'"}]}
    model=compile_source_task('ode',reading,"求微分方程 y'''-2*y''+5*y'=0 的通解。")
    assert model['conditions']['equation'].endswith('=0')
    assert 'initial_conditions' not in model['conditions']


def test_polar_area_preserves_radius_and_angle_bounds():
    from app.labs.source_task_compiler import compile_source_task
    reading={'conditions':[{'id':'a','value':'r=sin(3θ)'}]}
    model=compile_source_task('double_integral',reading,
        '曲线L的极坐标方程为r=sin(3*theta)，0<=theta<=pi/3。求L围成的有界区域面积。')
    assert model['conditions']['polar']=={'theta_bounds':['0','pi/3'],'r_bounds':['0','sin(3*theta)']}
    assert model['conditions']['integrand']=='1'
    assert len(reading['conditions'])>1


def test_extra_constraint_is_not_implicitly_consumed():
    from app.labs.source_task_compiler import compile_source_task
    from app.labs.staged_understanding import validate_bindings
    reading={'conditions':[{'id':'a','value':'x>0'}]}
    model=compile_source_task('limit',reading,'求极限 lim(x->0) (sin(x)/x)。')
    with pytest.raises(ValueError,match='a'):
        validate_bindings(reading['conditions'],model)


def test_ode_transcription_corrected_only_against_literal_source_equation():
    from app.labs.source_task_compiler import compile_source_task
    reading={'conditions':[{'id':'a','value':"y''''-y=0",'excerpt':"y'''-y=0"},
                           {'id':'b','value':'y','excerpt':'y'}]}
    model=compile_source_task('ode',reading,"求微分方程 y'''-y=0 的通解。")
    assert reading['conditions'][0]['value']=="y'''-y=0"
    assert reading['extraction_corrections'][0]['previous']=="y''''-y=0"
    assert set(model['bindings']['equation'])>={'a','b'}


@pytest.mark.parametrize('task,source',[
    ('ode',"求微分方程 y'-y=0 的通解，并利用条件y(0)=1确定常数。"),
    ('ode',"求微分方程 y'-y=0，y(0)=1 的通解。"),
    ('double_integral','极坐标方程r=2，0<=theta<=pi。求满足r>=1的区域面积。')])
def test_source_suffix_constraints_require_review(task,source):
    from app.labs.source_task_compiler import compile_source_task
    reading={'conditions':[]}
    assert compile_source_task(task,reading,source) is None
    assert reading['source_coverage_issues']


def test_optimization_compiles_function_definition():
    from app.labs.source_task_compiler import compile_source_task
    reading={'conditions':[{'id':'a','value':'f(x,y) = 2x^3 - 9x^2 - 6y^4 + 12x + 24y'},
                           {'id':'b','value':'x'},{'id':'c','value':'y'}]}
    model=compile_source_task('optimization',reading,
        '求函数f(x,y)=2*x^3-9*x^2-6*y^4+12*x+24*y的极值点。')
    assert model['conditions']=={'expression':'2*x^3-9*x^2-6*y^4+12*x+24*y',
        'variables':['x','y'],'goal':'extrema','bounds':{}}
    assert 'a' in model['bindings']['expression']
    assert set(model['bindings']['variables'])>={'b','c'}
    assert len(reading['conditions'])==4


def test_optimization_bindings_cover_real_reading_facts():
    from app.labs.source_task_compiler import compile_source_task
    from app.labs.staged_understanding import validate_bindings
    reading={'conditions':[{'id':'a','value':'f(x,y) = 2x^3 - 9x^2 - 6y^4 + 12x + 24y'},
                           {'id':'b','value':'x'},{'id':'c','value':'y'}]}
    model=compile_source_task('optimization',reading,
        '求函数f(x,y)=2*x^3-9*x^2-6*y^4+12*x+24*y的极值点。')
    validate_bindings(reading['conditions'],model)


def test_optimization_two_clause_definition():
    from app.labs.source_task_compiler import compile_source_task
    model=compile_source_task('optimization',{'conditions':[{'id':'a','value':'x^2'}]},
        '设f(x)=x^2，求极值。')
    assert model['conditions']=={'expression':'x^2','variables':['x'],'goal':'extrema','bounds':{}}


def test_higher_derivative_compiles_order_and_point():
    from app.labs.source_task_compiler import compile_source_task
    from app.labs.staged_understanding import validate_bindings
    reading={'conditions':[{'id':'a','value':'f(x)'},
                           {'id':'b','value':'x^2'},{'id':'c','value':'exp(x)-1'}]}
    model=compile_source_task('higher_derivative',reading,
        '已知f(x)=x^2*(exp(x)-1)，求f在x=1处的第五阶导数。')
    assert model['conditions']=={'expression':'x^2*(exp(x)-1)','variable':'x','order':5,'point':1}
    validate_bindings(reading['conditions'],model)


@pytest.mark.parametrize('phrase,order',[('五',5),('5',5),('十',10),('两',2),('三',3)])
def test_higher_derivative_order_forms(phrase,order):
    from app.labs.source_task_compiler import compile_source_task
    model=compile_source_task('higher_derivative',{'conditions':[]},f'求f(x)=x^2的第{phrase}阶导数。')
    assert model['conditions']['order']==order
    assert 'point' not in model['conditions']


def test_higher_derivative_two_sentence_definition():
    from app.labs.source_task_compiler import compile_source_task
    model=compile_source_task('higher_derivative',{'conditions':[]},
        '设f(x)=x^2*(exp(x)-1)。求f在x=1处的第五阶导数。')
    assert model['conditions']['point']==1
    assert model['conditions']['order']==5


def test_higher_derivative_rejects_out_of_range_order():
    from app.labs.source_task_compiler import compile_source_task
    reading={'conditions':[]}
    assert compile_source_task('higher_derivative',reading,'求f(x)=x^2的第12阶导数。') is None
    assert reading['source_coverage_issues']


def test_optimization_rejects_constrained_or_partial_goal():
    from app.labs.source_task_compiler import compile_source_task
    reading={'conditions':[]}
    assert compile_source_task('optimization',reading,'求函数f(x,y)=x^2+y^2在约束g(x,y)=0下的极值。') is None
    assert reading['source_coverage_issues']
    reading={'conditions':[]}
    assert compile_source_task('optimization',reading,'求函数f(x)=x^2的极大值。') is None
    assert reading['source_coverage_issues']


def test_compiled_models_are_kernel_consumable():
    from app.labs.source_task_compiler import compile_source_task
    from app.labs.kernel_models import compile_kernel_problem, _validate
    model=compile_source_task('optimization',{'conditions':[]},
        '求函数f(x,y)=2*x^3-9*x^2-6*y^4+12*x+24*y的极值点。')
    _validate('optimization',model['conditions'])
    problem=compile_kernel_problem(model)
    assert '(1, 1)' in problem['solution']['answer']
    model=compile_source_task('higher_derivative',{'conditions':[]},
        '已知f(x)=x^2*(exp(x)-1)，求f在x=1处的第五阶导数。')
    _validate('higher_derivative',model['conditions'])
    problem=compile_kernel_problem(model)
    assert problem['solution']['derivative_value'] == pytest.approx(31*math.e)


def test_higher_derivative_binds_english_order_fact():
    from app.labs.source_task_compiler import compile_source_task
    from app.labs.staged_understanding import validate_bindings
    reading={'conditions':[{'id':'a','value':'f(x)'},{'id':'b','value':'x'},
                           {'id':'c','value':'5th derivative'}]}
    model=compile_source_task('higher_derivative',reading,
        '已知f(x)=x^2*(exp(x)-1)，求f在x=1处的第五阶导数。')
    assert model['conditions']['order']==5
    validate_bindings(reading['conditions'],model)


def test_higher_derivative_binds_clause_form_goal_fact():
    from app.labs.source_task_compiler import compile_source_task
    from app.labs.staged_understanding import validate_bindings
    reading={'conditions':[{'id':'a','value':'x^2*(exp(x)-1)'},
                           {'id':'b','value':'求f在x=1处的第五阶导数'}]}
    model=compile_source_task('higher_derivative',reading,
        '已知f(x)=x^2*(exp(x)-1)，求f在x=1处的第五阶导数。')
    assert model['conditions']['order']==5 and model['conditions']['point']==1
    validate_bindings(reading['conditions'],model)
