import copy
import pytest
from app.labs import orchestrator as o

TEXT = '在0≤x≤2内，求曲线y=x²−x与x轴之间的面积，以及该区域绕x轴旋转所得旋转体的体积。'

@pytest.mark.parametrize('axis,status', [('绕y轴', '完成'), ('', 'needs_review')])
def test_axis_is_never_invented(axis, status):
    r = o.solve_composite(TEXT.replace('绕x轴', axis), use_ai=False)
    assert r['status'] == status
    if status == 'needs_review':
        assert not r['answers']

def test_extra_question_is_not_silently_omitted():
    r = o.solve_composite(TEXT+'另求该函数在x=1处的导数。', use_ai=False)
    assert r['status'] != '完成'

def test_source_value_must_match():
    u = o.build_understanding(TEXT, use_ai=False)
    p = o.deterministic_plan(TEXT, u)
    p['steps'][2]['inputs']['upper']['value'] = 1
    assert not o.validate_plan(p,u)['ok']

def test_plan_constant_cannot_override_original_condition():
    u=o.build_understanding(TEXT,use_ai=False)
    p=o.deterministic_plan(TEXT,u)
    p['steps'][2]['inputs']['upper']={'source':'plan','value':1}
    assert not o.validate_plan(p,u)['ok']

def test_ai_questions_and_ambiguities_are_preserved(monkeypatch):
    monkeypatch.setattr('app.labs.staged_understanding.request_json', lambda *a: {
        'given': [], 'asked': [{'id':'Q9','goal':'求导数'}], 'ambiguities':['需要确认旋转轴']})
    u=o.build_understanding(TEXT,use_ai=True)
    assert any(q['goal']=='求导数' for q in u['asked'])
    monkeypatch.setattr(o,'build_understanding',lambda *a,**k:u)
    r=o.solve_composite(TEXT,use_ai=False)
    assert r['status']=='needs_review'
    assert not r['answers']

def test_failed_check_blocks_feeds():
    text=TEXT.replace('x²−x','1/(x-1)')
    u=o.build_understanding(text,use_ai=False)
    p=o.deterministic_plan(text,u)
    r=o.execute_plan(text,p,u)
    assert r['results']['S1']['state']==o.STATE_INCONSISTENT
    assert r['results']['S3']['state']==o.STATE_SKIPPED

def test_missing_output_field_is_not_entire_output():
    step={'inputs':{'expression':{'source':'step','ref':'S1','field':'missing'}}}
    with pytest.raises(ValueError):
        o._resolve_inputs(step,{'S1':{'state':o.STATE_DONE,'outputs':{'zeros':[]}}})
