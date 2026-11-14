import pytest
from app.labs.manual import build_manual_document

def build(expression,lower,upper,kind='closed'):
    return build_manual_document(lab_id='t',title='',task='function_study',conditions=dict(expression=expression,variable='x',lower=lower,upper=upper,interval_type=kind),now_iso='2026-11-13')['problems'][0]

@pytest.mark.parametrize('expression,a,b,kind,minval,maxval,minatt,maxatt', [
 ('x^3-3*x','-2','2','closed','-2','2',True,True),
 ('x^2','0','2','closed','0','4',True,True),
 ('x','0','1','open','0','1',False,False),
 ('x','0','1','right_open','0','1',True,False),
 ('abs(x)','-1','1','closed','0','1',True,True),
 ('sqrt(x)','0','1','closed','0','1',True,True),
 ('1/x','-1','1','closed','-oo','oo',False,False),
 ('(x^2-1)/(x-1)','0','2','closed','1','3',True,True),
 ('sin(x)','0','pi','closed','0','1',True,True),
 ('5','-1','1','open','5','5',True,True),
])
def test_actual_study_questions(expression,a,b,kind,minval,maxval,minatt,maxatt):
    p=build(expression,a,b,kind)
    assert p['manual_input']['result_status']=='complete',p['solution']
    report=p['manual_input']['study']
    assert report['absolute']['minimum']['value']==minval
    assert report['absolute']['maximum']['value']==maxval
    assert report['absolute']['minimum']['attained']==minatt
    assert report['absolute']['maximum']['attained']==maxatt
    assert p['manual_input']['conditions']['interval_type']==kind

def test_cubic_extrema_inflection_and_flat_stationary_point():
    study=build('x^3-3*x','-2','2')['manual_input']['study']
    assert {p['point'] for p in study['extrema']}=={'-1','1'}
    assert {p['point'] for p in study['inflections']}=={'0'}
    study=build('x^3','-1','1')['manual_input']['study']
    assert study['extrema']==[]
    assert study['inflections'][0]['point']=='0'

def test_nondifferentiable_minimum_and_removed_hole():
    study=build('abs(x)','-1','1')['manual_input']['study']
    assert study['extrema'][0]['point']=='0'
    study=build('(x^2-1)/(x-1)','0','2')['manual_input']['study']
    assert len(study['domain'])==2
    assert '1' not in [p['point'] for p in study['critical_points']]

@pytest.mark.parametrize('expression,a,b', [('sin(x^2)','-10','10'),('log(x)','-2','-1')])
def test_no_complete_claim_when_unresolved_or_empty(expression,a,b):
    p=build(expression,a,b)
    assert p['manual_input']['result_status']=='unsupported'

@pytest.mark.parametrize('a,b', [('1','0'),('0','0'),('x','2')])
def test_invalid_intervals(a,b):
    with pytest.raises(ValueError):build('x',a,b)

def test_domain_endpoint_nonstationary_candidate_and_concavity_switch():
    study=build('sqrt(x)','-1','1')['manual_input']['study']
    assert study['absolute']['minimum']['value']=='0'
    assert study['endpoints'][0]['included'] is False
    study=build('x*abs(x)','-1','1')['manual_input']['study']
    assert study['extrema']==[]
    assert study['inflections'][0]['point']=='0'

def test_graph_does_not_bridge_original_domain_gap():
    from app.labs.solvers import evaluate_problem
    p=build('1/x','-1','1')
    result=evaluate_problem(p['model'],p['model']['defaults'])
    assert any(item['y'] is None for item in result['series'])

def test_interval_revision_changes_attainment_without_replacing_function():
    from app.labs.manual import revise_manual_document
    d=build_manual_document(lab_id='t',title='',task='function_study',conditions=dict(expression='x',variable='x',lower='0',upper='1',interval_type='closed'),now_iso='2026-11-13')
    p=revise_manual_document(d,d['problems'][0],{'interval_type':'open'})
    assert p['manual_input']['study']['absolute']['minimum']['attained'] is False
    assert p['manual_input']['conditions']['expression']=='x'

def test_deleted_peak_is_unattained_supremum_not_maximum():
    study=build('-x^2*(x/x)','-1','1')['manual_input']['study']
    assert study['absolute']['maximum']['value']=='0'
    assert study['absolute']['maximum']['attained'] is False
    assert '0' not in [p['point'] for p in study['critical_points']]

def test_stationary_nonextreme_does_not_split_monotonicity_or_bridge_hole():
    study=build('x^3','-1','1')['manual_input']['study']
    assert len(study['monotonic'])==1
    assert study['monotonic'][0]['kind']=='increasing'
    study=build('(x^2-1)/(x-1)','0','2')['manual_input']['study']
    assert len(study['monotonic'])==2
