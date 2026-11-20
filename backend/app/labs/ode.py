"""Ordinary differential equations with initial conditions and optional geometric targets."""
from __future__ import annotations

import math
import re
from typing import Any, Mapping

import sympy as sp

from sympy.calculus.util import continuous_domain

from .expr import expression_text, parse_expression, safe_float, to_latex

MAX_ORDER = 3


def _constant(raw: Any, label: str) -> sp.Expr:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError(f'缺少{label}')
    value = parse_expression(raw, ('x',))
    if value.free_symbols or safe_float(value) is None:
        raise ValueError(f'{label}必须是有限实数')
    return value.xreplace({n:sp.Rational(str(n)) for n in value.atoms(sp.Float)})


def _normalize_equation(raw: Any, independent: str, dependent: str) -> tuple[str, str]:
    if not isinstance(raw, str) or not 1 <= len(raw) <= 600:
        raise ValueError('微分方程必须是600字以内的字符串')
    text = raw.replace('′', "'").replace('’', "'").replace('−', '-').replace('＝', '=')
    # OCR 常把 y'' 读成 y"（双引号/双撇号）——只在字母后替换以免误伤引号文本。
    text = re.sub(r'(?<=[A-Za-z])["”″]', "''", text)
    text = text.replace(f'{dependent}({independent})', dependent)
    text = re.sub(r'\b' + re.escape(dependent) + r'\s*\(\s*' + re.escape(independent) + r'\s*\)', dependent, text)
    # 莱布尼茨记法 dy/dx、d²y/dx²、d^2y/dx^2 → 撇号记法。
    _dep, _ind = re.escape(dependent), re.escape(independent)
    for _order, _glyph in ((3, r'3|³'), (2, r'2|²')):
        text = re.sub(
            rf'd\s*(?:\^\s*)?(?:{_glyph})\s*{_dep}\s*/\s*d\s*{_ind}\s*(?:\^\s*)?(?:{_glyph})',
            dependent + "'" * _order, text)
    text = re.sub(rf'd\s*{_dep}\s*/\s*d\s*{_ind}', dependent + "'", text)
    if text.count('=') != 1:
        raise ValueError('微分方程必须包含且只包含一个等号')
    left, right = [item.strip() for item in text.split('=')]
    if not left or not right:
        raise ValueError('微分方程两侧不能为空')
    for order in (3, 2, 1):
        marker = 'D%d' % order
        pattern = re.escape(dependent) + r"\s*'{%d}" % order if order > 1 else re.escape(dependent) + r"\s*'"
        text = re.sub(pattern, marker, text)
    return text, text


def _parse_side(raw: str, independent: str, dependent: str) -> sp.Expr:
    names = (independent, dependent, 'D1', 'D2', 'D3')
    value = parse_expression(raw, names)
    x = sp.Symbol(independent, real=True)
    y = sp.Function(dependent)(x)
    y_symbol = sp.Symbol(dependent, real=True)
    replacements = {y_symbol: y}
    for order in (1, 2, 3):
        marker = sp.Symbol('D%d' % order, real=True)
        if marker in value.free_symbols:
            replacements[marker] = sp.Derivative(y, x, order)
    return value.xreplace(replacements)


def parse_equation(raw: Any, independent='x', dependent='y') -> tuple[sp.Expr, sp.Eq, int]:
    if independent not in ('x', 't') or dependent != 'y':
        raise ValueError('当前只支持自变量 x 或 t、未知函数 y 的微分方程')
    normalized, _ = _normalize_equation(raw, independent, dependent)
    left, right = normalized.split('=')
    left_expr = _parse_side(left, independent, dependent)
    right_expr = _parse_side(right, independent, dependent)
    x = sp.Symbol(independent, real=True)
    y = sp.Function(dependent)(x)
    equation = sp.Eq(left_expr, right_expr)
    orders = [derivative.derivative_count for derivative in equation.atoms(sp.Derivative)]
    order = int(max(orders)) if orders else 0
    if order == 0:
        raise ValueError('方程中没有未知函数 y 的导数')
    if order > MAX_ORDER:
        raise ValueError(f'当前只支持 {MAX_ORDER} 阶以内微分方程')
    return equation, x, order


def parse_initial_conditions(raw: Any, independent: str, dependent: str, order: int) -> tuple[dict, list[str], list[tuple[int, sp.Expr, sp.Expr]]]:
    if raw is None:
        return {}, [], []
    if not isinstance(raw, list) or len(raw) > 6:
        raise ValueError('初值条件必须是最多6条的字符串数组')
    x = sp.Symbol(independent, real=True)
    y = sp.Function(dependent)(x)
    conditions: dict = {}
    texts: list[str] = []
    terms: list[tuple[int, sp.Expr, sp.Expr]] = []
    for item in raw:
        if not isinstance(item, str) or not item.strip():
            raise ValueError('初值条件格式不正确')
        text = item.replace('−', '-').replace('＝', '=').replace('′', "'").replace('’', "'").strip()
        match = re.fullmatch(r"y\s*('{0,3})\s*\(\s*(.+)\s*\)\s*=\s*(.+)", text)
        if not match:
            raise ValueError('初值条件应写成 y(0)=1、y\'(0)=2 这样的形式')
        primes, point_raw, value_raw = match.groups()
        order_k = len(primes)
        if order_k >= order + 1:
            raise ValueError('初值条件的导数阶数超过方程阶数')
        point = _constant(point_raw, '初值点')
        value = _constant(value_raw, '初值')
        key = y.subs(x, point) if order_k == 0 else sp.Derivative(y, x, order_k).subs(x, point)
        if key in conditions:
            raise ValueError('同一阶初值条件不能重复')
        conditions[key] = value
        texts.append(text)
        terms.append((order_k, point, value))
    return conditions, texts, terms


def build_ode_problem(conditions: Mapping[str, Any]) -> dict:
    from .exam_math import _condition
    equation_raw = conditions.get('equation')
    independent = str(conditions.get('independent_variable') or 'x')
    dependent = str(conditions.get('dependent_variable') or 'y')
    equation, x, order = parse_equation(equation_raw, independent, dependent)
    ics, ic_texts, _ = parse_initial_conditions(conditions.get('initial_conditions'), independent, dependent, order)
    target_kind = str(conditions.get('target_kind') or 'none')
    if target_kind not in ('none', 'value', 'area', 'integral', 'volume_x'):
        raise ValueError('ODE 组合量只支持 value、area、integral、volume_x')
    target_lower = target_upper = target_point = None
    if target_kind == 'value':
        target_point = _constant(conditions.get('target_point'), '求值点')
    elif target_kind in ('area', 'integral', 'volume_x'):
        target_lower = _constant(conditions.get('target_lower'), '积分下限')
        target_upper = _constant(conditions.get('target_upper'), '积分上限')
        if not bool(target_lower < target_upper):
            raise ValueError('组合量的积分区间必须从小到大')
    plot_lower = float(target_lower) if target_lower is not None else -3.0
    plot_upper = float(target_upper) if target_upper is not None else 3.0
    model = {
        'engine': 'ode_v1', 'subject': 'calculus', 'task': 'ode', 'kind': 'ode',
        'equation': str(equation_raw).strip(), 'independent_variable': independent,
        'dependent_variable': dependent, 'order': order,
        'initial_conditions': ic_texts, 'target_kind': target_kind,
        'target_point': str(target_point) if target_point is not None else None,
        'target_lower': str(target_lower) if target_lower is not None else None,
        'target_upper': str(target_upper) if target_upper is not None else None,
        'defaults': {'x_min': plot_lower, 'x_max': plot_upper}, 'params': [dict(id=k, label=label, kind='number', min=-100, max=100, step=0.5, options=[]) for k, label in [('x_min', '显示区间左端'), ('x_max', '显示区间右端')]], 'teaching': False,
        'formula_tex': to_latex(equation),
    }
    condition_list = [
        _condition('equation', '微分方程', model['equation'], {}, kind='expr'),
        _condition('independent_variable', '自变量', independent, {}, kind='text'),
        _condition('initial_conditions', '初值条件', ic_texts, {}, kind='json'),
    ]
    if target_kind != 'none':
        condition_list.append(_condition('target_kind', '组合量', target_kind, {}, kind='text'))
    formulas = [{'id': 'ode', 'tex': to_latex(equation), 'plain': model['equation'], 'role': '微分方程'}]
    return {
        'problem_id': 'prb_ode', 'number': None, 'title': '微分方程', 'text': '',
        'subject': 'calculus', 'subject_label': '微积分', 'confidence': 1.0, 'status': 'ready',
        'source': {'page_from': 1, 'page_to': 1, 'file_names': [], 'label': '声明式条件', 'excerpt': ''},
        'source_pages': [],
        'recognition': {
            'method': 'declarative_kernel', 'raw_text': '', 'conditions': condition_list,
            'ambiguities': [], 'formulas': formulas, 'recognized_subject': 'calculus', 'ai_used': False,
        },
        'model': model, 'solution': {}, 'states': {},
        'conditions': condition_list, 'ambiguities': [], 'formulas': formulas, 'recognized': True,
    }


def _hint_labels(hints) -> list[str]:
    mapping = {
        'separable': '可分离变量',
        '1st_linear': '一阶线性',
        '1st_homogeneous_coeff_best': '一阶齐次',
        '1st_exact': '恰当方程',
        'nth_linear_constant_coeff': '常系数线性',
        'nth_linear_constant_coeff_homogeneous': '常系数齐次线性',
        'nth_linear_constant_coeff_undetermined_coefficients': '常系数线性（待定系数特解）',
        'nth_linear_constant_coeff_variation_of_parameters': '常系数线性（常数变易）',
        'nth_linear_euler_eq_homogeneous': 'Euler 方程',
    }
    result = []
    for hint in hints or []:
        label = mapping.get(hint)
        if label and label not in result:
            result.append(label)
    return result


def _target_value(solution_expr, x: sp.Symbol, model: Mapping[str, Any]) -> dict[str, Any] | None:
    kind = model.get('target_kind') or 'none'
    if kind == 'none':
        return None
    if solution_expr.free_symbols - {x}:
        return {'status': 'incomplete', 'reason': '通解仍含任意常数，组合量需要先由初值确定特解'}
    if kind == 'value':
        point = _constant(model.get('target_point'), '求值点')
        value = sp.simplify(solution_expr.subs(x, point))
        return {'status': 'complete', 'kind': kind, 'value': str(value), 'numeric': safe_float(value), 'text': str(value), 'point': str(point)}
    lower = _constant(model.get('target_lower'), '积分下限')
    upper = _constant(model.get('target_upper'), '积分上限')
    integrand = solution_expr if kind in ('area', 'integral') else sp.pi * solution_expr ** 2
    value = sp.simplify(sp.integrate(integrand, (x, lower, upper)))
    if value.has(sp.Integral) or safe_float(value) is None:
        return {'status': 'incomplete', 'reason': '组合量积分未得到有限闭式结果'}
    return {
        'status': 'complete', 'kind': kind, 'value': str(value), 'numeric': safe_float(value), 'text': str(value),
        'lower': str(lower), 'upper': str(upper), 'integrand': str(integrand),
    }


def _known_values_at(point: sp.Expr, ic_terms) -> dict[sp.Symbol, sp.Expr]:
    values = {}
    for order_k, ic_point, value in ic_terms:
        if sp.simplify(ic_point - point) == 0:
            values[sp.Symbol('y', real=True) if order_k == 0 else sp.Symbol(f'D{order_k}', real=True)] = value
    return values


def _check_side_at_point(side: sp.Expr, x: sp.Symbol, point: sp.Expr,
                         known: dict[sp.Symbol, sp.Expr]) -> None:
    replacements = {x: point, **known}
    for node in sp.preorder_traversal(side):
        if isinstance(node, sp.Pow) and node.exp.is_number and node.exp < 0:
            base = node.base.subs(replacements)
            if not base.free_symbols and sp.simplify(base) == 0:
                raise ValueError('原方程在给定条件点分母为零，不能用化简后的残差补回定义')
        if node.free_symbols <= set(replacements):
            local = node.subs(replacements)
            if local.free_symbols:
                continue
            if local.is_real is False or safe_float(local) is None:
                raise ValueError('原方程在初值点没有实定义，不能给出满足该初值的解')


def _implicit_derivative_verified(equation, result, x) -> bool | None:
    """Verify an implicit first-order solution by implicit differentiation.

    ``checkodesol`` tries to solve F(x, y)=0 for y and raises on many valid
    implicit answers (e.g. y - atan(x+y) = -pi/4). Differentiating F implicitly
    gives dy/dx = -F_x/F_y, which can be compared with the ODE directly.
    """
    y_expr = sp.Function('y')(x)
    if equation.has(sp.Derivative(y_expr, (x, 2))):
        return None
    value = sp.Symbol('y', real=True)
    residual = sp.simplify((result.lhs - result.rhs).subs(y_expr, value))
    f_x = sp.diff(residual, x)
    f_y = sp.diff(residual, value)
    if sp.simplify(f_y) == 0:
        return None
    try:
        derivative = sp.simplify(-f_x / f_y)
    except Exception:  # noqa: BLE001
        return None
    rhs = equation.rhs.subs(y_expr, value)
    try:
        return sp.simplify(derivative - rhs) == 0
    except Exception:  # noqa: BLE001
        return None


def _implicit_text(result) -> str:
    text = expression_text(sp.simplify(result.lhs - result.rhs)).replace('y(x)', 'y')
    return f'{text} = 0'


def _check_solution_points(raw: Any, independent: str, solution_expr: sp.Expr, ic_terms) -> None:
    normalized, _ = _normalize_equation(raw, independent, 'y')
    names = (independent, 'y', 'D1', 'D2', 'D3')
    x = sp.Symbol(independent, real=True)
    y_symbol = sp.Symbol('y', real=True)
    base = {y_symbol: solution_expr}
    for order_k in (1, 2, 3):
        base[sp.Symbol(f'D{order_k}', real=True)] = sp.diff(solution_expr, x, order_k)
    for side_raw in normalized.split('='):
        try:
            side = parse_expression(side_raw, names, preserve_structure=True)
        except Exception:  # noqa: BLE001
            continue
        for _, point, _ in ic_terms:
            substitutions = {x: point, **base}
            for node in sp.preorder_traversal(side):
                if not node.free_symbols <= set(substitutions):
                    continue
                local = node.subs(substitutions)
                if local.free_symbols:
                    continue
                if local.is_real is False or safe_float(local) is None:
                    raise ValueError('候选解使原方程在给定条件点没有实定义')


def _original_equation_domain(raw: Any, independent: str, ic_terms) -> sp.Set:
    normalized, _ = _normalize_equation(raw, independent, 'y')
    names = (independent, 'y', 'D1', 'D2', 'D3')
    x = sp.Symbol(independent, real=True)
    sides = []
    domain = sp.S.Reals
    for side_raw in normalized.split('='):
        try:
            side = parse_expression(side_raw, names, preserve_structure=True)
        except Exception:  # noqa: BLE001
            continue
        sides.append(side)
        try:
            side_domain = continuous_domain(side, x, sp.S.Reals)
        except Exception:  # noqa: BLE001 - 无法确认时不强行加限制
            continue
        domain = domain.intersect(side_domain)
    for _, point, _ in ic_terms:
        known = _known_values_at(point, ic_terms)
        for side in sides:
            _check_side_at_point(side, x, point, known)
        # The x-domain may still contain y/D1 from the original equation, e.g.
        # 1/(x+y)^2 gives Reals \ {-y}. At the initial point those are known,
        # so substitute them before deciding whether the point belongs.
        local_domain = domain.subs(known)
        if sp.Interval(point, point).is_subset(local_domain) is not True:
            raise ValueError('原方程在初值点没有实定义，不能给出满足该初值的解')
    return domain


def _equation_restricted_domain(raw: Any, independent: str, solution_expr: sp.Expr, order: int) -> sp.Set:
    """Restrict the solution interval by the original equation's sqrt/log/denominator nodes."""
    normalized, _ = _normalize_equation(raw, independent, 'y')
    names = (independent, 'y', 'D1', 'D2', 'D3')
    x = sp.Symbol(independent, real=True)
    replacements = {sp.Symbol('y', real=True): solution_expr}
    for order_k in range(1, order + 1):
        replacements[sp.Symbol(f'D{order_k}', real=True)] = sp.diff(solution_expr, x, order_k)
    domain = sp.S.Reals
    for side_raw in normalized.split('='):
        try:
            side = parse_expression(side_raw, names, preserve_structure=True)
        except Exception:  # noqa: BLE001
            continue
        seen = set()
        for node in sp.preorder_traversal(side):
            if node in seen:
                continue
            seen.add(node)
            local = node.xreplace(replacements)
            if local.free_symbols - {x}:
                continue
            try:
                node_domain = continuous_domain(local, x, sp.S.Reals)
            except Exception:  # noqa: BLE001
                continue
            domain = domain.intersect(node_domain)
    return domain


def _unsupported_ode(reason: str, model: Mapping[str, Any], order: int, ic_texts: list[str]) -> dict:
    return {
        'summary': reason, 'answer': '', 'answer_value': None, 'exact': '', 'exact_latex': '',
        'solution_latex': '', 'free_constants': False, 'plot_window': None,
        'solution_domain': None, 'scope_note': '原方程实定义域未满足，不输出候选解。',
        'steps': [{'id': 'domain', 'title': '核对原方程实定义域', 'latex': '', 'detail': reason}],
        'conditions': [f'自变量 {model.get("independent_variable") or "x"}，未知函数 y。'] + ic_texts,
        'limitations': [reason], 'ode_order': order, 'ode_equation': str(model.get('equation')),
        'ode_hints': [], 'initial_conditions': ic_texts, 'general_solution': None,
        'particular_solution': None, 'plot_expression': None, 'residual_verified': False,
        'initial_conditions_verified': False, 'target': None,
        'solution_status': 'unsupported', 'solution_complete': False, 'incomplete_reason': reason,
    }


def solve_ode(model: Mapping[str, Any]) -> dict:
    independent = str(model.get('independent_variable') or 'x')
    equation, x, order = parse_equation(model.get('equation'), independent, 'y')
    y = sp.Function('y')(x)
    ics, ic_texts, ic_terms = parse_initial_conditions(model.get('initial_conditions'), independent, 'y', order)
    try:
        equation_domain = _original_equation_domain(model.get('equation'), independent, ic_terms)
    except ValueError as exc:
        return _unsupported_ode(str(exc), model, order, ic_texts)
    complete = True
    try:
        dsolve_result = sp.dsolve(equation, y, ics=ics or None)
    except Exception as exc:  # noqa: BLE001
        return {
            'summary': f'微分方程未能求解：{exc}', 'answer': '', 'answer_value': None,
            'steps': [], 'conditions': [], 'limitations': [str(exc)],
            'solution_status': 'incomplete', 'solution_complete': False,
            'incomplete_reason': f'微分方程未能求解：{exc}',
        }
    if isinstance(dsolve_result, list):
        if len(dsolve_result) > 1:
            return dict(summary='返回多个候选解分支，当前未确认应选哪一支，不自动取第一支', answer='', steps=[], conditions=ic_texts, limitations=['需进一步明确解分支，当前不声明已求得完整答案'], solution_status='unsupported', solution_complete=False, incomplete_reason='解分支尚未确认')
        dsolve_result = dsolve_result[0] if dsolve_result else None
    if dsolve_result is None or not isinstance(dsolve_result, sp.Eq):
        return {
            'summary': '微分方程未返回可核验的显式解', 'answer': '', 'answer_value': None,
            'steps': [], 'conditions': [], 'limitations': ['dsolve 未返回 Eq(y(x), ...)'],
            'solution_status': 'incomplete', 'solution_complete': False,
            'incomplete_reason': '微分方程未返回可核验的显式解',
        }
    implicit = bool(sp.simplify(dsolve_result.lhs - y) != 0)
    solution_expr = None if implicit else dsolve_result.rhs
    if implicit:
        residual_ok, residual = _implicit_derivative_verified(equation, dsolve_result, x), None
        if residual_ok is not True:
            complete = False
    else:
        if solution_expr.has(sp.Integral) or solution_expr.has(sp.Derivative) or solution_expr.has(sp.dsolve):
            complete = False
        try:
            residual_ok, residual = sp.checkodesol(equation, dsolve_result)
        except Exception:  # noqa: BLE001
            residual_ok, residual = False, None
        if residual_ok is not True:
            complete = False
    initial_ok = True
    for order_k, point, value in ic_terms:
        try:
            if implicit:
                if order_k != 0:
                    initial_ok = False
                    continue
                # F(x, y)=0 must hold at the initial point.
                substitution = {sp.Function('y')(x): value, x: point}
                if sp.simplify((dsolve_result.lhs - dsolve_result.rhs).subs(substitution)) != 0:
                    initial_ok = False
                continue
            actual = solution_expr if order_k == 0 else sp.diff(solution_expr, x, order_k)
            if sp.simplify(actual.subs(x, point) - value) != 0:
                initial_ok = False
        except Exception:  # noqa: BLE001
            initial_ok = False
    domain = None
    domain_reason = None
    try:
        if not implicit:
            if not solution_expr.free_symbols - {x}:
                domain = continuous_domain(solution_expr, x, sp.S.Reals).intersect(equation_domain)
                for derivative_order in range(1, order + 1):
                    derivative_domain = continuous_domain(
                        sp.diff(solution_expr, x, derivative_order), x, sp.S.Reals)
                    domain = domain.intersect(derivative_domain)
                domain = domain.intersect(_equation_restricted_domain(
                    model['equation'], independent, solution_expr, order))
                _check_solution_points(model['equation'], independent, solution_expr, ic_terms)
            normalized, _ = _normalize_equation(model['equation'], independent, 'y')
            names = (independent, 'y', 'D1', 'D2', 'D3')
            replacements = {sp.Symbol('y', real=True):solution_expr}
            replacements.update({sp.Symbol(f'D{k}',real=True):sp.diff(solution_expr,x,k) for k in (1,2,3)})
            for raw in normalized.split('='):
                preserved = parse_expression(raw, names, preserve_structure=True)
                for node in sp.preorder_traversal(preserved):
                    if isinstance(node,sp.Pow) and node.exp.is_number and node.exp<0:
                        base=sp.simplify(node.base.xreplace(replacements))
                        for _,point,_ in ic_terms:
                            if sp.simplify(base.subs(x,point))==0: raise ValueError('原方程在给定条件点分母为零，不能用化简后的残差补回定义')
                        if domain is not None:
                            if base==0: raise ValueError('候选解使原方程分母恒为零')
                            domain=domain.intersect(continuous_domain(1/base,x,sp.S.Reals))
            if domain is not None and ic_terms:
                from .calculus_analysis import _interval_components
                parts=_interval_components(domain)
                component=next((p for p in parts or [] if all(p[0]<point<p[1] for _,point,_ in ic_terms)),None)
                if component is None: raise ValueError('条件点不在同一个可确认的双侧实解区间内')
                domain=sp.Interval(component[0],component[1],component[2],component[3])
    except (ValueError,TypeError,NotImplementedError) as exc:
        domain_reason=str(exc)
        initial_ok=False
    complete = complete and initial_ok
    target = None if implicit else _target_value(solution_expr, x, model)
    if implicit and str(model.get('target_kind') or 'none') not in ('none', ''):
        # A requested area/volume cannot be derived from an implicit curve here.
        complete = False
    if target and target.get('status') != 'complete':
        complete = False
    plot_window = None
    if complete and not implicit and isinstance(domain, sp.Interval) and not solution_expr.free_symbols - {x}:
        center=float(ic_terms[0][1]) if ic_terms else 0.0
        low,high=center-3,center+3
        if domain.start is not -sp.oo and low<=float(domain.start): low=center-(center-float(domain.start))/2
        if domain.end is not sp.oo and high>=float(domain.end): high=center+(float(domain.end)-center)/2
        if low<high: plot_window={'x_min':low,'x_max':high}
    hints = []
    try:
        hints = _hint_labels(sp.classify_ode(equation, y))
    except Exception:  # noqa: BLE001
        hints = []
    solution_body = _implicit_text(dsolve_result) if implicit else f"y = {expression_text(solution_expr)}"
    solution_text = solution_body
    if ics and initial_ok and (implicit or not solution_expr.free_symbols - {x}):
        solution_text += f"（满足初值 {', '.join(ic_texts)}）"
    free_constants = bool(set((dsolve_result.lhs - dsolve_result.rhs).free_symbols
                              if implicit else solution_expr.free_symbols) - {x})
    answer_parts = [solution_text]
    if target and target.get('status') == 'complete':
        answer_parts.append(f"{target['kind']} = {target['text']}")
    if target and target.get('status') != 'complete':
        answer_parts.append(target.get('reason', '组合量未完成'))
    answer = '；'.join(answer_parts)
    if implicit:
        general_solution = solution_body if (not ics or free_constants) else None
        particular_solution = solution_body if (ics and initial_ok) else None
    else:
        general_solution = expression_text(dsolve_result.rhs) if not ics or solution_expr.free_symbols - {x} else None
        particular_solution = expression_text(dsolve_result.rhs) if ics and not solution_expr.free_symbols - {x} else None
    limitations = ['当前支持 1 至 3 阶常见常微分方程；未闭式可解的方程明确标为未完成。']
    if implicit:
        limitations.append('隐式解未显式解出 y，组合量计算不适用。')
    limitations.append('组合量仅支持点值、面积、积分和绕 x 轴体积。')
    return {
        'summary': '微分方程：先求通解/特解，再用代入残差和初值条件核对。',
        'answer': answer if complete else '',
        'answer_value': target.get('numeric') if target and target.get('status') == 'complete' else None,
        'exact': solution_text,
        'exact_latex': to_latex(dsolve_result) if complete else '',
        'solution_latex': to_latex(dsolve_result) if complete else '',
        'free_constants': free_constants,
        'plot_window': plot_window,
        'solution_domain': (('(' if domain.left_open else '[')+('-∞' if domain.start is -sp.oo else str(domain.start))+', '+('+∞' if domain.end is sp.oo else str(domain.end))+(')' if domain.right_open else ']')) if isinstance(domain,sp.Interval) else str(domain) if domain is not None else None,
        'scope_note': '所示解或解族已代回方程核验，不据此宣称覆盖所有奇解、平衡解或非线性分支；条件不足时保留任意常数，不声明唯一性。',
        'approx': None,
        'steps': [
            {'id': 'equation', 'title': '确认方程与阶数', 'latex': to_latex(equation),
             'detail': f'{order} 阶常微分方程；初值条件 {len(ics)} 条。'},
            {'id': 'dsolve', 'title': ('求得隐式解' if implicit else '求得显式解或解族') if complete else '候选解（未完成核验）', 'latex': to_latex(dsolve_result), 'detail': solution_text},
            {'id': 'verify', 'title': '代入残差与初值核对', 'latex': r'\text{residual}=0' if residual_ok is True else r'\text{残差未通过核验}',
             'detail': f'代回方程残差核对：{residual_ok}；逐条条件及原式定义核对：{initial_ok}。'},
        ] + ([{'id': 'target', 'title': '计算组合量', 'latex': to_latex(target.get('integrand', '')), 'detail': target.get('text', '')}] if target else []),
        'conditions': [f'自变量 {independent}，未知函数 y。'] + ic_texts,
        'limitations': limitations,
        'ode_order': order,
        'ode_equation': str(model.get('equation')),
        'ode_hints': hints,
        'initial_conditions': ic_texts,
        'general_solution': general_solution,
        'particular_solution': particular_solution,
        'plot_expression': expression_text(solution_expr) if complete and plot_window is not None and not solution_expr.free_symbols - {x} and not implicit else None,
        'residual_verified': bool(residual_ok is True),
        'initial_conditions_verified': initial_ok,
        'target': target,
        'solution_status': 'complete' if complete else 'incomplete',
        'solution_complete': complete,
        'incomplete_reason': None if complete else domain_reason or '方程未完全显式求解、初值/残差核验失败或组合量未完成',
    }


def evaluate_ode(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict:
    solution = solve_ode(model)
    plot_expression = solution.get('plot_expression')
    plot_lower = float(model.get('defaults', {}).get('x_min', -3.0))
    plot_upper = float(model.get('defaults', {}).get('x_max', 3.0))
    if solution.get('plot_window'):
        plot_lower=solution['plot_window']['x_min'];plot_upper=solution['plot_window']['x_max']
    plot_lower = float(params.get('x_min', plot_lower))
    plot_upper = float(params.get('x_max', plot_upper))
    if plot_lower >= plot_upper:
        raise ValueError('显示区间左端必须小于右端')
    variable = str(model.get('independent_variable') or 'x')
    series = []
    if plot_expression:
        try:
            compiled = sp.lambdify(sp.Symbol(variable,real=True), parse_expression(plot_expression, (variable,)), 'math')
            for index in range(260):
                value_x = plot_lower + (plot_upper - plot_lower) * index / 259
                try:
                    value_y = float(compiled(value_x))
                except Exception:  # noqa: BLE001
                    value_y = None
                if value_y is not None and not math.isfinite(value_y):
                    value_y = None
                series.append({'x': round(value_x, 6), 'y': None if value_y is None else round(value_y, 6)})
        except Exception:  # noqa: BLE001
            series = []
    target = solution.get('target') or {}
    exact = target.get('numeric') if target.get('status') == 'complete' else None
    checks = [
        {'id': 'residual', 'label': '代入原方程残差', 'status': 'pass' if solution.get('residual_verified') else 'fail',
         'detail': 'checkodesol 返回方程残差为 0。' if solution.get('residual_verified') else '方程残差未通过，不能判为求解成功。'},
        {'id': 'initial', 'label': '初值条件核对', 'status': 'warn' if not model.get('initial_conditions') else 'pass' if solution.get('initial_conditions_verified') else 'fail',
         'detail': '未给条件，不补初值或声称唯一性。' if not model.get('initial_conditions') else '初值逐条代入解后成立。' if solution.get('initial_conditions_verified') else '至少一条初值条件未满足或尚未核验。'},
        {'id': 'explicit', 'label': '显式解与组合量', 'status': 'pass' if solution.get('solution_complete') else 'warn',
         'detail': solution.get('incomplete_reason') or '已得到显式解并完成组合量。'},
    ]
    return {
        'subject': 'calculus', 'task': 'ode', 'kind': 'ode',
        'headline': solution.get('answer') or solution.get('incomplete_reason') or '微分方程求解',
        'metrics': [
            {'id': 'order', 'label': '方程阶数', 'value': str(solution.get('ode_order', 1)), 'accent': True},
            {'id': 'hints', 'label': '方程类型', 'value': '、'.join(solution.get('ode_hints') or []) or '—'},
            {'id': 'target', 'label': '组合量', 'value': _number_text(exact) if exact is not None else '—'},
            {'id': 'residual', 'label': '残差核验', 'value': '通过' if solution.get('residual_verified') else '未通过'},
        ],
        'checks': checks,
        'notes': solution.get('limitations') or [],
        'series': series,
        'domain': {'x_min': plot_lower, 'x_max': plot_upper},
        'rects': [], 'exact': exact, 'approx': None, 'error': None,
        'answerText': solution.get('answer') or '',
        'trace': [
            {'index': 0, 'label': '方程', 'detail': str(model.get('equation')), 'values': {'order': solution.get('ode_order')}},
            {'index': 1, 'label': '解', 'detail': solution.get('exact') or '', 'values': {}},
        ],
        'ode': {
            'order': solution.get('ode_order'), 'hints': solution.get('ode_hints') or [],
            'solution': solution.get('plot_expression') or solution.get('general_solution') or '',
            'initial_conditions': solution.get('initial_conditions') or [],
            'target': target,
        },
    }


def _number_text(value: float | None) -> str:
    if value is None:
        return '—'
    text = f'{value:.6g}'
    return text




def build_ode_from_text(text: str, source: Mapping, overrides: Mapping) -> dict | None:
    """Minimal local recognition for equations written as y'...=... in prose."""
    if not re.search(r"微分方程|dy\s*/\s*dx|y\s*'\s*", text, re.I):
        return None
    equation = str(overrides.get('equation') or '').strip()
    if not equation:
        match = re.search(r"(?:微分方程|方程)\s*[:：]?\s*([^。；;]+?=[^。；;]+)", text)
        if not match:
            match = re.search(r"(y\s*'{0,3}[^。；;]*=[^。；;]+)", text)
        if not match:
            return None
        equation = match.group(1).strip().strip('，, ')
        # 标题/题号引导语可能残留在捕获头（"9.求微分方程dy/dx=…"），先剥到数学开头。
        equation = re.sub(r'^(?:[\d.、\s]*(?:求|解|微分方程|方程|已知|设|若|对于|计算|求证))+\s*', '', equation)
        equation = re.split(r"\s*(?:满足|其中|求|的|特解|通解)", equation)[0].strip()
    initial_conditions = overrides.get('initial_conditions')
    if initial_conditions is None:
        initial_conditions = [item.strip(" ，,。；;") for item in re.findall(r"y\s*'{0,3}\s*\([^)]*\)\s*=\s*[^，,。；;的]+", text)]
    if not equation:
        return None
    try:
        problem = build_ode_problem({'equation': equation, 'initial_conditions': initial_conditions})
    except (ValueError, TypeError, NotImplementedError):
        return None
    problem['recognition']['raw_text'] = text
    problem['recognition']['method'] = 'typed_text'
    problem['source']['excerpt'] = text[:220]
    return problem


__all__ = ['build_ode_problem', 'build_ode_from_text', 'evaluate_ode', 'parse_equation', 'solve_ode']
