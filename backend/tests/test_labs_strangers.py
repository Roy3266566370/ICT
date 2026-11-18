import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.labs import ai_solve
from app.labs.generic_model import compile_generic, evaluate_generic
from app.labs.recognize import build_problem, normalize_latex_prose
from app.ppt_ai.types import CallBudget

FIXTURES = Path(__file__).resolve().parents[2] / 'fixtures' / 'strangers' / 'problems.json'


def _fixtures() -> list[dict]:
    return json.loads(FIXTURES.read_text(encoding='utf-8'))['problems']


@pytest.mark.parametrize('item', _fixtures(), ids=lambda item: item['id'])
def test_stranger_plan_computes_expected_answer(item):
    if not item.get('plan'):
        pytest.skip('local recognition case')
    result = ai_solve.compute_plan(item['plan'])
    expected = item.get('expect') or {}
    assert result['answer']
    if expected.get('answer_contains'):
        assert ''.join(expected['answer_contains'].split()) in ''.join(result['answer'].split())
    assert result.get('interactive_model', {}).get('engine') == 'generic_v1'


@pytest.mark.parametrize('item', _fixtures(), ids=lambda item: item['id'])
def test_stranger_local_status(item):
    if item.get('plan'):
        pytest.skip('recorded generic plan case')
    problem = build_problem(item['text'], pages=item.get('pages') or [])
    assert problem['status'] == item['expect']['status']


def test_parameter_limit_generic_model_reaches_ready_with_slider():
    problem = {'text': '已知含参极限等于6，求参数a。', 'problem_id': 'p1',
               'recognition': {'ambiguities': []}, 'source_pages': []}
    plan = {'kind': 'generic', 'subject': 'calculus',
            'symbols': [{'name': 'x', 'role': 'independent'}, {'name': 'a', 'role': 'unknown'}],
            'constants': [{'name': 'L', 'value': '6', 'tunable': True, 'min': 1, 'max': 12}],
            'steps': [{'id': 's1', 'op': 'limit', 'expr': '(a*sin(x))/x', 'var': 'x', 'point': '0'},
                      {'id': 's2', 'op': 'solve', 'equation': 's1=L', 'for': ['a']}],
            'target': {'step': 's2', 'label': 'a'},
            'plot': {'expr': '(a*sin(x))/x', 'var': 'x', 'range': [-1, 1]}}
    class Client:
        settings = SimpleNamespace(llm_model='test-ai')
        def generate_json(self, *args, **kwargs):
            return SimpleNamespace(data={'question': problem['text'], 'model': plan, 'answer': 'a=6', 'steps': []})
    result = ai_solve.solve_with_ai(problem, client=Client())
    assert result['verification'] == 'kernel'
    assert result['computation']['interactive_model']['engine'] == 'generic_v1'
    assert [item['id'] for item in result['computation']['interactive_model']['params']] == ['L']
    ai_solve.attach_interactive_model(problem, result)
    assert problem['status'] == 'ready'
    assert problem['subject'] == 'calculus'
    assert 'a=6' in problem['solution']['answer']


def test_none_with_reference_answer_marks_reference_status():
    problem = {'text': '快速排序为什么不稳定？', 'problem_id': 'p1', 'subject': 'algorithm',
               'model': {'engine': 'unsupported_v1'}, 'recognition': {'ambiguities': []}, 'source_pages': []}
    ai_solve.attach_interactive_model(problem, {
        'verification': 'ai_reference', 'proposed_model': {'kind': 'none'},
        'answer': '因为相等元素可能在分区时交换位置。', 'steps': [{'title': '原因', 'detail': '分区交换'}]})
    assert problem['status'] == 'reference'
    assert '相等元素' in problem['solution']['answer']


def test_evaluate_and_equations_get_generic_v1_panel():
    evaluate = ai_solve.compute_plan({'kind': 'evaluate', 'expression': '2+2'})
    assert evaluate['interactive_model']['engine'] == 'generic_v1'
    equations = ai_solve.compute_plan({'kind': 'equations', 'variables': ['x', 'y'],
                                       'equations': ['x+y=5', '8*x+12*y=52'], 'target': 'x,y'})
    assert equations['interactive_model']['engine'] == 'generic_v1'
    assert equations['expected']['rows'] == [['2', '3']]


def test_generic_answer_can_be_checked_numerically():
    plan = {'kind': 'generic', 'symbols': [{'name': 'x', 'role': 'independent'}],
            'steps': [{'id': 's1', 'op': 'evaluate', 'expr': '2+2'}], 'target': {'step': 's1'}}
    computed = ai_solve.compute_plan(plan)
    problem = {'ai_solution': {'checkable': True, 'answer': computed['answer'],
                               'computation': computed, 'options': []}}
    assert ai_solve.check_ai_answer(problem, '4')['correct']
    assert not ai_solve.check_ai_answer(problem, '5')['correct']


def test_ocr_quality_untrusted_skips_local_model():
    problem = build_problem('若lim =6，求a。', pages=[{
        'file_id': 'f1', 'page': 1, 'image_key': 'f1_p1', 'method': 'image_ocr'}])
    assert problem['status'] == 'pending_ai'
    assert problem['model']['engine'] == 'unsupported_v1'
    assert problem['recognition']['quality']['untrusted'] is True
    assert problem['recognition']['local_build_skipped'] is True


def test_latex_limit_prose_is_normalized_for_local_rules():
    plain = normalize_latex_prose(r'求 \lim_{x\to 0} \frac{\sin x}{x} 的值')
    assert 'lim' in plain and '→' in plain and '((sin x)/(x))' in plain


def test_kernel_error_trace_keeps_reason_code():
    p = {'text': '求特殊表达式', 'recognition': {'ambiguities': []}, 'problem_id': 'p1'}
    class Client:
        settings = SimpleNamespace(llm_model='test-ai')
        def generate_json(self, *args, **kwargs):
            return SimpleNamespace(data={'model': {'kind': 'evaluate', 'expression': '__import__("os")'},
                                         'answer': '参考', 'steps': []})
    result = ai_solve.solve_with_ai(p, client=Client())
    assert result['verification'] == 'ai_reference'
    assert any(entry.get('code') == 'KERNEL_ERROR' for entry in result['trace'])


def test_cloud_two_stage_reads_then_models_with_separate_calls():
    calls = []
    class Provider:
        def generate_json(self, task_type, payload, version, budget, **kwargs):
            calls.append((task_type, kwargs))
            if task_type == 'lab_read_question':
                return SimpleNamespace(data={'question': '求 (1+a*x)/x 当 x→0 的极限并令其等于 3。',
                    'target': 'a', 'conditions': [{'value': '极限等于3', 'excerpt': '等于3'}], 'uncertainties': []})
            return SimpleNamespace(data={'answer': 'a=3', 'model': {'kind': 'generic', 'symbols': [
                {'name': 'x', 'role': 'independent'}, {'name': 'a', 'role': 'unknown'}],
                'steps': [{'id': 's1', 'op': 'limit', 'expr': '(1+a*x)/x', 'var': 'x', 'point': '0'},
                          {'id': 's2', 'op': 'solve', 'equation': 's1=3', 'for': ['a']}],
                'target': {'step': 's2', 'label': 'a'}}, 'steps': []})
    problem = {'text': '求极限并求 a', 'recognition': {'ambiguities': []}, 'source_pages': []}
    data = ai_solve._cloud_two_stage(Provider(), problem, [], problem['text'], [],
                                     'lab_test', CallBudget(max_calls=3, output_tokens_limit=8000))
    assert data['question'].startswith('求 (1+a*x)/x')
    assert data['model']['kind'] == 'generic'
    assert [call[0] for call in calls] == ['lab_read_question', 'lab_model_question']
    assert calls[0][1].get('thinking') is False
    assert calls[1][1].get('thinking') is True


def test_cloud_two_stage_flattens_condition_objects_and_keeps_uncertainty_soft():
    class Provider:
        def generate_json(self, task_type, payload, version, budget, **kwargs):
            if task_type == 'lab_read_question':
                return SimpleNamespace(data={
                    'question': '求 a，使极限等于 3。', 'target': 'a',
                    'conditions': [{'value': '极限等于3', 'excerpt': '等于3'}],
                    'uncertainties': ['指数略模糊，请核对原图']})
            return SimpleNamespace(data={'answer': 'a=3', 'model': {'kind': 'evaluate', 'expression': '1+2'},
                                         'steps': []})
    problem = {'text': '求 a', 'recognition': {'ambiguities': []}, 'source_pages': []}
    data = ai_solve._cloud_two_stage(Provider(), problem, [], problem['text'], [],
                                     'lab_test', CallBudget(max_calls=3, output_tokens_limit=8000))
    assert data['conditions'] == ['极限等于3']
    assert data['missing_conditions'] == ['指数略模糊，请核对原图']
    assert data['_soft_missing'] == ['指数略模糊，请核对原图']


def test_read_uncertainty_is_soft_but_explicit_missing_is_hard():
    missing, hard = ai_solve._split_missing({
        'missing_conditions': ['看不清指数', '缺少初值条件'],
        '_soft_missing': ['看不清指数'],
    })
    assert missing == ['看不清指数', '缺少初值条件']
    assert hard == ['缺少初值条件']


def test_code_answer_is_rejected_only_for_math_images():
    from app.labs.source_recovery import obviously_wrong_domain
    assert obviously_wrong_domain(
        '14．微分方程y′=... 满足条件 y(1)=0 的解为 (x + y)²',
        'package main import "fmt" func main() { var a, b float32 }')
    assert not obviously_wrong_domain('求下列程序的输出', '```go\npackage main\n```')
    assert not obviously_wrong_domain('微分方程 y′=1 的解', '微分方程 y′=1/(x+y)^2 的解为')


def test_unmapped_subquestion_is_reported_as_task_support():
    class Client:
        settings = SimpleNamespace(llm_model='test-ai')
        def generate_json(self, *args, **kwargs):
            return SimpleNamespace(data={
                'question': '求切平面与区域最值', 'model': {'kind': 'none'}, 'answer': '参考解答',
                'unmapped_conditions': ['第二问二元区域最值无对应任务']})
    problem = {'text': '求切平面与区域最值', 'recognition': {'ambiguities': []}}
    result = ai_solve.solve_with_ai(problem, client=Client())
    assert result['verification'] == 'needs_review'
    assert result['failure_stage'] == 'task_support'
    assert any('尚未映射的原题条件' in item for item in result['missing_conditions'])