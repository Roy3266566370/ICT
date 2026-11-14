"""用户确认的空间解析几何输入：向量、直线、平面、曲面及其关系。

输入字段全部为字符串：点/向量写成 a,b,c，平面写成 a,b,c,d，
曲面方程写成 F(x,y,z)=0 或 z=f(x,y)。预览阶段即调用内核校验，
不把缺字段补成默认点或零向量。
"""
from __future__ import annotations

from typing import Any, Mapping

import sympy as sp

from .expr import parse_expression, to_latex
from .space_geometry import (GEOMETRY_LABELS, normalize_plane_field,
                             normalize_vector_field, solve_space_geometry)

X, Y, Z = sp.symbols('x y z', real=True)

VECTOR_FIELDS = {
    'vector_a', 'vector_b', 'vector_c',
    'point_a', 'point_b', 'point_c',
    'point', 'normal', 'line_point', 'line_direction',
    'direction_a', 'direction_b',
}
PLANE_FIELDS = {'plane', 'plane2'}
EQUATION_FIELDS = {'surface', 'expression'}

KIND_FIELDS: dict[str, tuple[str, ...]] = {
    'vector_operations': ('vector_a', 'vector_b'),
    'vector_products': ('vector_a', 'vector_b', 'vector_c'),
    'line_from_points': ('point_a', 'point_b'),
    'line_point_direction': ('line_point', 'line_direction'),
    'plane_point_normal': ('point', 'normal'),
    'plane_three_points': ('point_a', 'point_b', 'point_c'),
    'line_line_relation': ('point_a', 'direction_a', 'point_b', 'direction_b'),
    'line_plane_relation': ('line_point', 'line_direction', 'plane'),
    'plane_plane_relation': ('plane', 'plane2'),
    'point_line_distance': ('point', 'line_point', 'line_direction'),
    'point_plane_distance': ('point', 'plane'),
    'line_plane_projection': ('line_point', 'line_direction', 'plane'),
    'surface_tangent': ('surface', 'point'),
    'quadric_surface': ('expression',),
}

LABELS = {
    'geometry_kind': '空间对象类型',
    'vector_a': '向量 a', 'vector_b': '向量 b', 'vector_c': '向量 c',
    'point_a': '点 A', 'point_b': '点 B', 'point_c': '点 C',
    'point': '点 P', 'normal': '平面法向量',
    'line_point': '直线过点', 'line_direction': '直线方向向量',
    'direction_a': '直线1方向', 'direction_b': '直线2方向',
    'plane': '平面1 (a,b,c,d)', 'plane2': '平面2 (a,b,c,d)',
    'surface': '曲面方程', 'expression': '曲面方程',
}


def _equation_text(raw: Any, label: str) -> str:
    if not isinstance(raw, str) or not raw.strip() or len(raw) > 600:
        raise ValueError(f'{label}必须是600字以内的表达式')
    text = raw.strip()
    parts = text.split('=')
    if len(parts) > 2 or any(not part.strip() for part in parts):
        raise ValueError(f'{label}最多有一个等号，且两边不能为空')
    for part in parts:
        parse_expression(part, ('x', 'y', 'z'), preserve_structure=True)
    return text


def _equation_latex(raw: str) -> str:
    parts = raw.split('=')
    left = parse_expression(parts[0], ('x', 'y', 'z'), preserve_structure=True)
    if len(parts) == 2:
        right = parse_expression(parts[1], ('x', 'y', 'z'), preserve_structure=True)
        return f'{to_latex(left)}={to_latex(right)}'
    return f'{to_latex(left)}=0'


def _vector_latex(text: str) -> str:
    parts = [item for item in text.replace('，', ',').split(',') if item.strip()]
    return r'\left(' + ','.join(to_latex(parse_expression(item)) for item in parts) + r'\right)'


def _plane_latex(text: str) -> str:
    parts = [item for item in text.replace('，', ',').split(',') if item.strip()]
    values = [parse_expression(item) for item in parts]
    expression = sp.simplify(values[0] * X + values[1] * Y + values[2] * Z + values[3])
    return to_latex(sp.Eq(expression, 0))


def _preview_latex(kind: str, c: Mapping[str, str]) -> str:
    if kind == 'vector_operations':
        return rf'\vec a={_vector_latex(c["vector_a"])},\quad \vec b={_vector_latex(c["vector_b"])}'
    if kind == 'vector_products':
        return (rf'\vec a={_vector_latex(c["vector_a"])},\quad \vec b={_vector_latex(c["vector_b"])},'
                rf'\quad \vec c={_vector_latex(c["vector_c"])}')
    if kind == 'line_from_points':
        return rf'A={_vector_latex(c["point_a"])},\quad B={_vector_latex(c["point_b"])}'
    if kind == 'line_point_direction':
        return rf'P={_vector_latex(c["line_point"])},\quad \vec s={_vector_latex(c["line_direction"])}'
    if kind == 'plane_point_normal':
        return rf'P={_vector_latex(c["point"])},\quad \vec n={_vector_latex(c["normal"])}'
    if kind == 'plane_three_points':
        return (rf'A={_vector_latex(c["point_a"])},\quad B={_vector_latex(c["point_b"])},'
                rf'\quad C={_vector_latex(c["point_c"])}')
    if kind == 'line_line_relation':
        return (rf'L_1: P_1={_vector_latex(c["point_a"])},\vec s_1={_vector_latex(c["direction_a"])};'
                rf'\quad L_2: P_2={_vector_latex(c["point_b"])},\vec s_2={_vector_latex(c["direction_b"])}')
    if kind == 'line_plane_relation':
        return (rf'L: P={_vector_latex(c["line_point"])},\vec s={_vector_latex(c["line_direction"])};'
                rf'\quad \pi: {_plane_latex(c["plane"])}')
    if kind == 'plane_plane_relation':
        return rf'\pi_1: {_plane_latex(c["plane"])},\quad \pi_2: {_plane_latex(c["plane2"])}'
    if kind == 'point_line_distance':
        return (rf'P={_vector_latex(c["point"])},\quad L: Q={_vector_latex(c["line_point"])},'
                rf'\vec s={_vector_latex(c["line_direction"])}')
    if kind == 'point_plane_distance':
        return rf'P={_vector_latex(c["point"])},\quad \pi: {_plane_latex(c["plane"])}'
    if kind == 'line_plane_projection':
        return (rf'L: P={_vector_latex(c["line_point"])},\vec s={_vector_latex(c["line_direction"])};'
                rf'\quad \pi: {_plane_latex(c["plane"])}')
    if kind == 'surface_tangent':
        return rf'{_equation_latex(c["surface"])},\quad P={_vector_latex(c["point"])}'
    if kind == 'quadric_surface':
        return _equation_latex(c["expression"])
    raise ValueError('暂不支持该空间几何类型')


def _question(kind: str, c: Mapping[str, str]) -> str:
    if kind == 'vector_operations':
        return f'已知向量 a={c["vector_a"]}、b={c["vector_b"]}，求模、方向余弦、点积、叉积、夹角与投影。'
    if kind == 'vector_products':
        return f'已知三向量 a={c["vector_a"]}、b={c["vector_b"]}、c={c["vector_c"]}，求平行四边形面积、四面体体积并判断共面性。'
    if kind == 'line_from_points':
        return f'求过点 A({c["point_a"]}) 与 B({c["point_b"]}) 的直线方程。'
    if kind == 'line_point_direction':
        return f'求过点 P({c["line_point"]}) 且方向向量为 ({c["line_direction"]}) 的直线方程。'
    if kind == 'plane_point_normal':
        return f'求过点 P({c["point"]}) 且法向量为 ({c["normal"]}) 的平面方程。'
    if kind == 'plane_three_points':
        return f'求过不共线三点 A({c["point_a"]})、B({c["point_b"]})、C({c["point_c"]}) 的平面方程。'
    if kind == 'line_line_relation':
        return (f'判断直线 L1（过点 ({c["point_a"]})、方向 ({c["direction_a"]}）与 '
                f'L2（过点 ({c["point_b"]})、方向 ({c["direction_b"]}）的位置关系，并求夹角、距离或交点。')
    if kind == 'line_plane_relation':
        return (f'判断直线（过点 ({c["line_point"]})、方向 ({c["line_direction"]})）与平面 '
                f'{c["plane"]} 的位置关系，并求夹角、交点或距离。')
    if kind == 'plane_plane_relation':
        return f'判断平面 {c["plane"]} 与 {c["plane2"]} 的位置关系，并求夹角或交线。'
    if kind == 'point_line_distance':
        return f'求点 P({c["point"]}) 到过点 ({c["line_point"]})、方向 ({c["line_direction"]}) 的直线的距离与垂足。'
    if kind == 'point_plane_distance':
        return f'求点 P({c["point"]}) 到平面 {c["plane"]} 的距离与投影点。'
    if kind == 'line_plane_projection':
        return (f'求直线（过点 ({c["line_point"]})、方向 ({c["line_direction"]})）在平面 '
                f'{c["plane"]} 上的投影，并核对夹角。')
    if kind == 'surface_tangent':
        return f'求曲面 {c["surface"]} 在点 P({c["point"]}) 处的切平面与法线。'
    if kind == 'quadric_surface':
        return f'识别二次曲面 {c["expression"]} 的类型并写出标准形。'
    raise ValueError('暂不支持该空间几何类型')


def _kernel_conditions(c: Mapping[str, str]) -> dict[str, Any]:
    result: dict[str, Any] = {'geometry_kind': c['geometry_kind']}
    for key, value in c.items():
        if key == 'geometry_kind':
            continue
        if key in VECTOR_FIELDS or key in PLANE_FIELDS:
            result[key] = [item.strip() for item in value.replace('，', ',').split(',') if item.strip()]
        else:
            result[key] = value
    return result


def parse_inputs(conditions: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(conditions, Mapping):
        raise ValueError('空间几何条件格式不正确')
    kind = str(conditions.get('geometry_kind') or '')
    if kind not in KIND_FIELDS:
        raise ValueError('请选择空间解析几何的具体类型')
    expected = {'geometry_kind', *KIND_FIELDS[kind]}
    missing = [LABELS.get(key, key) for key in expected if key not in conditions or conditions[key] == '']
    if missing:
        raise ValueError('需要补充条件：' + '、'.join(missing))
    extra = set(conditions) - expected
    if extra:
        raise ValueError('存在该类型不能消费的条件：' + ', '.join(sorted(extra)))
    normalized = {'geometry_kind': kind}
    for key in KIND_FIELDS[kind]:
        raw = conditions[key]
        if key in VECTOR_FIELDS:
            normalized[key] = normalize_vector_field(raw, LABELS[key])
        elif key in PLANE_FIELDS:
            normalized[key] = normalize_plane_field(raw, LABELS[key])
        else:
            normalized[key] = _equation_text(raw, LABELS[key])
    solve_space_geometry(_kernel_conditions(normalized))
    return normalized


def preview(conditions: dict[str, Any]) -> dict[str, Any]:
    normalized = parse_inputs(conditions)
    kind = normalized['geometry_kind']
    return {
        'task': 'space_geometry',
        'label': GEOMETRY_LABELS[kind],
        'conditions': normalized,
        'latex': _preview_latex(kind, normalized),
        'question': _question(kind, normalized),
    }


def labels(c: dict[str, Any]) -> dict[str, str]:
    return {key: LABELS.get(key, key) for key in c}


def build_problem(c: dict[str, Any]) -> dict[str, Any]:
    from .exam_math import _condition
    from .space import build_space_problem

    normalized = parse_inputs(c)
    problem = build_space_problem('space_geometry', _kernel_conditions(normalized))
    preview_data = preview(normalized)
    problem['model']['modeling_task'] = 'space_geometry'
    problem['model']['manual_space_conditions'] = normalized
    problem['model']['formula_tex'] = preview_data['latex']
    problem['model']['expression'] = normalized.get('expression') or normalized.get('surface') or ''
    condition_fields = [
        _condition(key, labels(normalized)[key], value, {})
        for key, value in normalized.items()
    ]
    for field in condition_fields:
        if field['id'] == 'geometry_kind':
            field['editable'] = False
    problem['recognition']['conditions'] = condition_fields
    problem['conditions'] = condition_fields
    formula = {'id': 'geometry', 'tex': preview_data['latex'],
               'plain': preview_data['label'], 'role': preview_data['label']}
    problem['recognition']['formulas'] = [formula]
    problem['formulas'] = [formula]
    problem['text'] = preview_data['question']
    problem['title'] = preview_data['label']
    return problem


__all__ = ['KIND_FIELDS', 'LABELS', 'build_problem', 'labels', 'parse_inputs', 'preview']
