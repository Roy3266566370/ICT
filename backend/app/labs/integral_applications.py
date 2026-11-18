"""弧长、旋转曲面面积与极坐标：符号积分为答案，高精度数值积分独立复核。"""
from __future__ import annotations

import math
from typing import Any, Mapping

import sympy as sp

from .expr import expression_text, parse_expression, safe_float, to_latex

X = sp.Symbol('x', real=True)
T = sp.Symbol('t', real=True)
THETA = sp.Symbol('theta', real=True)


def _condition(key: str, label: str, value: Any, kind: str = 'expression') -> dict:
    return dict(id=key, label=label, value=value, kind=kind, unit='', provenance='original',
                source={}, editable=True, options=[], min=None, max=None, step=None)


def _bound(raw: Any, label: str) -> sp.Expr:
    if isinstance(raw, bool) or raw is None or str(raw).strip() == '':
        raise ValueError(f'请填写{label}，不自动补默认值')
    value = parse_expression(str(raw))
    if value.free_symbols or value.is_real is not True or safe_float(value) is None:
        raise ValueError(f'{label}必须是有限实常数，可使用分数或 pi')
    return value.xreplace({node: sp.Rational(str(node)) for node in value.atoms(sp.Float)})


def _interval_bounds(conditions: Mapping[str, Any]) -> tuple[sp.Expr, sp.Expr]:
    a = _bound(conditions.get('lower'), '积分下限')
    b = _bound(conditions.get('upper'), '积分上限')
    if not bool(a < b):
        raise ValueError('积分区间要求下限小于上限，不能通过反转区间改变符号')
    return a, b


def _continuous_on(integrand: sp.Expr, symbol: sp.Symbol, a: sp.Expr, b: sp.Expr, label: str) -> None:
    from sympy.calculus.util import continuous_domain
    try:
        domain = continuous_domain(integrand, symbol, sp.Interval(a, b))
    except (NotImplementedError, TypeError, ValueError) as exc:
        raise ValueError(f'无法确认{label}在整个区间有定义且连续，不能据此计算') from exc
    if sp.Interval(a, b).is_subset(domain) is not True:
        raise ValueError(f'{label}在区间内存在无定义点，不能跨越瑕点计算')


def _symbolic_integral(integrand: sp.Expr, symbol: sp.Symbol, a: sp.Expr, b: sp.Expr) -> sp.Expr:
    exact = sp.integrate(integrand, (symbol, a, b))
    if exact.has(sp.Integral):
        raise ValueError('符号积分未完成：该题没有可核验的初等原函数，不输出数值近似冒充原题答案')
    return sp.simplify(exact)


def _numeric_integral(integrand: sp.Expr, symbol: sp.Symbol, a: sp.Expr, b: sp.Expr) -> float | None:
    try:
        from mpmath import mp, quad
        mp.dps = 30
        func = sp.lambdify(symbol, integrand, 'mpmath')
        value = quad(func, [mp.mpf(float(a)), mp.mpf(float(b))])
        value = float(value)
        return value if math.isfinite(value) else None
    except Exception:  # noqa: BLE001
        return None


def _verify(exact: sp.Expr, numeric: float | None) -> tuple[str, str]:
    value = safe_float(exact)
    if value is None:
        raise ValueError('结果不是有限实数')
    if numeric is None or abs(numeric - value) > 1e-7 * max(1.0, abs(value)):
        return 'unconfirmed', '符号积分已给出精确结果，但独立数值积分复核未通过或未完成，不据此声称已验证。'
    return 'numeric', '符号积分给出精确结果，并用高精度数值积分独立复核。'


APPLICATION_LABELS = {
    'arc_length': '弧长',
    'parametric_arc_length': '弧长',
    'surface_of_revolution': '旋转曲面面积',
    'polar_area': '极坐标面积',
    'polar_arc_length': '弧长',
}


def _solve_single_integral(model: Mapping[str, Any]) -> dict[str, Any]:
    task = str(model['task'])
    from .exam_math import _interval_sign, _strict_roots
    if task == 'arc_length':
        function = parse_expression(str(model['expression']), ('x',))
        symbol, a, b = X, _bound(model['lower_bound'], '积分下限'), _bound(model['upper_bound'], '积分上限')
        derivative = sp.diff(function, X)
        integrand = sp.sqrt(1 + derivative**2)
        _continuous_on(integrand, symbol, a, b, '被积函数 √(1+f′(x)²)')
        exact = _symbolic_integral(integrand, symbol, a, b)
        numeric = _numeric_integral(integrand, symbol, a, b)
        formula = r'L=\int_a^b \sqrt{1+(f(x))^2}\,dx'
        pieces = [(integrand, a, b)]
        description = f"曲线 y={model['expression']}，x∈[{model['lower_bound']},{model['upper_bound']}]"
    elif task == 'parametric_arc_length':
        xt = parse_expression(str(model['x_expression']), ('t',))
        yt = parse_expression(str(model['y_expression']), ('t',))
        symbol, a, b = T, _bound(model['lower_bound'], '参数下限'), _bound(model['upper_bound'], '参数上限')
        integrand = sp.sqrt(sp.diff(xt, T)**2 + sp.diff(yt, T)**2)
        _continuous_on(integrand, symbol, a, b, '被积函数 √(x′(t)²+y′(t)²)')
        exact = _symbolic_integral(integrand, symbol, a, b)
        numeric = _numeric_integral(integrand, symbol, a, b)
        formula = r"L=\int_{t_0}^{t_1} \sqrt{x'(t)^2+y'(t)^2}\,\mathrm{d}t"
        pieces = [(integrand, a, b)]
        description = (f"参数曲线 x={model['x_expression']}, y={model['y_expression']}，"
                       f"t∈[{model['lower_bound']},{model['upper_bound']}]")
    elif task in ('polar_area', 'polar_arc_length'):
        radius = parse_expression(str(model['expression']), ('theta',))
        symbol, a, b = THETA, _bound(model['lower_bound'], '极角下限'), _bound(model['upper_bound'], '极角上限')
        if task == 'polar_area':
            integrand = radius**2 / 2
            formula = r"S=\frac{1}{2}\int_{\alpha}^{\beta} r(\theta)^2\,\mathrm{d}\theta"
        else:
            integrand = sp.sqrt(radius**2 + sp.diff(radius, THETA)**2)
            formula = r"L=\int_{\alpha}^{\beta} \sqrt{r(\theta)^2+r'(\theta)^2}\,\mathrm{d}\theta"
        _continuous_on(integrand, symbol, a, b, '极坐标被积函数')
        exact = _symbolic_integral(integrand, symbol, a, b)
        numeric = _numeric_integral(integrand, symbol, a, b)
        pieces = [(integrand, a, b)]
        description = (f"极坐标曲线 r={model['expression']}，"
                       f"θ∈[{model['lower_bound']},{model['upper_bound']}]")
    else:
        function = parse_expression(str(model['expression']), ('x',))
        symbol, a, b = X, _bound(model['lower_bound'], '积分下限'), _bound(model['upper_bound'], '积分上限')
        axis = str(model.get('rotation_axis') or 'x')
        derivative = sp.diff(function, X)
        ds = sp.sqrt(1 + derivative**2)
        if axis == 'y' and bool(a < 0) and bool(b > 0):
            raise ValueError('绕 y 轴的旋转曲面要求曲线位于 y 轴一侧；跨轴时半径 |x| 需分段，请拆分区间')
        if axis == 'y':
            radius_expr = X if not bool(a < 0) else -X
            integrand = 2 * sp.pi * radius_expr * ds
            _continuous_on(integrand, symbol, a, b, '被积函数 2π|x|√(1+f′²)')
            exact = _symbolic_integral(integrand, symbol, a, b)
            numeric = _numeric_integral(integrand, symbol, a, b)
            pieces = [(integrand, a, b)]
            formula = r'S=2\pi\int_a^b |x|\sqrt{1+(f(x))^2}\,dx'
        else:
            roots = _strict_roots(function, a, b)
            if roots is None:
                raise ValueError('无法证明全部零点，不能把 |f(x)| 拆成可核验的分段')
            cuts = sorted([a, *roots, b], key=lambda value: float(value))
            pieces = []
            total = sp.Integer(0)
            for left, right in zip(cuts, cuts[1:]):
                sign = _interval_sign(function, left, right)
                piece = 2 * sp.pi * sign * function * ds
                pieces.append((piece, left, right))
                total += _symbolic_integral(piece, symbol, left, right)
            exact = sp.simplify(total)
            numeric = None
            for piece, left, right in pieces:
                value = _numeric_integral(piece, symbol, left, right)
                if value is not None:
                    numeric = value if numeric is None else numeric + value
            formula = r'S=2\pi\int_a^b |f(x)|\sqrt{1+(f(x))^2}\,dx'
        description = (f"曲线 y={model['expression']}，x∈[{model['lower_bound']},{model['upper_bound']}]"
                       f"绕{axis}轴旋转所得曲面")
    label = APPLICATION_LABELS[task]
    level, detail = _verify(exact, numeric)
    answer = f"{label} = {expression_text(exact)}"
    steps = [
        dict(id='application_setup', title='确定被积表达式', latex=formula + '=' + to_latex(exact),
             detail=description + '；弧长/面积元按题目曲线直接构造，不改写成其他曲线。'),
        dict(id='application_value', title='计算定积分', latex=rf'{label}={to_latex(exact)}',
             detail='精确值由符号积分给出；数值仅作独立复核，不替代解析结果。'),
    ]
    details = dict(kind=task, exact=expression_text(exact), exact_latex=to_latex(exact),
                   value=safe_float(exact), numeric=numeric, verification_level=level,
                   axis=str(model.get('rotation_axis')) if task == 'surface_of_revolution' else None,
                   lower=str(a), upper=str(b),
                   pieces=[[str(p), str(l), str(r)] for p, l, r in pieces])
    return {
        'summary': f'{label}由确定性符号积分计算，并用高精度数值积分独立复核。',
        'answer': answer,
        'answer_value': safe_float(exact),
        'exact': expression_text(exact),
        'exact_latex': to_latex(exact),
        'application_details': details,
        'verification': {'level': level, 'label': f'{label}核验', 'detail': detail},
        'steps': steps,
        'conditions': ['被积函数在整个区间有定义且连续；无初等原函数时明确未完成，不输出数值近似。'],
        'limitations': [] if level != 'unconfirmed' else ['数值复核未通过或未完成，结果仅为符号积分。'],
    }


def build_problem(task: str, conditions: Mapping[str, Any]) -> dict[str, Any]:
    items = []
    formulas = []
    if task == 'parametric_arc_length':
        xt = parse_expression(str(conditions['x_expression']), ('t',))
        yt = parse_expression(str(conditions['y_expression']), ('t',))
        model = dict(engine='integral_applications_v1', subject='calculus', task=task, kind='integral',
                     variable='t', x_expression=str(xt), y_expression=str(yt), defaults={}, params=[],
                     teaching=False)
        items = [_condition('x_expression', '曲线 x(t)', str(xt)), _condition('y_expression', '曲线 y(t)', str(yt))]
        formulas = [dict(id='parametric_curve', tex=rf'x={to_latex(xt)},\quad y={to_latex(yt)}',
                         plain='参数曲线', role='识别出的原题公式')]
    else:
        variable = 'theta' if task in ('polar_area', 'polar_arc_length') else 'x'
        function = parse_expression(str(conditions['expression']), (variable,))
        model = dict(engine='integral_applications_v1', subject='calculus', task=task, kind='integral',
                     variable=variable, expression=str(function), defaults={}, params=[], teaching=False)
        label = {'arc_length': '曲线 y=f(x)', 'surface_of_revolution': '曲线 y=f(x)',
                 'polar_area': '极径 r(θ)', 'polar_arc_length': '极径 r(θ)'}[task]
        items = [_condition('expression', label, str(function))]
        formulas = [dict(id='application_curve', tex=('r=' if variable == 'theta' else 'y=')+to_latex(function),
                         plain='原题曲线', role='识别出的原题公式')]
    a = _bound(conditions.get('lower'), '积分下限')
    b = _bound(conditions.get('upper'), '积分上限')
    if not bool(a < b):
        raise ValueError('积分区间要求下限小于上限')
    model.update(lower_bound=str(a), upper_bound=str(b))
    bound_label = '极角' if model['variable'] == 'theta' else ('参数 t' if task == 'parametric_arc_length' else '积分')
    items += [_condition('lower', f'{bound_label}下限', str(a)), _condition('upper', f'{bound_label}上限', str(b))]
    if task == 'surface_of_revolution':
        axis = str(conditions.get('rotation_axis') or '')
        if axis not in ('x', 'y'):
            raise ValueError('请选择旋转轴：x 轴或 y 轴')
        model['rotation_axis'] = axis
        items.append(_condition('rotation_axis', '旋转轴', axis, 'choice'))
    model['defaults'] = dict(lower=float(a), upper=float(b))
    return {
        'problem_id': 'prb_1',
        'model': model,
        'recognition': {'conditions': items, 'ambiguities': [], 'formulas': formulas},
        'solution': {'answer': '', 'summary': '等待内核核验', 'steps': [], 'limitations': []},
        'status': 'ready',
    }


def solve_integral_application(model: Mapping[str, Any]) -> dict[str, Any]:
    return _solve_single_integral(model)


def _evaluate(model: Mapping[str, Any]) -> dict[str, Any]:
    solution = _solve_single_integral(model)
    task = str(model['task'])
    a, b = float(model['defaults']['lower']), float(model['defaults']['upper'])
    details = solution['application_details']
    if task == 'parametric_arc_length':
        xt = parse_expression(str(model['x_expression']), ('t',))
        yt = parse_expression(str(model['y_expression']), ('t',))
        fx, fy = sp.lambdify(T, xt, 'math'), sp.lambdify(T, yt, 'math')
        series = []
        for index in range(260):
            t = a + (b - a) * index / 259
            try:
                series.append(dict(x=float(fx(t)), y=float(fy(t))))
            except (ValueError, ZeroDivisionError, OverflowError):
                continue
        domain = {'x_min': min(p['x'] for p in series), 'x_max': max(p['x'] for p in series)} if series else {'x_min': 0, 'x_max': 1}
    elif task in ('polar_area', 'polar_arc_length'):
        radius = parse_expression(str(model['expression']), ('theta',))
        fr = sp.lambdify(THETA, radius, 'math')
        series = []
        for index in range(260):
            theta = a + (b - a) * index / 259
            try:
                r = float(fr(theta))
                series.append(dict(x=r * math.cos(theta), y=r * math.sin(theta)))
            except (ValueError, ZeroDivisionError, OverflowError):
                continue
        domain = ({'x_min': min(p['x'] for p in series), 'x_max': max(p['x'] for p in series)}
                   if series else {'x_min': -1, 'x_max': 1})
    else:
        function = parse_expression(str(model['expression']), ('x',))
        func = sp.lambdify(X, function, 'math')
        series = []
        for index in range(260):
            x = a + (b - a) * index / 259
            try:
                value = float(func(x))
                series.append(dict(x=x, y=value if math.isfinite(value) else None))
            except (ValueError, ZeroDivisionError, OverflowError):
                series.append(dict(x=x, y=None))
        domain = {'x_min': a, 'x_max': b}
    value = details['value']
    numeric = details.get('numeric')
    label = APPLICATION_LABELS[task]
    return dict(subject='calculus', kind='integral', headline=solution['answer'],
                metrics=[dict(id='value', label=f'{label}解析值', value=expression_text(sp.sympify(details['exact'])))],
                checks=[], notes=['曲线按原题区间采样；弧长/面积由符号积分给出，数值仅为独立复核。'],
                trace=[dict(index=0, label=label, detail=solution['answer'], values={'value': value})],
                series=series, rects=[], domain=domain,
                exact=value, approx=numeric, error=abs(value - numeric) if numeric is not None else None,
                answerText=solution['answer'])


def evaluate_integral_application(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    return _evaluate(model)


__all__ = ['build_problem', 'solve_integral_application', 'evaluate_integral_application']
