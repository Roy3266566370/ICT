from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pptx import Presentation

from app import project_package
from app.db.session import reset_engine_cache
from app.documents import layers, store
from app.main import create_app
from app.settings import get_settings
from app.documents.ai_deck_generator import generate_outline
from app.documents.native_deck import create_native_deck
from app.ppt_ai.client import PPTAIError


def test_blank_material_creates_editable_pages_without_source_and_renames(tmp_path, monkeypatch):
    monkeypatch.setenv('DATABASE_URL', 'sqlite:///' + (tmp_path / 'deck.db').as_posix())
    monkeypatch.setenv('SESSION_COOKIE_SECURE', 'false')
    monkeypatch.setenv('ENFORCE_CSRF', 'true')
    monkeypatch.setattr(store, 'UPLOAD_DIR', tmp_path / 'uploads')
    monkeypatch.setattr(layers, 'working_path', lambda _: tmp_path / 'missing.pptx')
    monkeypatch.setattr(project_package, 'UPLOAD_DIR', tmp_path / 'uploads')
    monkeypatch.setattr(project_package, 'DATA_DIR', tmp_path / 'data')
    monkeypatch.setattr(project_package, 'pages_dir', lambda mid: tmp_path / 'renders' / mid / 'pages')
    monkeypatch.setattr(project_package, 'render_dir', lambda mid: tmp_path / 'renders' / mid)
    get_settings.cache_clear()
    reset_engine_cache()
    try:
        with TestClient(create_app()) as client:
            session = client.post('/api/v1/sessions').json()['data']
            headers = {'X-CSRF-Token': session['csrf_token']}
            response = client.post('/api/v1/materials/blank', headers=headers, json={
                'title': '  矩阵讲义  ', 'aspect_ratio': '4:3', 'template_id': 'lecture',
                'theme_id': 'midnight-tech',
            })
            assert response.status_code == 201, response.text
            result = response.json()['data']
            assert result['page_count'] == 4
            material_id = result['material_id']
            base = f'/api/v1/materials/{material_id}'
            assert not (store.document_root(material_id) / 'source.pptx').exists()
            scene = client.get(base + '/document').json()['data']
            assert scene['theme']['id'] == 'midnight-tech'
            assert all(p['source_page_no'] is None and p['preparation']['status'] == 'ready'
                       and p['width'] == 720 and p['height'] == 540 for p in scene['pages'])
            info = client.get(base).json()['data']
            assert info['material']['status'] == 'ready' and info['job'] is None
            assert len(info['slides']) == 4
            assert client.patch(base, headers=headers, json={'title': '线性代数'}).status_code == 200
            assert client.get(base + '/document').json()['data']['title'] == '线性代数'
            assert client.get(base).json()['data']['material']['title'] == '线性代数'
            nodes = scene['pages'][0]['nodes']
            theme = {**scene['theme'], 'name': '自定义主题',
                     'master': {'show_page_number': True, 'footer_text': '课程讲义', 'accent_bar': 'top'}}
            gradient = {'angle': 125, 'stops': [{'position': 0, 'color': '#EEF2FF'},
                                                {'position': 1, 'color': '#FFFFFF'}]}
            changes = [
                {'page_no': 0, 'id': '__page__', 'page_action': {'kind': 'document_theme', 'theme': theme}},
                {'page_no': 1, 'id': '__page__', 'page_action': {
                    'kind': 'page_metadata', 'patch': {
                        'transition': {'kind': 'fade', 'duration_ms': 320},
                        'background': {'kind': 'gradient', 'gradient': gradient},
                    },
                }},
                {'page_no': 1, 'id': nodes[0]['id'], 'patch': {
                    'group_id': 'group_one', 'text': '图形内文字', 'style': {
                        'border_radius': 2, 'linear_gradient': gradient,
                        'shadow': {'x': 0, 'y': 3, 'blur': 5, 'color': '#000000', 'opacity': .2},
                    },
                }},
                {'page_no': 1, 'id': nodes[1]['id'], 'patch': {'group_id': 'group_one'}},
                {'page_no': 2, 'id': 'u_native_table', 'create': {
                    'type': 'table', 'table': [['项目', '结果'], ['甲', '2']],
                    'table_style': {'header_row': True, 'banded_rows': True},
                }},
            ]
            patch = client.patch(base + '/document', headers=headers, json={
                'expected_revision': scene['revision'], 'operation_id': 'theme-and-group', 'changes': changes,
            })
            assert patch.status_code == 200, patch.text
            updated = client.get(base + '/document').json()['data']
            assert updated['theme']['name'] == '自定义主题'
            assert [node['group_id'] for node in updated['pages'][0]['nodes'][:2]] == ['group_one', 'group_one']
            exported = client.get(base + '/export-pptx')
            assert exported.status_code == 200, exported.text
            deck = Presentation(BytesIO(exported.content))
            assert len(deck.slides) == 4
            assert deck.slide_width * 3 == deck.slide_height * 4
            assert any(shape.has_text_frame and shape.text == '矩阵讲义' for shape in deck.slides[0].shapes)
            assert any(shape.has_text_frame and shape.text == '图形内文字' for shape in deck.slides[0].shapes)
            assert len(deck.slides[0]._element.xpath('./p:transition/p:fade')) == 1
            assert deck.slides[0]._element.xpath('.//p:bgPr/a:gradFill/a:lin')
            assert deck.slides[0]._element.xpath('.//a:outerShdw')
            assert deck.slides[1]._element.xpath('.//a:tcPr/a:lnL')
            assert all(not shape.has_text_frame or shape.text != '课程讲义' for shape in deck.slides[0].shapes)
            assert any(shape.has_text_frame and shape.text == '课程讲义' for shape in deck.slides[1].shapes)
            reordered = client.patch(base + '/document', headers=headers, json={
                'expected_revision': updated['revision'], 'operation_id': 'slide-order',
                'changes': [{'page_no': 1, 'id': '__page__', 'page_action': {
                    'kind': 'reorder_pages', 'order': [1, 4, 2, 3],
                }}],
            })
            assert reordered.status_code == 200, reordered.text
            html = client.post(base + '/export-html', headers=headers)
            assert html.status_code == 200
            recovered = client.post('/api/v1/project-packages/import', headers=headers, files={
                'file': ('lecture.html', html.content, 'text/html'),
            })
            assert recovered.status_code == 201, recovered.text
            recovered_doc = store.read_document(recovered.json()['data']['material_id'])
            assert [page['page_no'] for page in recovered_doc['pages']] == [1, 4, 2, 3]
            assert recovered_doc['theme']['master']['footer_text'] == '课程讲义'
            assert recovered_doc['pages'][0]['transition']['kind'] == 'fade'
            assert recovered_doc['pages'][0]['background']['gradient'] == gradient
            assert recovered_doc['pages'][0]['nodes'][0]['style']['shadow']['opacity'] == .2
            assert client.post('/api/v1/materials/blank', headers=headers, json={
                'title': '空白', 'template_id': 'missing',
            }).status_code == 422
    finally:
        get_settings.cache_clear()
        reset_engine_cache()


def test_ai_outline_builds_standard_text_and_workshop_nodes():
    class Client:
        def generate_json(self,*args,**kwargs):
            return SimpleNamespace(data={'slides':[
                {'title':'矩阵变换','points':['观察单位正方形面积变化'],'layout_id':'text-plugin',
                 'template_kind':'la01-matrix-det-basis'},
            ]})

    outline=generate_outline(Client(),'线性代数','面积和基变换')
    deck=create_native_deck('线性代数','16:9','blank',None,outline)
    nodes=deck['pages'][0]['nodes']
    assert any(node['type']=='text' and '面积变化' in node['text'] for node in nodes)
    assert any(node['type']=='workshop_plugin' and
               node['workshop_plugin']['template_kind']=='la01-matrix-det-basis' for node in nodes)

    class BadClient(Client):
        def generate_json(self,*args,**kwargs):
            return SimpleNamespace(data={'slides':[{'title':'测试','points':['x'*151]}]})

    with pytest.raises(PPTAIError):
        generate_outline(BadClient(),'测试','测试超长要点')
