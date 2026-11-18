"""Reported provider output shapes, replayed through the real solve boundary.

These are reconstructions from the incident report, not captured raw responses.
"""
from copy import deepcopy
from types import SimpleNamespace

import pytest

from app.labs import ai_solve
from app.labs.recognize import build_problem


class ReplayClient:
    settings = SimpleNamespace(llm_model='replay')

    def __init__(self, *responses):
        self.responses = responses
        self.calls = []

    def generate_json(self, task, payload, *args, **kwargs):
        self.calls.append((task, payload, kwargs))
        return SimpleNamespace(data=deepcopy(self.responses[min(len(self.calls)-1, len(self.responses)-1)]))


def solve(plan, answer=''):
    client = ReplayClient({'model': plan, 'answer': answer})
    p = {'text': '按题目给出的条件计算', 'status': 'pending_ai', 'recognition': {'ambiguities': []}}
    return ai_solve.solve_with_ai(p, client=client), client


@pytest.mark.parametrize('plan,answer,expected', [
    ({'kind': 'generic', 'symbols': {}, 'constants': {'p': {'value': '1/4'}},
      'steps': [{'id': 's1', 'op': 'evaluate', 'expr': 'p^2'}], 'target': 's1'}, '1/16', '1/16'),
    ({'kind': 'generic', 'symbols': ['x'], 'steps': [
        {'id': 's1', 'op': 'inequality', 'expr': '2*x>4', 'var': 'x'}], 'target': 's1'}, '', '2'),
    ({'kind': 'generic', 'symbols': {'P': 'parameter'}, 'constants': {
        'P': {'value': 10000}, 'r': {'value': .05}, 'n': {'value': 3}},
      'steps': [{'id': 's1', 'op': 'evaluate', 'expr': 'A=P*(1+r)^n'}]}, '11576.25', '46305/4'),
    ({'kind': 'kernel', 'task': 'parameter_limit', 'expression': 'a*sin(x)/x',
      'variable': 'x', 'point': 0, 'parameter': 'a', 'target_value': 6}, 'a=6', '6'),
    ({'kind': 'generic', 'symbols': ['x', 'y'], 'constants': {'苹果单价': 8, '梨单价': 12},
      'equations': ['x+y=5', '苹果单价*x+梨单价*y=52'],
      'steps': [{'title': '列方程', 'detail': '解方程组'}]}, '苹果2千克，梨3千克', 'x=2'),
    ({'kind': 'generic', 'symbols': ['x'], 'steps': [
        {'id': 's1', 'op': 'extremum', 'expr': 'x^3-3*x+1', 'var': 'x', 'lower': -2, 'upper': 2}]}, '', '最大值 3'),
])
def test_reported_shapes_reach_kernel(plan, answer, expected):
    result, client = solve(plan, answer)
    assert result['verification'] == 'kernel', result
    assert expected in result['answer']
    assert len(client.calls) == 1


def test_repair_receives_original_output_and_error_once():
    bad = {'kind': 'generic', 'symbols': ['x'], 'steps': [{'title': '求值', 'detail': '代入计算'}]}
    good = {'kind': 'generic', 'symbols': [], 'steps': [{'id': 's1', 'op': 'evaluate', 'expr': '2+2'}]}
    client = ReplayClient({'model': bad, 'answer': '4'}, {'model': good, 'answer': '4'})
    result = ai_solve.solve_with_ai({'text': '计算2+2'}, client=client)
    assert result['verification'] == 'kernel'
    assert len(client.calls) == 2
    payload = client.calls[1][1]
    assert payload['previous_output']['model'] == bad
    assert payload['kernel_error']
    assert result['model_attempts'][0]['error']


def test_failed_repair_preserves_reference_and_final_status():
    result, client = solve({'kind': 'generic', 'symbols': ['x'], 'steps': [{'title': '说明'}]}, '参考答案')
    p = {'status': 'pending_ai', 'recognition': {'ambiguities': []}}
    ai_solve.attach_interactive_model(p, result)
    assert len(client.calls) == 2
    assert p['status'] == 'reference'
    assert p['solution']['answer'] == '参考答案'


def test_actual_numeric_disagreement_stays_ungradable():
    result, _ = solve({'kind': 'generic', 'symbols': [], 'steps': [
        {'id': 's1', 'op': 'evaluate', 'expr': '2+2'}]}, '5')
    assert result['verification'] == 'needs_review'
    assert result['checkable'] is False


def test_prompt_has_complete_contract_and_executable_examples():
    _, client = solve({'kind': 'evaluate', 'expression': '2+2'}, '4')
    payload = client.calls[0][1]
    assert 'question' in payload['response_schema']['required']
    assert payload['response_schema']['properties']['question']['minLength'] == 1
    assert payload['generic_schema']['properties']['steps']['items']['oneOf']
    examples = payload['model_examples']
    assert len(examples) >= 3
    for example in examples:
        assert ai_solve.compute_plan(example)['answer']


def test_concept_handshake_is_not_locally_ready():
    p = build_problem('为什么TCP建立连接需要三次握手，而不是两次？')
    assert p['status'] != 'ready'


def test_normalization_does_not_mutate_or_guess_prose_steps():
    from app.labs.model_contract import normalize_plan
    plan = {'kind': 'generic', 'symbols': ['x'], 'steps': [{'title': 'x=4'}]}
    original = deepcopy(plan)
    normalized = normalize_plan(plan)
    assert plan == original
    assert not normalized['steps'][0].get('op')


def test_conflicting_conditions_are_not_silently_overwritten():
    from app.labs.model_contract import normalize_plan
    with pytest.raises(ValueError, match='冲突'):
        normalize_plan({'kind': 'kernel', 'task': 'limit', 'expression': 'x',
                        'conditions': {'expression': 'x+1', 'variable': 'x', 'point': 0}})


@pytest.mark.parametrize('target', ['s9', 'x+y'])
def test_unknown_target_does_not_select_an_unrelated_result(target):
    with pytest.raises(ValueError):
        ai_solve.compute_plan({'kind': 'generic', 'symbols': ['x', 'y'], 'steps': [
            {'id': 's1', 'op': 'solve', 'equations': ['x=2', 'y=3'], 'for': ['x', 'y']}], 'target': target})


def test_multi_letter_assignment_disagreement_is_detected():
    assert ai_solve._compare_reference({'kind': 'values', 'values': ['4'], 'variables': ['v0']}, 'v0=5') is False


def test_empty_reference_and_failed_model_is_reviewable():
    result, _ = solve({'kind': 'generic', 'symbols': [], 'steps': [{'title': '说明'}]})
    assert result['verification'] == 'needs_review'
    assert '未' in result['answer']


def test_discontinuous_extremum_is_not_a_finite_verified_answer():
    with pytest.raises(ValueError):
        ai_solve.compute_plan({'kind': 'generic', 'symbols': ['x'], 'steps': [
            {'id': 's1', 'op': 'extremum', 'expr': '1/x', 'var': 'x', 'lower': '-1', 'upper': '1'}]})


def test_extrema_rank_candidates_using_current_constant_values():
    plan = {'kind': 'generic', 'symbols': ['x'], 'constants': {'a': -1}, 'steps': [
        {'id': 's1', 'op': 'extremum', 'expr': 'a*x', 'var': 'x', 'lower': '-1', 'upper': '1'}]}
    result = ai_solve.compute_plan(plan)
    assert result['expected']['values'] == ['-1', '1']


def test_symbol_target_must_be_a_component_of_the_selected_step():
    with pytest.raises(ValueError):
        ai_solve.compute_plan({'kind': 'generic', 'symbols': ['x', 'y'], 'steps': [
            {'id': 's1', 'op': 'solve', 'equations': ['x=3', 'y=2'], 'for': ['x', 'y']},
            {'id': 's2', 'op': 'evaluate', 'expr': '4'}], 'target': 'x'})


@pytest.mark.parametrize('name', ['total_cost', 'cost', 'sin_rate', 'cos_angle', 'exp_value'])
def test_declared_names_containing_function_names_stay_intact(name):
    from app.labs.expr import parse_expression
    value = parse_expression(f'{name}+1', [name])
    assert {str(symbol) for symbol in value.free_symbols} == {name}
