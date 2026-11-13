"""Scene-node interactions, pause/recovery and scene-aware re-recognition."""
from copy import deepcopy

import pytest

from app.documents import presentation
from app.ispec.node_interaction import build_node_spec, validate_node_interaction
from app.ispec.validator import validate_ispec


def node(**overrides):
    base = {
        'id': 'n_5', 'type': 'text', 'name': '公式', 'x': 60.0, 'y': 100.0,
        'width': 300.0, 'height': 50.0, 'base_x': 60.0, 'base_y': 100.0,
        'base_width': 300.0, 'base_height': 50.0, 'rotation': 0.0,
        'text': 'y = x^2 + 2*x', 'base_text': 'y = x^2 + 2*x',
        'source_element_id': 'p01_s00', 'paragraphs': [], 'style': {}, 'base_style': {},
    }
    base.update(overrides)
    return base


def document(nodes, **page):
    return {'schema_version': '1.0', 'revision': 1, 'title': 'Test', 'source_key': 'k',
            'pages': [{'page_no': 1, 'width': 960.0, 'height': 540.0, 'modified': True,
                       'nodes': nodes, **page}]}


def auto_spec(source='p01_s00', excerpt='y = x^2 + 2*x'):
    return {'spec_version': '1.0', 'object_id': 'native_test_p1_formula',
            'title': '旧公式', 'kind': 'parametric', 'parameters': [
                {'id': 'x', 'label': '变量 x', 'type': 'number', 'default': 2,
                 'source': {'page': 1, 'element_id': source, 'bbox': {'x': 60 * 12700, 'y': 100 * 12700,
                                                                     'w': 300 * 12700, 'h': 50 * 12700},
                            'status': 'original', 'excerpt': excerpt}}],
            'expressions': [{'id': 'y', 'expr': 'x**2 + 2*x'}],
            'views': [{'type': 'text', 'template': 'y = {{y}}'}]}


def test_formula_node_interaction_uses_confirmed_provenance():
    config = {'kind': 'formula', 'formula': 'y = x^2 + 2*x', 'defaults': {'x': 2},
              'allowed': ['x'], 'ranges': {'x': {'min': -5, 'max': 5, 'step': .5}},
              'title': '抛物线'}
    validate_node_interaction(config)
    spec = build_node_spec(node(interaction=config), 1)
    assert spec['object_id'] == 'node_spec_n_5'
    assert spec['node_id'] == 'n_5' and spec['anchor']['node_id'] == 'n_5'
    assert spec['anchor']['bbox']['x'] == pytest.approx(60 * 12700)
    assert spec['parameters'][0]['source']['status'] == 'confirmed'
    assert spec['parameters'][0]['min'] == -5 and spec['parameters'][0]['step'] == .5
    assert spec['expressions'][0]['id'] == 'y'
    assert validate_ispec(spec) == []


def test_fixed_variables_are_folded_out_of_parameters():
    config = {'kind': 'formula', 'formula': 'y = a*x + 1', 'defaults': {'a': 3, 'x': 2},
              'allowed': ['x']}
    spec = build_node_spec(node(interaction=config), 1)
    assert [parameter['id'] for parameter in spec['parameters']] == ['x']
    assert '3.0' in spec['expressions'][0]['expr']


@pytest.mark.parametrize('template', ['grid_transform', 'circle_ellipse', 'vectors', 'eigen_probe',
                                      'inverse_map', 'det_area', 'basis_change'])
def test_every_figure_template_builds_a_valid_spec(template):
    config = {'kind': 'figure', 'template': template, 'matrix': [[1, 2], [3, 4]], 'vector': [2, 1]}
    spec = build_node_spec(node(type='image', text='', interaction=config), 1)
    assert spec is not None and spec['views'][0]['type'] == 'figure'
    assert spec['views'][0]['spec_ref'] == template
    assert validate_ispec(spec) == []


def test_invalid_interaction_configs_are_rejected():
    for config in [
        {'kind': 'formula', 'formula': 'y = x^2', 'defaults': {'x': 1}, 'allowed': []},
        {'kind': 'formula', 'formula': 'y = x^2', 'defaults': {'x': 1}, 'allowed': ['x'],
         'ranges': {'x': {'step': 0}}},
        {'kind': 'figure', 'template': 'not-a-template', 'matrix': [[1, 0], [0, 1]]},
        {'kind': 'matrix', 'matrix': [[1, 0, 0], [0, 1, 0]]},
        {'kind': 'chart', 'categories': ['A'], 'series': [{'name': 's', 'values': [1, 2]}]},
        {'kind': 'formula', 'formula': 'y = x', 'defaults': {'x': 1}, 'allowed': ['x'], 'unknown': 1},
    ]:
        with pytest.raises(ValueError):
            validate_node_interaction(config)


def test_moved_auto_spec_follows_its_node(monkeypatch):
    moved = node(x=180.0, y=160.0)
    monkeypatch.setattr(presentation, 'read_document', lambda _: document([moved]))
    specs = presentation.apply_document_specs('mat', [auto_spec()])
    assert specs and specs[0]['anchor']['bbox']['x'] == pytest.approx(180 * 12700)
    assert specs[0]['anchor']['bbox']['y'] == pytest.approx(160 * 12700)
    assert specs[0]['node_id'] == 'n_5'


def test_content_change_without_replacement_pauses_the_old_spec(monkeypatch):
    changed = node(text='完全不同的说明文字', content_changed=True)
    monkeypatch.setattr(presentation, 'read_document', lambda _: document([changed]))
    specs = presentation.apply_document_specs('mat', [auto_spec()])
    assert len(specs) == 1
    assert specs[0]['availability'] == 'needs_review'
    assert '重新提取' in specs[0]['availability_reason']
    assert validate_ispec(specs[0]) == []


def test_edited_formula_is_rederived_and_old_relation_removed(monkeypatch):
    changed = node(text='y = x^2 + 3*x', content_changed=True)
    monkeypatch.setattr(presentation, 'read_document', lambda _: document([changed]))
    specs = presentation.apply_document_specs('mat', [auto_spec()])
    assert all(spec['object_id'] != 'native_test_p1_formula' for spec in specs)
    derived = [spec for spec in specs if spec.get('node_id') == 'n_5']
    assert derived and any('3' in spec['expressions'][0]['expr'] and 'x' in spec['expressions'][0]['expr']
                           for spec in derived if spec.get('expressions'))


def test_user_interaction_replaces_automatic_spec(monkeypatch):
    config = {'kind': 'formula', 'formula': 'y = x^2 + 2*x', 'defaults': {'x': 2}, 'allowed': ['x']}
    configured = node(interaction=config)
    monkeypatch.setattr(presentation, 'read_document', lambda _: document([configured]))
    specs = presentation.apply_document_specs('mat', [auto_spec()])
    assert [spec['object_id'] for spec in specs] == ['node_spec_n_5']
    assert specs[0]['parameters'][0]['default'] == 2
    assert specs[0]['generated_by'] == 'user'


def test_page_reinteraction_uses_current_visible_text(monkeypatch):
    edited = node(text='y = 2*x + 1', base_text='旧内容', content_changed=True)
    monkeypatch.setattr(presentation, 'read_document', lambda _: document([edited], reinteraction=True))
    specs = presentation.apply_document_specs('mat', [auto_spec()])
    assert all(spec['object_id'] != 'native_test_p1_formula' for spec in specs)
    assert any('2*x + 1' in (spec.get('notes') or '') or
               any('2*x + 1' in (parameter.get('source', {}).get('excerpt') or '')
                   for parameter in spec.get('parameters', []))
               for spec in specs)
    assert all(validate_ispec(spec) == [] for spec in specs)


def test_reinteraction_anchors_matrix_to_the_figure_not_a_side_label(monkeypatch):
    picture = node(id='n_pic', type='image', text='', source_element_id='p01_s01',
                   x=40.0, y=80.0, width=520.0, height=300.0,
                   base_x=40.0, base_y=80.0, base_width=520.0, base_height=300.0)
    matrix = node(id='n_matrix', type='text', text='[[2.0, 1.0], [1.0, 2.0]]',
                  source_element_id='p01_s02', x=600.0, y=90.0, width=80.0, height=30.0)
    monkeypatch.setattr(presentation, 'read_document', lambda _: document([picture, matrix], reinteraction=True))
    specs = presentation.apply_document_specs('mat', [])
    geometric = [spec for spec in specs if spec.get('kind') == 'geometric' and spec.get('anchor')]
    assert geometric
    anchor = geometric[0]['anchor']['bbox']
    assert anchor['w'] * anchor['h'] > 200 * 12700 * 100 * 12700
