"""空间解析几何：向量、直线、平面、曲面及其关系。

符号计算给出精确结论；空间网格与线段只用于观察，不作为答案。
当前二次曲面识别只接受不含交叉项的多项式方程，其他情形明确拒绝。
"""
from __future__ import annotations

import math
import re
from typing import Any, Mapping

import sympy as sp

from sympy.calculus.util import continuous_domain

from .expr import expression_text, parse_expression, safe_float, to_latex

X, Y, Z = sp.symbols('x y z', real=True)
T, S = sp.symbols('t s', real=True)

GEOMETRY_KINDS = (
    'vector_operations', 'vector_products',
    'line_from_points', 'line_point_direction',
    'plane_point_normal', 'plane_three_points',
    'line_line_relation', 'line_plane_relation', 'plane_plane_relation',
    'point_line_distance', 'point_plane_distance',
    'line_plane_projection', 'surface_tangent', 'quadric_surface',
)
LEGACY_KINDS = {
    'line_plane_intersection': 'line_plane_relation',
    'plane_plane_angle': 'plane_plane_relation',
}
GEOMETRY_LABELS = {
    'vector_operations': '向量运算',
    'vector_products': '向量积与体积',
    'line_from_points': '两点确定直线',
    'line_point_direction': '点向式直线',
    'plane_point_normal': '点法式平面',
    'plane_three_points': '三点确定平面',
    'line_line_relation': '两直线位置关系',
    'line_plane_relation': '直线与平面关系',
    'plane_plane_relation': '两平面位置关系',
    'point_line_distance': '点到直线距离',
    'point_plane_distance': '点到平面距离',
    'line_plane_projection': '直线在平面上的投影',
    'surface_tangent': '曲面切平面与法线',
    'quadric_surface': '二次曲面识别',
}
RELATION_LABELS = {
    'coincident': '重合', 'parallel': '平行', 'intersecting': '相交', 'skew': '异面',
    'in_plane': '直线在平面内',
}


# ---------------------------------------------------------------------------
# 输入解析
# ---------------------------------------------------------------------------

def _constant(raw: Any, label: str) -> sp.Expr:
    if isinstance(raw, bool) or raw is None:
        raise ValueError(f'{label}必须是有限实常数')
    text = str(raw).strip()
    if not text or len(text) > 120:
        raise ValueError(f'{label}必须是有限实常数')
    value = parse_expression(text, ('c0',))
    if value.free_symbols or value.is_real is False or safe_float(value) is None:
        raise ValueError(f'{label}必须是有限实常数')
    return value.xreplace({node: sp.Rational(str(node)) for node in value.atoms(sp.Float)})


def _components(raw: Any) -> list[str]:
    if isinstance(raw, str):
        parts = [item for item in re.split(r'[,，;；\s]+', raw.strip()) if item]
    elif isinstance(raw, (list, tuple)):
        if any(isinstance(item, bool) or not isinstance(item, (str, int, float)) for item in raw):
            raise ValueError('向量或点必须由实常数组成')
        parts = [str(item).strip() for item in raw]
    else:
        raise ValueError('向量或点必须写成 a,b,c 或数组')
    return parts


def _vector(raw: Any, label: str) -> sp.Matrix:
    parts = _components(raw)
    if len(parts) != 3:
        raise ValueError(f'{label}需要三个分量，如 1,2,3')
    return sp.Matrix([_constant(part, f'{label}分量') for part in parts])


def _plane(raw: Any, label: str) -> tuple[sp.Expr, sp.Expr, sp.Expr, sp.Expr]:
    parts = _components(raw)
    if len(parts) != 4:
        raise ValueError(f'{label}需要 [a,b,c,d]，表示 ax+by+cz+d=0')
    values = [_constant(part, f'{label}系数') for part in parts]
    if _is_zero(values[0]) and _is_zero(values[1]) and _is_zero(values[2]):
        raise ValueError(f'{label}的法向量不能为零向量')
    return values[0], values[1], values[2], values[3]


def _equation(raw: Any, variables: tuple[str, ...], label: str, preserve: bool = False) -> sp.Expr:
    if not isinstance(raw, str) or not raw.strip() or len(raw) > 600:
        raise ValueError(f'{label}必须是600字以内的表达式')
    parts = raw.split('=')
    if len(parts) > 2 or any(not part.strip() for part in parts):
        raise ValueError(f'{label}最多有一个等号，且两边不能为空')
    left = parse_expression(parts[0], variables, preserve_structure=True)
    if len(parts) == 2:
        right = parse_expression(parts[1], variables, preserve_structure=True)
        difference = left - right
        return difference if preserve else sp.simplify(difference)
    return left


def _raw_equation_defined_at(raw: Any, point: sp.Matrix) -> bool:
    if not isinstance(raw, str) or not raw.strip() or len(raw) > 600:
        return False
    parts = raw.split('=')
    if len(parts) > 2 or any(not part.strip() for part in parts):
        return False
    for part in parts:
        try:
            expression = parse_expression(part, ('x', 'y', 'z'), preserve_structure=True)
        except Exception:  # noqa: BLE001
            return False
        if not _defined_at_point(expression, point):
            return False
    return True


def _defined_at_point(expression: sp.Expr, point: sp.Matrix) -> bool:
    for symbol, value in zip((X, Y, Z), point):
        if symbol not in expression.free_symbols:
            continue
        try:
            domain = continuous_domain(expression, symbol, sp.Interval(value, value))
        except Exception:  # noqa: BLE001
            return False
        if sp.Interval(value, value).is_subset(domain) is not True:
            return False
    return True


def _is_zero(value: Any) -> bool:
    return sp.simplify(value) == 0


def _norm(vector: sp.Matrix) -> sp.Expr:
    return sp.sqrt(sp.simplify((vector.T * vector)[0]))


def _nonzero(vector: sp.Matrix, label: str) -> sp.Matrix:
    if _is_zero(_norm(vector)):
        raise ValueError(f'{label}不能为零向量')
    return vector


def _text(value: Any) -> str:
    return expression_text(sp.simplify(value))


def _vec_text(vector: Any) -> str:
    return '(' + ', '.join(_text(item) for item in vector) + ')'


def _vec_latex(vector: Any) -> str:
    return r'\left(' + ','.join(to_latex(sp.simplify(item)) for item in vector) + r'\right)'


def normalize_vector_field(raw: Any, label: str, size: int = 3) -> str:
    parts = _components(raw)
    if len(parts) != size:
        raise ValueError(f'{label}需要{size}个分量')
    return ', '.join(_text(_constant(part, f'{label}分量')) for part in parts)


def normalize_plane_field(raw: Any, label: str) -> str:
    parts = _components(raw)
    if len(parts) != 4:
        raise ValueError(f'{label}需要4个系数，如 1,2,3,-4')
    values = [_constant(part, f'{label}系数') for part in parts]
    if all(_is_zero(value) for value in values[:3]):
        raise ValueError(f'{label}的法向量不能为零向量')
    return ', '.join(_text(value) for value in values)


def _point_dict(vector: Any) -> dict | None:
    values = [safe_float(item) for item in vector]
    if any(value is None for value in values):
        return None
    return {'x': values[0], 'y': values[1], 'z': values[2]}


def _segment(start: Any, end: Any) -> list[dict] | None:
    left, right = _point_dict(start), _point_dict(end)
    return [left, right] if left and right else None


def _line_segment(point: sp.Matrix, direction: sp.Matrix, half: float = 2.0) -> list[dict] | None:
    direction_values = [safe_float(item) for item in direction]
    point_values = [safe_float(item) for item in point]
    if any(value is None for value in direction_values + point_values):
        return None
    length = math.sqrt(sum(value * value for value in direction_values))
    if length == 0:
        return None
    unit = [value / length for value in direction_values]
    return [
        {'x': point_values[0] - half * unit[0],
         'y': point_values[1] - half * unit[1],
         'z': point_values[2] - half * unit[2]},
        {'x': point_values[0] + half * unit[0],
         'y': point_values[1] + half * unit[1],
         'z': point_values[2] + half * unit[2]},
    ]


# ---------------------------------------------------------------------------
# 方程与关系
# ---------------------------------------------------------------------------

def _line_forms(point: sp.Matrix, direction: sp.Matrix) -> dict[str, str]:
    point = sp.Matrix([sp.simplify(item) for item in point])
    direction = sp.Matrix([sp.simplify(item) for item in direction])
    names = ('x', 'y', 'z')
    parameters = [f'{name}={to_latex(sp.simplify(point[index] + direction[index] * T))}'
                  for index, name in enumerate(names)]
    parametric = r'\begin{cases}' + r'\\'.join(parameters) + r'\end{cases}'
    parametric_plain = '; '.join(
        f'{name} = {_text(sp.simplify(point[index] + direction[index] * T))}'
        for index, name in enumerate(names))
    ratios, fixed = [], []
    ratios_plain, fixed_plain = [], []
    for index, name in enumerate(names):
        if _is_zero(direction[index]):
            fixed.append(f'{name}={to_latex(point[index])}')
            fixed_plain.append(f'{name} = {_text(point[index])}')
            continue
        symbol = sp.Symbol(name, real=True)
        numerator = sp.simplify(symbol - point[index])
        denominator = sp.simplify(direction[index])
        if denominator == 1:
            ratios.append(to_latex(numerator))
        elif denominator == -1:
            ratios.append(to_latex(-numerator))
        else:
            ratios.append(rf'\frac{{{to_latex(numerator)}}}{{{to_latex(denominator)}}}')
        numerator_text = _text(numerator)
        denominator_text = _text(denominator)
        if denominator_text == '1':
            ratios_plain.append(numerator_text)
        elif denominator_text == '-1':
            ratios_plain.append(f'-({numerator_text})')
        else:
            ratios_plain.append(f'({numerator_text})/({denominator_text})')
    if len(ratios) >= 2:
        symmetric = '='.join(ratios) + (r',\quad ' + r',\quad '.join(fixed) if fixed else '')
        symmetric_plain = ' = '.join(ratios_plain) + (', ' + ', '.join(fixed_plain) if fixed_plain else '')
    else:
        symmetric = r',\quad '.join(fixed) if fixed else '=0'
        symmetric_plain = ', '.join(fixed_plain) if fixed_plain else '=0'
    return {'parametric': parametric, 'symmetric': symmetric,
            'parametric_plain': parametric_plain, 'symmetric_plain': symmetric_plain}


def _normalized_plane(coeffs: list[sp.Expr]) -> tuple[list[sp.Expr], str, str]:
    values = [sp.simplify(item) for item in coeffs]
    if all(value.is_rational for value in values):
        denominator = 1
        for value in values:
            denominator = sp.ilcm(denominator, sp.denom(value))
        numbers = [sp.numer(sp.simplify(value * denominator)) for value in values]
        common = 0
        for number in numbers:
            common = math.gcd(common, abs(int(number)))
        common = common or 1
        values = [sp.Integer(int(number) // common) for number in numbers]
        first = next((value for value in values if value != 0), sp.Integer(0))
        if first < 0:
            values = [-value for value in values]
    expression = sp.simplify(values[0] * X + values[1] * Y + values[2] * Z + values[3])
    equation = sp.Eq(expression, 0)
    return values, to_latex(equation), f'{expression_text(expression)} = 0'


def _plane_latex(plane: list[sp.Expr]) -> str:
    return _normalized_plane(plane)[1]


def _plane_grid(point: sp.Matrix, normal: sp.Matrix, half: float = 2.0, steps: int = 16) -> list[list[dict]] | None:
    point_values = [safe_float(item) for item in point]
    normal_values = [safe_float(item) for item in normal]
    if any(value is None for value in point_values + normal_values):
        return None
    length = math.sqrt(sum(value * value for value in normal_values))
    if length == 0:
        return None
    unit = [value / length for value in normal_values]
    base = [1.0, 0.0, 0.0] if abs(unit[0]) < 0.9 else [0.0, 1.0, 0.0]
    u = [unit[1] * base[2] - unit[2] * base[1], unit[2] * base[0] - unit[0] * base[2],
         unit[0] * base[1] - unit[1] * base[0]]
    u_length = math.sqrt(sum(value * value for value in u)) or 1.0
    u = [value / u_length for value in u]
    v = [unit[1] * u[2] - unit[2] * u[1], unit[2] * u[0] - unit[0] * u[2],
         unit[0] * u[1] - unit[1] * u[0]]
    grid = []
    for row in range(steps + 1):
        a = -half + 2 * half * row / steps
        grid.append([
            {'x': point_values[0] + a * u[0] + b * v[0],
             'y': point_values[1] + a * u[1] + b * v[1],
             'z': point_values[2] + a * u[2] + b * v[2]}
            for b in (-half + 2 * half * column / steps for column in range(steps + 1))
        ])
    return grid


def _plane_boundary(point: sp.Matrix, normal: sp.Matrix, half: float = 2.0) -> list[dict] | None:
    grid = _plane_grid(point, normal, half=half, steps=2)
    if not grid:
        return None
    corners = [grid[0][0], grid[0][-1], grid[-1][-1], grid[-1][0], grid[0][0]]
    return corners


def _point_on_plane(plane: list[sp.Expr]) -> sp.Matrix:
    normal = sp.Matrix(plane[:3])
    return sp.Matrix([sp.simplify(-plane[3] * item / (normal.T * normal)[0]) for item in normal])


def _acute_angle(first: sp.Matrix, second: sp.Matrix) -> sp.Expr:
    denominator = _norm(first) * _norm(second)
    cosine = sp.simplify(abs((first.T * second)[0]) / denominator)
    return sp.acos(sp.simplify(cosine))


def _result(*, kind: str, title: str, answer: str, exact: Any = None, latex: str = '',
            facts: list[dict] | None = None, details: dict | None = None,
            steps: list[dict] | None = None, space: dict | None = None,
            limitations: list[str] | None = None, conditions: list[str] | None = None) -> dict:
    facts = facts or []
    limitations = limitations or []
    payload = details or {}
    payload.setdefault('kind', kind)
    payload.setdefault('label', title)
    payload['facts'] = facts
    payload.setdefault('notes', limitations)
    if space is None:
        space = {'kind': 'geometry', 'points': []}
    string_exact = None if exact is None else (expression_text(exact) if isinstance(exact, sp.Expr) else str(exact))
    return {
        'summary': f'空间解析几何：{title}。',
        'answer': answer,
        'answer_value': safe_float(exact) if exact is not None else None,
        'exact': string_exact,
        'exact_latex': latex,
        'steps': steps or [],
        'conditions': conditions or [],
        'limitations': limitations,
        'space_details': payload,
        'space_result': {'space': space, 'exact': string_exact, 'answer_text': answer},
        'space': space,
        'solution_status': 'complete',
        'solution_complete': True,
    }


# ---------------------------------------------------------------------------
# 向量
# ---------------------------------------------------------------------------

def _vector_operations(conditions: Mapping[str, Any]) -> dict:
    a = _nonzero(_vector(conditions.get('vector_a'), '向量 a'), '向量 a')
    b = _nonzero(_vector(conditions.get('vector_b'), '向量 b'), '向量 b')
    norm_a, norm_b = sp.simplify(_norm(a)), sp.simplify(_norm(b))
    dot = sp.simplify((a.T * b)[0])
    cross = sp.Matrix([sp.simplify(item) for item in a.cross(b)])
    cosine = sp.simplify(dot / (norm_a * norm_b))
    angle = sp.acos(sp.simplify(cosine))
    scalar_projection = sp.simplify(dot / norm_b)
    vector_projection = sp.Matrix([sp.simplify(item) for item in dot / (b.T * b)[0] * b])
    direction_cosines = [sp.simplify(item / norm_a) for item in a]
    answer = f'a·b={_text(dot)}，a×b={_vec_text(cross)}，夹角 θ={_text(angle)}'
    facts = [
        {'label': '|a|', 'latex': to_latex(norm_a)},
        {'label': '|b|', 'latex': to_latex(norm_b)},
        {'label': 'a·b', 'latex': to_latex(dot)},
        {'label': 'a×b', 'latex': _vec_latex(cross)},
        {'label': '夹角 θ', 'latex': to_latex(angle)},
        {'label': 'a 在 b 上的数量投影', 'latex': to_latex(scalar_projection)},
        {'label': 'a 在 b 上的向量投影', 'latex': _vec_latex(vector_projection)},
        {'label': 'a 的方向余弦', 'latex': r'\left(' + ','.join(to_latex(item) for item in direction_cosines) + r'\right)'},
    ]
    details = {
        'relation': None,
        'angle': _text(angle),
        'distance': None,
        'intersection': None,
        'equations': [],
    }
    return _result(
        kind='vector_operations', title='向量运算', answer=answer, exact=angle,
        latex=rf'\vec{{a}}\cdot\vec{{b}}={to_latex(dot)},\quad \vec{{a}}\times\vec{{b}}={_vec_latex(cross)},\quad \theta={to_latex(angle)}',
        facts=facts, details=details,
        steps=[
            {'id': 'norms', 'title': '计算模长', 'detail': f'|a|={_text(norm_a)}，|b|={_text(norm_b)}。'},
            {'id': 'dot_cross', 'title': '计算点积与叉积', 'detail': f'a·b={_text(dot)}；a×b={_vec_text(cross)}。'},
            {'id': 'angle', 'title': '由余弦公式求夹角', 'detail': f'cosθ=(a·b)/(|a||b|)，θ={_text(angle)}。'},
        ],
        space={'kind': 'geometry', 'points': [
            {'id': 'A', **_point_dict(a)}, {'id': 'B', **_point_dict(b)}, {'id': 'O', 'x': 0, 'y': 0, 'z': 0},
        ], 'edges': [edge for edge in (_segment(sp.zeros(3, 1), a), _segment(sp.zeros(3, 1), b)) if edge]},
    )


def _vector_products(conditions: Mapping[str, Any]) -> dict:
    a = _nonzero(_vector(conditions.get('vector_a'), '向量 a'), '向量 a')
    b = _nonzero(_vector(conditions.get('vector_b'), '向量 b'), '向量 b')
    c = _nonzero(_vector(conditions.get('vector_c'), '向量 c'), '向量 c')
    cross = sp.Matrix([sp.simplify(item) for item in a.cross(b)])
    area = sp.simplify(_norm(cross))
    triangle = sp.simplify(area / 2)
    mixed = sp.simplify((cross.T * c)[0])
    volume = sp.simplify(abs(mixed))
    tetrahedron = sp.simplify(volume / 6)
    coplanar = _is_zero(mixed)
    answer = f'平行四边形面积 {_text(area)}，四面体体积 {_text(tetrahedron)}，' + ('三向量共面' if coplanar else '三向量不共面')
    facts = [
        {'label': 'a×b', 'latex': _vec_latex(cross)},
        {'label': '平行四边形面积 |a×b|', 'latex': to_latex(area)},
        {'label': '三角形面积', 'latex': to_latex(triangle)},
        {'label': '混合积 (a×b)·c', 'latex': to_latex(mixed)},
        {'label': '平行六面体体积', 'latex': to_latex(volume)},
        {'label': '四面体体积', 'latex': to_latex(tetrahedron)},
    ]
    details = {
        'relation': '三向量共面' if coplanar else '三向量不共面',
        'angle': None, 'distance': None, 'intersection': None, 'equations': [],
    }
    return _result(
        kind='vector_products', title='向量积与体积', answer=answer, exact=area,
        latex=rf'S={to_latex(area)},\quad V_{{\text{{四面体}}}}={to_latex(tetrahedron)}',
        facts=facts, details=details,
        steps=[
            {'id': 'cross', 'title': '计算叉积', 'detail': f'a×b={_vec_text(cross)}，其模是平行四边形面积。'},
            {'id': 'mixed', 'title': '计算混合积', 'detail': f'(a×b)·c={_text(mixed)}，绝对值是平行六面体体积。'},
            {'id': 'conclusion', 'title': '判断共面', 'detail': '混合积为零时三向量共面。'},
        ],
        space={'kind': 'geometry', 'points': [
            {'id': 'A', **_point_dict(a)}, {'id': 'B', **_point_dict(b)}, {'id': 'C', **_point_dict(c)},
            {'id': 'O', 'x': 0, 'y': 0, 'z': 0},
        ], 'edges': [edge for edge in (
            _segment(sp.zeros(3, 1), a), _segment(sp.zeros(3, 1), b), _segment(sp.zeros(3, 1), c)) if edge]},
    )


# ---------------------------------------------------------------------------
# 直线与平面
# ---------------------------------------------------------------------------

def _line_from_points(conditions: Mapping[str, Any]) -> dict:
    first = _vector(conditions.get('point_a'), '点 A')
    second = _vector(conditions.get('point_b'), '点 B')
    direction = _nonzero(sp.Matrix([sp.simplify(item) for item in second - first]), '直线方向 A→B')
    forms = _line_forms(first, direction)
    answer = f'方向向量 {_vec_text(direction)}，对称式 {forms["symmetric_plain"]}'
    facts = [
        {'label': '直线过点', 'latex': _vec_latex(first)},
        {'label': '方向向量', 'latex': _vec_latex(direction)},
        {'label': '参数方程', 'latex': forms['parametric']},
        {'label': '对称式', 'latex': forms['symmetric']},
    ]
    details = {'relation': None, 'angle': None, 'distance': None, 'intersection': None,
               'equations': [{'label': '参数方程', 'latex': forms['parametric']},
                             {'label': '对称式', 'latex': forms['symmetric']}]}
    return _result(
        kind='line_from_points', title='两点确定直线', answer=answer, latex=forms['symmetric'],
        facts=facts, details=details,
        steps=[{'id': 'direction', 'title': '求方向向量', 'detail': f's=B-A={_vec_text(direction)}。'},
               {'id': 'equation', 'title': '写出方程', 'detail': '由点向式得到参数方程与对称式；方向分量为零时单独写成等式。'}],
        space={'kind': 'geometry', 'points': [{'id': 'A', **_point_dict(first)}, {'id': 'B', **_point_dict(second)}],
               'line': _line_segment(first, direction)},
    )


def _line_point_direction(conditions: Mapping[str, Any]) -> dict:
    point = _vector(conditions.get('line_point'), '直线过点')
    direction = _nonzero(_vector(conditions.get('line_direction'), '直线方向向量'), '直线方向向量')
    forms = _line_forms(point, direction)
    answer = f'方向向量 {_vec_text(direction)}，对称式 {forms["symmetric_plain"]}'
    facts = [
        {'label': '直线过点', 'latex': _vec_latex(point)},
        {'label': '方向向量', 'latex': _vec_latex(direction)},
        {'label': '参数方程', 'latex': forms['parametric']},
        {'label': '对称式', 'latex': forms['symmetric']},
    ]
    details = {'relation': None, 'angle': None, 'distance': None, 'intersection': None,
               'equations': [{'label': '参数方程', 'latex': forms['parametric']},
                             {'label': '对称式', 'latex': forms['symmetric']}]}
    return _result(
        kind='line_point_direction', title='点向式直线', answer=answer, latex=forms['symmetric'],
        facts=facts, details=details,
        steps=[{'id': 'point', 'title': '确认点与方向', 'detail': f'P={_vec_text(point)}，s={_vec_text(direction)}。'},
               {'id': 'equation', 'title': '写出方程', 'detail': '由点向式得到参数方程与对称式。'}],
        space={'kind': 'geometry', 'points': [{'id': 'P', **_point_dict(point)}],
               'line': _line_segment(point, direction)},
    )


def _plane_point_normal(conditions: Mapping[str, Any]) -> dict:
    point = _vector(conditions.get('point'), '平面过点')
    normal = _nonzero(_vector(conditions.get('normal'), '平面法向量'), '平面法向量')
    coefficients, latex, plain = _normalized_plane([normal[0], normal[1], normal[2],
                                             -sp.simplify((normal.T * point)[0])])
    answer = f'平面方程 {plain}'
    facts = [
        {'label': '平面过点', 'latex': _vec_latex(point)},
        {'label': '法向量', 'latex': _vec_latex(normal)},
        {'label': '平面方程', 'latex': latex},
    ]
    details = {'relation': None, 'angle': None, 'distance': None, 'intersection': None,
               'equations': [{'label': '平面方程', 'latex': latex}],
               'normal': _vec_text(normal)}
    return _result(
        kind='plane_point_normal', title='点法式平面', answer=answer, latex=latex,
        facts=facts, details=details,
        steps=[{'id': 'normal', 'title': '确认法向量', 'detail': f'n={_vec_text(normal)}。'},
               {'id': 'equation', 'title': '写出点法式', 'detail': 'n·(r-P)=0，展开得到一般式。'}],
        space={'kind': 'geometry', 'points': [{'id': 'P', **_point_dict(point)}],
               'grid': _plane_grid(point, normal)},
    )


def _plane_three_points(conditions: Mapping[str, Any]) -> dict:
    first = _vector(conditions.get('point_a'), '点 A')
    second = _vector(conditions.get('point_b'), '点 B')
    third = _vector(conditions.get('point_c'), '点 C')
    normal = sp.Matrix([sp.simplify(item) for item in (second - first).cross(third - first)])
    if _is_zero(_norm(normal)):
        raise ValueError('三点共线，不能唯一确定一张平面')
    coefficients, latex, plain = _normalized_plane([normal[0], normal[1], normal[2],
                                             -sp.simplify((normal.T * first)[0])])
    answer = f'平面方程 {plain}'
    facts = [
        {'label': '点 A、B、C', 'latex': _vec_latex(first) + ',' + _vec_latex(second) + ',' + _vec_latex(third)},
        {'label': '法向量 (B-A)×(C-A)', 'latex': _vec_latex(normal)},
        {'label': '平面方程', 'latex': latex},
    ]
    details = {'relation': None, 'angle': None, 'distance': None, 'intersection': None,
               'equations': [{'label': '平面方程', 'latex': latex}], 'normal': _vec_text(normal)}
    return _result(
        kind='plane_three_points', title='三点确定平面', answer=answer, latex=latex,
        facts=facts, details=details,
        steps=[{'id': 'normal', 'title': '由三点求法向量', 'detail': f'n=(B-A)×(C-A)={_vec_text(normal)}。'},
               {'id': 'equation', 'title': '写出平面方程', 'detail': 'n·(r-A)=0，展开得到一般式。'}],
        space={'kind': 'geometry', 'points': [{'id': 'A', **_point_dict(first)},
                                              {'id': 'B', **_point_dict(second)},
                                              {'id': 'C', **_point_dict(third)}],
               'grid': _plane_grid(first, normal)},
    )


# ---------------------------------------------------------------------------
# 位置关系
# ---------------------------------------------------------------------------

def _line_line_relation(conditions: Mapping[str, Any]) -> dict:
    first_point = _vector(conditions.get('point_a'), '直线1过点')
    first_direction = _nonzero(_vector(conditions.get('direction_a'), '直线1方向'), '直线1方向')
    second_point = _vector(conditions.get('point_b'), '直线2过点')
    second_direction = _nonzero(_vector(conditions.get('direction_b'), '直线2方向'), '直线2方向')
    offset = sp.Matrix([sp.simplify(item) for item in second_point - first_point])
    cross = sp.Matrix([sp.simplify(item) for item in first_direction.cross(second_direction)])
    angle = _acute_angle(first_direction, second_direction)
    intersection = None
    distance = None
    equations = []
    if _is_zero(_norm(cross)):
        relation = 'coincident' if _is_zero(_norm(offset.cross(first_direction))) else 'parallel'
        if relation == 'parallel':
            distance = sp.simplify(_norm(offset.cross(first_direction)) / _norm(first_direction))
        answer = (f'两直线{RELATION_LABELS[relation]}' +
                  (f'，距离 {_text(distance)}' if distance is not None else ''))
        space_points = []
    else:
        mixed = sp.simplify((offset.T * cross)[0])
        if _is_zero(mixed):
            relation = 'intersecting'
            solution = sp.linsolve([
                first_point[index] + S * first_direction[index] - second_point[index] - T * second_direction[index]
                for index in range(3)], (S, T))
            values = next(iter(solution), None)
            if values is not None:
                hit = sp.Matrix([sp.simplify(first_point[index] + values[0] * first_direction[index])
                                 for index in range(3)])
                intersection = _vec_text(hit)
                space_points = [{'id': '交点', **_point_dict(hit)}]
            else:
                space_points = []
            distance = sp.Integer(0)
            answer = f'两直线相交，交点 {intersection}，夹角 {_text(angle)}'
        else:
            relation = 'skew'
            distance = sp.simplify(abs(mixed) / _norm(cross))
            answer = f'两直线异面，距离 {_text(distance)}，夹角 {_text(angle)}'
            space_points = []
    facts = [
        {'label': '直线1方向', 'latex': _vec_latex(first_direction)},
        {'label': '直线2方向', 'latex': _vec_latex(second_direction)},
        {'label': '位置关系', 'text': RELATION_LABELS[relation]},
        {'label': '夹角 θ', 'latex': to_latex(angle)},
        {'label': '距离 d', 'latex': to_latex(distance) if distance is not None else '0'},
        {'label': '交点', 'latex': f'({intersection})' if intersection else r'\varnothing'},
    ]
    details = {'relation': RELATION_LABELS[relation], 'angle': _text(angle),
               'distance': _text(distance) if distance is not None else '0',
               'intersection': intersection, 'equations': equations}
    return _result(
        kind='line_line_relation', title='两直线位置关系', answer=answer,
        exact=angle, latex=rf'\theta={to_latex(angle)}',
        facts=facts, details=details,
        steps=[
            {'id': 'directions', 'title': '比较方向向量', 'detail': 'd₁×d₂=0 时两直线平行或重合，否则在相交与异面中判断。'},
            {'id': 'coplanar', 'title': '检验共面', 'detail': f'(P₂-P₁)·(d₁×d₂)={_text((offset.T * cross)[0]) if not _is_zero(_norm(cross)) else "0"}。'},
            {'id': 'conclusion', 'title': '给出关系与数量', 'detail': answer},
        ],
        space={'kind': 'geometry', 'points': space_points,
               'edges': [edge for edge in (_line_segment(first_point, first_direction),
                                           _line_segment(second_point, second_direction)) if edge]},
    )


def _line_plane_relation(conditions: Mapping[str, Any]) -> dict:
    point = _vector(conditions.get('line_point'), '直线过点')
    direction = _nonzero(_vector(conditions.get('line_direction'), '直线方向'), '直线方向')
    a, b, c, d = _plane(conditions.get('plane'), '平面')
    normal = sp.Matrix([a, b, c])
    denominator = sp.simplify((normal.T * direction)[0])
    signed = sp.simplify((normal.T * point)[0] + d)
    if _is_zero(denominator):
        if _is_zero(signed):
            relation = 'in_plane'
            distance = sp.Integer(0)
            intersection = None
            answer = '直线在平面内'
        else:
            relation = 'parallel'
            distance = sp.simplify(abs(signed) / _norm(normal))
            intersection = None
            answer = f'直线与平面平行，距离 {_text(distance)}'
        angle = sp.Integer(0)
        space_points = []
    else:
        relation = 'intersecting'
        parameter = sp.simplify(-signed / denominator)
        hit = sp.Matrix([sp.simplify(point[index] + parameter * direction[index]) for index in range(3)])
        intersection = _vec_text(hit)
        distance = sp.Integer(0)
        angle = sp.asin(sp.simplify(abs(denominator) / (_norm(normal) * _norm(direction))))
        answer = f'直线与平面相交，交点 {intersection}，夹角 {_text(angle)}'
        space_points = [{'id': '交点', **_point_dict(hit)}]
    plane_latex = _plane_latex([a, b, c, d])
    facts = [
        {'label': '直线方向', 'latex': _vec_latex(direction)},
        {'label': '平面方程', 'latex': plane_latex},
        {'label': '位置关系', 'text': RELATION_LABELS[relation]},
        {'label': '夹角 θ', 'latex': to_latex(angle)},
        {'label': '交点', 'latex': f'({intersection})' if intersection else r'\varnothing'},
        {'label': '距离 d', 'latex': to_latex(distance)},
    ]
    details = {'relation': RELATION_LABELS[relation], 'angle': _text(angle),
               'distance': _text(distance), 'intersection': intersection, 'equations': []}
    return _result(
        kind='line_plane_relation', title='直线与平面关系', answer=answer, exact=angle,
        latex=rf'\theta={to_latex(angle)}', facts=facts, details=details,
        steps=[
            {'id': 'normal_projection', 'title': '计算方向与法向量的点积', 'detail': f'n·s={_text(denominator)}；n·P+d={_text(signed)}。'},
            {'id': 'conclusion', 'title': '判定关系', 'detail': answer},
        ],
        space={'kind': 'geometry', 'points': space_points,
               'line': _line_segment(point, direction),
               'grid': _plane_grid(_point_on_plane([a, b, c, d]), normal)},
    )


def _plane_plane_relation(conditions: Mapping[str, Any]) -> dict:
    first = _plane(conditions.get('plane'), '平面1')
    second = _plane(conditions.get('plane2'), '平面2')
    first_normal = sp.Matrix(first[:3])
    second_normal = sp.Matrix(second[:3])
    cross = sp.Matrix([sp.simplify(item) for item in first_normal.cross(second_normal)])
    first_latex = _plane_latex(list(first))
    second_latex = _plane_latex(list(second))
    if _is_zero(_norm(cross)):
        factor = None
        for index in range(3):
            if not _is_zero(first_normal[index]):
                factor = sp.simplify(second_normal[index] / first_normal[index])
                break
        coincident = factor is not None and _is_zero(second[3] - factor * first[3])
        relation = 'coincident' if coincident else 'parallel'
        angle = sp.Integer(0)
        intersection = None
        if coincident:
            distance = sp.Integer(0)
            answer = '两平面重合'
        else:
            second_point = _point_on_plane(list(second))
            distance = sp.simplify(abs((first_normal.T * second_point)[0] + first[3]) / _norm(first_normal))
            answer = f'两平面平行，距离 {_text(distance)}'
        space_patches = [patch for patch in (
            _plane_boundary(_point_on_plane(list(first)), first_normal),
            _plane_boundary(_point_on_plane(list(second)), second_normal)) if patch]
        return _result(
            kind='plane_plane_relation', title='两平面位置关系', answer=answer,
            exact=angle, latex=rf'\theta={to_latex(angle)}',
            facts=[{'label': '平面1', 'latex': first_latex}, {'label': '平面2', 'latex': second_latex},
                   {'label': '位置关系', 'text': RELATION_LABELS[relation]},
                   {'label': '距离 d', 'latex': to_latex(distance)}],
            details={'relation': RELATION_LABELS[relation], 'angle': '0', 'distance': _text(distance),
                     'intersection': None, 'equations': []},
            steps=[{'id': 'normals', 'title': '比较法向量', 'detail': '法向量平行时两平面平行或重合。'},
                   {'id': 'conclusion', 'title': '给出距离', 'detail': answer}],
            space={'kind': 'geometry', 'edges': space_patches,
                   'grid': _plane_grid(_point_on_plane(list(first)), first_normal)},
        )
    angle = _acute_angle(first_normal, second_normal)
    direction = cross
    axis = max(range(3), key=lambda index: abs(safe_float(direction[index]) or 0.0))
    free = [index for index in range(3) if index != axis]
    matrix = sp.Matrix([[first_normal[free[0]], first_normal[free[1]]],
                        [second_normal[free[0]], second_normal[free[1]]]])
    solutions = matrix.solve(sp.Matrix([-first[3], -second[3]]))
    point = [sp.Integer(0), sp.Integer(0), sp.Integer(0)]
    point[free[0]] = sp.simplify(solutions[0])
    point[free[1]] = sp.simplify(solutions[1])
    point = sp.Matrix(point)
    forms = _line_forms(point, direction)
    intersection = f'{_vec_text(point)} + t·{_vec_text(direction)}'
    answer = f'两平面相交，夹角 {_text(angle)}，交线 {forms["symmetric_plain"]}'
    facts = [
        {'label': '平面1', 'latex': first_latex},
        {'label': '平面2', 'latex': second_latex},
        {'label': '位置关系', 'text': RELATION_LABELS['intersecting']},
        {'label': '夹角 θ', 'latex': to_latex(angle)},
        {'label': '交线方向', 'latex': _vec_latex(direction)},
        {'label': '交线上一点', 'latex': _vec_latex(point)},
        {'label': '交线对称式', 'latex': forms['symmetric']},
    ]
    details = {'relation': RELATION_LABELS['intersecting'], 'angle': _text(angle), 'distance': '0',
               'intersection': intersection,
               'equations': [{'label': '交线参数方程', 'latex': forms['parametric']},
                             {'label': '交线对称式', 'latex': forms['symmetric']}]}
    return _result(
        kind='plane_plane_relation', title='两平面位置关系', answer=answer, exact=angle,
        latex=rf'\theta={to_latex(angle)}', facts=facts, details=details,
        steps=[{'id': 'normals', 'title': '比较法向量', 'detail': '法向量不平行，两平面相交。'},
               {'id': 'line', 'title': '求交线', 'detail': '交线方向 n₁×n₂；联立两平面方程取一点。'}],
        space={'kind': 'geometry', 'grid': _plane_grid(_point_on_plane(list(first)), first_normal),
               'edges': [patch for patch in (_plane_boundary(_point_on_plane(list(second)), second_normal),
                                              _line_segment(point, direction)) if patch]},
    )


# ---------------------------------------------------------------------------
# 距离与投影
# ---------------------------------------------------------------------------

def _point_plane_distance(conditions: Mapping[str, Any]) -> dict:
    point = _vector(conditions.get('point'), '点 P')
    a, b, c, d = _plane(conditions.get('plane'), '平面')
    normal = sp.Matrix([a, b, c])
    length = sp.simplify((normal.T * normal)[0])
    signed = sp.simplify((normal.T * point)[0] + d)
    distance = sp.simplify(abs(signed) / sp.sqrt(length))
    projection = sp.Matrix([sp.simplify(point[index] - signed * normal[index] / length) for index in range(3)])
    answer = f'点到平面距离 {_text(distance)}'
    facts = [
        {'label': '点 P', 'latex': _vec_latex(point)},
        {'label': '平面', 'latex': _plane_latex([a, b, c, d])},
        {'label': '距离 d', 'latex': to_latex(distance)},
        {'label': '投影点', 'latex': _vec_latex(projection)},
    ]
    return _result(
        kind='point_plane_distance', title='点到平面距离', answer=answer, exact=distance,
        latex=to_latex(distance), facts=facts,
        details={'relation': None, 'angle': None, 'distance': _text(distance),
                 'intersection': None, 'equations': [], 'projection': _vec_text(projection)},
        steps=[{'id': 'formula', 'title': '代入距离公式', 'detail': f'd=|n·P+d|/|n|={_text(distance)}。'},
               {'id': 'projection', 'title': '求投影点', 'detail': f'沿法向量作垂线，投影点为 {_vec_text(projection)}。'}],
        space={'kind': 'geometry', 'points': [{'id': 'P', **_point_dict(point)},
                                              {'id': '投影', **_point_dict(projection)}],
               'grid': _plane_grid(_point_on_plane([a, b, c, d]), normal)},
    )


def _point_line_distance(conditions: Mapping[str, Any]) -> dict:
    point = _vector(conditions.get('point'), '点 P')
    line_point = _vector(conditions.get('line_point'), '直线过点')
    direction = _nonzero(_vector(conditions.get('line_direction'), '直线方向'), '直线方向')
    offset = sp.Matrix([sp.simplify(item) for item in point - line_point])
    cross = sp.Matrix([sp.simplify(item) for item in offset.cross(direction)])
    distance = sp.simplify(_norm(cross) / _norm(direction))
    foot = sp.Matrix([sp.simplify(line_point[index] + (offset.T * direction)[0] * direction[index]
                                  / (direction.T * direction)[0]) for index in range(3)])
    answer = f'点到直线距离 {_text(distance)}'
    facts = [
        {'label': '点 P', 'latex': _vec_latex(point)},
        {'label': '直线过点 Q', 'latex': _vec_latex(line_point)},
        {'label': '方向向量', 'latex': _vec_latex(direction)},
        {'label': '距离 d', 'latex': to_latex(distance)},
        {'label': '垂足', 'latex': _vec_latex(foot)},
    ]
    return _result(
        kind='point_line_distance', title='点到直线距离', answer=answer, exact=distance,
        latex=to_latex(distance), facts=facts,
        details={'relation': None, 'angle': None, 'distance': _text(distance),
                 'intersection': None, 'equations': [], 'projection': _vec_text(foot)},
        steps=[{'id': 'formula', 'title': '叉积求距离', 'detail': f'd=|(P-Q)×s|/|s|={_text(distance)}。'},
               {'id': 'foot', 'title': '求垂足', 'detail': f'垂足为 {_vec_text(foot)}。'}],
        space={'kind': 'geometry', 'points': [{'id': 'P', **_point_dict(point)},
                                              {'id': '垂足', **_point_dict(foot)}],
               'line': _line_segment(line_point, direction)},
    )


def _line_plane_projection(conditions: Mapping[str, Any]) -> dict:
    point = _vector(conditions.get('line_point'), '直线过点')
    direction = _nonzero(_vector(conditions.get('line_direction'), '直线方向'), '直线方向')
    a, b, c, d = _plane(conditions.get('plane'), '平面')
    normal = sp.Matrix([a, b, c])
    normal_length = sp.simplify((normal.T * normal)[0])
    denominator = sp.simplify((normal.T * direction)[0])
    signed = sp.simplify((normal.T * point)[0] + d)
    if _is_zero(denominator):
        projected_point = sp.Matrix([sp.simplify(point[index] - signed * normal[index] / normal_length)
                                     for index in range(3)])
        projected_direction = direction
        relation = 'in_plane' if _is_zero(signed) else 'parallel'
        angle = sp.Integer(0)
        note = '直线在平面内，投影就是原直线。' if relation == 'in_plane' else '直线与平面平行，投影保持原方向。'
    else:
        parameter = sp.simplify(-signed / denominator)
        projected_point = sp.Matrix([sp.simplify(point[index] + parameter * direction[index]) for index in range(3)])
        projected_direction = sp.Matrix([
            sp.simplify(direction[index] - denominator * normal[index] / normal_length) for index in range(3)])
        relation = 'intersecting'
        angle = sp.asin(sp.simplify(abs(denominator) / (_norm(normal) * _norm(direction))))
        note = '直线与平面相交，投影以交点为起点。'
    if _is_zero(_norm(projected_direction)):
        answer = f'直线垂直于平面，投影退化为点 {_vec_text(projected_point)}'
        forms = {'parametric': '', 'symmetric': ''}
        equations = []
        space = {'kind': 'geometry', 'points': [{'id': '投影点', **_point_dict(projected_point)}],
                 'grid': _plane_grid(_point_on_plane([a, b, c, d]), normal)}
        intersection = _vec_text(projected_point)
    else:
        forms = _line_forms(projected_point, projected_direction)
        answer = f'投影直线 {forms["symmetric_plain"]}'
        equations = [{'label': '投影直线参数方程', 'latex': forms['parametric']},
                     {'label': '投影直线对称式', 'latex': forms['symmetric']}]
        space = {'kind': 'geometry', 'points': [{'id': '投影点', **_point_dict(projected_point)}],
                 'line': _line_segment(projected_point, projected_direction),
                 'grid': _plane_grid(_point_on_plane([a, b, c, d]), normal)}
        intersection = None
    facts = [
        {'label': '原直线方向', 'latex': _vec_latex(direction)},
        {'label': '平面方程', 'latex': _plane_latex([a, b, c, d])},
        {'label': '投影直线过点', 'latex': _vec_latex(projected_point)},
        {'label': '投影方向', 'latex': _vec_latex(projected_direction)},
        {'label': '夹角 θ', 'latex': to_latex(angle)},
    ]
    if forms['symmetric']:
        facts.append({'label': '投影直线对称式', 'latex': forms['symmetric']})
    return _result(
        kind='line_plane_projection', title='直线在平面上的投影', answer=answer, exact=angle,
        latex=rf'\theta={to_latex(angle)}', facts=facts,
        details={'relation': RELATION_LABELS[relation], 'angle': _text(angle), 'distance': None,
                 'intersection': intersection, 'equations': equations},
        steps=[{'id': 'intersection', 'title': '确定投影关键点', 'detail': note},
               {'id': 'direction', 'title': '投影方向', 'detail': 's′ = s − (s·n/|n|²)n；方向为零时投影退化为点。'}],
        space=space,
    )


# ---------------------------------------------------------------------------
# 曲面
# ---------------------------------------------------------------------------

def _partial_continuous_at(expression: sp.Expr, variable: sp.Symbol,
                          value: sp.Expr, others: dict[sp.Symbol, sp.Expr]) -> bool:
    derivative = sp.diff(expression, variable)
    try:
        local = sp.simplify(derivative.subs(others))
    except Exception:  # noqa: BLE001
        return False
    eps = sp.Symbol('eps', positive=True)
    try:
        right_side = sp.simplify(local.subs(variable, value + eps))
        left_side = sp.simplify(local.subs(variable, value - eps))
        right = sp.limit(right_side, eps, 0, '+')
        left = sp.limit(left_side, eps, 0, '+')
        at_point = sp.simplify(local.subs(variable, value))
    except Exception:  # noqa: BLE001
        return False
    if safe_float(left) is None or safe_float(right) is None or safe_float(at_point) is None:
        return False
    return sp.simplify(left - right) == 0 and sp.simplify(left - at_point) == 0


def _surface_tangent(conditions: Mapping[str, Any]) -> dict:
    point = _vector(conditions.get('point'), '曲面上的点')
    if not _raw_equation_defined_at(conditions.get('surface'), point):
        raise ValueError('该点不在原曲面的实定义域内，不能定义切平面')
    surface = _equation(conditions.get('surface'), ('x', 'y', 'z'), '曲面方程', preserve=True)
    if not _is_zero(surface.subs({X: point[0], Y: point[1], Z: point[2]})):
        raise ValueError('该点不在曲面上；首批切平面要求点精确满足曲面方程')
    fixed = {X: point[0], Y: point[1], Z: point[2]}
    for symbol in (X, Y, Z):
        others = {other: fixed[other] for other in (X, Y, Z) if other != symbol}
        if not _partial_continuous_at(surface, symbol, fixed[symbol], others):
            raise ValueError('曲面在该点不是可微的，不能唯一定义切平面（可能存在折痕或尖点）')
    gradient = sp.Matrix([sp.simplify(sp.diff(surface, symbol)) for symbol in (X, Y, Z)])
    gradient_at_point = sp.Matrix([sp.simplify(item.subs({X: point[0], Y: point[1], Z: point[2]}))
                                   for item in gradient])
    if _is_zero(_norm(gradient_at_point)):
        raise ValueError('该点是曲面奇点，梯度为零，不能唯一确定切平面')
    coefficients, tangent_latex, tangent_plain = _normalized_plane([
        gradient_at_point[0], gradient_at_point[1], gradient_at_point[2],
        -sp.simplify((gradient_at_point.T * point)[0])])
    normal_forms = _line_forms(point, gradient_at_point)
    answer = f'切平面 {tangent_plain}；法线 {normal_forms["symmetric_plain"]}'
    facts = [
        {'label': '曲面方程', 'latex': to_latex(surface) + '=0'},
        {'label': '曲面上的点 P', 'latex': _vec_latex(point)},
        {'label': '法向量 ∇F(P)', 'latex': _vec_latex(gradient_at_point)},
        {'label': '切平面', 'latex': tangent_latex},
        {'label': '法线对称式', 'latex': normal_forms['symmetric']},
    ]
    equations = [{'label': '切平面', 'latex': tangent_latex},
                 {'label': '法线参数方程', 'latex': normal_forms['parametric']},
                 {'label': '法线对称式', 'latex': normal_forms['symmetric']}]
    space = {'kind': 'geometry', 'points': [{'id': 'P', **_point_dict(point)}],
             'line': _line_segment(point, gradient_at_point),
             'edges': [patch for patch in (_plane_boundary(point, gradient_at_point),) if patch]}
    surface_grid = _surface_grid(surface, point)
    if surface_grid:
        space['grid'] = surface_grid
    return _result(
        kind='surface_tangent', title='曲面切平面与法线', answer=answer, latex=tangent_latex,
        facts=facts,
        details={'relation': None, 'angle': None, 'distance': None, 'intersection': None,
                 'equations': equations, 'gradient': _vec_text(gradient_at_point)},
        steps=[
            {'id': 'check', 'title': '核对点在曲面上', 'detail': '代入原方程 F(P)=0。'},
            {'id': 'gradient', 'title': '求梯度', 'detail': f'∇F(P)={_vec_text(gradient_at_point)}，作为切平面法向量。'},
            {'id': 'equations', 'title': '写出切平面与法线', 'detail': '切平面 ∇F(P)·(r-P)=0；法线 r=P+t∇F(P)。'},
        ],
        space=space,
    )


def _surface_grid(surface: sp.Expr, point: sp.Matrix, half: float = 2.0, steps: int = 16) -> list[list[dict]] | None:
    center = [safe_float(item) for item in point]
    if any(value is None for value in center):
        return None
    attempts = []
    for solved_symbol, free_symbols, key in ((Z, (X, Y), 'z'), (Y, (X, Z), 'y'), (X, (Y, Z), 'x')):
        try:
            solutions = sp.solve(surface, solved_symbol)
        except Exception:  # noqa: BLE001 - 求显式表达失败时换另一变量
            solutions = []
        for solution in solutions:
            if solution.free_symbols <= set(free_symbols):
                attempts.append((solution, free_symbols, key))
                break
    if not attempts:
        return None
    expression, free_symbols, key = attempts[0]
    grid = []
    for row in range(steps + 1):
        first = center[0] - half + 2 * half * row / steps
        line = []
        for column in range(steps + 1):
            second = center[1] - half + 2 * half * column / steps
            values = {free_symbols[0]: first, free_symbols[1]: second}
            third = safe_float(expression.subs(values))
            if third is None or abs(third) > 1e6:
                line = []
                break
            coordinates = {key: third, {0: 'x', 1: 'y', 2: 'z'}[[X, Y, Z].index(free_symbols[0])]: first,
                           {0: 'x', 1: 'y', 2: 'z'}[[X, Y, Z].index(free_symbols[1])]: second}
            line.append({'x': coordinates['x'], 'y': coordinates['y'], 'z': coordinates['z']})
        if line:
            grid.append(line)
    return grid if grid else None


def _quadric_surface(conditions: Mapping[str, Any]) -> dict:
    raw = conditions.get('expression')
    surface = _equation(raw, ('x', 'y', 'z'), '二次曲面方程')
    try:
        polynomial = sp.Poly(surface, X, Y, Z)
    except sp.PolynomialError as exc:
        raise ValueError('二次曲面方程必须是 x、y、z 的多项式') from exc
    if polynomial.total_degree() > 2:
        raise ValueError('二次曲面方程的次数不能超过 2')
    if polynomial.total_degree() < 2:
        raise ValueError('该方程表示平面或恒等关系，不是二次曲面')
    cross_terms = {
        'xy': sp.simplify(polynomial.coeff_monomial(X * Y)),
        'yz': sp.simplify(polynomial.coeff_monomial(Y * Z)),
        'zx': sp.simplify(polynomial.coeff_monomial(Z * X)),
    }
    if any(not _is_zero(value) for value in cross_terms.values()):
        raise ValueError('当前只支持不含 xy、yz、zx 交叉项的二次曲面方程；含交叉项时请先用正交变换消元')
    quadratic = {name: sp.simplify(polynomial.coeff_monomial(symbol ** 2))
                 for name, symbol in (('x', X), ('y', Y), ('z', Z))}
    linear = {name: sp.simplify(polynomial.coeff_monomial(symbol))
              for name, symbol in (('x', X), ('y', Y), ('z', Z))}
    constant = sp.simplify(polynomial.coeff_monomial(1))
    shift, remaining = {}, {}
    adjusted = constant
    for name, symbol in (('x', X), ('y', Y), ('z', Z)):
        coefficient = quadratic[name]
        if not _is_zero(coefficient):
            shift[name] = sp.simplify(-linear[name] / (2 * coefficient))
            adjusted = sp.simplify(adjusted - linear[name] ** 2 / (4 * coefficient))
        else:
            shift[name] = sp.Integer(0)
            if not _is_zero(linear[name]):
                remaining[name] = linear[name]
    variables = {'x': X, 'y': Y, 'z': Z}
    shifted = {name: sp.simplify(variables[name] - shift[name]) for name in variables}
    quadratic_lhs = sp.simplify(sum(
        quadratic[name] * shifted[name] ** 2 for name in variables if not _is_zero(quadratic[name])))
    axes = [(name, quadratic[name]) for name in variables if not _is_zero(quadratic[name])]
    signs = [sp.sign(value) for _, value in axes]
    classification = ''
    equation = None
    note = '标准形由配方得到；图中只显示可采样的部分。'
    if not remaining:
        if len(axes) == 3:
            if len(set(signs)) == 1:
                if _is_zero(adjusted):
                    classification = '点（退化二次曲面）'
                    equation = sp.Eq(quadratic_lhs, 0)
                elif sp.sign(adjusted) != signs[0]:
                    classification = '椭球面'
                    equation = sp.Eq(sp.simplify(quadratic_lhs / -adjusted), 1)
                else:
                    classification = '空集（无实点）'
                    equation = sp.Eq(sp.simplify(quadratic_lhs / -adjusted), 1)
                    note = '方程在实数范围内没有点。'
            else:
                if _is_zero(adjusted):
                    classification = '椭圆锥面'
                    equation = sp.Eq(quadratic_lhs, 0)
                else:
                    positive = sum(1 for sign in signs if sign > 0)
                    negative = sum(1 for sign in signs if sign < 0)
                    single = next(value for (_, value) in axes
                                  if (positive == 1 and sp.sign(value) > 0)
                                  or (negative == 1 and sp.sign(value) < 0))
                    one_sheet = sp.sign(adjusted) == sp.sign(single)
                    classification = '单叶双曲面' if one_sheet else '双叶双曲面'
                    equation = sp.Eq(sp.simplify(quadratic_lhs / -adjusted), 1)
                    note = ('双叶双曲面图中只显示其中一叶，另一叶由对称性得到。'
                            if not one_sheet else '单叶双曲面图中只显示有限采样范围。')
        elif len(axes) == 2:
            same_sign = signs[0] == signs[1]
            if same_sign:
                if _is_zero(adjusted):
                    classification = '一条直线（退化二次曲面）'
                    equation = sp.Eq(quadratic_lhs, 0)
                    note = '缺变量的方向为整条直线。'
                elif sp.sign(adjusted) != signs[0]:
                    classification = '椭圆柱面'
                    equation = sp.Eq(sp.simplify(quadratic_lhs / -adjusted), 1)
                else:
                    classification = '空集（无实点）'
                    equation = sp.Eq(sp.simplify(quadratic_lhs / -adjusted), 1)
                    note = '方程在实数范围内没有点。'
            else:
                if _is_zero(adjusted):
                    classification = '两张相交平面（退化二次曲面）'
                    equation = sp.Eq(quadratic_lhs, 0)
                else:
                    classification = '双曲柱面'
                    equation = sp.Eq(sp.simplify(quadratic_lhs / -adjusted), 1)
        elif len(axes) == 1:
            if _is_zero(adjusted):
                classification = '一张平面（退化二次曲面）'
                equation = sp.Eq(quadratic_lhs, 0)
                note = '平方项等于零表示重合的两张平面。'
            elif sp.sign(adjusted) != signs[0]:
                classification = '两张平行平面（退化二次曲面）'
                equation = sp.Eq(sp.simplify(quadratic_lhs / -adjusted), 1)
            else:
                classification = '空集（无实点）'
                equation = sp.Eq(sp.simplify(quadratic_lhs / -adjusted), 1)
                note = '方程在实数范围内没有点。'
        else:
            raise ValueError('该方程不是二次曲面')
    else:
        if len(remaining) > 1:
            raise ValueError('当前只支持含一个一次项的标准二次曲面；两个以上一次项需先旋转消元')
        linear_name = next(iter(remaining))
        linear_value = remaining[linear_name]
        if len(axes) == 2:
            same_sign = signs[0] == signs[1]
            classification = '椭圆抛物面' if same_sign else '双曲抛物面'
            solved = sp.simplify(-(quadratic_lhs + adjusted) / linear_value)
            equation = sp.Eq(variables[linear_name], solved)
            note = '图中只显示有限采样范围；抛物面开口方向由标准形决定。'
        elif len(axes) == 1:
            classification = '抛物柱面'
            solved = sp.simplify(-(quadratic_lhs + adjusted) / linear_value)
            equation = sp.Eq(variables[linear_name], solved)
        else:
            raise ValueError('该方程表示平面，不是二次曲面')
    standard_latex = to_latex(equation)
    standard_plain = (f'{expression_text(equation.lhs)} = {expression_text(equation.rhs)}'
                      if isinstance(equation, sp.Eq) else expression_text(equation))
    center_text = '(' + ', '.join(_text(shift[name]) for name in ('x', 'y', 'z')) + ')'
    answer = f'{classification}，标准形 {standard_plain}'
    facts = [
        {'label': '曲面类型', 'text': classification},
        {'label': '标准形', 'latex': standard_latex},
        {'label': '配方中心', 'latex': center_text},
    ]
    details = {'relation': classification, 'angle': None, 'distance': None, 'intersection': None,
               'equations': [{'label': '标准形', 'latex': standard_latex}],
               'standard_form': standard_latex, 'classification': classification,
               'center': center_text}
    return _result(
        kind='quadric_surface', title='二次曲面识别', answer=answer, latex=standard_latex,
        facts=facts, details=details, limitations=[note],
        steps=[
            {'id': 'complete_square', 'title': '配方消去一次项', 'detail': f'配方中心 {center_text}。'},
            {'id': 'classify', 'title': '按平方项符号分类', 'detail': f'得到{classification}。'},
        ],
        space=_quadric_space(classification, axes, adjusted, shift, remaining) or {'kind': 'geometry', 'points': []},
    )


def _quadric_space(classification: str, axes: list[tuple[str, Any]], constant: Any,
                   shift: Mapping[str, Any], remaining: Mapping[str, Any],
                   steps: int = 16) -> dict | None:
    center = {name: safe_float(shift[name]) for name in ('x', 'y', 'z')}
    if any(value is None for value in center.values()):
        return None
    values = {name: safe_float(value) for name, value in axes}
    if any(value is None for value in values.values()):
        return None

    def point(coordinates: Mapping[str, float]) -> dict:
        return {'x': center['x'] + coordinates.get('x', 0.0),
                'y': center['y'] + coordinates.get('y', 0.0),
                'z': center['z'] + coordinates.get('z', 0.0)}

    def add_grid(grid: list[list[dict]]) -> dict:
        return {'kind': 'geometry', 'grid': grid,
                'points': [{'id': '中心', **point({})}]}

    if classification == '椭球面' and len(axes) == 3:
        squared = {name: safe_float(-constant / values[name]) for name, _ in axes}
        if any(value is None or value <= 0 for value in squared.values()):
            return None
        radii = {name: math.sqrt(value) for name, value in squared.items()}
        grid = []
        for row in range(steps + 1):
            phi = math.pi * row / steps
            grid.append([point({
                'x': radii['x'] * math.sin(phi) * math.cos(2 * math.pi * column / steps),
                'y': radii['y'] * math.sin(phi) * math.sin(2 * math.pi * column / steps),
                'z': radii['z'] * math.cos(phi),
            }) for column in range(steps + 1)])
        return add_grid(grid)

    if classification in ('单叶双曲面', '双叶双曲面') and len(axes) == 3:
        constant_value = safe_float(constant)
        if constant_value is None or constant_value == 0:
            return None
        normalized = [(name, values[name] / (-constant_value)) for name, _ in axes]
        positive = [(name, value) for name, value in normalized if value > 0]
        negative = [(name, value) for name, value in normalized if value < 0]
        if classification == '单叶双曲面' and len(positive) == 2 and len(negative) == 1:
            sheet_axis, sheet_value = negative[0]
            radii = {name: 1 / math.sqrt(value) for name, value in positive}
            height = 1 / math.sqrt(-sheet_value)
            grid = []
            for row in range(steps + 1):
                sheet = -2 * height + 4 * height * row / steps
                scale = math.sqrt(1 + (sheet / height) ** 2)
                grid.append([point({
                    positive[0][0]: radii[positive[0][0]] * scale * math.cos(2 * math.pi * column / steps),
                    positive[1][0]: radii[positive[1][0]] * scale * math.sin(2 * math.pi * column / steps),
                    sheet_axis: sheet,
                }) for column in range(steps + 1)])
            return add_grid(grid)
        if classification == '双叶双曲面' and len(positive) == 1 and len(negative) == 2:
            sheet_axis, sheet_value = positive[0]
            radii = {name: 1 / math.sqrt(-value) for name, value in negative}
            height = 1 / math.sqrt(sheet_value)
            grid = []
            for row in range(steps + 1):
                u = -1.6 + 3.2 * row / steps
                grid.append([point({
                    negative[0][0]: radii[negative[0][0]] * math.sinh(u) * math.cos(2 * math.pi * column / steps),
                    negative[1][0]: radii[negative[1][0]] * math.sinh(u) * math.sin(2 * math.pi * column / steps),
                    sheet_axis: height * math.cosh(u),
                }) for column in range(steps + 1)])
            return add_grid(grid)
        return None

    if classification == '椭圆锥面' and len(axes) == 3:
        positive = [name for name, _ in axes if values[name] > 0]
        negative = [name for name, _ in axes if values[name] < 0]
        outlier = positive[0] if len(positive) == 1 else negative[0]
        others = [name for name in ('x', 'y', 'z') if name != outlier]
        first_scale = math.sqrt(abs(values[outlier]) / abs(values[others[0]]))
        second_scale = math.sqrt(abs(values[outlier]) / abs(values[others[1]]))
        grid = []
        for row in range(steps + 1):
            height = -2 + 4 * row / steps
            grid.append([point({
                others[0]: first_scale * abs(height) * math.cos(2 * math.pi * column / steps),
                others[1]: second_scale * abs(height) * math.sin(2 * math.pi * column / steps),
                outlier: height,
            }) for column in range(steps + 1)])
        return add_grid(grid)

    if classification in ('椭圆抛物面', '双曲抛物面') and len(axes) == 2 and len(remaining) == 1:
        linear_name, linear_raw = next(iter(remaining.items()))
        linear = safe_float(linear_raw)
        constant_numeric = safe_float(constant)
        if linear in (None, 0) or constant_numeric is None:
            return None
        first_name, second_name = axes[0][0], axes[1][0]
        first_quadratic, second_quadratic = values[first_name], values[second_name]
        if first_quadratic == 0 or second_quadratic == 0:
            return None
        first_span = 2 * math.sqrt(abs(linear) / abs(first_quadratic))
        second_span = 2 * math.sqrt(abs(linear) / abs(second_quadratic))
        grid = []
        for row in range(steps + 1):
            first = -first_span + 2 * first_span * row / steps
            line = []
            for column in range(steps + 1):
                second = -second_span + 2 * second_span * column / steps
                height = -(first_quadratic * first * first + second_quadratic * second * second + constant_numeric) / linear
                if abs(height) > 1e6:
                    line = []
                    break
                line.append(point({first_name: first, second_name: second, linear_name: height}))
            if line:
                grid.append(line)
        return add_grid(grid) if grid else None

    if classification == '抛物柱面' and len(axes) == 1 and len(remaining) == 1:
        quadratic_name, quadratic_raw = axes[0]
        linear_name, linear_raw = next(iter(remaining.items()))
        quadratic, linear = safe_float(quadratic_raw), safe_float(linear_raw)
        constant_numeric = safe_float(constant)
        if quadratic in (None, 0) or linear in (None, 0) or constant_numeric is None:
            return None
        free_name = next(name for name in ('x', 'y', 'z') if name not in {quadratic_name, linear_name})
        span = 2 * math.sqrt(abs(linear) / abs(quadratic))
        grid = []
        for row in range(steps + 1):
            first = -span + 2 * span * row / steps
            grid.append([point({
                quadratic_name: first,
                linear_name: -(quadratic * first * first + constant_numeric) / linear,
                free_name: -2 + 4 * column / steps,
            }) for column in range(steps + 1)])
        return add_grid(grid)

    if classification == '椭圆柱面' and len(axes) == 2:
        radii = {name: safe_float(-constant / values[name]) for name, _ in axes}
        if any(value is None or value <= 0 for value in radii.values()):
            return None
        first_name, second_name = axes[0][0], axes[1][0]
        free_name = next(name for name in ('x', 'y', 'z') if name not in {first_name, second_name})
        grid = []
        for row in range(steps + 1):
            height = -2 + 4 * row / steps
            grid.append([point({
                first_name: math.sqrt(radii[first_name]) * math.cos(2 * math.pi * column / steps),
                second_name: math.sqrt(radii[second_name]) * math.sin(2 * math.pi * column / steps),
                free_name: height,
            }) for column in range(steps + 1)])
        return add_grid(grid)

    if classification == '双曲柱面' and len(axes) == 2:
        constant_value = safe_float(constant)
        if constant_value in (None, 0):
            return None
        normalized = [(name, values[name] / (-constant_value)) for name, _ in axes]
        positive = [(name, value) for name, value in normalized if value > 0]
        negative = [(name, value) for name, value in normalized if value < 0]
        if len(positive) != 1 or len(negative) != 1:
            return None
        free_name = next(name for name in ('x', 'y', 'z') if name not in {positive[0][0], negative[0][0]})
        grid = []
        for row in range(steps + 1):
            height = -2 + 4 * row / steps
            line = []
            for column in range(steps + 1):
                parameter = -1.3 + 2.6 * column / steps
                line.append(point({
                    positive[0][0]: (1 / math.sqrt(positive[0][1])) * math.cosh(parameter),
                    negative[0][0]: (1 / math.sqrt(-negative[0][1])) * math.sinh(parameter),
                    free_name: height,
                }))
            grid.append(line)
        return add_grid(grid)
    return None


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------

def solve_space_geometry(conditions: Mapping[str, Any]) -> dict:
    raw_kind = str(conditions.get('geometry_kind') or '')
    kind = LEGACY_KINDS.get(raw_kind, raw_kind)
    solvers = {
        'vector_operations': _vector_operations,
        'vector_products': _vector_products,
        'line_from_points': _line_from_points,
        'line_point_direction': _line_point_direction,
        'plane_point_normal': _plane_point_normal,
        'plane_three_points': _plane_three_points,
        'line_line_relation': _line_line_relation,
        'line_plane_relation': _line_plane_relation,
        'plane_plane_relation': _plane_plane_relation,
        'point_line_distance': _point_line_distance,
        'point_plane_distance': _point_plane_distance,
        'line_plane_projection': _line_plane_projection,
        'surface_tangent': _surface_tangent,
        'quadric_surface': _quadric_surface,
    }
    solver = solvers.get(kind)
    if solver is None:
        raise ValueError('当前空间几何只支持向量、直线、平面、曲面及常见位置关系')
    result = solver(conditions)
    result['geometry_kind'] = kind
    if raw_kind == 'line_plane_intersection' and '交点' not in result['answer']:
        result['answer'] += '，无唯一交点'
    if raw_kind == 'plane_plane_angle' and '夹角' not in result['answer']:
        result['answer'] += '，夹角 0'
    result['space_result']['answer_text'] = result['answer']
    return result


__all__ = ['GEOMETRY_KINDS', 'GEOMETRY_LABELS', 'LEGACY_KINDS', 'normalize_plane_field',
           'normalize_vector_field', 'solve_space_geometry']
