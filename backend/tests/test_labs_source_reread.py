import base64
import copy
import io
import time
from types import SimpleNamespace

import pytest
import httpx
from PIL import Image

from app.labs import ai_contract, ai_solve, staged_understanding
from app.labs.recognize import build_problem


def _source(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_contract, 'LABS_DIR', tmp_path)
    root = tmp_path / 'lab_reread'
    for folder, size in [('analysis', (1200, 3000)), ('previews', (200, 500))]:
        (root / folder).mkdir(parents=True)
        Image.new('RGB', size, 'white').save(root / folder / 'f1_p1.png')
    return build_problem(r'求 $\frac{1}{x$ 的积分。', pages=[{
        'image_key': 'f1_p1', 'page': 1, 'requires_formula_confirmation': True}])


def test_source_reread_uses_original_resolution_and_overlapping_details(tmp_path, monkeypatch):
    p = _source(tmp_path, monkeypatch)
    views = ai_contract.source_images('lab_reread', p, cloud=True, detail=True)
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
    data = read_with_source_retry(p, ai_contract.source_images('lab_reread', p, cloud=True), read,
        lab_id='lab_reread', cloud=True)
    result = ai_contract.finish_understanding(data, p)
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
    data = read_with_source_retry(p, ai_contract.source_images('lab_reread', p, cloud=True), read,
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
    result = read_with_source_retry(p, ai_contract.source_images('lab_reread', p, cloud=True), read,
        lab_id='lab_reread', cloud=True)
    assert result['question'] == '计算定积分。'
    assert result['_source_recovery']['status'] == 'failed'


def test_maas_original_and_details_fit_staged_request(tmp_path, monkeypatch):
    p = _source(tmp_path, monkeypatch)
    views = ai_contract.source_images('lab_reread', p, detail=True)
    sent = []

    class FakeClient:
        def generate_json(self, task, payload, version, budget, **kwargs):
            sent.append((task, payload, kwargs))
            return SimpleNamespace(data={'question': 'read'})

    result = staged_understanding.request_json(
        [{'role': 'user', 'content': '对照原图重新读取公式。', 'images': [v['image'] for v in views]}],
        ai_contract.Understanding.model_json_schema(),
        time.monotonic() + 10,
        client=FakeClient(),
    )
    assert sent and result['question'] == 'read'
    assert len(sent[0][2]['image_urls']) == 3
    assert all(url.startswith('data:image/jpeg;base64,') for url in sent[0][2]['image_urls'])


def test_staged_reread_routes_via_maas_client(tmp_path, monkeypatch):
    p = _source(tmp_path, monkeypatch)
    for directory in ('analysis', 'previews'):
        Image.new('RGB', (300, 500), 'white').save(tmp_path / 'lab_reread' / directory / 'f1_p1.png')
    initial_reading = dict(
        question=r'求 $\frac{1}{x$ 的积分。',
        subquestions=[],
        relations=[],
        target='积分值',
        conditions=[],
        uncertainties=[],
    )
    recovered_reading = dict(
        question='计算定积分 ∫_0^1 x^2 dx。',
        subquestions=[],
        relations=[],
        target='积分值',
        conditions=[{'id': 'c1', 'value': 'x^2', 'excerpt': 'x^2'}],
        uncertainties=[],
    )
    model = {
        'task': 'integral',
        'conditions': {'expression': 'x^2', 'variable': 'x', 'lower': 0, 'upper': 1},
        'bindings': {'expression': ['c1']},
        'unsupported_reason': '',
    }
    calls = []

    class FakeClient:
        def generate_json(self, task, payload, version, budget, **kwargs):
            calls.append((payload, kwargs))
            last_content = payload['messages'][-1]['content']
            if 'tasks' in last_content:
                return SimpleNamespace(data=copy.deepcopy(model))
            if 'source_recovery' in last_content:
                return SimpleNamespace(data=copy.deepcopy(recovered_reading))
            return SimpleNamespace(data=copy.deepcopy(initial_reading))

    monkeypatch.setattr('app.ppt_ai.client.PPTAIClient', FakeClient)
    result = staged_understanding.understand_staged(p, lab_id='lab_reread')
    assert len(calls) == 3
    assert calls[1][1]['image_urls']
    assert result['source_recovery']['status'] == 'recovered'
    assert result['computation'] is not None
    assert result['answer'] == '0.33333333'


def _quality_problem(confidence=0.3, math_text=None):
    from app.labs.source_recovery import assess_text_quality
    text = 'y=x^2'
    page = dict(file_id='f1', page=1, image_key='f1_p1', ocr_text=text,
                math_text=math_text, ocr_confidence=confidence)
    return dict(text=text, source_pages=[page], recognition={
        'quality': assess_text_quality(text, [page]), 'ambiguities': []})


def _fake_reread_views(monkeypatch):
    views = [dict(key='f1_p1', page=1, view='page', image='unused')]
    monkeypatch.setattr(ai_contract, 'source_images', lambda *args, **kwargs: copy.deepcopy(views))
    return views


@pytest.mark.parametrize('confidence, math_text, code', [
    (0.3, None, 'ocr_low_confidence'),
    (0.99, r'y=x^{3}', 'candidate_disagreement'),
])
def test_source_evidence_triggers_retry_without_an_existing_confirmation_gate(monkeypatch, confidence, math_text, code):
    from app.labs.source_recovery import read_with_source_retry
    problem = _quality_problem(confidence, math_text)
    original = copy.deepcopy(problem)
    views = _fake_reread_views(monkeypatch)
    requests = []

    def read(images, recovery):
        requests.append(copy.deepcopy(recovery))
        return dict(question='y=x^2', conditions=[], missing_conditions=[])

    result = read_with_source_retry(problem, views, read, lab_id='lab_reread', cloud=False)
    assert len(requests) == 2
    sent = requests[1]['source_quality']
    assert sent['untrusted']
    assert any(item['code'] == code for item in sent['evidence'])
    assert any(c['ocr_text'] == 'y=x^2' and c['math_text'] == math_text for c in sent['candidates'])
    report = result['_source_recovery']
    assert report['status'] == 'recovered' and not report['untrusted']
    assert report['requires_review'] and report['source_quality']['untrusted']
    assert report['source_quality'] == sent
    assert problem == original


def test_high_confidence_clean_reread_does_not_clear_human_confirmation(monkeypatch):
    from app.labs.source_recovery import read_with_source_retry
    problem = _quality_problem(0.99, r'y=x^{2}')
    views = _fake_reread_views(monkeypatch)
    calls = []

    def read(images, recovery):
        calls.append(recovery)
        return dict(question='y=x^2', conditions=[], uncertainties=[])

    result = read_with_source_retry(problem, views, read, lab_id='lab_reread', cloud=False)
    report = result['_source_recovery']
    assert len(calls) == 2 and report['status'] == 'recovered'
    assert not report['source_quality']['untrusted']
    assert report['requires_review'] and report['needs_visual_verification']


@pytest.mark.parametrize('failure', ['timeout', 'empty_views', 'incomplete', 'ambiguous_matrix', 'invalid_payload'])
def test_failed_reread_keeps_low_confidence_and_disagreement_evidence(monkeypatch, failure):
    from app.labs.source_recovery import read_with_source_retry
    problem = _quality_problem(0.3, r'y=x^{3}')
    original = copy.deepcopy(problem)
    views = _fake_reread_views(monkeypatch)
    if failure == 'empty_views':
        monkeypatch.setattr(ai_contract, 'source_images', lambda *args, **kwargs: [])
    initial = dict(question='y=x^2', conditions=['x=1'], missing_conditions=[])
    calls = []

    def read(images, recovery):
        calls.append(recovery)
        if recovery is None:
            return initial
        if failure == 'timeout':
            recovery['source_quality']['evidence'].clear()
            raise httpx.ReadTimeout('unavailable')
        if failure == 'invalid_payload':
            return None
        if failure == 'incomplete':
            return dict(question=r'\frac{', conditions=[], missing_conditions=[])
        return dict(question='矩阵 A=[123;456;789]', conditions=[], missing_conditions=[])

    result = read_with_source_retry(problem, views, read, lab_id='lab_reread', cloud=False)
    report = result['_source_recovery']
    assert report['status'] in ('failed', 'unresolved')
    assert report['untrusted'] and report['requires_review'] and report['remaining']
    codes = {item['code'] for item in report['source_quality']['evidence']}
    assert {'ocr_low_confidence', 'candidate_disagreement'} <= codes
    assert report['source_quality']['candidates'][0]['math_text'] == r'y=x^{3}'
    assert result['question'] == initial['question'] and result['conditions'] == initial['conditions']
    assert result['missing_conditions'] and not initial['missing_conditions']
    assert len(calls) == (1 if failure == 'empty_views' else 2)
    assert problem == original
    if failure == 'ambiguous_matrix':
        assert report['reread_quality']['untrusted']
        assert report['reread_question'] == '矩阵 A=[123;456;789]'


def test_saved_recognition_quality_survives_pruned_source_pages(monkeypatch):
    from app.labs.source_recovery import read_with_source_retry
    problem = build_problem('y=x^2', pages=_quality_problem()['source_pages'])
    assert problem['recognition']['quality']['untrusted']
    views = _fake_reread_views(monkeypatch)
    calls = []

    def read(images, recovery):
        calls.append(recovery)
        if recovery:
            raise ValueError('not readable')
        return dict(question='y=x^2', conditions=[], missing_conditions=[])

    result = read_with_source_retry(problem, views, read, lab_id='lab_reread', cloud=False)
    assert len(calls) == 2
    evidence = calls[1]['source_quality']['evidence']
    assert any(e['code'] == 'ocr_low_confidence' and e['confidence'] == 0.3 for e in evidence)
    assert result['_source_recovery']['status'] == 'failed'


def test_missing_images_does_not_silently_drop_review_evidence(monkeypatch):
    from app.labs.source_recovery import read_with_source_retry
    problem = _quality_problem()
    monkeypatch.setattr(ai_contract, 'source_images', lambda *args, **kwargs: [])
    result = read_with_source_retry(problem, [], lambda *args: dict(question='y=x^2', missing_conditions=[]),
                                    lab_id='lab_reread', cloud=False)
    assert result['_source_recovery']['status'] == 'failed'
    assert result['_source_recovery']['requires_review']
    assert result['missing_conditions']


def test_second_reading_checks_both_uncertainty_fields(monkeypatch):
    from app.labs.source_recovery import read_with_source_retry
    views = _fake_reread_views(monkeypatch)
    result = read_with_source_retry(_quality_problem(), views,
        lambda *args: dict(question='y=x^2', uncertainties=['模型未支持'], missing_conditions=['公式仍看不清']),
        lab_id='lab_reread', cloud=False)
    assert result['_source_recovery']['status'] == 'unresolved'
    assert '公式仍看不清' in result['_source_recovery']['remaining']


@pytest.mark.parametrize('text, originals', [
    ('极坐标 r=cos3胃，胃E[-T/6,蟺/6]', ['胃', '胃', 'E', 'T', '蟺']),
    ('极坐标 r=cos3θ，θE[-T/6,π/6]', ['E', 'T']),
    ('😀求 r=cos3胃，r=cos3胃。', ['胃', '胃']),
    ('求 $x+龘$。', ['龘']),
    ('求 x=龘。', ['龘']),
    ('求 x龘+1。', ['龘']),
    ('求 $x+𠀀$。', ['𠀀']),
])
def test_source_repairs_are_local_stable_and_unselected(text, originals):
    import hashlib
    from app.labs.source_recovery import source_repair_proposals
    before = text
    result = source_repair_proposals(text)
    assert [p['repair']['original'] for p in result] == originals
    assert result == source_repair_proposals(text)
    assert text == before
    assert len({p['id'] for p in result}) == len(result)
    previous = 0
    for p in result:
        r = p['repair']
        assert r['start'] >= previous
        previous = r['end']
        assert text[r['start']:r['end']] == r['original']
        assert r['text_hash'] == hashlib.sha256(text.encode('utf-8')).hexdigest()
        assert p['answer'] is None and p['resolved'] is False
        assert p['severity'] == 'blocking' and p['field'] == 'source_text'
        assert [o['value'] for o in p['options']][-2:] == ['keep', 'manual']
        assert all(isinstance(o['replacement'], str) for o in p['options'][:-2])
        if r['original'] == '龘':
            assert len(p['options']) == 2
    assert [p['id'] for p in result] != [p['id'] for p in source_repair_proposals(text + '。')]


@pytest.mark.parametrize('text', [
    '物体运动3米，历时5秒，求平均速度。',
    '距离 s=3米，时间 t=5秒。',
    r'求 $x+1\text{其中变量为实数}$。',
    r'求 $x_{最大}+1$。', '求 $x_中+1$。',
    '时间 T=3，y=T/6。', '极坐标 r=cos(θ)，时间 T=3，y=T/6。',
    '求 $cos(θ)$。', '求 $α+β$。', r'求 $\alpha+1$。',
    '将 f(x)=|x| 在[-π,π]上展开为傅里叶级数。',
    '已知参数方程x=t^2,y=t^3，求t=1处d^2y/dx^2。',
    '求矩阵A=[[2,1],[1,2]]的特征值和特征向量。',
    '求微分方程 y\'\'+y=0 的通解。',
])
def test_source_repairs_do_not_flag_prose_annotations_units_or_legal_theta(text):
    from app.labs.source_recovery import source_repair_proposals
    assert source_repair_proposals(text) == []


def test_expr_errors_keep_original_offsets_before_expanding_notation():
    from app.labs.expr import ExprError, parse_expression
    for raw in [r'\frac{1}{x}+龘', 'π+x²+胃', '  x+胃', 'x+😀']:
        with pytest.raises(ExprError) as raised:
            parse_expression(raw)
        error = raised.value
        assert error.raw == raw and error.start == len(raw) - 1 and error.end == len(raw)
        assert error.code == 'illegal_character'
        assert str(error) == '表达式包含不允许的字符'
    for raw in [r'\frac{1}{x}+unknown', 'π+unknown', 'x²+unknown', 'x+(']:
        with pytest.raises(ExprError) as raised:
            parse_expression(raw)
        assert raised.value.raw == raw
        assert raised.value.start is None and raised.value.end is None
    with pytest.raises(ExprError) as raised:
        parse_expression('x+unknown')
    assert (raised.value.start, raised.value.end) == (2, 9)


def test_source_parser_diagnostics_are_global_without_invented_offsets():
    from app.labs.source_recovery import source_repair_proposals, assess_text_quality
    text = r'😀求 $\frac{1}{x}+unknown$。'
    result = source_repair_proposals(text)
    assert len(result) == 1 and len(result[0]['options']) == 2
    assert 'start' not in result[0]['repair']['diagnostic']
    text = r'😀求 $\frac{1}{x}+龘$。'
    p = source_repair_proposals(text)[0]
    assert p['repair']['diagnostic']['start'] == text.index('龘')
    quality = assess_text_quality(text)
    assert quality['requires_review'] and not quality['untrusted']
    assert all(not e['blocking'] for e in quality['evidence'])


def test_local_integral_candidate_and_keep_have_no_solver_side_effects(monkeypatch):
    from app.labs import source_recovery
    text = '计算 {(1,+∞) dx/x^2。'
    proposals = source_recovery.source_repair_proposals(text)
    assert proposals[0]['repair']['original'] == '{'
    assert proposals[0]['options'][0]['replacement'] == '∫'
    assert proposals[0]['answer'] is None


def test_formula_confirmation_does_not_clear_remaining_repair_review(monkeypatch):
    from app.labs.source_recovery import read_with_source_retry
    views = _fake_reread_views(monkeypatch)
    text = '极坐标 r=cos3胃，胃E[-T/6,蟺/6]'
    problem = dict(text=text, source_pages=[dict(image_key='f1_p1')], recognition={
        'ambiguities': [dict(id='source_formula_confirmation', resolved=True)]})
    result = read_with_source_retry(problem, views,
        lambda *args: dict(question=text, uncertainties=[]), lab_id='lab_reread', cloud=False)
    report = result['_source_recovery']
    assert report['requires_review']
    assert any(e.get('repair') for e in report['initial_quality']['evidence'])
