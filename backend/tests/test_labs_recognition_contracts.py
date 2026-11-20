import copy
import json

import pytest

from app.labs import solvers
from app.labs.extract import text_source
from app.labs.recognize import (
    RecognitionError, _attach_solution, build_lab_document, build_problem,
    rebuild_problem, split_problems,
)


def document(text, **options):
    source = text_source(text, lab_id='contracts')
    return build_lab_document(lab_id='contracts', title='test', source=source,
                              files=source['files'], now_iso='2026-11-20T00:00:00Z', **options)


@pytest.mark.parametrize('model', [
    {'engine': 'gauss_v1', 'la_kind': 'future_kind'},
    {'engine': 'future_v1'},
    {'engine': 'heap_v1'},
    {'engine': 'calculus_v1', 'task': 'integral'},
])
def test_all_engines_stop_before_solver_on_unresolved_blocking(monkeypatch, model):
    def unexpected(_model):
        pytest.fail('blocked input reached solver')
    monkeypatch.setattr(solvers, 'solve_problem', unexpected)
    p = {'model': model, 'status': 'ready', 'recognition': {'ambiguities': [
        {'id': 'missing', 'severity': 'blocking', 'resolved': False},
    ]}}
    _attach_solution(p)
    assert p['status'] == 'needs_review'
    assert p['solution']['answer'] == ''
    assert not p['solution']['steps']


def test_resolved_blocking_and_notice_do_not_block(monkeypatch):
    monkeypatch.setattr(solvers, 'solve_problem', lambda model: {'answer': 'verified'})
    p = {'model': {'engine': 'future_v1'}, 'status': 'ready', 'recognition': {'ambiguities': [
        {'id': 'fixed', 'severity': 'blocking', 'resolved': True},
        {'id': 'info', 'severity': 'notice', 'resolved': False},
    ]}}
    _attach_solution(p)
    assert p['solution']['answer'] == 'verified'


def test_free_text_acknowledgement_cannot_clear_missing_matrix(monkeypatch):
    p = build_problem('求矩阵的逆', overrides={'ambiguity_answers': {'matrix_a': 'confirmed'}})
    monkeypatch.setattr(solvers, 'solve_problem', lambda model: pytest.fail('missing matrix was accepted'))
    _attach_solution(p)
    assert p['status'] == 'needs_review'
    assert any(a['id'] == 'matrix_a' and not a['resolved'] for a in p['recognition']['ambiguities'])


def test_formula_confirmation_is_uniform_and_rebuilds():
    p = build_problem('求矩阵 A=[[2,1],[1,2]] 的逆矩阵', pages=[{
        'file_id': 'f1', 'page': 1, 'image_key': 'f1_p1',
        'requires_formula_confirmation': True, 'method': 'image_ocr',
    }])
    _attach_solution(p)
    assert p['status'] == 'needs_review'
    assert not p['solution']['answer']
    reviewed = rebuild_problem(p, files=[], ambiguity_answers={'source_formula_confirmation': 'confirmed'})
    assert reviewed['status'] == 'ready'
    assert 'A⁻¹' in reviewed['solution']['answer']


def test_eigen_fraction_survives_review_and_json_roundtrip():
    original = build_problem('求矩阵 A=[[1/3,0],[0,0.5]] 的特征值', pages=[{
        'file_id': 'f1', 'page': 1, 'image_key': 'f1_p1',
        'requires_formula_confirmation': True, 'method': 'image_ocr',
    }])
    _attach_solution(original)
    assert not original['solution']['answer']
    reviewed = rebuild_problem(json.loads(json.dumps(original)), files=[],
                               condition_values={'matrix_a': '[[1/3,0],[0,1/2]]'},
                               ambiguity_answers={'source_formula_confirmation': 'confirmed'})
    assert reviewed['status'] == 'ready'
    assert reviewed['solution']['solution_complete'] is True
    assert reviewed['model']['matrix_a_exact'] == [['1/3', '0'], ['0', '1/2']]
    assert {item['value'] for item in reviewed['solution']['eigenvalues']} == {'1/3', '1/2'}
    json.dumps(reviewed, allow_nan=False)


@pytest.mark.parametrize('questions', [
    '（1）求单调区间。\n（2）求极值。',
    '(1)求单调区间；(2)求极值。',
    '①求单调区间；②求极值。',
    '求单调区间并求极值。',
])
def test_function_study_questions_split_with_shared_function(questions):
    original = '设函数 f(x)=x^3-3*x。\n' + questions
    doc = document(original)
    assert doc['problem_count'] == 2
    assert [p['number'] for p in doc['problems']] == ['(1)', '(2)']
    for p in doc['problems']:
        assert p['status'] == 'ready', p['recognition']['ambiguities']
        assert p['model']['kind'] == 'function_study'
        assert p['model']['expression'].replace(' ', '') == 'x^3-3*x'
        assert p['subquestion']['parent_text'] == original
        assert p['solution']['answer']
    assert '求极值' not in doc['problems'][0]['text']
    assert '求单调' not in doc['problems'][1]['text']
    json.dumps(doc, ensure_ascii=False, allow_nan=False)


def test_subquestions_bind_independent_intervals_and_rebuild_without_sibling_changes():
    doc = document('设函数 f(x)=x^3-3*x。\n（1）求在区间[-2,0]上的单调区间。\n（2）求在区间[0,2]上的单调区间。')
    first, second = doc['problems']
    assert (first['model']['study_lower'], first['model']['study_upper']) == (-2, 0)
    assert (second['model']['study_lower'], second['model']['study_upper']) == (0, 2)
    assert first['status'] == second['status'] == 'ready'
    before = copy.deepcopy(second)
    rebuilt = rebuild_problem(first, files=[], text='设函数 f(x)=x^3-3*x。求在区间[-3,-2]上的单调区间。')
    assert rebuilt['subquestion']['parent_text'] == first['subquestion']['parent_text']
    assert rebuilt['model']['study_upper'] == -2
    assert second == before


@pytest.mark.parametrize('second', [
    '利用第1问的结果求极值。',
    '由（1）的结论求极值。',
    '将函数改为 f(x)=x^2，求极值。',
])
def test_dependent_or_redefined_subquestion_stays_blocked(second):
    doc = document('设函数 f(x)=x^3-3*x。\n（1）求单调区间。\n（2）' + second)
    assert doc['problem_count'] == 2
    assert doc['problems'][0]['status'] == 'ready'
    blocked = doc['problems'][1]
    assert blocked['status'] == 'pending_ai'
    assert not blocked['solution']['answer']
    assert any(a['id'] == 'subquestion_context' for a in blocked['recognition']['ambiguities'])


def test_conflicting_shared_and_local_intervals_are_not_silently_reused():
    doc = document('设函数 f(x)=x^3-3*x，研究区间为[-2,2]。\n（1）求单调区间。\n（2）求在区间[0,1]上的极值。')
    assert doc['problems'][0]['status'] == 'ready'
    assert doc['problems'][1]['status'] == 'pending_ai'
    assert not doc['problems'][1]['solution']['answer']


def test_function_values_are_not_question_markers():
    source = text_source('设 f(1)=2，f(2)=3，求 f(3)。', lab_id='contracts')
    assert len(split_problems(source['pages'], source['files'])) == 1


def test_numbered_parent_keeps_number_and_page_context():
    files = [{'file_id': 'f1', 'role': 'problem'}]
    pages = [
        {'file_id': 'f1', 'page': 1, 'text': '7. 设函数 f(x)=x^3-3*x。\n（1）求单调区间。'},
        {'file_id': 'f1', 'page': 2, 'text': '（2）求极值。'},
    ]
    parts = split_problems(pages, files)
    assert [p['number'] for p in parts] == ['7(1)', '7(2)']
    assert all(p['page_from'] == 1 and p['page_to'] == 2 for p in parts)
    assert all(len(p['pages']) == 2 for p in parts)


def test_original_m5m_ocr_splits_and_requires_each_question_confirmation():
    text = '高等数学期末试卷综合题\n13.（12分）设f(x)=x^3-3x。\n（1）求的单调区间；（2）求的极值。\n解：'
    files = [{'file_id': 'f1', 'role': 'problem', 'kind': 'image'}]
    source = {'pages': [{'file_id': 'f1', 'page': 1, 'text': text, 'ocr_text': text,
                         'image_key': 'f1_p1', 'method': 'image_ocr', 'ocr_confidence': 0.9727,
                         'requires_formula_confirmation': True}]}
    doc = build_lab_document(lab_id='m5m', title='m5m', source=source, files=files, now_iso='2026-11-20')
    first, second = doc['problems']
    assert first['number'] == '13(1)' and second['number'] == '13(2)'
    assert all(p['status'] == 'needs_review' and not p['solution']['answer'] for p in doc['problems'])
    confirmed = rebuild_problem(first, files=files, ambiguity_answers={'source_formula_confirmation': 'confirmed'})
    assert confirmed['status'] == 'ready'
    assert '(-∞, -1)' in confirmed['solution']['answer']
    assert second['status'] == 'needs_review'
    confirmed = rebuild_problem(second, files=files, ambiguity_answers={'source_formula_confirmation': 'confirmed'})
    assert 'f(-1)=2' in confirmed['solution']['answer']
    assert 'f(1)=-2' in confirmed['solution']['answer']


def test_common_tail_conditions_cannot_be_dropped_from_first_question():
    doc = document('设f(x)=x^3-3*x。(1)求单调区间；(2)求极值。以上两问均在[0,2]内研究。')
    assert doc['problem_count'] == 2
    assert all(p['status'] == 'pending_ai' and not p['solution']['answer'] for p in doc['problems'])


def test_multiple_shared_functions_cannot_silently_bind_first_function():
    doc = document('设f(x)=x^3-3*x，g(x)=x^2。(1)求f(x)的单调区间；(2)求g(x)的极值。')
    assert doc['problem_count'] == 2
    assert all(p['status'] == 'pending_ai' and not p['solution']['answer'] for p in doc['problems'])
    corrected = rebuild_problem(doc['problems'][1], files=[], text='设g(x)=x^2，求g(x)的极值。')
    assert corrected['status'] == 'ready'
    assert corrected['model']['expression'].replace(' ', '') == 'x^2'


def test_review_with_subject_cannot_bypass_multi_question_coverage():
    original = build_problem('(1)f(x)=x^2，求导数；(2)g(x)=x^3，求导数。')
    assert original['status'] == 'pending_ai'
    reviewed = rebuild_problem(original, files=[])
    assert reviewed['status'] == 'pending_ai'
    assert not reviewed['solution']['answer']


@pytest.mark.parametrize('ocr_text,math_text,confidence', [
    ('求矩阵A=[[2,1],[1,2]]的特征值。', None, 0.4),
    ('求函数f(x)=x^2的单调区间。', 'f(x)=x^3', 0.95),
])
def test_ocr_evidence_survives_review_but_confirmed_text_can_build(ocr_text, math_text, confidence):
    from app.labs.source_recovery import assess_text_quality
    page = {'file_id': 'f1', 'page': 1, 'image_key': 'f1_p1', 'text': ocr_text,
            'ocr_text': ocr_text, 'math_text': math_text, 'ocr_confidence': confidence,
            'method': 'image_ocr', 'requires_formula_confirmation': True}
    page['ocr_quality'] = assess_text_quality(ocr_text, [page])
    page['requires_source_review'] = page['ocr_quality']['requires_review']
    p = build_problem(ocr_text, pages=[page])
    _attach_solution(p)
    assert p['status'] == 'pending_ai'
    assert not p['solution']['answer']
    assert p['source_pages'][0]['ocr_quality']['untrusted']
    assert p['source_pages'][0]['ocr_confidence'] == confidence
    untouched = rebuild_problem(p, files=[])
    assert untouched['status'] == 'pending_ai'
    reviewed = rebuild_problem(p, files=[], text=ocr_text,
                               ambiguity_answers={'source_formula_confirmation': 'confirmed'})
    assert reviewed['status'] == 'ready', reviewed['recognition']['ambiguities']
    assert reviewed['recognition']['quality']['human_confirmed']
    assert reviewed['recognition']['quality']['source_quality']['untrusted']
    assert reviewed['source_pages'][0]['ocr_quality'] == page['ocr_quality']
    assert reviewed['solution']['answer']


def test_joined_determinant_digits_require_correction_not_guessing():
    text = '求行列式|12;34|的值。'
    page = {'file_id': 'f1', 'page': 1, 'image_key': 'f1_p1', 'text': text,
            'ocr_text': text, 'ocr_confidence': 0.95, 'requires_source_review': True}
    original = build_problem(text, pages=[page])
    _attach_solution(original)
    assert original['status'] == 'pending_ai'
    assert not original['solution']['answer']
    reviewed = rebuild_problem(original, files=[], ambiguity_answers={'source_formula_confirmation': 'confirmed'})
    assert reviewed['status'] == 'pending_ai'
    corrected = rebuild_problem(original, files=[], text='求行列式|1 2;3 4|的值。',
                                ambiguity_answers={'source_formula_confirmation': 'confirmed'})
    assert corrected['status'] == 'ready'
    assert corrected['solution']['answer_value'] == -2


def test_confirmation_does_not_approve_still_damaged_exponent():
    text = '求函数f(x)=x~2的单调区间。'
    page = {'file_id': 'f1', 'page': 1, 'image_key': 'f1_p1', 'text': text,
            'ocr_text': text, 'ocr_confidence': 0.9, 'requires_source_review': True}
    original = build_problem(text, pages=[page])
    reviewed = rebuild_problem(original, files=[], ambiguity_answers={'source_formula_confirmation': 'confirmed'})
    assert reviewed['status'] == 'pending_ai'
    assert not reviewed['solution']['answer']
    corrected = rebuild_problem(original, files=[], text=text.replace('x~2', 'x^2'),
                                ambiguity_answers={'source_formula_confirmation': 'confirmed'})
    assert corrected['status'] == 'ready'


def test_split_limit_rejects_instead_of_discarding_questions():
    with pytest.raises(RecognitionError, match='避免遗漏'):
        document('设函数 f(x)=x^3-3*x。\n（1）求单调区间。\n（2）求极值。', max_problems=1)
