"""Deterministic geometry, implicit normals and complete stationary-set analysis.

These rules operate on the supplied expressions and bounds. Unsupported geometry
and unresolved branches remain blocking questions, never a substituted example.
"""
from __future__ import annotations

import math
import re
from typing import Any, Mapping

import sympy as sp

from .expr import ExprError, normalize_math, number_text, parse_expression, safe_float, to_latex

X, Y = sp.symbols('x y', real=True)
K = sp.Symbol('k', integer=True)
_MATH = r'[A-Za-z0-9_+*/^().\\{}\[\] \-]+'


def _prefix(raw: str) -> str:
    match = re.match(_MATH, raw.strip())
    if not match:
        return ''
    value = match.group().strip().rstrip('.')
    stack = []
    for index, char in enumerate(value):
        if char in '({[':
            stack.append(char)
        elif char in ')}]':
            if not stack:
                return value[:index].strip()
            stack.pop()
    return value


def _expr(raw: str, variables=('x',)) -> sp.Expr:
    normalized = normalize_math(raw)
    normalized = re.sub(r'(?<=[xy])(?=(?:sqrt|exp|sin|cos|tan|log|ln|abs)\()', '*', normalized)
    return parse_expression(normalized, variables)


def _bound(raw: str) -> sp.Expr:
    if raw in ('oo', '+oo', '∞', '+∞'):
        return sp.oo
    value = _expr(raw)
    if value.free_symbols or safe_float(value) is None:
        raise ExprError('区间端点必须是实数')
    return value


def _condition(key: str, label: str, value: Any, source: Mapping[str, Any], kind='expression') -> dict:
    return dict(id=key, label=label, value=value, kind=kind, unit='', provenance='original',
                source=dict(source), editable=True, options=[], min=None, max=None, step=None)


def _ambiguity(field: str, question: str) -> dict:
    return dict(id='exam_'+field, field=field, question=question, severity='blocking',
                options=[], resolved=False, answer=None)


def _real_roots(expression: sp.Expr, symbol: sp.Symbol, domain=sp.S.Reals) -> list[sp.Expr] | None:
    if expression.is_polynomial(symbol):
        poly = sp.Poly(expression, symbol)
        if poly.degree() > 12:
            return None
        roots = sorted(set(poly.real_roots()), key=lambda v: float(sp.N(v)))
        return [root for root in roots if domain.contains(root) is sp.S.true]
    roots = sp.solveset(expression, symbol, domain=domain)
    if roots is sp.S.EmptySet:
        return []
    if isinstance(roots, sp.FiniteSet):
        return sorted(roots, key=lambda v: float(sp.N(v)))
    return None


def _base(task: str, expression: str, kind='integral') -> dict:
    return dict(engine='sympy', subject='calculus', task=task, kind=kind, variable='x',
                expression=expression, defaults={}, params=[], teaching=False,
                rotation_axis='x')


def _strict_roots(expression: sp.Expr, a: sp.Expr, b: sp.Expr) -> list[sp.Expr] | None:
    roots = _real_roots(expression, X, sp.Interval(a, b))
    if roots is None:
        return None
    return [root for root in roots if bool(root > a) and (b == sp.oo or bool(root < b))]


def _interval_sign(expression: sp.Expr, left: sp.Expr, right: sp.Expr) -> int:
    sample = left + 1 if right == sp.oo else (left + right) / 2
    value = sp.simplify(expression.subs(X, sample))
    if value.is_nonnegative is True:
        return 1
    if value.is_negative is True:
        return -1
    numeric = safe_float(value)
    if numeric is not None:
        return 1 if numeric >= 0 else -1
    raise ValueError('无法确认区间内的符号，不能把积分拆成可核验的分段')


def _require_nonnegative(expression: sp.Expr, a: sp.Expr, b: sp.Expr, message: str) -> None:
    if expression == 0:
        return
    roots = _strict_roots(expression, a, b)
    if roots is None:
        raise ValueError(message)
    cuts = [a, *roots, b]
    for left, right in zip(cuts, cuts[1:]):
        if _interval_sign(expression, left, right) < 0:
            raise ValueError(message)


def build_exam_math(text: str, source: Mapping[str, Any] | None = None,
                    overrides: Mapping[str, Any] | None = None) -> dict | None:
    """Compile explicit planar regions or an implicit normal into an exam model."""
    source, overrides = source or {}, dict(overrides or {})
    overrides = {**dict(overrides.get('condition_values') or {}), **overrides}
    for key, value in (overrides.get('ambiguity_answers') or {}).items():
        if key.startswith('exam_') and str(value).strip():
            overrides[key[5:]] = value
    normalized = text.replace('≤', '<=').replace('≥', '>=').replace('−', '-').replace('π', 'pi')
    normalized = normalized.replace('ｘ', 'x').replace('ｙ', 'y')
    normalized = normalized.replace('√', 'sqrt')
    normalized = re.sub(r'(?<=[0-9xy)])(?=sqrt\()', '*', normalized)
    superscripts = str.maketrans('⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺', '0123456789-+')
    normalized = re.sub(r'[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+', lambda m: '^('+m.group().translate(superscripts)+')', normalized)
    normalized = re.sub(r'\\(?:leq|le)\b', '<=', normalized)
    normalized = re.sub(r'\\(?:geq|ge)\b', '>=', normalized)
    if '法线' in normalized or re.search(r'\bnormal\b', normalized, re.I):
        return _build_normal(normalized, source, overrides)
    if not ('面积' in normalized or '体积' in normalized or re.search(r'\b(area|volume)\b', normalized, re.I)):
        return None
    if re.search(r'\by\s*\(\s*x\s*\)|y\s*[\'\u2032]|微分方程|面积最[大小]|最小面积|最大面积|三角形面积', normalized):
        return None
    if not re.search(r'\by\s*(?:<=|=)', normalized):
        return None
    conditions, ambiguities = [], []
    volume = '体积' in normalized or bool(re.search(r'\bvolume\b', normalized, re.I))
    area = '面积' in normalized or bool(re.search(r'\barea\b', normalized, re.I))
    task = 'area_volume' if volume else 'geometric_area'
    expression = str(overrides.get('expression') or '')
    match = re.search(r'\by\s*(?:<=|=)\s*', normalized)
    if not expression and match:
        expression = _prefix(normalized[match.end():])
    model = _base(task, expression)
    model['requested_quantities'] = (['area'] if area else []) + (['volume'] if volume else [])
    region_override = str(overrides.get('region_kind') or '')
    if region_override not in ('between_axis', 'vertical_inequality', 'between_curves'):
        region_override = ''
    lower_expression = str(overrides.get('lower_expression') or '')
    try:
        function = _expr(expression)
        model['expression'] = str(function)
        model['formula_tex'] = 'y='+to_latex(function)
        conditions.append(_condition('expression', '区域上边界函数' if region_override == 'between_curves' else '区域边界函数', str(function), source))
    except (ExprError, ValueError):
        ambiguities.append(_ambiguity('expression', '请确认区域上边界 y=f(x) 的完整表达式。'))
        return _built(model, conditions, ambiguities)
    if volume:
        x_axis = re.search(r'(?:绕|about)\s*(?:the\s*)?x\s*(?:轴|axis)', normalized, re.I)
        y_axis = re.search(r'(?:绕|about)\s*(?:the\s*)?y\s*(?:轴|axis)', normalized, re.I)
        general_axis = re.search(r'(?:绕|about)\s*(?:the\s*)?(?:直线\s*)?[xy]\s*=', normalized)
        axis = str(overrides.get('rotation_axis') or '')
        if general_axis:
            ambiguities.append(_ambiguity('rotation_axis', '当前确定性内核只支持绕坐标轴旋转；绕 x=a 或 y=b 等一般直线暂不支持，不能替换成坐标轴。'))
            model['rotation_axis'] = ''
        elif axis not in ('x', 'y'):
            axis = 'x' if x_axis and not y_axis else 'y' if y_axis and not x_axis else ''
            if axis:
                model['rotation_axis'] = axis
            else:
                ambiguities.append(_ambiguity('rotation_axis', '请确认旋转轴；当前确定性内核支持绕 x 轴（圆盘/圆环法）与绕 y 轴（壳层法）。'))
        else:
            model['rotation_axis'] = axis
    if region_override == 'between_curves':
        model['region_kind'] = 'between_curves'
        model['lower_expression'] = lower_expression
        try:
            lower_function = _expr(lower_expression)
            model['lower_expression'] = str(lower_function)
            conditions.append(_condition('lower_expression', '区域下边界函数', str(lower_function), source))
            if sp.simplify(lower_function-function) == 0:
                ambiguities.append(_ambiguity('region', '上下边界函数完全相同，区域为零面积；请核对完整边界。'))
        except (ExprError, ValueError):
            ambiguities.append(_ambiguity('region', '请确认区域下边界 y=g(x) 的完整表达式。'))
    elif region_override:
        model['region_kind'] = region_override
    else:
        y_lower_bounds = []
        for lower_match in re.finditer(r'('+_MATH+r')<=\s*y\b', normalized):
            y_lower_bounds.append(lower_match.group(1).strip().lstrip('{').strip())
        for lower_match in re.finditer(r'\by\s*>=\s*', normalized):
            y_lower_bounds.append(_prefix(normalized[lower_match.end():]))
        for lower_boundary in y_lower_bounds:
            try:
                if sp.simplify(_expr(lower_boundary)) != 0:
                    raise ExprError('暂不支持非零区域下边界')
            except (ExprError, ValueError):
                ambiguities.append(_ambiguity('region', '区域下边界不是已确认的 y=0，请核对完整边界。'))
                break
        explicit_inequality = bool(y_lower_bounds) and bool(re.search(r'\by\s*<=', normalized))
        model['region_kind'] = 'vertical_inequality' if explicit_inequality else 'between_axis'
        if re.search(r'\by\s*<=', normalized) and not y_lower_bounds:
            ambiguities.append(_ambiguity('region', '不等式区域缺少 y 的下边界，请核对完整区域。'))
        if not y_lower_bounds and not re.search(r'x\s*(?:轴|axis)', normalized, re.I):
            ambiguities.append(_ambiguity('region', '请确认完整区域边界；当前支持函数与 x 轴之间的区域。'))
        if len(re.findall(r'\by\s*=', normalized)) > 1:
            ambiguities.append(_ambiguity('region', '存在多条函数边界，请核对区域；不能自动按 x 轴替代其他边界。'))
    lower, upper = overrides.get('lower'), overrides.get('upper')
    chained = re.search(r'([^,，{}|;；\n]+?)<=\s*x\s*<=\s*([^,，};；\n]+)', normalized)
    lower_match = re.search(r'\bx\s*>=\s*', normalized)
    upper_match = re.search(r'\bx\s*<=\s*', normalized)
    if lower is None and lower_match:
        lower = _prefix(normalized[lower_match.end():])
    if upper is None and upper_match:
        upper = _prefix(normalized[upper_match.end():])
    if chained:
        if lower is None:
            lower = _prefix(chained.group(1))
        if upper is None:
            upper = _prefix(chained.group(2))
    if lower is None and upper is None and ('围成' in normalized or 'enclosed' in normalized.lower()):
        roots = _real_roots(function, X)
        if roots is not None and len(roots) >= 2:
            lower, upper = str(roots[0]), str(roots[-1])
            model['boundary_roots'] = [str(v) for v in roots]
        else:
            ambiguities.append(_ambiguity('bounds', '无法确定有限封闭区域，请提供全部边界或积分区间。'))
    elif lower is not None and upper is None and re.search(r'\bx\s*>=', normalized):
        upper = 'oo'
    if lower is None or upper is None:
        ambiguities.append(_ambiguity('bounds', '请确认完整积分区间，不能用默认 0 到 1 替代原题边界。'))
    else:
        try:
            a, b = _bound(str(lower)), _bound(str(upper))
            if b != sp.oo and not bool(a < b):
                raise ExprError('区间顺序不正确')
            model.update(lower_bound=str(a), upper_bound=str(b), improper_upper=b == sp.oo)
            visual_upper = float(a)+8 if b == sp.oo else float(b)
            model['defaults'] = dict(lower=float(a), upper=visual_upper, n=16)
            model['original_upper'] = str(b)
            model['visual_upper'] = visual_upper
            conditions.extend([_condition('lower', '积分下界', str(a), source),
                               _condition('upper', '积分上界', '+∞' if b == sp.oo else str(b), source)])
            model['params'] = [dict(id='n', label='分割数', kind='number', min=2, max=80, step=1, options=[])]
            if model['region_kind'] == 'between_curves' and model.get('lower_expression'):
                difference = sp.simplify(function - _expr(model['lower_expression']))
                roots = _strict_roots(difference, a, b)
                model['boundary_roots'] = [str(v) for v in (roots or [])]
                model['boundary_roots_complete'] = roots is not None
            elif 'boundary_roots' not in model:
                roots = [] if function == 0 else _real_roots(function, X, sp.Interval(a,b))
                model['boundary_roots'] = [str(v) for v in (roots or []) if bool(v > a) and (b == sp.oo or bool(v < b))]
                model['boundary_roots_complete'] = roots is not None
            else:
                model['boundary_roots_complete'] = True
        except (ExprError, ValueError, TypeError):
            ambiguities.append(_ambiguity('bounds', '积分区间无法确认，请提供实数上下界。'))
    if not ambiguities:
        try:
            if model['region_kind'] == 'vertical_inequality':
                model['effective_intervals'] = _positive_intervals(model)
            model['reference_quantities'] = _quantities(model)
        except ValueError as exc:
            message = str(exc)
            specific = message.startswith(('绕 y 轴', '两曲线之间', '无法证明', '符号积分'))
            ambiguities.append(_ambiguity('integral', message if specific else '积分未收敛到有限值或符号求解未完成，请核对函数与区间。'))
        except (TypeError, NotImplementedError):
            ambiguities.append(_ambiguity('integral','积分未收敛到有限值或符号求解未完成，请核对函数与区间。'))
    return _built(model, conditions, ambiguities)


def _positive_intervals(model: Mapping) -> list[list[str]]:
    """Discard fibers for which 0 <= y <= f(x) has no solution."""
    if not model.get('boundary_roots_complete'):
        raise ValueError('无法证明全部零点，不能确定非空纤维')
    function = _expr(str(model['expression']))
    a,b = _bound(model['lower_bound']),_bound(model['upper_bound'])
    cuts = sorted(set([a,b]+[_bound(root) for root in model.get('boundary_roots',[])]),key=lambda v:float(v))
    intervals=[]
    for left,right in zip(cuts,cuts[1:]):
        if not function.is_polynomial(X):
            interval=sp.Interval.open(left,right)
            if sp.calculus.util.continuous_domain(function,X,interval) != interval:
                raise ValueError('函数在分段内并非连续，不能据一个采样点判断符号')
        sample=left+1 if right==sp.oo else (left+right)/2
        sign=sp.simplify(function.subs(X,sample))
        if sign.is_nonnegative is True:
            intervals.append([str(left),str(right)])
        elif sign.is_negative is not True:
            raise ValueError('无法确认分段函数的符号')
    return intervals


def _built(model: dict, conditions: list, ambiguities: list) -> dict:
    return dict(model=model, conditions=conditions, ambiguities=ambiguities,
                formulas=[dict(id='exam_formula', tex=model.get('formula_tex', ''),
                               plain=model.get('expression', ''), role='识别出的原题公式')],
                recognized=not ambiguities)


def _build_normal(text: str, source: Mapping, overrides: Mapping) -> dict:
    model = _base('implicit_normal', '', 'derivative')
    conditions, ambiguities = [], []
    implicit = str(overrides.get('implicit_expression') or '')
    equation_end = 0
    for match in re.finditer(r'('+_MATH+r')=('+_MATH+r')', text):
        lhs, rhs = match.group(1).strip().lstrip('.'), match.group(2).strip().rstrip('.')
        try:
            equation = _expr(lhs, ('x', 'y'))-_expr(rhs, ('x', 'y'))
            if X in equation.free_symbols and Y in equation.free_symbols:
                equation_end = match.end()
                if not implicit:
                    implicit = str(equation)
                break
        except (ExprError, ValueError):
            continue
    try:
        equation = _expr(implicit, ('x', 'y'))
        model.update(expression=str(equation), implicit_expression=str(equation),
                     formula_tex=to_latex(equation)+'=0')
        conditions.append(_condition('implicit_expression', '隐式曲线 F(x,y)=0', str(equation), source))
    except (ExprError, ValueError):
        ambiguities.append(_ambiguity('implicit_expression', '请核对隐式曲线的完整方程 F(x,y)=0。'))
        return _built(model, conditions, ambiguities)
    coordinate_text = text[equation_end:]
    point_match = re.search(r'\bx\s*=\s*([+\-]?\d+(?:\.\d+)?(?:/\d+)?)', coordinate_text)
    point = overrides.get('point', point_match.group(1) if point_match else None)
    if point is None:
        ambiguities.append(_ambiguity('point', '请确认曲线上研究点的 x 坐标。'))
        return _built(model, conditions, ambiguities)
    try:
        point_x = _bound(str(point))
        model['point_x'] = str(point_x)
        model['defaults'] = dict(point=float(point_x), h=0.05)
        roots = _real_roots(equation.subs(X, point_x), Y)
        specified_y = overrides.get('point_y')
        y_match = re.search(r'\by\s*=\s*([+\-]?\d+(?:\.\d+)?(?:/\d+)?)', coordinate_text)
        if specified_y is None and y_match:
            specified_y = y_match.group(1)
        if specified_y is not None:
            point_y = _bound(str(specified_y))
            if sp.simplify(equation.subs({X:point_x, Y:point_y})) != 0:
                raise ExprError('研究点不在曲线上')
        elif roots is not None and len(roots) == 1:
            point_y = roots[0]
        else:
            model['branch_candidates'] = [str(v) for v in (roots or [])]
            ambiguities.append(_ambiguity('point_y', '该横坐标可能对应多个曲线分支，请提供研究点的 y 坐标。'))
            return _built(model, conditions, ambiguities)
        fx = sp.simplify(sp.diff(equation, X).subs({X:point_x,Y:point_y}))
        fy = sp.simplify(sp.diff(equation, Y).subs({X:point_x,Y:point_y}))
        if safe_float(fx) is None or safe_float(fy) is None:
            raise ExprError('该点偏导数不是有限实数')
        if sp.simplify(fx) == 0 and sp.simplify(fy) == 0:
            raise ExprError('研究点为奇点，无法唯一确定法线')
        model['point_y'] = str(point_y)
        slope = sp.simplify(fy/fx) if fx != 0 else None
        model['normal_slope'] = str(slope) if slope is not None else None
        model['vertical_normal'] = fx == 0
        model['partial_x'] = str(sp.diff(equation,X))
        model['partial_y'] = str(sp.diff(equation,Y))
        conditions.extend([_condition('point', '研究点 x 坐标', str(point_x), source),
                           _condition('point_y', '研究点 y 坐标', str(point_y), source)])
    except (ExprError, ValueError, TypeError):
        ambiguities.append(_ambiguity('point', '研究点或法线无法唯一确定，请核对坐标与曲线条件。'))
    return _built(model, conditions, ambiguities)


def _quantities(model: Mapping) -> list[dict]:
    if model.get('reference_quantities'):
        return list(model['reference_quantities'])
    function = _expr(str(model['expression']))
    lower_function = _expr(str(model['lower_expression'])) if model.get('lower_expression') else None
    a, b = _bound(str(model['lower_bound'])), _bound(str(model['upper_bound']))
    region = str(model.get('region_kind') or 'between_axis')
    axis = str(model.get('rotation_axis') or 'x')
    wants_volume = 'volume' in (model.get('requested_quantities') or [])
    if region == 'vertical_inequality':
        raw_intervals = model.get('effective_intervals')
        if raw_intervals is None:
            raw_intervals = _positive_intervals(model)
        intervals = [(_bound(left), _bound(right)) for left, right in raw_intervals]
    else:
        difference = function if region == 'between_axis' else sp.simplify(function - lower_function)
        roots = _strict_roots(difference, a, b)
        if roots is None:
            raise ValueError('无法证明全部零点，不能确定完整积分分段')
        cuts = sorted([a, *roots, b], key=lambda value: float(value))
        intervals = list(zip(cuts, cuts[1:]))
    if wants_volume and axis == 'y' and bool(a < 0) and bool(b > 0):
        raise ValueError('绕 y 轴旋转要求区域完全位于 y 轴一侧；跨 y 轴的区域折叠后不能直接按壳层法累加，请拆分区域或更换旋转轴')
    if wants_volume and axis == 'x' and region == 'between_curves':
        _require_nonnegative(function, a, b, '两曲线之间的区域绕 x 轴旋转要求上边界 f(x)≥0')
        _require_nonnegative(lower_function, a, b, '两曲线之间的区域绕 x 轴旋转要求下边界 g(x)≥0；区域跨越 x 轴时圆环法不适用')
    result = []
    for quantity in model['requested_quantities']:
        pieces = []
        for left, right in intervals:
            if quantity == 'area':
                if region == 'between_axis':
                    sign = _interval_sign(function, left, right)
                    value = sign * sp.integrate(function, (X, left, right))
                elif region == 'vertical_inequality':
                    value = sp.integrate(function, (X, left, right))
                else:
                    difference = sp.simplify(function - lower_function)
                    sign = _interval_sign(difference, left, right)
                    value = sign * sp.integrate(difference, (X, left, right))
            elif axis == 'y':
                radius = X if not bool(a < 0) else -X
                if region == 'between_axis':
                    sign = _interval_sign(function, left, right)
                    height = sign * function
                elif region == 'vertical_inequality':
                    height = function
                else:
                    difference = sp.simplify(function - lower_function)
                    sign = _interval_sign(difference, left, right)
                    height = sign * difference
                value = 2 * sp.pi * sp.integrate(radius * height, (X, left, right))
            elif region == 'between_curves':
                difference = sp.simplify(function - lower_function)
                sign = _interval_sign(difference, left, right)
                value = sp.pi * sign * sp.integrate(function**2 - lower_function**2, (X, left, right))
            else:
                value = sp.pi * sp.integrate(function**2, (X, left, right))
            if value.has(sp.Integral):
                raise ValueError('符号积分未完成，不能把未验证的数值积分作为原题答案')
            pieces.append(value)
        exact = sp.simplify(sum(pieces))
        value = safe_float(exact)
        if value is None:
            raise ValueError('该广义积分未收敛到有限值或未能完成解析计算')
        result.append(dict(id=quantity, label='面积' if quantity == 'area' else '旋转体积',
                           exact=str(exact), value=value, latex=to_latex(exact)))
    return result


def solve_exam_math(model: Mapping[str, Any]) -> dict | None:
    task = model.get('task')
    if task not in ('geometric_area','area_volume','implicit_normal'):
        return None
    if task == 'implicit_normal':
        if 'point_y' not in model:
            raise ValueError('曲线分支尚未确认')
        equation = _expr(str(model['implicit_expression']), ('x','y'))
        px,py = _bound(str(model['point_x'])),_bound(str(model['point_y']))
        slope = None if model.get('vertical_normal') else _expr(str(model['normal_slope']))
        fx = sp.simplify(sp.diff(equation, X).subs({X:px,Y:py}))
        fy = sp.simplify(sp.diff(equation, Y).subs({X:px,Y:py}))
        tangent = ('x='+to_latex(px) if fy == 0 else 'y-('+to_latex(py)+')='+to_latex(sp.simplify(-fx/fy))+'(x-('+to_latex(px)+'))')
        line = 'x='+to_latex(px) if slope is None else 'y-('+to_latex(py)+')='+to_latex(slope)+'(x-('+to_latex(px)+'))'
        return dict(summary='隐函数偏导确定切线，再求过研究点的法线。',
                    answer='法线 '+line if slope is None else '法线斜率 '+str(slope),
                    answer_value=safe_float(slope), exact=str(slope) if slope is not None else '斜率不存在（竖直法线）',
                    tangent_tex=tangent, normal_tex=line, exact_latex=line,
                    line_geometry=dict(tangent=tangent, normal=line, tangent_direction='vertical' if fy == 0 else 'horizontal' if fx == 0 else 'oblique', normal_direction='vertical' if fx == 0 else 'horizontal' if fy == 0 else 'oblique', point_x=str(px), point_y=str(py)), steps=[
                        dict(id='point',title='确认曲线上研究点',latex=f'P=({to_latex(px)},{to_latex(py)})',detail='将给定横坐标代入曲线，保留唯一实分支或已核对的纵坐标。'),
                        dict(id='implicit',title='由梯度确定切线与法线',latex=r'F_x\,\Delta x+F_y\,\Delta y=0',detail='梯度非零时确定唯一切线；法线方向为梯度。F_y=0 时切线竖直；F_x=0 时法线竖直，不作除零运算。'),
                        dict(id='tangent',title='写出切线',latex=tangent,detail='切线经过已确认的曲线研究点。'),
                        dict(id='normal',title='写出法线',latex=line,detail='法线经过研究点，方向与切线垂直。')],
                    conditions=['研究点必须位于曲线上，且梯度非零。'], limitations=[])
    quantities = _quantities(model)
    a,b = _bound(str(model['lower_bound'])),_bound(str(model['upper_bound']))
    function = _expr(str(model['expression']))
    lower_function = _expr(str(model['lower_expression'])) if model.get('lower_expression') else None
    region = str(model.get('region_kind') or 'between_axis')
    axis = str(model.get('rotation_axis') or 'x')
    if region == 'between_curves':
        region_step = dict(id='region', title='确定两曲线与分段点',
                           latex=f'y={to_latex(function)},\\quad y={to_latex(lower_function)},\\quad x\\in[{to_latex(a)},{to_latex(b)}]',
                           detail='两曲线交点用于分段；每段取上、下边界之差，避免正负抵消。')
    else:
        region_step = dict(id='region', title='确定区域与分段点',
                           latex=f'y={to_latex(function)},\\quad x\\in[{to_latex(a)},{to_latex(b)}]',
                           detail='不等式区域仅保留 f(x)≥0 的非空纤维。' if region == 'vertical_inequality' else '与 x 轴的全部实交点用于分段，几何面积逐段取绝对值。')
    steps = [region_step]
    for q in quantities:
        is_area = q['id'] == 'area'
        if is_area:
            if region == 'between_curves':
                formula = r'S=\int |f(x)-g(x)|\,dx='
            elif region == 'vertical_inequality':
                formula = r'S=\int \max(f(x),0)\,dx='
            else:
                formula = r'S=\int |f(x)|\,dx='
        elif axis == 'y':
            height = '|f(x)|' if region == 'between_axis' else 'f(x)' if region == 'vertical_inequality' else '|f(x)-g(x)|'
            formula = rf'V=2\pi\int |x|\cdot {height}\,dx='
        elif region == 'between_curves':
            formula = r'V=\pi\int |f(x)^2-g(x)^2|\,dx='
        elif region == 'vertical_inequality':
            formula = r'V=\pi\int \max(f(x),0)^2\,dx='
        else:
            formula = r'V=\pi\int f(x)^2\,dx='
        steps.append(dict(id=q['id'], title=q['label'], latex=formula+q['latex'],
                          detail=q['label']+'解析值为 '+q['exact']))
    conditions = []
    if axis == 'y' and 'volume' in (model.get('requested_quantities') or []):
        conditions.append('旋转轴为 y 轴，采用壳层法：体积元为 2π|x|·高度·dx；区域必须位于 y 轴一侧。')
    if model.get('improper_upper'):
        conditions.append('图形截断展示与原题广义积分分别标注。')
    return dict(summary='按完整区域边界计算几何面积与题目要求的旋转体积。',
                answer='；'.join(q['label']+' = '+q['exact'] for q in quantities),
                answer_value=quantities[0]['value'], exact=quantities[0]['exact'],
                approx=number_text(quantities[0]['value'],10), quantities=quantities, exact_latex=quantities[0]['latex'],
                steps=steps, conditions=conditions, limitations=[])


def evaluate_exam_math(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict | None:
    if model.get('task') not in ('geometric_area','area_volume','implicit_normal'):
        return None
    solution = solve_exam_math(model)
    if model['task'] == 'implicit_normal':
        return _normal_evaluate(model, params, solution)
    function = _expr(str(model['expression']))
    lower_function = _expr(str(model['lower_expression'])) if model.get('lower_expression') else None
    a = float(model['defaults']['lower'])
    b = float(model['defaults']['upper'])
    n = max(2,min(80,int(params.get('n',16))))
    region = str(model.get('region_kind') or 'between_axis')
    axis = str(model.get('rotation_axis') or 'x')
    func = sp.lambdify(X,function,'math')
    lower_func = sp.lambdify(X,lower_function,'math') if lower_function is not None else None
    def evaluate(x):
        try:
            value=float(func(x))
            if region == 'vertical_inequality' and value < 0:
                return None
            return value if math.isfinite(value) else None
        except (ValueError,ZeroDivisionError,OverflowError):
            return None
    def evaluate_lower(x):
        if lower_func is None:
            return None
        try:
            value=float(lower_func(x))
            return value if math.isfinite(value) else None
        except (ValueError,ZeroDivisionError,OverflowError):
            return None
    series=[dict(x=a+(b-a)*i/259,y=evaluate(a+(b-a)*i/259)) for i in range(260)]
    lower_series = ([dict(x=a+(b-a)*i/259,y=evaluate_lower(a+(b-a)*i/259)) for i in range(260)]
                    if lower_func is not None else None)
    rects=[]
    for i in range(n):
        x0,x1=a+(b-a)*i/n,a+(b-a)*(i+1)/n
        mid=(x0+x1)/2
        upper_value=evaluate(mid)
        lower_value=evaluate_lower(mid)
        if lower_func is not None:
            candidates=[v for v in (upper_value,lower_value) if v is not None]
            top=max(candidates) if candidates else 0.0
            base=min(candidates) if candidates else 0.0
        else:
            top=upper_value if upper_value is not None else 0.0
            base=0.0
        rects.append(dict(x0=x0,x1=x1,mid=mid,height=top,base=base))
    quantities=solution['quantities']
    volume_preview = quantities[0]['id'] == 'volume'
    def piece(rect):
        width=rect['x1']-rect['x0']
        if not volume_preview:
            return abs(rect['height']-rect['base'])*width
        if axis == 'y':
            return 2*math.pi*abs(rect['mid'])*(rect['height']-rect['base'])*width
        if lower_func is not None:
            return math.pi*abs(rect['height']**2-rect['base']**2)*width
        return math.pi*rect['height']**2*width
    approximation=sum(piece(rect) for rect in rects)
    notes=['曲线与矩形展示几何区域；面积逐段取绝对值。']
    if volume_preview and axis == 'y':
        notes.append('旋转体积使用壳层法 2π|x|·高度：矩形高度是到边界的距离，半径是到 y 轴的距离。')
    elif volume_preview and lower_func is not None:
        notes.append('旋转体积使用圆环法 π(f²-g²)；两曲线之间区域按交点分段。')
    elif volume_preview:
        notes.append('旋转体积使用圆盘法 πf(x)²。')
    if region == 'between_curves':
        notes.append('区域为两曲线之间，按交点分段后取上、下边界之差；不把其中一条边界替换成 x 轴。')
    if model.get('improper_upper'):
        notes.append(f'原题上界为 +∞，图形及矩形在 x={b:g} 截断；指标仍为原题广义积分的完整解析值。')
    result = dict(subject='calculus',kind='integral',headline=solution['answer'],
                metrics=[dict(id=q['id'],label=q['label']+'解析值',value=number_text(q['value'],10)) for q in quantities],
                checks=[],notes=notes,trace=[dict(index=i,label=q['label'],detail=q['exact'],values={q['id']:q['value']}) for i,q in enumerate(quantities)],
                series=series,domain=dict(x_min=a,x_max=b),rects=rects,
                exact=quantities[0]['value'],approx=approximation,error=abs(approximation-quantities[0]['value']),
                answerText=solution['answer'],quantities=quantities,rotation_axis=axis,region_kind=region)
    if lower_series is not None:
        result['lowerSeries']=lower_series
        result['lowerExpression']=str(lower_function)
    return result


def _normal_evaluate(model: Mapping, params: Mapping, solution: Mapping) -> dict:
    equation=_expr(str(model['implicit_expression']),('x','y'))
    px,py=float(_bound(str(model['point_x']))),float(_bound(str(model['point_y'])))
    swap = model.get('normal_slope') is not None and sp.simplify(_expr(str(model['normal_slope']))) == 0
    independent, dependent = (Y, X) if swap else (X, Y)
    center, seed = (py, px) if swap else (px, py)
    series=[]
    # 垂直切线附近改为 x(y)，避免把同一点的两个 y 分支混成一条。
    for direction in (-1,1):
        current=seed
        half=[]
        stopped=False
        for i in range(1,81):
            coordinate=center+direction*i/80
            try:
                if stopped: raise ValueError('branch stopped')
                root=sp.nsolve(equation.subs(independent,coordinate),dependent,current,verify=True)
                value=safe_float(root)
                if value is None or abs(value-current)>0.5:
                    raise ValueError('branch discontinuity')
                current=value
            except Exception:
                value=None
                stopped=True
            half.append(dict(x=value if value is not None else px,y=coordinate if value is not None else None) if swap else dict(x=coordinate,y=value))
        series.extend(reversed(half) if direction<0 else [dict(x=px,y=py)]+half)
    slope=safe_float(_expr(str(model['normal_slope']))) if model.get('normal_slope') is not None else None
    result = dict(subject='calculus',kind='derivative',headline=solution['answer'],
                metrics=[dict(id='normal_slope',label='法线斜率',value=solution['exact'])],
                checks=[],notes=['仅展示经过已核对研究点的局部隐式曲线分支；切线与法线方向分别显示。'],
                trace=[dict(index=0,label='曲线研究点',detail=solution['answer'],values=dict(x=px,y=py,slope=slope))],
                series=series,domain=dict(x_min=px-1,x_max=px+1),rects=[],exact=solution['answer_value'],approx=solution['answer_value'],error=0,
                answerText=solution['answer'],vertical_normal=model.get('vertical_normal',False))
    if slope is not None:
        result['point'] = dict(x=px,y=py,slope=slope,tangent=dict(m=slope,b=py-slope*px))
    return result


def _finite_families(roots: sp.Set) -> tuple[list[sp.Expr],bool]:
    if roots is sp.S.EmptySet:
        return [],True
    if isinstance(roots,sp.FiniteSet):
        return list(roots),True
    if isinstance(roots,sp.ImageSet) and roots.base_set == sp.S.Integers:
        return [roots.lamda.expr.subs(roots.lamda.variables[0],K)],True
    if isinstance(roots,sp.Union):
        values=[]
        for subset in roots.args:
            partial,complete=_finite_families(subset)
            if not complete:
                return [],False
            values.extend(partial)
        return values,True
    return [],False


def _triangular_extrema_candidates(expression: sp.Expr, symbols: list[sp.Symbol]) -> tuple[list[dict], bool]:
    """Solve one gradient for a variable, then substitute into the other gradient."""
    x, y = symbols
    gx, gy = sp.diff(expression, x), sp.diff(expression, y)
    for first, second, first_grad, second_grad in ((x, y, gx, gy), (y, x, gy, gx)):
        try:
            roots = sp.solveset(second_grad, second, domain=sp.S.Reals)
        except Exception:  # noqa: BLE001
            continue
        if roots is sp.S.EmptySet:
            if second_grad.has(first):
                complete = False
                continue
            return [], True
        if not isinstance(roots, sp.FiniteSet):
            continue
        complete = True
        candidates: list[dict] = []
        for root in roots:
            if not isinstance(root, sp.Expr) or root.is_real is False or not root.free_symbols <= {first}:
                complete = False
                continue
            reduced = sp.simplify(first_grad.subs(second, root))
            try:
                first_roots = sp.solveset(reduced, first, domain=sp.S.Reals)
            except Exception:  # noqa: BLE001
                complete = False
                continue
            if first_roots is sp.S.EmptySet:
                if reduced.has(second):
                    complete = False
                continue
            if not isinstance(first_roots, sp.FiniteSet):
                complete = False
                continue
            for first_root in first_roots:
                if first_root.is_real is not True:
                    complete = False
                    continue
                candidate = {first: sp.simplify(first_root), second: sp.simplify(root.subs(first, first_root))}
                if any(sp.simplify(g.subs(candidate)) != 0 for g in (gx, gy)):
                    complete = False
                    continue
                candidates.append(candidate)
        if complete:
            unique = []
            seen = set()
            for candidate in candidates:
                key = tuple(str(sp.simplify(candidate[s])) for s in symbols)
                if key not in seen:
                    seen.add(key)
                    unique.append(candidate)
            return unique, True
    return [], False


def complete_extrema(model: Mapping[str,Any], base_solution: Mapping[str,Any]) -> dict:
    """Classify all isolated stationary points when an exhaustive set is provable.

    A polynomial triangular reduction and a linear elimination cover many exam
    functions. An unresolved set is explicitly incomplete; numerical candidates
    are never promoted to a complete extremum classification.
    """
    result=dict(base_solution)
    if model.get('bounds'):
        return result
    names=list(model.get('variables') or [])
    if len(names)!=2:
        return result
    symbols=[sp.Symbol(name,real=True) for name in names]
    x,y=symbols
    expression=_expr(str(model['expression']),names)
    gx,gy=[sp.diff(expression,s) for s in symbols]
    candidates=[]
    complete=False
    # Eliminate one variable only if its gradient equation is globally linear
    # with a nonzero constant coefficient (no lost zero-denominator branches).
    for first,second,first_grad,second_grad in ((x,y,gx,gy),(y,x,gy,gx)):
        coefficient=sp.diff(first_grad,first)
        if coefficient == 0 or coefficient.free_symbols or sp.diff(first_grad,first,2)!=0:
            continue
        replacement=sp.simplify(first-sp.cancel(first_grad/coefficient))
        if first in replacement.free_symbols:
            continue
        reduced=sp.simplify(second_grad.subs(first,replacement))
        families,complete=_finite_families(sp.solveset(reduced,second,domain=sp.S.Reals))
        if complete:
            candidates=[{first:sp.simplify(replacement.subs(second,v)),second:v} for v in families]
            break
    if not complete and expression.is_polynomial(x,y):
        if sp.Poly(expression,x,y).total_degree()<=8:
            try:
                roots=sp.solve_poly_system([gx,gy],x,y)
                if roots is not None:
                    candidates=[dict(zip(symbols,values)) for values in roots if all(v.is_real is True for v in values)]
                    complete=all(v.is_real is not None for values in roots for v in values)
            except (NotImplementedError,ValueError,sp.PolynomialError):
                pass
    if not complete:
        triangular, triangular_complete = _triangular_extrema_candidates(expression, symbols)
        if triangular_complete:
            candidates = triangular
            complete = True
    hessian=sp.hessian(expression,symbols)
    points=[]
    labels={'minimum':'极小值','maximum':'极大值','saddle':'鞍点','undetermined':'退化驻点（需进一步判别）'}
    for candidate in candidates[:64]:
        if any(sp.simplify(g.subs(candidate))!=0 for g in (gx,gy)):
            complete=False
            continue
        matrix=sp.simplify(hessian.subs(candidate))
        determinant=sp.simplify(matrix.det())
        a=sp.simplify(matrix[0,0])
        classification='undetermined'
        if determinant.is_negative:
            classification='saddle'
        elif determinant.is_positive and a.is_positive:
            classification='minimum'
        elif determinant.is_positive and a.is_negative:
            classification='maximum'
        points.append(dict(coordinates=[str(sp.simplify(candidate[s])) for s in symbols],
                           classification=classification,value=str(sp.simplify(expression.subs(candidate))),
                           hessian_determinant=str(determinant),latex=to_latex(sp.Tuple(*(candidate[s] for s in symbols)))))
    complete=complete and len(candidates)<=64
    result['stationary_points']=points
    result['stationary_complete']=complete
    descriptions=[labels[p['classification']]+'点 ('+', '.join(p['coordinates'])+'), f='+p['value'] for p in points]
    if any(K in candidate[s].free_symbols for candidate in candidates for s in symbols):
        descriptions.append('k ∈ Z')
    fully_classified=complete and all(p['classification']!='undetermined' for p in points)
    if fully_classified:
        for key,label in (('minimum','极小值'),('maximum','极大值')):
            if not any(p['classification']==key for p in points):
                descriptions.append(label+'不存在')
    if complete and not points:
        descriptions.append('没有有限的孤立驻点')
    if not complete:
        descriptions.append('驻点集合尚未证明完整，不能据此排除其他极值')
    if fully_classified:
        result['answer']='；'.join(descriptions) or '没有有限的孤立驻点'
    else:
        result['answer']=''
    result['classification_complete']=fully_classified
    result['solution_complete']=fully_classified
    result['solution_status']='complete' if fully_classified else 'incomplete'
    if not complete:
        result['incomplete_reason']='驻点集合尚未证明完整，不能据此排除其他极值'
    elif not fully_classified:
        result['incomplete_reason']='存在退化驻点，当前高阶判别未能完成分类'
    if not fully_classified:
        result['summary']=result['incomplete_reason']
    result['global_note']='全部驻点由符号方程求出；Hessian 判别局部极值与鞍点。' if fully_classified else '仅得到部分驻点候选或存在退化点，完整性尚未证明。'
    result['steps']=list(result.get('steps') or [])+[dict(id='stationary_classification',title='驻点全集与 Hessian 分类',
        latex=r'\nabla f=0,\quad D=f_{xx}f_{yy}-f_{xy}^2',detail='；'.join(descriptions))]
    # One numerical representative is not a full stationary family or an optimum.
    if points:
        result['answer_point']=None
        result['answer_value']=None
    return result
