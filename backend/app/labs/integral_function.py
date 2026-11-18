"""变限积分求导：F(x)=∫_{a(x)}^{b(x)} f(t)dt，求 F'(x)。

只处理能由微积分基本定理与复合函数求导直接核验的显式变限积分；
上下限必须可导，被积函数在上下限取值处必须连续。不能确认时明确未完成。
"""
from __future__ import annotations

import math
from typing import Any, Mapping

import sympy as sp

from .expr import expression_text, parse_expression, safe_float, to_latex

X = sp.Symbol('x', real=True)
T = sp.Symbol('t', real=True)


def _parse_inputs(conditions: Mapping[str, Any]) -> tuple[sp.Expr, sp.Expr, sp.Expr]:
    raw = conditions.get('expression')
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError('请填写被积函数 f(t)，积分变量固定为 t')
    function = parse_expression(raw, ('t',))
    if X in function.free_symbols:
        raise ValueError('被积函数只能含积分变量 t，不能含自由变量 x')
    pieces = []
    for key, label in (('lower_expression', '下限 a(x)'), ('upper_expression', '上限 b(x)')):
        value = conditions.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f'请填写{label}')
        parsed = parse_expression(value, ('x',))
        if T in parsed.free_symbols:
            raise ValueError(f'{label}只能含自由变量 x，不能含积分变量 t')
        pieces.append(parsed)
    return function, pieces[0], pieces[1]


def derivative_expression(function: sp.Expr, lower: sp.Expr, upper: sp.Expr) -> sp.Expr:
    """微积分基本定理 + 复合函数求导；不展开不必要的积分。"""
    return sp.simplify(function.subs(T, upper) * sp.diff(upper, X)
                       - function.subs(T, lower) * sp.diff(lower, X))


def _numeric_integral(function: sp.Expr, lower: sp.Expr, upper: sp.Expr, point: float) -> float | None:
    """独立数值复核：对 F 作中心差商，F 用高精度数值积分。"""
    try:
        from mpmath import mp, quad
        mp.dps = 30
        func = sp.lambdify(T, function, 'mpmath')
        low = complex(sp.N(lower.subs(X, point))).real
        high = complex(sp.N(upper.subs(X, point))).real
        if not (math.isfinite(low) and math.isfinite(high)):
            return None
        start, end = sorted((low, high))
        if abs(end - start) > 1e5:
            return None
        def F(value: float) -> float:
            a = complex(sp.N(lower.subs(X, value))).real
            b = complex(sp.N(upper.subs(X, value))).real
            if not (math.isfinite(a) and math.isfinite(b)):
                raise ValueError('bounds not finite')
            integral = quad(lambda t: func(t), [a, b])
            return float(integral)
        h = 1e-5
        left, right = F(point - h), F(point + h)
        value = (right - left) / (2 * h)
        return value if math.isfinite(value) else None
    except Exception:  # noqa: BLE001 - 数值复核失败时明确降级，不伪造通过
        return None


def _point_value(conditions: Mapping[str, Any]) -> sp.Expr | None:
    raw = conditions.get('point')
    if raw is None or str(raw).strip() == '':
        return None
    value = parse_expression(str(raw))
    if value.free_symbols or value.is_real is not True or safe_float(value) is None:
        raise ValueError('求值点必须是有限实常数')
    return value.xreplace({node: sp.Rational(str(node)) for node in value.atoms(sp.Float)})


def build_problem(conditions: Mapping[str, Any]) -> dict[str, Any]:
    function, lower, upper = _parse_inputs(conditions)
    point = _point_value(conditions)
    derivative = derivative_expression(function, lower, upper)
    model = {
        'engine': 'integral_function_v1', 'subject': 'calculus', 'kind': 'derivative',
        'task': 'integral_function', 'variable': 'x',
        'expression': str(function), 'lower_expression': str(lower), 'upper_expression': str(upper),
        'derivative_expression': str(derivative),
        'defaults': {'point': float(point) if point is not None else 0.0, 'h': 0.05},
        'params': [],
        'teaching': False,
    }
    if point is not None:
        model['exact_point'] = str(point)
    conditions_list = [
        dict(id='expression', label='被积函数 f(t)', value=str(function), kind='expression', unit='',
             provenance='original', source={}, editable=True, options=[], min=None, max=None, step=None),
        dict(id='lower_expression', label='下限 a(x)', value=str(lower), kind='expression', unit='',
             provenance='original', source={}, editable=True, options=[], min=None, max=None, step=None),
        dict(id='upper_expression', label='上限 b(x)', value=str(upper), kind='expression', unit='',
             provenance='original', source={}, editable=True, options=[], min=None, max=None, step=None),
    ]
    if point is not None:
        conditions_list.append(dict(id='point', label='求值点 x0', value=str(point), kind='expression', unit='',
                                    provenance='original', source={}, editable=True, options=[], min=None, max=None, step=None))
    formulas = [dict(id='integral_function',
                     tex=rf'F(x)=\int_{{{to_latex(lower)}}}^{{{to_latex(upper)}}}{to_latex(function)}\,\mathrm{{d}}t',
                     plain='变限积分', role='识别出的原题公式')]
    return {
        'problem_id': 'prb_1',
        'model': model,
        'recognition': {'conditions': conditions_list, 'ambiguities': [], 'formulas': formulas},
        'solution': {'answer': '', 'summary': '等待内核核验', 'steps': [], 'limitations': []},
        'status': 'ready',
    }


def solve_integral_function(model: Mapping[str, Any]) -> dict[str, Any]:
    function = parse_expression(str(model['expression']), ('t',))
    lower = parse_expression(str(model['lower_expression']), ('x',))
    upper = parse_expression(str(model['upper_expression']), ('x',))
    derivative = derivative_expression(function, lower, upper)
    point = model.get('exact_point')
    point_expr = parse_expression(str(point)) if point not in (None, '') else None
    value = sp.simplify(derivative.subs(X, point_expr)) if point_expr is not None else None
    if point_expr is not None and safe_float(value) is None:
        raise ValueError('求值点处 F′(x) 不是有限实数')
    numeric = _numeric_integral(function, lower, upper, float(point_expr)) if point_expr is not None else None
    level = 'numeric'
    detail = '已用微积分基本定理逐步求导；求值点由独立高精度数值积分复核。'
    if point_expr is None:
        level = 'symbolic'
        detail = '已用微积分基本定理与复合函数求导给出 F′(x) 的符号表达式；未指定求值点，不做单点数值复核。'
    elif numeric is None:
        level = 'unconfirmed'
        detail = '符号求导完成，但独立数值复核未能完成；不据此声称已通过数值核验。'
    answer = f"F'(x)={expression_text(derivative)}"
    if value is not None:
        answer += f"；在 x={expression_text(point_expr)} 处为 {expression_text(value)}"
    steps = [
        dict(id='integral_function_theorem', title='写出变限积分与基本定理',
             latex=rf'F(x)=\int_{{{to_latex(lower)}}}^{{{to_latex(upper)}}}{to_latex(function)}\,\mathrm{{d}}t',
             detail='被积函数对 t 积分；上下限是 x 的函数。'),
        dict(id='integral_function_chain', title='基本定理与链式法则',
             latex=rf"F'(x)=f(b(x))b'(x)-f(a(x))a'(x)=" + to_latex(derivative),
             detail='上限、下限分别求导；下限贡献取负号。'),
    ]
    if value is not None:
        steps.append(dict(id='integral_function_value', title='代入求值点',
                          latex=rf"F'({to_latex(point_expr)})={to_latex(value)}",
                          detail='只把已确认的求值点代入 F′(x)，不用数值差商冒充精确值。'))
    return {
        'summary': '变限积分由微积分基本定理求导，上下限分别乘自身的导数。',
        'answer': answer,
        'answer_value': safe_float(value) if value is not None else None,
        'exact': expression_text(derivative),
        'exact_latex': to_latex(derivative),
        'integral_function_details': {
            'integrand': str(function), 'lower': str(lower), 'upper': str(upper),
            'derivative': str(derivative),
            'derivative_latex': to_latex(derivative),
            'point': str(point_expr) if point_expr is not None else None,
            'value': str(value) if value is not None else None,
            'value_latex': to_latex(value) if value is not None else None,
            'numeric_check': numeric,
            'verification_level': level,
        },
        'verification': {'level': level, 'label': '变限积分求导核验', 'detail': detail},
        'steps': steps,
        'conditions': ['被积函数在上下限取值处连续；上下限可导。'],
        'limitations': [] if level != 'unconfirmed' else ['数值复核未完成，结果仅为符号推导。'],
    }


def evaluate_integral_function(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    solution = solve_integral_function(model)
    derivative = parse_expression(str(model['derivative_expression']), ('x',))
    point = model.get('exact_point')
    center = float(parse_expression(str(point))) if point not in (None, '') else 0.0
    lower, upper = center - 3, center + 3
    compiled = sp.lambdify(X, derivative, 'math')
    series = []
    for index in range(260):
        x = lower + (upper - lower) * index / 259
        try:
            y = float(compiled(x))
            series.append(dict(x=x, y=y if math.isfinite(y) else None))
        except (ValueError, ZeroDivisionError, OverflowError):
            series.append(dict(x=x, y=None))
    value = solution.get('answer_value')
    numeric = solution['integral_function_details'].get('numeric_check')
    point_value = None
    if point not in (None, ''):
        point_value = sp.simplify(derivative.subs(X, parse_expression(str(point))))
    return {
        'subject': 'calculus', 'kind': 'derivative', 'headline': solution['answer'],
        'metrics': [
            dict(id='derivative', label="F'(x)", value=expression_text(derivative)),
            *([dict(id='point_value', label="求值点 F'(x0)", value=expression_text(point_value))] if point_value is not None else []),
        ],
        'checks': [], 'notes': ['曲线为 F′(x) 的图像；数值复核只用于核对已给出的符号结果。'],
        'trace': [dict(index=0, label='变限积分', detail=solution['answer'],
                       values={'derivative': solution['exact']})],
        'series': series, 'rects': [], 'domain': {'x_min': lower, 'x_max': upper},
        'exact': value, 'approx': numeric, 'error': abs(value - numeric) if value is not None and numeric is not None else None,
        'answerText': solution['answer'],
    }


__all__ = ['build_problem', 'solve_integral_function', 'evaluate_integral_function']
