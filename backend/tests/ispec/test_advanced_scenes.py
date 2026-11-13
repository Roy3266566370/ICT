"""Semantic scene selection and static-page experiment generation."""
from app.documents import presentation
from app.ispec import advanced_scenes
from app.ispec.advanced_scenes import apply_advanced_scenes, specialize_scene, static_page_specs
from app.ispec.validator import validate_ispec


def source(page=9):
    return {'page': page, 'element_id': f'p{page:02d}_s01', 'bbox': {'x': 1, 'y': 2, 'w': 3, 'h': 4},
            'status': 'inferred', 'excerpt': '原页条件'}


def base(identifier, title, view='grid_transform', notes=''):
    return {'spec_version': '1.0', 'object_id': identifier, 'title': title, 'kind': 'geometric',
            'parameters': [
                {'id': 'a', 'label': 'a', 'type': 'number', 'default': 1, 'min': -9, 'max': 9, 'source': source()},
                {'id': 'b', 'label': 'b', 'type': 'number', 'default': 0, 'min': -9, 'max': 9, 'source': source()},
                {'id': 'c', 'label': 'c', 'type': 'number', 'default': 0, 'min': -9, 'max': 9, 'source': source()},
                {'id': 'd', 'label': 'd', 'type': 'number', 'default': 1, 'min': -9, 'max': 9, 'source': source()},
            ], 'expressions': [], 'views': [{'type': 'figure', 'spec_ref': view}], 'notes': notes}


def test_column_and_change_of_basis_are_semantic_not_page_hardcoded():
    column = specialize_scene(base('p9', '矩阵的每一列是一个基向量的去向'), '每一列 基向量')
    assert column['scene']['scene_type'] == 'column_combination'
    assert {'input_x', 'input_y'} <= {parameter['id'] for parameter in column['parameters']}
    changed = specialize_scene(base('p22', '同一个动作，可以有两个矩阵'), '换基 相似 两个矩阵')
    assert changed['scene']['scene_type'] == 'change_of_basis'
    assert {'p11', 'p22', 'input_x'} <= {parameter['id'] for parameter in changed['parameters']}


def test_vector_family_and_condition_vs_shear_disambiguation():
    spec = base('p6', '三条向量，各去哪了', view='circle_ellipse')
    spec['parameters'] += [
        {'id': 'x1', 'label': 'x1', 'type': 'number', 'default': 1, 'source': source(6)},
        {'id': 'y1', 'label': 'y1', 'type': 'number', 'default': 1, 'source': source(6)},
        {'id': 'x2', 'label': 'x2', 'type': 'number', 'default': 1, 'source': source(6)},
        {'id': 'y2', 'label': 'y2', 'type': 'number', 'default': 1, 'source': source(6)},
        {'id': 'x3', 'label': 'x3', 'type': 'number', 'default': 1, 'source': source(6)},
        {'id': 'y3', 'label': 'y3', 'type': 'number', 'default': -1, 'source': source(6)},
    ]
    assert specialize_scene(spec, '三条向量')['scene']['scene_type'] == 'vector_family'
    shear = base('p15', '奇异值对比', view='singular_compare', notes='条件数 = 最长半轴 / 最短半轴')
    assert specialize_scene(shear, '剪切矩阵的两个奇异值')['scene']['scene_type'] == 'shear_compare'
    perturb = base('p21', '条件数', view='singular_compare', notes='条件数约 100')
    assert specialize_scene(perturb, '条件数 压到 1%')['scene']['scene_type'] == 'perturbation'


def test_static_pages_get_new_specs_and_scene_definitions():
    layouts = [
        {'page_no': 11, 'title': '各变各的，再相加', 'elements': [{'element_id': 'p11_s01', 'kind': 'text',
          'bbox': {'x': 1, 'y': 2, 'w': 3, 'h': 4}, 'text': '各变各的，再相加 矩阵加法 先各算一遍再相加'}]},
        {'page_no': 13, 'title': '拿特征方向', 'elements': [{'element_id': 'p13_s01', 'kind': 'text',
          'bbox': {'x': 1, 'y': 2, 'w': 3, 'h': 4}, 'text': '特征分解 拿特征方向 旋转90°'}]},
        {'page_no': 23, 'title': '等价、相似、合同：三种换基不能混', 'elements': [{'element_id': 'p23_s01', 'kind': 'text',
          'bbox': {'x': 1, 'y': 2, 'w': 3, 'h': 4}, 'text': '等价 相似 合同'}]},
    ]
    specs = static_page_specs('mat', layouts, set())
    assert {spec['scene']['scene_type'] for spec in specs} == {'matrix_addition', 'eigen_decomposition', 'relation_types'}
    assert all(validate_ispec(spec) == [] for spec in specs)
    assert all(spec['parameters'][0]['source']['status'] == 'inferred' for spec in specs)


def test_additive_card_on_other_pages_does_not_spawn_scene():
    layouts = [{'page_no': 2, 'title': '一张图看完', 'elements': [{'element_id': 'p02_s01', 'kind': 'text',
      'bbox': {'x': 1, 'y': 2, 'w': 3, 'h': 4}, 'text': '矩阵加法 三层 三个问题'}]}]
    assert static_page_specs('mat', layouts, set()) == []


def test_new_material_without_scene_document_still_gets_static_scenes(monkeypatch):
    layouts = [
        {'page_no': 11, 'title': '各变各的，再相加', 'elements': [{'element_id': 'p11_s01', 'kind': 'text',
          'bbox': {'x': 1, 'y': 2, 'w': 3, 'h': 4}, 'text': '先各算一遍再相加'}]},
        {'page_no': 13, 'title': '拿特征方向', 'elements': [{'element_id': 'p13_s01', 'kind': 'text',
          'bbox': {'x': 1, 'y': 2, 'w': 3, 'h': 4}, 'text': '特征分解 特征方向'}]},
        {'page_no': 23, 'title': '等价、相似、合同', 'elements': [{'element_id': 'p23_s01', 'kind': 'text',
          'bbox': {'x': 1, 'y': 2, 'w': 3, 'h': 4}, 'text': '等价 相似 合同'}]},
    ]
    monkeypatch.setattr(presentation, 'read_document', lambda _: None)
    monkeypatch.setattr(advanced_scenes, 'load_page_layouts', lambda _: layouts)
    result = presentation.apply_document_specs('mat', [])
    assert {spec['scene']['scene_type'] for spec in result} == {
        'matrix_addition', 'eigen_decomposition', 'relation_types'}
