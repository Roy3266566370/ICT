"""AI conditions must reach native kernels and their existing graphical models."""
import json

import pytest

from app.labs.ai_solve import compute_plan


CASES = [
    ('integral', {'expression':'x^2','variable':'x','lower':0,'upper':2}, 'riemann_v1'),
    ('antiderivative', {'expression':'x*cos(x)','variable':'x'}, 'antiderivative_v1'),
    ('derivative', {'expression':'x^3','variable':'x','point':2}, 'tangent_v1'),
    ('geometric_area', {'expression':'x^2','lower':0,'upper':1,'region_kind':'between_axis'}, 'sympy'),
    ('rotation_volume', {'expression':'x^2','lower':0,'upper':1,'region_kind':'vertical_inequality','rotation_axis':'x'}, 'sympy'),
    ('rotation_volume', {'expression':'x','lower':0,'upper':1,'region_kind':'between_axis','rotation_axis':'y'}, 'sympy'),
    ('geometric_area', {'expression':'x','lower_expression':'x^2','lower':0,'upper':1,'region_kind':'between_curves'}, 'sympy'),
    ('integral_function', {'expression':'sin(t)','lower_expression':'0','upper_expression':'x^2'}, 'integral_function_v1'),
    ('parametric_derivative', {'x_expression':'t^2','y_expression':'t^3','point':'1','order':1}, 'derivative_extra_v1'),
    ('implicit_derivative', {'implicit_expression':'x^2+y^2=1','point_x':'0','point_y':'1','order':2}, 'derivative_extra_v1'),
    ('curvature', {'expression':'x^2','point':'1'}, 'derivative_extra_v1'),
    ('arc_length', {'expression':'(2/3)*x^(3/2)','lower':'0','upper':'3'}, 'integral_applications_v1'),
    ('polar_area', {'expression':'1+cos(theta)','lower':'0','upper':'2*pi'}, 'integral_applications_v1'),
    ('surface_of_revolution', {'expression':'sqrt(x)','lower':'0','upper':'1','rotation_axis':'x'}, 'integral_applications_v1'),
    ('implicit_normal', {'implicit_expression':'x^2+y^2-1','point_x':0,'point_y':1}, 'sympy'),
    ('double_integral', {'integrand':'x+y','outer_variable':'x','outer_bounds':['0','1'],'inner_bounds':['0','x']}, 'double_integral_v1'),
    ('optimization', {'expression':'(x-1)^2+(y+2)^2','variables':['x','y'],'goal':'extrema','bounds':{}}, 'gradient_descent_v1'),
    ('bfs', {'nodes':['A','B','C','Z'],'edges':[{'from':'A','to':'B'},{'from':'A','to':'C'}],
             'start':'A','directed':True,'neighbor_order':'lexicographic_by_id'}, 'bfs_v1'),
    ('heap', {'initial_heap':[9,7,8,1],'heap_type':'max','deletion_count':1}, 'heap_v1'),
    ('linear_system', {'matrix_a':[[2,1],[1,-1]],'vector_b':[7,-1]}, 'gauss_v1'),
    ('determinant', {'matrix_a':[[2,1],[1,-1]]}, 'gauss_v1'),
    ('inverse', {'matrix_a':[[2,1],[1,-1]]}, 'gauss_v1'),
    ('matmul', {'matrix_a':[[1,2],[3,4]],'matrix_b':[[0,1],[1,0]],'op':'mul'}, 'matmul_v1'),
    ('cpu_schedule', {'processes':[{'id':'JobA','arrival':0,'burst':3},{'id':'JobB','arrival':1,'burst':2}], 'algorithm':'fcfs'}, 'os_sched_v1'),
    ('page_replace', {'reference':['1','2','3','1','4','2'],'frames':3,'algorithm':'lru'}, 'os_page_v1'),
    ('disk_schedule', {'requests':[10,40,20],'head':25,'algorithm':'sstf'}, 'os_disk_v1'),
    ('banker', {'names':['WorkerA','WorkerB'],'allocation':[[1],[0]],'max':[[2],[1]],'available':[1]}, 'os_banker_v1'),
    ('neural_training', {'layers':[1,1],'activations':['linear'],'weights':[[[2]]],'biases':[[1]],
                         'input':[3],'target':[5],'learning_rate':0.01,'epochs':1}, 'mlp_v1'),
]


@pytest.mark.parametrize('task,conditions,engine', CASES, ids=[v[0] for v in CASES])
def test_structured_conditions_produce_native_executable_graphical_models(task,conditions,engine):
    r = compute_plan({'kind':'kernel','task':task,'conditions':conditions})
    assert r['interactive_model']['engine'] == engine
    assert r['interactive_solution']['answer']
    assert r['interactive_recognition']['conditions']
    assert not r['interactive_model'].get('teaching')
    assert not any(c['status']=='fail' for c in r['checks'])
    assert r['expected']['evaluation']['trace']
    json.dumps(r,allow_nan=False)


def test_kernel_keeps_graph_direction_isolated_nodes_and_process_names():
    by_task = {task:c for task,c,_ in CASES}
    bfs = compute_plan({'kind':'kernel','task':'bfs','conditions':by_task['bfs']})['interactive_model']
    assert bfs['directed'] is True
    assert [n['id'] for n in bfs['nodes']] == ['A','B','C','Z']
    banker = compute_plan({'kind':'kernel','task':'banker','conditions':by_task['banker']})['interactive_model']
    assert banker['names'] == ['WorkerA','WorkerB']


def test_neural_model_preserves_supplied_biases_and_activations():
    c = dict(next(c for t,c,_ in CASES if t=='neural_training'))
    r = compute_plan({'kind':'kernel','task':'neural_training','conditions':c})
    m = r['interactive_model']
    assert m['biases'] == [[1]]
    assert m['weights'] == [[[2]]]
    assert r['expected']['evaluation']['loss_history'][-1] == pytest.approx(2.56)


def test_single_isolated_bfs_node_never_inherits_a_teaching_graph_start():
    r=compute_plan({'kind':'kernel','task':'bfs','conditions':{'nodes':['Z'],'edges':[],'start':'Z',
        'directed':False,'neighbor_order':'lexicographic_by_id'}})
    assert r['interactive_model']['defaults']['start']=='Z'
    assert r['expected']['evaluation']['order']==['Z']
    assert not any(c['provenance']=='teaching' for c in r['interactive_recognition']['conditions'])


def test_gradient_descent_answers_requested_iteration_instead_of_stationary_point():
    r=compute_plan({'kind':'kernel','task':'optimization','conditions':{'expression':'x^2','variables':['x'],
        'goal':'gradient_descent','bounds':{},'initial_point':[1],'learning_rate':0.1,'iterations':1}})
    assert r['interactive_model']['goal']=='gradient_descent'
    assert r['interactive_solution']['iteration_point']==pytest.approx([0.8])
    assert r['interactive_solution']['iteration_value']==pytest.approx(0.64)
    assert 'x*=0' not in r['answer']


def test_optimization_preserves_scientific_numeric_conditions_without_reparsing_prose():
    r=compute_plan({'kind':'kernel','task':'optimization','conditions':{'expression':'x^2','variables':['x'],
        'goal':'gradient_descent','bounds':{'x':[1e-5,1e-4]},'initial_point':[2e-5],'learning_rate':1e-5,'iterations':1}})
    m=r['interactive_model']
    assert m['defaults']['x0']==2e-5
    assert m['defaults']['learning_rate']==1e-5
    assert m['bounds']=={'x':[1e-5,1e-4]}


def test_heap_insert_mode_and_compare_count_reach_native_kernel():
    inserted=compute_plan({'kind':'kernel','task':'heap','conditions':{
        'initial_heap':[5,3,8,1,9],'heap_type':'max','operation':'insert'}})
    assert inserted['interactive_model']['operation']=='insert'
    assert inserted['expected']['evaluation']['final_heap']==[9,8,5,1,3]
    assert '9, 8, 5, 1, 3' in inserted['answer']
    counted=compute_plan({'kind':'kernel','task':'heap_compare','conditions':{
        'initial_heap':[9,7,8,1,5],'heap_type':'max','operation':'delete','deletion_count':1}})
    assert counted['expected']['evaluation']['compare_count']==2
    assert '2' in counted['answer'] and counted['interactive_solution']['limitations']


def test_binary_search_worst_case_count_is_deterministic_and_documented():
    for n,expected in ((1,1),(2,2),(3,2),(7,3),(8,4),(1000,10)):
        r=compute_plan({'kind':'kernel','task':'binary_search_count','conditions':{'n':n}})
        assert r['expected']['evaluation']['comparisons']==expected, n
        assert str(expected) in r['answer']
        assert any('mid' in note and '向下取整' in note for note in r['interactive_solution']['limitations'])
    with pytest.raises(ValueError):
        compute_plan({'kind':'kernel','task':'binary_search_count','conditions':{'n':0}})


@pytest.mark.parametrize('task,conditions', [
    ('heap',{'initial_heap':[],'heap_type':'max','operation':'insert'}),
    ('heap',{'initial_heap':[1,2],'operation':'insert'}),
    ('heap_compare',{'initial_heap':[9,7,8],'heap_type':'max','operation':'delete'}),
    ('binary_search_count',{'n':'十'}),
])
def test_counting_tasks_reject_missing_or_invalid_conditions(task,conditions):
    with pytest.raises(ValueError):
        compute_plan({'kind':'kernel','task':task,'conditions':conditions})


def test_symbolic_integral_endpoints_and_named_resource_requests_round_trip():
    import math
    r=compute_plan({'kind':'kernel','task':'integral','conditions':{'expression':'x','variable':'x','lower':'0','upper':'pi'}})
    assert r['interactive_solution']['answer_value']==pytest.approx(math.pi**2/2)
    r=compute_plan({'kind':'kernel','task':'banker','conditions':{'names':['WorkerA'],'allocation':[[0]],'max':[[2]],'available':[2],
        'request':{'process':'WorkerA','vector':[1]}}})
    assert r['expected']['evaluation']['stats']['granted'] is True


@pytest.mark.parametrize('changed', [{'allocation':[[-1]]},{'available':[-1]},{'request':{'process':'P0','vector':[-1]}}])
def test_bankers_resources_are_nonnegative_counts(changed):
    with pytest.raises(ValueError):
        compute_plan({'kind':'kernel','task':'banker','conditions':{'names':['P0'],'allocation':[[0]],'max':[[2]],'available':[2],**changed}})


def test_neural_extracted_condition_uses_actual_activation():
    c=next(c for t,c,_ in CASES if t=='neural_training')
    r=compute_plan({'kind':'kernel','task':'neural_training','conditions':c})
    activation=next(v for v in r['interactive_recognition']['conditions'] if v['id']=='activation')
    assert activation['value']=='linear' and activation['provenance']!='teaching'


@pytest.mark.parametrize('task,conditions', [
    ('integral',{'expression':'x','variable':'x','lower':0}),
    ('bfs',{'nodes':['A'],'edges':[],'start':'A'}),
    ('cpu_schedule',{'algorithm':'rr','processes':[{'id':'P','arrival':0,'burst':1}]}),
    ('page_replace',{'reference':['1','2'],'algorithm':'lru'}),
    ('optimization',{'expression':'x^2','variables':['x'],'goal':'gradient_descent','bounds':{}}),
    ('neural_training',{'layers':[1,1],'weights':[[[2]]]}),
])
def test_missing_conditions_raise_explicit_questions_instead_of_teaching_defaults(task,conditions):
    from app.labs.kernel_models import ModelConditionsError
    with pytest.raises(ModelConditionsError) as failure:
        compute_plan({'kind':'kernel','task':task,'conditions':conditions})
    assert failure.value.missing_conditions


@pytest.mark.parametrize('task,conditions', [
    ('integral',{'expression':'x','variable':'x','lower':0,'upper':1,'constraints':['x>2']}),
    ('determinant',{'matrix_a':[[1,2],[3]]}),
    ('cpu_schedule',{'algorithm':'invented','processes':[{'id':'P','arrival':0,'burst':1}]}),
    ('bfs',{'nodes':['A'],'edges':[{'from':'A','to':'B'}],'start':'A','directed':False,'neighbor_order':'lexicographic_by_id'}),
    ('page_replace',{'reference':['1','2'],'frames':1.5,'algorithm':'lru'}),
    ('optimization',{'expression':'x^2','variables':['x'],'goal':'extrema','bounds':{'x':[2,1]}}),
    ('neural_training',{'layers':[1,1],'activations':['linear'],'weights':[[[2]]],'biases':[[1,2]],
                        'input':[3],'target':[5],'learning_rate':0.01,'epochs':1}),
    ('rotation_volume',{'expression':'x','lower':-1,'upper':1,'region_kind':'between_axis','rotation_axis':'y'}),
    ('geometric_area',{'expression':'x','lower':0,'upper':1,'region_kind':'between_curves'}),
])
def test_invalid_or_unconsumed_conditions_never_silently_change_the_model(task,conditions):
    with pytest.raises(ValueError):
        compute_plan({'kind':'kernel','task':task,'conditions':conditions})
