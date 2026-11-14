"""User-confirmed line and surface integrals: both classes plus Green/Gauss/Stokes."""
from __future__ import annotations

from typing import Any, Mapping

import sympy as sp

from .expr import expression_text, parse_expression, safe_float, to_latex
from .space import build_space_problem, solve_space_task

X, Y, Z = sp.symbols('x y z', real=True)

KINDS = (
    'line_scalar', 'line_vector',
    'surface_scalar_graph', 'surface_scalar_param',
    'surface_flux_graph', 'surface_flux_param',
    'green', 'gauss', 'stokes',
)
KIND_LABELS = {
    'line_scalar': '第一类曲线积分（对弧长）',
    'line_vector': '第二类曲线积分（对坐标）',
    'surface_scalar_graph': '第一类曲面积分（显式曲面）',
    'surface_scalar_param': '第一类曲面积分（参数曲面）',
    'surface_flux_graph': '第二类曲面积分（显式曲面）',
    'surface_flux_param': '第二类曲面积分（参数曲面）',
    'green': 'Green 公式',
    'gauss': 'Gauss 公式',
    'stokes': 'Stokes 公式',
}
KIND_FIELDS = {
    'line_scalar': ('curve_x', 'curve_y', 'curve_z', 't_lower', 't_upper', 'integrand'),
    'line_vector': ('curve_x', 'curve_y', 'curve_z', 't_lower', 't_upper',
                    'field_p', 'field_q', 'field_r', 'orientation'),
    'surface_scalar_graph': ('surface_z', 'x_lower', 'x_upper', 'y_lower', 'y_upper', 'integrand'),
    'surface_scalar_param': ('surface_x', 'surface_y', 'surface_z_uv',
                             'u_lower', 'u_upper', 'v_lower', 'v_upper', 'integrand'),
    'surface_flux_graph': ('surface_z', 'x_lower', 'x_upper', 'y_lower', 'y_upper',
                           'field_p', 'field_q', 'field_r', 'orientation'),
    'surface_flux_param': ('surface_x', 'surface_y', 'surface_z_uv',
                           'u_lower', 'u_upper', 'v_lower', 'v_upper',
                           'field_p', 'field_q', 'field_r', 'orientation'),
    'green': ('field_p', 'field_q', 'x_lower', 'x_upper', 'y_lower', 'y_upper', 'orientation'),
    'gauss': ('field_p', 'field_q', 'field_r', 'x_lower', 'x_upper',
              'y_lower', 'y_upper', 'z_lower', 'z_upper'),
    'stokes': ('field_p', 'field_q', 'field_r', 'surface_z',
               'x_lower', 'x_upper', 'y_lower', 'y_upper', 'orientation'),
}
ORIENTATIONS = {
    'line_vector': ('forward', 'reverse'),
    'surface_flux_graph': ('up', 'down'),
    'surface_flux_param': ('positive', 'negative'),
    'green': ('positive', 'negative'),
    'stokes': ('up', 'down'),
}
DEFAULT_ORIENTATION = {
    'line_vector': 'forward', 'surface_flux_graph': 'up', 'surface_flux_param': 'positive',
    'green': 'positive', 'stokes': 'up',
}
ORIENTATION_LABELS = {
    'forward': '参数增大方向', 'reverse': '反向',
    'up': '上侧', 'down': '下侧',
    'positive': '正向', 'negative': '负向',
}
KERNEL_TASKS = {
    'line_scalar': 'line_integral', 'line_vector': 'line_integral',
    'surface_scalar_graph': 'surface_integral', 'surface_scalar_param': 'surface_integral',
    'surface_flux_graph': 'surface_integral', 'surface_flux_param': 'surface_integral',
    'green': 'green', 'gauss': 'gauss', 'stokes': 'stokes',
}
PARAMETRIC_SURFACE = {'surface_scalar_param', 'surface_flux_param'}
GRAPH_SURFACE = {'surface_scalar_graph', 'surface_flux_graph', 'stokes'}
LINE_KINDS = {'line_scalar', 'line_vector'}
SURFACE_SCALAR = {'surface_scalar_graph', 'surface_scalar_param'}


def _text_expr(raw: Any, variables: tuple[str, ...], label: str) -> str:
    if not isinstance(raw, str) or not raw.strip() or len(raw) > 600:
        raise ValueError(f'{label}必须是600字以内的表达式')
    try:
        value = parse_expression(raw.strip(), variables, preserve_structure=True)
    except Exception as exc:  # noqa: BLE001 - 保留字段名便于核对
        raise ValueError(f'{label}无法解析：{exc}') from exc
    return expression_text(value)


def _text_constant(raw: Any, label: str) -> str:
    if isinstance(raw, bool) or raw is None or not str(raw).strip():
        raise ValueError(f'{label}必须是有限实常数')
    try:
        value = parse_expression(str(raw).strip(), ('c0',))
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f'{label}无法解析：{exc}') from exc
    if value.free_symbols or value.is_real is False or safe_float(value) is None:
        raise ValueError(f'{label}必须是有限实常数')
    return expression_text(value.xreplace(
        {node: sp.Rational(str(node)) for node in value.atoms(sp.Float)}))


def _ordered_constant(raw: Any, label: str) -> str:
    value = _text_constant(raw, label)
    return value


def _check_increasing(lower: str, upper: str, label: str) -> None:
    if not bool(parse_expression(lower) < parse_expression(upper)):
        raise ValueError(f'{label}必须从小到大')


def _orientation(kind: str, raw: Any) -> str:
    allowed = ORIENTATIONS[kind]
    value = str(raw or DEFAULT_ORIENTATION[kind])
    if value not in allowed:
        raise ValueError('定向取值不符合该积分类型')
    return value


def label_for(kind: str, key: str) -> str:
    mapping = {
        'integral_kind': '积分类型',
        'curve_x': '曲线 x(t)', 'curve_y': '曲线 y(t)', 'curve_z': '曲线 z(t)（平面曲线填0）',
        't_lower': 't 下限', 't_upper': 't 上限',
        'integrand': '被积函数',
        'surface_z': '曲面 z(x,y)',
        'surface_x': '曲面 x(u,v)', 'surface_y': '曲面 y(u,v)', 'surface_z_uv': '曲面 z(u,v)',
        'u_lower': 'u 下限', 'u_upper': 'u 上限',
        'v_lower': 'v 下限', 'v_upper': 'v 上限',
        'x_lower': 'x 下限', 'x_upper': 'x 上限',
        'y_lower': 'y 下界', 'y_upper': 'y 上界',
        'z_lower': 'z 下限', 'z_upper': 'z 上限',
        'field_p': 'P', 'field_q': 'Q', 'field_r': 'R',
        'orientation': '定向',
    }
    if kind == 'green' and key in ('field_p', 'field_q'):
        return f'{key[-1].upper()}(x,y)'
    if kind == 'stokes' and key in ('y_lower', 'y_upper'):
        return 'y 下限' if key == 'y_lower' else 'y 上限'
    if kind == 'gauss' and key in ('y_lower', 'y_upper'):
        return 'y 下限' if key == 'y_lower' else 'y 上限'
    if key in ('field_p', 'field_q', 'field_r'):
        return f'{key[-1].upper()}(x,y,z)'
    return mapping[key]


def labels(c: Mapping[str, Any]) -> dict[str, str]:
    kind = str(c.get('integral_kind') or '')
    return {key: label_for(kind, key) for key in c}


def parse_inputs(conditions: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(conditions, Mapping):
        raise ValueError('曲线曲面积分条件格式不正确')
    kind = str(conditions.get('integral_kind') or '')
    if kind not in KIND_FIELDS:
        raise ValueError('请选择曲线积分、曲面积分或公式类型')
    expected = {'integral_kind', *KIND_FIELDS[kind]}
    missing = [label_for(kind, key) for key in expected
               if key not in conditions or conditions[key] == '']
    if missing:
        raise ValueError('需要补充条件：' + '、'.join(missing))
    extra = set(conditions) - expected
    if extra:
        raise ValueError('存在该类型不能消费的条件：' + ', '.join(sorted(extra)))
    normalized: dict[str, Any] = {'integral_kind': kind}
    if kind in LINE_KINDS:
        for key in ('curve_x', 'curve_y', 'curve_z'):
            normalized[key] = _text_expr(conditions[key], ('t',), label_for(kind, key))
        normalized['t_lower'] = _ordered_constant(conditions['t_lower'], 't 下限')
        normalized['t_upper'] = _ordered_constant(conditions['t_upper'], 't 上限')
        _check_increasing(normalized['t_lower'], normalized['t_upper'], 't 区间')
        if kind == 'line_scalar':
            normalized['integrand'] = _text_expr(conditions['integrand'], ('x', 'y', 'z'), '被积函数')
        else:
            for key in ('field_p', 'field_q', 'field_r'):
                normalized[key] = _text_expr(conditions[key], ('x', 'y', 'z'), label_for(kind, key))
            normalized['orientation'] = _orientation(kind, conditions.get('orientation'))
    elif kind in GRAPH_SURFACE and kind != 'stokes':
        normalized['surface_z'] = _text_expr(conditions['surface_z'], ('x', 'y'), '曲面 z(x,y)')
        normalized['x_lower'] = _ordered_constant(conditions['x_lower'], 'x 下限')
        normalized['x_upper'] = _ordered_constant(conditions['x_upper'], 'x 上限')
        _check_increasing(normalized['x_lower'], normalized['x_upper'], 'x 区间')
        for key in ('y_lower', 'y_upper'):
            normalized[key] = _text_expr(conditions[key], ('x',), label_for(kind, key))
        if kind == 'stokes':
            for key in ('field_p', 'field_q', 'field_r'):
                normalized[key] = _text_expr(conditions[key], ('x', 'y', 'z'), label_for(kind, key))
            normalized['orientation'] = _orientation(kind, conditions.get('orientation'))
        elif kind == 'surface_scalar_graph':
            normalized['integrand'] = _text_expr(conditions['integrand'], ('x', 'y', 'z'), '被积函数')
        else:
            for key in ('field_p', 'field_q', 'field_r'):
                normalized[key] = _text_expr(conditions[key], ('x', 'y', 'z'), label_for(kind, key))
            normalized['orientation'] = _orientation(kind, conditions.get('orientation'))
    elif kind == 'stokes':
        normalized['surface_z'] = _text_expr(conditions['surface_z'], ('x', 'y'), '曲面 z(x,y)')
        normalized['x_lower'] = _ordered_constant(conditions['x_lower'], 'x 下限')
        normalized['x_upper'] = _ordered_constant(conditions['x_upper'], 'x 上限')
        _check_increasing(normalized['x_lower'], normalized['x_upper'], 'x 区间')
        normalized['y_lower'] = _ordered_constant(conditions['y_lower'], 'y 下限')
        normalized['y_upper'] = _ordered_constant(conditions['y_upper'], 'y 上限')
        _check_increasing(normalized['y_lower'], normalized['y_upper'], 'y 区间')
        for key in ('field_p', 'field_q', 'field_r'):
            normalized[key] = _text_expr(conditions[key], ('x', 'y', 'z'), label_for(kind, key))
        normalized['orientation'] = _orientation(kind, conditions.get('orientation'))
    elif kind in PARAMETRIC_SURFACE:
        for key in ('surface_x', 'surface_y', 'surface_z_uv'):
            normalized[key] = _text_expr(conditions[key], ('u', 'v'), label_for(kind, key))
        for key in ('u_lower', 'u_upper', 'v_lower', 'v_upper'):
            normalized[key] = _ordered_constant(conditions[key], label_for(kind, key))
        _check_increasing(normalized['u_lower'], normalized['u_upper'], 'u 区间')
        _check_increasing(normalized['v_lower'], normalized['v_upper'], 'v 区间')
        if kind == 'surface_scalar_param':
            normalized['integrand'] = _text_expr(conditions['integrand'], ('x', 'y', 'z'), '被积函数')
        else:
            for key in ('field_p', 'field_q', 'field_r'):
                normalized[key] = _text_expr(conditions[key], ('x', 'y', 'z'), label_for(kind, key))
            normalized['orientation'] = _orientation(kind, conditions.get('orientation'))
    elif kind == 'green':
        for key in ('field_p', 'field_q'):
            normalized[key] = _text_expr(conditions[key], ('x', 'y'), label_for(kind, key))
        normalized['x_lower'] = _ordered_constant(conditions['x_lower'], 'x 下限')
        normalized['x_upper'] = _ordered_constant(conditions['x_upper'], 'x 上限')
        _check_increasing(normalized['x_lower'], normalized['x_upper'], 'x 区间')
        for key in ('y_lower', 'y_upper'):
            normalized[key] = _text_expr(conditions[key], ('x',), label_for(kind, key))
        normalized['orientation'] = _orientation(kind, conditions.get('orientation'))
    elif kind == 'gauss':
        for key in ('field_p', 'field_q', 'field_r'):
            normalized[key] = _text_expr(conditions[key], ('x', 'y', 'z'), label_for(kind, key))
        for lower, upper, label in (('x_lower', 'x_upper', 'x 区间'),
                                    ('y_lower', 'y_upper', 'y 区间'),
                                    ('z_lower', 'z_upper', 'z 区间')):
            normalized[lower] = _ordered_constant(conditions[lower], label)
            normalized[upper] = _ordered_constant(conditions[upper], label)
            _check_increasing(normalized[lower], normalized[upper], label)
    kernel_conditions = _kernel_conditions(normalized)
    solution = solve_space_task({'task': KERNEL_TASKS[kind], 'conditions': kernel_conditions})
    if solution.get('solution_complete') is not True:
        raise ValueError(solution.get('incomplete_reason') or solution.get('summary') or '当前积分未完成核验')
    return normalized


def _kernel_conditions(c: Mapping[str, Any]) -> dict[str, Any]:
    kind = c['integral_kind']
    if kind in LINE_KINDS:
        conditions: dict[str, Any] = {
            'curve': [c['curve_x'], c['curve_y'], c['curve_z']],
            't_bounds': [c['t_lower'], c['t_upper']],
            'kind': 'scalar' if kind == 'line_scalar' else 'vector',
        }
        conditions['field'] = (c['integrand'] if kind == 'line_scalar'
                               else [c['field_p'], c['field_q'], c['field_r']])
        if kind == 'line_vector':
            conditions['orientation'] = c['orientation']
        return conditions
    if kind == 'stokes':
        return {'field': [c['field_p'], c['field_q'], c['field_r']],
                'surface_z': c['surface_z'],
                'region': {'x': [c['x_lower'], c['x_upper']],
                           'y': [c['y_lower'], c['y_upper']]},
                'orientation': c['orientation']}
    if kind in GRAPH_SURFACE:
        conditions = {
            'surface_mode': 'graph', 'surface_z': c['surface_z'],
            'region': {'x': [c['x_lower'], c['x_upper']],
                       'y': [c['y_lower'], c['y_upper']]},
        }
        if kind == 'surface_scalar_graph':
            conditions.update(kind='scalar', field=c['integrand'])
        else:
            conditions.update(kind='flux', field=[c['field_p'], c['field_q'], c['field_r']],
                              orientation=c['orientation'])
        return conditions
    if kind in PARAMETRIC_SURFACE:
        conditions = {
            'surface_mode': 'parametric',
            'surface': [c['surface_x'], c['surface_y'], c['surface_z_uv']],
            'uv_bounds': [[c['u_lower'], c['u_upper']], [c['v_lower'], c['v_upper']]],
        }
        if kind == 'surface_scalar_param':
            conditions.update(kind='scalar', field=c['integrand'])
        else:
            conditions.update(kind='flux', field=[c['field_p'], c['field_q'], c['field_r']],
                              orientation=c['orientation'])
        return conditions
    if kind == 'green':
        return {'field': [c['field_p'], c['field_q']],
                'region': {'x': [c['x_lower'], c['x_upper']],
                           'y': [c['y_lower'], c['y_upper']]},
                'orientation': c['orientation']}
    if kind == 'gauss':
        return {'field': [c['field_p'], c['field_q'], c['field_r']],
                'region': {'kind': 'box',
                           'x': [c['x_lower'], c['x_upper']],
                           'y': [c['y_lower'], c['y_upper']],
                           'z': [c['z_lower'], c['z_upper']]}}
    raise ValueError('暂不支持的曲线曲面积分类型')


def _latex_field(c: Mapping[str, Any], key: str) -> str:
    return to_latex(parse_expression(c[key], ('t', 'u', 'v', 'x', 'y', 'z'), preserve_structure=True))


def _curve_latex(c: Mapping[str, Any]) -> str:
    return (rf'\mathbf r(t)=\left({_latex_field(c, "curve_x")},'
            rf'{_latex_field(c, "curve_y")},{_latex_field(c, "curve_z")}\right),'
            rf'\quad t\in\left[{to_latex(parse_expression(c["t_lower"]))},'
            rf'{to_latex(parse_expression(c["t_upper"]))}\right]')


def _surface_graph_latex(c: Mapping[str, Any]) -> str:
    return (rf'S:\ z={_latex_field(c, "surface_z")},\quad '
            rf'D:\ {to_latex(parse_expression(c["x_lower"]))}\le x\le'
            rf'{to_latex(parse_expression(c["x_upper"]))},\ '
            rf'{_latex_field(c, "y_lower")}\le y\le {_latex_field(c, "y_upper")}')


def _surface_param_latex(c: Mapping[str, Any]) -> str:
    return (rf'\mathbf r(u,v)=\left({_latex_field(c, "surface_x")},'
            rf'{_latex_field(c, "surface_y")},{_latex_field(c, "surface_z_uv")}\right),'
            rf'\quad u\in\left[{to_latex(parse_expression(c["u_lower"]))},'
            rf'{to_latex(parse_expression(c["u_upper"]))}\right],\ '
            rf'v\in\left[{to_latex(parse_expression(c["v_lower"]))},'
            rf'{to_latex(parse_expression(c["v_upper"]))}\right]')


def _preview_latex(kind: str, c: Mapping[str, Any]) -> str:
    if kind == 'line_scalar':
        return rf'\int_C {_latex_field(c, "integrand")}\,ds,\quad {_curve_latex(c)}'
    if kind == 'line_vector':
        return (rf'\int_C P\,dx+Q\,dy+R\,dz,\quad {_curve_latex(c)},\quad '
                rf'{ORIENTATION_LABELS[c["orientation"]]}')
    if kind == 'surface_scalar_graph':
        return rf'\iint_S {_latex_field(c, "integrand")}\,dS,\quad {_surface_graph_latex(c)}'
    if kind == 'surface_scalar_param':
        return rf'\iint_S {_latex_field(c, "integrand")}\,dS,\quad {_surface_param_latex(c)}'
    if kind == 'surface_flux_graph':
        return (rf'\iint_S P\,dy\,dz+Q\,dz\,dx+R\,dx\,dy,\quad {_surface_graph_latex(c)}'
                rf',\quad {ORIENTATION_LABELS[c["orientation"]]}')
    if kind == 'surface_flux_param':
        return (rf'\iint_S \mathbf F\cdot\mathbf n\,dS,\quad {_surface_param_latex(c)}'
                rf',\quad {ORIENTATION_LABELS[c["orientation"]]}')
    if kind == 'green':
        return (rf'\oint_{{\partial D}}P\,dx+Q\,dy,\quad D:\ '
                rf'{to_latex(parse_expression(c["x_lower"]))}\le x\le'
                rf'{to_latex(parse_expression(c["x_upper"]))},\ '
                rf'{_latex_field(c, "y_lower")}\le y\le {_latex_field(c, "y_upper")},\quad '
                rf'{ORIENTATION_LABELS[c["orientation"]]}')
    if kind == 'gauss':
        return (rf'\oiint_S \mathbf F\cdot\mathbf n\,dS,\quad V:\ '
                rf'{to_latex(parse_expression(c["x_lower"]))}\le x\le'
                rf'{to_latex(parse_expression(c["x_upper"]))},\ '
                rf'{to_latex(parse_expression(c["y_lower"]))}\le y\le'
                rf'{to_latex(parse_expression(c["y_upper"]))},\ '
                rf'{to_latex(parse_expression(c["z_lower"]))}\le z\le'
                rf'{to_latex(parse_expression(c["z_upper"]))}')
    if kind == 'stokes':
        return (rf'\oint_\Gamma \mathbf F\cdot d\mathbf r,\quad {_surface_graph_latex(c)},\quad '
                rf'{ORIENTATION_LABELS[c["orientation"]]}')
    raise ValueError('暂不支持该曲线曲面积分类型')


def _question(kind: str, c: Mapping[str, Any]) -> str:
    orientation = ORIENTATION_LABELS.get(c.get('orientation', ''), '')
    if kind == 'line_scalar':
        return (f'计算第一类曲线积分 ∫_C f ds，曲线 r(t)=({c["curve_x"]},{c["curve_y"]},{c["curve_z"]})，'
                f't∈[{c["t_lower"]},{c["t_upper"]}]，f={c["integrand"]}。')
    if kind == 'line_vector':
        return (f'计算第二类曲线积分 ∫_C P dx+Q dy+R dz，曲线 r(t)=({c["curve_x"]},{c["curve_y"]},{c["curve_z"]})，'
                f't∈[{c["t_lower"]},{c["t_upper"]}]，P={c["field_p"]}，Q={c["field_q"]}，R={c["field_r"]}，'
                f'方向：{orientation}。')
    if kind == 'surface_scalar_graph':
        return (f'计算第一类曲面积分 ∬_S f dS，S: z={c["surface_z"]}，'
                f'{c["x_lower"]}≤x≤{c["x_upper"]}，{c["y_lower"]}≤y≤{c["y_upper"]}，f={c["integrand"]}。')
    if kind == 'surface_scalar_param':
        return (f'计算第一类曲面积分 ∬_S f dS，参数曲面 r(u,v)=({c["surface_x"]},{c["surface_y"]},{c["surface_z_uv"]})，'
                f'u∈[{c["u_lower"]},{c["u_upper"]}]，v∈[{c["v_lower"]},{c["v_upper"]}]，f={c["integrand"]}。')
    if kind == 'surface_flux_graph':
        return (f'计算第二类曲面积分 ∬_S P dy dz+Q dz dx+R dx dy，S: z={c["surface_z"]}，'
                f'{c["x_lower"]}≤x≤{c["x_upper"]}，{c["y_lower"]}≤y≤{c["y_upper"]}，'
                f'P={c["field_p"]}，Q={c["field_q"]}，R={c["field_r"]}，取{orientation}。')
    if kind == 'surface_flux_param':
        return (f'计算第二类曲面积分 ∬_S F·n dS，r(u,v)=({c["surface_x"]},{c["surface_y"]},{c["surface_z_uv"]})，'
                f'u∈[{c["u_lower"]},{c["u_upper"]}]，v∈[{c["v_lower"]},{c["v_upper"]}]，'
                f'P={c["field_p"]}，Q={c["field_q"]}，R={c["field_r"]}，定向：{orientation}。')
    if kind == 'green':
        return (f'用 Green 公式计算 ∮_∂D P dx+Q dy，区域 D: {c["x_lower"]}≤x≤{c["x_upper"]}，'
                f'{c["y_lower"]}≤y≤{c["y_upper"]}，P={c["field_p"]}，Q={c["field_q"]}，边界定向：{orientation}。')
    if kind == 'gauss':
        return (f'用 Gauss 公式计算闭合曲面通量，区域 V: {c["x_lower"]}≤x≤{c["x_upper"]}，'
                f'{c["y_lower"]}≤y≤{c["y_upper"]}，{c["z_lower"]}≤z≤{c["z_upper"]}，'
                f'P={c["field_p"]}，Q={c["field_q"]}，R={c["field_r"]}，取外法向。')
    if kind == 'stokes':
        return (f'用 Stokes 公式计算环路积分，曲面 S: z={c["surface_z"]}，'
                f'{c["x_lower"]}≤x≤{c["x_upper"]}，{c["y_lower"]}≤y≤{c["y_upper"]}，'
                f'P={c["field_p"]}，Q={c["field_q"]}，R={c["field_r"]}，取{orientation}。')
    raise ValueError('暂不支持该曲线曲面积分类型')


def preview(conditions: dict[str, Any]) -> dict[str, Any]:
    normalized = parse_inputs(conditions)
    kind = normalized['integral_kind']
    return {
        'task': 'curve_surface_integral',
        'label': KIND_LABELS[kind],
        'conditions': normalized,
        'latex': _preview_latex(kind, normalized),
        'question': _question(kind, normalized),
    }


def build_problem(c: dict[str, Any]) -> dict[str, Any]:
    from .exam_math import _condition

    normalized = parse_inputs(c)
    kind = normalized['integral_kind']
    problem = build_space_problem(KERNEL_TASKS[kind], _kernel_conditions(normalized))
    preview_data = preview(normalized)
    problem['model']['modeling_task'] = 'curve_surface_integral'
    problem['model']['manual_space_integral_conditions'] = normalized
    problem['model']['formula_tex'] = preview_data['latex']
    if kind in ('line_scalar', 'surface_scalar_graph', 'surface_scalar_param'):
        problem['model']['expression'] = normalized['integrand']
    else:
        problem['model']['expression'] = ''
    condition_fields = [
        _condition(key, label_for(kind, key), value, {})
        for key, value in normalized.items()
    ]
    for field in condition_fields:
        if field['id'] == 'integral_kind':
            field['editable'] = False
    problem['recognition']['conditions'] = condition_fields
    problem['conditions'] = condition_fields
    formula = {'id': 'integral', 'tex': preview_data['latex'],
               'plain': preview_data['label'], 'role': preview_data['label']}
    problem['recognition']['formulas'] = [formula]
    problem['formulas'] = [formula]
    problem['text'] = preview_data['question']
    problem['title'] = preview_data['label']
    return problem


__all__ = ['KIND_FIELDS', 'KIND_LABELS', 'KINDS', 'build_problem', 'label_for', 'labels',
           'parse_inputs', 'preview']
