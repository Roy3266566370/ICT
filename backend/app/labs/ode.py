"""Ordinary differential equations with initial conditions and optional geometric targets."""
from __future__ import annotations

import math
import re
from typing import Any, Mapping

import sympy as sp

from .expr import expression_text, parse_expression, safe_float, to_latex

MAX_ORDER = 3


def _constant(raw: Any, label: str) -> sp.Expr:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError(f'缺少{label}')
    value = parse_expression(raw, ('x',))
    if value.free_symbols or safe_float(value) is None:
        raise ValueError(f'{label}必须是有限实数')
    return value


def _normalize_equation(raw: Any, independent: str, dependent: str) -> tuple[str, str]:
    if not isinstance(raw, str) or not 1 <= len(raw) <= 600:
        raise ValueError('微分方程必须是600字以内的字符串')
    text = raw.replace('′', "'").replace('’', "'").replace('−', '-').replace('＝', '=')
    text = text.replace(f'{dependent}({independent})', dependent)
    text = re.sub(r'\b' + re.escape(dependent) + r'\s*\(\s*[xt]\s*\)', dependent, text)
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
        text = item.replace('−', '-').replace('＝', '=').strip()
        match = re.fullmatch(r"y\s*('{0,3})\s*\(\s*([^)]+)\s*\)\s*=\s*(.+)", text)
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
        'defaults': {'x_min': plot_lower, 'x_max': plot_upper}, 'params': [], 'teaching': False,
        'formula_tex': to_latex(equation),
    }
    condition_list = [
        _condition('equation', '微分方程', model['equation'], {}, kind='expr'),
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


def solve_ode(model: Mapping[str, Any]) -> dict:
    independent = str(model.get('independent_variable') or 'x')
    equation, x, order = parse_equation(model.get('equation'), independent, 'y')
    y = sp.Function('y')(x)
    ics, ic_texts, ic_terms = parse_initial_conditions(model.get('initial_conditions'), independent, 'y', order)
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
        dsolve_result = dsolve_result[0] if dsolve_result else None
    if dsolve_result is None or not isinstance(dsolve_result, sp.Eq):
        return {
            'summary': '微分方程未返回可核验的显式解', 'answer': '', 'answer_value': None,
            'steps': [], 'conditions': [], 'limitations': ['dsolve 未返回 Eq(y(x), ...)'],
            'solution_status': 'incomplete', 'solution_complete': False,
            'incomplete_reason': '微分方程未返回可核验的显式解',
        }
    implicit = bool(dsolve_result.lhs != y)
    solution_expr = dsolve_result.rhs
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
            actual = solution_expr if order_k == 0 else sp.diff(solution_expr, x, order_k)
            if sp.simplify(actual.subs(x, point) - value) != 0:
                initial_ok = False
        except Exception:  # noqa: BLE001
            initial_ok = False
    complete = complete and initial_ok
    if implicit:
        complete = False
    target = _target_value(solution_expr, x, model) if not implicit else {'status': 'incomplete', 'reason': '隐式解无法直接计算组合量'}
    if target and target.get('status') != 'complete':
        complete = False
    hints = []
    try:
        hints = _hint_labels(sp.classify_ode(equation, y))
    except Exception:  # noqa: BLE001
        hints = []
    solution_text = f"y = {expression_text(solution_expr)}"
    if ics and not solution_expr.free_symbols - {x}:
        solution_text += f"（满足初值 {', '.join(ic_texts)}）"
    answer_parts = [solution_text]
    if target and target.get('status') == 'complete':
        answer_parts.append(f"{target['kind']} = {target['text']}")
    if target and target.get('status') != 'complete':
        answer_parts.append(target.get('reason', '组合量未完成'))
    answer = '；'.join(answer_parts)
    return {
        'summary': '微分方程：先求通解/特解，再用代入残差和初值条件核对。',
        'answer': answer if complete else '',
        'answer_value': target.get('numeric') if target and target.get('status') == 'complete' else None,
        'exact': solution_text,
        'approx': None,
        'steps': [
            {'id': 'equation', 'title': '确认方程与阶数', 'latex': to_latex(equation),
             'detail': f'{order} 阶常微分方程；初值条件 {len(ics)} 条。'},
            {'id': 'dsolve', 'title': '求通解/特解', 'latex': to_latex(dsolve_result), 'detail': solution_text},
            {'id': 'verify', 'title': '代入残差与初值核对', 'latex': r'\text{residual}=0',
             'detail': f'checkodesol：{residual_ok}；初值核对：{initial_ok}。'},
        ] + ([{'id': 'target', 'title': '计算组合量', 'latex': to_latex(target.get('integrand', '')), 'detail': target.get('text', '')}] if target else []),
        'conditions': [f'自变量 {independent}，未知函数 y。'] + ic_texts,
        'limitations': [
            '当前支持 1 至 3 阶常见常微分方程；未闭式可解的方程明确标为未完成。',
            '组合量仅支持点值、面积、积分和绕 x 轴体积。',
        ],
        'ode_order': order,
        'ode_equation': str(model.get('equation')),
        'ode_hints': hints,
        'initial_conditions': ic_texts,
        'general_solution': expression_text(dsolve_result.rhs) if not ics else None,
        'particular_solution': expression_text(dsolve_result.rhs) if ics and not solution_expr.free_symbols - {x} else None,
        'plot_expression': expression_text(solution_expr) if not solution_expr.free_symbols - {x} and not implicit else None,
        'residual_verified': bool(residual_ok is True),
        'initial_conditions_verified': initial_ok,
        'target': target,
        'solution_status': 'complete' if complete else 'incomplete',
        'solution_complete': complete,
        'incomplete_reason': None if complete else '方程未完全显式求解、初值/残差核验失败或组合量未完成',
    }


def evaluate_ode(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict:
    solution = solve_ode(model)
    plot_expression = solution.get('plot_expression')
    plot_lower = float(model.get('defaults', {}).get('x_min', -3.0))
    plot_upper = float(model.get('defaults', {}).get('x_max', 3.0))
    variable = str(model.get('independent_variable') or 'x')
    series = []
    if plot_expression:
        try:
            compiled = sp.lambdify(sp.Symbol(variable), parse_expression(plot_expression, (variable,)), 'math')
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
        {'id': 'initial', 'label': '初值条件核对', 'status': 'pass' if solution.get('initial_conditions_verified') else 'fail',
         'detail': '初值逐条代入解后成立。' if solution.get('initial_conditions_verified') else '至少一条初值条件未满足。'},
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
