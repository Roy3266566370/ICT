from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageDraw
import pytest

from app import render
from app.documents import figure_service, layers, store
from app.documents.figure_scene import FigureScene


@pytest.fixture
def raster_material(tmp_path, monkeypatch):
    import app.editing as editing
    monkeypatch.setattr(store, 'UPLOAD_DIR', tmp_path / 'uploads')
    monkeypatch.setattr(render, 'RENDERS_DIR', tmp_path / 'renders')
    monkeypatch.setattr(layers, 'working_path', lambda _: tmp_path / 'absent.pptx')
    renders = render.pages_dir('m3_demo')
    renders.mkdir(parents=True)
    image = Image.new('RGB', (120, 80), 'white')
    ImageDraw.Draw(image).line((10, 20, 100, 20), fill='#18233D', width=2)
    image.save(renders / 's01.png')
    monkeypatch.setattr(figure_service, 'read_ocr', lambda image: [])
    return 'm3_demo'


def test_pixel_cache_asset_apply_and_undo(raster_material, monkeypatch):
    material = raster_material
    calls = []

    def detect(image, ocr):
        calls.append(image.size)
        return [], [{'id': 'arrow', 'type': 'segment', 'points': [[10, 20], [100, 20]], 'provenance': 'pixel'}]

    monkeypatch.setattr(figure_service, 'detect_figure', detect)
    document = layers.ensure_document(material, 'Rendered slide')
    source = document['pages'][0]['nodes'][0]
    assert source['image_url'].endswith('/renders/s01.png')
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: figure_service.vectorize(
            material, 1, source['id'], expected_revision=0), range(2)))
    assert calls == [(120, 80)]
    preview = results[0]
    assert preview['nodes'][0]['width'] == 90
    assert sum(item['diagnostics']['cache_hit'] for item in results) == 1
    assert figure_service.asset_path(material, 1, preview['cleaned_asset_id']).is_file()
    changes = [{'page_no': 1, 'id': source['id'], 'patch': {
        'cleaned_asset_id': preview['cleaned_asset_id'], 'figure_scene': preview['scene']}}]
    updated = store.patch_document(material, 0, 'apply_vector', changes)
    assert updated['revision'] == 1
    assert 'cleaned_url' in layers.hydrate_document(material, updated)['pages'][0]['nodes'][0]
    with pytest.raises(store.DocumentConflict):
        figure_service.vectorize(material, 1, source['id'], expected_revision=0)
    store.patch_document(material, 1, 'undo_vector', [{'page_no': 1, 'id': source['id'],
        'patch': {'cleaned_asset_id': None, 'figure_scene': None}}])
    assert not layers.ensure_document(material, 'rendered')['pages'][0]['nodes'][0].get('cleaned_url')
    with pytest.raises(ValueError, match='原图已变化'):
        store.patch_document(material, 2, 'stale_asset', [{'page_no': 1, 'id': source['id'],
            'patch': {'x': 12, 'cleaned_asset_id': preview['cleaned_asset_id']}}])
    Image.new('RGB', (120, 80), '#aaaaaa').save(render.pages_dir(material) / 's01.png')
    with pytest.raises(ValueError, match='原图已变化'):
        store.patch_document(material, 2, 'stale_png', changes)


def test_linked_scene_rejects_dangling_system_and_bad_points():
    base = {'version': 1, 'frame': {'width': 100, 'height': 80}}
    with pytest.raises(ValueError):
        FigureScene.model_validate({**base, 'objects': [{'id': 'v', 'type': 'vector',
            'system_id': 'missing', 'points': [[0, 0], [110, 0]], 'provenance': 'pixel'}]})


def test_vector_nodes_follow_the_exported_raster_frame():
    scene = FigureScene.model_validate({'version': 1, 'frame': {'width': 100, 'height': 100},
        'objects': [{'id': 'line', 'type': 'segment', 'points': [[30, 50], [90, 50]], 'provenance': 'pixel'}]})
    source = {'id': 'n_1', 'x': 10, 'y': 20, 'width': 100, 'height': 100, 'z': 1, 'rotation': 0}
    manifest = {'asset_frame': [4, 3], 'asset_size': [90, 80], 'asset_scale': 1.5}
    vector, = figure_service._scene_nodes(source, scene, manifest, 'demo')
    assert vector['x'] == pytest.approx(33)
    assert vector['width'] == pytest.approx(54)
    assert vector['y'] + vector['height'] / 2 == pytest.approx(57)
    assert vector['z'] == source['z']


def test_detector_uses_the_direct_upload_resolution(raster_material, monkeypatch):
    from pathlib import Path

    root = store.document_root(raster_material).parent
    root.mkdir(parents=True)
    Image.new('RGB', (120, 80), 'white').save(root / 'original.png')
    rendered = root / 'n_2.png'
    Image.new('RGB', (240, 160), 'white').save(rendered)
    monkeypatch.setattr(figure_service, 'read_manifest', lambda *args: {
        'status': 'ready', 'exporter_version': 2, 'objects': {'n_2': {'asset': rendered.name}},
    })
    monkeypatch.setattr(figure_service, 'layer_dir', lambda *args: Path(root))
    node = {'id': 'n_2', 'asset_id': 'n_2', 'source_shape_id': 2, 'source_element_id': 'p01_s00'}
    original, detector, *_ = figure_service._source(raster_material, 1, 'fixture', node)
    assert detector.size == (120, 80)
    assert original.size == (240, 160)
    _, unrelated_detector, *_ = figure_service._source(
        raster_material, 1, 'fixture', {**node, 'source_element_id': 'p01_s01'})
    assert unrelated_detector.size == original.size


def test_empty_high_resolution_scan_reuses_ocr_at_a_smaller_scale(monkeypatch):
    image = Image.new('RGB', (1200, 800), 'white')
    rows = [{'box': [[40, 20], [60, 20], [60, 40], [40, 40]], 'score': .9, 'text': 'v'}]
    seen = []

    def detect(candidate, evidence):
        seen.append((candidate.width, evidence[0]['box'][0]))
        return [], [] if candidate.width == 1200 else [{'type': 'vector'}]

    monkeypatch.setattr(figure_service, 'detect_figure', detect)
    smaller, _, _, objects = figure_service._detect_at_source_scale(image, rows)
    assert smaller.size == (900, 600)
    assert seen == [(1200, [40, 20]), (900, [30, 15])]
    assert len(objects) == 1


def test_visual_matching_never_accepts_new_geometry():
    from app.documents.figure_service import match_labels
    scene = FigureScene.model_validate({'version': 1, 'frame': {'width': 100, 'height': 80},
        'objects': [{'id': 'vec', 'type': 'vector', 'points': [[10, 20], [70, 20]], 'provenance': 'pixel'},
                    {'id': 'tag', 'type': 'text', 'points': [[72, 22]], 'text': 'v', 'provenance': 'pixel'}]})
    changed, rejected = match_labels(scene, {'matches': [
        {'object_id': 'vec', 'label_id': 'tag'},
        {'object_id': 'other', 'label_id': 'tag', 'points': [[0, 0], [99, 79]]}]})
    assert changed.objects[0].label_id == 'tag'
    assert changed.objects[0].points == scene.objects[0].points
    assert len(rejected) == 1


def test_route_ownership_and_visual_timeout_keep_pixel_preview(raster_material, monkeypatch):
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse
    from fastapi.testclient import TestClient
    from types import SimpleNamespace

    from app.api import get_db, require_session, write_context
    from app.api.routes_documents import router
    from app.ppt_ai.client import PPTAIError
    from app.schemas.errors import ApiError

    class FakeDB:
        def get(self, model, identifier):
            return SimpleNamespace(session_id='owner', title='Rendered',
                                   status='ready',
                                   expires_at='2099-01-01T00:00:00Z') if identifier == raster_material else None

    def context(request: Request):
        return SimpleNamespace(session_id=request.headers.get('X-Test-User'))

    class SlowVision:
        available = True

        def __init__(self, transport=None):
            self.transport = transport

        def generate_json(self, **kwargs):
            raise PPTAIError('timeout', '模型超时')

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides.update({get_db: FakeDB, require_session: context, write_context: context})
    app.add_exception_handler(ApiError, lambda request, exc: JSONResponse(exc.to_body('test'), status_code=exc.status_code))
    monkeypatch.setattr(figure_service, 'LivingVisionClient', SlowVision)
    monkeypatch.setattr(figure_service, 'detect_figure', lambda *args: ([], [
        {'id': 'line', 'type': 'segment', 'points': [[10, 20], [100, 20]], 'provenance': 'pixel'},
        {'id': 'label', 'type': 'text', 'text': 'v', 'points': [[101, 24]], 'provenance': 'pixel'},
    ]))
    client = TestClient(app)
    owner = {'X-Test-User': 'owner'}
    url = f'/api/v1/materials/{raster_material}/pages/1/figures/render_p01/vectorize'
    assert client.post(url, json={'expected_revision': 0}).status_code == 404
    response = client.post(url, headers=owner, json={'expected_revision': 0})
    assert response.status_code == 200, response.text
    pixel = response.json()['data']
    assert pixel['vision_available'] and pixel['cleaned_asset_id']
    assert len(pixel['scene']['objects']) == 2
    assert len(pixel['nodes']) == 1
    assert client.get(pixel['cleaned_url'], headers=owner).headers['content-type'] == 'image/png'
    assert client.get(pixel['cleaned_url']).status_code == 404
    assert client.get(pixel['cleaned_url'].replace('/1/', '/2/'), headers=owner).status_code == 404
    failed = client.post(url, headers=owner, json={'expected_revision': 0, 'stage': 'vision',
                                                   'preview_id': pixel['preview_id']})
    assert failed.status_code == 200, failed.text
    result = failed.json()['data']
    assert result['diagnostics']['vision_status'] == 'failed'
    assert result['nodes'] == pixel['nodes']
    diagnostics = list((store.document_root(raster_material) / 'figures').rglob('vision-*.json'))
    assert len(diagnostics) == 1
    assert '"timeout"' in diagnostics[0].read_text(encoding='utf-8')
