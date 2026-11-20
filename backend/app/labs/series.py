"""Series: numerical convergence, power-series radius/sum/expansion and Fourier series."""
from __future__ import annotations

import math
from typing import Any, Mapping

import sympy as sp

from .expr import expression_text, parse_expression, safe_float, to_latex

N = sp.Symbol('n', integer=True, positive=True)
X = sp.Symbol('x', real=True)


def _constant(raw: Any, label: str) -> sp.Expr:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError(f'缺少{label}')
    value = parse_expression(raw, ('x',))
    if value.free_symbols or safe_float(value) is None:
        raise ValueError(f'{label}必须是有限实数')
    return value


def _parse_term(raw: Any) -> sp.Expr:
    if not isinstance(raw, str) or not 1 <= len(raw) <= 600:
        raise ValueError('通项必须是600字以内的表达式')
    value = parse_expression(raw, ('n',))
    value = value.xreplace({sp.Symbol('n', real=True): N})
    if value.free_symbols - {N}:
        raise ValueError('通项只能含有指标 n')
    return value


def _parse_coefficient(raw: Any) -> sp.Expr:
    if not isinstance(raw, str) or not 1 <= len(raw) <= 600:
        raise ValueError('幂级数系数必须是600字以内的表达式')
    value = parse_expression(raw, ('n',))
    value = value.xreplace({sp.Symbol('n', real=True): N})
    if value.free_symbols - {N}:
        raise ValueError('幂级数系数只能含有指标 n')
    return value


def _tail_singularity(expression: sp.Expr, start: int) -> tuple[bool, int | None]:
    """Whether a pole provably lands on an integer index at or after start."""
    try:
        singular = sp.singularities(expression, N)
        suspects = sp.Intersection(singular, sp.S.Integers, sp.Interval(start, sp.oo))
        empty = suspects.is_empty
    except (TypeError, ValueError, NotImplementedError):
        return False, None
    if empty is not False:
        return False, None
    point = None
    if isinstance(suspects, sp.FiniteSet):
        points = [int(item) for item in suspects.args if item.is_integer is True]
        point = min(points) if points else None
    return True, point


def _tail_domain_gap(expression: sp.Expr, start: int) -> tuple[bool, int | None]:
    """Whether the real domain provably misses an integer index at or after start."""
    from sympy.calculus.util import continuous_domain
    try:
        domain = continuous_domain(expression, N, sp.S.Reals)
        tail = sp.Interval(start, sp.oo)
        if tail.is_subset(domain) is True:
            return False, None
        gap = sp.Intersection(sp.Complement(tail, domain), sp.S.Integers)
        empty = gap.is_empty
    except (TypeError, ValueError, NotImplementedError):
        return False, None
    if empty is not False:
        return False, None
    point = None
    if isinstance(gap, sp.FiniteSet):
        points = [int(item) for item in gap.args if item.is_integer is True]
        point = min(points) if points else None
    elif isinstance(gap, sp.Range) and gap.start.is_integer is True:
        point = int(gap.start)
    return True, point


def ensure_defined_from(expression: sp.Expr, start: int, label: str = '通项') -> None:
    """Reject an item that is not a finite real number at every index n >= start."""
    if safe_float(sp.simplify(expression.subs(N, start))) is None:
        raise ValueError(f'{label}在 n={start} 处必须取有限实数值')
    undefined, point = _tail_singularity(expression, start)
    if not undefined:
        undefined, point = _tail_domain_gap(expression, start)
    if undefined:
        where = f'n={point}' if point is not None else f'n≥{start} 的某些整数点'
        raise ValueError(f'{label}在 {where} 处无定义，不能继续级数判定')


def _positive_test(term: sp.Expr, start: int) -> tuple[bool | None, str]:
    try:
        total = sp.summation(term, (N, start, sp.oo))
        if not total.has(sp.Sum) and not total.has(sp.Integral):
            numeric = safe_float(total)
            if numeric is not None:
                return True, '求和得到有限值'
            if total in (sp.oo, -sp.oo, sp.zoo) or total is sp.nan:
                return False, '求和发散'
    except Exception:  # noqa: BLE001
        pass
    try:
        test = sp.Sum(term, (N, start, sp.oo)).is_convergent()
        if test == True:  # SymPy returns BooleanTrue/BooleanFalse, not Python bool
            return True, 'SymPy 收敛判定'
        if test == False:  # noqa: E712
            return False, 'SymPy 发散判定'
    except Exception:  # noqa: BLE001
        pass
    try:
        ratio = sp.simplify(sp.Abs(term.subs(N, N + 1) / term))
        limit = sp.limit(ratio, N, sp.oo)
        if limit == sp.oo:
            return False, '比值审敛法：ρ=∞'
        numeric = safe_float(limit)
        if numeric is not None:
            if numeric < 1 - 1e-9:
                return True, f'比值审敛法：ρ={numeric:g}<1'
            if numeric > 1 + 1e-9:
                return False, f'比值审敛法：ρ={numeric:g}>1'
    except Exception:  # noqa: BLE001
        pass
    try:
        root = sp.limit(sp.Abs(term) ** (1 / N), N, sp.oo)
        numeric = safe_float(root)
        if numeric is not None:
            if numeric < 1 - 1e-9:
                return True, f'根值审敛法：ρ={numeric:g}<1'
            if numeric > 1 + 1e-9:
                return False, f'根值审敛法：ρ={numeric:g}>1'
    except Exception:  # noqa: BLE001
        pass
    try:
        numerator, denominator = sp.fraction(sp.cancel(term))
        if not numerator.has(N) and denominator.is_Pow and denominator.base == N:
            power = denominator.exp
            numeric = safe_float(power)
            if numeric is not None:
                return numeric > 1, f'p 级数：p={numeric:g}'
    except Exception:  # noqa: BLE001
        pass
    return None, '常用判别法未给出结论'


def _nonincreasing_from(candidate: sp.Expr, start: int) -> bool:
    try:
        difference = sp.simplify(candidate.subs(N, N + 1) - candidate)
    except Exception:  # noqa: BLE001
        return False
    if difference.is_nonpositive is True or difference.is_zero is True:
        return True
    t = sp.Symbol('t', positive=True)
    try:
        derivative = sp.simplify(sp.diff(candidate.xreplace({N: t}), t))
        if derivative.is_nonpositive is True:
            return True
    except Exception:  # noqa: BLE001
        derivative = None
    from sympy.solvers.inequalities import solve_univariate_inequality
    for expression in (difference.xreplace({N: t}), derivative):
        if expression is None:
            continue
        try:
            region = solve_univariate_inequality(expression <= 0, t, relational=False)
            if sp.Interval(start, sp.oo).is_subset(region):
                return True
        except Exception:  # noqa: BLE001
            continue
    return False


def _positive_from(candidate: sp.Expr, start: int) -> bool:
    """A candidate may only be real-signed from the series start, e.g. 1/(n-2) from n=3."""
    if candidate.is_nonnegative is True or candidate.is_positive is True:
        return True
    k = sp.Symbol('k', integer=True, positive=True)
    try:
        shifted = sp.simplify(candidate.subs(N, k + start - 1))
    except Exception:  # noqa: BLE001
        return False
    return shifted.is_nonnegative is True or shifted.is_positive is True


def _alternating_part(term: sp.Expr, start: int = 1) -> tuple[sp.Expr, int] | None:
    """Return the positive alternating factor and the first index where Leibniz applies.

    Dropping finitely many initial terms does not affect convergence, so a sequence that is
    eventually nonnegative and nonincreasing is still eligible for the alternating test.
    """
    for sign in (-1) ** N, (-1) ** (N + 1), (-1) ** (N - 1):
        candidate = sp.simplify(sp.powsimp(term / sign, force=True))
        if candidate.has((-1) ** N):
            continue
        try:
            if sp.limit(candidate, N, sp.oo) != 0:
                continue
            offsets = [start] + [start + step for step in range(1, 11)] + [start + 20, start + 50]
            for offset in offsets:
                if _positive_from(candidate, offset) and _nonincreasing_from(candidate, offset):
                    return sp.simplify(candidate), offset
        except Exception:  # noqa: BLE001
            continue
    return None


def classify_series(term: sp.Expr, start: int = 1) -> dict[str, Any]:
    absolute, absolute_method = _positive_test(sp.Abs(term), start)
    if absolute is True:
        return {'status': 'absolutely_convergent', 'method': absolute_method, 'absolute': True}
    try:
        term_limit = sp.limit(sp.Abs(term), N, sp.oo)
        limit_numeric = safe_float(term_limit)
    except Exception:  # noqa: BLE001
        term_limit = None
        limit_numeric = None
    if limit_numeric is not None and limit_numeric > 1e-9:
        return {'status': 'divergent', 'method': f'通项不趋于 0（|a_n|→{limit_numeric:g}）', 'absolute': False}
    if absolute is False and sp.simplify(term - sp.Abs(term)) == 0:
        return {'status': 'divergent', 'method': absolute_method, 'absolute': False}
    alternating = _alternating_part(term, start)
    if alternating is not None:
        _, offset = alternating
        method = 'Leibniz 交错级数判别法'
        if offset != start:
            method += f'（从 n={offset} 起满足条件）'
        if absolute is False:
            return {'status': 'conditionally_convergent', 'method': method, 'absolute': False}
        return {'status': 'undetermined', 'method': method + '；绝对收敛性未判定', 'absolute': None}
    if absolute is False:
        return {'status': 'divergent', 'method': absolute_method, 'absolute': False}
    return {'status': 'undetermined', 'method': absolute_method, 'absolute': None}


def _series_answer(term: sp.Expr, start: int) -> dict[str, Any]:
    classification = classify_series(term, start)
    status = classification['status']
    total_text = None
    if status in ('absolutely_convergent', 'conditionally_convergent'):
        try:
            total = sp.summation(term, (N, start, sp.oo))
            if not total.has(sp.Sum) and safe_float(total) is not None:
                total_text = str(total)
        except Exception:  # noqa: BLE001
            total_text = None
    labels = {
        'absolutely_convergent': '绝对收敛',
        'conditionally_convergent': '条件收敛',
        'divergent': '发散',
        'undetermined': '无法判定',
    }
    answer = labels[status] + (f'（{classification["method"]}）' if classification.get('method') else '')
    if total_text:
        answer += f'，和为 {total_text}'
    complete = status != 'undetermined'
    return {
        'status': status,
        'answer': answer,
        'method': classification.get('method'),
        'sum_value': total_text,
        'complete': complete,
    }


def build_series_problem(conditions: Mapping[str, Any]) -> dict:
    from .exam_math import _condition
    term = _parse_term(conditions.get('term'))
    raw_start = conditions.get('index_start')
    start = int(1 if raw_start in (None, '') else raw_start)
    if start < 0 or start > 100:
        raise ValueError('级数起始指标必须在 0 至 100 之间')
    ensure_defined_from(term, start, '级数通项')
    model = {
        'engine': 'series_v1', 'subject': 'calculus', 'task': 'series_convergence',
        'kind': 'series_convergence', 'term': expression_text(term), 'index_variable': 'n',
        'index_start': start, 'defaults': {'start': start}, 'params': [], 'teaching': False,
        'formula_tex': rf'\sum_{{n={start}}}^{{\infty}} {to_latex(term)}',
    }
    conditions_list = [
        _condition('term', '级数通项', model['term'], {}, kind='expr'),
        _condition('index_start', '起始指标', start, {}, kind='number'),
    ]
    return {
        'problem_id': 'prb_series', 'number': None, 'title': '数项级数', 'text': '',
        'subject': 'calculus', 'subject_label': '微积分', 'confidence': 1.0, 'status': 'ready',
        'source': {'page_from': 1, 'page_to': 1, 'file_names': [], 'label': '声明式条件', 'excerpt': ''},
        'source_pages': [],
        'recognition': {'method': 'declarative_kernel', 'raw_text': '', 'conditions': conditions_list,
                        'ambiguities': [], 'formulas': [{'id': 'series', 'tex': model['formula_tex'], 'plain': model['term'], 'role': '级数'}],
                        'recognized_subject': 'calculus', 'ai_used': False},
        'model': model, 'solution': {}, 'states': {}, 'conditions': conditions_list,
        'ambiguities': [], 'recognized': True,
        'formulas': [{'id': 'series', 'tex': model['formula_tex'], 'plain': model['term'], 'role': '级数'}],
    }


def _undefined_series_solution(term: sp.Expr, start: int, reason: str) -> dict:
    return {
        'summary': reason, 'answer': '', 'answer_value': None, 'exact': '', 'approx': None,
        'steps': [{'id': 'term', 'title': '检查通项', 'latex': to_latex(term),
                   'detail': '通项必须在每个整数指标上取有限实数值，当前条件不满足。'}],
        'conditions': [f'从 n={start} 开始。'],
        'limitations': [reason, '通项存在无定义的整数项，因此不给出敛散性或和。'],
        'series_status': 'undetermined', 'series_method': None, 'series_sum': None,
        'series_details': {
            'term': expression_text(term), 'index_start': start,
            'status': 'undetermined', 'status_label': '无法判定',
            'method': None, 'sum_value': None, 'note': reason,
        },
        'solution_status': 'unsupported', 'solution_complete': False, 'incomplete_reason': reason,
    }


def solve_series_convergence(model: Mapping[str, Any]) -> dict:
    term = _parse_term(model.get('term'))
    start = int(1 if model.get('index_start') in (None, '') else model.get('index_start'))
    try:
        ensure_defined_from(term, start, '级数通项')
    except ValueError as exc:
        return _undefined_series_solution(term, start, str(exc))
    result = _series_answer(term, start)
    status_labels = {
        'absolutely_convergent': '绝对收敛', 'conditionally_convergent': '条件收敛',
        'divergent': '发散', 'undetermined': '无法判定',
    }
    return {
        'summary': '数项级数：先看通项是否趋于 0，再判断绝对收敛、条件收敛或发散。',
        'answer': result['answer'],
        'answer_value': safe_float(result['sum_value']) if result['sum_value'] else None,
        'exact': result['sum_value'],
        'approx': None,
        'steps': [
            {'id': 'term', 'title': '检查通项', 'latex': to_latex(term), 'detail': '通项不趋于 0 可直接判发散；否则选择比值、根值、p 级数或 Leibniz 判别。'},
            {'id': 'test', 'title': '选择判别法', 'latex': r'\rho=\lim\left|\frac{a_{n+1}}{a_n}\right|', 'detail': result.get('method') or '常用判别法未给出结论。'},
            {'id': 'endpoint', 'title': '判断绝对/条件收敛', 'latex': r'\sum |a_n|', 'detail': result['answer']},
        ],
        'conditions': [f'从 n={start} 开始。'],
        'limitations': ['数值部分和只能作为观察；未得到符号判别结论时不会标为收敛或发散。'],
        'series_status': result['status'],
        'series_method': result.get('method'),
        'series_sum': result.get('sum_value'),
        'series_details': {
            'term': expression_text(term), 'index_start': start,
            'status': result['status'], 'status_label': status_labels[result['status']],
            'method': result.get('method'), 'sum_value': result.get('sum_value'),
            'note': '结论来自符号判别；数值部分和只用于观察，不替代敛散性结论。',
        },
        'solution_status': 'complete' if result['complete'] else 'incomplete',
        'solution_complete': result['complete'],
        'incomplete_reason': None if result['complete'] else '常用级数判别法未给出确定结论',
    }


def build_power_series_problem(conditions: Mapping[str, Any]) -> dict:
    from .exam_math import _condition
    goal = str(conditions.get('goal') or 'radius')
    if goal not in ('radius', 'sum', 'expand'):
        raise ValueError('幂级数目标只支持 radius、sum、expand')
    center = _constant(str(conditions.get('center') or 0), '展开中心')
    start = int(conditions.get('index_start') or 0)
    if start < 0 or start > 100:
        raise ValueError('幂级数起始指标必须在 0 至 100 之间')
    model = {
        'engine': 'power_series_v1', 'subject': 'calculus', 'task': 'power_series',
        'kind': 'power_series', 'goal': goal, 'variable': 'x', 'center': str(center),
        'index_start': start, 'defaults': {'center': float(center), 'order': 5}, 'params': [],
        'teaching': False,
    }
    conditions_list = [
        _condition('center', '展开中心', str(center), {}, kind='number'),
        _condition('goal', '幂级数目标', goal, {}, kind='text'),
    ]
    if goal in ('radius', 'sum'):
        coefficient = _parse_coefficient(conditions.get('coefficient'))
        # 只有显式给出起始指标时才校验尾部定义域；文本识别沿用历史默认 n=0。
        if conditions.get('index_start') not in (None, ''):
            ensure_defined_from(coefficient, start, '幂级数系数')
        model['coefficient'] = expression_text(coefficient)
        model['formula_tex'] = rf'\sum_{{n={start}}}^{{\infty}} {to_latex(coefficient)}(x-{to_latex(center)})^n'
        conditions_list.append(_condition('coefficient', '幂级数系数', model['coefficient'], {}, kind='expr'))
    else:
        expression = parse_expression(str(conditions.get('expression') or ''), ('x',))
        order = int(conditions.get('order') or 5)
        if order < 1 or order > 12:
            raise ValueError('展开阶数必须在 1 至 12 之间')
        model.update(expression=expression_text(expression), order=order)
        model['formula_tex'] = rf'{to_latex(expression)}\quad x_0={to_latex(center)}'
        conditions_list.extend([
            _condition('expression', '函数表达式', model['expression'], {}, kind='expr'),
            _condition('order', '展开阶数', order, {}, kind='number'),
        ])
    return {
        'problem_id': 'prb_power_series', 'number': None, 'title': '幂级数', 'text': '',
        'subject': 'calculus', 'subject_label': '微积分', 'confidence': 1.0, 'status': 'ready',
        'source': {'page_from': 1, 'page_to': 1, 'file_names': [], 'label': '声明式条件', 'excerpt': ''},
        'source_pages': [],
        'recognition': {'method': 'declarative_kernel', 'raw_text': '', 'conditions': conditions_list,
                        'ambiguities': [], 'formulas': [{'id': 'power_series', 'tex': model['formula_tex'], 'plain': model.get('coefficient', model.get('expression', '')), 'role': '幂级数'}],
                        'recognized_subject': 'calculus', 'ai_used': False},
        'model': model, 'solution': {}, 'states': {}, 'conditions': conditions_list,
        'ambiguities': [], 'recognized': True,
        'formulas': [{'id': 'power_series', 'tex': model['formula_tex'], 'plain': model.get('coefficient', model.get('expression', '')), 'role': '幂级数'}],
    }


def _interval_text(center: sp.Expr, radius: sp.Expr, left_open: bool, right_open: bool) -> str:
    if radius is sp.oo:
        return '(-∞, +∞)'
    if radius == 0:
        return f'{{{center}}}'
    left = center - radius
    right = center + radius
    return f"{'(' if left_open else '['}{left}, {right}{')' if right_open else ']'}"


def _power_radius(coefficient: sp.Expr) -> tuple[sp.Expr | None, str]:
    if coefficient == 0:
        return sp.oo, '零幂级数'
    try:
        ratio = sp.limit(sp.Abs(coefficient.subs(N, N + 1) / coefficient), N, sp.oo)
        if ratio == sp.oo:
            return sp.Integer(0), '比值审敛法：ρ=∞'
        if ratio.is_zero is True:
            return sp.oo, '比值审敛法：ρ=0'
        numeric = safe_float(ratio)
        if numeric is not None:
            if numeric == 0:  # exact value below float range: keep the reciprocal exact
                return sp.simplify(1 / ratio), '比值审敛法：R=1/ρ'
            return sp.simplify(1 / ratio), f'比值审敛法：R=1/ρ={1 / numeric:g}'
    except Exception:  # noqa: BLE001
        pass
    try:
        root = sp.limit(sp.Abs(coefficient) ** (1 / N), N, sp.oo)
        if root == sp.oo:
            return sp.Integer(0), '根值审敛法：ρ=∞'
        if root.is_zero is True:
            return sp.oo, '根值审敛法：ρ=0'
        numeric = safe_float(root)
        if numeric is not None:
            if numeric == 0:
                return sp.simplify(1 / root), '根值审敛法：R=1/ρ'
            return sp.simplify(1 / root), f'根值审敛法：R=1/ρ={1 / numeric:g}'
    except Exception:  # noqa: BLE001
        pass
    return None, '无法由比值或根值审敛法确定收敛半径'


def _undefined_power_solution(coefficient: sp.Expr, center: sp.Expr, start: int,
                              goal: str, reason: str) -> dict:
    return {
        'summary': reason, 'answer': '', 'answer_value': None, 'exact': '', 'approx': None,
        'steps': [{'id': 'coefficient', 'title': '检查系数', 'latex': to_latex(coefficient),
                   'detail': '幂级数系数必须在每个整数指标上取有限实数值，当前条件不满足。'}],
        'conditions': [f'展开中心 {center}，从 n={start} 开始。'],
        'limitations': [reason, '系数存在无定义的整数项，因此不给出收敛半径、收敛域或和函数。'],
        'power_goal': goal, 'center': str(center), 'radius': None, 'radius_method': None,
        'interval': None, 'endpoint_status': [], 'sum_function': None,
        'coefficient': expression_text(coefficient), 'index_start': start,
        'power_details': {
            'goal': goal, 'center': str(center), 'index_start': start,
            'coefficient': expression_text(coefficient), 'radius': None,
            'radius_method': None, 'interval': None, 'endpoints': [],
            'sum_function': None, 'note': reason,
        },
        'solution_status': 'unsupported', 'solution_complete': False, 'incomplete_reason': reason,
    }


def solve_power_series(model: Mapping[str, Any]) -> dict:
    goal = model.get('goal', 'radius')
    center = _constant(str(model.get('center') or 0), '展开中心')
    start = int(model.get('index_start') or 0)
    if goal == 'expand':
        from .calculus_analysis import _taylor_report
        report = _taylor_report({
            'expression': model.get('expression'), 'variable': 'x',
            'taylor_point': str(center), 'order': int(model.get('order') or 5),
        })
        if report.get('status') != 'complete':
            return {
                'summary': report.get('reason', '幂级数展开未完成'), 'answer': '', 'answer_value': None,
                'steps': [], 'conditions': [], 'limitations': [report.get('reason', '展开未完成')],
                'solution_status': report.get('status', 'incomplete'), 'solution_complete': False,
                'incomplete_reason': report.get('reason', '幂级数展开未完成'),
            }
        polynomial = str(report['polynomial']).replace('**', '^')
        coefficients = [{'order': index, 'value': str(value)} for index, value in enumerate(report['coefficients'])]
        return {
            'summary': '函数在给定点展开为幂级数（泰勒多项式 + 余项）。',
            'answer': f'{polynomial}+{report["remainder_text"]}', 'answer_value': None,
            'exact': polynomial, 'approx': None,
            'steps': [{'id': 'expand', 'title': '逐阶展开', 'latex': to_latex(report['polynomial']), 'detail': f'展开中心 x={center}，阶数 {report["order"]}。'}],
            'conditions': [f'展开中心 x={center}。'],
            'limitations': ['余项只说明局部逼近；收敛域需另行判断。'],
            'power_goal': 'expand', 'center': str(center), 'order': report['order'],
            'coefficients': coefficients, 'polynomial': polynomial,
            'power_details': {
                'goal': 'expand', 'center': str(center), 'index_start': start,
                'coefficient': expression_text(parse_expression(str(model.get('expression')), ('x',))),
                'radius': None, 'radius_method': None, 'interval': None,
                'endpoints': [], 'sum_function': polynomial,
                'note': '余项只说明局部逼近；收敛域需另行判断。',
            },
            'solution_status': 'complete', 'solution_complete': True,
        }
    coefficient = _parse_coefficient(model.get('coefficient'))
    if model.get('manual_series_conditions') is not None:
        try:
            ensure_defined_from(coefficient, start, '幂级数系数')
        except ValueError as exc:
            return _undefined_power_solution(coefficient, center, start, goal, str(exc))
    radius, radius_method = _power_radius(coefficient)
    endpoint_data = []
    complete = radius is not None
    if radius is not None and radius not in (0, sp.oo):
        for sign, label in ((-1, '左端点'), (1, '右端点')):
            point = center + sign * radius
            endpoint_term = coefficient * (sign * radius) ** N
            classification = classify_series(endpoint_term, start)
            endpoint_data.append({
                'label': label, 'point': str(point), 'status': classification['status'],
                'method': classification.get('method'), 'included': classification['status'] in ('absolutely_convergent', 'conditionally_convergent'),
            })
            if classification['status'] == 'undetermined':
                complete = False
    included = [item for item in endpoint_data if item['included']]
    left_open = not any(item['label'] == '左端点' for item in included)
    right_open = not any(item['label'] == '右端点' for item in included)
    interval = _interval_text(center, radius, left_open, right_open) if radius is not None else ''
    sum_function = None
    if goal == 'sum':
        try:
            summed = sp.summation(coefficient * (X - center) ** N, (N, start, sp.oo))
            if isinstance(summed, sp.Piecewise):
                branches = [pair[0] for pair in summed.args if not pair[0].has(sp.Sum)]
                summed = branches[0] if branches else None
            if summed is not None and not summed.has(sp.Sum) and summed.free_symbols <= {X}:
                sum_function = expression_text(summed)
            else:
                complete = False
        except Exception:  # noqa: BLE001
            complete = False
    answer = f'收敛半径 R={radius}' if radius is not None else '收敛半径未能确定'
    if interval:
        answer += f'，收敛区间 {interval}'
    if endpoint_data:
        answer += '；' + '；'.join(f'{item["label"]} {item["point"]}：{"收敛" if item["included"] else "发散"}' for item in endpoint_data)
    if sum_function:
        answer += f'；和函数 S(x)={sum_function}'
    return {
        'summary': '幂级数：先用比值/根值审敛法求收敛半径，再逐端点单独判断。',
        'answer': answer if complete else '',
        'answer_value': None,
        'exact': answer,
        'approx': None,
        'steps': [
            {'id': 'radius', 'title': '求收敛半径', 'latex': r'R=1/\rho,\quad \rho=\lim|a_{n+1}/a_n|', 'detail': radius_method},
            {'id': 'endpoint', 'title': '逐端点判断', 'latex': r'x=x_0\pm R', 'detail': '收敛半径内绝对收敛；端点必须单独代入原级数判断，不能直接继承开区间结论。'},
            {'id': 'interval', 'title': '写出收敛域', 'latex': interval, 'detail': answer},
        ],
        'conditions': [f'展开中心 {center}，从 n={start} 开始。'],
        'limitations': ['端点敛散性未确定时会标为未完成；和函数只有在符号求和成功时给出。'],
        'power_goal': goal, 'center': str(center), 'radius': str(radius) if radius is not None else None,
        'radius_method': radius_method, 'interval': interval, 'endpoint_status': endpoint_data,
        'sum_function': sum_function, 'coefficient': expression_text(coefficient), 'index_start': start,
        'power_details': {
            'goal': goal, 'center': str(center), 'index_start': start,
            'coefficient': expression_text(coefficient),
            'radius': str(radius) if radius is not None else None,
            'radius_method': radius_method, 'interval': interval,
            'endpoints': endpoint_data, 'sum_function': sum_function,
            'note': '端点必须单独代入原级数判断；和函数只在符号求和成功时给出。',
        },
        'solution_status': 'complete' if complete else 'incomplete',
        'solution_complete': complete,
        'incomplete_reason': None if complete else '收敛半径、端点敛散性或和函数尚未完成',
    }


def evaluate_power_series(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict:
    solution = solve_power_series(model)
    if model.get('goal') == 'expand':
        return {
            'subject': 'calculus', 'task': 'power_series', 'kind': 'power_series',
            'headline': solution.get('answer') or solution.get('summary') or '幂级数展开',
            'metrics': [
                {'id': 'order', 'label': '展开阶数', 'value': str(solution.get('order') or model.get('order') or 0), 'accent': True},
                {'id': 'polynomial', 'label': '展开式', 'value': solution.get('polynomial') or '—'},
            ],
            'checks': [
                {'id': 'expansion', 'label': '幂级数展开', 'status': 'pass' if solution.get('solution_complete') else 'fail',
                 'detail': solution.get('answer') or solution.get('incomplete_reason') or ''},
            ],
            'notes': solution.get('limitations') or [],
            'series': [], 'domain': {'x_min': -3, 'x_max': 3}, 'rects': [],
            'exact': None, 'approx': None, 'error': None,
            'answerText': solution.get('answer') or '',
            'trace': [{'index': 0, 'label': '展开', 'detail': solution.get('polynomial') or '', 'values': {}}],
            'power': {'goal': 'expand', 'center': solution.get('center'), 'polynomial': solution.get('polynomial'),
                      'coefficients': solution.get('coefficients') or [], 'radius': None, 'interval': None,
                      'endpoints': [], 'sum_function': None},
            'power_solution': solution,
        }
    center = float(model.get('defaults', {}).get('center', 0))
    radius_text = solution.get('radius')
    radius = safe_float(radius_text) if radius_text not in (None, 'oo') else None
    span = radius if radius is not None and radius > 0 else 2.0
    low, high = center - span, center + span
    series = []
    overlay = []
    if solution.get('sum_function'):
        try:
            func = sp.lambdify(X, parse_expression(solution['sum_function'], ('x',)), 'math')
            for index in range(240):
                value = low + (high - low) * index / 239
                try:
                    y = float(func(value))
                except Exception:  # noqa: BLE001
                    y = None
                series.append({'x': round(value, 6), 'y': None if y is None or not math.isfinite(y) else round(y, 6)})
        except Exception:  # noqa: BLE001
            series = []
    return {
        'subject': 'calculus', 'task': 'power_series', 'kind': 'power_series',
        'headline': solution.get('answer') or solution.get('summary') or '幂级数',
        'metrics': [
            {'id': 'radius', 'label': '收敛半径', 'value': solution.get('radius') or '—', 'accent': True},
            {'id': 'interval', 'label': '收敛区间', 'value': solution.get('interval') or '—'},
            {'id': 'sum', 'label': '和函数', 'value': solution.get('sum_function') or '—'},
        ],
        'checks': [
            {'id': 'radius', 'label': '收敛半径', 'status': 'pass' if solution.get('radius') else 'fail', 'detail': solution.get('radius_method') or ''},
            {'id': 'endpoints', 'label': '端点分别判断', 'status': 'pass' if solution.get('solution_complete') else 'warn', 'detail': '端点单独代入原级数。' if solution.get('solution_complete') else '端点或和函数尚未完成。'},
        ],
        'notes': solution.get('limitations') or [],
        'series': series, 'domain': {'x_min': low, 'x_max': high}, 'rects': [],
        'exact': None, 'approx': None, 'error': None,
        'answerText': solution.get('answer') or '',
        'trace': [{'index': 0, 'label': '收敛半径', 'detail': solution.get('radius_method') or '', 'values': {}}],
        'power': {
            'goal': solution.get('power_goal'), 'center': center, 'radius': solution.get('radius'),
            'interval': solution.get('interval'), 'endpoints': solution.get('endpoint_status') or [],
            'sum_function': solution.get('sum_function'), 'polynomial': solution.get('polynomial'),
            'coefficients': solution.get('coefficients') or [],
        },
        'power_solution': solution,
    }


def build_fourier_problem(conditions: Mapping[str, Any]) -> dict:
    from .exam_math import _condition
    from sympy.calculus.util import continuous_domain
    expression = parse_expression(str(conditions.get('expression') or ''), ('x',), preserve_structure=True)
    lower = _constant(str(conditions.get('lower') or '-pi'), '区间下限')
    upper = _constant(str(conditions.get('upper') or 'pi'), '区间上限')
    if not bool(lower < upper):
        raise ValueError('傅里叶区间必须从小到大')
    domain = continuous_domain(expression, X, sp.S.Reals)
    if sp.Interval(lower, upper).is_subset(domain) is not True:
        raise ValueError('傅里叶级数要求函数在整个闭区间上有实定义且连续，不自动跨越无定义点')
    order = int(conditions.get('order') or 5)
    if order < 1 or order > 12:
        raise ValueError('傅里叶级数阶数必须在 1 至 12 之间')
    model = {
        'engine': 'fourier_v1', 'subject': 'calculus', 'task': 'fourier_series',
        'kind': 'fourier_series', 'expression': expression_text(expression),
        'lower': str(lower), 'upper': str(upper), 'order': order,
        'defaults': {'lower': float(lower), 'upper': float(upper), 'order': order},
        'params': [dict(id='order', label='部分和截断阶数', kind='integer', min=1, max=order, step=1, options=[])], 'teaching': False,
        'formula_tex': rf'{to_latex(expression)}\quad x\in[{to_latex(lower)},{to_latex(upper)}]',
    }
    conditions_list = [
        _condition('expression', '周期函数', model['expression'], {}, kind='expr'),
        _condition('lower', '区间下限', str(lower), {}, kind='number'),
        _condition('upper', '区间上限', str(upper), {}, kind='number'),
        _condition('order', '截断阶数', order, {}, kind='number'),
    ]
    return {
        'problem_id': 'prb_fourier', 'number': None, 'title': '傅里叶级数', 'text': '',
        'subject': 'calculus', 'subject_label': '微积分', 'confidence': 1.0, 'status': 'ready',
        'source': {'page_from': 1, 'page_to': 1, 'file_names': [], 'label': '声明式条件', 'excerpt': ''},
        'source_pages': [],
        'recognition': {'method': 'declarative_kernel', 'raw_text': '', 'conditions': conditions_list,
                        'ambiguities': [], 'formulas': [{'id': 'fourier', 'tex': model['formula_tex'], 'plain': model['expression'], 'role': '傅里叶级数'}],
                        'recognized_subject': 'calculus', 'ai_used': False},
        'model': model, 'solution': {}, 'states': {}, 'conditions': conditions_list,
        'ambiguities': [], 'recognized': True,
        'formulas': [{'id': 'fourier', 'tex': model['formula_tex'], 'plain': model['expression'], 'role': '傅里叶级数'}],
    }


def solve_fourier(model: Mapping[str, Any]) -> dict:
    expression = parse_expression(str(model.get('expression') or ''), ('x',))
    lower = _constant(str(model.get('lower')), '区间下限')
    upper = _constant(str(model.get('upper')), '区间上限')
    order = int(model.get('order') or 5)
    period = sp.simplify(upper - lower)
    coefficients: list[dict[str, Any]] = []
    complete = True
    a0 = sp.simplify((2 / period) * sp.integrate(expression, (X, lower, upper)))
    if a0.has(sp.Integral) or safe_float(a0) is None:
        complete = False
    centered = sp.simplify(lower + upper) == 0
    def basis(index, function):
        if centered:
            return function(index * sp.pi * X / upper)
        return function(2 * sp.pi * index * (X - lower) / period)
    an_values = []
    bn_values = []
    for index in range(1, order + 1):
        an = sp.simplify((2 / period) * sp.integrate(expression * basis(index, sp.cos), (X, lower, upper)))
        bn = sp.simplify((2 / period) * sp.integrate(expression * basis(index, sp.sin), (X, lower, upper)))
        if an.has(sp.Integral) or bn.has(sp.Integral) or safe_float(an) is None or safe_float(bn) is None:
            complete = False
        an_values.append(an)
        bn_values.append(bn)
        coefficients.append({'n': index, 'an': str(sp.simplify(an)), 'bn': str(sp.simplify(bn))})
    partial = a0 / 2
    for index, (an, bn) in enumerate(zip(an_values, bn_values), start=1):
        partial += an * basis(index, sp.cos) + bn * basis(index, sp.sin)
    partial = sp.simplify(partial)
    if partial.has(sp.Integral) or safe_float(partial.subs(X, lower)) is None:
        complete = False
    discontinuities = []
    try:
        singular = sp.singularities(expression, X)
        if isinstance(singular, sp.FiniteSet):
            discontinuities = [str(point) for point in singular if lower < point < upper]
    except Exception:  # noqa: BLE001
        pass
    endpoint_jump = False
    try:
        left_value, right_value = expression.subs(X, lower), expression.subs(X, upper)
        endpoint_jump = safe_float(left_value) is not None and safe_float(right_value) is not None and sp.simplify(left_value - right_value) != 0
    except Exception:  # noqa: BLE001
        endpoint_jump = False
    if discontinuities or endpoint_jump:
        note = '周期延拓在端点或内部间断点处按 Dirichlet 定理收敛到左右极限平均；不能把间断点函数值直接当作和函数值。'
    else:
        note = '函数在区间上连续；傅里叶级数在连续点收敛到函数值。'
    answer = (
        f'Fourier 级数：a0={a0}；'
        + '；'.join(f'a{n}={an}，b{n}={bn}' for n, an, bn in zip(range(1, order + 1), an_values, bn_values))
        + f'；截断到 n={order}。'
    )
    return {
        'summary': '傅里叶级数：在给定区间计算 a0、an、bn，并检查部分和逼近与间断点。',
        'answer': answer if complete else '',
        'answer_value': None,
        'exact': expression_text(partial) if complete else '',
        'approx': None,
        'steps': [
            {'id': 'coefficients', 'title': '计算傅里叶系数', 'latex': r'a_0=\frac{2}{T}\int f,\quad a_n=\frac{2}{T}\int f\cos\frac{2\pi nx}{T}',
             'detail': f'区间长度 T={period}；计算到 n={order}。'},
            {'id': 'partial', 'title': '写出截断级数', 'latex': to_latex(partial), 'detail': answer},
            {'id': 'convergence', 'title': '核对和函数', 'latex': r'\text{Dirichlet}', 'detail': note},
        ],
        'conditions': [f'区间 [{lower}, {upper}]，截断阶数 {order}。'],
        'limitations': ['系数积分未闭式完成时会标为未完成；间断点结论按 Dirichlet 定理说明。'],
        'fourier': {'a0': str(a0), 'coefficients': coefficients, 'partial': expression_text(partial),
                    'order': order, 'lower': str(lower), 'upper': str(upper), 'period': str(period),
                    'discontinuities': discontinuities, 'endpoint_jump': endpoint_jump, 'convergence_note': note},
        'fourier_details': {
            'a0': str(a0), 'coefficients': coefficients, 'partial': expression_text(partial),
            'order': order, 'lower': str(lower), 'upper': str(upper), 'period': str(period),
            'discontinuities': discontinuities, 'endpoint_jump': endpoint_jump,
            'convergence_note': note,
            'note': '系数按给定区间计算；连续点收敛到函数值，间断点按 Dirichlet 定理取左右极限平均。',
        },
        'solution_status': 'complete' if complete else 'incomplete',
        'solution_complete': complete,
        'incomplete_reason': None if complete else '傅里叶系数或部分和未得到有限闭式结果',
    }


def evaluate_fourier(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict:
    model = {**model, 'order': max(1, min(int(model.get('order') or 5), int(params.get('order', model.get('order') or 5))))}
    solution = solve_fourier(model)
    lower = float(model.get('defaults', {}).get('lower', -math.pi))
    upper = float(model.get('defaults', {}).get('upper', math.pi))
    order = int(model.get('order') or solution['fourier']['order'])
    expression = parse_expression(str(model.get('expression')), ('x',))
    partial = parse_expression(solution['fourier']['partial'], ('x',)) if solution.get('complete') else None
    series, overlay = [], []
    try:
        f = sp.lambdify(X, expression, 'math')
        p = sp.lambdify(X, partial, 'math') if partial is not None else None
        for index in range(240):
            value = lower + (upper - lower) * index / 239
            try:
                target = float(f(value))
            except Exception:  # noqa: BLE001
                target = None
            series.append({'x': round(value, 6), 'y': None if target is None or not math.isfinite(target) else round(target, 6)})
            if p is not None:
                try:
                    approx = float(p(value))
                except Exception:  # noqa: BLE001
                    approx = None
                overlay.append({'x': round(value, 6), 'y': None if approx is None or not math.isfinite(approx) else round(approx, 6)})
    except Exception:  # noqa: BLE001
        pass
    return {
        'subject': 'calculus', 'task': 'fourier_series', 'kind': 'fourier_series',
        'headline': f'傅里叶级数（n≤{order}）',
        'metrics': [
            {'id': 'order', 'label': '截断阶数', 'value': str(order), 'accent': True},
            {'id': 'a0', 'label': 'a₀', 'value': solution['fourier']['a0']},
            {'id': 'coefficients', 'label': '系数个数', 'value': str(len(solution['fourier']['coefficients']) * 2)},
            {'id': 'jump', 'label': '间断点', 'value': '有' if solution['fourier']['discontinuities'] or solution['fourier']['endpoint_jump'] else '无'},
        ],
        'checks': [
            {'id': 'coefficients', 'label': '系数计算', 'status': 'pass' if solution.get('solution_complete') else 'fail', 'detail': solution.get('incomplete_reason') or 'a0、an、bn 均已求出。'},
            {'id': 'convergence', 'label': '和函数与间断点', 'status': 'pass' if solution.get('solution_complete') else 'warn', 'detail': solution['fourier']['convergence_note']},
        ],
        'notes': solution.get('limitations') or [],
        'series': series, 'overlays': [{'id': 'fourier', 'label': '傅里叶部分和', 'series': overlay}],
        'domain': {'x_min': lower, 'x_max': upper}, 'rects': [],
        'exact': None, 'approx': None, 'error': None,
        'answerText': solution.get('answer') or '',
        'trace': [{'index': index, 'label': f'n={item["n"]}', 'detail': f'a{item["n"]}={item["an"]}，b{item["n"]}={item["bn"]}',
                   'values': {'n': item['n'], 'an': item['an'], 'bn': item['bn']}}
                  for index, item in enumerate(solution['fourier']['coefficients'])],
        'fourier': solution['fourier'],
        'fourier_solution': solution,
    }




def build_series_from_text(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """Small local recognizer for common series phrasing; AI/declarative remains primary."""
    import re as _re
    compact = (text.replace('−', '-').replace('≤', '<=').replace('≥', '>=')
               .replace('π', 'pi').replace('∞', 'oo').replace('Σ', '∑'))
    def finish(problem):
        problem['recognition']['raw_text'] = text
        problem['recognition']['method'] = 'typed_text'
        problem['source']['excerpt'] = text[:220]
        return problem
    if '傅里叶' in compact or 'Fourier' in compact:
        expr_match = _re.search(r'(?:f|y)\s*\(\s*x\s*\)\s*=\s*([^，,。；;]+)', compact)
        interval = _re.search(r'\[\s*(-?(?:\d+(?:\.\d+)?|pi))\s*,\s*(-?(?:\d+(?:\.\d+)?|pi))\s*\]', compact)
        order_match = _re.search(r'(?:前|展开到|取)\s*(\d+)\s*项', compact) or _re.search(r'n\s*=\s*(\d+)', compact)
        if expr_match:
            try:
                expression_text_raw = _re.split(r'\s*(?:在|上|，|,|。|区间)', expr_match.group(1))[0].strip()
                return finish(build_fourier_problem({
                    'expression': expression_text_raw,
                    'lower': interval.group(1) if interval else '-pi',
                    'upper': interval.group(2) if interval else 'pi',
                    'order': int(order_match.group(1)) if order_match else 5,
                }))
            except Exception:  # noqa: BLE001
                return None
    if '幂级数' in compact:
        body_match = _re.search(r'(?:[∑ΣE]|>=)\s*(.*?)(?:的|，|,|。|求|收敛)', compact) or _re.search(r'幂级数\s*(.*?)(?:的|，|,|。|求|收敛)', compact)
        body = body_match.group(1).strip() if body_match else ''
        body = _re.sub(r'^(?:[∑ΣE]|>=)\s*', '', body)
        if body:
            try:
                from .expr import parse_expression as _parse
                body_expr = _parse(body, ('n', 'x'))
                body_expr = body_expr.xreplace({sp.Symbol('n', real=True): N, sp.Symbol('x', real=True): X})
                coefficient = sp.simplify(body_expr / X ** N)
                if not coefficient.free_symbols - {N}:
                    center_match = _re.search(r'x\s*=\s*(-?\d+(?:\.\d+)?)', compact)
                    goal = 'sum' if '和函数' in compact else 'radius'
                    return finish(build_power_series_problem({
                        'goal': goal, 'coefficient': expression_text(coefficient),
                        'center': center_match.group(1) if center_match else '0',
                    }))
            except Exception:  # noqa: BLE001
                return None
    if '级数' in compact and '敛散' in compact or '级数' in compact and '收敛' in compact:
        body_match = _re.search(r'(?:[∑ΣE]|>=)\s*(.*?)(?:的|，|,|。|敛散|收敛)', compact) or _re.search(r'级数\s*(.*?)(?:的|，|,|。|敛散|收敛)', compact)
        body = body_match.group(1).strip() if body_match else ''
        body = _re.sub(r'^(?:[∑ΣE]|>=)\s*', '', body)
        body = _re.sub(r'^[_^]?\{?n\s*=\s*\d+\}?', '', body).strip()
        if body:
            try:
                return finish(build_series_problem({'term': body}))
            except Exception:  # noqa: BLE001
                return None
    return None


__all__ = [
    'build_fourier_problem', 'build_power_series_problem', 'build_series_problem',
    'classify_series', 'evaluate_fourier', 'evaluate_power_series', 'solve_fourier',
    'solve_power_series', 'solve_series_convergence',
]
