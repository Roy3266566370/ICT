"""Regressions from the calculus/408 orchestrator and MaaS dispatch checks."""
from types import SimpleNamespace

import pytest

from app.labs import ai_solve, orchestrator
from app.labs.recognize import _attach_solution, build_problem


DERIVATIVE = '求函数f(x)=x^3在x=2处的导数。'
INTEGRAL = '计算定积分 ∫_0^1 x^2 dx。'


@pytest.mark.parametrize('text', [DERIVATIVE, '求函数f(x)=x^3，在x=2处求导数。'])
def test_point_condition_does_not_become_part_of_expression(text):
    problem = build_problem(text)
    _attach_solution(problem)
    assert problem['status'] == 'ready'
    assert not problem['model'].get('teaching')
    assert problem['solution']['answer_value'] == pytest.approx(12)


@pytest.mark.parametrize('text,expected', [(INTEGRAL, 1 / 3), (DERIVATIVE, 12)])
def test_single_calculus_task_has_executable_source_plan(text, expected):
    result = orchestrator.solve_composite(text, use_ai=False)
    assert result['status'] == '完成', result['plan_check']['errors']
    step = next(s for s in result['solve']['steps'] if s.get('subquestion'))
    assert step['outputs']['problem']['solution']['answer_value'] == pytest.approx(expected)
    assert all(i['source'] == 'problem' for i in result['plan']['steps'][0]['inputs'].values())


def test_single_calculus_ai_uses_typed_task_call(monkeypatch):
    calls = []

    def request(messages, schema, deadline):
        calls.append(schema)
        assert schema['properties']['task']['enum'] == ['derivative', 'none']
        return {'task': 'derivative', 'conditions': {'expression': 'x^3', 'variable': 'x', 'point': 2}}

    monkeypatch.setattr(orchestrator, '_ai_available', lambda: True)
    monkeypatch.setattr('app.labs.staged_understanding.request_json', request)
    result = orchestrator.solve_composite(DERIVATIVE, use_ai=True)
    assert result['status'] == '完成'
    assert result['planner']['mode'] == 'ai'
    assert len(calls) == 1
    assert '12' in result['answers'][0]['answer']


def test_single_calculus_ai_cannot_change_source_conditions(monkeypatch):
    monkeypatch.setattr(orchestrator, '_ai_available', lambda: True)
    monkeypatch.setattr('app.labs.staged_understanding.request_json', lambda *a: {
        'task': 'derivative', 'conditions': {'expression': 'x^2', 'variable': 'x', 'point': 2}})
    result = orchestrator.solve_composite(DERIVATIVE, use_ai=True)
    assert result['planner']['mode'] == 'deterministic'
    assert result['planner']['error']
    assert '12' in result['answers'][0]['answer']


@pytest.mark.parametrize('text', [
    DERIVATIVE + '另求该函数在x=1处的导数。',
    INTEGRAL + '以及该函数的极限。',
    '计算定积分 ∫_0^1 x^2 dx + ∫_0^1 x dx。',
    '计算定积分 ∫_0^1 x^2 dx 和 ∫_0^1 x dx。',
])
def test_single_task_shortcut_never_drops_extra_questions(text):
    result = orchestrator.solve_composite(text, use_ai=False)
    assert result['status'] != '完成'


@pytest.mark.parametrize('text,answer', [
    ('系统初始内存为空，物理块数为3，访问序列1,2,3,1,4,2,5，采用LRU算法，求缺页次数。', '缺页 6 次'),
    ('将192.168.1.0/24划分为8个子网，每个子网多少台可用主机？', '30'),
    ('主存地址32位，Cache容量32KB，块大小64B，4路组相联，求tag、index、offset位数。', 'tag 19'),
])
def test_ready_408_task_dispatches_via_maas_client(text, answer):
    class MaaSClient:
        settings = SimpleNamespace(llm_model='deepseek-v4.1-flash-1017')

        def generate_json(self, *args, **kwargs):
            return SimpleNamespace(
                data={
                    'question': text,
                    'model': {'kind': 'existing', 'canonical_text': text},
                    'missing_conditions': [],
                    'steps': [],
                }
            )

    problem = build_problem(text)
    result = ai_solve.solve_with_ai(problem, client=MaaSClient())
    assert result['verification'] == 'kernel'
    assert result['checkable']
    assert answer in result['answer']
    assert result['proposed_model']['canonical_text'] == text


def test_compact_calculus_plan_still_validates_input_bindings():
    understanding = orchestrator.build_understanding(DERIVATIVE, use_ai=False)
    plan = orchestrator.deterministic_plan(DERIVATIVE, understanding)
    plan['steps'][0]['inputs']['point'] = {'source': 'plan', 'value': 99}
    assert not orchestrator.validate_plan(plan, understanding)['ok']
