"""参数方程求导、隐函数求导与曲率：确定性符号求导 + 独立数值复核。"""
from __future__ import annotations

import math
from typing import Any, Mapping

import sympy as sp

from .expr import expression_text, parse_expression, safe_float, to_latex

X = sp.Symbol('x', real=True)
Y = sp.Symbol('y', real=True)
T = sp.Symbol('t', real=True)


def _condition(key: str, label: str, value: Any, kind: str = 'expression') -> dict:
    return dict(id=key, label=label, value=value, kind=kind, unit='', provenance='original',
                source={}, editable=True, options=[], min=None, max=None, step=None)


def _constant(raw: Any, label: str) -> sp.Expr:
    if isinstance(raw, bool) or raw is None or str(raw).strip() == '':
        raise ValueError(f'请填写{label}，不自动补默认值')
    value = parse_expression(str(raw))
    if value.free_symbols or value.is_real is not True or safe_float(value) is None:
        raise ValueError(f'{label}必须是有限实常数')
    return value.xreplace({node: sp.Rational(str(node)) for node in value.atoms(sp.Float)})


def _parse_equation(raw: Any) -> sp.Expr:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError('请填写曲线方程 F(x,y)=0')
    parts = [part.strip() for part in raw.split('=')]
    if len(parts) > 2 or any(not part for part in parts):
        raise ValueError('曲线方程最多有一个等号，且两边不能为空')
    normalized = f'({parts[0]})-({parts[1]})' if len(parts) == 2 else parts[0]
    return parse_expression(normalized, ('x', 'y'))


def _order(raw: Any, default: str = '1') -> int:
    value = str(raw if raw not in (None, '') else default)
    if value not in ('1', '2'):
        raise ValueError('本阶段只支持一阶或二阶导数')
    return int(value)


def _mpmath_check_parametric(xt: sp.Expr, yt: sp.Expr, t0: float, order: int) -> tuple[float | None, float | None]:
    try:
        from mpmath import mp
        mp.dps = 30
        fx = sp.lambdify(T, xt, 'mpmath')
        fy = sp.lambdify(T, yt, 'mpmath')
        x1, y1 = mp.diff(fx, t0, 1), mp.diff(fy, t0, 1)
        if abs(x1) < mp.mpf('1e-20'):
            return None, None
        slope = y1 / x1
        second = None
        if order == 2:
            x2, y2 = mp.diff(fx, t0, 2), mp.diff(fy, t0, 2)
            second = (x1 * y2 - y1 * x2) / x1**3
        return float(slope), float(second) if second is not None else None
    except Exception:  # noqa: BLE001
        return None, None


def _solve_parametric(model: Mapping[str, Any]) -> dict[str, Any]:
    xt = parse_expression(str(model['x_expression']), ('t',))
    yt = parse_expression(str(model['y_expression']), ('t',))
    t0 = _constant(model['exact_point'], '参数点 t0')
    order = int(model.get('order', 1))
    dx, dy = sp.simplify(sp.diff(xt, T)), sp.simplify(sp.diff(yt, T))
    if dx == 0:
        raise ValueError('x′(t) 恒为 0，不能把该参数曲线写成 y=y(x)')
    slope = sp.simplify(dy / dx)
    slope_value = sp.simplify(slope.subs(T, t0))
    dx_value = sp.simplify(dx.subs(T, t0))
    if dx_value == 0:
        raise ValueError('在给定参数点 x′(t0)=0，不能得到有限的 dy/dx；请换点或改用参数形式求切线')
    second = None
    second_value = None
    if order == 2:
        second = sp.simplify(sp.diff(slope, T) / dx)
        second_value = sp.simplify(second.subs(T, t0))
        if safe_float(second_value) is None:
            raise ValueError('该点二阶导数不是有限实数')
    x_value = sp.simplify(xt.subs(T, t0))
    y_value = sp.simplify(yt.subs(T, t0))
    if safe_float(x_value) is None or safe_float(y_value) is None:
        raise ValueError('参数点对应的坐标不是有限实数')
    numeric_slope, numeric_second = _mpmath_check_parametric(xt, yt, float(t0), order)
    level = 'numeric'
    detail = '参数方程一阶/二阶导数由链式法则符号求出，并用高精度参数导数独立复核。'
    error = None
    slope_ok = numeric_slope is not None and abs(numeric_slope - float(slope_value)) <= 1e-7 * max(1.0, abs(numeric_slope))
    second_ok = True
    if order == 2:
        second_ok = (numeric_second is not None
                     and abs(numeric_second - float(second_value)) <= 1e-7 * max(1.0, abs(numeric_second)))
    if not slope_ok or not second_ok:
        level = 'unconfirmed'
        detail = '参数导数符号结果已给出，但独立数值复核未通过或未完成，不据此声称已验证。'
        error = None if numeric_slope is None else abs(numeric_slope - float(slope_value))
    answer = f"dy/dx={expression_text(slope)}"
    if order == 2:
        answer += f"；d²y/dx²={expression_text(second)}"
    answer += f"；在 t={expression_text(t0)} 处 x={expression_text(x_value)}, y={expression_text(y_value)}"
    if order == 1:
        answer += f"，切线斜率 {expression_text(slope_value)}"
    else:
        answer += f"，一阶导 {expression_text(slope_value)}，二阶导 {expression_text(second_value)}"
    steps = [
        dict(id='parametric_dx', title='对参数 t 求导', latex=rf"x'(t)={to_latex(dx)},\quad y'(t)={to_latex(dy)}",
             detail='参数方程求导先分别对 t 求导；不能直接把 t 当成 x。'),
        dict(id='parametric_slope', title='一阶导数', latex=rf"\frac{{dy}}{{dx}}=\frac{{y'(t)}}{{x'(t)}}={to_latex(slope)}",
             detail='要求 x′(t)≠0；在该点代入 t0 得 '+expression_text(slope_value)+'。'),
    ]
    if order == 2:
        steps.append(dict(id='parametric_second', title='二阶导数',
                          latex=rf"\frac{{d^2y}}{{dx^2}}=\frac{{d}}{{dt}}\left(\frac{{dy}}{{dx}}\right)\Big/\,x'(t)={to_latex(second)}",
                          detail='二阶导数不是简单地对 y″/x″，而是对一阶导数再对 t 求导后除以 x′(t)。'))
    tangent = None
    if order == 1:
        tangent = (f'y-({expression_text(y_value)})={expression_text(slope_value)}'
                   f'(x-({expression_text(x_value)}))')
    details = {
        'x_expression': str(xt), 'y_expression': str(yt), 't0': str(t0),
        'dxdt': str(dx), 'dydt': str(dy), 'slope': str(slope), 'slope_value': str(slope_value),
        'second': str(second) if second is not None else None,
        'second_value': str(second_value) if second_value is not None else None,
        'point_x': str(x_value), 'point_y': str(y_value), 'tangent': tangent,
        'numeric_slope': numeric_slope, 'numeric_second': numeric_second,
        'verification_level': level, 'slope_error': error,
    }
    return {
        'summary': '参数方程按 dy/dx=(dy/dt)/(dx/dt) 求导；二阶导数对一阶导数再对 t 求导后除以 x′(t)。',
        'answer': answer,
        'answer_value': safe_float(slope_value),
        'exact': expression_text(slope),
        'exact_latex': to_latex(slope),
        'parametric_details': details,
        'verification': {'level': level, 'label': '参数方程求导核验', 'detail': detail},
        'steps': steps,
        'conditions': ['x(t)、y(t) 在 t0 邻域可导，且 x′(t0)≠0。'],
        'limitations': [] if level != 'unconfirmed' else ['独立数值复核未通过或未完成，结果仅为符号推导。'],
    }


def _solve_implicit(model: Mapping[str, Any]) -> dict[str, Any]:
    equation = _parse_equation(model.get('implicit_expression_raw') or model.get('implicit_expression'))
    px = _constant(model['point_x'], '研究点横坐标')
    roots = sp.solveset(equation.subs(X, px), Y, domain=sp.S.Reals)
    specified = model.get('point_y')
    if specified not in (None, ''):
        py = _constant(specified, '研究点纵坐标')
    elif isinstance(roots, sp.FiniteSet) and len(roots) == 1:
        py = next(iter(roots))
    else:
        raise ValueError('该横坐标对应多个曲线分支，请填写研究点纵坐标')
    if sp.simplify(equation.subs({X: px, Y: py})) != 0:
        raise ValueError('研究点不在曲线上')
    fx, fy = sp.simplify(sp.diff(equation, X)), sp.simplify(sp.diff(equation, Y))
    fx0, fy0 = sp.simplify(fx.subs({X: px, Y: py})), sp.simplify(fy.subs({X: px, Y: py}))
    if safe_float(fx0) is None or safe_float(fy0) is None:
        raise ValueError('研究点处偏导数不是有限实数')
    if fy0 == 0:
        raise ValueError('研究点处 F_y=0，不能由隐函数定理得到有限的 dy/dx')
    slope = sp.simplify(-fx0 / fy0)
    order = int(model.get('order', 1))
    second = None
    if order == 2:
        fxx = sp.simplify(sp.diff(equation, X, 2).subs({X: px, Y: py}))
        fxy = sp.simplify(sp.diff(equation, X, Y).subs({X: px, Y: py}))
        fyy = sp.simplify(sp.diff(equation, Y, 2).subs({X: px, Y: py}))
        second = sp.simplify(-(fxx + 2 * fxy * slope + fyy * slope**2) / fy0)
        # 用全微分形式再核验一次，避免符号整理中的漏项。
        second_check = sp.simplify(
            -(fxx * fy0**2 - 2 * fxy * fx0 * fy0 + fyy * fx0**2) / fy0**3)
        if sp.simplify(second - second_check) != 0:
            raise ValueError('隐函数二阶导数两种推导不一致，当前不能给出可信结果')
    numeric_slope, numeric_second = _mpmath_check_implicit(equation, float(px), float(py), order)
    level = 'numeric'
    detail = '由 F_x、F_y 与隐函数定理求导，并在已确认分支上作高精度数值复核。'
    if numeric_slope is None or abs(numeric_slope - float(slope)) > 1e-7 * max(1.0, abs(numeric_slope)):
        level = 'unconfirmed'
        detail = '隐函数导数符号结果已给出，但独立数值复核未通过或未完成，不据此声称已验证。'
    answer = f"dy/dx={expression_text(slope)}"
    if order == 2:
        answer += f"；d²y/dx²={expression_text(second)}"
    answer += f"；在 P=({expression_text(px)},{expression_text(py)}) 处"
    answer += f" dy/dx={expression_text(slope)}" if order == 1 else f" dy/dx={expression_text(slope)}，d²y/dx²={expression_text(second)}"
    steps = [
        dict(id='implicit_point', title='确认曲线上的点', latex=rf'P=({to_latex(px)},{to_latex(py)})',
             detail='点必须满足原方程；分支不唯一时要求显式给出纵坐标。'),
        dict(id='implicit_first', title='隐函数一阶导数', latex=rf"\frac{{dy}}{{dx}}=-\frac{{F_x}}{{F_y}}={to_latex(slope)}",
             detail='在 P 点要求 F_y≠0；F_y=0 时不能使用该公式。'),
    ]
    if order == 2:
        steps.append(dict(id='implicit_second', title='隐函数二阶导数',
                          latex=rf"\frac{{d^2y}}{{dx^2}}=-\frac{{F_{{xx}}+2F_{{xy}}y'+F_{{yy}}(y')^2}}{{F_y}}={to_latex(second)}",
                          detail='把 y′ 的表达式代回全微分再对 x 求导；两种等价写法已互相核验。'))
    details = {
        'implicit_expression': str(equation), 'point_x': str(px), 'point_y': str(py),
        'partial_x': str(fx0), 'partial_y': str(fy0), 'slope': str(slope),
        'second': str(second) if second is not None else None,
        'numeric_slope': numeric_slope, 'numeric_second': numeric_second,
        'verification_level': level,
    }
    return {
        'summary': '隐函数由 F(x,y)=0 与隐函数定理求导：y′=-F_x/F_y。',
        'answer': answer,
        'answer_value': safe_float(slope),
        'exact': expression_text(slope),
        'exact_latex': to_latex(slope),
        'implicit_derivative_details': details,
        'verification': {'level': level, 'label': '隐函数求导核验', 'detail': detail},
        'steps': steps,
        'conditions': ['研究点位于曲线上，且 F_y≠0；只处理局部单值分支。'],
        'limitations': [] if level != 'unconfirmed' else ['独立数值复核未通过或未完成，结果仅为符号推导。'],
    }


def _mpmath_check_implicit(equation: sp.Expr, px: float, py: float, order: int) -> tuple[float | None, float | None]:
    try:
        from mpmath import mp, findroot
        mp.dps = 30
        func = sp.lambdify((X, Y), equation, 'mpmath')
        def branch(value):
            return findroot(lambda yv: func(value, yv), py)
        slope = float(mp.diff(branch, px, 1))
        second = float(mp.diff(branch, px, 2)) if order == 2 else None
        return slope, second
    except Exception:  # noqa: BLE001
        return None, None


def _solve_curvature(model: Mapping[str, Any]) -> dict[str, Any]:
    function = parse_expression(str(model['expression']), ('x',))
    x0 = _constant(model['exact_point'], '曲率点 x0')
    first, second = sp.simplify(sp.diff(function, X)), sp.simplify(sp.diff(function, X, 2))
    y0 = sp.simplify(function.subs(X, x0))
    k1, k2 = sp.simplify(first.subs(X, x0)), sp.simplify(second.subs(X, x0))
    if any(safe_float(v) is None for v in (y0, k1, k2)):
        raise ValueError('该点函数值或一、二阶导数不是有限实数')
    curvature = sp.simplify(sp.Abs(k2) / (1 + k1**2)**sp.Rational(3, 2))
    curvature_value = safe_float(curvature)
    if curvature_value is None:
        raise ValueError('该点曲率不是有限实数')
    radius = None if curvature == 0 else sp.simplify(1 / curvature)
    center = None
    if k2 != 0:
        center_x = sp.simplify(x0 - k1 * (1 + k1**2) / k2)
        center_y = sp.simplify(y0 + (1 + k1**2) / k2)
        center = (center_x, center_y)
    numeric = _mpmath_check_curvature(function, float(x0))
    level = 'numeric'
    detail = '曲率由 y′、y″ 公式符号求出，并用高精度一、二阶导数独立复核。'
    if numeric is None or abs(numeric - curvature_value) > 1e-7 * max(1.0, curvature_value):
        level = 'unconfirmed'
        detail = '曲率符号结果已给出，但独立数值复核未通过或未完成，不据此声称已验证。'
    answer = f"κ={expression_text(curvature)}"
    if radius is not None:
        answer += f"；曲率半径 R={expression_text(radius)}"
    else:
        answer += '；该点曲率为 0，曲率半径不存在（局部近似直线）'
    answer += f"；在 x={expression_text(x0)} 处 κ={expression_text(curvature)}"
    steps = [
        dict(id='curvature_derivatives', title='求一、二阶导数',
             latex=rf"y'={to_latex(first)},\quad y''={to_latex(second)}", detail='曲率公式需要一阶、二阶导数。'),
        dict(id='curvature_formula', title='代入曲率公式',
             latex=rf"\kappa=\frac{{|y''|}}{{(1+(y')^2)^{{3/2}}}}={to_latex(curvature)}",
             detail='曲率非负；曲率半径为 1/κ。'),
    ]
    if center is not None:
        steps.append(dict(id='curvature_center', title='曲率中心',
                          latex=rf"\left({to_latex(center[0])},{to_latex(center[1])}\right)",
                          detail='曲率中心位于法线上，曲率圆半径 R=1/κ。'))
    details = {
        'expression': str(function), 'point': str(x0), 'value': str(y0),
        'first': str(k1), 'second': str(k2), 'curvature': str(curvature),
        'curvature_value': curvature_value, 'radius': str(radius) if radius is not None else None,
        'center': [str(center[0]), str(center[1])] if center is not None else None,
        'numeric_curvature': numeric, 'verification_level': level,
    }
    return {
        'summary': '曲率 κ=|y″|/(1+y′²)^{3/2}；曲率半径 R=1/κ。',
        'answer': answer,
        'answer_value': curvature_value,
        'exact': expression_text(curvature),
        'exact_latex': to_latex(curvature),
        'curvature_details': details,
        'verification': {'level': level, 'label': '曲率核验', 'detail': detail},
        'steps': steps,
        'conditions': ['函数在该点二阶可导；曲率半径为 1/κ，κ=0 时不存在有限曲率圆。'],
        'limitations': [] if level != 'unconfirmed' else ['独立数值复核未通过或未完成，结果仅为符号推导。'],
    }


def _mpmath_check_curvature(function: sp.Expr, x0: float) -> float | None:
    try:
        from mpmath import mp
        mp.dps = 30
        func = sp.lambdify(X, function, 'mpmath')
        first, second = mp.diff(func, x0, 1), mp.diff(func, x0, 2)
        return float(abs(second) / (1 + first**2)**mp.mpf('1.5'))
    except Exception:  # noqa: BLE001
        return None


def build_problem(task: str, conditions: Mapping[str, Any]) -> dict[str, Any]:
    """Build model/recognition for the three derivative-extra tasks."""
    if task == 'parametric_derivative':
        xt = parse_expression(str(conditions['x_expression']), ('t',))
        yt = parse_expression(str(conditions['y_expression']), ('t',))
        t0 = _constant(conditions['point'], '参数点 t0')
        order = _order(conditions.get('order'))
        model = dict(engine='derivative_extra_v1', subject='calculus', task=task, kind='derivative',
                     variable='x', x_expression=str(xt), y_expression=str(yt), exact_point=str(t0),
                     order=order, defaults={'t0': float(t0)}, params=[], teaching=False)
        items = [_condition('x_expression', '曲线 x(t)', str(xt)),
                 _condition('y_expression', '曲线 y(t)', str(yt)),
                 _condition('point', '参数点 t0', str(t0)),
                 _condition('order', '导数阶数', str(order), 'number')]
        formulas = [dict(id='parametric', tex=rf'x={to_latex(xt)},\quad y={to_latex(yt)}',
                         plain='参数方程', role='识别出的原题公式')]
    elif task == 'implicit_derivative':
        equation = _parse_equation(conditions.get('implicit_expression'))
        px = _constant(conditions['point_x'], '研究点横坐标')
        py_raw = conditions.get('point_y')
        py = _constant(py_raw, '研究点纵坐标') if py_raw not in (None, '') else None
        order = _order(conditions.get('order'))
        model = dict(engine='derivative_extra_v1', subject='calculus', task=task, kind='derivative',
                     variable='x', implicit_expression=str(equation),
                     implicit_expression_raw=str(conditions.get('implicit_expression')),
                     point_x=str(px), point_y=str(py) if py is not None else None, order=order,
                     defaults={'point': float(px)}, params=[], teaching=False)
        items = [_condition('implicit_expression', '曲线方程 F(x,y)=0', str(equation)),
                 _condition('point_x', '研究点横坐标', str(px))]
        if py is not None:
            items.append(_condition('point_y', '研究点纵坐标', str(py)))
        items.append(_condition('order', '导数阶数', str(order), 'number'))
        formulas = [dict(id='implicit_derivative', tex=to_latex(equation)+'=0',
                         plain='隐函数方程', role='识别出的原题公式')]
    elif task == 'curvature':
        function = parse_expression(str(conditions['expression']), ('x',))
        x0 = _constant(conditions['point'], '曲率点 x0')
        model = dict(engine='derivative_extra_v1', subject='calculus', task=task, kind='derivative',
                     variable='x', expression=str(function), exact_point=str(x0),
                     defaults={'point': float(x0), 'h': 0.05}, params=[], teaching=False)
        items = [_condition('expression', '函数 f(x)', str(function)),
                 _condition('point', '曲率点 x0', str(x0))]
        formulas = [dict(id='curvature', tex='y='+to_latex(function), plain='函数曲线', role='识别出的原题公式')]
    else:
        raise ValueError('当前没有该题型')
    return {
        'problem_id': 'prb_1',
        'model': model,
        'recognition': {'conditions': items, 'ambiguities': [], 'formulas': formulas},
        'solution': {'answer': '', 'summary': '等待内核核验', 'steps': [], 'limitations': []},
        'status': 'ready',
    }


def solve_derivative_extra(model: Mapping[str, Any]) -> dict[str, Any]:
    task = str(model.get('task'))
    if task == 'parametric_derivative':
        return _solve_parametric(model)
    if task == 'implicit_derivative':
        return _solve_implicit(model)
    if task == 'curvature':
        return _solve_curvature(model)
    raise ValueError('当前没有该题型的求解内核')


def _evaluate_parametric(model: Mapping[str, Any]) -> dict[str, Any]:
    solution = _solve_parametric(model)
    xt = parse_expression(str(model['x_expression']), ('t',))
    yt = parse_expression(str(model['y_expression']), ('t',))
    t0 = float(model['defaults']['t0'])
    lower, upper = t0 - 3, t0 + 3
    fx, fy = sp.lambdify(T, xt, 'math'), sp.lambdify(T, yt, 'math')
    series = []
    for index in range(260):
        t = lower + (upper - lower) * index / 259
        try:
            series.append(dict(x=float(fx(t)), y=float(fy(t))))
        except (ValueError, ZeroDivisionError, OverflowError):
            continue
    valid = [point for point in series if point['x'] is not None and point['y'] is not None]
    domain = {'x_min': min((p['x'] for p in valid), default=-3.0),
              'x_max': max((p['x'] for p in valid), default=3.0)}
    details = solution['parametric_details']
    slope = float(sp.sympify(details['slope_value']))
    point_x, point_y = float(sp.sympify(details['point_x'])), float(sp.sympify(details['point_y']))
    result = dict(subject='calculus', kind='derivative', headline=solution['answer'],
                  metrics=[dict(id='slope', label='一阶导数 dy/dx', value=expression_text(sp.sympify(details['slope']))),
                           *([dict(id='second', label='二阶导数 d²y/dx²', value=expression_text(sp.sympify(details['second'])))] if details['second'] else [])],
                  checks=[], notes=['曲线按参数 t 采样；切线与导数使用同一组 t0。'],
                  trace=[dict(index=0, label='参数点', detail=solution['answer'],
                              values={'x': point_x, 'y': point_y, 'slope': slope})],
                  series=series, rects=[], domain=domain,
                  exact=slope, approx=details.get('numeric_slope'),
                  error=details.get('slope_error'), answerText=solution['answer'],
                  point={'x': point_x, 'y': point_y, 'slope': slope,
                         'tangent': {'m': slope, 'b': point_y - slope * point_x}})
    return result


def _evaluate_implicit(model: Mapping[str, Any]) -> dict[str, Any]:
    solution = _solve_implicit(model)
    details = solution['implicit_derivative_details']
    equation = _parse_equation(model.get('implicit_expression_raw') or model.get('implicit_expression'))
    px, py = float(sp.sympify(details['point_x'])), float(sp.sympify(details['point_y']))
    slope = float(sp.sympify(details['slope']))
    fy = sp.lambdify((X, Y), sp.diff(equation, Y), 'math')
    series = []
    for direction in (-1, 1):
        current = py
        stopped = False
        half = []
        for index in range(1, 81):
            x = px + direction * index / 80
            try:
                if stopped:
                    raise ValueError('branch stopped')
                for _ in range(30):
                    value = float(equation.subs({X: x, Y: current}))
                    derivative = float(fy(x, current))
                    if abs(derivative) < 1e-12:
                        raise ValueError('vertical branch')
                    current = current - value / derivative
                half.append(dict(x=x, y=current))
            except Exception:  # noqa: BLE001
                stopped = True
                half.append(dict(x=x, y=None))
        series.extend(reversed(half) if direction < 0 else [dict(x=px, y=py)] + half)
    return dict(subject='calculus', kind='derivative', headline=solution['answer'],
                metrics=[dict(id='slope', label='dy/dx', value=expression_text(sp.sympify(details['slope']))),
                         *([dict(id='second', label='d²y/dx²', value=expression_text(sp.sympify(details['second'])))] if details['second'] else [])],
                checks=[], notes=['只展示经过已确认研究点的局部隐式分支；竖直切线附近停止追踪。'],
                trace=[dict(index=0, label='研究点', detail=solution['answer'],
                            values={'x': px, 'y': py, 'slope': slope})],
                series=series, rects=[], domain={'x_min': px - 1, 'x_max': px + 1},
                exact=slope, approx=details.get('numeric_slope'), error=None,
                answerText=solution['answer'],
                point={'x': px, 'y': py, 'slope': slope,
                       'tangent': {'m': slope, 'b': py - slope * px}})


def _evaluate_curvature(model: Mapping[str, Any]) -> dict[str, Any]:
    solution = _solve_curvature(model)
    details = solution['curvature_details']
    function = parse_expression(str(model['expression']), ('x',))
    x0 = float(sp.sympify(details['point']))
    lower, upper = x0 - 3, x0 + 3
    func = sp.lambdify(X, function, 'math')
    series = []
    for index in range(260):
        x = lower + (upper - lower) * index / 259
        try:
            value = float(func(x))
            series.append(dict(x=x, y=value if math.isfinite(value) else None))
        except (ValueError, ZeroDivisionError, OverflowError):
            series.append(dict(x=x, y=None))
    slope = float(sp.sympify(details['first']))
    return dict(subject='calculus', kind='derivative', headline=solution['answer'],
                metrics=[dict(id='curvature', label='曲率 κ', value=expression_text(sp.sympify(details['curvature']))),
                         *([dict(id='radius', label='曲率半径 R', value=expression_text(sp.sympify(details['radius'])))] if details['radius'] else [])],
                checks=[], notes=['曲线为原函数图像；曲率与曲率圆由同一点的一、二阶导数计算。'],
                trace=[dict(index=0, label='曲率点', detail=solution['answer'],
                            values={'x': x0, 'y': float(sp.sympify(details['value'])), 'slope': slope})],
                series=series, rects=[], domain={'x_min': lower, 'x_max': upper},
                exact=details['curvature_value'], approx=details.get('numeric_curvature'),
                error=None, answerText=solution['answer'],
                point={'x': x0, 'y': float(sp.sympify(details['value'])), 'slope': slope,
                       'tangent': {'m': slope, 'b': float(sp.sympify(details['value'])) - slope * x0}})


def evaluate_derivative_extra(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    task = str(model.get('task'))
    if task == 'parametric_derivative':
        return _evaluate_parametric(model)
    if task == 'implicit_derivative':
        return _evaluate_implicit(model)
    if task == 'curvature':
        return _evaluate_curvature(model)
    raise ValueError('当前没有该题型的展示内核')


__all__ = ['build_problem', 'solve_derivative_extra', 'evaluate_derivative_extra']
