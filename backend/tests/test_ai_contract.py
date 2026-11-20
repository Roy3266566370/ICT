"""AI 共享契约、MaaS 原图编码整理与内核交接测试（不含本地 Ollama 逻辑）。"""

from __future__ import annotations

import base64
import io

import pytest
from PIL import Image

from app.labs import ai_contract
from app.labs.ai import LabAI
from app.labs.ai_solve import run_kernel
from app.ppt_ai.client import PPTAIClient
from app.settings import Settings


def candidate() -> dict:
    return dict(
        question='计算积分',
        subquestions=['求积分'],
        relations=[],
        target='积分值',
        conditions=[
            dict(
                id='c1',
                value='y^2<=x, x^2<=y',
                unit='',
                excerpt='y²≤x，x²≤y',
                page_key=None,
                bbox=None,
            )
        ],
        uncertainties=[],
        unsupported_reason='',
        model=dict(
            kind='kernel',
            task='double_integral',
            conditions=dict(
                integrand='(x-y+1)^2',
                outer_variable='y',
                outer_bounds=['0', '1'],
                inner_bounds=['y^2', 'sqrt(y)'],
            ),
        ),
    )


def test_model_answer_never_decides_result():
    data = candidate()
    data['answer'] = '999'
    data['checkable'] = True
    result = ai_contract.finish_understanding(
        ai_contract.validate_understanding(data, []),
        {'text': '积分', 'recognition': {'ambiguities': []}},
    )
    assert result['answer'] == '71/210'
    assert result['verification'] == 'kernel'
    assert result['computation']['interactive_model']
    assert any(c['id'] == 'numerical_quadrature' and c['status'] == 'pass' for c in result['computation']['checks'])


def test_unreviewed_source_can_compute_but_not_grade():
    result = ai_contract.finish_understanding(
        ai_contract.validate_understanding(candidate(), []),
        {'text': '积分', 'recognition': {'ambiguities': [{'id': 'source_formula_confirmation', 'resolved': False}]}},
    )
    assert result['computation']['exact'] == '71/210'
    assert result['source_review_required'] and not result['checkable']


def test_uncertain_input_does_not_compute():
    data = candidate()
    data['uncertainties'] = ['上限缺失']
    result = ai_contract.finish_understanding(ai_contract.validate_understanding(data, []), {'text': '积分'})
    assert result['computation'] is None and not result['checkable']


@pytest.mark.parametrize('change', ['source', 'bbox', 'task'])
def test_reject_invalid_contract(change):
    data = candidate()
    if change == 'source':
        data['conditions'][0]['page_key'] = 'other_lab'
    if change == 'bbox':
        data['conditions'][0]['bbox'] = [0, 0, 2, 1]
    if change == 'task':
        data['model']['task'] = 'execute_python'
    with pytest.raises(ValueError):
        ai_contract.validate_understanding(data, [])


def test_source_path_cannot_escape_lab(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_contract, 'LABS_DIR', tmp_path)
    with pytest.raises(ValueError):
        ai_contract.source_images('../outside', {'source_pages': [{'image_key': 'a'}]})


def test_raw_region_uses_existing_kernel_derivation():
    r = run_kernel(
        dict(
            kind='kernel',
            task='double_integral',
            conditions={'region_text': 'D={(x,y)|y^4<=x,x^2<=y}', 'integrand': '1'},
        )
    )
    assert r['exact'] == '7/15'


def test_understanding_schema_preserves_array_and_object_shapes():
    fields = ai_contract.understanding_schema()['properties']['model']['properties']['conditions']['properties']
    assert fields['vector_b']['type'] == 'array'
    assert fields['activations']['type'] == 'array'
    assert fields['weights']['items']['items']['type'] == 'array'
    assert fields['request']['required'] == ['process', 'vector']


def test_cloud_images_downsample_to_maas_jpeg_envelope(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_contract, 'LABS_DIR', tmp_path)
    lab = tmp_path / 'lab_demo'
    (lab / 'previews').mkdir(parents=True)
    (lab / 'analysis').mkdir()
    Image.new('RGB', (3000, 4000), 'white').save(lab / 'previews' / 'page.png')
    Image.new('RGB', (3000, 4000), 'white').save(lab / 'analysis' / 'page.png')
    images = ai_contract.source_images('lab_demo', {'source_pages': [{'image_key': 'page', 'page': 1}]})
    assert len(images) == 1
    assert images[0]['mime_type'] == 'image/jpeg'
    picture = Image.open(io.BytesIO(base64.b64decode(images[0]['image'])))
    assert max(picture.size) <= ai_contract.CLOUD_IMAGE_MAX_EDGE


def test_only_maas_provider_is_accepted_for_ai_connectors():
    for non_maas in ('none', 'ollama', 'openai_compatible', ''):
        s = Settings(
            _env_file=None,
            llm_provider=non_maas,
            llm_api_key='test-key',
            llm_model='test-model',
            llm_base_url='https://api.modelarts-maas.com/v2',
            lab_ai_enabled=True,
        )
        assert not PPTAIClient(s).available()
        assert not LabAI(s).available()

    maas = Settings(
        _env_file=None,
        llm_provider='maas',
        llm_api_key='test-key',
        llm_model='deepseek-v4.1-flash-1017',
        llm_base_url='https://api.modelarts-maas.com/v2',
        lab_ai_enabled=True,
    )
    assert PPTAIClient(maas).available()
    assert LabAI(maas).available()
