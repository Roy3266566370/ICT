import base64
import copy
import io
import json
import pytest
from types import SimpleNamespace

from PIL import Image

from app.labs import ai_contract, ai_solve, extract
from app.labs.recognize import split_problems, build_problem
from app.ppt_ai.client import PPTAIClient
from app.settings import Settings
from test_labs_ai_solve import Client, problem


def test_empty_image_pages_survive_split_including_continuation():
    files = [{'file_id': 'f1', 'role': 'problem'}]
    pages = [{'file_id': 'f1', 'page': 1, 'text': '', 'image_key': 'p1'}]
    assert split_problems(pages, files)[0]['pages'] == pages
    pages[0]['text'] = '1. 求函数的导数'
    pages.append({'file_id': 'f1', 'page': 2, 'text': '', 'image_key': 'p2'})
    assert split_problems(pages, files)[0]['pages'] == pages


def test_empty_ocr_image_is_reviewable_rather_than_unsupported():
    p = build_problem('', pages=[{'image_key': 'p1', 'page': 1}])
    assert p['status'] == 'needs_review'
    assert p['recognition']['ocr_empty'] is True
    assert any(a['id'] == 'source_formula_confirmation' for a in p['recognition']['ambiguities'])


def test_failed_ai_cannot_erase_ready_local_solution():
    p = {'status': 'ready', 'model': {'engine': 'physics_v1', 'teaching': False},
         'solution': {'answer': '42'}, 'recognition': {'conditions': [{'id': 'mass', 'value': 1}]}}
    original = copy.deepcopy(p)
    ai_solve.attach_interactive_model(p, {'verification': 'needs_review',
        'agent_understanding': {'model': {'kind': 'none'}}})
    assert p == original


def test_cloud_receives_original_image_when_ocr_is_empty(monkeypatch):
    buffer = io.BytesIO()
    Image.new('RGB', (20, 20), 'white').save(buffer, format='PNG')
    encoded = base64.b64encode(buffer.getvalue()).decode('ascii')
    monkeypatch.setattr(ai_contract, 'source_images', lambda *args, **kwargs: [
        {'key': 'p1', 'page': 1, 'image': encoded, 'sha256': 'test'}])
    captured = {}

    class Transport:
        def post(self, url, *, headers, json_body, timeout):
            captured.update(json_body)
            return 200, {'choices': [{'message': {'content': json.dumps({
                'question': '计算2+2。', 'answer': '4', 'model': {'kind': 'evaluate', 'expression': '2+2'},
                'missing_conditions': [], 'steps': []})}}]}

    settings = Settings(llm_provider='maas', llm_api_key='test', llm_model='DeepSeek-V4.1-Flash-1017')
    client = PPTAIClient(settings, transport=Transport())
    result = ai_solve.solve_with_ai({'text': '', 'source_pages': [{'image_key': 'p1'}]},
                                    client=client, lab_id='lab_test')
    assert result['verification'] == 'kernel'
    assert captured['thinking'] == {'type': 'disabled'}
    assert captured['model'] == 'deepseek-v4.1-flash-1017'
    content = captured['messages'][-1]['content']
    assert isinstance(content, list)
    assert any(part.get('image_url', {}).get('url') == 'data:image/png;base64,' + encoded for part in content)
    payload = json.loads(next(part['text'] for part in content if part['type'] == 'text'))
    assert payload['input']['ocr_hint'] == ''


def test_ocr_preserves_table_rows_in_reading_order(monkeypatch):
    def box(x, y):
        return [[x, y], [x+15, y], [x+15, y+10], [x, y+10]]
    detections = [(box(40, 30), '4', .9), (box(40, 0), '2', .9),
                  (box(0, 30), '3', .9), (box(0, 0), '1', .9)]
    monkeypatch.setattr(extract, '_ocr_engine', lambda: lambda _: (detections, 0))
    assert extract._ocr(Image.new('RGB', (100, 100)))[0] == '1 2\n3 4'


def test_latex_initialization_recovers_after_cooldown(monkeypatch, tmp_path):
    import sys
    package = tmp_path / 'rapid_latex_ocr'
    models = package / 'models'
    models.mkdir(parents=True)
    for name in ('image_resizer.onnx', 'encoder.onnx', 'decoder.onnx', 'tokenizer.json'):
        (models / name).write_bytes(b'local')
    (package / 'config.yaml').write_text('local')
    monkeypatch.setattr(extract, 'find_spec', lambda _: SimpleNamespace(origin=str(package / '__init__.py')))
    attempts = []
    def initialize(**kwargs):
        attempts.append(1)
        if len(attempts) == 1:
            raise OSError('temporary initialization failure')
        return 'engine'
    monkeypatch.setitem(sys.modules, 'rapid_latex_ocr', SimpleNamespace(LaTeXOCR=initialize))
    monkeypatch.setattr(extract, '_LATEX_OCR_ENGINE', None)
    monkeypatch.setattr(extract, '_LATEX_OCR_RETRY_AT', 0, raising=False)
    assert extract._latex_ocr_engine() is None
    assert extract._latex_ocr_engine() is None
    monkeypatch.setattr(extract, '_LATEX_OCR_RETRY_AT', 0)
    assert extract._latex_ocr_engine() == 'engine'


def test_cloud_kernel_missing_fields_use_existing_condition_editor():
    p = problem('求函数的定积分')
    result = ai_solve.solve_with_ai(p, client=Client(
        {'kind': 'kernel', 'task': 'integral', 'conditions': {'expression': 'x', 'variable': 'x', 'lower': '0'}},
        missing_conditions=['积分上限']))
    p['ai_solution'] = result
    assert result['agent_understanding']['model']['task'] == 'integral'
    rebuilt = ai_solve.review_ai_conditions(p, {'upper': '1'}, {})
    assert rebuilt['ai_solution']['verification'] == 'kernel'
    assert rebuilt['ai_solution']['model_name'] == 'test-ai'


def test_cloud_image_formula_can_compute_candidate_without_automatic_grading(monkeypatch):
    monkeypatch.setattr(ai_contract, 'source_images', lambda *args, **kwargs: [
        {'key': 'p1', 'page': 1, 'image': 'test', 'sha256': 'test'}])
    p = problem('计算2+2')
    p['recognition']['ambiguities'] = [{'id': 'source_formula_confirmation', 'resolved': False}]
    result = ai_solve.solve_with_ai(p, client=Client({'kind': 'evaluate', 'expression': '2+2'}, question='计算2+2'))
    assert result['verification'] == 'kernel'
    assert result['source_review_required'] is True
    assert result['checkable'] is False


def test_cloud_choice_grading_survives_review_and_recomputes_changed_conditions():
    p = build_problem('计算定积分 ∫_0^1 x dx。A. 1/2 B. 2')
    p['ai_solution'] = ai_solve.solve_with_ai(p, client=Client(
        {'kind': 'kernel', 'task': 'integral',
         'conditions': {'expression': 'x', 'variable': 'x', 'lower': 0, 'upper': 1}}))
    assert ai_solve.check_ai_answer(p, 'A')['correct']
    reviewed = ai_solve.review_ai_conditions(p, {}, {})
    assert ai_solve.check_ai_answer(reviewed, 'A')['correct']
    reviewed = ai_solve.review_ai_conditions(p, {'upper': '2'}, {})
    assert ai_solve.check_ai_answer(reviewed, 'B')['correct']
    assert not ai_solve.check_ai_answer(reviewed, 'A')['correct']


def test_maas_defaults_work_with_only_api_key_and_normalize_display_name(monkeypatch):
    monkeypatch.delenv('LLM_PROVIDER', raising=False)
    settings = Settings(_env_file=None, llm_api_key='test')
    assert settings.llm_provider == 'maas'
    assert settings.llm_model == 'deepseek-v4.1-flash-1017'
    assert PPTAIClient(settings).available()
    assert Settings(_env_file=None, llm_model='DeepSeek-V4.1-Flash-1017').llm_model == settings.llm_model
    assert not PPTAIClient(Settings(_env_file=None, llm_api_key='test', llm_provider='none')).available()


def test_three_noisy_phone_images_fit_real_cloud_request_budget(tmp_path, monkeypatch):
    import numpy as np
    monkeypatch.setattr(ai_contract, 'LABS_DIR', tmp_path)
    previews = tmp_path / 'lab_phone' / 'previews'
    previews.mkdir(parents=True)
    rng = np.random.default_rng(42)
    original = Image.fromarray(rng.integers(0, 256, (2800, 2100, 3), dtype=np.uint8))
    for i in range(3):
        original.save(previews / f'p{i}.png')
    p = {'text': '', 'source_pages': [{'image_key': f'p{i}', 'page': i+1} for i in range(3)]}
    images = ai_contract.source_images('lab_phone', p)
    urls = []
    for page in images:
        assert page['mime_type'] == 'image/jpeg'
        raw = base64.b64decode(page['image'])
        with Image.open(io.BytesIO(raw)) as prepared:
            assert max(prepared.size) <= 1800
            assert prepared.format == 'JPEG'
        urls.append('data:image/jpeg;base64,' + page['image'])
    class Transport:
        def post(self, url, *, headers, json_body, timeout):
            assert len(json.dumps(json_body, ensure_ascii=False).encode()) < 5 * 1024 * 1024
            return 200, {'choices': [{'message': {'content': '{"ok":true}'}}]}
    from app.ppt_ai.types import CallBudget
    PPTAIClient(Settings(llm_api_key='test', llm_provider='maas'), transport=Transport()).generate_json(
        'phone_test', {'question': '题'*12000}, 'v1', CallBudget(max_calls=1), image_urls=urls)


@pytest.mark.parametrize('kind', ['kernel', 'existing', 'double_integral', 'equations', 'none'])
def test_visual_transcription_updates_problem_for_every_model_kind(kind):
    p = build_problem('', pages=[{'image_key': 'p1', 'page': 1}])
    original_pages = copy.deepcopy(p['source_pages'])
    ai_solve.attach_interactive_model(p, {'verification': 'ai_reference',
        'question': '已知函数 f(x)=x^3，求一阶导数。', 'proposed_model': {'kind': kind}})
    assert p['text'] == '已知函数 f(x)=x^3，求一阶导数。'
    assert p['title'] != '未命名题目'
    assert 'x^3' in p['source']['excerpt']
    assert p['recognition']['original_ocr_text'] == ''
    assert p['source_pages'] == original_pages


def test_double_integral_prompt_prefers_original_region(monkeypatch):
    captured = {}
    class RegionClient(Client):
        def generate_json(self, *args, **kwargs):
            captured.update(kwargs)
            return super().generate_json(*args, **kwargs)
    result = ai_solve.solve_with_ai(problem('计算区域D={0<=x<=1,0<=y<=x}上的二重积分'),
        client=RegionClient({'kind': 'kernel', 'task': 'double_integral',
                            'conditions': {'integrand': '1', 'region_text': 'D={0<=x<=1,0<=y<=x}'}}))
    assert result['verification'] == 'kernel'
    assert 'region_text' in captured['instructions']


def test_reference_transcription_cannot_present_stale_local_answer_as_verified():
    p = {'text': 'OCR sequence 1,3,2', 'status': 'ready', 'model': {'teaching': False},
         'solution': {'answer': 'old local answer'}, 'recognition': {'ambiguities': []},
         'source_pages': [{'image_key': 'p1'}]}
    ai_solve.attach_interactive_model(p, {'verification': 'ai_reference', 'question': 'True sequence 1,8,2'})
    assert p['solution']['answer'] == 'old local answer'
    assert p['status'] == 'needs_review'
    assert any(a['id'] == 'source_formula_confirmation' and not a['resolved']
               for a in p['recognition']['ambiguities'])


@pytest.mark.parametrize('legacy', [False, True])
@pytest.mark.parametrize('plan', [
    {'kind': 'existing', 'canonical_text': '计算定积分 ∫_0^1 x dx'},
    {'kind': 'evaluate', 'expression': '2+2'},
    {'kind': 'equations', 'variables': ['x'], 'equations': ['x+1=5']},
    {'kind': 'double_integral', 'integrand': '1', 'outer_variable': 'x',
     'outer_bounds': ['0', '1'], 'inner_bounds': ['0', '1']},
])
def test_non_kernel_plan_survives_source_confirmation(plan, legacy, monkeypatch):
    monkeypatch.setattr(ai_contract, 'source_images', lambda *a, **k: [
        {'key': 'p1', 'page': 1, 'image': 'test'}])
    p = build_problem('', pages=[{'image_key': 'p1', 'page': 1}])
    p['ai_solution'] = ai_solve.solve_with_ai(p, client=Client(plan, question='已完整转写的应用题'))
    assert p['ai_solution']['verification'] == 'kernel'
    assert p['ai_solution']['agent_understanding']['model'] == plan
    ai_solve.attach_interactive_model(p, p['ai_solution'])
    if legacy:
        p['ai_solution'].pop('agent_understanding')
    reviewed = ai_solve.review_ai_conditions(p, {}, {'source_formula_confirmation': 'confirmed'})
    assert reviewed['ai_solution']['verification'] == 'kernel'
    assert reviewed['ai_solution']['checkable'] is True
    assert reviewed['ai_solution']['proposed_model'] == plan
    assert reviewed['ai_solution']['question'] == '已完整转写的应用题'


@pytest.mark.parametrize('legacy', [False, True])
def test_evaluate_expression_can_be_corrected_without_losing_plan(monkeypatch, legacy):
    p = build_problem('计算完整数值表达式')
    p['ai_solution'] = ai_solve.solve_with_ai(p, client=Client({'kind': 'evaluate', 'expression': '2+2'}))
    if legacy:
        p['ai_solution'].pop('agent_understanding')
    reviewed = ai_solve.review_ai_conditions(p, {'expression': '3+3'}, {})
    assert reviewed['ai_solution']['answer'] == '6'
    assert reviewed['ai_solution']['proposed_model']['expression'] == '3+3'
    constant = ai_solve.review_ai_conditions(p, {'expression': '4'}, {})
    assert constant['ai_solution']['verification'] == 'kernel'
    assert constant['ai_solution']['proposed_model']['expression'] == '4'


def test_historical_reference_answer_survives_confirmation_and_is_marked_stale_after_edits():
    p = build_problem('解释图中物理现象')
    p['ai_solution'] = ai_solve.solve_with_ai(p, client=Client({'kind': 'none'},
        answer='历史 AI 参考解释', steps=[{'title': '解释', 'detail': '根据原题说明现象'}]))
    old_answer = p['ai_solution']['answer']
    reviewed = ai_solve.review_ai_conditions(p, {}, {'source_formula_confirmation': 'confirmed'})
    assert reviewed['ai_solution']['answer'] == old_answer
    assert reviewed['ai_solution']['steps'][0]['detail'] == '根据原题说明现象'
    assert not reviewed['ai_solution']['checkable']
    edited = ai_solve.review_ai_conditions(p, {'temperature': '300'}, {})
    assert edited['ai_solution']['answer'] == old_answer
    assert not edited['ai_solution']['checkable']
    assert any('条件已修改' in note for note in edited['ai_solution']['limitations'])
    confirmed_again = ai_solve.review_ai_conditions(edited, {}, {})
    assert any('条件已修改' in note for note in confirmed_again['ai_solution']['limitations'])
    assert not confirmed_again['ai_solution']['checkable']


def test_failed_legacy_recomputation_keeps_reference_answer_and_steps():
    p = build_problem('计算完整数值表达式')
    p['ai_solution'] = ai_solve.solve_with_ai(p, client=Client({'kind': 'evaluate', 'expression': '2+2'},
        answer='历史参考结果为4', steps=[{'title': '相加', 'detail': '两个二相加'}]))
    p['ai_solution'].pop('agent_understanding')
    reviewed = ai_solve.review_ai_conditions(p, {'expression': 'unknown_variable'}, {})
    assert reviewed['ai_solution']['verification'] != 'kernel'
    assert reviewed['ai_solution']['answer'] == '历史参考结果为4'
    assert reviewed['ai_solution']['steps'][0]['detail'] == '两个二相加'
    assert not reviewed['ai_solution']['checkable']


def test_equations_can_request_all_variables_as_comma_separated_target():
    result = ai_solve.compute_plan({'kind': 'equations', 'variables': ['x', 'y'],
        'equations': ['x+y=5', '8*x+12*y=52'], 'target': 'x,y'})
    assert result['expected']['kind'] == 'system'
    assert result['expected']['rows'] == [['2', '3']]


def test_all_variable_target_preserves_empty_solution_semantics():
    result = ai_solve.compute_plan({'kind': 'equations', 'variables': ['x', 'y'],
        'equations': ['x+y=1', 'x+y=2'], 'target': 'x,y'})
    assert result['expected']['values'] == []
    assert result['answer'] == '无符合条件的实数解'


def test_equation_editor_omits_unrelated_universal_contract_fields():
    p = build_problem('计算两个商品的数量')
    result = ai_solve.solve_with_ai(p, client=Client({'kind': 'equations', 'variables': ['x'],
        'equations': ['x=4'], 'task': None, 'conditions': {}}))
    ai_solve.attach_interactive_model(p, result)
    assert {c['id'] for c in p['recognition']['conditions']} == {'equations', 'variables'}
