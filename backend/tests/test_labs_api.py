"""题目实验室 HTTP 端点的集成测试（独立临时数据库，不触发真实模型）。"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path
from typing import Any, Iterator

import pytest

_TMP_DIR = Path(tempfile.mkdtemp(prefix="xiangsheng-labs-api-"))
os.environ["DATABASE_URL"] = "sqlite:///" + (_TMP_DIR / "test.db").as_posix()
os.environ["SESSION_COOKIE_SECURE"] = "false"
os.environ["ENFORCE_CSRF"] = "true"
os.environ["LAB_AI_ENABLED"] = "false"
os.environ["LABS_DIR"] = str(_TMP_DIR / "labs")

from fastapi.testclient import TestClient  # noqa: E402

from app.db.session import reset_engine_cache  # noqa: E402
from app.settings import get_settings  # noqa: E402

get_settings.cache_clear()
reset_engine_cache()

from app.main import create_app  # noqa: E402


def _session(client: TestClient) -> dict[str, Any]:
    response = client.post("/api/v1/sessions")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _headers(session: dict[str, Any]) -> dict[str, str]:
    return {"X-CSRF-Token": str(session["csrf_token"])}


@pytest.fixture(scope="module")
def app() -> Any:
    return create_app()


@pytest.fixture
def owner(app: Any) -> Iterator[TestClient]:
    with TestClient(app) as client:
        yield client


@pytest.fixture
def guest(app: Any) -> Iterator[TestClient]:
    with TestClient(app) as client:
        yield client



def test_empty_ocr_image_upload_cloud_solve_and_condition_review(owner, monkeypatch):
    import io
    from types import SimpleNamespace
    from PIL import Image
    from app.labs import extract
    from app.ppt_ai.client import PPTAIClient
    monkeypatch.setattr(extract, '_ocr', lambda image: ('', None))
    monkeypatch.setattr(extract, '_math_ocr', lambda image: None)
    captured = {}
    def generate(self, task, payload, *args, **kwargs):
        captured.update(kwargs)
        assert payload['ocr_hint'] == ''
        return SimpleNamespace(data={'question': '求函数x^3的导数', 'answer': '3*x^2', 'steps': [],
            'model': {'kind': 'kernel', 'task': 'higher_derivative',
                      'conditions': {'expression': 'x^3', 'variable': 'x', 'order': 1}}})
    monkeypatch.setattr(PPTAIClient, 'generate_json', generate)
    session = _session(owner)
    image = io.BytesIO()
    Image.new('RGB', (150, 100), 'white').save(image, format='PNG')
    response = owner.post('/api/v1/labs', headers=_headers(session),
        files=[('files', ('formula.png', image.getvalue(), 'image/png'))])
    assert response.status_code == 201, response.text
    document = response.json()['data']
    p = document['problems'][0]
    url = f'/api/v1/labs/{document["lab_id"]}'
    response = owner.post(url + '/ai-solve', headers=_headers(session), json={
        'problem_id': p['problem_id'], 'expected_revision': document['revision']})
    assert response.status_code == 200, response.text
    p = response.json()['data']['document']['problems'][0]
    assert p['status'] == 'ready'
    assert p['ai_solution']['verification'] == 'kernel'
    assert captured['image_urls'][0].startswith('data:image/jpeg;base64,')
    assert p['ai_solution']['source_review_required'] is True
    assert p['ai_solution']['checkable'] is False
    from app.db.session import get_session_factory
    from app.db.models import LabRecord
    with get_session_factory()() as db:
        row = db.get(LabRecord, document['lab_id'])
        assert row.status == row.document['status']
        assert row.subject == row.document['subject']
    response = owner.post(url + '/review', headers=_headers(session), json={
        'problem_id': p['problem_id'], 'text': p['text'], 'subject': p['subject'],
        'condition_values': {'expression': 'x^2'}, 'ambiguity_answers': {}})
    assert response.status_code == 200, response.text
    p = response.json()['data']['problems'][0]
    assert p['ai_solution']['verification'] == 'kernel'
    assert p['ai_solution']['proposed_model']['conditions']['expression'] == 'x^2'


def test_reference_transcription_is_saved_and_cache_uses_updated_text(owner, monkeypatch):
    import io
    from types import SimpleNamespace
    from PIL import Image
    from app.labs import extract
    from app.ppt_ai.client import PPTAIClient
    monkeypatch.setattr(extract, '_ocr', lambda image: ('', None))
    monkeypatch.setattr(extract, '_math_ocr', lambda image: None)
    calls = []
    def generate(*args, **kwargs):
        calls.append(1)
        return SimpleNamespace(data={'question': '解释电路图中两个元件的作用。', 'answer': '参考说明',
            'conditions': ['两个元件串联'], 'steps': [{'title': '读图', 'detail': '逐个分析元件'}],
            'model': {'kind': 'none'}})
    monkeypatch.setattr(PPTAIClient, 'generate_json', generate)
    session = _session(owner)
    image = io.BytesIO()
    Image.new('RGB', (100, 100), 'white').save(image, format='PNG')
    response = owner.post('/api/v1/labs', headers=_headers(session),
        files=[('files', ('circuit.png', image.getvalue(), 'image/png'))])
    assert response.status_code == 201, response.text
    document = response.json()['data']
    url = f'/api/v1/labs/{document["lab_id"]}'
    body = {'problem_id': document['problems'][0]['problem_id'], 'expected_revision': document['revision']}
    response = owner.post(url + '/ai-solve', headers=_headers(session), json=body)
    assert response.status_code == 200, response.text
    document = response.json()['data']['document']
    p = document['problems'][0]
    assert p['text'] == '解释电路图中两个元件的作用。'
    assert p['title'] == p['text']
    assert p['recognition']['original_ocr_text'] == ''
    assert p['ai_solution']['answer'] == '参考说明'
    assert p['ai_solution']['verification'] == 'ai_reference'
    saved = owner.get(url).json()['data']['problems'][0]
    assert saved['text'] == p['text']
    body['expected_revision'] = document['revision']
    response = owner.post(url + '/ai-solve', headers=_headers(session), json=body)
    assert response.status_code == 200, response.text
    assert response.json()['data']['cached'] is True
    assert len(calls) == 1


@pytest.mark.parametrize('legacy', [False, True])
@pytest.mark.parametrize('read_first', [False, True])
@pytest.mark.parametrize('edit', [False, True])
def test_non_kernel_confirmation_keeps_equation_plan(owner, monkeypatch, legacy, read_first, edit):
    from types import SimpleNamespace
    from app.ppt_ai.client import PPTAIClient
    plan = {'kind': 'equations', 'variables': ['x'], 'equations': ['3*x=12']}
    calls = []
    def generate(*args, **kwargs):
        calls.append(1)
        return SimpleNamespace(data={'model': plan, 'answer': '4', 'steps': []})
    monkeypatch.setattr(PPTAIClient, 'generate_json', generate)
    session, document = _create_lab(owner, '三个同价商品共花十二元，求每件价格。')
    url = f'/api/v1/labs/{document["lab_id"]}'
    problem_id = document['problems'][0]['problem_id']
    response = owner.post(url + '/ai-solve', headers=_headers(session),
        json={'problem_id': problem_id, 'expected_revision': document['revision']})
    assert response.status_code == 200, response.text
    p = response.json()['data']['document']['problems'][0]
    if legacy:
        import copy
        from app.db.session import get_session_factory
        from app.db.models import LabRecord
        with get_session_factory()() as db:
            row = db.get(LabRecord, document['lab_id'])
            saved = copy.deepcopy(row.document)
            saved['problems'][0]['ai_solution'].pop('agent_understanding')
            saved['problems'][0]['recognition']['conditions'] = []
            row.document = saved
            db.commit()
    if read_first:
        loaded = owner.get(url).json()['data']['problems'][0]
        assert loaded['ai_solution']['agent_understanding']['model'] == plan
        assert {c['id'] for c in loaded['recognition']['conditions']} >= {'equations', 'variables'}
        if legacy:
            with get_session_factory()() as db:
                assert 'agent_understanding' not in db.get(LabRecord, document['lab_id']).document['problems'][0]['ai_solution']
    response = owner.post(url + '/review', headers=_headers(session), json={
        'problem_id': problem_id, 'text': p['text'], 'subject': p['subject'],
        'condition_values': {'equations': '["3*x=18"]'} if edit else {},
        'ambiguity_answers': {'source_formula_confirmation': 'confirmed'}})
    assert response.status_code == 200, response.text
    p = response.json()['data']['problems'][0]
    expected = {**plan, 'equations': ['3*x=18']} if edit else plan
    assert p['ai_solution']['proposed_model'] == expected
    assert p['ai_solution']['checkable'] is True
    assert p['ai_solution']['answer'] == ('6' if edit else '4')
    assert len(calls) == 1


def test_visual_model_survives_unchanged_subject_confirmation(owner, monkeypatch):
    from types import SimpleNamespace
    from app.ppt_ai.client import PPTAIClient
    from test_ai_contract import candidate

    c = candidate()
    monkeypatch.setattr(
        PPTAIClient,
        'generate_json',
        lambda self, *args, **kwargs: SimpleNamespace(
            data={
                'question': c['question'],
                'conditions': ['y^2<=x, x^2<=y'],
                'missing_conditions': [],
                'model': c['model'],
                'answer': '71/210',
                'steps': [],
            }
        ),
    )
    session, document = _create_lab(owner, '计算二重积分，区域D={(x,y)|y^2<=x,x^2<=y}。')
    lab_id=document['lab_id'];p=document['problems'][0]
    r=owner.post(f'/api/v1/labs/{lab_id}/ai-solve', headers=_headers(session),
        json={'problem_id':p['problem_id'],'expected_revision':document['revision']})
    assert r.status_code==200,r.text
    document=r.json()['data']['document'];p=document['problems'][0]
    r=owner.post(f'/api/v1/labs/{lab_id}/review', headers=_headers(session), json={
        'problem_id':p['problem_id'],'text':p['text'],'subject':p['subject'],
        'condition_values':{},'ambiguity_answers':{'source_formula_confirmation':'confirmed'}})
    assert r.status_code==200,r.text
    p=r.json()['data']['problems'][0]
    assert p['ai_solution']['answer']=='71/210'
    assert p['model']['task']=='double_integral'


@pytest.fixture(scope="module", autouse=True)
def _cleanup() -> Iterator[None]:
    yield
    shutil.rmtree(_TMP_DIR, ignore_errors=True)


def _create_lab(client: TestClient, text: str) -> tuple[dict[str, Any], dict[str, Any]]:
    session = _session(client)
    response = client.post(
        "/api/v1/labs/text",
        headers=_headers(session),
        json={"title": "测试", "text": text},
    )
    assert response.status_code == 201, response.text
    return session, response.json()["data"]


@pytest.fixture
def round8_ocr_stub_upload(owner, monkeypatch):
    """Real PNG upload and review with stubbed OCR, not real OCR acceptance."""
    import io

    import httpx
    from PIL import Image, ImageDraw
    from app.labs import extract

    def forbid_external_http(*args, **kwargs):
        pytest.fail('OCR-stub 接口测试不得调用外部模型或网络')

    # TestClient 使用 ASGI transport，不经过这两个真实网络 transport。
    monkeypatch.setattr(httpx.HTTPTransport, 'handle_request', forbid_external_http)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, 'handle_async_request', forbid_external_http)
    assert get_settings().lab_ai_enabled is False

    def upload(ocr_text, *, confidence=0.99, math_text=None):
        calls = []

        def ocr(image):
            assert isinstance(image, Image.Image)
            assert image.size == (640, 120)
            calls.append('ocr')
            return ocr_text, confidence

        def math_ocr(image, **kwargs):
            assert isinstance(image, Image.Image)
            calls.append('math_ocr')
            return math_text

        monkeypatch.setattr(extract, '_ocr', ocr)
        monkeypatch.setattr(extract, '_math_ocr', math_ocr)
        image = Image.new('RGB', (640, 120), 'white')
        ImageDraw.Draw(image).text((20, 40), 'Round 8: OCR-stub upload fixture', fill='black')
        buffer = io.BytesIO()
        image.save(buffer, format='PNG')
        png = buffer.getvalue()
        assert png.startswith(b'\x89PNG\r\n\x1a\n')
        session = _session(owner)
        response = owner.post(
            '/api/v1/labs', headers=_headers(session),
            files=[('files', ('round8-ocr-stub.png', png, 'image/png'))],
            data={'roles': 'problem', 'subject': 'calculus'},
        )
        assert response.status_code == 201, response.text
        document = response.json()['data']
        assert calls.count('ocr') == 1
        if math_text is not None:
            assert calls.count('math_ocr') == 1
        assert len(document['problems']) == 1
        source = document['source']
        assert source['files'][0]['kind'] == 'image'
        assert source['pages'][0]['ocr_text'] == ocr_text
        assert source['pages'][0]['math_text'] == math_text
        assert source['pages'][0]['ocr_confidence'] == confidence
        stored = extract.LABS_DIR / document['lab_id'] / 'files' / source['files'][0]['stored_name']
        assert stored.read_bytes() == png
        preview = owner.get(
            f'/api/v1/labs/{document["lab_id"]}/preview/{source["pages"][0]["image_key"]}'
        )
        assert preview.status_code == 200, preview.text
        assert preview.headers['content-type'].startswith('image/png')
        with Image.open(io.BytesIO(preview.content)) as decoded:
            assert decoded.size == image.size
        return session, document

    return upload


def _round8_review(owner, session, document, answers, *, text=None):
    problem = document['problems'][0]
    response = owner.post(
        f'/api/v1/labs/{document["lab_id"]}/review', headers=_headers(session),
        json={
            'problem_id': problem['problem_id'],
            'text': problem['text'] if text is None else text,
            'subject': 'calculus', 'condition_values': {},
            'ambiguity_answers': answers,
        },
    )
    assert response.status_code == 200, response.text
    reviewed = response.json()['data']
    assert reviewed['lab_id'] == document['lab_id']
    assert reviewed['problems'][0]['problem_id'] == problem['problem_id']
    return reviewed


_API_REPAIR_GOLDEN = '求极坐标曲线 r=cos3θ 的一瓣面积，θE[-T/6,π/6]。'
_API_REPAIR_DRIFT = '求极坐标曲线 r=cos3胃 的一瓣面积，胃E[-T/6,蟺/6]。'
_API_REPAIR_CORRECT = '求极坐标曲线 r=cos3θ 的一瓣面积，θ∈[-π/6,π/6]。'


def _api_repair_choices(problem):
    # Fixed source-image transcription, not candidate selection by solvability.
    expected = {'T': 'π', '胃': 'θ', '蟺': 'π', 'E': '∈'}
    repairs = [a for a in problem['recognition']['ambiguities']
               if a['id'].startswith('source_repair_')]
    assert repairs
    return {a['id']: next(o['value'] for o in a['options']
                         if o.get('replacement') == expected[a['repair']['original']])
            for a in repairs}


@pytest.mark.parametrize('original', [_API_REPAIR_GOLDEN, _API_REPAIR_DRIFT])
def test_source_repair_api_upload_review_history_and_original_evidence(
    owner, round8_ocr_stub_upload, monkeypatch, original,
):
    import copy
    from app.labs import ai_solve

    def unexpected_ai_review(*args, **kwargs):
        pytest.fail('manual source repairs must use rebuild_problem, not AI condition review')

    monkeypatch.setattr(ai_solve, 'review_ai_conditions', unexpected_ai_review)
    session, document = round8_ocr_stub_upload(original)
    original_source = copy.deepcopy(document['source'])
    original_problem = copy.deepcopy(document['problems'][0])
    _round8_assert_no_answer(original_problem)
    choices = _api_repair_choices(original_problem)
    document = _round8_review(owner, session, document, {'source_formula_confirmation': 'confirmed'})
    _round8_assert_no_answer(document['problems'][0])
    assert document['problems'][0]['text'] == original
    _round8_assert_persisted(owner, document)
    # Explicitly withhold full-image confirmation on the replacement request.
    document = _round8_review(owner, session, document, {
        **choices, 'source_formula_confirmation': 'pending',
    })
    problem = document['problems'][0]
    assert problem['text'] == _API_REPAIR_CORRECT
    _round8_assert_no_answer(problem)
    assert problem['source_pages'] == original_problem['source_pages']
    assert document['source'] == original_source
    history = copy.deepcopy(problem['recognition']['source_repair_history'])
    assert len(history) == 1
    assert history[0]['original_text'] == original
    assert history[0]['revised_text'] == _API_REPAIR_CORRECT
    assert {d['id'] for d in history[0]['decisions']} == set(choices)
    for decision in history[0]['decisions']:
        assert {'id', 'code', 'start', 'end', 'original', 'replacement', 'action',
                'label', 'text_hash'} <= decision.keys()
        assert original[decision['start']:decision['end']] == decision['original']
    _round8_assert_persisted(owner, document)
    document = _round8_review(owner, session, document, {'source_formula_confirmation': 'confirmed'})
    problem = document['problems'][0]
    assert problem['status'] == 'ready'
    assert problem['solution']['exact'] == 'pi/12'
    assert problem['recognition']['source_repair_history'] == history
    assert problem['source_pages'] == original_problem['source_pages']
    assert document['source'] == original_source
    _round8_assert_persisted(owner, document)


@pytest.mark.parametrize('invalid', [
    'changed-text', 'forged-id', 'forged-option', 'other-problem', 'conditions', 'replay',
])
def test_source_repair_api_invalid_request_does_not_change_stored_revision(
    owner, round8_ocr_stub_upload, invalid,
):
    session, document = round8_ocr_stub_upload(_API_REPAIR_GOLDEN)
    choices = _api_repair_choices(document['problems'][0])
    if invalid == 'other-problem':
        original_cookies = dict(owner.cookies)
        _, other = round8_ocr_stub_upload(_API_REPAIR_DRIFT)
        choices = _api_repair_choices(other['problems'][0])
        owner.cookies.clear()
        owner.cookies.update(original_cookies)
    if invalid == 'replay':
        document = _round8_review(owner, session, document, choices)
    problem = document['problems'][0]
    body = {'problem_id': problem['problem_id'], 'text': problem['text'],
            'subject': 'calculus', 'condition_values': {}, 'ambiguity_answers': choices}
    if invalid == 'changed-text':
        body['text'] = problem['text'].replace('cos3', 'cos2')
    elif invalid == 'forged-id':
        choices['source_repair_forged'] = 'replace:0'
    elif invalid == 'forged-option':
        choices[next(iter(choices))] = 'replace:9999'
    elif invalid == 'conditions':
        body['condition_values'] = {'expression': '1'}
    response = owner.post(f'/api/v1/labs/{document["lab_id"]}/review',
                          headers=_headers(session), json=body)
    _round8_assert_persisted(owner, document)
    assert response.status_code == 422, response.text


@pytest.mark.parametrize('action', ['keep', 'manual'])
def test_source_repair_api_keep_manual_still_block(owner, round8_ocr_stub_upload, action):
    session, document = round8_ocr_stub_upload(_API_REPAIR_DRIFT)
    answers = {key: action for key in _api_repair_choices(document['problems'][0])}
    answers.update(source_formula_confirmation='confirmed', kernel_reject='confirmed')
    document = _round8_review(owner, session, document, answers)
    assert document['problems'][0]['text'] == _API_REPAIR_DRIFT
    _round8_assert_no_answer(document['problems'][0])
    _round8_assert_persisted(owner, document)


def _round8_assert_no_answer(problem):
    assert problem['status'] != 'ready'
    assert problem['solution']['answer'] == ''
    assert not problem['solution'].get('exact')
    assert problem['solution'].get('answer_value') is None
    assert not (problem.get('ai_solution') or {}).get('answer')


def _round8_source_gate(problem):
    return next(a for a in problem['recognition']['ambiguities']
                if a['id'] == 'source_formula_confirmation')


def _round8_assert_persisted(owner, document):
    response = owner.get(f'/api/v1/labs/{document["lab_id"]}')
    assert response.status_code == 200, response.text
    saved = response.json()['data']
    for key in ('lab_id', 'revision', 'status', 'source'):
        assert saved[key] == document[key], key
    for key in ('problem_id', 'text', 'status', 'model', 'solution', 'source_pages', 'recognition'):
        assert saved['problems'][0][key] == document['problems'][0][key], key


@pytest.mark.parametrize('ocr_text,result_kind,expected', [
    pytest.param('计算反常积分∫(1,+∞) dx/x^2。', 'integral', '1', id='improper-infinity'),
    pytest.param('计算反常积分∫(0,1) dx/√(1-x)。', 'integral', '2', id='improper-root-denominator'),
    pytest.param('设x=t^2,y=t^3，求d²y/dx²在t=1处的值。', 'parametric', '3/4', id='parametric-unicode-second'),
    pytest.param('设x=t^2,y=t^3，求d^2y/dx^2在t=1处的值。', 'parametric', '3/4', id='parametric-caret-second'),
    pytest.param('设f(x)=x^3+x，求其反函数在y=2处的导数。', 'inverse_derivative', '1/4', id='inverse-at-y2'),
    pytest.param('将函数f(x)=|x|在[-π,π]上展开为傅里叶级数。', 'fourier', 'pi', id='fourier-abs-a0'),
])
def test_round8_ocr_stub_upload_review_exact_answer(owner, round8_ocr_stub_upload, ocr_text, result_kind, expected):
    session, document = round8_ocr_stub_upload(ocr_text)
    original_source = document['source']
    problem = document['problems'][0]
    _round8_assert_no_answer(problem)
    assert _round8_source_gate(problem)['resolved'] is False
    _round8_assert_persisted(owner, document)

    document = _round8_review(owner, session, document, {'source_formula_confirmation': 'yes'})
    _round8_assert_no_answer(document['problems'][0])
    assert _round8_source_gate(document['problems'][0])['resolved'] is False
    _round8_assert_persisted(owner, document)

    document = _round8_review(owner, session, document, {'source_formula_confirmation': 'confirmed'})
    problem = document['problems'][0]
    assert document['status'] == problem['status'] == 'ready'
    assert _round8_source_gate(problem)['resolved'] is True
    assert not any(a['severity'] == 'blocking' and not a['resolved']
                   for a in problem['recognition']['ambiguities'])
    assert problem['recognition']['ai_used'] is False
    assert not problem['model'].get('teaching')
    solution = problem['solution']
    assert solution['answer']
    if result_kind == 'parametric':
        assert problem['model']['task'] == 'parametric_derivative'
        assert problem['model']['order'] == 2
        # 此内核 exact 是导函数；定点二阶精确值在 parametric_details 中。
        assert solution['parametric_details']['second_value'] == expected
        assert expected in solution['answer']
    elif result_kind == 'fourier':
        assert problem['model']['task'] == 'fourier_series'
        assert solution['fourier_details']['a0'] == expected
        assert solution['fourier']['a0'] == expected
    else:
        from fractions import Fraction

        assert problem['model']['kind'] == result_kind
        # 0.250000000000000 与 1/4 精确相等；不用浮点近似容差掩盖错误。
        assert Fraction(solution['exact']) == Fraction(expected)
        assert Fraction(solution['answer']) == Fraction(expected)
        if expected == '2':
            assert solution['answer'] == '2'
            assert solution['exact'] != '2/3'
    assert document['source'] == original_source
    assert problem['source_pages'][0]['ocr_text'] == ocr_text
    _round8_assert_persisted(owner, document)


def test_round8_ocr_stub_missing_parametric_point_stays_blocked_then_corrects(owner, round8_ocr_stub_upload):
    original = '设x=a(t-sint),y=a(1-cost)，求dy/dx。'
    session, document = round8_ocr_stub_upload(original)
    source = document['source']
    _round8_assert_no_answer(document['problems'][0])
    assert _round8_source_gate(document['problems'][0])['resolved'] is False
    document = _round8_review(owner, session, document, {'source_formula_confirmation': 'confirmed'})
    problem = document['problems'][0]
    _round8_assert_no_answer(problem)
    assert _round8_source_gate(problem)['resolved'] is True
    assert not problem['model'].get('teaching')
    blocked_problem = problem
    blockers = [a for a in problem['recognition']['ambiguities']
                if a['severity'] == 'blocking' and not a['resolved']]
    assert blockers
    _round8_assert_persisted(owner, document)

    # 给缺失条件的歧义项任意填 confirmed，也不能凭空补出研究点。
    document = _round8_review(owner, session, document, {
        'source_formula_confirmation': 'confirmed', **{a['id']: 'confirmed' for a in blockers},
    })
    _round8_assert_no_answer(document['problems'][0])
    assert not document['problems'][0]['model'].get('teaching')
    _round8_assert_persisted(owner, document)

    corrected = '设x=t^2,y=t^3，求t=1处dy/dx的值。'
    document = _round8_review(owner, session, document,
                              {'source_formula_confirmation': 'confirmed'}, text=corrected)
    problem = document['problems'][0]
    assert document['status'] == problem['status'] == 'ready'
    assert problem['text'] == corrected
    assert problem['model']['task'] == 'parametric_derivative'
    assert not problem['model'].get('teaching')
    assert problem['solution']['parametric_details']['slope_value'] == '3/2'
    assert problem['solution']['answer']
    assert document['source'] == source
    assert problem['source_pages'][0]['ocr_text'] == original
    _round8_assert_persisted(owner, document)
    # 最后检查阻塞原因，让同 lab 纠正/持久化路径也实际执行，而非被早期分类断言截断。
    assert blocked_problem['model']['task'] == 'parametric_derivative'
    assert any('t=t0' in a['question'] for a in blockers)


@pytest.mark.parametrize('confidence,math_text,evidence_code', [
    pytest.param(0.3, None, 'ocr_low_confidence', id='low-confidence'),
    pytest.param(0.99, r'\int_{0}^{1}\sqrt{1-x}\,dx', 'candidate_disagreement', id='conflicting-denominator'),
])
def test_round8_ocr_stub_quality_requires_review_and_retains_evidence(
    owner, round8_ocr_stub_upload, confidence, math_text, evidence_code,
):
    original = '计算反常积分∫(0,1) dx/√(1-x)。'
    session, document = round8_ocr_stub_upload(original, confidence=confidence, math_text=math_text)
    source = document['source']
    problem = document['problems'][0]
    source_pages = problem['source_pages']
    quality = problem['recognition']['quality']
    assert quality['untrusted'] is True
    assert any(e['code'] == evidence_code for e in quality['evidence'])
    assert problem['recognition']['local_build_skipped'] is True
    _round8_assert_no_answer(problem)
    assert _round8_source_gate(problem)['resolved'] is False
    _round8_assert_persisted(owner, document)

    document = _round8_review(owner, session, document, {'source_formula_confirmation': 'true'})
    _round8_assert_no_answer(document['problems'][0])
    assert _round8_source_gate(document['problems'][0])['resolved'] is False
    _round8_assert_persisted(owner, document)

    # 低置信度题干可人工原样确认；冲突候选必须以核对后的分母为准，而非求成 2/3。
    corrected = '计算反常积分∫(0,1) 1/sqrt(1-x) dx。' if math_text else original
    document = _round8_review(owner, session, document,
                              {'source_formula_confirmation': 'confirmed'}, text=corrected)
    problem = document['problems'][0]
    assert document['status'] == problem['status'] == 'ready'
    assert problem['text'] == corrected
    assert problem['solution']['answer'] == problem['solution']['exact'] == '2'
    assert _round8_source_gate(problem)['resolved'] is True
    reviewed_quality = problem['recognition']['quality']
    assert reviewed_quality['human_confirmed'] is True
    assert reviewed_quality['untrusted'] is False
    assert reviewed_quality['source_quality']['untrusted'] is True
    assert any(e['code'] == evidence_code for e in reviewed_quality['source_quality']['evidence'])
    assert document['source'] == source
    assert problem['source_pages'] == source_pages
    assert source_pages[0]['ocr_text'] == original
    assert source_pages[0]['math_text'] == math_text
    assert source_pages[0]['ocr_confidence'] == confidence
    _round8_assert_persisted(owner, document)


def test_manual_integral_preview_confirm_save_review_and_share(owner, guest, monkeypatch):
    from app.labs import staged_understanding
    from app.ppt_ai.client import PPTAIClient
    monkeypatch.setattr(PPTAIClient, 'generate_json', lambda *_a, **_k: pytest.fail('手动输入不得调用模型'))
    monkeypatch.setattr(staged_understanding, 'request_json', lambda *_a, **_k: pytest.fail('手动输入不得调用模型'))
    session = _session(owner)
    headers = _headers(session)
    body = {'task':'integral', 'conditions':{'expression':'sin(x)','variable':'x','lower':'0','upper':'pi'}}
    preview = owner.post('/api/v1/labs/manual/preview', headers=headers, json=body)
    assert preview.status_code == 200, preview.text
    assert preview.json()['data']['conditions']['upper'] == 'pi'
    assert owner.post('/api/v1/labs/manual', headers=headers, json=body).status_code == 422
    response = owner.post('/api/v1/labs/manual', headers=headers, json={**body, 'confirmed':True})
    assert response.status_code == 201, response.text
    doc = response.json()['data']; lab_id = doc['lab_id']; p = doc['problems'][0]
    assert p['solution']['exact'] == '2'
    assert p['manual_input']['confirmed'] is True
    saved = owner.patch(f'/api/v1/labs/{lab_id}', headers=headers, json={
        'expected_revision':doc['revision'], 'state':{**p['states'], 'notes':'核对原题',
        'params':{**p['model']['defaults'], 'upper':2}}})
    assert saved.status_code == 200, saved.text
    loaded = owner.get(f'/api/v1/labs/{lab_id}').json()['data']
    assert loaded['problems'][0]['manual_input']['conditions']['upper'] == 'pi'
    assert loaded['problems'][0]['states']['params']['upper'] == 2
    reviewed = owner.post(f'/api/v1/labs/{lab_id}/review', headers=headers, json={
        'problem_id':p['problem_id'], 'text':p['text'], 'subject':'calculus',
        'condition_values':{'expression':'x','lower':'1/3','upper':'2/3'}})
    assert reviewed.status_code == 200, reviewed.text
    updated = reviewed.json()['data']['problems'][0]
    assert updated['solution']['exact'] == '1/6'
    assert updated['manual_input']['confirmed'] is True
    assert updated['states']['notes'] == '核对原题'
    shared = owner.post(f'/api/v1/labs/{lab_id}/share', headers=headers).json()['data']
    public = guest.get(f"/api/v1/lab-shares/{shared['share_id']}").json()['data']
    assert public['problems'][0]['solution']['exact'] == '1/6'
    assert public['problems'][0]['manual_input']['conditions']['upper'] == '2/3'
    rejected = owner.post('/api/v1/labs/manual', json={**body,'confirmed':True})
    assert rejected.status_code == 422
    assert 'CSRF' in rejected.json()['error']['message']


def test_manual_antiderivative_and_invalid_conditions(owner):
    session = _session(owner); headers = _headers(session)
    body = {'task':'antiderivative','conditions':{'expression':'t^2','variable':'t'},'confirmed':True}
    r = owner.post('/api/v1/labs/manual', headers=headers, json=body)
    assert r.status_code == 201, r.text
    p = r.json()['data']['problems'][0]
    assert '+C' in p['solution']['answer']
    assert p['model']['variable'] == 't'
    assert 'lower' not in p['model']['defaults']
    for conditions in ({'expression':'x^2','variable':'x','upper':'2'},
                       {'expression':'x','variable':'x','lower':'0','upper':'pi','extra':'不得忽略'},
                       {'expression':'sqrt(x)','variable':'x','lower':'-2','upper':'-1'}):
        failed = owner.post('/api/v1/labs/manual', headers=headers,
            json={'task':'integral','confirmed':True,'conditions':conditions})
        assert failed.status_code == 422, failed.text


def test_file_recognition_is_still_available_alongside_manual_input(owner):
    session = _session(owner)
    response = owner.post('/api/v1/labs', headers=_headers(session),
        files=[('files', ('integral.txt', '计算定积分 ∫_0^2 x^2 dx'.encode('utf-8'), 'text/plain'))],
        data={'roles':'problem', 'subject':'calculus'})
    assert response.status_code == 201, response.text
    p = response.json()['data']['problems'][0]
    assert p['model']['engine'] == 'riemann_v1'
    assert p['solution']['answer_value'] == pytest.approx(8/3)
    assert 'manual_input' not in p


def test_ai_solve_kernel_choice_cache_attempt_and_share(owner: TestClient, guest: TestClient, monkeypatch) -> None:
    from types import SimpleNamespace
    from app.ppt_ai.client import PPTAIClient
    calls = []
    def generate(*args, **kwargs):
        calls.append(1)
        return SimpleNamespace(data={"interpretation": "求数量x", "conditions": ["2x+y=11", "x+y=7"], "missing_conditions": [],
            "model": {"kind": "equations", "variables": ["x", "y"], "equations": ["2*x+y=11", "x+y=7"], "target": "x"},
            "answer": "A", "steps": [{"title": "列方程", "detail": "相减"}]})
    monkeypatch.setattr(PPTAIClient, "generate_json", generate)
    session, document = _create_lab(owner, "两类商品共7件，2x+y=11，x+y=7，求x。A. 3 B. 4 C. 5 D. 6")
    lab_id = document["lab_id"]
    p = document["problems"][0]
    url = f"/api/v1/labs/{lab_id}/ai-solve"
    body = {"problem_id": p["problem_id"], "expected_revision": document["revision"]}
    solved = owner.post(url, headers=_headers(session), json=body)
    assert solved.status_code == 200, solved.text
    d = solved.json()["data"]["document"]
    assert d["problems"][0]["text"] == p["text"]
    assert d["problems"][0]["ai_solution"]["answer_choices"] == ["B"]
    body["expected_revision"] = d["revision"]
    assert owner.post(url, headers=_headers(session), json=body).json()["data"]["cached"]
    assert len(calls) == 1
    answer = owner.post(f"/api/v1/labs/{lab_id}/attempts", headers=_headers(session),
        json={"answer": "B", "field": "ai_solution", "problem_id": p["problem_id"]})
    assert answer.status_code == 200, answer.text
    assert answer.json()["data"]["checked"]["correct"] is True
    shared = owner.post(f"/api/v1/labs/{lab_id}/share", headers=_headers(session)).json()["data"]
    public = guest.get(f"/api/v1/lab-shares/{shared['share_id']}").json()["data"]
    assert public["problems"][0]["ai_solution"]["verification"] == "kernel"
    other = _session(guest)
    assert guest.post(url, headers=_headers(other), json=body).status_code == 404
    body["expected_revision"] = 999
    assert owner.post(url, headers=_headers(session), json=body).status_code == 409


def test_ai_model_replaces_failed_local_model_and_survives_save_share(owner: TestClient, guest: TestClient, monkeypatch) -> None:
    from types import SimpleNamespace
    from app.ppt_ai.client import PPTAIClient
    monkeypatch.setattr(PPTAIClient, 'generate_json', lambda *a, **k: SimpleNamespace(data={
        'interpretation':'对抛物线之间的区域积分', 'conditions':['y²≤x','x²≤y'], 'missing_conditions':[],
        'model':{'kind':'double_integral','integrand':'(x-y+1)^2','outer_variable':'x',
                 'outer_bounds':['0','1'],'inner_bounds':['x^2','sqrt(x)']},
        'answer':'错误参考值1/3','steps':[]}))
    original = '在两条抛物线夹成的区域内求给定函数的二重积分（已核对的题目文字）。'
    session, d = _create_lab(owner, original)
    url = f'/api/v1/labs/{d["lab_id"]}'
    p = d['problems'][0]
    saved = owner.patch(url, headers=_headers(session), json={
        'expected_revision':d['revision'], 'state':{'notes':'保留我的笔记'}})
    assert saved.status_code == 200
    d = saved.json()['data']['document']
    response = owner.post(url+'/ai-solve', headers=_headers(session), json={
        'problem_id':p['problem_id'], 'expected_revision':d['revision']})
    assert response.status_code == 200, response.text
    d = response.json()['data']['document']
    p = d['problems'][0]
    assert p['status'] == 'ready'
    assert p['text'] == original
    assert p['model']['task'] == 'double_integral'
    assert p['solution']['exact'] == '71/210'
    assert p['states']['notes'] == '保留我的笔记'
    assert p['states']['params']['slice'] == 0.5
    assert p['states']['evaluated']['status'] == 'ok'
    cached = owner.post(url+'/ai-solve', headers=_headers(session), json={
        'problem_id':p['problem_id'],'expected_revision':d['revision']})
    assert cached.json()['data']['cached']
    saved = owner.patch(url, headers=_headers(session), json={
        'expected_revision':d['revision'], 'state':{**p['states'], 'params':{'slice':0.25,'n':40}}})
    assert saved.status_code == 200
    shared = owner.post(url+'/share', headers=_headers(session)).json()['data']
    public = guest.get('/api/v1/lab-shares/'+shared['share_id']).json()['data']['problems'][0]
    assert public['model']['task'] == 'double_integral'
    assert public['states']['params']['slice'] == 0.25


@pytest.mark.parametrize('task,conditions,subject,engine',[
    ('inverse',{'matrix_a':[[1,2],[3,4]]},'linear_algebra','gauss_v1'),
    ('bfs',{'nodes':['A','B','C'],'edges':[{'from':'A','to':'B'},{'from':'B','to':'C'}],
            'start':'A','directed':True,'neighbor_order':'lexicographic_by_id'},'algorithm','bfs_v1'),
    ('page_replace',{'reference':['1','2','3','1','4','2'],'frames':3,'algorithm':'lru'},'operating_system','os_page_v1'),
])
def test_general_ai_conditions_reach_native_model_cache_and_public_snapshot(owner,guest,monkeypatch,task,conditions,subject,engine):
    from types import SimpleNamespace
    from app.ppt_ai.client import PPTAIClient
    calls=[]
    def generate(*a,**k):
        calls.append(1)
        return SimpleNamespace(data={'interpretation':'根据原题条件建模','conditions':[], 'missing_conditions':[],
            'model':{'kind':'kernel','task':task,'conditions':conditions},'answer':'','steps':[]})
    monkeypatch.setattr(PPTAIClient,'generate_json',generate)
    session,d=_create_lab(owner,'请根据附件中给出的这些数据，构建相应的模型并逐步展示。')
    original=d['problems'][0]['text']
    url=f'/api/v1/labs/{d["lab_id"]}'
    body={'problem_id':d['problems'][0]['problem_id'],'expected_revision':d['revision']}
    response=owner.post(url+'/ai-solve',headers=_headers(session),json=body)
    assert response.status_code==200,response.text
    d=response.json()['data']['document'];p=d['problems'][0]
    assert p['text']==original and p['status']=='ready' and p['subject']==subject
    assert p['model']['engine']==engine and p['states']['evaluated']['trace']
    assert p['ai_solution']['model_task_label']
    body['expected_revision']=d['revision']
    assert owner.post(url+'/ai-solve',headers=_headers(session),json=body).json()['data']['cached']
    assert len(calls)==1
    shared=owner.post(url+'/share',headers=_headers(session)).json()['data']
    public=guest.get('/api/v1/lab-shares/'+shared['share_id']).json()['data']['problems'][0]
    assert public['model']['engine']==engine and public['states']['evaluated']['trace']


def test_ai_direct_solution_cannot_be_automatically_graded(owner: TestClient, monkeypatch) -> None:
    from types import SimpleNamespace
    from app.ppt_ai.client import PPTAIClient
    monkeypatch.setattr(PPTAIClient, "generate_json", lambda *a, **k: SimpleNamespace(data={
        "answer": "A，归并排序稳定", "model": {"kind": "none"}, "missing_conditions": [],
        "steps": [{"title": "稳定性的含义", "detail": "相同关键字维持原先相对顺序"}]}))
    session, document = _create_lab(owner, "哪一种排序是稳定的？A. 归并排序 B. 堆排序 C. 快速排序 D. 选择排序")
    p = document["problems"][0]
    response = owner.post(f"/api/v1/labs/{document['lab_id']}/ai-solve", headers=_headers(session),
        json={"problem_id": p["problem_id"], "expected_revision": document["revision"], "mode": "direct"})
    assert response.status_code == 200, response.text
    result = response.json()["data"]["document"]["problems"][0]["ai_solution"]
    assert result["verification"] == "ai_reference"
    assert result["checkable"] is False
    attempt = owner.post(f"/api/v1/labs/{document['lab_id']}/attempts", headers=_headers(session),
        json={"answer": "A", "field": "ai_solution"})
    assert attempt.status_code == 422


def test_ai_solve_conflict_keeps_concurrent_change(owner: TestClient, monkeypatch) -> None:
    from app.labs import ai_solve
    from app.db.session import get_session_factory
    from app.db.models import LabRecord
    session, d = _create_lab(owner, "甲每小时3千米，乙每小时5千米，相距16千米相向行走，几小时相遇？")
    def solve(*args, **kwargs):
        with get_session_factory()() as db:
            row = db.get(LabRecord, d["lab_id"])
            new = dict(row.document); new["revision"] += 1; new["title"] = "已修改的题目"
            row.document = new; row.revision += 1; row.title = new["title"]; db.commit()
        return {"verification": "ai_reference", "answer": "2小时"}
    monkeypatch.setattr(ai_solve, "solve_with_ai", solve)
    response = owner.post(f"/api/v1/labs/{d['lab_id']}/ai-solve", headers=_headers(session),
        json={"problem_id": d["problems"][0]["problem_id"], "expected_revision": d["revision"]})
    assert response.status_code == 409, response.text
    actual = owner.get(f"/api/v1/labs/{d['lab_id']}").json()["data"]
    assert actual["title"] == "已修改的题目" and "ai_solution" not in actual["problems"][0]


def test_create_save_assistant_attempt_and_share(owner: TestClient, guest: TestClient) -> None:
    session, document = _create_lab(
        owner, "使用梯度下降法求 f(x)=(x-3)^2 的最小值，初始点为 x0=0，学习率为 0.1。"
    )
    lab_id = document["lab_id"]
    problem = document["problems"][0]
    assert document["status"] == "ready"
    assert problem["subject"] == "optimization"
    assert problem["solution"]["answer_value"] == 0

    state = {
        "params": {"x0": 0, "learning_rate": 0.1, "iterations": 6},
        "step": 3,
        "mode": "guided",
        "notes": "观察负梯度",
        "scenarios": [
            {"id": "baseline", "name": "原题条件", "params": problem["model"]["defaults"]}
        ],
        "attempts": [],
        "observations": [],
        "events": [],
    }
    saved = owner.patch(
        f"/api/v1/labs/{lab_id}",
        headers=_headers(session),
        json={"expected_revision": document["revision"], "state": state},
    )
    assert saved.status_code == 200, saved.text
    payload = saved.json()["data"]
    evaluated = payload["document"]["problems"][0]["states"]["evaluated"]
    assert evaluated["status"] == "ok"
    assert len(evaluated["trace"]) == 7
    conflict = owner.patch(
        f"/api/v1/labs/{lab_id}",
        headers=_headers(session),
        json={"expected_revision": document["revision"], "state": state},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "VERSION_CONFLICT"

    assistant = owner.post(
        f"/api/v1/labs/{lab_id}/assistant",
        headers=_headers(session),
        json={
            "question": "为什么往这个方向移动？",
            "mode": "explore",
            "step": 3,
            "params": state["params"],
        },
    )
    assert assistant.status_code == 200, assistant.text
    answer = assistant.json()["data"]
    assert answer["local"] is True
    assert "第 3 步" in answer["answer"]
    assert "梯度为负" in answer["answer"]

    attempt = owner.post(
        f"/api/v1/labs/{lab_id}/attempts",
        headers=_headers(session),
        json={"answer": "3", "field": "point", "params": state["params"]},
    )
    assert attempt.status_code == 200, attempt.text
    assert attempt.json()["data"]["checked"]["correct"] is True

    draft = owner.post(
        f"/api/v1/labs/{lab_id}/attempts",
        headers=_headers(session),
        json={
            "answer": "我的解答：梯度下降收敛到 x*=3，目标值 f*=0，所以最小值是 0。",
            "field": "draft",
            "params": state["params"],
            "kind": "draft",
        },
    )
    assert draft.status_code == 200, draft.text
    assert draft.json()["data"]["checked"]["correct"] is True
    assert draft.json()["data"]["checked"]["kind"] == "draft"

    share = owner.post(f"/api/v1/labs/{lab_id}/share", headers=_headers(session))
    assert share.status_code == 201, share.text
    share_id = share.json()["data"]["share_id"]
    public = guest.get(f"/api/v1/lab-shares/{share_id}")
    assert public.status_code == 200, public.text
    snapshot = public.json()["data"]
    assert snapshot["title"] == "测试"
    assert "session_id" not in snapshot

    other = guest.get(f"/api/v1/labs/{lab_id}")
    assert other.status_code == 401

    revoked = owner.delete(f"/api/v1/labs/{lab_id}/share", headers=_headers(session))
    assert revoked.status_code == 200
    gone = guest.get(f"/api/v1/lab-shares/{share_id}")
    assert gone.status_code == 404


def test_review_resolves_blocking_ambiguity(owner: TestClient) -> None:
    session, document = _create_lab(owner, "计算定积分 x^2 dx，并观察分割数对结果的影响。")
    lab_id = document["lab_id"]
    problem = document["problems"][0]
    assert problem["status"] == "needs_review"
    assert any(item["id"] == "limits" for item in problem["recognition"]["ambiguities"])
    response = owner.post(
        f"/api/v1/labs/{lab_id}/review",
        headers=_headers(session),
        json={
            "problem_id": problem["problem_id"],
            "condition_values": {"lower": 0, "upper": 1},
            "ambiguity_answers": {"limits": "0,2"},
        },
    )
    assert response.status_code == 200, response.text
    updated = response.json()["data"]["problems"][0]
    assert updated["status"] == "ready"
    assert updated["model"]["defaults"]["upper"] == 2
    assert abs(updated["solution"]["answer_value"] - 8 / 3) < 1e-6
    assert updated["states"]["evaluated"]["status"] == "ok"


def test_capabilities_and_ai_default_off(owner: TestClient) -> None:
    _session(owner)
    response = owner.get("/api/v1/labs/capabilities")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert "pdf" in data["formats"]
    assert data["ai_default"] is False
    assert data["ai_configured"] is False
    assert data["ai_enabled"] is False


def test_cross_session_lab_is_404(app: Any, owner: TestClient) -> None:
    session, document = _create_lab(owner, "计算定积分 ∫_0^1 x^2 dx。")
    with TestClient(app) as other:
        _session(other)
        response = other.get(f"/api/v1/labs/{document['lab_id']}")
    assert response.status_code == 404
    assert response.json()["error"]["message"] == "资源不可用"


def test_solver_capability_catalog_endpoint(owner: TestClient) -> None:
    session = _session(owner)
    response = owner.get("/api/v1/labs/capability-catalog", headers=_headers(session))
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    kinds = {c["kind"] for c in data["capabilities"]}
    assert kinds == {"compute", "check", "visual"}
    assert any(c["id"] == "geometric_area" for c in data["capabilities"])
    assert any(c["id"] == "zeros_on_interval" for c in data["capabilities"])
    assert data["kind_legend"]["check"]


def test_composite_solve_endpoint(owner: TestClient) -> None:
    import math

    session = _session(owner)
    text = "在0≤x≤2内，求曲线y=x²−x与x轴之间的面积，以及该区域绕x轴旋转所得旋转体的体积。"
    response = owner.post("/api/v1/labs/composite-solve", headers=_headers(session), json={"text": text})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["plan_check"]["ok"]
    assert data["status"] == "完成"
    answers = {a["goal"]: a for a in data["answers"]}
    assert next(v["value"] for k, v in answers.items() if "面积" in k) == pytest.approx(1.0)
    assert next(v["value"] for k, v in answers.items() if "体积" in k) == pytest.approx(16 * math.pi / 15)
    assert {v["kind"] for v in data["presentation"]["visuals"]} >= {
        "curve", "region_shade", "revolution_solid", "step_timeline"}
    assert data["problem"]["version"]


def test_408_workshop_evaluate_runs_local_kernels(owner: TestClient) -> None:
    session = _session(owner)
    headers = _headers(session)
    cases = [
        ('operating_system', '页面访问序列为 1,2,3,4,1,2,5,1,2,3,4,5，物理块数为3，采用 FIFO 置换算法，求缺页次数。', 'page_replace', 9.0),
        ('computer_network', '网页有4个对象，RTT为10ms，采用非持久连接，求获取网页时间。', 'application', 80.0),
        ('computer_organization', '某 CPU 主频为 2GHz，CPI 为 4，执行 1000000 条指令，求 CPU 执行时间。', 'performance', 0.002),
    ]
    for subject, text, kind, value in cases:
        response = owner.post('/api/v1/labs/408/evaluate', headers=headers,
                              json={'subject': subject, 'text': text})
        assert response.status_code == 200, response.text
        data = response.json()['data']
        assert data['subject'] == subject
        assert data['status'] == 'ready'
        assert data['kind'] == kind
        assert data['answer']
        assert data['answer_value'] == pytest.approx(value)
        assert data['steps']
        assert data['blocking'] == []


def test_408_workshop_evaluate_reports_missing_conditions(owner: TestClient) -> None:
    session = _session(owner)
    response = owner.post('/api/v1/labs/408/evaluate', headers=_headers(session),
                          json={'subject': 'algorithm', 'text': '判断出栈序列是否为合法出栈序列。'})
    assert response.status_code == 200, response.text
    data = response.json()['data']
    assert data['status'] == 'needs_review'
    assert data['answer'] == ''
    assert data['blocking']


def test_physics_text_lab_is_created_with_manual_subject_hint(owner: TestClient) -> None:
    session = _session(owner)
    response = owner.post('/api/v1/labs/text', headers=_headers(session), json={
        'title': '平抛运动',
        'subject': 'physics',
        'text': '小球以 v0=10 m/s 水平抛出，初始高度 h=20 m，g=9.8 m/s^2，求落地时间、水平射程和落地速度。',
    })
    assert response.status_code == 201, response.text
    document = response.json()['data']
    assert document['subject'] == 'physics'
    problem = document['problems'][0]
    assert problem['status'] == 'ready'
    assert problem['model']['physics_mode'] == 'projectile_h'
    assert '20.2' in problem['solution']['answer']


def test_physics_third_batch_text_lab_is_created(owner: TestClient) -> None:
    session = _session(owner)
    response = owner.post('/api/v1/labs/text', headers=_headers(session), json={
        'title': '双缝干涉',
        'subject': 'physics',
        'text': '双缝干涉实验中，双缝间距 d=0.2 mm，双缝到屏的距离 D=1.0 m，入射光波长 λ=600 nm，求相邻明条纹间距。',
    })
    assert response.status_code == 201, response.text
    problem = response.json()['data']['problems'][0]
    assert problem['status'] == 'ready'
    assert problem['model']['physics_mode'] == 'double_slit'
    assert '0.003' in problem['solution']['answer']


def test_cloud_transport_failure_returns_503_without_local_fallback(owner, monkeypatch):
    from app.ppt_ai.client import PPTAIClient, PPTAIError

    def fail(*_args, **_kwargs):
        raise PPTAIError('transport', '模型调用失败：ConnectError', retryable=True)

    monkeypatch.setattr(PPTAIClient, 'generate_json', fail)
    session, document = _create_lab(owner, '求极限 lim(x→0) sin(x)/x')
    response = owner.post(
        f"/api/v1/labs/{document['lab_id']}/ai-solve",
        headers=_headers(session),
        json={'problem_id': document['problems'][0]['problem_id'], 'expected_revision': document['revision']},
    )
    assert response.status_code == 503, response.text
    assert response.json()['error']['code'] == 'MODEL_UNAVAILABLE'
