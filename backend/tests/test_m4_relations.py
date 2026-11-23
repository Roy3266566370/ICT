from pathlib import Path
from PIL import Image
import pytest

from app import render
from app.documents import figure_service, layers, presentation, relations, store


def test_validate_page_relations_accepts_valid_macros_and_whitelist_expr():
    nodes = [
        {'id': 'b1', 'type': 'vector'},
        {'id': 'b2', 'type': 'vector'},
        {'id': 'v', 'type': 'vector'},
        {'id': 'g1', 'type': 'vector'},
        {'id': 'g2', 'type': 'vector'},
        {'id': 'lbl', 'type': 'text'},
        {'id': 'txt2', 'type': 'text'},
    ]
    raw = [
        {
            'id': 'rel_basis',
            'kind': 'basis_decompose',
            'firstId': 'b1',
            'secondId': 'b2',
            'resultId': 'v',
            'guideIds': ['g1', 'g2'],
            'labelId': 'lbl',
            'labelTemplate': '斜基：坐标 ({a}, {b})',
        },
        {
            'id': 'rel_expr',
            'kind': 'expr',
            'targetId': 'txt2',
            'targetProperty': 'text',
            'expression': 'round(sqrt(b2.dx ** 2 + b2.dy ** 2))',
            'formatTemplate': '|b2| = {value}',
            'precision': 1,
        },
    ]
    validated = relations.validate_page_relations(raw, nodes)
    assert len(validated) == 2
    assert validated[0]['kind'] == 'basis_decompose'
    assert validated[1]['kind'] == 'expr'


def test_validate_page_relations_rejects_cycles_unknown_functions_and_missing_nodes():
    nodes = [
        {'id': 'v1', 'type': 'vector'},
        {'id': 'v2', 'type': 'vector'},
    ]
    with pytest.raises(ValueError, match='未知函数'):
        relations.validate_page_relations(
            [
                {
                    'id': 'r_bad_fn',
                    'kind': 'expr',
                    'targetId': 'v1',
                    'targetProperty': 'length',
                    'expression': 'eval(v2.length)',
                }
            ],
            nodes,
        )

    with pytest.raises(ValueError, match='不存在的节点'):
        relations.validate_page_relations(
            [
                {
                    'id': 'r_missing',
                    'kind': 'guide_bind',
                    'targetId': 'v1',
                    'from': {'nodeId': 'v2', 'anchor': 'start'},
                    'to': {'nodeId': 'ghost', 'anchor': 'end'},
                }
            ],
            nodes,
        )

    with pytest.raises(ValueError, match='循环依赖'):
        relations.validate_page_relations(
            [
                {
                    'id': 'c1',
                    'kind': 'expr',
                    'targetId': 'v1',
                    'targetProperty': 'length',
                    'expression': 'v2.length + 10',
                },
                {
                    'id': 'c2',
                    'kind': 'expr',
                    'targetId': 'v2',
                    'targetProperty': 'length',
                    'expression': 'v1.length + 10',
                },
            ],
            nodes,
        )


def test_store_patch_persists_fine_viewer_parameters_and_page_relations(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'UPLOAD_DIR', tmp_path / 'uploads')
    monkeypatch.setattr(render, 'RENDERS_DIR', tmp_path / 'renders')
    monkeypatch.setattr(layers, 'working_path', lambda _: tmp_path / 'absent.pptx')
    renders = render.pages_dir('m4_store')
    renders.mkdir(parents=True)
    Image.new('RGB', (160, 90), 'white').save(renders / 's01.png')

    doc = layers.ensure_document('m4_store', 'M4 Store Test')
    assert doc['revision'] == 0

    changes = [
        {
            'page_no': 1,
            'id': 'u_b1',
            'create': {
                'type': 'vector',
                'name': 'b1',
                'x': 20,
                'y': 50,
                'width': 60,
                'height': 16,
                'rotation': 0,
                'viewer_editable': False,
            },
        },
        {
            'page_no': 1,
            'id': 'u_b2',
            'create': {
                'type': 'vector',
                'name': 'b2',
                'x': 20,
                'y': 50,
                'width': 80,
                'height': 16,
                'rotation': -45,
                'viewer_editable': True,
                'viewer_parameters': ['end', 'color', 'line_style', 'stroke_width'],
            },
        },
        {
            'page_no': 1,
            'id': 'u_v',
            'create': {
                'type': 'vector',
                'name': 'v',
                'x': 20,
                'y': 50,
                'width': 120,
                'height': 16,
                'rotation': -25,
                'viewer_editable': False,
            },
        },
        {
            'page_no': 1,
            'id': 'u_lbl',
            'create': {
                'type': 'text',
                'name': '坐标',
                'text': '斜基：坐标 (1, 1)',
                'x': 30,
                'y': 10,
                'width': 140,
                'height': 24,
            },
        },
        {
            'page_no': 1,
            'id': '__page__',
            'relations': [
                {
                    'id': 'rel_1',
                    'kind': 'basis_decompose',
                    'firstId': 'u_b1',
                    'secondId': 'u_b2',
                    'resultId': 'u_v',
                    'labelId': 'u_lbl',
                    'labelTemplate': '斜基：坐标 ({a}, {b})',
                }
            ],
        },
    ]

    updated = store.patch_document('m4_store', 0, 'op_m4_1', changes)
    assert updated['revision'] == 1
    page = updated['pages'][0]
    assert len(page['relations']) == 1
    assert page['relations'][0]['id'] == 'rel_1'
    b2_node = next(n for n in page['nodes'] if n['id'] == 'u_b2')
    assert b2_node['viewer_parameters'] == ['end', 'color', 'line_style', 'stroke_width']

    # Idempotent replay with same operation_id
    replayed = store.patch_document('m4_store', 0, 'op_m4_1', changes)
    assert replayed['revision'] == 1

    # Public snapshot delivery preserves fine viewer_parameters and valid page relations
    pub = presentation.public_document(updated)
    pub_page = pub['pages'][0]
    assert len(pub_page['relations']) == 1
    assert pub_page['relations'][0]['secondId'] == 'u_b2'
    pub_b2 = next(n for n in pub_page['nodes'] if n['id'] == 'u_b2')
    assert pub_b2['viewer_parameters'] == ['end', 'color', 'line_style', 'stroke_width']


def test_vectorize_materializes_basis_decompose_relation_for_oblique_panel(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'UPLOAD_DIR', tmp_path / 'uploads')
    monkeypatch.setattr(render, 'RENDERS_DIR', tmp_path / 'renders')
    monkeypatch.setattr(layers, 'working_path', lambda _: tmp_path / 'absent.pptx')

    fixture_png = Path(__file__).resolve().parents[2] / 'frontend' / 'e2e' / 'fixtures' / 'basis-alternate.png'
    renders = render.pages_dir('m4_basis')
    renders.mkdir(parents=True)
    renders.joinpath('s01.png').write_bytes(fixture_png.read_bytes())

    doc = layers.ensure_document('m4_basis', 'Basis Diagram')
    source = doc['pages'][0]['nodes'][0]
    result = figure_service.vectorize('m4_basis', 1, source['id'], expected_revision=0)

    assert len(result['relations']) == 1
    rel = result['relations'][0]
    assert rel['kind'] == 'basis_decompose'
    assert rel['provenance'] == 'auto'
    assert rel.get('guideIds') and len(rel['guideIds']) >= 1
    assert rel.get('labelId')
    assert rel.get('labelTemplate') == '({a}, {b})'

    nodes_by_id = {n['id']: n for n in result['nodes']}
    second_node = nodes_by_id[rel['secondId']]
    assert second_node['viewer_editable'] is True
    assert second_node['viewer_parameters'] == ['end', 'color', 'line_style', 'stroke_width']

    for nid, node in nodes_by_id.items():
        if nid != rel['secondId']:
            assert node['viewer_editable'] is False
