import pytest
from app.labs.manual import build_manual_document, preview_integral, revise_manual_document

def document(expression,point='0',mode='expression',value=None):
    c=dict(expression=expression,variable='x',point=point,value_mode=mode)
    if value is not None:c['point_value']=value
    return build_manual_document(lab_id='test',title='',task='continuity',conditions=c,now_iso='2026-11-13')

@pytest.mark.parametrize('expression,point,mode,value,category,left,right,at', [
 ('x^2','1/3','expression',None,'continuous','1/9','1/9','1/9'),
 ('sin(x)','pi','expression',None,'continuous','0','0','0'),
 ('sin(x)/x','0','expression',None,'removable','1','1','未定义'),
 ('sin(x)/x','0','value','1','continuous','1','1','1'),
 ('sin(x)/x','0','value','2','removable','1','1','2'),
 ('x','0','undefined',None,'removable','0','0','未定义'),
 ('abs(x)/x','0','expression',None,'jump','-1','1','未定义'),
 ('1/x','0','expression',None,'infinite','-∞','+∞','未定义'),
 ('sin(1/x)','0','expression',None,'oscillatory','不存在（振荡）','不存在（振荡）','未定义'),
 ('(x^2-1)/(x-1)','1','expression',None,'removable','2','2','未定义'),
 ('sqrt(x)','0','expression',None,'boundary','该侧无实定义域邻域','0','0'),
])
def test_real_continuity_questions(expression,point,mode,value,category,left,right,at):
    p=document(expression,point,mode,value)['problems'][0]
    report=p['manual_input']['continuity']
    assert p['manual_input']['result_status']=='complete'
    assert report['classification']==category
    assert report['left']['text']==left
    assert report['right']['text']==right
    assert report['value']['text']==at
    assert p['manual_input']['conditions']['point']==point
    assert p['model']['expression']==expression

@pytest.mark.parametrize('conditions', [dict(value_mode='value'), dict(value_mode='value',point_value='x'), dict(value_mode='expression',point_value='1'), dict(value_mode='invalid')])
def test_no_omitted_conditions(conditions):
    with pytest.raises(ValueError): preview_integral('continuity',dict(expression='x',variable='x',point='0',**conditions))

def test_revision_preserves_single_point_definition():
    d=document('sin(x)/x',mode='value',value='2')
    p=revise_manual_document(d,d['problems'][0],{'point_value':'1'})
    assert p['manual_input']['continuity']['classification']=='continuous'
    assert p['manual_input']['conditions']['point_value']=='1'

def test_small_neighborhood_and_small_jump_are_not_sampling_decisions():
    p=document('sqrt(1/100000000-x^2)')['problems'][0]
    assert p['manual_input']['continuity']['classification']=='continuous'
    p=document('abs(x)/x/1000000000000')['problems'][0]
    assert p['manual_input']['continuity']['classification']=='jump'

def test_mode_revision_removes_only_explicitly_replaced_point_definition():
    d=document('sin(x)/x',mode='value',value='1')
    p=revise_manual_document(d,d['problems'][0],{'value_mode':'undefined'})
    assert p['manual_input']['continuity']['classification']=='removable'
    assert 'point_value' not in p['manual_input']['conditions']

def test_registered_kernel_uses_exact_conditions():
    from app.labs.ai_solve import compute_plan
    result=compute_plan(dict(kind='kernel',task='continuity',conditions=dict(expression='sin(x)',variable='x',point='pi',value_mode='expression')))
    assert result['interactive_solution']['continuity']['classification']=='continuous'
