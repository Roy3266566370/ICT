"""Dedicated experiment scenes for the remaining sample-page semantics.

Scene choice is based on template type, parameter shape and page text, never
on a fixed material id or page number.  Pages with no native iSpec but an
explicit teaching relationship (matrix addition, eigen decomposition, relation
types) receive a new spec whose source is the page text and which is marked as
an inferred/supplementary condition.
"""
from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

from ..settings import DATA_DIR
from .scene_definitions import SCENE_VERSION

SCENE_TYPES = {
    'vector_family', 'eigen_probe_lab', 'column_combination', 'matrix_addition',
    'eigen_decomposition', 'svd_process', 'shear_compare', 'rank_space',
    'det_area_lab', 'inverse_lab', 'perturbation', 'basis_change_lab',
    'change_of_basis', 'relation_types', 'dual_path_order', 'figure_lab',
    'chart_lab', 'calculation_lab',
}


def load_page_layouts(material_id: str) -> list[dict]:
    path = DATA_DIR / 'ispecs' / f'{material_id}.json'
    if not path.is_file():
        return []
    try:
        payload = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return []
    layouts = payload.get('page_layouts')
    return [item for item in layouts if isinstance(item, dict)] if isinstance(layouts, list) else []


def _first_source(spec: dict) -> dict:
    for parameter in spec.get('parameters', []):
        source = parameter.get('source') if isinstance(parameter, dict) else None
        if isinstance(source, dict):
            return deepcopy(source)
    return {'page': 1, 'status': 'inferred', 'excerpt': ''}


def _has(spec: dict, identifier: str) -> bool:
    return any(parameter.get('id') == identifier for parameter in spec.get('parameters', []))


def _add_number(spec: dict, identifier: str, label: str, value: float, source: dict,
                minimum: float = -1000, maximum: float = 1000, step: float | None = None) -> None:
    if _has(spec, identifier):
        return
    parameter = {'id': identifier, 'label': label, 'type': 'number', 'unit': '',
                 'default': value, 'min': minimum, 'max': maximum, 'source': deepcopy(source)}
    if step is not None:
        parameter['step'] = step
    spec['parameters'].append(parameter)


def _add_enum(spec: dict, identifier: str, label: str, options: list[str], default: str, source: dict) -> None:
    if _has(spec, identifier):
        return
    spec['parameters'].append({'id': identifier, 'label': label, 'type': 'enum', 'unit': '',
                               'default': default, 'options': options, 'source': deepcopy(source)})


def _spec_pairs(spec: dict) -> int:
    ids = {parameter.get('id') for parameter in spec.get('parameters', [])}
    return sum(1 for index in range(1, 9) if f'x{index}' in ids and f'y{index}' in ids)


def _spec_text(spec: dict) -> str:
    pieces = [str(spec.get('title') or ''), str(spec.get('notes') or '')]
    for parameter in spec.get('parameters', []):
        pieces.append(str(parameter.get('source', {}).get('excerpt') or ''))
    return ' '.join(pieces)


def _scene(spec: dict, scene_type: str, title: str | None = None,
           controls: list[str] | None = None, condition_note: str | None = None,
           stages: bool = False) -> None:
    source = _first_source(spec)
    spec['scene'] = {
        'scene_type': scene_type,
        'version': SCENE_VERSION,
        'title': title or spec.get('title') or '交互实验',
        'condition_note': condition_note or spec.get('notes') or '实验条件由当前参数实时计算。',
        'controls': controls or [],
        'stages': [{'id': 'input', 'label': '输入'}, {'id': 'middle', 'label': '中间态'}, {'id': 'final', 'label': '最终'}] if stages else [],
        'supports_overlay': scene_type in ('dual_path_order', 'shear_compare', 'vector_family'),
        'source_status': source.get('status', 'inferred'),
        'source_excerpt': (source.get('excerpt') or '')[:160],
    }


def specialize_scene(spec: dict, page_text: str = '') -> dict:
    """Choose a dedicated scene type from semantics and add its controls."""
    current = spec.get('scene') or {}
    if current.get('scene_type') == 'dual_path_order':
        return spec
    text = f"{_spec_text(spec)} {page_text}"
    views = spec.get('views') if isinstance(spec.get('views'), list) else []
    ref = next((view.get('spec_ref') for view in views
                if isinstance(view, dict) and view.get('type') == 'figure'), None)
    source = _first_source(spec)
    if ref == 'eigen_probe':
        _scene(spec, 'eigen_probe_lab', controls=['a', 'b', 'c', 'd', 'vx', 'vy'],
               condition_note='三种情境可切换；零向量不作为特征向量。')
    elif ref == 'basis_change':
        _scene(spec, 'basis_change_lab', controls=['point_x', 'point_y', 'b2x', 'b2y'],
               condition_note='同一点的物理位置不变；只改变坐标基与读数。')
    elif ref == 'rank_map':
        _add_enum(spec, 'rank_case', '映射案例', ['embed_3x2', 'project_2x3', 'plane_to_line'],
                  'embed_3x2', source)
        _scene(spec, 'rank_space', controls=['rank_case'],
               condition_note='秩由具体映射计算，不用输入值代替。')
    elif ref == 'det_area':
        _add_enum(spec, 'det_case', '面积情境', ['unit', 'scale', 'shear', 'projection'], 'unit', source)
        _scene(spec, 'det_area_lab', controls=['det_case'],
               condition_note='拖动列向量；有向面积与绝对面积同时显示。')
    elif ref == 'inverse_map':
        _scene(spec, 'inverse_lab', controls=['a', 'b', 'c', 'd', 'target_x', 'target_y'],
               condition_note='唯一原像、无解、整条原像线按同一矩阵判断。')
    elif _spec_pairs(spec) >= 3 and ('三条向量' in text or '各去哪' in text):
        _scene(spec, 'vector_family', controls=['a', 'b', 'c', 'd'],
               condition_note='三条原页向量可分别选择；其余向量降低视觉权重。')
    elif ref == 'singular_compare' and '条件数' in page_text:
        _add_number(spec, 'compress_s', '压缩程度', 0.01, source, 0.001, 1, 0.001)
        _add_number(spec, 'perturb_relative', '输出相对扰动', 0.001, source, 0, 0.2, 0.0001)
        _add_number(spec, 'perturb_angle', '扰动方向（度）', 90, source, -180, 180, 1)
        _scene(spec, 'perturbation', controls=['compress_s', 'perturb_relative', 'perturb_angle'],
               condition_note='两组使用相同输出相对扰动；实际放大倍数与条件数上界分开说明。')
    elif ref == 'singular_compare':
        _add_number(spec, 'shear_k', '剪切强度', 1.0, source, -10, 10, 0.01)
        _scene(spec, 'shear_compare', controls=['shear_k'],
               condition_note='首版比较两族剪切矩阵；特征值、奇异值、行列式由矩阵计算。')
    elif ref == 'circle_ellipse' and ('SVD' in text or '奇异值分解' in text):
        _scene(spec, 'svd_process', controls=['a', 'b', 'c', 'd'],
               condition_note='U、Σ、V 由当前矩阵计算；缺方向来源时为补充实验条件。', stages=True)
    elif ref == 'grid_transform' and ('每一列' in text or ('列' in text and '基向量' in text)):
        _add_number(spec, 'input_x', '输入向量 x', 1, source)
        _add_number(spec, 'input_y', '输入向量 y', 1, source)
        _scene(spec, 'column_combination', controls=['a', 'b', 'c', 'd', 'input_x', 'input_y'],
               condition_note='两列分别缩放后首尾相接；公式与高亮同步。')
    elif ref == 'grid_transform' and ('同一个动作' in text or '两个矩阵' in text or '相似' in text):
        for identifier, label, value in (('base_a', 'A · a', 2), ('base_b', 'A · b', 0),
                                         ('base_c', 'A · c', 0), ('base_d', 'A · d', 3),
                                         ('p11', 'P · 11', 0.70710678), ('p12', 'P · 12', 0.70710678),
                                         ('p21', 'P · 21', -0.70710678), ('p22', 'P · 22', 0.70710678),
                                         ('input_x', '固定点 x', 1), ('input_y', '固定点 y', 0.5)):
            _add_number(spec, identifier, label, value, source)
        _scene(spec, 'change_of_basis', controls=['p11', 'p12', 'p21', 'p22', 'input_x', 'input_y'],
               condition_note='A 与实际点固定；只修改新基 P，B=P⁻¹AP 与坐标随动。')
    elif ref == 'grid_transform' and _spec_pairs(spec) >= 3:
        _scene(spec, 'vector_family', controls=['a', 'b', 'c', 'd'],
               condition_note='三条原页向量可分别选择；其余向量降低视觉权重。')
    else:
        return spec
    return spec


def _page_text(layout: dict) -> str:
    return ' '.join(str(element.get('text') or '') for element in layout.get('elements', []))


def _title_element(layout: dict) -> dict | None:
    elements = [element for element in layout.get('elements', [])
                if isinstance(element, dict) and str(element.get('text') or '').strip()]
    if not elements:
        return None
    title = str(layout.get('title') or '').strip()
    exact = next((element for element in elements if str(element.get('text')).strip() == title), None)
    return exact or max(elements, key=lambda element: len(str(element.get('text') or '')))


def _new_spec(layout: dict, object_id: str, title: str, parameters: list[dict],
              views: list[dict], notes: str, scene_type: str, controls: list[str],
              expressions: list[dict] | None = None) -> dict | None:
    element = _title_element(layout)
    if element is None:
        return None
    bbox = element.get('bbox') or {}
    source = {'page': layout['page_no'], 'element_id': element.get('element_id'),
              'bbox': deepcopy(bbox), 'status': 'inferred',
              'excerpt': (str(element.get('text') or title))[:160]}
    for parameter in parameters:
        parameter.setdefault('source', deepcopy(source))
    spec = {
        'spec_version': '1.0', 'object_id': object_id, 'title': title, 'kind': 'geometric',
        'parameters': parameters, 'expressions': expressions or [],
        'views': views, 'constraints': [], 'checks': [], 'notes': notes,
        'anchor': {'page': layout['page_no'], 'element_id': element.get('element_id'), 'bbox': deepcopy(bbox)},
        'generated_by': 'auto',
        'scene': {
            'scene_type': scene_type, 'version': SCENE_VERSION, 'title': title,
            'condition_note': notes, 'controls': controls,
            'stages': [], 'supports_overlay': False,
            'source_status': 'inferred', 'source_excerpt': source['excerpt'],
        },
    }
    from .validator import validate_ispec
    return spec if not validate_ispec(spec) else None


def _parameters(values: list[tuple[str, str, float]], source: dict) -> list[dict]:
    return [{'id': identifier, 'label': label, 'type': 'number', 'unit': '',
             'default': value, 'min': -1000, 'max': 1000, 'source': deepcopy(source)}
            for identifier, label, value in values]


def static_page_specs(material_id: str, layouts: list[dict], existing_ids: set[str]) -> list[dict]:
    result: list[dict] = []
    for layout in layouts:
        page_no = layout.get('page_no')
        if not isinstance(page_no, int):
            continue
        text = _page_text(layout)
        title = str(layout.get('title') or '')
        element = _title_element(layout)
        if element is None:
            continue
        bbox = element.get('bbox') or {}
        source = {'page': page_no, 'element_id': element.get('element_id'), 'bbox': deepcopy(bbox),
                  'status': 'inferred', 'excerpt': (str(element.get('text') or title))[:160]}
        if '再相加' in title or '先各算一遍再相加' in text:
            object_id = f'scene_p{page_no}_matrix_addition'
            if object_id in existing_ids:
                continue
            params = _parameters([
                ('a', 'A · 11', 1), ('b', 'A · 12', 1), ('c', 'A · 21', 0), ('d', 'A · 22', 1),
                ('e', 'B · 11', 0), ('f', 'B · 12', -1), ('g', 'B · 21', 1), ('h', 'B · 22', 0),
                ('vx', '输入 v · x', 1), ('vy', '输入 v · y', 1),
            ], source)
            spec = _new_spec(layout, object_id, '各变各的，再相加', params,
                             [{'type': 'text', 'title': '当前计算', 'template': 'A·v + B·v = {{sumx}}, {{sumy}}'}],
                             'A、B 与输入为补充实验条件；页面只说明“先各算一遍再相加 = 先把矩阵加起来再作用”。',
                             'matrix_addition', ['vx', 'vy'],
                             [{'id': 'sumx', 'expr': '(a+e)*vx+(b+f)*vy'},
                              {'id': 'sumy', 'expr': '(c+g)*vx+(d+h)*vy'}])
            if spec:
                result.append(spec)
        elif '特征分解' in text and '特征方向' in title:
            object_id = f'scene_p{page_no}_eigen_decomposition'
            if object_id in existing_ids:
                continue
            params = _parameters([('a', 'A · 11', 0), ('b', 'A · 12', -1),
                                  ('c', 'A · 21', 1), ('d', 'A · 22', 0)], source)
            spec = _new_spec(layout, object_id, '拿特征方向当新基', params,
                             [{'type': 'text', 'title': '当前判断', 'template': 'det = {{det}}　trace = {{trace}}'}],
                             '默认矩阵取页面“旋转90°”的反例，用于展示不存在完整实特征基；可切换到 SVD。',
                             'eigen_decomposition', ['a', 'b', 'c', 'd'],
                             [{'id': 'det', 'expr': 'a*d-b*c'}, {'id': 'trace', 'expr': 'a+d'}])
            if spec:
                result.append(spec)
        elif '等价' in title and '相似' in title and '合同' in title:
            object_id = f'scene_p{page_no}_relation_types'
            if object_id in existing_ids:
                continue
            source_param = {'id': 'relation_case', 'label': '换基关系', 'type': 'enum', 'unit': '',
                            'default': 'similar', 'options': ['equivalent', 'similar', 'congruent'],
                            'source': deepcopy(source)}
            spec = _new_spec(layout, object_id, '三种换基关系', [source_param],
                             [{'type': 'text', 'title': '当前关系', 'template': 'B = P⁻¹AP'}],
                             '原文只讲相似；等价与合同按页面补充卡建立，均标注为补充实验条件。',
                             'relation_types', ['relation_case'])
            if spec:
                result.append(spec)
    return result


def apply_advanced_scenes(material_id: str, specs: list[dict]) -> list[dict]:
    layouts = load_page_layouts(material_id)
    by_page = {layout.get('page_no'): _page_text(layout) for layout in layouts if isinstance(layout, dict)}
    result = []
    existing_ids = {spec.get('object_id') for spec in specs if isinstance(spec, dict)}
    for spec in specs:
        page_no = spec.get('anchor', {}).get('page')
        if not isinstance(page_no, int):
            page_no = next((parameter.get('source', {}).get('page') for parameter in spec.get('parameters', [])), 1)
        result.append(specialize_scene(spec, by_page.get(page_no, '')))
    result.extend(static_page_specs(material_id, layouts, existing_ids))
    return result
