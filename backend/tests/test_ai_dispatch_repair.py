"""Regressions from the calculus/408 browser and real Ollama audit."""
import json

import pytest

from app.labs import local_agent, orchestrator
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


def mock_dispatch(monkeypatch, response):
    calls = []

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {'done_reason': 'stop', 'message': {'content': json.dumps(response)}}

    class Client:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, **kwargs):
            calls.append(kwargs['json'])
            return Response()

    monkeypatch.setattr(local_agent.httpx, 'Client', Client)
    return calls


@pytest.mark.parametrize('text,answer', [
    ('系统初始内存为空，物理块数为3，访问序列1,2,3,1,4,2,5，采用LRU算法，求缺页次数。', '缺页 6 次'),
    ('将192.168.1.0/24划分为8个子网，每个子网多少台可用主机？', '30'),
    ('主存地址32位，Cache容量32KB，块大小64B，4路组相联，求tag、index、offset位数。', 'tag 19'),
])
def test_ready_408_task_dispatches_unchanged_source(monkeypatch, text, answer):
    calls = mock_dispatch(monkeypatch, {'tool': 'existing', 'uncertainties': []})
    result = local_agent.understand(build_problem(text))
    assert result['verification'] == 'kernel'
    assert result['checkable']
    assert answer in result['answer']
    assert result['proposed_model']['canonical_text'] == text
    assert result['dispatch']['mode'] == 'ai'
    assert calls[0]['format']['properties']['tool']['enum'] == ['existing', 'none']
    assert len(json.dumps(calls[0], ensure_ascii=False)) < 6000


def test_ready_dispatch_does_not_ignore_model_uncertainty(monkeypatch):
    mock_dispatch(monkeypatch, {'tool': 'none', 'uncertainties': ['原图初态不清']})
    result = local_agent.understand(build_problem('将192.168.1.0/24划分为8个子网，每个子网多少台可用主机？'))
    assert result['verification'] == 'needs_review'
    assert not result['checkable']
    assert result['computation'] is None


def test_ready_dispatch_never_uses_model_rewritten_text(monkeypatch):
    text = '将192.168.1.0/24划分为8个子网，每个子网多少台可用主机？'
    mock_dispatch(monkeypatch, {'tool': 'existing', 'canonical_text': '计算1+999', 'answer': '999'})
    result = local_agent.understand(build_problem(text))
    assert result['verification'] == 'kernel'
    assert result['proposed_model']['canonical_text'] == text
    assert '每子网 30' in result['answer']


def test_missing_408_conditions_do_not_enter_ready_dispatch(monkeypatch):
    problem = build_problem('采用LRU页面置换算法，求缺页次数。')
    assert problem['status'] != 'ready'
    monkeypatch.setattr(local_agent, '_dispatch_recognized', lambda *a: pytest.fail('缺少条件不得执行'))
    # Stop at the general understanding transport, before any kernel can run.
    class StopTransport(Exception):
        pass
    monkeypatch.setattr(local_agent.httpx, 'Client', lambda **kw: (_ for _ in ()).throw(StopTransport()))
    with pytest.raises(StopTransport):
        local_agent.understand(problem)


def test_compact_calculus_plan_still_validates_input_bindings():
    understanding = orchestrator.build_understanding(DERIVATIVE, use_ai=False)
    plan = orchestrator.deterministic_plan(DERIVATIVE, understanding)
    plan['steps'][0]['inputs']['point'] = {'source': 'plan', 'value': 99}
    assert not orchestrator.validate_plan(plan, understanding)['ok']


@pytest.mark.parametrize('extra', ['并证明该算法最优。', '再用FIFO计算。',
    '并计算物理块数为4时的缺页次数。', '并解释LRU算法的含义。'])
def test_ready_408_dispatch_cannot_claim_uncovered_goals(monkeypatch, extra):
    text = '系统初始内存为空，物理块数为3，访问序列1,2,3,1,4,2,5，采用LRU算法，求缺页次数' + extra
    mock_dispatch(monkeypatch, {'tool': 'existing'})
    result = local_agent.understand(build_problem(text))
    assert result['verification'] == 'needs_review'
    assert not result['checkable']
    assert result['computation'] is None


def test_ready_page_dispatch_rejects_multiple_algorithms(monkeypatch):
    text = '系统初始内存为空，物理块数为3，访问序列1,2,3,1,4,2,5，采用FIFO和LRU算法分别计算缺页次数。'
    mock_dispatch(monkeypatch, {'tool': 'existing'})
    result = local_agent.understand(build_problem(text))
    assert result['verification'] == 'needs_review'
    assert not result['checkable']


@pytest.mark.parametrize('response', [[], None])
def test_ready_dispatch_rejects_non_object_response(monkeypatch, response):
    mock_dispatch(monkeypatch, response)
    with pytest.raises(ValueError, match='响应无效'):
        local_agent.understand(build_problem('将192.168.1.0/24划分为8个子网，每个子网多少台可用主机？'))
