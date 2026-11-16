import copy
import pytest
from PIL import Image


def test_double_integral_routing_and_raw_region_contract():
    from app.labs.staged_understanding import candidate_tasks, modelling_catalog
    assert candidate_tasks({'question':'求二重积分', 'conditions':[]}) == ['double_integral']
    assert 'region_text' in modelling_catalog(['double_integral'])['double_integral']['notes']


def test_empty_initial_state_and_goal_are_accounted_not_deleted():
    from app.labs.staged_understanding import account_facts
    reading = {'question':'LRU，初始为空，求缺页次数', 'target':'缺页次数', 'conditions':[
        {'id':'c1','value':'初始为空','excerpt':'初始为空'},
        {'id':'c2','value':'缺页次数','excerpt':'求缺页次数'}]}
    accounted = account_facts(reading, 'page_replace')
    assert accounted == {'c1':'kernel_precondition:empty_initial_frames', 'c2':'goal:page_fault_count'}
    assert len(reading['conditions']) == 2


@pytest.mark.parametrize('value', ['初始不为空', '初始为空，但页面1已经装入', '初始为空，x>0'])
def test_initial_state_exception_cannot_swallow_other_conditions(value):
    from app.labs.staged_understanding import account_facts
    reading = {'question':value, 'target':'', 'conditions':[{'id':'c1','value':value,'excerpt':value}]}
    assert 'c1' not in account_facts(reading,'page_replace')


def test_page_replace_cannot_discard_positive_constraint():
    from app.labs.staged_understanding import validate_bindings
    with pytest.raises(ValueError, match='c2'):
        validate_bindings([{'id':'c1'}, {'id':'c2','value':'x>0'}],
                          {'conditions':{'frames':3},'bindings':{'frames':['c1']}})


def test_exact_mapping_repairs_region_reference_without_dropping_extra_constraint():
    from app.labs.staged_understanding import reconcile_bindings
    facts=[{'id':'c1','value':r'$D=\{(x,y)|y^2\le x,x^2\le y\}$'},
           {'id':'c2','value':'x>0'}]
    model={'conditions':{'region_text':'D={y^2<=x,x^2<=y}'},'bindings':{}}
    fixed=reconcile_bindings(facts,model)
    assert fixed['bindings']['region_text']==['c1']
    assert all('c2' not in refs for refs in fixed['bindings'].values())


def test_reversed_inequality_does_not_match():
    from app.labs.staged_understanding import reconcile_bindings
    fixed=reconcile_bindings([{'id':'c1','value':'D={x>0}'}],
                             {'conditions':{'region_text':'D={x<0}'},'bindings':{}})
    assert fixed['bindings']=={}


def test_fake_reference_binding_and_nonempty_source_are_rejected():
    from app.labs.staged_understanding import validate_page_model
    reading={'conditions':[{'id':'c1','value':'1,2,3','excerpt':'访问序列1,2,3'}]}
    model={'task':'page_replace','conditions':{'reference':[1,2,4],'frames':3,'algorithm':'lru'},
           'bindings':{'reference':['c1']}}
    with pytest.raises(ValueError):
        validate_page_model(reading,model,'初始为空')
    model['conditions']['reference']=[1,2,3]
    with pytest.raises(ValueError):
        validate_page_model(reading,model,'初始不为空，内存已有页面1')


def test_page_facts_compile_without_example_values_and_keep_all_conditions():
    from app.labs.staged_understanding import compile_page_facts, validate_bindings
    reading={'question':'LRU 初始为空求缺页次数','conditions':[
        {'id':'a','value':'LRU','excerpt':'采用LRU'},
        {'id':'b','value':'3','excerpt':'物理块数为3'},
        {'id':'c','value':'1,2,3,1,4','excerpt':'访问序列为1,2,3,1,4'},
        {'id':'d','value':'x>0','excerpt':'x>0'}]}
    model=compile_page_facts(reading)
    assert model['conditions']=={'algorithm':'lru','frames':3,'reference':[1,2,3,1,4]}
    with pytest.raises(ValueError,match='d'):
        validate_bindings(reading['conditions'],model)


def test_claimed_binding_cannot_hide_inequality():
    from app.labs.staged_understanding import validate_explicit_constraints
    with pytest.raises(ValueError,match='c1'):
        validate_explicit_constraints([{'id':'c1','value':'x>0'}],
            {'conditions':{'expression':'x^2'},'bindings':{'expression':['c1']}})


def test_heap_adapter_preserves_duplicate_action_facts():
    from app.labs.staged_understanding import compile_heap_facts
    facts=[{'id':'a','value':'9,7,8,1','excerpt':'关键字序列9,7,8,1'},
           {'id':'b','value':'大根堆','excerpt':'是大根堆'},
           {'id':'c','value':'删除操作','excerpt':'进行两次删除操作'},
           {'id':'d','value':'删除操作','excerpt':'进行两次删除操作'}]
    model=compile_heap_facts({'conditions':facts})
    assert model['conditions']=={'initial_heap':[9,7,8,1],'heap_type':'max','deletion_count':2}
    assert model['bindings']['deletion_count']==['c','d']


def test_normal_kernel_derives_unique_branch_and_rejects_ambiguous_branch():
    from app.labs.ai_solve import run_kernel
    r=run_kernel({'kind':'kernel','task':'implicit_normal','conditions':{
        'implicit_expression':'3*x^3=y^5+2*y^3','point_x':1}})
    assert '-11/9' in r['answer']
    with pytest.raises(ValueError):
        run_kernel({'kind':'kernel','task':'implicit_normal','conditions':{
            'implicit_expression':'x^2+y^2-1','point_x':0}})


def test_heap_action_cannot_consume_an_extra_sum_constraint():
    from app.labs.staged_understanding import compile_heap_facts
    assert compile_heap_facts({'conditions':[
        {'id':'a','value':'9,7,8,1','excerpt':'关键字序列9,7,8,1'},
        {'id':'b','value':'大根堆','excerpt':'是大根堆'},
        {'id':'c','value':'最终元素总和为100','excerpt':'进行两次删除操作后，最终元素总和为100'}]}) is None


def test_heap_action_excerpt_cannot_hide_an_extra_constraint():
    from app.labs.staged_understanding import compile_heap_facts
    assert compile_heap_facts({'conditions':[
        {'id':'a','value':'9,7,8,1','excerpt':'关键字序列9,7,8,1'},
        {'id':'b','value':'大根堆','excerpt':'是大根堆'},
        {'id':'c','value':'删除操作','excerpt':'进行两次删除操作，元素总和必须为100'}]}) is None


def test_inequality_prefix_is_not_equivalence():
    from app.labs.staged_understanding import validate_explicit_constraints
    with pytest.raises(ValueError):
        validate_explicit_constraints([{'id':'a','value':'x<1'}],
                                     {'conditions':{'region_text':'D={x<10}'}})
    with pytest.raises(ValueError):
        validate_explicit_constraints([{'id':'a','value':'x<1'}],
                                     {'conditions':{'region_text':'D={x<1+y}'}})


def test_heap_source_supplement_keeps_existing_and_adds_missing_operation():
    from app.labs.staged_understanding import supplement_heap_facts, compile_heap_facts
    reading={'conditions':[
        {'id':'a','value':'关键字序列','excerpt':'9,7,8,1'},
        {'id':'b','value':'大根堆','excerpt':'大根堆'}]}
    supplement_heap_facts(reading,'已知关键字序列9,7,8,1是大根堆，对该堆进行两次删除操作。')
    assert len(reading['conditions'])==3
    model=compile_heap_facts(reading)
    assert model['conditions']['deletion_count']==2
    assert model['bindings']['initial_heap']==['a']


def test_page_label_value_and_numeric_excerpt_compile():
    from app.labs.staged_understanding import compile_page_facts
    model=compile_page_facts({'conditions':[
        {'id':'a','value':'LRU','excerpt':'LRU'},
        {'id':'b','value':'物理块数为3','excerpt':'物理块数为3'},
        {'id':'c','value':'访问序列','excerpt':'1,2,3,1,4'}]})
    assert model['conditions']['frames']==3
    assert model['bindings']['reference']==['c']


def test_normal_source_equation_keeps_both_sides():
    from app.labs.staged_understanding import compile_normal_facts
    model=compile_normal_facts({'question':'曲线3*x^3=y^5+2*y^3在x=1处求法线',
        'conditions':[{'id':'a','value':'3*x^3'}, {'id':'b','value':'y^5+2*y^3'},
                      {'id':'c','value':'x=1'}]})
    assert model['conditions']['implicit_expression']=='3*x^3=y^5+2*y^3'
    assert model['bindings']['implicit_expression']==['a','b']


def test_no_heap_operation_inferred_from_negative_or_conditional_clause():
    from app.labs.staged_understanding import supplement_heap_facts
    for source in ('无需进行两次删除操作，保持原堆','若进行两次删除操作，求变化',
                   '不需要对该堆进行两次删除操作'):
        reading={'conditions':[]}
        supplement_heap_facts(reading,source)
        assert reading['conditions']==[]


def test_heap_count_conflict_between_value_and_excerpt_rejected():
    from app.labs.staged_understanding import compile_heap_facts
    with pytest.raises(ValueError,match='冲突'):
        compile_heap_facts({'conditions':[{'id':'a','value':'删除次数为2','excerpt':'进行三次删除操作'}]})


def test_source_task_overrides_hallucinated_target():
    from app.labs.staged_understanding import candidate_tasks
    assert candidate_tasks({'question':'计算定积分从0到1对x积分','target':'不定积分结果'})==['integral']
    assert candidate_tasks({'question':'求极限x趋于0','target':''})==['limit']
    assert candidate_tasks({'question':"求微分方程y''+y=0的通解",'target':''})==['ode']


def test_boundary_is_unsupported_not_missing_data():
    from app.labs.staged_understanding import unsupported_boundary
    for text in ('分时系统时间片轮转调度需要使用哪些组件？',
                 '求微分方程解曲线在给定区间的弧长',
                 '分析该程序段的时间复杂度'):
        assert unsupported_boundary(text)
    # 内核已支持：堆插入建堆、堆操作关键字比较次数、非空初态页面置换——不再是能力边界。
    for text in ('把序列逐个插入初始为空的大根堆',
                 '小根堆删除堆顶，求关键字比较次数',
                 'LRU，0,1,2已调入内存，求缺页次数'):
        assert not unsupported_boundary(text)
    # 循环/递归复杂度已由 ds_analysis 内核支持：不再对包含“时间复杂度”的题一刀切拒绝。
    assert not unsupported_boundary('外层 i 从 1 到 n，内层 j 从 1 到 i，求循环的时间复杂度')
    assert not unsupported_boundary('计算定积分从0到1对x积分')
    assert not unsupported_boundary('函数f(x)=x^2，不需要研究凹凸性，只求从0到1的定积分。')
    # 哈夫曼/散列已由 ds_advanced 支持：不再是能力边界。
    assert not unsupported_boundary('散列表采用线性探查，求查找失败的平均查找长度')
    assert not unsupported_boundary('对给定权值构造哈夫曼树并求带权路径长度')


def test_analysis_image_preserves_original(tmp_path):
    from app.labs.extract import _save_preview
    _save_preview(Image.new('RGB', (2200, 800)), tmp_path, 'page')
    assert Image.open(tmp_path / 'previews/page.png').width == 1400
    assert Image.open(tmp_path / 'analysis/page.png').width == 2200


def test_task_schema_is_specific():
    from app.labs.staged_understanding import task_schema
    schema = task_schema('page_replace')
    assert set(schema['properties']) == {'reference', 'frames', 'algorithm', 'initial_frames'}
    assert 'frames' in schema['required']
    assert schema['properties']['frames']['type'] == 'integer'
    assert schema['properties']['reference']['items']['type'] == 'integer'


def test_bindings_must_cover_conditions():
    from app.labs.staged_understanding import validate_bindings
    facts = [{'id': 'c1', 'value': 'x>0'}]
    with pytest.raises(ValueError, match='c1'):
        validate_bindings(facts, {'conditions': {'expression': 'x^2'}, 'bindings': {}})


def test_binding_to_missing_field_rejected():
    from app.labs.staged_understanding import validate_bindings
    with pytest.raises(ValueError):
        validate_bindings([{'id':'c1'}], {'conditions':{}, 'bindings':{'expression':['c1']}})


def test_two_stage_transport(monkeypatch):
    from app.labs import staged_understanding as s
    fact = dict(id='c1', value='x^2', unit='', excerpt='x^2', page_key=None, bbox=None)
    reading = dict(question='求x^2的不定积分', subquestions=['求积分'], relations=[],
                   target='原函数', conditions=[fact], uncertainties=[])
    model = dict(task='antiderivative', conditions={'expression':'x^2','variable':'x'},
                 bindings={'expression':['c1']}, unsupported_reason='')
    calls=[]
    def fake(messages, schema, deadline):
        calls.append(copy.deepcopy(messages))
        return reading if len(calls)==1 else model
    monkeypatch.setattr(s, 'request_json', fake)
    result=s.understand_staged({'text':reading['question']})
    assert len(calls)==2
    assert result['computation'] is not None
    assert 'kernel_tasks' not in calls[0][-1]['content']
    assert not result['checkable']  # source-to-model semantics still need review
    from app.labs.local_agent import finish_understanding
    confirmed = finish_understanding(result['agent_understanding'], {'text':reading['question']})
    assert not confirmed['checkable']


def test_mapping_failure_is_not_reported_as_missing_question_data(monkeypatch):
    from app.labs import staged_understanding as s
    reading=dict(question='求x^2的不定积分',target='原函数',subquestions=[],relations=[],
        conditions=[dict(id='c1',value='x^2',excerpt='x^2',unit='',page_key=None,bbox=None)],uncertainties=[])
    calls=[]
    def fake(messages,schema,deadline):
        calls.append(1)
        return reading if len(calls)==1 else {'task':'antiderivative','conditions':{},'bindings':{}}
    monkeypatch.setattr(s,'request_json',fake)
    result=s.understand_staged({'text':reading['question']})
    assert result['missing_conditions']==[]
    assert result['failure_stage']=='model_mapping'
    assert result['model_validation_errors']
    assert result['agent_understanding']['conditions'][0]['value']=='x^2'


def test_routing_prefers_specific_higher_derivative_and_constraint_extrema():
    from app.labs.staged_understanding import candidate_tasks
    from app.labs.kernel_models import TASKS
    assert candidate_tasks({'question':'已知f(x)=x^2*(exp(x)-1)，求f在x=1处的第五阶导数。','conditions':[]}) == ['higher_derivative']
    assert candidate_tasks({'question':'求f在x=1处的二阶导数','conditions':[]}) == ['higher_derivative']
    assert candidate_tasks({'question':'求曲线y=x^2在x=1处的切线方程','conditions':[]}) == ['derivative']
    assert candidate_tasks({'question':'求函数f(x,y)=x^2+y^2在约束x+y=1下的极值','conditions':[]}) == ['constrained_extrema']
    assert candidate_tasks({'question':'求函数f(x,y)=x^2+y^2的极值','conditions':[]}) == ['multivariable_extrema']
    assert candidate_tasks({'question':'完全看不懂的题','conditions':[]}) == list(TASKS)


def test_few_shot_examples_cover_ode_higher_derivative_and_optimization():
    from app.labs.staged_understanding import few_shot_examples
    for task in ('ode','higher_derivative','optimization'):
        reading, model = few_shot_examples(task)
        assert model['task'] == task
        assert set(model['bindings']) <= set(model['conditions'])
        assert {ref for refs in model['bindings'].values() for ref in refs} <= {f['id'] for f in reading['conditions']}


def test_expression_fields_reject_equations_but_allow_equation_fields():
    from app.labs.staged_understanding import validate_expression_fields
    with pytest.raises(ValueError, match='右侧'):
        validate_expression_fields({'conditions':{'expression':'f(x)=x^2'}})
    with pytest.raises(ValueError):
        validate_expression_fields({'conditions':{'integrand':'x+y=1'}})
    with pytest.raises(ValueError):
        validate_expression_fields({'conditions':{'term':'1/n^2=0'}})
    validate_expression_fields({'conditions':{'equation':"y'=x",'initial_conditions':['y(0)=1'],
        'constraint':'g(x,y)=0','implicit_expression':'x^2+y^2=1','region_text':'D={x+y<=1}'}})


def test_goal_actions_reject_concept_and_property_questions_with_correct_reason():
    from app.labs.goal_actions import classify_goal_action, unsupported_reason
    questions = (
        '哪些事件可能引起进程调度程序执行？I.中断处理结束；II.进程阻塞；III.进程执行结束；IV.进程时间片用完。',
        '二叉树T中p与q在中序遍历中相邻且p在q前，哪些关系不可能？I.q是p的双亲；II.q是p的右孩子；III.q是p的右兄弟。',
        '分时系统使用时间片轮转调度算法时，进程调度需要使用哪些组件？',
        '关于最短路径，下列说法哪些一定成立？',
    )
    for question in questions:
        reason = unsupported_reason(question)
        assert reason and ('概念' in reason or '性质' in reason), (question, reason)
    assert classify_goal_action('求页面置换的缺页次数') == 'count'
    assert classify_goal_action('计算定积分从0到1对x积分') == 'numeric'
    assert unsupported_reason('计算定积分从0到1对x积分') == ''
    assert classify_goal_action('求函数f(x)=sqrt(x-1)的定义域') == 'numeric'
    assert unsupported_reason('求函数f(x)=sqrt(x-1)的定义域') == ''


def test_binding_value_suspicion_is_flagged_not_blocked():
    from app.labs.staged_understanding import binding_suspicions
    facts = [{'id':'c1','value':'x^3'}]
    notes = binding_suspicions(facts, {'conditions':{'expression':'x^2'},'bindings':{'expression':['c1']}})
    assert notes and 'expression' in notes[0]
    assert binding_suspicions([{'id':'c1','value':'$x^{3}$'}],
                              {'conditions':{'expression':'x^3'},'bindings':{'expression':['c1']}}) == []
    assert binding_suspicions([{'id':'c1','value':'五'}],
                              {'conditions':{'order':5},'bindings':{'order':['c1']}}) == []


def test_goal_coverage_blocks_wrong_derivative_order_and_missing_initial_conditions():
    from app.labs.staged_understanding import validate_goal_coverage
    with pytest.raises(ValueError, match='阶'):
        validate_goal_coverage({'question':'求f在x=1处的第五阶导数'}, {'task':'higher_derivative','conditions':{'order':1}})
    with pytest.raises(ValueError):
        validate_goal_coverage({'question':'求f在x=1处的第五阶导数'}, {'task':'higher_derivative','conditions':{}})
    validate_goal_coverage({'question':'求f在x=1处的第五阶导数'}, {'task':'higher_derivative','conditions':{'order':5}})
    with pytest.raises(ValueError, match='初值|特解'):
        validate_goal_coverage({'question':"微分方程y'=1/(x+y)^2，满足初始条件y(1)=0，求其解"},
                               {'task':'ode','conditions':{'equation':"y'=1/(x+y)^2"}})
    validate_goal_coverage({'question':"微分方程y'=1/(x+y)^2，满足初始条件y(1)=0，求其解"},
                           {'task':'ode','conditions':{'equation':"y'=1/(x+y)^2",'initial_conditions':['y(1)=0']}})


def test_chained_inequality_is_checked_segmentwise():
    from app.labs.staged_understanding import validate_explicit_constraints
    validate_explicit_constraints([{'id':'c1','value':'0<x<1'}], {'conditions':{'region_text':'D={0<x<1}'}})
    validate_explicit_constraints([{'id':'c1','value':'0<x<1'}],
                                  {'conditions':{'lower':0,'upper':1,'region_text':'D={0<x,x<1}'}})
    with pytest.raises(ValueError, match='c1'):
        validate_explicit_constraints([{'id':'c1','value':'0<x<1'}], {'conditions':{'region_text':'D={0<x}'}})


def test_uncertainty_grading_keeps_minor_notes_without_blocking(monkeypatch):
    from app.labs import staged_understanding as s
    reading=dict(question='求x^2的不定积分',target='原函数',subquestions=[],relations=[],
        conditions=[dict(id='c1',value='x^2',excerpt='x^2',unit='',page_key=None,bbox=None)],
        uncertainties=['页边有污渍，不影响公式'])
    model=dict(task='antiderivative',conditions={'expression':'x^2','variable':'x'},bindings={'expression':['c1']})
    calls=[]
    def fake(messages,schema,deadline):
        calls.append(1); return reading if len(calls)==1 else model
    monkeypatch.setattr(s,'request_json',fake)
    result=s.understand_staged({'text':reading['question']})
    assert result['computation'] is not None
    assert any('小疑点' in note for note in result['limitations'])

    reading2=copy.deepcopy(reading); reading2['uncertainties']=['c1 的数值无法辨认']
    def fake2(messages,schema,deadline):
        return reading2
    monkeypatch.setattr(s,'request_json',fake2)
    result2=s.understand_staged({'text':reading2['question']})
    assert result2['computation'] is None




def test_missing_bound_still_maps_known_conditions(monkeypatch):
    from app.labs import staged_understanding as s
    reading=dict(question='计算面积，积分变量为 x，上限尚未给出',target='面积',subquestions=[],relations=[],
        conditions=[dict(id='c1',value='x^2',excerpt='x^2'),dict(id='c2',value='x',excerpt='x'),dict(id='c3',value='0',excerpt='0')],
        uncertainties=['缺上限'])
    model=dict(task='geometric_area',conditions=dict(expression='x^2',lower='0',upper=None,region_kind='between_axis'),bindings=dict(expression=['c1'],lower=['c3']))
    calls=[]
    def request(*args):
        calls.append(1)
        return copy.deepcopy(reading if len(calls)==1 else model)
    monkeypatch.setattr(s,'request_json',request)
    result=s.understand_staged({'text':reading['question']})
    assert result['verification']=='needs_review'
    assert result['agent_understanding']['model']['conditions']['expression']=='x^2'
    assert result['computation'] is None
