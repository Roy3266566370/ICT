import pytest
from app.labs.manual import build_manual_document, preview_integral

def build(task, expression, point, side='both'):
    c=dict(expression=expression, variable='x', point=point)
    if task == 'limit': c['side']=side
    return build_manual_document(lab_id='test',title='',task=task,conditions=c,now_iso='2026-11-13')['problems'][0]

@pytest.mark.parametrize('expression,point,expected', [('x^2','1/3','2/3'), ('sin(x)','pi','-1'), ('sin(x)','pi/2','0')])
def test_exact_derivative_points(expression,point,expected):
    p=build('derivative',expression,point)
    assert p['solution']['exact']==expected
    assert p['manual_input']['conditions']['point']==point

@pytest.mark.parametrize('expression,point,side,expected', [('sin(x)/x','0','both','1'), ('(x^2-1)/(x-1)','1','both','2'), ('abs(x)/x','0','left','-1'), ('abs(x)/x','0','right','1'), ('(x^2+1)/(2*x^2)','oo','both','1/2'), ('sin(x)/(x-pi)','pi','both','-1'), ('x^2','1/3','both','1/9')])
def test_manual_limits(expression,point,side,expected):
    p=build('limit',expression,point,side)
    assert p['solution']['exact']==expected
    assert p['manual_input']['conditions']['side']==side
    assert p['manual_input']['conditions']['point']==point

@pytest.mark.parametrize('expression,side,status', [('1/x','both','does_not_exist'), ('1/x','right','infinite'), ('sin(1/x)','both','does_not_exist')])
def test_limit_nonfinite_is_conclusion(expression,side,status):
    p=build('limit',expression,'0',side)
    assert p['solution']['limit_status']==status
    assert p['manual_input']['result_status']=='complete'

@pytest.mark.parametrize('task,point', [('derivative','x'),('derivative','oo'),('limit','1/0')])
def test_invalid_points(task,point):
    with pytest.raises(ValueError): preview_integral(task,dict(expression='x^2',variable='x',point=point,**({'side':'both'} if task=='limit' else {})))
