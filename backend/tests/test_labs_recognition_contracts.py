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


@pytest.mark.parametrize('text', [
    '讨论反常积分 ∫(1,+∞) dx/x^p 的敛散性。',
    '高等数学期末试卷讨论题\n12．（8分）讨论反常积分{(1,+∞）dx/x^p的敛散性。\n解：',
])
def test_symbolic_improper_integral_keeps_original_after_source_confirmation(text):
    problem = build_problem(text, pages=[{
        'file_id': 'f1', 'page': 1, 'image_key': 'f1_p1',
        'requires_formula_confirmation': True, 'ocr_text': text,
    }])
    _attach_solution(problem)
    assert problem['model']['task'] == 'integral'
    assert problem['model']['teaching'] is False
    raw = problem['model']['conditions']
    assert raw['expression'] == '1/(x^p)'
    assert float(raw['lower']) == 1
    assert raw['upper'] == 'inf'
    assert problem['solution']['answer'] == ''
    for answers in ({'source_formula_confirmation': 'confirmed'},
                    {'source_formula_confirmation': 'confirmed', 'kernel_reject': 'confirmed'}):
        reviewed = rebuild_problem(problem, files=[], ambiguity_answers=answers,
                                   condition_values={'expression': raw['expression']})
        assert reviewed['status'] == 'needs_review'
        assert reviewed['model']['conditions'] == raw
        assert reviewed['solution']['answer'] == ''
    # Explicitly transcribe the OCR integral glyph too; blanket confirmation cannot repair it.
    corrected = rebuild_problem(problem, files=[], text=text.replace('x^p', 'x^2').replace('{', '∫'),
                                ambiguity_answers={'source_formula_confirmation': 'confirmed'})
    assert corrected['status'] == 'ready'
    assert corrected['solution']['answer'] == '1'


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


@pytest.mark.parametrize('image', [False, True])
def test_joined_determinant_digits_require_correction_not_guessing(image):
    text = '求行列式|12;34|的值。'
    page = {'file_id': 'f1', 'page': 1, 'image_key': 'f1_p1', 'text': text,
            'ocr_text': text, 'ocr_confidence': 0.95, 'requires_source_review': True}
    original = build_problem(text, pages=[page] if image else [])
    _attach_solution(original)
    assert original['status'] in ('pending_ai', 'needs_review')
    assert not original['solution']['answer']
    reviewed = rebuild_problem(original, files=[], ambiguity_answers={
        'source_formula_confirmation': 'confirmed', 'matrix_layout_ambiguity': 'confirmed'})
    assert reviewed['status'] in ('pending_ai', 'needs_review')
    assert not reviewed['solution']['answer']
    corrected = rebuild_problem(original, files=[], text='求行列式|1 2;3 4|的值。',
                                ambiguity_answers={'source_formula_confirmation': 'confirmed'})
    assert corrected['status'] == 'ready'
    assert corrected['solution']['answer_value'] == -2


@pytest.mark.parametrize('notation', ['x3', 'x³'])
@pytest.mark.parametrize('optimization', [False, True])
def test_power_notation_in_analysis_and_optimization(notation, optimization):
    text = (f'使用梯度下降法求 f(x)={notation}-3*x 的极小值，初始点 x0=2，学习率 0.1。'
            if optimization else f'求函数 f(x)={notation}-3*x 的极值。')
    problem = document(text)['problems'][0]
    assert problem['status'] == 'ready', problem['recognition']['ambiguities']
    assert problem['subject'] == ('optimization' if optimization else 'calculus')
    assert not problem['model']['teaching']
    assert 'x3' not in problem['model']['expression']
    assert '³' not in problem['model']['expression']
    if optimization:
        assert '极大值点 x=-1，f=2' in problem['solution']['answer']
        assert '极小值点 x=1，f=-2' in problem['solution']['answer']
    else:
        assert '极大值 f(-1)=2' in problem['solution']['answer']
        assert '极小值 f(1)=-2' in problem['solution']['answer']
    reviewed = rebuild_problem(problem, files=[])
    assert reviewed['status'] == 'ready'
    assert reviewed['solution']['answer'] == problem['solution']['answer']


@pytest.mark.parametrize('notation', ['x3', 'x³'])
def test_power_notation_does_not_bypass_image_confirmation(notation):
    text = f'求函数 f(x)={notation}-3*x 的极值。'
    page = {'file_id': 'f1', 'page': 1, 'image_key': 'f1_p1', 'text': text,
            'requires_formula_confirmation': True}
    problem = build_problem(text, pages=[page])
    _attach_solution(problem)
    assert problem['status'] == 'needs_review'
    assert not problem['solution']['answer']
    reviewed = rebuild_problem(problem, files=[], ambiguity_answers={'source_formula_confirmation': 'confirmed'})
    assert reviewed['status'] == 'ready'
    assert '极小值 f(1)=-2' in reviewed['solution']['answer']


def test_confirmation_does_not_approve_still_damaged_exponent():
    text = '求函数f(x)=x~2的单调区间。'
    page = {'file_id': 'f1', 'page': 1, 'image_key': 'f1_p1', 'text': text,
            'ocr_text': text, 'ocr_confidence': 0.9, 'requires_source_review': True}
    original = build_problem(text, pages=[page])
    reviewed = rebuild_problem(original, files=[], ambiguity_answers={'source_formula_confirmation': 'confirmed'})
    assert reviewed['status'] == 'needs_review'
    assert any(not a['resolved'] for a in _repair_items(reviewed))
    assert not reviewed['solution']['answer']
    corrected = rebuild_problem(original, files=[], text=text.replace('x~2', 'x^2'),
                                ambiguity_answers={'source_formula_confirmation': 'confirmed'})
    assert corrected['status'] == 'ready'


@pytest.mark.parametrize('text, module_name, symbol, task, field', [
    ('求y=x^2在[0,1]上的弧长。', 'kernel_models', 'compile_kernel_problem', 'arc_length', 'expression'),
    ('将f(x)=x^2在[-pi,pi]上展开为傅里叶级数。', 'series', 'build_fourier_problem', 'fourier_series', 'expression'),
    ('将f(x)=exp(x)展开为幂级数到x^4项。', 'series', 'build_power_series_problem', 'power_series', 'expression'),
    ('求幂级数x^n/(n+1)的和函数。', 'series', 'build_power_series_problem', 'power_series', 'term'),
    ('判断级数1/n^2的敛散性。', 'series', 'build_series_problem', 'series_convergence', 'term'),
    ("求微分方程y'=y的通解。", 'ode', 'build_ode_problem', 'ode', 'equation'),
])
@pytest.mark.parametrize('error', [ValueError, NotImplementedError, RuntimeError])
def test_matched_builders_cannot_fall_through_after_kernel_rejection(monkeypatch, text, module_name, symbol, task, field, error):
    import importlib
    module = importlib.import_module('app.labs.' + module_name)

    def reject(*args, **kwargs):
        raise error('kernel rejected extracted conditions')

    monkeypatch.setattr(module, symbol, reject)
    monkeypatch.setattr(solvers, 'solve_problem', lambda model: pytest.fail('blocked model reached solver'))
    problem = build_problem(text)
    _attach_solution(problem)
    assert problem['status'] == 'needs_review'
    assert problem['model']['task'] == task
    assert problem['model']['teaching'] is False
    assert problem['model']['conditions'][field]
    assert any(item['id'] == field for item in problem['recognition']['conditions'])
    assert problem['solution']['answer'] == ''
    assert problem['solution']['steps'] == []
    reviewed = rebuild_problem(problem, files=[], ambiguity_answers={'kernel_reject': 'confirmed'})
    assert reviewed['status'] == 'needs_review'
    assert reviewed['solution']['answer'] == ''


@pytest.mark.parametrize('text, task', [
    ('将f(x)=a*x在[-pi,pi]上展开为傅里叶级数。', 'fourier_series'),
    ('将f(x)=a*x展开为幂级数。', 'power_series'),
    ('求幂级数x^(n+1)的和函数。', 'power_series'),
    ('判断级数1/n^p的敛散性。', 'series_convergence'),
    ("求微分方程y'=a*y的通解。", 'ode'),
    ('求y=a*x在[0,1]上的弧长。', 'arc_length'),
])
def test_rejected_expressions_keep_the_original_task(text, task):
    problem = build_problem(text)
    _attach_solution(problem)
    assert problem['model']['task'] == task
    assert not problem['model']['teaching']
    assert problem['status'] == 'needs_review'
    assert not problem['solution']['answer']


@pytest.mark.parametrize('text,task', [
    ('求曲线 y=x^2 的弧长。', 'arc_length'),
    ('求参数方程 x=t^2,y=t^3 的弧长。', 'parametric_arc_length'),
    ('求曲线 y=x^2 与 y=1，0<=x<=1 围成图形绕x轴旋转的体积。', 'rotation_volume'),
    ('计算三重积分 ∭_Ω 1 dV，其中Ω为球体 x^2+y^2+z^2<=1，z>=0。', 'triple_integral'),
    ('计算三重积分 ∭_Ω 1 dV，其中Ω为上半球体 x^2+y^2+z^2<=1。', 'triple_integral'),
])
def test_partial_geometry_conditions_never_produce_an_unrelated_answer(text, task):
    problem = build_problem(text)
    _attach_solution(problem)
    assert problem['model']['task'] == task
    assert problem['status'] == 'needs_review'
    assert not problem['solution']['answer']
    assert problem['model']['conditions']['source_text'] == text
    reviewed = rebuild_problem(problem, files=[], ambiguity_answers={'kernel_reject': 'confirmed'})
    assert reviewed['status'] == 'needs_review'
    assert not reviewed['solution']['answer']


@pytest.mark.parametrize('function', ['y=exp(x)', 'f(x)=exp(x)'])
def test_comprehensive_function_study_does_not_use_the_narrow_asymptote_builder(function):
    problem = build_problem(f'求函数 {function} 的单调性及渐近线。')
    _attach_solution(problem)
    assert problem['status'] == 'ready'
    assert problem['model']['task'] == 'function_study'
    assert '递增' in problem['solution']['answer']
    assert 'y=0' in problem['solution']['answer']


@pytest.mark.parametrize('interval', ['[-pi,T]', '[0,2*T]', ''])
def test_fourier_missing_or_unreadable_interval_never_uses_a_default(interval):
    problem = build_problem(f'将f(x)=x在{interval}上展开为傅里叶级数。')
    _attach_solution(problem)
    assert problem['model']['task'] == 'fourier_series'
    assert problem['status'] == 'needs_review'
    assert not problem['solution']['answer']
    reviewed = rebuild_problem(problem, files=[], text='将f(x)=x在[-pi,pi]上展开为傅里叶级数。')
    assert reviewed['status'] == 'ready'
    assert reviewed['solution']['fourier']['coefficients'][0]['bn'] == '2'


def test_ambiguous_pi_requires_correction_and_preserves_image_evidence():
    text = '求三叶玫瑰线r=cos3θ一瓣(θE[-T/6,π/6])的面积。'
    problem = build_problem(text, pages=[{'file_id': 'f1', 'page': 1, 'image_key': 'f1_p1',
        'ocr_text': text, 'requires_formula_confirmation': True}])
    _attach_solution(problem)
    assert any(e['code'] == 'ambiguous_constant' for e in problem['recognition']['quality']['evidence'])
    reviewed = rebuild_problem(problem, files=[], ambiguity_answers={'source_formula_confirmation': 'confirmed'})
    assert reviewed['status'] == 'needs_review'
    assert any(not a['resolved'] for a in _repair_items(reviewed))
    assert not reviewed['solution']['answer']
    # Both the constant and the membership glyph must be transcribed explicitly.
    corrected = rebuild_problem(problem, files=[], text=text.replace('T/6', 'π/6').replace('θE[', 'θ∈['),
                                ambiguity_answers={'source_formula_confirmation': 'confirmed'})
    assert corrected['status'] == 'ready'
    assert 'pi/12' in corrected['solution']['answer']
    assert corrected['source_pages'][0]['ocr_text'] == text


def test_inverse_function_without_point_is_not_the_original_function_derivative():
    problem = build_problem('设f(x)=x^3+x，求其反函数的导数。')
    _attach_solution(problem)
    assert problem['model']['task'] == 'inverse_derivative'
    assert problem['status'] == 'needs_review'
    assert not problem['solution']['answer']


@pytest.mark.parametrize('notation', ['d²y/dx²', 'd^2y/dx^2', 'd2y/dx2'])
def test_parametric_second_derivative_notations_have_the_same_order(notation):
    problem = build_problem(f'设x=t^2,y=t^3，求{notation}在t=1处的值。')
    _attach_solution(problem)
    assert problem['status'] == 'ready'
    assert '3/4' in problem['solution']['answer']


def test_parametric_point_is_not_truncated_before_operators():
    problem = build_problem('设x=t^2,y=t^3，求dy/dx在t=2*pi处的值。')
    _attach_solution(problem)
    assert problem['status'] == 'ready'
    assert '3*pi' in problem['solution']['answer']


def test_split_limit_rejects_instead_of_discarding_questions():
    with pytest.raises(RecognitionError, match='避免遗漏'):
        document('设函数 f(x)=x^3-3*x。\n（1）求单调区间。\n（2）求极值。', max_problems=1)


_REPAIR_GOLDEN = '求极坐标曲线 r=cos3θ 的一瓣面积，θE[-T/6,π/6]。'
_REPAIR_DRIFT = '求极坐标曲线 r=cos3胃 的一瓣面积，胃E[-T/6,蟺/6]。'
_REPAIR_CORRECT = '求极坐标曲线 r=cos3θ 的一瓣面积，θ∈[-π/6,π/6]。'


def _repair_problem(text):
    problem = build_problem(text, pages=[{
        'file_id': 'repair-image', 'page': 1, 'image_key': 'repair-image_p1',
        'ocr_text': text, 'requires_formula_confirmation': True,
    }])
    _attach_solution(problem)
    return problem


def _repair_items(problem):
    return [a for a in problem['recognition']['ambiguities']
            if a['id'].startswith('source_repair_')]


def _repair_choices(problem):
    # Explicit transcription agreed from the source image, never solver feedback.
    expected = {'T': 'π', '胃': 'θ', '蟺': 'π', 'E': '∈'}
    repairs = _repair_items(problem)
    assert repairs
    return {a['id']: next(o['value'] for o in a['options']
                         if o.get('replacement') == expected[a['repair']['original']])
            for a in repairs}


@pytest.mark.parametrize('text', [_REPAIR_GOLDEN, _REPAIR_DRIFT])
def test_source_repair_proposals_have_character_spans_and_explicit_options(text):
    from app.labs.source_recovery import source_repair_proposals

    proposals = source_repair_proposals(text)
    assert isinstance(proposals, list) and proposals
    assert len({a['id'] for a in proposals}) == len(proposals)
    expected_positions = {i for i, char in enumerate(text) if char in 'T胃蟺E'}
    assert {a['repair']['start'] for a in proposals} == expected_positions
    for a in proposals:
        assert a['id'].startswith('source_repair_')
        assert a['severity'] == 'blocking' and not a['resolved']
        repair = a['repair']
        assert {'start', 'end', 'original', 'text_hash', 'code', 'context'} <= repair.keys()
        assert 0 <= repair['start'] < repair['end'] <= len(text)
        assert text[repair['start']:repair['end']] == repair['original']
        assert repair['text_hash'] and repair['context'] and repair['code']
        values = {o['value'] for o in a['options']}
        assert {'replace:0', 'keep', 'manual'} <= values
        assert all(isinstance(o['replacement'], str) for o in a['options']
                   if o['value'].startswith('replace:'))
    assert not _repair_items(build_problem(text))
    assert not source_repair_proposals(_REPAIR_CORRECT)


@pytest.mark.parametrize('text', [_REPAIR_GOLDEN, _REPAIR_DRIFT])
def test_source_repair_recompiles_only_after_explicit_choices_and_confirmation(text):
    problem = _repair_problem(text)
    before = copy.deepcopy(problem)
    confirmed = rebuild_problem(problem, files=[], ambiguity_answers={
        'source_formula_confirmation': 'confirmed'})
    assert confirmed['status'] != 'ready' and not confirmed['solution']['answer']
    assert any(not a['resolved'] for a in _repair_items(confirmed))
    choices = _repair_choices(problem)
    revised = rebuild_problem(problem, files=[], ambiguity_answers=choices)
    assert revised['text'] == _REPAIR_CORRECT
    assert revised['status'] != 'ready' and not revised['solution']['answer']
    assert revised['source_pages'] == before['source_pages']
    assert problem == before
    history = revised['recognition']['source_repair_history']
    assert len(history) == 1
    assert history[0]['original_text'] == text
    assert history[0]['revised_text'] == _REPAIR_CORRECT
    decisions = history[0]['decisions']
    assert {d['id'] for d in decisions} == set(choices)
    for d in decisions:
        assert {'id', 'code', 'start', 'end', 'original', 'replacement',
                'action', 'label', 'text_hash'} <= d.keys()
        assert text[d['start']:d['end']] == d['original']
        assert d['replacement'] == {'T': 'π', '胃': 'θ', '蟺': 'π', 'E': '∈'}[d['original']]
        assert d['action'] == 'replace'
    ready = rebuild_problem(revised, files=[], ambiguity_answers={
        'source_formula_confirmation': 'confirmed'})
    assert ready['status'] == 'ready'
    assert ready['solution']['exact'] == 'pi/12'
    assert ready['recognition']['source_repair_history'] == history
    assert ready['source_pages'] == before['source_pages']


@pytest.mark.parametrize('action', ['keep', 'manual'])
def test_source_repair_keep_and_manual_cannot_acknowledge_away_suspects(action):
    problem = _repair_problem(_REPAIR_DRIFT)
    answers = {a['id']: action for a in _repair_items(problem)}
    assert answers
    answers.update(source_formula_confirmation='confirmed', kernel_reject='confirmed')
    revised = rebuild_problem(problem, files=[], ambiguity_answers=answers)
    assert revised['text'] == _REPAIR_DRIFT
    assert revised['status'] != 'ready' and not revised['solution']['answer']
    assert any(a['severity'] == 'blocking' and not a['resolved']
               for a in revised['recognition']['ambiguities'])


def test_source_repair_repeated_characters_are_independent_and_unknown_endpoint_blocks():
    problem = _repair_problem(_REPAIR_DRIFT)
    choices = _repair_choices(problem)
    repeated = sorted((a for a in _repair_items(problem) if a['repair']['original'] == '胃'),
                      key=lambda a: a['repair']['start'])
    assert len(repeated) == 2
    first = repeated[0]
    revised = rebuild_problem(problem, files=[], ambiguity_answers={first['id']: choices[first['id']]})
    start = first['repair']['start']
    assert revised['text'] == _REPAIR_DRIFT[:start] + 'θ' + _REPAIR_DRIFT[start + 1:]
    assert revised['text'].count('胃') == 1
    partial = {a['id']: choices[a['id']] for a in _repair_items(problem)
               if a['repair']['original'] != '蟺'}
    partial['source_formula_confirmation'] = 'confirmed'
    blocked = rebuild_problem(problem, files=[], ambiguity_answers=partial)
    assert '蟺' in blocked['text']
    assert blocked['status'] != 'ready' and not blocked['solution']['answer']
    assert any(not a['resolved'] for a in _repair_items(blocked))


def test_source_repair_unknown_cjk_endpoint_cannot_be_silently_dropped():
    text = _REPAIR_CORRECT.replace('π/6]', '龘/6]')
    problem = _repair_problem(text)
    repairs = _repair_items(problem)
    assert any('龘' in a['repair']['original'] for a in repairs)
    answers = {a['id']: 'keep' for a in repairs}
    answers.update(source_formula_confirmation='confirmed', kernel_reject='confirmed')
    blocked = rebuild_problem(problem, files=[], ambiguity_answers=answers)
    assert blocked['text'] == text
    assert blocked['status'] != 'ready' and not blocked['solution']['answer']
    assert blocked['source_pages'][0]['ocr_text'] == text


@pytest.mark.parametrize('invalid', ['changed-text', 'forged-id', 'forged-option', 'other-problem', 'conditions'])
def test_source_repair_rejects_stale_or_forged_decisions_without_mutation(invalid):
    problem = _repair_problem(_REPAIR_GOLDEN)
    before = copy.deepcopy(problem)
    answers = _repair_choices(problem)
    kwargs = {}
    if invalid == 'changed-text':
        kwargs['text'] = _REPAIR_GOLDEN.replace('cos3', 'cos2')
    elif invalid == 'forged-id':
        answers['source_repair_forged'] = 'replace:0'
    elif invalid == 'forged-option':
        answers[next(iter(answers))] = 'replace:9999'
    elif invalid == 'other-problem':
        answers = _repair_choices(_repair_problem(_REPAIR_DRIFT))
    else:
        kwargs['condition_values'] = {'expression': '1'}
    with pytest.raises(ValueError):
        rebuild_problem(problem, files=[], ambiguity_answers=answers, **kwargs)
    assert problem == before
