from copy import deepcopy
import pytest
from app.documents.auto_math import recognize_page, validated_replacements, merge_sequence


def node(identifier, x=0, y=0):
    return {'id': identifier, 'type': 'image', 'x': x, 'y': y, 'width': 200, 'height': 140,
            'z': 1, 'rotation': 0, 'style': {}, 'locked': False, 'text': '', 'deleted': False,
            'source_element_id': identifier, 'asset_id': identifier}


def matrix_element(identifier='m'):
    return {'id': identifier, 'kind': 'matrix', 'confidence': .98, 'evidence': '2 1 / 1 2',
            'matrices': [{'values': [[2, 1], [1, 2]], 'cells': [
                {'row': r, 'col': c, 'bbox': [.15+c*.4, .15+r*.4, .2, .2]}
                for r in range(2) for c in range(2)]}]}


def math_element(identifier='g'):
    return {'id': identifier, 'kind': 'math', 'confidence': .98, 'evidence': '(1,0)→(2,1); (1,1)→(3,3)',
            'template': 'circle_ellipse', 'matrix': [[2, 1], [1, 2]], 'vectors': [[1, 0], [1, 1], [1, -1]],
            'view_box': {'x': [-4, 4], 'y': [-3, 4]}, 'show_circle': True,
            'show_grid': False, 'radius': 1, 'color': '#c56b2c',
            'matrix_source': {'node_id': 'm', 'matrix_index': 0}}


def test_verified_math_and_ocr_link_keep_source_identity():
    replacements, report = validated_replacements({'nodes': [node('m'), node('g')]},
        {'elements': [matrix_element(), math_element()]})
    assert replacements['m'][0]['matrix_ocr']['matrices'][0]['values'] == [[2, 1], [1, 2]]
    graph = replacements['g'][0]
    assert graph['type'] == 'math_scene' and graph['asset_id'] == 'g'
    assert graph['math_scene']['matrix_source']['node_id'] == 'm'
    assert graph['math_scene']['vectors'][2] == [1, -1]
    assert graph['math_scene']['matrix'] == [[2, 1], [1, 2]]
    assert len(report['accepted']) == 2


@pytest.mark.parametrize('change', [
    {'confidence': .6}, {'matrix': [[2, 1], [1]]}, {'matrix': [[True, 1], [1, 2]]},
    {'matrix': [[float('nan'), 1], [1, 2]]}, {'id': 'unrelated'}, {'evidence': ''},
])
def test_uncertain_or_invalid_figure_preserves_picture(change):
    original = {'nodes': [node('g')]}
    item = math_element(); item.pop('matrix_source'); item.update(change)
    before = deepcopy(original)
    replacements, _ = validated_replacements(original, {'elements': [item]})
    assert not replacements and original == before


def test_wrong_matrix_link_and_missing_cell_rejected():
    bad = matrix_element(); bad['matrices'][0]['cells'].pop()
    assert not validated_replacements({'nodes': [node('m')]}, {'elements': [bad]})[0]
    graph = math_element(); graph['matrix'] = [[1, 0], [0, 1]]
    result, _ = validated_replacements({'nodes': [node('m'), node('g')]},
        {'elements': [matrix_element(), graph]})
    assert 'm' in result and 'g' not in result


def test_only_arrow_separated_aligned_steps_can_merge():
    nodes = [node('a', 0), node('b', 240), node('c', 480),
             {**node('arrow1', 210), 'type': 'text', 'text': '→', 'width': 20},
             {**node('arrow2', 450), 'type': 'text', 'text': '→', 'width': 20}]
    items = []
    for identifier, matrix in [('a', [[1, 0], [0, 1]]), ('b', [[1.618, 0], [0, .618]]),
                               ('c', [[1.2, -.4], [1.085, .47]])]:
        item = math_element(identifier); item.pop('matrix_source'); item['matrix'] = matrix
        items.append(item)
    page = {'nodes': nodes}
    replacements, _ = validated_replacements(page, {'elements': items})
    sequence = {'ids': ['a', 'b', 'c'], 'confidence': .99, 'evidence': '三步 → →',
                'steps': [{'label': str(i+1), 'matrix': item['matrix']} for i, item in enumerate(items)]}
    merged = merge_sequence(page, replacements, sequence)
    assert merged['a'][0]['width'] == 680 and len(merged['a'][0]['math_scene']['steps']) == 3
    assert merged['b'] == [] and merged['arrow1'] == []
    nodes[1]['y'] = 300
    assert merge_sequence(page, replacements, sequence) == replacements


def test_provider_failure_does_not_hide_sources():
    class Broken:
        def recognize_math_page(self, **kwargs): raise TimeoutError('provider unavailable')
    result, report = recognize_page({'nodes': [node('g')]}, [('g', b'png')], Broken())
    assert not result and report['status'] == 'failed'


def test_frozen_source_prevents_partial_sequence_replacement():
    from app.documents.auto_math import usable_replacements
    page = {'nodes': [node('a'), node('b', 240), node('arrow', 210)]}
    merged = {**node('a'), 'type': 'math_scene', 'recognition': {'source_ids': ['a', 'b', 'arrow']}}
    replacements = {'a': [merged], 'b': [], 'arrow': []}
    manifest = {'objects': {'a': {}, 'b': {}, 'arrow': {}}, 'frozen_ids': ['b']}
    assert not usable_replacements(page, replacements, manifest)
    manifest['frozen_ids'] = []
    assert usable_replacements(page, replacements, manifest) == replacements


def test_budget_and_concurrent_teacher_edits_are_preserved(tmp_path, monkeypatch):
    from io import BytesIO
    from types import SimpleNamespace
    from PIL import Image
    from pptx import Presentation
    from pptx.util import Inches
    from app.documents import auto_math, layers, store, capabilities
    from app.documents.importer import import_document
    from app.documents.layer_export import EXPORTER_VERSION
    from app.living import vision
    root = tmp_path/'document'; root.mkdir()
    ppt = Presentation()
    image = BytesIO(); Image.new('RGB', (120, 120), 'white').save(image, format='PNG')
    for _ in range(3):
        slide = ppt.slides.add_slide(ppt.slide_layouts[6])
        slide.shapes.add_textbox(0, 0, Inches(3), Inches(.5)).text = '矩阵'
        slide.shapes.add_picture(BytesIO(image.getvalue()), Inches(1), Inches(1))
    ppt.save(root/'source.pptx')
    document = import_document(root/'source.pptx', 'test')
    monkeypatch.setattr(store, 'document_root', lambda _: root)
    store.write_document('m', document)
    monkeypatch.setattr(layers, 'ensure_document', lambda *_: deepcopy(document))
    monkeypatch.setattr(capabilities, 'layer_editor_available', lambda: (True, '', 'test'))
    monkeypatch.setattr(vision, 'LivingVisionClient', lambda: SimpleNamespace(available=True, profile=SimpleNamespace(max_calls=2)))
    monkeypatch.setattr(layers, 'prepare_page', lambda *_: None)
    objects = {n['asset_id']: {} for p in document['pages'] for n in p['nodes']}
    monkeypatch.setattr(layers, 'read_manifest', lambda *_: {'status': 'ready', 'exporter_version': EXPORTER_VERSION, 'objects': objects})
    calls = []
    def recognize(page, images, _vision, _path):
        calls.append(page['page_no'])
        source = next(n for n in page['nodes'] if n['type'] == 'image')
        if page['page_no'] == 1:
            with store.LOCK:
                current = store.read_document('m')
                current['pages'][0].update(modified=True, teacher_note='keep this')
                current['revision'] += 1
                store.write_document('m', current)
        updated = {**source, 'type': 'math_scene', 'recognition': {'source_ids': [source['id']]}}
        return {source['id']: [updated]}, {'status': 'ready', 'version': 1, 'accepted': [source['id']]}
    monkeypatch.setattr(auto_math, 'recognize_page', recognize)
    auto_math.prepare_source_math('m', 'test')
    saved = store.read_document('m')
    assert sorted(calls) == [1, 2] and saved['math_recognition_calls'] == 2
    assert saved['pages'][0]['teacher_note'] == 'keep this'
    assert not any(n['type'] == 'math_scene' for n in saved['pages'][0]['nodes'])
    assert any(n['type'] == 'math_scene' for n in saved['pages'][1]['nodes'])
    assert not any(n['type'] == 'math_scene' for n in saved['pages'][2]['nodes'])


def test_svd_uses_directed_markers_and_preserves_other_input_vectors(monkeypatch):
    import math
    from app.documents.auto_math import calibrate_circle_sequence
    from app.documents import raster_geometry
    q = math.sqrt(.5); sx, sy = 1.618, .618
    directed = [[q*sx, q*sy], [-q*sx, q*sy]]
    nodes = [node('a'), node('b', 240), node('c', 480),
             {**node('text'), 'type': 'text', 'text': 'SVD 单位圆 → 沿轴伸缩 1.618 与 0.618 → 输出方向'}]
    geometries = {
        b'a': {'center': [200, 200], 'axes': [100, 100], 'angle': 0, 'marker': [300, 200]},
        b'b': {'center': [200, 200], 'axes': [sx*100, sy*100], 'angle': 0, 'marker': [200+sx*100, 200]},
        b'c': {'center': [200, 200], 'axes': [sx*100, sy*100], 'angle': 135,
               'marker': [200+q*sx*100, 200+q*sx*100]},
    }
    for g in geometries.values(): g.update(image_size=[500, 500], color='#c46231', confidence=.99)
    monkeypatch.setattr(raster_geometry, 'ellipse_geometry', lambda data: geometries[data])
    a, b, c = [math_element(i) for i in ('a', 'b', 'c')]
    for item in (a, b, c):
        item.pop('matrix_source'); item['vectors'] = [[1, 0], [0, 1]]
    a['matrix'] = [[1, 0], [0, 1]]; b['matrix'] = [[sx, 0], [0, sy]]; c['matrix'] = directed
    response = {'elements': [a, b, c], 'sequence': {'confidence': .99, 'evidence': '三步'}}
    result = calibrate_circle_sequence({'nodes': nodes}, [('a', b'a'), ('b', b'b'), ('c', b'c')], response)
    final = result['elements'][-1]['matrix']
    assert final[0][0] == pytest.approx(directed[0][0])
    assert final[1][0] == pytest.approx(directed[1][0])
    assert result['elements'][-1]['vectors'] == [[1, 0], [0, 1]]
    geometries[b'c']['marker'] = None
    assert calibrate_circle_sequence({'nodes': nodes}, [('a', b'a'), ('b', b'b'), ('c', b'c')], response) == response


@pytest.mark.parametrize('page_no', [5, 6, 9, 14, 18, 22])
def test_real_provider_replay_corrects_pixels_without_changing_source(page_no):
    """Recorded real model output is deliberately imperfect, never a product lookup table."""
    import json, math
    from pathlib import Path
    from pptx import Presentation
    from app.documents.importer import import_document
    from app.documents.auto_math import picture_bytes, calibrate_recognition
    source = Path(__file__).resolve().parents[2] / '用空间视角理解矩阵运算.pptx'
    deck = Presentation(source)
    page = import_document(source, 'source')['pages'][page_no-1]
    shapes = {shape.shape_id: shape for shape in deck.slides[page_no-1].shapes}
    images = [(n['id'], picture_bytes(shapes[n['source_shape_id']])) for n in page['nodes']
              if n['type'] == 'image' and shapes[n['source_shape_id']].shape_type == 13]
    raw = json.loads((Path(__file__).parent/'fixtures/math_vision_replay.json').read_text(encoding='utf-8'))[str(page_no)]
    original = deepcopy(raw)
    calibrated = calibrate_recognition(page, images, raw)
    replacements, report = validated_replacements(page, calibrated)
    replacements = merge_sequence(page, replacements, calibrated.get('sequence'))
    assert raw == original
    assert not report['rejected']
    graphs = [items[0]['math_scene'] for items in replacements.values() if items and items[0]['type'] == 'math_scene']
    assert graphs
    if page_no in (6, 9): assert graphs[0]['matrix'] == [[2, 1], [1, 2]]
    if page_no == 5:
        assert graphs[0]['matrix'][0][1] == pytest.approx(-.8)
        assert graphs[0]['comparison_matrix'][0][1] == pytest.approx(-.5)
    if page_no == 14:
        assert len(graphs) == 1 and len(graphs[0]['steps']) == 3
        assert graphs[0]['steps'][1]['matrix'] == [[1.618, 0], [0, .618]]
        last = graphs[0]['steps'][2]['matrix']
        assert math.degrees(math.atan2(last[1][0], last[0][0])) == pytest.approx(40, abs=.3)
    if page_no == 18:
        assert sorted(round(g['matrix'][0][0]*g['matrix'][1][1]-g['matrix'][0][1]*g['matrix'][1][0], 6) for g in graphs) == [0, 1, 1, 6]
        for graph in graphs:
            points = graph['polygon']
            area = abs(sum(points[i][0]*points[(i+1)%len(points)][1]-points[(i+1)%len(points)][0]*points[i][1] for i in range(len(points))))/2
            assert area == 1, 'Transformed polygons must not be transformed a second time'
    if page_no == 22:
        import numpy as np
        a, p = np.array(graphs[0]['matrix']), np.array(graphs[0]['basis'])
        assert np.linalg.solve(p, a @ p) == pytest.approx(np.array([[2.5, -.5], [-.5, 2.5]]))
