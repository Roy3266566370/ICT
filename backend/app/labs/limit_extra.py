"""渐近线（有理函数）与数列极限：符号极限为主，数值只作独立观察。"""
from __future__ import annotations

import math
from typing import Any, Mapping

import sympy as sp

from .expr import expression_text, parse_expression, safe_float, to_latex

X = sp.Symbol('x', real=True)
N = sp.Symbol('n', integer=True, positive=True)


def _condition(key: str, label: str, value: Any, kind: str = 'expression') -> dict:
    return dict(id=key, label=label, value=value, kind=kind, unit='', provenance='original',
                source={}, editable=True, options=[], min=None, max=None, step=None)


def _rational_parts(function: sp.Expr) -> tuple[sp.Expr, sp.Expr]:
    combined = sp.together(function)
    numerator, denominator = sp.fraction(combined)
    if not (numerator.is_polynomial(X) and denominator.is_polynomial(X)):
        raise ValueError('当前渐近线内核只支持有理函数（多项式之比）的完整分析；'
                         '含 sin、exp、sqrt 等的函数不能保证渐近线集合完整，请改写或换题型')
    return numerator, denominator


def _side_limit(value: sp.Expr, direction: str) -> sp.Expr:
    return sp.limit(value, X, sp.oo if direction == '+' else -sp.oo)


def _finite(value: sp.Expr) -> bool:
    if isinstance(value, sp.AccumBounds) or value in (sp.oo, -sp.oo, sp.zoo, sp.nan):
        return False
    return safe_float(value) is not None


def solve_asymptote(model: Mapping[str, Any]) -> dict[str, Any]:
    function = parse_expression(str(model['expression']), ('x',))
    numerator, denominator = _rational_parts(function)
    asymptotes: list[dict[str, str]] = []
    holes: list[str] = []
    vertical_roots: list[sp.Expr] = []
    line_expressions: list[sp.Expr] = []
    poly = sp.Poly(denominator, X)
    if poly.degree() > 0:
        for root in sorted(set(poly.real_roots()), key=lambda v: float(v)):
            left = sp.limit(function, X, root, dir='-')
            right = sp.limit(function, X, root, dir='+')
            if left in (sp.oo, -sp.oo) or right in (sp.oo, -sp.oo):
                asymptotes.append(dict(kind='vertical', value=expression_text(root),
                                       label=f'x={expression_text(root)}'))
                vertical_roots.append(root)
            elif _finite(left) and sp.simplify(left - right) == 0:
                holes.append(f'x={expression_text(root)}（可去间断点，不是渐近线）')
    horizontal: dict[str, sp.Expr] = {}
    oblique: dict[str, tuple[sp.Expr, sp.Expr]] = {}
    undetermined: list[str] = []
    for direction, name in (('+', 'x→+∞'), ('-', 'x→-∞')):
        limit = _side_limit(function, direction)
        if _finite(limit):
            horizontal[direction] = limit
        else:
            slope = _side_limit(function / X, direction)
            if _finite(slope):
                intercept = _side_limit(function - slope * X, direction)
                if _finite(intercept):
                    oblique[direction] = (slope, intercept)
                else:
                    undetermined.append(name)
            else:
                undetermined.append(name)
    for direction, name in (('+', 'x→+∞'), ('-', 'x→-∞')):
        if direction in horizontal:
            asymptotes.append(dict(kind='horizontal', value=expression_text(horizontal[direction]),
                                   label=f'y={expression_text(horizontal[direction])}（{name}）'))
            line_expressions.append(horizontal[direction])
        elif direction in oblique:
            slope, intercept = oblique[direction]
            asymptotes.append(dict(kind='oblique',
                                   value=f'{expression_text(slope)}*x+({expression_text(intercept)})',
                                   label=f'y={expression_text(slope)}*x+({expression_text(intercept)})（{name}）'))
            line_expressions.append(slope * X + intercept)
    checks: list[bool] = []
    for root in vertical_roots:
        try:
            a = float(root)
            probes = [abs(float(function.subs(X, sp.Float(a + offset, 20))))
                      for offset in (-1e-6, 1e-6)]
            checks.append(max(probes) > 1e3)
        except Exception:  # noqa: BLE001
            checks.append(False)
    for expression in line_expressions:
        try:
            reference = float(expression.subs(X, 1e6))
            probe = abs(float(function.subs(X, 1e6)) - reference)
            checks.append(probe < 1e-3 * max(1.0, abs(reference)))
        except Exception:  # noqa: BLE001
            checks.append(False)
    level = 'numeric' if asymptotes and checks and all(checks) else ('symbolic' if asymptotes else 'numeric')
    detail = ('垂直/水平/斜渐近线均由符号极限求出，并在典型点做了独立数值检查。'
              if level == 'numeric' else '渐近线由符号极限求出；数值检查未全部通过或无渐近线。')
    answer = ('该有理函数没有渐近线' if not asymptotes
              else '渐近线：' + '；'.join(item['label'] for item in asymptotes))
    if holes:
        answer += '。另：' + '、'.join(holes)
    steps = [
        dict(id='asymptote_setup', title='按有理函数拆分',
             latex=rf'f(x)=\frac{{{to_latex(numerator)}}}{{{to_latex(denominator)}}}',
             detail='只对有理函数承诺渐近线集合完整：分母零点给出垂直渐近线候选，无穷远极限给出水平/斜渐近线。'),
    ]
    if vertical_roots:
        steps.append(dict(id='asymptote_vertical', title='分母的实零点',
                          latex=',\\quad '.join(f'x={to_latex(root)}' for root in vertical_roots),
                          detail='两侧极限至少一侧为无穷才是垂直渐近线；极限有限的零点是可去间断点，不计入。'))
    if horizontal or oblique:
        pieces = []
        for direction, name in (('+', '+\\infty'), ('-', '-\\infty')):
            if direction in horizontal:
                pieces.append(rf'\lim_{{x\to {name}}}f(x)={to_latex(horizontal[direction])}')
            elif direction in oblique:
                slope, intercept = oblique[direction]
                pieces.append(rf'y={to_latex(slope)}x+({to_latex(intercept)})\quad(x\to {name})')
        steps.append(dict(id='asymptote_infinite', title='无穷远行为', latex=',\\quad '.join(pieces),
                          detail='先看水平极限；不存在时用 k=lim f/x、b=lim(f-kx) 求斜渐近线。'))
    if undetermined:
        steps.append(dict(id='asymptote_undetermined', title='未定方向',
                          detail='、'.join(undetermined) + ' 方向的水平/斜渐近线未能确定，不猜测结论。'))
    details = dict(expression=str(function),
                   asymptotes=[dict(kind=item['kind'], value=item['value'], label=item['label'])
                               for item in asymptotes],
                   holes=holes, undetermined=undetermined, verification_level=level)
    return {
        'summary': '有理函数的渐近线由分母零点与无穷远极限完整确定。',
        'answer': answer,
        'answer_value': None,
        'exact': answer,
        'exact_latex': '',
        'asymptote_details': details,
        'verification': {'level': level, 'label': '渐近线核验', 'detail': detail},
        'steps': steps,
        'conditions': ['仅支持有理函数；非有理函数的渐近线集合可能不完整，明确拒绝。'],
        'limitations': [] if level == 'numeric' else ['数值检查未全部完成，渐近线结论以符号极限为准。'],
    }


def _sequence_term(model: Mapping[str, Any]) -> sp.Expr:
    term = parse_expression(str(model['expression']), ('n',))
    return term.subs({symbol: N for symbol in term.free_symbols if symbol.name == 'n'})


def solve_sequence_limit(model: Mapping[str, Any]) -> dict[str, Any]:
    term = _sequence_term(model)
    limit = sp.limit(term, N, sp.oo)
    status = 'convergent'
    label = f'lim a_n = {expression_text(limit)}'
    if isinstance(limit, sp.AccumBounds) or limit is sp.nan:
        status, label = 'nonexistent', '极限不存在（振荡）'
    elif limit is sp.oo:
        status, label = 'divergent', '发散到 +∞'
    elif limit is -sp.oo:
        status, label = 'divergent', '发散到 -∞'
    elif limit is sp.zoo:
        status, label = 'undetermined', '极限未定（含复值或无法判定）'
    observations = []
    level = 'symbolic'
    detail = '结论由符号极限给出；发散/不存在/未定分别标注，不用部分和冒充。'
    if status == 'convergent':
        target = safe_float(limit)
        func = sp.lambdify(N, term, 'math')
        for power in (2, 3, 4, 5):
            try:
                value = float(func(10 ** power))
                observations.append(dict(n=10 ** power, value=value if math.isfinite(value) else None))
            except Exception:  # noqa: BLE001
                observations.append(dict(n=10 ** power, value=None))
        errors = [abs(item['value'] - target) if item['value'] is not None and target is not None else None
                  for item in observations]
        if (target is not None and all(error is not None for error in errors)
                and errors[-1] < 1e-3 * max(1.0, abs(target))
                and all(later <= earlier + 1e-12 for earlier, later in zip(errors, errors[1:]))):
            level = 'numeric'
            detail = '数列极限由符号极限求出，并在 n=10²…10⁵ 处做了独立数值观察。'
        else:
            detail = '数列极限由符号极限求出；数值观察未完成或不收敛足够快，仅作参考。'
    answer = f"数列 a_n={expression_text(term)} 当 n→∞ 的极限：{label}"
    steps = [
        dict(id='sequence_term', title='确认通项', latex=rf'a_n={to_latex(term)}',
             detail='数列极限只对整数指标 n→∞ 计算，不与函数极限混用。'),
        dict(id='sequence_limit', title='计算符号极限', latex=rf'\lim_{{n\to\infty}}{to_latex(term)}={sp.latex(limit)}',
             detail=label + '；发散与不存在分别标注，不输出部分和冒充极限。'),
    ]
    details = dict(term=str(term), limit=expression_text(limit) if status == 'convergent' else None,
                   status=status, status_label=label, observations=observations,
                   verification_level=level)
    return {
        'summary': '数列极限由符号极限计算；数值观察只作参考，不代替结论。',
        'answer': answer,
        'answer_value': safe_float(limit) if status == 'convergent' else None,
        'exact': expression_text(limit) if status == 'convergent' else label,
        'exact_latex': sp.latex(limit) if status == 'convergent' else '',
        'sequence_details': details,
        'verification': {'level': level, 'label': '数列极限核验', 'detail': detail},
        'steps': steps,
        'conditions': ['通项只含指标 n；数列极限只研究 n→+∞，不提供单侧方向。'],
        'limitations': [] if level == 'numeric' else ['数值观察未通过或未完成，结论以符号极限为准。'],
    }


def build_problem(task: str, conditions: Mapping[str, Any]) -> dict[str, Any]:
    if task not in ('asymptote', 'sequence_limit'):
        raise ValueError('当前没有该题型')
    variable = 'n' if task == 'sequence_limit' else 'x'
    function = parse_expression(str(conditions['expression']), (variable,))
    label = '数列通项 aₙ' if task == 'sequence_limit' else '函数 f(x)'
    if task == 'asymptote':
        _rational_parts(function)
    model = dict(engine='limit_extra_v1', subject='calculus', task=task, kind='limit',
                 variable=variable, expression=str(function), defaults={}, params=[], teaching=False)
    return {
        'problem_id': 'prb_1',
        'model': model,
        'recognition': {'conditions': [_condition('expression', label, str(function))],
                        'ambiguities': [],
                        'formulas': [dict(id='limit_extra',
                                          tex=('a_n=' if task == 'sequence_limit' else 'f(x)=') + to_latex(function),
                                          plain='原题表达式', role='识别出的原题公式')]},
        'solution': {'answer': '', 'summary': '等待内核核验', 'steps': [], 'limitations': []},
        'status': 'ready',
    }


def solve_limit_extra(model: Mapping[str, Any]) -> dict[str, Any]:
    if model.get('task') == 'asymptote':
        return solve_asymptote(model)
    if model.get('task') == 'sequence_limit':
        return solve_sequence_limit(model)
    raise ValueError('当前没有该题型的求解内核')


def evaluate_limit_extra(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    solution = solve_limit_extra(model)
    if model.get('task') == 'asymptote':
        function = parse_expression(str(model['expression']), ('x',))
        details = solution['asymptote_details']
        vertical = [float(sp.sympify(item['value'], locals={'x': X}))
                    for item in details['asymptotes'] if item['kind'] == 'vertical']
        lower = min(-8.0, min(vertical) - 8.0) if vertical else -8.0
        upper = max(8.0, max(vertical) + 8.0) if vertical else 8.0
        func = sp.lambdify(X, function, 'math')
        series = []
        for index in range(260):
            x = lower + (upper - lower) * index / 259
            if vertical and min(abs(x - a) for a in vertical) < 1e-9:
                series.append(dict(x=x, y=None))
                continue
            try:
                value = float(func(x))
                series.append(dict(x=x, y=value if abs(value) < 1e6 else None))
            except (ValueError, ZeroDivisionError, OverflowError):
                series.append(dict(x=x, y=None))
        return dict(subject='calculus', kind='limit', headline=solution['answer'],
                    metrics=[dict(id='asymptotes', label='渐近线', value=solution['answer'])],
                    checks=[], notes=['曲线为有理函数图像，垂直渐近线附近截断显示；结论以符号极限为准。'],
                    trace=[dict(index=0, label='渐近线', detail=solution['answer'], values={})],
                    series=series, rects=[], domain={'x_min': lower, 'x_max': upper},
                    exact=None, approx=None, error=None, answerText=solution['answer'])
    term = _sequence_term(model)
    details = solution['sequence_details']
    func = sp.lambdify(N, term, 'math')
    series = []
    for index in range(120):
        n = 1 + index
        try:
            value = float(func(n))
            series.append(dict(x=float(n), y=value if math.isfinite(value) else None))
        except (ValueError, ZeroDivisionError, OverflowError):
            series.append(dict(x=float(n), y=None))
    limit_value = None
    if details.get('limit'):
        try:
            limit_value = float(sp.sympify(str(details['limit']).replace('e', 'E')).evalf())
        except Exception:  # noqa: BLE001
            limit_value = None
    return dict(subject='calculus', kind='limit', headline=solution['answer'],
                metrics=[dict(id='limit', label='数列极限', value=details['status_label'])],
                checks=[], notes=['散点为数列前 120 项；结论由符号极限给出，散点只作观察。'],
                trace=[dict(index=0, label='数列极限', detail=solution['answer'], values={})],
                series=series, rects=[], domain={'x_min': 1, 'x_max': 120},
                exact=limit_value, approx=None, error=None, answerText=solution['answer'])


__all__ = ['build_problem', 'solve_limit_extra', 'evaluate_limit_extra']
