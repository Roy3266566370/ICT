import base64
import copy
import io
import time
from types import SimpleNamespace

import pytest
import httpx
from PIL import Image

from app.labs import ai_solve, local_agent
from app.labs.recognize import build_problem


def _source(tmp_path, monkeypatch):
    monkeypatch.setattr(local_agent, 'LABS_DIR', tmp_path)
    root = tmp_path / 'lab_reread'
    for folder, size in [('analysis', (1200, 3000)), ('previews', (200, 500))]:
        (root / folder).mkdir(parents=True)
        Image.new('RGB', size, 'white').save(root / folder / 'f1_p1.png')
    return build_problem(r'求 $\frac{1}{x$ 的积分。', pages=[{
        'image_key': 'f1_p1', 'page': 1, 'requires_formula_confirmation': True}])


def test_source_reread_uses_original_resolution_and_overlapping_details(tmp_path, monkeypatch):
    p = _source(tmp_path, monkeypatch)
    views = local_agent.source_images('lab_reread', p, cloud=True, detail=True)
    assert len(views) == 3
    assert {view['key'] for view in views} == {'f1_p1'}
    assert sum(len(view['image']) for view in views) < 4 * 1024 * 1024
    for view in views:
        image = Image.open(io.BytesIO(base64.b64decode(view['image'])))
        assert image.width >= 700, 'must reread the analysis image, not enlarge the small preview'


def test_cloud_rereads_missing_symbols_and_updates_question_and_conditions(tmp_path, monkeypatch):
    p = _source(tmp_path, monkeypatch)
    original = copy.deepcopy(p)
    calls = []

    class Client:
        settings = SimpleNamespace(llm_model='test-vision')

        def generate_json(self, task, payload, version, budget, **kwargs):
            calls.append((payload, kwargs))
            if len(calls) == 1:
                return SimpleNamespace(data={'question': r'求 $\frac{1}{x$ 的积分。', 'answer': '看不清公式',
                    'conditions': [], 'missing_conditions': ['公式分母缺符号'], 'model': {'kind': 'none'}})
            return SimpleNamespace(data={'question': r'计算 $\int_0^1 x^2\,dx$。', 'conditions': ['被积函数 x^2', '积分区间 [0,1]'],
                'missing_conditions': [], 'model': {'kind': 'kernel', 'task': 'integral',
                'conditions': {'expression': 'x^2', 'variable': 'x', 'lower': 0, 'upper': 1}}})

    result = ai_solve.solve_with_ai(p, client=Client(), lab_id='lab_reread')
    assert len(calls) == 2
    assert len(calls[1][1]['image_urls']) == 3
    assert calls[1][0]['source_recovery']['issues']
    assert result['source_recovery']['status'] == 'recovered'
    assert result['verification'] == 'kernel'
    ai_solve.attach_interactive_model(p, result)
    assert p['text'] == r'计算 $\int_0^1 x^2\,dx$。'
    assert p['recognition']['original_ocr_text'] == original['text']
    assert any(c['id'] == 'expression' and c['value'] == 'x^2' for c in p['recognition']['conditions'])
    p['ai_solution'] = result
    reviewed = ai_solve.review_ai_conditions(p, {'upper': '2'}, {})
    assert reviewed['ai_solution']['source_recovery'] == result['source_recovery']


def test_reread_failure_preserves_source_and_does_not_guess(tmp_path, monkeypatch):
    p = _source(tmp_path, monkeypatch)
    original = copy.deepcopy(p)
    calls = []

    class Client:
        settings = SimpleNamespace(llm_model='test-vision')

        def generate_json(self, *args, **kwargs):
            calls.append(1)
            if len(calls) > 1:
                raise ValueError('image service unavailable')
            return SimpleNamespace(data={'question': p['text'], 'answer': '无法确认', 'conditions': [],
                'missing_conditions': ['公式缺少符号'], 'model': {'kind': 'none'}})

    result = ai_solve.solve_with_ai(p, client=Client(), lab_id='lab_reread')
    assert len(calls) == 2
    assert result['source_recovery']['status'] == 'failed'
    assert not result['checkable']
    assert p == original


def test_plain_text_problem_does_not_request_images_or_repeat_calls():
    class Client:
        settings = SimpleNamespace(llm_model='test')
        calls = 0

        def generate_json(self, *args, **kwargs):
            self.calls += 1
            return SimpleNamespace(data={'answer': '4', 'conditions': [], 'model': {'kind': 'evaluate', 'expression': '2+2'}})

    client = Client()
    result = ai_solve.solve_with_ai({'text': '计算2+2。', 'recognition': {}}, client=client)
    assert client.calls == 1
    assert result['answer'] == '4'


def test_local_reading_retries_once_and_updates_the_source(tmp_path, monkeypatch):
    from app.labs.source_recovery import read_with_source_retry
    p = _source(tmp_path, monkeypatch)
    calls = []
    def read(views, recovery):
        calls.append(views)
        return dict(question=p['text'] if recovery is None else '计算定积分 ∫_0^1 x^2 dx。',
            subquestions=[], relations=[], target='积分值', conditions=[], uncertainties=[],
            model={'kind': 'kernel', 'task': 'integral', 'conditions': {'expression': 'x^2', 'variable': 'x', 'lower': 0, 'upper': 1}},
            unsupported_reason='')
    data = read_with_source_retry(p, local_agent.source_images('lab_reread', p, cloud=False), read,
        lab_id='lab_reread', cloud=False)
    result = local_agent.finish_understanding(data, p)
    assert len(calls) == 2 and len(calls[-1]) == 3
    assert result['source_recovery']['status'] == 'recovered'
    ai_solve.attach_interactive_model(p, result)
    assert p['text'] == '计算定积分 ∫_0^1 x^2 dx。'


def test_unreadable_second_transcription_cannot_replace_the_first(tmp_path, monkeypatch):
    from app.labs.source_recovery import read_with_source_retry
    p = _source(tmp_path, monkeypatch)
    initial = dict(question='计算 ∫_0^1 x dx。', conditions=['下限为0'], missing_conditions=[])
    def read(views, recovery):
        return initial if recovery is None else dict(question=r'\frac{', conditions=[], missing_conditions=[])
    data = read_with_source_retry(p, local_agent.source_images('lab_reread', p, cloud=True), read,
        lab_id='lab_reread', cloud=True)
    assert data['question'] == initial['question']
    assert data['conditions'] == initial['conditions']
    assert data['_source_recovery']['status'] == 'unresolved'
    assert data['missing_conditions']


@pytest.mark.parametrize('formula', [r'$\frac{1}$', r'$\sqrt{}$', '1/(x'])
def test_obviously_incomplete_formula_is_not_a_recovered_transcription(formula):
    from app.labs.source_recovery import transcription_issues
    assert transcription_issues('计算 ' + formula + ' 的积分。')


def test_real_http_timeout_during_reread_preserves_first_reading(tmp_path, monkeypatch):
    from app.labs.source_recovery import read_with_source_retry
    p = _source(tmp_path, monkeypatch)
    def read(views, recovery):
        if recovery:
            raise httpx.ReadTimeout('retry timed out')
        return {'question': '计算定积分。', 'conditions': [], 'missing_conditions': []}
    result = read_with_source_retry(p, local_agent.source_images('lab_reread', p, cloud=False), read,
        lab_id='lab_reread', cloud=False)
    assert result['question'] == '计算定积分。'
    assert result['_source_recovery']['status'] == 'failed'


def test_local_original_and_details_fit_real_request_context_budget(tmp_path, monkeypatch):
    from app.labs import staged_understanding
    p = _source(tmp_path, monkeypatch)
    views = local_agent.source_images('lab_reread', p, cloud=False, detail=True)
    sent = []
    class Transport:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, *args, **kwargs):
            sent.append(kwargs['json'])
            return SimpleNamespace(raise_for_status=lambda: None,
                json=lambda: {'message': {'content': '{"question":"read"}'}})
    monkeypatch.setattr(staged_understanding.httpx, 'Client', Transport)
    result = staged_understanding.request_json([{'role': 'user', 'content': '对照原图重新读取公式。',
        'images': [v['image'] for v in views]}], local_agent.Understanding.model_json_schema(), time.monotonic() + 10)
    assert sent and result['question'] == 'read'


def test_local_reread_still_runs_after_repairing_invalid_json(tmp_path, monkeypatch):
    import json
    p = _source(tmp_path, monkeypatch)
    for directory in ('analysis', 'previews'):
        Image.new('RGB', (300, 500), 'white').save(tmp_path / 'lab_reread' / directory / 'f1_p1.png')
    settings = SimpleNamespace(lab_understanding_pipeline='legacy', lab_understanding_provider='ollama',
        lab_ollama_model='test-vision', lab_ollama_url='http://local.invalid')
    monkeypatch.setattr(local_agent, 'get_settings', lambda: settings)
    reading = dict(question='计算定积分 ∫_0^1 x^2 dx。', subquestions=[], relations=[], target='积分值',
        conditions=[], uncertainties=[], unsupported_reason='',
        model={'kind': 'kernel', 'task': 'integral', 'conditions': {'expression': 'x^2', 'variable': 'x', 'lower': 0, 'upper': 1}})
    requests = []
    class Transport:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, *args, **kwargs):
            requests.append(kwargs['json'])
            content = '{' if len(requests) == 1 else json.dumps(reading)
            return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {'message': {'content': content}})
    monkeypatch.setattr(local_agent.httpx, 'Client', Transport)
    result = local_agent.understand(p, lab_id='lab_reread')
    assert len(requests) == 3
    assert result['source_recovery']['status'] == 'recovered'
