import importlib.util
import json
from pathlib import Path


def test_ai_evaluation_uses_provider_output_even_when_fixture_has_plan(tmp_path, monkeypatch):
    path = Path(__file__).resolve().parents[1] / 'scripts' / 'eval_strangers.py'
    spec = importlib.util.spec_from_file_location('eval_strangers', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    calls = []

    def failed_provider(problem):
        calls.append(problem['text'])
        return {'verification': 'ai_reference', 'answer': '参考', 'steps': [],
                'proposed_model': {'kind': 'generic'}, 'trace': [],
                'model_output': {'model': {'kind': 'generic'}, 'answer': '参考'}}

    monkeypatch.setattr(module, 'solve_with_ai', failed_provider)
    fixture = tmp_path / 'cases.json'
    fixture.write_text(json.dumps({'problems': [{'id': 'p', 'text': '计算2+2',
        'plan': {'kind': 'evaluate', 'expression': '2+2'}, 'expect': {'status': 'ready'}}]}), encoding='utf-8')
    report = module.run(fixture, True)
    assert calls == ['计算2+2']
    assert report['status_ok'] == 0
    assert report['rows'][0]['status'] == 'reference'
    assert report['rows'][0]['ai_output']['model']['kind'] == 'generic'


def test_numeric_answer_assertions_count_wrong_results(tmp_path):
    path = Path(__file__).resolve().parents[1] / 'scripts' / 'eval_strangers.py'
    spec = importlib.util.spec_from_file_location('eval_strangers_answers', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    fixture = tmp_path / 'cases.json'
    fixture.write_text(json.dumps({'problems': [{'id': 'p', 'text': '计算2+2',
        'plan': {'kind': 'evaluate', 'expression': '2+3'},
        'expect': {'status': 'ready', 'answer': '4'}}]}), encoding='utf-8')
    report = module.run(fixture, False)
    assert report['answer_total'] == 1
    assert report['answer_ok'] == 0
