"""Scene definitions layered on step specs (dual-path order experiment)."""
from copy import deepcopy

from app.documents import presentation
from app.ispec.scene_definitions import ensure_scene_definition
from app.ispec.validator import validate_ispec


def step_spec():
    source = {'page': 5, 'element_id': 'p05_s08', 'bbox': {'x': 1, 'y': 2, 'w': 3, 'h': 4},
              'status': 'original', 'excerpt': '旋转30°，再横向1.6倍'}
    return {
        'spec_version': '1.0', 'object_id': 'image_steps_p05_s08',
        'title': '旋转与伸缩：比较顺序', 'kind': 'step',
        'parameters': [
            {'id': key, 'label': label, 'type': 'number', 'default': value,
             'min': -10, 'max': 10, 'source': deepcopy(source)}
            for key, label, value in (('steps_rotate_angle_deg', '旋转角度', 30),
                                      ('steps_stretch_factor_x', '横向倍率', 1.6),
                                      ('steps_stretch_factor_y', '纵向倍率', 1))
        ],
        'expressions': [{'id': 'rsx', 'expr': 'steps_stretch_factor_x*cos(steps_rotate_angle_deg*3.141592653589793/180)'}],
        'views': [{'type': 'figure', 'spec_ref': 'step_diagram'}],
        'anchor': {'page': 5, 'element_id': 'p05_s08', 'bbox': {'x': 1, 'y': 2, 'w': 3, 'h': 4}},
    }


def test_step_spec_receives_persistent_scene_and_controls():
    spec = ensure_scene_definition(step_spec())
    assert spec['scene']['scene_type'] == 'dual_path_order'
    assert spec['scene']['version'] == '1.0'
    assert [parameter['id'] for parameter in spec['parameters']][-2:] == ['steps_order', 'steps_shape']
    assert spec['scene']['controls'][-2:] == ['steps_order', 'steps_shape']
    assert spec['scene']['source_excerpt'].startswith('旋转30°')
    assert validate_ispec(spec) == []
    again = ensure_scene_definition(deepcopy(spec))
    assert [parameter['id'] for parameter in again['parameters']].count('steps_order') == 1


def test_non_step_figure_gets_generic_scene_without_step_controls():
    spec = step_spec()
    spec['parameters'] = spec['parameters'][:2]
    ensure_scene_definition(spec)
    assert spec['scene']['scene_type'] == 'figure_lab'
    assert 'steps_order' not in {parameter['id'] for parameter in spec['parameters']}


def test_spec_without_views_or_expressions_gets_no_scene():
    spec = step_spec()
    spec['parameters'] = spec['parameters'][:2]
    spec['views'] = []
    spec['expressions'] = []
    ensure_scene_definition(spec)
    assert 'scene' not in spec


def test_apply_document_specs_adds_scene_for_legacy_payload(monkeypatch):
    doc = {'schema_version': '1.0', 'revision': 1, 'title': 'T', 'source_key': 'k',
           'pages': [{'page_no': 5, 'width': 960.0, 'height': 540.0, 'modified': False, 'nodes': []}]}
    monkeypatch.setattr(presentation, 'read_document', lambda _: doc)
    result = presentation.apply_document_specs('mat', [step_spec()])
    assert result and result[0]['scene']['scene_type'] == 'dual_path_order'
    assert {'steps_order', 'steps_shape'} <= {parameter['id'] for parameter in result[0]['parameters']}
