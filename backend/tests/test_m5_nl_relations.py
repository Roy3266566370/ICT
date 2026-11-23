import json
from types import SimpleNamespace

from PIL import Image
import pytest

from app import render
from app.documents import layers, relation_generation, store
from app.ppt_ai.client import PPTAIError


def _fake_settings(*, provider='maas', api_key='test-key', model='deepseek-v4', base_url='https://example.invalid/v1'):
    return SimpleNamespace(
        llm_provider=provider,
        llm_api_key=api_key,
        llm_model=model,
        llm_base_url=base_url,
        llm_timeout_s=15,
    )


def _setup_doc(tmp_path, monkeypatch, material_id='m5_nl'):
    monkeypatch.setattr(store, 'UPLOAD_DIR', tmp_path / 'uploads')
    monkeypatch.setattr(render, 'RENDERS_DIR', tmp_path / 'renders')
    monkeypatch.setattr(layers, 'working_path', lambda _: tmp_path / 'absent.pptx')
    renders = render.pages_dir(material_id)
    renders.mkdir(parents=True)
    Image.new('RGB', (320, 180), 'white').save(renders / 's01.png')

    layers.ensure_document(material_id, 'NL Relations Test')
    changes = [
        {
            'page_no': 1,
            'id': 'u_b1',
            'create': {'type': 'vector', 'name': 'b1', 'x': 40, 'y': 100, 'width': 60, 'height': 16, 'rotation': 0},
        },
        {
            'page_no': 1,
            'id': 'u_b2',
            'create': {'type': 'vector', 'name': 'b2', 'x': 40, 'y': 100, 'width': 80, 'height': 16, 'rotation': -45},
        },
        {
            'page_no': 1,
            'id': 'u_v',
            'create': {'type': 'vector', 'name': 'v', 'x': 40, 'y': 100, 'width': 120, 'height': 16, 'rotation': -25},
        },
        {
            'page_no': 1,
            'id': 'u_lbl',
            'create': {'type': 'text', 'name': '坐标', 'text': '斜基：坐标 (1, 1)', 'x': 50, 'y': 20, 'width': 160, 'height': 24},
        },
    ]
    return store.patch_document(material_id, 0, 'op_init', changes)


def _openai_ok(payload_obj: dict):
    return 200, {
        'id': 'cmpl_test',
        'choices': [
            {
                'finish_reason': 'stop',
                'message': {'role': 'assistant', 'content': json.dumps(payload_obj, ensure_ascii=False)},
            }
        ],
        'usage': {'prompt_tokens': 100, 'completion_tokens': 80, 'total_tokens': 180},
    }


def test_suggest_relations_generates_basis_proposal_with_viewer_updates_and_caches(tmp_path, monkeypatch):
    doc = _setup_doc(tmp_path, monkeypatch)
    monkeypatch.setattr(relation_generation, 'get_settings', lambda: _fake_settings())

    sent_bodies = []

    class FakeTransport:
        def post(self, url, *, headers, json_body, timeout):
            sent_bodies.append(json_body)
            return _openai_ok({
                'summary': '设置 b2 终点可拖动，并实时在坐标文字中显示 v 在 (b1, b2) 下的坐标',
                'relations': [
                    {
                        'id': 'rel_nl_basis',
                        'kind': 'basis_decompose',
                        'enabled': True,
                        'provenance': 'user',
                        'firstId': 'u_b1',
                        'secondId': 'u_b2',
                        'resultId': 'u_v',
                        'labelId': 'u_lbl',
                        'labelTemplate': '斜基：坐标 ({a}, {b})',
                    }
                ],
                'viewer_updates': [
                    {
                        'nodeId': 'u_b2',
                        'viewer_editable': True,
                        'viewer_parameters': ['end', 'color'],
                    }
                ],
                'warnings': [],
            })

    monkeypatch.setattr(relation_generation, 'HttpxTransport', lambda: FakeTransport())

    first = relation_generation.suggest_relations(
        'm5_nl',
        1,
        instruction='让 b2 可以拖动终点，并实时显示 v 在 (b1, b2) 下的坐标',
        selected_node_ids=['u_b2', 'u_lbl'],
        expected_revision=doc['revision'],
    )
    assert first['relations'][0]['id'] == 'rel_nl_basis'
    assert first['viewer_updates'] == [{'nodeId': 'u_b2', 'viewer_editable': True, 'viewer_parameters': ['end', 'color']}]
    assert first['diagnostics']['cache_hit'] is False
    assert len(sent_bodies) == 1
    # Verify no base64 image data leaked into prompt context
    assert 'image_data' not in json.dumps(sent_bodies[0])

    # Document must NOT be auto-persisted by suggest
    latest = store.read_document('m5_nl')
    assert latest['revision'] == doc['revision']
    assert not latest['pages'][0].get('relations')

    # Second identical call hits cache without invoking LLM
    second = relation_generation.suggest_relations(
        'm5_nl',
        1,
        instruction='让 b2 可以拖动终点，并实时显示 v 在 (b1, b2) 下的坐标',
        selected_node_ids=['u_b2', 'u_lbl'],
        expected_revision=doc['revision'],
    )
    assert second['diagnostics']['cache_hit'] is True
    assert len(sent_bodies) == 1


def test_suggest_relations_auto_repairs_invalid_function_on_retry(tmp_path, monkeypatch):
    doc = _setup_doc(tmp_path, monkeypatch, material_id='m5_repair')
    monkeypatch.setattr(relation_generation, 'get_settings', lambda: _fake_settings())

    responses = [
        # Attempt 1: unsafe function eval() -> validator rejects and feeds error back
        _openai_ok({
            'summary': '显示向量长度',
            'relations': [
                {
                    'id': 'rel_len',
                    'kind': 'expr',
                    'enabled': True,
                    'provenance': 'user',
                    'targetId': 'u_lbl',
                    'targetProperty': 'text',
                    'expression': 'eval(u_b2.length)',
                }
            ],
            'viewer_updates': [],
            'warnings': [],
        }),
        # Attempt 2: repaired to whitelist round()
        _openai_ok({
            'summary': '显示 b2 向量长度',
            'relations': [
                {
                    'id': 'rel_len',
                    'kind': 'expr',
                    'enabled': True,
                    'provenance': 'user',
                    'targetId': 'u_lbl',
                    'targetProperty': 'text',
                    'expression': 'round(u_b2.length)',
                    'formatTemplate': '长度：{value}',
                    'precision': 0,
                }
            ],
            'viewer_updates': [],
            'warnings': [],
        }),
    ]
    calls = []

    class RepairTransport:
        def post(self, url, *, headers, json_body, timeout):
            calls.append(json_body)
            return responses.pop(0)

    monkeypatch.setattr(relation_generation, 'HttpxTransport', lambda: RepairTransport())

    result = relation_generation.suggest_relations(
        'm5_repair',
        1,
        instruction='让文字显示 b2 的长度',
        expected_revision=doc['revision'],
    )
    assert len(calls) == 2
    assert '未知函数 eval' in json.dumps(calls[1], ensure_ascii=False)
    assert result['relations'][0]['expression'] == 'round(u_b2.length)'
    assert result['diagnostics']['attempts'] == 2


def test_suggest_relations_rejects_persistent_cycle_and_disabled_model_and_conflict(tmp_path, monkeypatch):
    doc = _setup_doc(tmp_path, monkeypatch, material_id='m5_err')

    # 1. Disabled model
    monkeypatch.setattr(relation_generation, 'get_settings', lambda: _fake_settings(provider='none'))
    with pytest.raises(PPTAIError, match='未配置文本模型'):
        relation_generation.suggest_relations(
            'm5_err', 1, instruction='建立长度联动', expected_revision=doc['revision']
        )

    # 2. Revision conflict
    monkeypatch.setattr(relation_generation, 'get_settings', lambda: _fake_settings())
    with pytest.raises(store.DocumentConflict):
        relation_generation.suggest_relations(
            'm5_err', 1, instruction='建立长度联动', expected_revision=doc['revision'] + 99
        )

    # 3. Persistent cycle fails cleanly and writes diagnostic file without mutating document
    class CyclicTransport:
        def post(self, url, *, headers, json_body, timeout):
            return _openai_ok({
                'summary': '互环关系',
                'relations': [
                    {'id': 'c1', 'kind': 'expr', 'targetId': 'u_b1', 'targetProperty': 'length', 'expression': 'u_b2.length + 1'},
                    {'id': 'c2', 'kind': 'expr', 'targetId': 'u_b2', 'targetProperty': 'length', 'expression': 'u_b1.length + 1'},
                ],
                'viewer_updates': [],
                'warnings': [],
            })

    monkeypatch.setattr(relation_generation, 'HttpxTransport', lambda: CyclicTransport())
    with pytest.raises(ValueError, match='循环依赖'):
        relation_generation.suggest_relations(
            'm5_err', 1, instruction='让 b1 和 b2 互相决定长度', expected_revision=doc['revision']
        )

    latest = store.read_document('m5_err')
    assert latest['revision'] == doc['revision']
    diag_files = list((store.document_root('m5_err') / 'relations_suggest' / 'p01').glob('diag-*.json'))
    assert len(diag_files) == 1
