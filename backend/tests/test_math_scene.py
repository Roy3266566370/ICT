from copy import deepcopy
import pytest
from app.documents.store import _create, validate_patch


def scene():
    return {'view_box': {'x': [-4, 4], 'y': [-3, 3]},
            'matrix': [[1, 1], [0, 1]], 'vector': [1, 1],
            'show_grid': True, 'show_circle': True, 'radius': 1,
            'progress': 1, 'animation_step': .02,
            'viewer_parameters': ['vector', 'progress']}


def test_create_and_edit_math_scene():
    node = _create({'nodes': []}, 'u_math', {'type': 'math_scene', 'math_scene': scene(),
        'viewer_editable': True, 'flow': {'enabled': True, 'speed': 2}})
    assert node['math_scene'] == scene()
    validate_patch({'math_scene': scene(), 'viewer_editable': False})


def test_math_scene_save_reload_and_atomic_rejection(tmp_path, monkeypatch):
    from app.documents import store
    monkeypatch.setattr(store, 'document_root', lambda _: tmp_path / 'document')
    store.write_document('material', {'revision': 0, 'source_key': 'test',
        'pages': [{'page_no': 1, 'nodes': []}]})
    store.patch_document('material', 0, 'create_math', [{'page_no': 1, 'id': 'u_math',
        'create': {'type': 'math_scene', 'math_scene': scene(), 'viewer_editable': True,
                   'flow': {'enabled': True, 'speed': 2},
                   'style': {'stroke': '#008844', 'line_style': 'dotted'}}}])
    edited = scene(); edited['matrix'] = [[2, 0], [0, 1]]
    store.patch_document('material', 1, 'edit_math', [{'page_no': 1, 'id': 'u_math',
        'patch': {'math_scene': edited, 'viewer_editable': False}}])
    saved = store.read_document('material')['pages'][0]['nodes'][0]
    assert saved['math_scene'] == edited and saved['viewer_editable'] is False
    assert saved['flow'] == {'enabled': True, 'speed': 2}
    assert saved['style']['line_style'] == 'dotted'
    invalid = deepcopy(edited); invalid['matrix'][0][0] = float('nan')
    with pytest.raises(ValueError):
        store.patch_document('material', 2, 'invalid_math', [{'page_no': 1, 'id': 'u_math',
            'patch': {'math_scene': invalid}}])
    assert store.read_document('material')['revision'] == 2


@pytest.mark.parametrize('field,value', [
    ('matrix', [[1, 2, 3], [0, 1]]), ('matrix', [[float('nan'), 0], [0, 1]]),
    ('vector', [True, 1]), ('view_box', {'x': [1, 1], 'y': [-1, 1]}),
    ('animation_step', 0), ('progress', 2), ('viewer_parameters', ['code']),
    ('radius', -1), ('show_grid', 'yes'),
])
def test_invalid_math_scene_rejected(field, value):
    config = deepcopy(scene()); config[field] = value
    with pytest.raises(ValueError):
        validate_patch({'math_scene': config})


@pytest.mark.parametrize('patch', [
    {'flow': {'enabled': True, 'speed': float('inf')}},
    {'flow': {'enabled': 'yes', 'speed': 1}}, {'viewer_editable': 'yes'},
    {'viewer_parameters': ['geometry', 'code']}, {'viewer_parameters': ['flow', 'flow']},
])
def test_invalid_vector_options_rejected(patch):
    with pytest.raises(ValueError):
        validate_patch(patch)
